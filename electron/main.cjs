const { app, BrowserWindow, ipcMain, systemPreferences, screen, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

const DEV = !!process.env.NOTIFY_DEV;

/* ---- resolve external tools / models ---- */
function findBin(name) {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  return candidates.find((p) => fs.existsSync(p)) || name;
}
const WHISPER = findBin("whisper-cli");
const FFMPEG = findBin("ffmpeg");

function modelsDir() {
  return DEV
    ? path.join(__dirname, "..", "models")
    : path.join(process.resourcesPath, "models");
}
const WHISPER_MODEL = path.join(modelsDir(), "ggml-small.en-tdrz.bin");
const OLLAMA_MODEL = process.env.NOTIFY_OLLAMA_MODEL || "llama3.2:3b";

let win;
let mode = "pill"; // "pill" (content-fit, bottom-anchored) | "full" (resizable app)

function createWindow() {
  win = new BrowserWindow({
    width: 320,
    height: 96,
    minWidth: 280,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false, // shadow drawn in CSS so it follows the pill shape
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // forward renderer diagnostics to the terminal log
  win.webContents.on("console-message", (_e, level, message) => {
    console.log(`[renderer] ${message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) =>
    console.log("[renderer] gone:", d.reason)
  );
  win.webContents.on("did-fail-load", (_e, code, desc) =>
    console.log("[renderer] did-fail-load:", code, desc)
  );
  win.webContents.on("did-finish-load", () =>
    console.log("[renderer] did-finish-load OK")
  );

  if (DEV) {
    win.loadURL("http://localhost:5273");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  // allow the renderer's getUserMedia mic request through Electron's session layer
  const allow = (perm) =>
    ["media", "microphone", "audioCapture"].includes(perm);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => {
    console.log("[perm] request:", perm);
    cb(allow(perm));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => {
    console.log("[perm] check:", perm);
    return allow(perm);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => app.quit());

/* ---- window controls from renderer ---- */
ipcMain.on("resize", (_e, { width, height }) => {
  if (!win || mode === "full") return; // in full mode the user controls size
  const [x, y] = win.getPosition();
  const oldH = win.getBounds().height;
  // keep the pill's bottom edge anchored as it grows upward
  const newY = y + (oldH - Math.round(height));
  win.setBounds(
    { x, y: newY, width: Math.round(width), height: Math.round(height) },
    false
  );
});
ipcMain.on("set-pos", (_e, { x, y }) => {
  if (win && mode !== "full") win.setPosition(Math.round(x), Math.round(y), false);
});

// manual drag-resize from a corner grip (top-left stays fixed)
ipcMain.on("resize-to", (_e, { w, h }) => {
  if (!win || mode === "full") return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = Math.max(300, Math.min(Math.round(w), sw - 16));
  const H = Math.max(220, Math.min(Math.round(h), sh - 24));
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: W, height: H }, false);
});

ipcMain.on("set-mode", (_e, m) => {
  if (!win) return;
  mode = m;
  if (m === "full") {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(860, width - 80);
    const h = Math.min(700, height - 120);
    win.setResizable(true);
    win.setMinimumSize(540, 440);
    win.setMaximumSize(0, 0);
    win.setSize(w, h, true);
    win.center();
  } else {
    win.setResizable(false);
    win.setMinimumSize(240, 80);
  }
});

ipcMain.on("minimize", () => win && win.minimize());
ipcMain.on("quit", () => app.quit());
ipcMain.handle("mic-permission", async () => {
  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    console.log("[mic] system status:", status);
    if (status === "granted") return true;
    const granted = await systemPreferences.askForMediaAccess("microphone");
    console.log("[mic] askForMediaAccess ->", granted);
    return granted;
  } catch (e) {
    console.log("[mic] permission check failed:", e.message);
    return true;
  }
});

/* ---- helpers ---- */
function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => {
      stderr += d.toString();
      onStderr && onStderr(d.toString());
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

function ollamaGenerate(prompt) {
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    format: "json",
    options: { temperature: 0.2 },
  });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 11434,
        path: "/api/generate",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).response || "{}");
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ---- parse whisper json into speaker turns ---- */
function buildSegments(json) {
  const items = json.transcription || [];
  const segments = [];
  let speaker = 1;
  for (const it of items) {
    let text = (it.text || "").trim();
    const turned = /\[SPEAKER_TURN\]|\[_SOT_\]|\[SPEAKER TURN\]/i.test(text);
    text = text.replace(/\[SPEAKER_TURN\]|\[_SOT_\]|\[SPEAKER TURN\]/gi, "").trim();
    if (!text) {
      if (turned) speaker++;
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && last.speaker === speaker) last.text += " " + text;
    else segments.push({ speaker, text });
    if (turned) speaker++;
  }
  return segments;
}

const NOTES_PROMPT = (transcript) => `You are Notify, an AI meeting notepad. From the meeting transcript below, produce concise, useful notes.

Return ONLY valid JSON with this exact shape:
{
  "title": "3-6 word meeting title",
  "summary": "2-4 sentence plain summary",
  "notes": ["key point", "key point"],
  "actions": [{"text": "the task", "owner": "Speaker 1 or a name if stated", "due": "date if mentioned, else empty"}],
  "agenda": [{"topic": "topic", "detail": "one line"}],
  "decisions": ["decision made"]
}

Rules: be specific, no fluff. If a field has nothing, use an empty array or empty string. Owners/speakers should match the transcript labels.

TRANSCRIPT:
${transcript}`;

/* ---- main pipeline: audio bytes -> segments + notes ---- */
ipcMain.handle("process-audio", async (_e, arrayBuffer) => {
  const send = (stage, detail) =>
    win && win.webContents.send("process-progress", { stage, detail });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notify-"));
  const input = path.join(tmp, "input.wav");
  const wav = path.join(tmp, "audio.wav");
  const outBase = path.join(tmp, "out");

  try {
    fs.writeFileSync(input, Buffer.from(arrayBuffer));
    console.log("[pipe] received audio bytes:", Buffer.from(arrayBuffer).length);

    send("converting");
    // normalise to 16 kHz mono PCM for whisper (input may be 44.1/48 kHz)
    await run(FFMPEG, ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    console.log("[pipe] wav size:", fs.existsSync(wav) ? fs.statSync(wav).size : "MISSING");

    if (!fs.existsSync(WHISPER_MODEL)) {
      throw new Error("Whisper model missing. Still downloading? " + WHISPER_MODEL);
    }

    send("transcribing");
    await run(WHISPER, [
      "-m", WHISPER_MODEL,
      "-f", wav,
      "-tdrz",
      "-oj",
      "-of", outBase,
    ]);

    const json = JSON.parse(fs.readFileSync(outBase + ".json", "utf8"));
    const segments = buildSegments(json);
    const transcript = segments.map((s) => `Speaker ${s.speaker}: ${s.text}`).join("\n");
    console.log("[pipe] transcript chars:", transcript.length, "| preview:", transcript.slice(0, 120));

    if (!transcript.trim()) {
      return { segments: [], notes: emptyNotes("No speech detected"), transcript: "" };
    }

    send("writing");
    let notes;
    try {
      const raw = await ollamaGenerate(NOTES_PROMPT(transcript));
      notes = normalizeNotes(JSON.parse(raw));
    } catch (e) {
      notes = emptyNotes("Notes engine unavailable", transcript);
    }

    return { segments, notes, transcript };
  } catch (err) {
    console.log("[pipe] ERROR:", err.message);
    throw err;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

function emptyNotes(title, transcript = "") {
  return {
    title,
    summary: transcript ? transcript.slice(0, 280) : "",
    notes: [],
    actions: [],
    agenda: [],
    decisions: [],
  };
}
function normalizeNotes(n) {
  return {
    title: typeof n.title === "string" ? n.title : "Meeting notes",
    summary: typeof n.summary === "string" ? n.summary : "",
    notes: Array.isArray(n.notes) ? n.notes.filter((x) => typeof x === "string") : [],
    actions: Array.isArray(n.actions)
      ? n.actions.map((a) => ({
          text: a.text || "",
          owner: a.owner || "",
          due: a.due || "",
        })).filter((a) => a.text)
      : [],
    agenda: Array.isArray(n.agenda)
      ? n.agenda.map((a) => ({ topic: a.topic || "", detail: a.detail || "" })).filter((a) => a.topic)
      : [],
    decisions: Array.isArray(n.decisions) ? n.decisions.filter((x) => typeof x === "string") : [],
  };
}
