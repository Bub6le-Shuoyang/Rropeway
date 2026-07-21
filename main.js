const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_PROJECT, clone, normalizeProject } = require('./project-format');

let mainWindow;
let rendererDirty = false;
let closing = false;
let closeDialogOpen = false;

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function projectAssetPath(projectPath, relativePath) {
  if (!projectPath || !relativePath) throw new Error('素材路径无效');
  const baseDir = path.dirname(projectPath);
  const candidate = path.resolve(baseDir, relativePath);
  if (!isInside(baseDir, candidate)) throw new Error('素材路径不在项目目录内');
  return candidate;
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 1024, minHeight: 700, frame: false, autoHideMenuBar: true, backgroundColor: '#fffaf5', title: 'Rropeway · 游戏对话脚本编辑器', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', async (event) => {
    if (closing || !rendererDirty || closeDialogOpen) return;
    event.preventDefault();
    closeDialogOpen = true;
    const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '项目尚未保存', message: '当前项目有未保存的修改。', buttons: ['保存并退出', '不保存退出', '取消'], defaultId: 0, cancelId: 2, noLink: true });
    closeDialogOpen = false;
    if (result.response === 0) mainWindow.webContents.send('app:before-close');
    if (result.response === 1) { closing = true; mainWindow.close(); }
  });
}
async function chooseProject() {
  const result = await dialog.showOpenDialog(mainWindow, { title: '打开 Rropeway 项目', properties: ['openFile'], filters: [{ name: 'Rropeway 项目', extensions: ['scriptroom', 'json'] }] });
  return result.canceled ? null : result.filePaths[0];
}
ipcMain.handle('project:new', () => ({ filePath: null, data: clone(DEFAULT_PROJECT) }));
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('project:open', async () => {
  const filePath = await chooseProject();
  if (!filePath) return null;
  try {
    const data = normalizeProject(JSON.parse(await fs.readFile(filePath, 'utf8')));
    return { filePath, data };
  } catch (error) { throw new Error(`项目文件无法读取：${error.message}`); }
});
ipcMain.handle('project:open-path', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !['.scriptroom', '.json'].includes(path.extname(filePath).toLowerCase())) throw new Error('项目路径无效');
  try { return { filePath, data: normalizeProject(JSON.parse(await fs.readFile(filePath, 'utf8'))) }; }
  catch (error) { throw new Error(`项目文件无法读取：${error.message}`); }
});ipcMain.handle('project:save', async (_event, payload) => {
  const data = normalizeProject(payload?.data);
  let target = payload?.filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow, { title: '保存 Rropeway 项目', defaultPath: `${data.title || 'Rropeway'}.scriptroom`, filters: [{ name: 'Rropeway 项目', extensions: ['scriptroom'] }] });
    if (result.canceled) return null;
    target = result.filePath;
  }
  if (!target.toLowerCase().endsWith('.scriptroom')) target += '.scriptroom';
  const normalized = { ...data, updatedAt: new Date().toISOString() };
  const tempPath = `${target}.${process.pid}.tmp`;
  const backupPath = `${target}.backup`;
  await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), 'utf8');
  try { await fs.copyFile(target, backupPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rm(target, { force: true });
  await fs.rename(tempPath, target);
  rendererDirty = false;
  return { filePath: target, data: normalized };
});
ipcMain.handle('asset:import', async (_event, { projectPath }) => {
  if (!projectPath) throw new Error('请先保存项目，再导入素材');
  const result = await dialog.showOpenDialog(mainWindow, { title: '导入本地素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与音频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg'] }] });
  if (result.canceled) return [];
  const assetDir = path.join(path.dirname(projectPath), 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  const imported = [];
  for (const source of result.filePaths) {
    const safeName = `${crypto.randomUUID()}-${path.basename(source).replace(/[^\w.\-\u4e00-\u9fff]/g, '_')}`;
    await fs.copyFile(source, path.join(assetDir, safeName));
    imported.push({ id: crypto.randomUUID(), name: path.basename(source), fileName: safeName, relativePath: path.join('assets', safeName).replaceAll('\\', '/'), type: path.extname(source).slice(1).toLowerCase() });
  }
  return imported;
});
ipcMain.handle('asset:read', async (_event, { projectPath, relativePath }) => {
  const filePath = projectAssetPath(projectPath, relativePath);
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64;${(await fs.readFile(filePath)).toString('base64')}`.replace('base64;', 'base64,');
});
ipcMain.handle('shell:show-item', async (_event, { projectPath, relativePath }) => shell.showItemInFolder(projectAssetPath(projectPath, relativePath)));
ipcMain.on('window:set-dirty', (_event, dirty) => { rendererDirty = Boolean(dirty); });
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); });
ipcMain.on('window:close', () => mainWindow.close());
ipcMain.on('window:close-result', (_event, result) => { if (result === 'saved' || result === 'discard') { closing = true; mainWindow.close(); } });
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
