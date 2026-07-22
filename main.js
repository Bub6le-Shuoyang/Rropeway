const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_PROJECT, clone, normalizeProject } = require('./project-format');
const { createProjectLocation, isManagedProjectFolder, isProjectFilePath, projectDirectory } = require('./project-storage');
const { collectAssetReferences } = require('./asset-references');

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
async function writeProjectFile(target, data) {
  const normalized = { ...normalizeProject(data), updatedAt: new Date().toISOString() };
  const tempPath = `${target}.${process.pid}.tmp`;
  const backupPath = `${target}.backup`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), 'utf8');
  try { await fs.copyFile(target, backupPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rm(target, { force: true });
  await fs.rename(tempPath, target);
  rendererDirty = false;
  return { filePath: target, data: normalized };
}
async function nextProjectLocation(parentDirectory, title) {
  let location = createProjectLocation(parentDirectory, title);
  let suffix = 2;
  while (true) {
    try { await fs.access(location.folderPath); location = createProjectLocation(parentDirectory, title, suffix); suffix += 1; }
    catch (error) { if (error.code === 'ENOENT') return location; throw error; }
  }
}
async function organizeProjectStorage(filePath, data) {
  if (!isProjectFilePath(filePath)) throw new Error('项目路径无效');
  const normalized = normalizeProject(data);
  if (isManagedProjectFolder(filePath)) return { filePath, data: normalized, migrated: false };
  const sourceDirectory = projectDirectory(filePath);
  const location = await nextProjectLocation(sourceDirectory, normalized.title);
  let result;
  try {
    for (const relativePath of collectAssetReferences(normalized)) {
      const source = projectAssetPath(filePath, relativePath);
      const destination = path.resolve(location.folderPath, relativePath);
      if (!isInside(location.folderPath, destination)) throw new Error('素材路径不在项目目录内');
      try {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try {
      await fs.mkdir(location.folderPath, { recursive: true });
      await fs.copyFile(`${filePath}.backup`, `${location.filePath}.backup`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    result = await writeProjectFile(location.filePath, normalized);
  } catch (error) {
    await fs.rm(location.folderPath, { recursive: true, force: true });
    throw error;
  }
  const cleanupErrors = [];
  for (const target of [filePath, `${filePath}.backup`]) {
    try { await fs.rm(target, { force: true }); }
    catch (error) { cleanupErrors.push(error.message); }
  }
  return { ...result, previousFilePath: filePath, migrated: true, cleanupIncomplete: cleanupErrors.length > 0 };
}
async function importAssetFiles(projectPath, imageOnly = false) {
  if (!projectPath) throw new Error('请先保存项目，再导入素材');
  const extensions = imageOnly ? ['png', 'jpg', 'jpeg', 'webp', 'gif'] : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg'];
  const result = await dialog.showOpenDialog(mainWindow, { title: imageOnly ? '选择分段图片' : '导入本地素材', properties: ['openFile', 'multiSelections'], filters: [{ name: imageOnly ? '图片' : '图片与音频', extensions }] });
  if (result.canceled) return [];
  const imported = [];
  for (const source of result.filePaths) {
    const extension = path.extname(source).slice(1).toLowerCase();
    const assetKind = ['mp3', 'wav', 'ogg'].includes(extension) ? 'audio' : 'images';
    const assetDir = path.join(path.dirname(projectPath), 'assets', assetKind);
    await fs.mkdir(assetDir, { recursive: true });
    const safeName = `${crypto.randomUUID()}-${path.basename(source).replace(/[^\w.\-\u4e00-\u9fff]/g, '_')}`;
    await fs.copyFile(source, path.join(assetDir, safeName));
    const relativePath = path.join('assets', assetKind, safeName).replaceAll('\\', '/');
    imported.push({ id: crypto.randomUUID(), name: path.basename(source), fileName: relativePath, relativePath, type: extension });
  }
  return imported;
}
async function trashIfExists(target) {
  try { await fs.stat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await shell.trashItem(target);
}
ipcMain.handle('project:new', () => ({ filePath: null, data: clone(DEFAULT_PROJECT) }));
ipcMain.handle('project:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '选择项目保存位置', properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('project:create', async (_event, payload) => {
  const title = String(payload?.title || '').trim();
  const directory = String(payload?.directory || '').trim();
  if (!title) throw new Error('请输入项目名称');
  if (!directory) throw new Error('请选择项目保存位置');
  const location = await nextProjectLocation(directory, title);
  return writeProjectFile(location.filePath, { ...clone(DEFAULT_PROJECT), title, description: String(payload?.description || '').trim() });
});
ipcMain.handle('project:delete', async (_event, filePath) => {
  if (!isProjectFilePath(filePath)) throw new Error('项目路径无效');
  if (isManagedProjectFolder(filePath)) {
    await trashIfExists(projectDirectory(filePath));
    return true;
  }
  const targets = [path.join(path.dirname(filePath), 'assets'), `${filePath}.backup`, filePath];
  for (const target of targets) await trashIfExists(target);
  return true;
});
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('project:exists', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return false;
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
});
ipcMain.handle('project:open', async () => {
  const filePath = await chooseProject();
  if (!filePath) return null;
  try {
    const data = normalizeProject(JSON.parse(await fs.readFile(filePath, 'utf8')));
    return { filePath, data };
  } catch (error) { throw new Error(`项目文件无法读取：${error.message}`); }
});
ipcMain.handle('project:open-path', async (_event, filePath) => {
  if (!isProjectFilePath(filePath)) throw new Error('项目路径无效');
  try { return { filePath, data: normalizeProject(JSON.parse(await fs.readFile(filePath, 'utf8'))) }; }
  catch (error) { throw new Error(`项目文件无法读取：${error.message}`); }
});
ipcMain.handle('project:save', async (_event, payload) => {
  const data = normalizeProject(payload?.data);
  let target = payload?.filePath;
  if (target && !isManagedProjectFolder(target)) return organizeProjectStorage(target, data);
  if (!target) {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择项目保存位置', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const location = await nextProjectLocation(result.filePaths[0], data.title);
    target = location.filePath;
  }
  if (!target.toLowerCase().endsWith('.scriptroom')) target += '.scriptroom';
  return writeProjectFile(target, data);
});
ipcMain.handle('project:organize-storage', async (_event, payload) => organizeProjectStorage(payload?.filePath, payload?.data));
ipcMain.handle('asset:import', async (_event, { projectPath }) => {
  return importAssetFiles(projectPath, false);
});
ipcMain.handle('asset:import-images', async (_event, { projectPath }) => importAssetFiles(projectPath, true));
ipcMain.handle('asset:delete', async (_event, { projectPath, relativePath }) => {
  const normalizedPath = String(relativePath || '').replaceAll('\\', '/');
  if (!normalizedPath.startsWith('assets/')) throw new Error('只允许删除项目素材目录中的文件');
  await trashIfExists(projectAssetPath(projectPath, normalizedPath));
  return true;
});
ipcMain.handle('asset:read', async (_event, { projectPath, relativePath }) => {
  const filePath = projectAssetPath(projectPath, relativePath);
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  return `data:${mime};base64;${(await fs.readFile(filePath)).toString('base64')}`.replace('base64;', 'base64,');
});
ipcMain.handle('shell:show-item', async (_event, { projectPath, relativePath }) => shell.showItemInFolder(projectAssetPath(projectPath, relativePath)));
ipcMain.handle('shell:open-project-folder', async (_event, filePath) => {
  const directory = projectDirectory(filePath);
  try { if (!(await fs.stat(directory)).isDirectory()) throw new Error('项目文件夹不存在'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('项目文件夹不存在'); throw error; }
  const openError = await shell.openPath(directory);
  if (openError) throw new Error(`无法打开项目文件夹：${openError}`);
  return directory;
});
ipcMain.on('window:set-dirty', (_event, dirty) => { rendererDirty = Boolean(dirty); });
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); });
ipcMain.on('window:close', () => mainWindow.close());
ipcMain.on('window:close-result', (_event, result) => { if (result === 'saved' || result === 'discard') { closing = true; mainWindow.close(); } });
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
