const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scriptroom', {
  newProject: () => ipcRenderer.invoke('project:new'),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  importAssets: (projectPath) => ipcRenderer.invoke('asset:import', { projectPath }),
  readAsset: (filePath) => ipcRenderer.invoke('asset:read', filePath),
  showItem: (filePath) => ipcRenderer.invoke('shell:show-item', filePath)
});