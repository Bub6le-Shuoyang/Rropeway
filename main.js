const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

let mainWindow;

const defaultProject = {
  format: 'scriptroom-project',
  version: 1,
  title: '《雾港来信》',
  chapters: [
    {
      id: 'chapter-1', title: '潮汐之后', status: '进行中',
      scenes: [{ id: 'scene-4', number: '04', title: '灯塔边', blocks: [
        { type: 'narration', text: '暮色沉入海面。灯塔的光一圈圈扫过潮湿的石阶，远处传来汽笛声。' },
        { type: 'dialogue', character: '沈知微', characterKey: 'mei', emotion: '克制', voice: '女声 · 轻', text: '你还是来了。', note: '语气不要有责备，更像是早就知道他会出现。' },
        { type: 'dialogue', character: '顾言川', characterKey: 'yan', emotion: '迟疑', voice: '男声 · 低', text: '我以为你不会再等我。' },
        { type: 'choice', title: '知微会怎么回答？', options: ['“我只是在等一个解释。”', '“这里风太大了，我先走了。”'] }
      ] }]
    }
  ],
  characters: [],
  assets: [],
  updatedAt: new Date().toISOString()
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 700,
    backgroundColor: '#fffaf5',
    title: 'Scriptroom · 游戏对话脚本工作台',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function chooseProjectPath(mode) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: mode === 'open' ? '打开 Scriptroom 项目' : '选择项目目录',
    properties: mode === 'open' ? ['openFile'] : ['openDirectory'],
    filters: mode === 'open' ? [{ name: 'Scriptroom 项目', extensions: ['scriptroom', 'json'] }] : undefined
  });
  return result.canceled ? null : result.filePaths[0];
}

ipcMain.handle('project:new', () => ({ filePath: null, data: structuredClone(defaultProject) }));
ipcMain.handle('project:open', async () => {
  const filePath = await chooseProjectPath('open');
  if (!filePath) return null;
  try { return { filePath, data: JSON.parse(await fs.readFile(filePath, 'utf8')) }; }
  catch (error) { throw new Error(`项目文件无法读取：${error.message}`); }
});
ipcMain.handle('project:save', async (_event, { filePath, data }) => {
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow, { title: '保存 Scriptroom 项目', defaultPath: `${data.title || '未命名项目'}.scriptroom`, filters: [{ name: 'Scriptroom 项目', extensions: ['scriptroom'] }] });
    if (result.canceled) return null;
    target = result.filePath;
  }
  const normalized = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeFile(target, JSON.stringify(normalized, null, 2), 'utf8');
  return { filePath: target, data: normalized };
});
ipcMain.handle('asset:import', async (_event, { projectPath }) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '导入本地素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与音频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg'] }] });
  if (result.canceled) return [];
  const baseDir = projectPath ? path.dirname(projectPath) : app.getPath('documents');
  const assetDir = path.join(baseDir, 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  const imported = [];
  for (const source of result.filePaths) {
    const safeName = `${crypto.randomUUID()}-${path.basename(source).replace(/[^\w.\-\u4e00-\u9fff]/g, '_')}`;
    const destination = path.join(assetDir, safeName);
    await fs.copyFile(source, destination);
    imported.push({ id: crypto.randomUUID(), name: path.basename(source), fileName: safeName, type: path.extname(source).slice(1).toLowerCase(), path: destination });
  }
  return imported;
});
ipcMain.handle('asset:read', async (_event, filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extension];
  if (!mime) return null;
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
});
ipcMain.handle('shell:show-item', (_event, filePath) => shell.showItemInFolder(filePath));

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });