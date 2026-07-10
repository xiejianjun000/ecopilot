const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ecopilot', {
  // Platform detection
  platform: process.platform,
  isElectron: true,

  // Backend health check
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),

  // Open URL in default browser (not in Electron)
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
