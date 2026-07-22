const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scriptroom', {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  newProject: () => ipcRenderer.invoke('project:new'),
  projectExists: (filePath) => ipcRenderer.invoke('project:exists', filePath),
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (filePath) => ipcRenderer.invoke('project:open-path', filePath),
  chooseProjectDirectory: () => ipcRenderer.invoke('project:choose-directory'),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  deleteProject: (filePath) => ipcRenderer.invoke('project:delete', filePath),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  importAssets: (projectPath) => ipcRenderer.invoke('asset:import', { projectPath }),
  importImages: (projectPath) => ipcRenderer.invoke('asset:import-images', { projectPath }),
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
