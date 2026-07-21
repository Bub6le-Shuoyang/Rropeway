const navItems = document.querySelectorAll('.nav-item');
const views = { editor: document.getElementById('editorView'), characters: document.getElementById('charactersView'), assets: document.getElementById('assetsView') };
const toast = document.getElementById('toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

navItems.forEach((item) => item.addEventListener('click', () => {
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  Object.values(views).forEach((view) => view.classList.add('hidden'));
  views[item.dataset.view].classList.remove('hidden');
}));

document.querySelectorAll('.chapter').forEach((chapter) => chapter.addEventListener('click', () => {
  document.querySelectorAll('.chapter').forEach((item) => item.classList.toggle('active', item === chapter));
  showToast(`已切换至${chapter.querySelector('b').textContent}`);
}));

document.querySelectorAll('.scene-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.scene-tab').forEach((item) => item.classList.toggle('active', item === tab));
  showToast(`已打开场景 ${tab.textContent.trim()}`);
}));

document.querySelectorAll('.tag').forEach((tag) => tag.addEventListener('click', () => {
  document.querySelectorAll('.tag').forEach((item) => item.classList.remove('active'));
  tag.classList.add('active');
}));

document.getElementById('addChapter').addEventListener('click', () => showToast('新章节入口已准备好'));

document.getElementById('addDialogue').addEventListener('click', () => {
  const block = document.createElement('div');
  block.className = 'script-block dialogue selected';
  block.innerHTML = '<div class="block-handle">⠿</div><div class="character-thumb mei">沈</div><div class="block-content"><div class="dialogue-meta"><span class="character-name mei-name">沈知微</span><span class="emotion-pill">克制</span></div><p contenteditable="true">点击这里开始输入对白…</p></div><button class="block-more">•••</button>';
  document.querySelector('.add-block').before(block);
  block.querySelector('[contenteditable]').focus();
  showToast('已添加一条对白');
});

const modal = document.getElementById('previewModal');
document.getElementById('previewBtn').addEventListener('click', () => modal.classList.remove('hidden'));
document.getElementById('closePreview').addEventListener('click', () => modal.classList.add('hidden'));
modal.querySelector('.modal-backdrop').addEventListener('click', () => modal.classList.add('hidden'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') modal.classList.add('hidden'); });

document.querySelectorAll('.choices button, .preview-options button').forEach((button) => button.addEventListener('click', () => showToast('已记录这个分支选择')));

// Electron desktop integration: all project data stays on the local machine.
const desktopApi = window.scriptroom;
let desktopState = { filePath: null, data: null, dirty: false };
let editHistory = [];
let historyIndex = -1;

function setSaveStatus(status, time = '') {
  const statusNode = document.getElementById('saveStatus');
  const timeNode = document.getElementById('saveTime');
  if (statusNode) statusNode.textContent = status;
  if (timeNode) timeNode.textContent = time;
}

function markDirty() {
  desktopState.dirty = true;
  setSaveStatus('有未保存修改', '现在');
}

function currentSceneBlocks() {
  return [...document.querySelectorAll('.script-canvas .script-block')].map((block) => {
    if (block.classList.contains('narration')) return { type: 'narration', text: block.querySelector('.block-content p')?.textContent.trim() || '' };
    if (block.classList.contains('choice-block')) return { type: 'choice', title: block.querySelector('.choice-title')?.textContent.trim() || '', options: [...block.querySelectorAll('.choices button')].map((item) => item.textContent.replace('→', '').trim()) };
    return { type: 'dialogue', character: block.querySelector('.character-name')?.textContent.trim() || '未命名角色', characterKey: block.querySelector('.character-thumb')?.classList.contains('yan') ? 'yan' : 'mei', emotion: block.querySelector('.emotion-pill')?.textContent.trim() || '', voice: block.querySelector('.voice-pill')?.textContent.trim() || '', text: block.querySelector('.block-content p')?.textContent.trim() || '', note: block.querySelector('.block-note')?.textContent.replace(/^注：/, '').trim() || '' };
  });
}

function captureProject() {
  const data = desktopState.data || { format: 'scriptroom-project', version: 1, chapters: [], characters: [], assets: [] };
  data.title = document.getElementById('workspaceTitle')?.textContent.trim() || data.title || '未命名项目';
  data.chapters = data.chapters?.length ? data.chapters : [{ id: 'chapter-1', title: document.querySelector('.script-heading h1')?.textContent.trim() || '第一章', status: '进行中', scenes: [] }];
  data.chapters[0].title = document.querySelector('.script-heading h1')?.textContent.trim() || data.chapters[0].title;
  data.chapters[0].scenes = data.chapters[0].scenes?.length ? data.chapters[0].scenes : [{ id: 'scene-1', number: '04', title: '灯塔边', blocks: [] }];
  data.chapters[0].scenes[0].blocks = currentSceneBlocks();
  return data;
}

function applyProject(data) {
  desktopState.data = data;
  const title = data.title || '未命名项目';
  const chapter = data.chapters?.[0];
  const scene = chapter?.scenes?.[0];
  const titleNode = document.getElementById('workspaceTitle');
  const headingNode = document.querySelector('.script-heading h1');
  const breadcrumbNode = document.querySelector('.breadcrumb strong');
  if (titleNode) titleNode.textContent = title;
  if (headingNode && chapter) headingNode.textContent = chapter.title;
  if (breadcrumbNode && chapter) breadcrumbNode.textContent = `第一章 · ${chapter.title}`;
  if (scene) {
    const textNodes = [...document.querySelectorAll('.script-canvas .script-block')];
    scene.blocks.forEach((item, index) => {
      const block = textNodes[index];
      if (!block) return;
      if (item.type === 'choice') {
        const choiceTitle = block.querySelector('.choice-title');
        if (choiceTitle) choiceTitle.textContent = item.title || '';
        [...block.querySelectorAll('.choices button')].forEach((button, optionIndex) => { if (item.options?.[optionIndex]) button.firstChild.textContent = item.options[optionIndex]; });
      } else {
        const textNode = block.querySelector('.block-content p');
        if (textNode) textNode.textContent = item.text || '';
      }
    });
  }
  renderChapters(data.chapters || []);
  renderImportedAssets(data.assets || []);
  desktopState.dirty = false;
  setSaveStatus('已打开本地项目', '刚刚');
}

function snapshotText() { return [...document.querySelectorAll('[contenteditable="true"]')].map((node) => node.textContent); }
function restoreText(snapshot) { document.querySelectorAll('[contenteditable="true"]').forEach((node, index) => { if (snapshot[index] !== undefined) node.textContent = snapshot[index]; }); markDirty(); }
function pushHistory() { const snapshot = snapshotText(); editHistory = editHistory.slice(0, historyIndex + 1); editHistory.push(snapshot); historyIndex = editHistory.length - 1; if (editHistory.length > 40) { editHistory.shift(); historyIndex -= 1; } }

function renderImportedAssets(assets) {
  const grid = document.querySelector('.asset-grid');
  if (!grid || !assets.length) return;
  assets.forEach((asset) => {
    const card = document.createElement('div');
    card.className = 'asset-card imported-asset';
    card.innerHTML = `<span>${asset.type === 'mp3' || asset.type === 'wav' || asset.type === 'ogg' ? '音效' : '图片'}</span><b>${asset.name}</b>`;
    card.title = asset.path;
    card.addEventListener('dblclick', () => desktopApi?.showItem(asset.path));
    grid.appendChild(card);
  });
}

async function saveProject() {
  if (!desktopApi) { showToast('请在 Electron 桌面应用中保存项目'); return; }
  try {
    const result = await desktopApi.saveProject({ filePath: desktopState.filePath, data: captureProject() });
    if (!result) return;
    desktopState.filePath = result.filePath;
    desktopState.data = result.data;
    desktopState.dirty = false;
    setSaveStatus('已保存到本地', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    showToast('项目已保存');
  } catch (error) { showToast(error.message || '保存失败'); }
}

async function openProject() {
  if (!desktopApi) return;
  try {
    const result = await desktopApi.openProject();
    if (!result) return;
    desktopState.filePath = result.filePath;
    applyProject(result.data);
    showToast('项目已打开');
  } catch (error) { showToast(error.message || '打开失败'); }
}

async function newProject() {
  if (desktopState.dirty && !window.confirm('当前项目有未保存修改，确定新建项目吗？')) return;
  if (!desktopApi) return;
  const result = await desktopApi.newProject();
  desktopState.filePath = null;
  applyProject(result.data);
  setSaveStatus('新项目未保存', '—');
  showToast('已新建空白项目');
}

async function importAssets() {
  if (!desktopApi) return;
  if (!desktopState.filePath) {
    await saveProject();
    if (!desktopState.filePath) return;
  }
  try {
    const assets = await desktopApi.importAssets(desktopState.filePath);
    if (!assets.length) return;
    desktopState.data.assets = [...(desktopState.data.assets || []), ...assets];
    renderImportedAssets(assets);
    markDirty();
    showToast(`已导入 ${assets.length} 个素材`);
  } catch (error) { showToast(error.message || '素材导入失败'); }
}

document.getElementById('newProjectBtn')?.addEventListener('click', newProject);
document.getElementById('openProjectBtn')?.addEventListener('click', openProject);
document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject);
document.getElementById('importAssetsBtn')?.addEventListener('click', importAssets);
document.querySelectorAll('[contenteditable="true"]').forEach((node) => node.addEventListener('input', () => { pushHistory(); markDirty(); }));
document.querySelector('[title="撤销"]')?.addEventListener('click', () => { if (historyIndex > 0) { historyIndex -= 1; restoreText(editHistory[historyIndex]); } });
document.querySelector('[title="重做"]')?.addEventListener('click', () => { if (historyIndex < editHistory.length - 1) { historyIndex += 1; restoreText(editHistory[historyIndex]); } });
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
  if (event.key.toLowerCase() === 'o') { event.preventDefault(); openProject(); }
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); newProject(); }
});

if (desktopApi) {
  desktopApi.newProject().then((result) => { applyProject(result.data); renderChapters(result.data.chapters); setSaveStatus('本地新项目', '未保存'); });
} else {
  setSaveStatus('浏览器预览模式', '—');
}
editHistory = [snapshotText()];
historyIndex = 0;
function renderChapters(chapters) {
  const list = document.getElementById('chapterList');
  if (!list || !chapters?.length) return;
  list.innerHTML = '';
  chapters.forEach((chapter, index) => {
    const button = document.createElement('button');
    button.className = `chapter${index === 0 ? ' active' : ''}`;
    button.innerHTML = `<span class="chapter-number">${String(index + 1).padStart(2, '0')}</span><span><b>${chapter.title || `第 ${index + 1} 章`}</b><small>${chapter.scenes?.length || 0} 个场景 · ${chapter.status || '草稿'}</small></span>`;
    button.addEventListener('click', () => { document.querySelectorAll('.chapter').forEach((item) => item.classList.toggle('active', item === button)); });
    list.appendChild(button);
  });
}

document.getElementById('addChapter')?.addEventListener('click', () => {
  if (!desktopState.data) return;
  const index = (desktopState.data.chapters || []).length + 1;
  desktopState.data.chapters = [...(desktopState.data.chapters || []), { id: `chapter-${Date.now()}`, title: `未命名章节 ${index}`, status: '草稿', scenes: [] }];
  renderChapters(desktopState.data.chapters);
  markDirty();
  showToast('已添加新章节');
});