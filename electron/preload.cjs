const { contextBridge, ipcRenderer } = require("electron");

const api = {
  resize: (width, height) => ipcRenderer.send("resize", { width, height }),
  resizeTo: (w, h) => ipcRenderer.send("resize-to", { w, h }),
  setPos: (x, y) => ipcRenderer.send("set-pos", { x, y }),
  setMode: (mode) => ipcRenderer.send("set-mode", mode),
  minimize: () => ipcRenderer.send("minimize"),
  quit: () => ipcRenderer.send("quit"),
  micPermission: () => ipcRenderer.invoke("mic-permission"),
  processAudio: (arrayBuffer) => ipcRenderer.invoke("process-audio", arrayBuffer),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("process-progress", handler);
    return () => ipcRenderer.removeListener("process-progress", handler);
  },
};

contextBridge.exposeInMainWorld("notify", api);
