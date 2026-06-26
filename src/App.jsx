import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const spring = { type: "spring", stiffness: 200, damping: 30, mass: 1 };
const soft = { type: "spring", stiffness: 160, damping: 26, mass: 1 };

// drag a corner grip to resize the OS window (top-left stays put)
function useWindowResize(onSize) {
  return useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX, startY = e.screenY;
    const startW = window.innerWidth, startH = window.innerHeight;
    const onMove = (ev) => {
      const w = startW + (ev.screenX - startX);
      const h = startH + (ev.screenY - startY);
      window.notify?.resizeTo(w, h);
      onSize({ w, h });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onSize]);
}

// Drag the OS window by hand so we can tell a click (open) from a drag (move).
// (-webkit-app-region: drag would swallow all clicks.)
function useWindowDrag(onClick) {
  return useCallback(
    (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return; // let real buttons click
      const offsetX = e.clientX;
      const offsetY = e.clientY;
      const startX = e.screenX;
      const startY = e.screenY;
      let moved = false;
      const onMove = (ev) => {
        if (Math.abs(ev.screenX - startX) + Math.abs(ev.screenY - startY) > 3)
          moved = true;
        window.notify?.setPos(ev.screenX - offsetX, ev.screenY - offsetY);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!moved && onClick) onClick();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onClick]
  );
}

const SPEAKER_COLORS = ["#c8694a", "#8a9b7e", "#6b7fb3", "#b08968", "#9b6b9e"];
const speakerColor = (n) => SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length];
const speakerInitials = (n) => `S${n}`;

export default function App() {
  const [stage, setStage] = useState("dock"); // dock|ready|recording|processing|notes|error
  const [mode, setMode] = useState("pill"); // pill | full
  const [winSize, setWinSize] = useState(null); // {w,h} when user has hand-resized
  const [result, setResult] = useState(null); // {segments, notes, transcript}
  const [progress, setProgress] = useState("transcribing");
  const [error, setError] = useState("");
  const shellRef = useRef(null);

  const sized = winSize !== null;

  // keep the OS window sized to the content — unless the user has hand-resized it
  useEffect(() => {
    const el = shellRef.current;
    if (!el || !window.notify || mode === "full" || sized) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      window.notify.resize(Math.ceil(r.width) + 60, Math.ceil(r.height) + 64);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, stage, sized]);

  // reset any manual size when collapsing back to the pill
  useEffect(() => { if (stage === "dock") setWinSize(null); }, [stage]);

  const goFull = () => { window.notify?.setMode("full"); setMode("full"); };
  const goPill = () => { window.notify?.setMode("pill"); setMode("pill"); };

  // FULL APPLICATION WINDOW
  if (mode === "full") {
    return (
      <div className="stage" data-mode="full">
        <FullApp
          result={result}
          onRestore={goPill}
          onMinimize={() => window.notify?.minimize()}
          onClose={() => { goPill(); setStage("dock"); }}
          onAgain={() => { goPill(); setStage("ready"); }}
        />
      </div>
    );
  }

  const expanded = stage !== "dock";
  const radius = stage === "dock" ? 999 : 16;

  return (
    <div className="stage" data-mode={sized ? "sized" : "pill"}>
      <motion.div
        ref={shellRef}
        layout={!sized}
        className="shell"
        transition={spring}
        animate={{ borderRadius: sized ? 16 : radius }}
        style={
          sized
            ? { borderRadius: 16, width: "100%", height: "100%", display: "flex", flexDirection: "column" }
            : { borderRadius: radius, width: expanded ? 360 : "fit-content" }
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {stage === "dock" && <Dock key="dock" onOpen={() => setStage("ready")} />}
          {stage === "ready" && (
            <Ready
              key="ready"
              onClose={() => setStage("dock")}
              onRecord={() => setStage("recording")}
            />
          )}
          {stage === "recording" && (
            <Recording
              key="rec"
              onCancel={() => setStage("ready")}
              onDone={async (arrayBuffer) => {
                setStage("processing");
                try {
                  const unsub = window.notify.onProgress((p) => setProgress(p.stage));
                  const out = await window.notify.processAudio(arrayBuffer);
                  unsub && unsub();
                  setResult(out);
                  setStage("notes");
                } catch (e) {
                  setError(String(e?.message || e));
                  setStage("error");
                }
              }}
              onError={(msg) => {
                setError(msg);
                setStage("error");
              }}
            />
          )}
          {stage === "processing" && <Processing key="proc" progress={progress} />}
          {stage === "notes" && (
            <Notes
              key="notes"
              result={result}
              sized={sized}
              onClose={() => setStage("dock")}
              onAgain={() => setStage("ready")}
            />
          )}
          {stage === "error" && (
            <ErrorView key="err" message={error} onBack={() => setStage("ready")} />
          )}
        </AnimatePresence>

        {expanded && <ResizeGrip onResize={setWinSize} />}
      </motion.div>
    </div>
  );
}

/* corner grip — drag to resize the window bigger/smaller */
function ResizeGrip({ onResize }) {
  const start = useWindowResize(onResize);
  return (
    <div
      onMouseDown={start}
      title="Drag to resize"
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 22,
        height: 22,
        cursor: "nwse-resize",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: 4,
        zIndex: 20,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 11 11">
        <path d="M11 0 L11 11 L0 11 Z" fill="var(--ink)" opacity="0.18" />
        <path d="M10 4 L4 10 M10 8 L8 10" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
      </svg>
    </div>
  );
}

/* ------------------------------- DOCK ------------------------------- */
function Dock({ onOpen }) {
  const drag = useWindowDrag(onOpen);
  return (
    <motion.div
      layout
      className="drag"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={soft}
      onMouseDown={drag}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 18px 11px 13px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <Dot size={24} />
      <span className="serif" style={{ fontSize: 19, lineHeight: 1 }}>Notify</span>
      <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>tap to listen</span>
    </motion.div>
  );
}

/* ------------------------------- READY ------------------------------- */
function Ready({ onClose, onRecord, onExpand }) {
  return (
    <Panel onClose={onClose}>
      <Header title="Ready when you are" onClose={onClose} onExpand={onExpand} />
      <div style={{ padding: "2px 20px 20px" }}>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 16 }}>
          Notify listens through your mic and writes the notes, action items and
          follow-ups. Everything runs locally on your Mac — nothing leaves the
          device.
        </p>
        <motion.button
          className="no-drag"
          onClick={onRecord}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={primaryBtn}
        >
          <Dot size={16} pulse /> Start listening
        </motion.button>
      </div>
    </Panel>
  );
}

/* ----------------------------- RECORDING ----------------------------- */
function Recording({ onDone, onCancel, onError }) {
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState(new Array(9).fill(0.2));
  const refs = useRef({});
  const drag = useWindowDrag();

  useEffect(() => {
    let raf, started = Date.now();
    let stopped = false;

    (async () => {
      try {
        if (window.notify?.micPermission) {
          const ok = await window.notify.micPermission();
          console.log("[rec] mic permission ->", ok);
        }
        console.log("[rec] requesting getUserMedia…");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("[rec] mic stream live, tracks:", stream.getAudioTracks().map((t) => t.label).join(", ") || "(unnamed)");

        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaStreamSource(stream);

        // waveform visualisation
        const analyser = ac.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        // raw PCM capture (robust — no MediaRecorder / Blob involved)
        const proc = ac.createScriptProcessor(4096, 1, 1);
        const buffers = [];
        proc.onaudioprocess = (e) => {
          buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        const mute = ac.createGain();
        mute.gain.value = 0; // prevents mic feedback through speakers
        src.connect(proc);
        proc.connect(mute);
        mute.connect(ac.destination);
        console.log("[rec] capturing PCM @", ac.sampleRate, "Hz");

        refs.current = { stream, ac, proc, buffers, sampleRate: ac.sampleRate };

        const tick = () => {
          if (stopped) return;
          setElapsed((Date.now() - started) / 1000);
          analyser.getByteFrequencyData(data);
          const bars = [];
          for (let i = 0; i < 9; i++) {
            const v = data[i * 2] / 255;
            bars.push(0.18 + v * 0.9);
          }
          setLevels(bars);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        console.log("[rec] getUserMedia FAILED:", e?.name, e?.message);
        onError(
          /denied|permission|notallowed/i.test(String(e?.name) + String(e?.message))
            ? "Microphone access was denied. Open System Settings → Privacy & Security → Microphone and enable it for Notify (or Electron), then try again."
            : "Couldn't start the microphone: " + (e?.message || e)
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const stop = (deliver) => {
    const r = refs.current;
    if (!r || !r.stream) { onCancel(); return; }
    try { if (r.proc) { r.proc.onaudioprocess = null; r.proc.disconnect(); } } catch {}
    try { r.stream.getTracks().forEach((t) => t.stop()); } catch {}

    if (!deliver) { try { r.ac?.close(); } catch {} onCancel(); return; }

    const total = r.buffers.reduce((a, b) => a + b.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const b of r.buffers) { merged.set(b, o); o += b.length; }
    try { r.ac?.close(); } catch {}

    const wav = encodeWav(merged, r.sampleRate);
    console.log("[rec] stopped — samples:", total, "wav bytes:", wav.byteLength);
    if (wav.byteLength < 4000) {
      onError("That recording was empty — no audio was captured. Try again and speak for a few seconds.");
      return;
    }
    onDone(wav);
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={soft}>
      <div className="drag" onMouseDown={drag} style={{ ...headerBase, cursor: "grab" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Dot size={20} live />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Listening</span>
          <LiveWave levels={levels} />
        </div>
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>
          {fmt(elapsed)}
        </span>
      </div>
      <div style={{ padding: "4px 20px 18px" }}>
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.5, marginBottom: 14, marginTop: 4 }}>
          Recording locally. Stop when the conversation wraps and Notify will write
          your notes.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="no-drag" onClick={() => stop(false)} style={ghostBtn}>Cancel</button>
          <motion.button
            className="no-drag"
            onClick={() => stop(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{ ...primaryBtn, background: "var(--ink)", flex: 1.6 }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, background: "#fff" }} />
            Stop &amp; write notes
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function LiveWave({ levels }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2.5, height: 18, marginLeft: 2 }}>
      {levels.map((v, i) => (
        <motion.span
          key={i}
          animate={{ height: 4 + v * 14 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{ width: 3, borderRadius: 99, background: "var(--mint-deep)", opacity: 1 }}
        />
      ))}
    </div>
  );
}

/* ---------------------------- PROCESSING ---------------------------- */
function Processing({ progress }) {
  const step =
    progress === "converting" ? 1 : progress === "transcribing" ? 2 : 3;
  const label =
    progress === "converting" ? "Preparing audio"
    : progress === "transcribing" ? "Transcribing & spotting speakers"
    : "Writing your notes";
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={soft}
      style={{ padding: "30px 22px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <RetroLoader />
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 16, color: "var(--ink)" }}>{label}…</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4, fontWeight: 600 }}>Step {step} of 3</div>
      </div>
      {/* progress bar */}
      <div style={{ width: "100%", height: 12, border: "2px solid var(--ink)", borderRadius: 6, overflow: "hidden", background: "var(--panel)" }}>
        <motion.div
          animate={{ width: `${(step / 3) * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          style={{ height: "100%", background: "var(--yellow)", borderRight: "2px solid var(--ink)" }}
        />
      </div>
    </motion.div>
  );
}

function RetroLoader() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 48 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          animate={{ height: [12, 44, 12] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.11 }}
          style={{
            width: 13,
            display: "block",
            background: i % 2 ? "var(--yellow)" : "var(--mint-deep)",
            border: "2px solid var(--ink)",
            borderRadius: 4,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------- NOTES ------------------------------- */
function Notes({ result, sized, onClose, onAgain }) {
  const [tab, setTab] = useState("summary");
  const drag = useWindowDrag();
  const notes = result?.notes || {};
  const segments = result?.segments || [];
  const actions = notes.actions || [];

  return (
    <motion.div
      layout={!sized}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8 }}
      transition={soft}
      style={sized ? { display: "flex", flexDirection: "column", height: "100%" } : undefined}
    >
      <div className="drag" onMouseDown={drag} style={{ ...headerBase, cursor: "grab" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ fontSize: 15 }}>✦</span>
          <div style={{ minWidth: 0 }}>
            <div className="display" style={{ fontSize: 16, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: sized ? 420 : 240 }}>
              {notes.title || "Meeting notes"}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 600 }}>
              Saved locally · {speakerCount(segments)} speaker{speakerCount(segments) === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={iconBtn} title="Close">×</button>
      </div>

      <div style={{ display: "flex", gap: 4, padding: "2px 14px 8px" }}>
        {[["summary", "Notes"], ["actions", `Actions`], ["agenda", "Agenda"], ["transcript", "Transcript"]].map(([k, label]) => (
          <button key={k} className="no-drag" onClick={() => setTab(k)} style={tabBtn(tab === k)}>
            {label}{k === "actions" && actions.length ? <span style={tabBadge(tab === k)}>{actions.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="soft-scroll" style={sized ? { flex: 1, overflowY: "auto", padding: "0 20px 14px" } : { maxHeight: 300, overflowY: "auto", padding: "0 20px 14px" }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            {tab === "summary" && <SummaryTab notes={notes} />}
            {tab === "actions" && <ActionsTab actions={actions} />}
            {tab === "agenda" && <AgendaTab agenda={notes.agenda || []} />}
            {tab === "transcript" && <TranscriptTab segments={segments} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "8px 18px 16px", borderTop: "2px solid var(--ink)" }}>
        <button className="no-drag" onClick={onAgain} style={{ ...ghostBtn, flex: 1 }}>New note</button>
        <button className="no-drag" onClick={() => copyNotes(notes, segments)} style={{ ...primaryBtn, flex: 1.3 }}>Copy notes</button>
      </div>
    </motion.div>
  );
}

/* --------------------------- FULL APP WINDOW --------------------------- */
function FullApp({ result, onRestore, onMinimize, onClose, onAgain }) {
  const [tab, setTab] = useState("summary");
  const drag = useWindowDrag();
  const notes = result?.notes || {};
  const segments = result?.segments || [];
  const actions = notes.actions || [];
  const hasContent = !!(segments.length || notes.summary || actions.length || (notes.agenda || []).length || (notes.notes || []).length);

  const nav = [
    ["summary", "Notes"],
    ["actions", `Action items`],
    ["agenda", "Agenda"],
    ["transcript", "Transcript"],
  ];

  return (
    <div className="full">
      {/* title bar */}
      <div className="drag" onMouseDown={drag}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 12px 16px", borderBottom: "2px solid var(--ink)", cursor: "grab" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Dot size={18} />
          <span className="display" style={{ fontSize: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {notes.title || "Notify"}
          </span>
          {hasContent && (
            <span style={{ fontSize: 11.5, color: "var(--ink-soft)", whiteSpace: "nowrap", fontWeight: 600 }}>
              · saved locally · {speakerCount(segments)} speaker{speakerCount(segments) === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={onMinimize} style={winBtn} title="Minimize">–</button>
          <button onClick={onRestore} style={winBtn} title="Shrink back to pill">⤡</button>
          <button onClick={onClose} style={winBtn} title="Close">×</button>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* sidebar */}
        <div style={{ width: 184, borderRight: "2px solid var(--ink)", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {nav.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={navBtn(tab === k)}>
              <span>{label}</span>
              {k === "actions" && actions.length ? <span style={tabBadge(tab === k)}>{actions.length}</span> : null}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={onAgain} style={{ ...navBtn(false), justifyContent: "flex-start", gap: 8 }}>
            <Dot size={14} /> New note
          </button>
          <button onClick={() => copyNotes(notes, segments)} style={{ ...primaryBtn, padding: "10px 14px", fontSize: 13 }}>
            Copy notes
          </button>
        </div>

        {/* content */}
        <div className="soft-scroll" style={{ flex: 1, overflowY: "auto", padding: "26px 32px" }}>
          <div style={{ maxWidth: 620 }}>
            {!hasContent ? (
              <div style={{ paddingTop: 30 }}>
                <h2 className="display" style={{ fontSize: 30, marginBottom: 12 }}>No notes yet.</h2>
                <p style={{ fontSize: 15, color: "var(--ink-soft)", lineHeight: 1.55, maxWidth: 380, marginBottom: 22 }}>
                  Shrink back to the pill, hit <b>Start listening</b>, and your notes,
                  action items and transcript will land right here.
                </p>
                <button onClick={onRestore} style={{ ...primaryBtn, width: "auto", display: "inline-flex", padding: "12px 22px" }}>
                  ⤡ Back to the pill
                </button>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                  <h2 className="display" style={{ fontSize: 27, marginBottom: 18 }}>
                    {nav.find(([k]) => k === tab)[1]}
                  </h2>
                  {tab === "summary" && <SummaryTab notes={notes} />}
                  {tab === "actions" && <ActionsTab actions={actions} />}
                  {tab === "agenda" && <AgendaTab agenda={notes.agenda || []} />}
                  {tab === "transcript" && <TranscriptTab segments={segments} />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTab({ notes }) {
  const empty = !notes.summary && !(notes.notes || []).length;
  if (empty) return <Empty text="No summary was produced." />;
  return (
    <div>
      {notes.summary && <p style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>{notes.summary}</p>}
      {(notes.notes || []).length > 0 && <>
        <Label>Key points</Label>
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
          {notes.notes.map((n, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, ...soft }}
              style={{ display: "flex", gap: 9, fontSize: 13, lineHeight: 1.45 }}>
              <span style={{ color: "var(--terracotta)" }}>—</span>{n}
            </motion.li>
          ))}
        </ul>
      </>}
      {(notes.decisions || []).length > 0 && <>
        <Label>Decisions</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {notes.decisions.map((d, i) => (
            <div key={i} style={{ fontSize: 13, background: "var(--cream-deep)", borderRadius: 12, padding: "8px 12px", lineHeight: 1.4 }}>{d}</div>
          ))}
        </div>
      </>}
    </div>
  );
}

function ActionsTab({ actions }) {
  if (!actions.length) return <Empty text="No action items were found." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 2 }}>
      {actions.map((a, i) => <ActionRow key={i} a={a} i={i} />)}
    </div>
  );
}
function ActionRow({ a, i }) {
  const [done, setDone] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, ...soft }}
      style={{ display: "flex", gap: 11, alignItems: "flex-start", background: "var(--panel)", border: "2px solid var(--ink)", borderRadius: 10, padding: "11px 13px" }}>
      <button className="no-drag" onClick={() => setDone((d) => !d)}
        style={{ width: 19, height: 19, borderRadius: 6, border: `1.5px solid ${done ? "var(--sage)" : "var(--line)"}`, background: done ? "var(--sage)" : "transparent", color: "#fff", fontSize: 11, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {done ? "✓" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.4, textDecoration: done ? "line-through" : "none", opacity: done ? 0.5 : 1 }}>{a.text}</div>
        {(a.owner || a.due) && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
            {a.owner && <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{a.owner}</span>}
            {a.due && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink)", background: "var(--yellow)", border: "1.5px solid var(--ink)", padding: "1px 7px", borderRadius: 6 }}>{a.due}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AgendaTab({ agenda }) {
  if (!agenda.length) return <Empty text="No agenda was detected." />;
  return (
    <div style={{ paddingTop: 2 }}>
      {agenda.map((a, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i, ...soft }}
          style={{ display: "flex", gap: 11, paddingBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--terracotta)", marginTop: 4 }} />
            {i < agenda.length - 1 && <span style={{ width: 1.5, flex: 1, background: "var(--line)", marginTop: 4 }} />}
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{a.topic}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>{a.detail}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function TranscriptTab({ segments }) {
  if (!segments.length) return <Empty text="No transcript." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
      {segments.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
          <Avatar n={s.speaker} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: speakerColor(s.speaker), marginBottom: 2 }}>Speaker {s.speaker}</div>
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>{s.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ ERROR ------------------------------ */
function ErrorView({ message, onBack }) {
  return (
    <Panel onClose={onBack}>
      <Header title="Hmm" onClose={onBack} />
      <div style={{ padding: "2px 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 16 }}>{message}</p>
        <button className="no-drag" onClick={onBack} style={primaryBtn}>Try again</button>
      </div>
    </Panel>
  );
}

/* ----------------------------- PRIMITIVES ----------------------------- */
function Panel({ children, onClose }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={soft}>
      {children}
    </motion.div>
  );
}
function Header({ title, onClose, onExpand }) {
  const drag = useWindowDrag();
  return (
    <div className="drag" onMouseDown={drag} style={{ ...headerBase, cursor: "grab" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Dot size={20} />
        <span className="display" style={{ fontSize: 17 }}>{title}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {onExpand && <button onClick={onExpand} style={iconBtn} title="Expand to full window">⤢</button>}
        <button onClick={onClose} style={iconBtn}>×</button>
      </div>
    </div>
  );
}
function Avatar({ n }) {
  const c = speakerColor(n);
  return (
    <span style={{ width: 24, height: 24, borderRadius: 99, background: `${c}1f`, color: c, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: `1px solid ${c}33` }}>
      {speakerInitials(n)}
    </span>
  );
}
function Dot({ size = 24, live, pulse }) {
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {(live || pulse) && (
        <motion.span animate={{ scale: [1, 1.7], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--yellow)" }} />
      )}
      <motion.span animate={live ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: size * 0.64, height: size * 0.64, borderRadius: 99, background: live ? "var(--yellow)" : "var(--mint-deep)", border: "2px solid var(--ink)" }} />
    </span>
  );
}
function Label({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 9 }}>{children}</div>;
}
function Empty({ text }) {
  return <div style={{ fontSize: 13, color: "var(--ink-faint)", padding: "18px 0", textAlign: "center" }}>{text}</div>;
}

/* ------------------------------ helpers ------------------------------ */
// Encode Float32 PCM samples into a 16-bit mono WAV ArrayBuffer (no Blob needed).
function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}
function fmt(s) { const m = Math.floor(s / 60); const x = Math.floor(s % 60); return `${m}:${String(x).padStart(2, "0")}`; }
function speakerCount(segs) { return new Set((segs || []).map((s) => s.speaker)).size || 1; }
function pickMime() {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return { mimeType: t };
  }
  return {};
}
function copyNotes(notes, segments) {
  const lines = [];
  lines.push(notes.title || "Meeting notes", "");
  if (notes.summary) lines.push(notes.summary, "");
  if ((notes.notes || []).length) { lines.push("KEY POINTS"); notes.notes.forEach((n) => lines.push("- " + n)); lines.push(""); }
  if ((notes.actions || []).length) { lines.push("ACTION ITEMS"); notes.actions.forEach((a) => lines.push(`- ${a.text}${a.owner ? ` (@${a.owner})` : ""}${a.due ? ` [${a.due}]` : ""}`)); lines.push(""); }
  if ((notes.decisions || []).length) { lines.push("DECISIONS"); notes.decisions.forEach((d) => lines.push("- " + d)); }
  navigator.clipboard?.writeText(lines.join("\n"));
}

/* -------------------------------- styles -------------------------------- */
const headerBase = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 14px 12px 16px", borderBottom: "2px solid var(--ink)" };
const primaryBtn = { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: 10, border: "2px solid var(--ink)", background: "var(--ink)", color: "var(--paper)", fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" };
const ghostBtn = { display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 16px", borderRadius: 10, border: "2px solid var(--ink)", background: "var(--panel)", color: "var(--ink)", fontSize: 13, fontWeight: 700 };
const iconBtn = { width: 26, height: 26, borderRadius: 8, border: "2px solid var(--ink)", background: "var(--panel)", color: "var(--ink)", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 };
const winBtn = { width: 26, height: 26, borderRadius: 8, border: "2px solid var(--ink)", background: "var(--panel)", color: "var(--ink)", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 };
const navBtn = (a) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: 8, border: a ? "2px solid var(--ink)" : "2px solid transparent", background: a ? "var(--ink)" : "transparent", color: a ? "var(--paper)" : "var(--ink)", fontSize: 13, fontWeight: 700, textAlign: "left", width: "100%" });
const tabBtn = (a) => ({ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 7, border: "2px solid var(--ink)", background: a ? "var(--ink)" : "var(--panel)", color: a ? "var(--paper)" : "var(--ink)", fontSize: 12, fontWeight: 700 });
const tabBadge = (a) => ({ fontSize: 10, fontWeight: 800, background: a ? "var(--yellow)" : "var(--yellow)", color: "var(--ink)", borderRadius: 6, padding: "1px 5px" });
