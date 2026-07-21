const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scriptroom', {
  newProject: () => ipcRenderer.invoke('project:new'),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  importAssets: (projectPath) => ipcRenderer.invoke('asset:import', { projectPath }),
  readAsset: (projectPath, relativePath) => ipcRenderer.invoke('asset:read', { projectPath, relativePath }),
  showItem: (projectPath, relativePath) => ipcRenderer.invoke('shell:show-item', { projectPath, relativePath }),
  setDirty: (dirty) => ipcRenderer.send('window:set-dirty', dirty),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  finishClose: () => ipcRenderer.send('window:close-result', 'saved'),
  cancelClose: () => ipcRenderer.send('window:close-result', 'cancel'),
  onBeforeClose: (callback) => ipcRenderer.on('app:before-close', () => callback())
});