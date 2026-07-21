const desktopApi = window.scriptroom;
const navItems = document.querySelectorAll('.nav-item');
const views = { editor: document.getElementById('editorView'), characters: document.getElementById('charactersView'), assets: document.getElementById('assetsView') };
const toast = document.getElementById('toast');
let desktopState = { filePath: null, data: null, dirty: false };
let activeChapterIndex = 0;
let activeSceneIndex = 0;
let selectedBlockIndex = 1;
let editHistory = [];
let historyIndex = -1;

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
function setSaveStatus(status, time = '') { document.getElementById('saveStatus').textContent = status; document.getElementById('saveTime').textContent = time; }
function markDirty() { desktopState.dirty = true; desktopApi?.setDirty(true); setSaveStatus('有未保存修改', '现在'); }
function currentChapter() { return desktopState.data?.chapters?.[activeChapterIndex]; }
function currentScene() { return currentChapter()?.scenes?.[activeSceneIndex]; }
function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
function addChild(parent, tag, className, text) { const item = node(tag, className, text); parent.appendChild(item); return item; }

function captureBlocks() {
  return [...document.querySelectorAll('.script-canvas .script-block')].map((block) => {
    if (block.classList.contains('narration')) return { type: 'narration', text: block.querySelector('.block-content p')?.textContent.trim() || '' };
    if (block.classList.contains('choice-block')) return { type: 'choice', title: block.querySelector('.choice-title')?.textContent.trim() || '', options: [...block.querySelectorAll('.choices button')].map((item) => item.querySelector('.choice-text')?.textContent.trim() || '') };
    return { type: 'dialogue', character: block.querySelector('.character-name')?.textContent.trim() || '未命名角色', characterKey: block.querySelector('.character-thumb')?.classList.contains('yan') ? 'yan' : 'mei', emotion: block.querySelector('.emotion-pill')?.textContent.trim() || '', voice: block.querySelector('.voice-pill')?.textContent.trim() || '', text: block.querySelector('.block-content p')?.textContent.trim() || '', note: block.querySelector('.block-note')?.textContent.replace(/^注：/, '').trim() || '', portrait: block.dataset.portrait || undefined };
  });
}
function syncCurrentScene() { const scene = currentScene(); if (scene) scene.blocks = captureBlocks(); }
function captureProject() { syncCurrentScene(); const data = desktopState.data; data.title = document.getElementById('workspaceTitle').textContent.trim(); data.chapters[0] && (data.chapters[0].title = data.chapters[0].title || '第一章'); return data; }

function createBlockElement(block, index) {
  const wrapper = node('div', `script-block ${block.type === 'choice' ? 'choice-block' : block.type}${index === selectedBlockIndex ? ' selected' : ''}`);
  wrapper.dataset.blockIndex = String(index);
  addChild(wrapper, 'div', 'block-handle', '⠿');
  const content = node('div', 'block-content');
  if (block.type === 'narration') {
    addChild(content, 'span', 'block-type', '场景描述');
    addChild(content, 'p', '', block.text);
    const tags = addChild(content, 'div', 'block-tags'); addChild(tags, 'span', '', '氛围 · 安静'); addChild(tags, 'span', '', '镜头 · 远景');
  } else if (block.type === 'choice') {
    addChild(wrapper, 'div', 'choice-icon', '↳'); addChild(content, 'span', 'block-type', '玩家选择'); addChild(content, 'p', 'choice-title', block.title);
    const choices = addChild(content, 'div', 'choices');
    (block.options || []).forEach((option) => { const button = addChild(choices, 'button'); addChild(button, 'span', 'choice-text', option); addChild(button, 'span', '', '→'); });
  } else {
    const thumb = addChild(wrapper, 'div', `character-thumb ${block.characterKey === 'yan' ? 'yan' : 'mei'}`, (block.character || '未').slice(0, 1));
    const meta = addChild(content, 'div', 'dialogue-meta'); addChild(meta, 'span', `character-name ${block.characterKey === 'yan' ? 'yan-name' : 'mei-name'}`, block.character); addChild(meta, 'span', 'emotion-pill', block.emotion || '未设定'); addChild(meta, 'span', 'voice-pill', `♪ ${block.voice || '未设定'}`);
    addChild(content, 'p', '', block.text);
    if (block.note) addChild(content, 'div', 'block-note', `注：${block.note}`);
    if (block.portrait) wrapper.dataset.portrait = block.portrait;
    void thumb;
  }
  wrapper.appendChild(content); addChild(wrapper, 'button', 'block-more', '•••');
  wrapper.querySelectorAll('p').forEach((paragraph) => { paragraph.contentEditable = 'true'; });
  return wrapper;
}

function renderScene() {
  const scene = currentScene(); if (!scene) return;
  const canvas = document.querySelector('.script-canvas'); const addButton = document.getElementById('addDialogue');
  canvas.querySelectorAll('.script-block').forEach((block) => block.remove());
  (scene.blocks || []).forEach((block, index) => canvas.insertBefore(createBlockElement(block, index), addButton));
  selectedBlockIndex = Math.min(selectedBlockIndex, Math.max(0, (scene.blocks || []).length - 1));
  document.querySelector('.script-heading h1').textContent = scene.title;
  document.querySelector('.breadcrumb strong').textContent = `第 ${activeChapterIndex + 1} 章 · ${scene.title}`;
}
function renderSceneTabs() {
  const tabs = document.querySelector('.scene-tabs'); tabs.replaceChildren(); const scenes = currentChapter()?.scenes || [];
  scenes.forEach((scene, index) => { const button = addChild(tabs, 'button', `scene-tab${index === activeSceneIndex ? ' active' : ''}`); button.append(document.createTextNode(`${scene.number} `)); addChild(button, 'span', '', scene.title); button.addEventListener('click', () => activateScene(index)); button.addEventListener('dblclick', () => renameScene(index)); });
  const add = addChild(tabs, 'button', 'add-scene', '＋'); add.addEventListener('click', addScene);
}
function activateScene(index) { syncCurrentScene(); activeSceneIndex = index; selectedBlockIndex = 0; renderSceneTabs(); renderScene(); }
function renameScene(index) { const scene = currentChapter()?.scenes?.[index]; if (!scene) return; const title = window.prompt('场景名称', scene.title); if (title?.trim()) { scene.title = title.trim(); renderSceneTabs(); renderScene(); markDirty(); } }
function addScene() { syncCurrentScene(); const chapter = currentChapter(); chapter.scenes.push({ id: `scene-${Date.now()}`, number: String(chapter.scenes.length + 1).padStart(2, '0'), title: `未命名场景 ${chapter.scenes.length + 1}`, blocks: [] }); activeSceneIndex = chapter.scenes.length - 1; selectedBlockIndex = 0; renderSceneTabs(); renderScene(); markDirty(); showToast('已添加新场景'); }
function renderChapters() { const list = document.getElementById('chapterList'); list.replaceChildren(); (desktopState.data?.chapters || []).forEach((chapter, index) => { const button = node('button', `chapter${index === activeChapterIndex ? ' active' : ''}`); addChild(button, 'span', 'chapter-number', String(index + 1).padStart(2, '0')); const copy = addChild(button, 'span'); addChild(copy, 'b', '', chapter.title); addChild(copy, 'small', '', `${chapter.scenes.length} 个场景 · ${chapter.status}`); button.addEventListener('click', () => { syncCurrentScene(); activeChapterIndex = index; activeSceneIndex = 0; selectedBlockIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); }); button.addEventListener('dblclick', () => { const title = window.prompt('章节名称', chapter.title); if (title?.trim()) { chapter.title = title.trim(); renderChapters(); markDirty(); } }); list.appendChild(button); }); }

function renderImportedAssets() {
  const grid = document.querySelector('.asset-grid'); grid.querySelectorAll('[data-imported="true"]').forEach((item) => item.remove());
  (desktopState.data?.assets || []).forEach((asset) => {
    const card = node('div', 'asset-card imported-asset'); card.dataset.imported = 'true';
    const kind = ['mp3', 'wav', 'ogg'].includes(asset.type) ? '音效' : '图片'; addChild(card, 'span', '', kind); addChild(card, 'b', '', asset.name);
    const actions = addChild(card, 'div', 'asset-actions');
    if (kind === '图片') { const background = addChild(actions, 'button', 'asset-action', '设为背景'); background.addEventListener('click', () => bindAsset(asset, 'background')); const portrait = addChild(actions, 'button', 'asset-action', '设为立绘'); portrait.addEventListener('click', () => bindAsset(asset, 'portrait')); }
    const show = addChild(actions, 'button', 'asset-action', '打开位置'); show.addEventListener('click', () => desktopApi?.showItem(desktopState.filePath, asset.relativePath));
    if (desktopState.filePath && kind === '图片') desktopApi.readAsset(desktopState.filePath, asset.relativePath).then((src) => { if (src) card.style.backgroundImage = `linear-gradient(180deg, transparent 25%, rgba(30,35,33,.7)), url("${src}")`; }).catch(() => {});
    grid.appendChild(card);
  });
}
function bindAsset(asset, mode) { syncCurrentScene(); const scene = currentScene(); if (mode === 'background') { scene.background = asset.relativePath; showToast(`已将「${asset.name}」设为场景背景`); } else { const block = scene.blocks[selectedBlockIndex]; if (!block || block.type !== 'dialogue') { showToast('请先选择一条对白'); return; } block.portrait = asset.relativePath; document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"]`)?.setAttribute('data-portrait', asset.relativePath); showToast(`已将「${asset.name}」绑定到当前对白`); } markDirty(); }

function applyProject(data, filePath = null) { desktopState.data = data; desktopState.filePath = filePath; activeChapterIndex = 0; activeSceneIndex = 0; selectedBlockIndex = 0; document.getElementById('workspaceTitle').textContent = data.title; renderChapters(); renderSceneTabs(); renderScene(); renderImportedAssets(); desktopState.dirty = false; desktopApi?.setDirty(false); setSaveStatus(filePath ? '已打开本地项目' : '本地新项目', filePath ? '刚刚' : '未保存'); }
async function saveProject() { if (!desktopApi) return false; try { const result = await desktopApi.saveProject({ filePath: desktopState.filePath, data: captureProject() }); if (!result) return false; desktopState.filePath = result.filePath; desktopState.data = result.data; desktopState.dirty = false; desktopApi.setDirty(false); localStorage.removeItem('scriptroom-draft'); setSaveStatus('已保存到本地', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); showToast('项目已保存'); return true; } catch (error) { showToast(error.message || '保存失败'); return false; } }
async function openProject() { if (desktopState.dirty && !window.confirm('当前项目有未保存修改，确定打开另一个项目吗？')) return; try { const result = await desktopApi.openProject(); if (result) { applyProject(result.data, result.filePath); showToast('项目已打开'); } } catch (error) { showToast(error.message || '打开失败'); } }
async function newProject() { if (desktopState.dirty && !window.confirm('当前项目有未保存修改，确定新建项目吗？')) return; const result = await desktopApi.newProject(); applyProject(result.data); showToast('已新建空白项目'); }
async function importAssets() { if (!desktopState.filePath) { if (!(await saveProject())) return; } try { const assets = await desktopApi.importAssets(desktopState.filePath); if (!assets.length) return; desktopState.data.assets.push(...assets); renderImportedAssets(); markDirty(); showToast(`已导入 ${assets.length} 个素材`); } catch (error) { showToast(error.message || '素材导入失败'); } }
function updatePreview() { const scene = currentScene(); const stage = document.querySelector('.preview-scene'); const character = document.querySelector('.preview-character'); stage.style.backgroundImage = ''; character.style.backgroundImage = ''; if (scene?.background && desktopState.filePath) desktopApi.readAsset(desktopState.filePath, scene.background).then((src) => { if (src) stage.style.backgroundImage = `linear-gradient(180deg, transparent 35%, rgba(30,35,33,.55)), url("${src}")`; }).catch(() => {}); const block = scene?.blocks?.[selectedBlockIndex]; if (block?.portrait && desktopState.filePath) desktopApi.readAsset(desktopState.filePath, block.portrait).then((src) => { if (src) character.style.background = `center bottom / contain no-repeat url("${src}")`; }).catch(() => {}); }

navItems.forEach((item) => item.addEventListener('click', () => { navItems.forEach((nav) => nav.classList.toggle('active', nav === item)); Object.values(views).forEach((view) => view.classList.add('hidden')); views[item.dataset.view].classList.remove('hidden'); }));
document.addEventListener('click', (event) => { const block = event.target.closest('.script-block'); if (block) { selectedBlockIndex = Number(block.dataset.blockIndex || 0); document.querySelectorAll('.script-block').forEach((item) => item.classList.toggle('selected', item === block)); } if (event.target.closest('#addDialogue')) { syncCurrentScene(); currentScene().blocks.push({ type: 'dialogue', character: '沈知微', characterKey: 'mei', emotion: '克制', voice: '女声 · 轻', text: '点击这里开始输入对白…' }); selectedBlockIndex = currentScene().blocks.length - 1; renderScene(); document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] p`)?.focus(); markDirty(); showToast('已添加一条对白'); } });
document.addEventListener('input', (event) => { if (event.target.closest('[contenteditable="true"]')) { editHistory = editHistory.slice(0, historyIndex + 1); editHistory.push([...document.querySelectorAll('[contenteditable="true"]')].map((item) => item.textContent)); historyIndex = editHistory.length - 1; markDirty(); } });
document.querySelector('[title="撤销"]')?.addEventListener('click', () => { if (historyIndex > 0) { historyIndex -= 1; document.querySelectorAll('[contenteditable="true"]').forEach((item, index) => { item.textContent = editHistory[historyIndex][index] ?? item.textContent; }); markDirty(); } });
document.querySelector('[title="重做"]')?.addEventListener('click', () => { if (historyIndex < editHistory.length - 1) { historyIndex += 1; document.querySelectorAll('[contenteditable="true"]').forEach((item, index) => { item.textContent = editHistory[historyIndex][index] ?? item.textContent; }); markDirty(); } });
document.getElementById('addChapter')?.addEventListener('click', () => { const chapters = desktopState.data.chapters; const chapterNumber = chapters.length + 1; chapters.push({ id: `chapter-${Date.now()}`, title: `未命名章节 ${chapterNumber}`, status: '草稿', scenes: [{ id: `scene-${Date.now()}`, number: '01', title: '未命名场景', blocks: [] }] }); activeChapterIndex = chapters.length - 1; activeSceneIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); markDirty(); showToast('已添加新章节'); });
document.getElementById('newProjectBtn')?.addEventListener('click', newProject); document.getElementById('openProjectBtn')?.addEventListener('click', openProject); document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject); document.getElementById('importAssetsBtn')?.addEventListener('click', importAssets);
document.getElementById('previewBtn')?.addEventListener('click', () => { updatePreview(); document.getElementById('previewModal').classList.remove('hidden'); }); document.getElementById('closePreview')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden')); document.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden'));
document.addEventListener('keydown', (event) => { if (!(event.ctrlKey || event.metaKey)) return; const key = event.key.toLowerCase(); if (key === 's') { event.preventDefault(); saveProject(); } if (key === 'o') { event.preventDefault(); openProject(); } if (key === 'n') { event.preventDefault(); newProject(); } });
desktopApi?.onBeforeClose(async () => { const saved = await saveProject(); if (saved) desktopApi.finishClose(); else desktopApi.cancelClose(); });
setInterval(() => { if (desktopState.dirty && desktopState.data) localStorage.setItem('scriptroom-draft', JSON.stringify({ filePath: desktopState.filePath, data: captureProject(), savedAt: Date.now() })); }, 10000);
if (desktopApi) desktopApi.newProject().then((result) => { const draft = localStorage.getItem('scriptroom-draft'); if (draft && window.confirm('发现上次未保存的临时草稿，是否恢复？')) { const recovered = JSON.parse(draft); applyProject(recovered.data, recovered.filePath); markDirty(); } else { applyProject(result.data); } editHistory = [[...document.querySelectorAll('[contenteditable="true"]')].map((item) => item.textContent)]; historyIndex = 0; });

// Interactive editor layer: characters, inspector controls, drag sorting and project switcher.
let draggedBlockIndex = null;
function activeDialogueBlock() { const scene = currentScene(); const block = scene?.blocks?.[selectedBlockIndex]; return block?.type === 'dialogue' ? block : null; }
function renderInspector() {
  const body = document.querySelector('.inspector-body'); if (!body) return; body.replaceChildren();
  const block = activeDialogueBlock();
  if (!block) { addChild(body, 'div', 'inspector-empty', '选择一条对白后，可编辑角色、情绪和立绘属性。'); return; }
  const characters = desktopState.data.characters || [];
  const characterGroup = addChild(body, 'div', 'property-group'); addChild(characterGroup, 'label', '', '当前角色');
  const characterSelect = addChild(characterGroup, 'select', 'select-control editor-select');
  characters.forEach((character) => { const option = addChild(characterSelect, 'option', '', character.name); option.value = character.id; if (character.name === block.character) option.selected = true; });
  if (!characters.length) { const option = addChild(characterSelect, 'option', '', '暂无角色，请先创建'); option.disabled = true; }
  characterSelect.addEventListener('change', () => { const character = characters.find((item) => item.id === characterSelect.value); if (!character) return; block.character = character.name; block.characterKey = character.colorKey || 'mei'; renderScene(); renderInspector(); markDirty(); });
  const emotionGroup = addChild(body, 'div', 'property-group'); addChild(emotionGroup, 'label', '', '情绪标签'); const tags = addChild(emotionGroup, 'div', 'tag-row');
  ['克制', '温柔', '惊讶', '愤怒', '警觉', '坦白'].forEach((emotion) => { const tag = addChild(tags, 'button', `tag${block.emotion === emotion ? ' active' : ''}`, emotion); tag.addEventListener('click', () => { block.emotion = emotion; renderScene(); renderInspector(); markDirty(); }); });
  const voiceGroup = addChild(body, 'div', 'property-group'); addChild(voiceGroup, 'label', '', '语音提示'); const voiceSelect = addChild(voiceGroup, 'select', 'select-control editor-select'); ['女声 · 轻', '女声 · 强', '男声 · 低', '男声 · 清晰', '无语音'].forEach((voice) => { const option = addChild(voiceSelect, 'option', '', voice); option.value = voice; option.selected = block.voice === voice; }); voiceSelect.addEventListener('change', () => { block.voice = voiceSelect.value; renderScene(); renderInspector(); markDirty(); });
  const assetGroup = addChild(body, 'div', 'property-group'); addChild(assetGroup, 'label', '', '当前立绘'); const assetSelect = addChild(assetGroup, 'select', 'select-control editor-select'); const none = addChild(assetSelect, 'option', '', '未绑定立绘'); none.value = ''; none.selected = !block.portrait; (desktopState.data.assets || []).filter((asset) => !['mp3', 'wav', 'ogg'].includes(asset.type)).forEach((asset) => { const option = addChild(assetSelect, 'option', '', asset.name); option.value = asset.relativePath; option.selected = block.portrait === asset.relativePath; }); assetSelect.addEventListener('change', () => { block.portrait = assetSelect.value || undefined; renderScene(); markDirty(); });
  const noteGroup = addChild(body, 'div', 'property-group'); addChild(noteGroup, 'label', '', '创作备注'); const note = addChild(noteGroup, 'textarea', '', block.note || ''); note.placeholder = '给自己留下一句创作提示…'; note.addEventListener('input', () => { block.note = note.value; markDirty(); });
}
function renderCharacters() {
  const view = document.getElementById('charactersView'); if (!view) return; view.replaceChildren();
  const heading = addChild(view, 'div', 'section-title'); const copy = addChild(heading, 'div'); addChild(copy, 'div', 'eyebrow', 'CAST & ART'); addChild(copy, 'h2', '', '角色与立绘'); addChild(copy, 'p', 'muted', '创建角色并为对白绑定不同的角色状态。');
  const createButton = addChild(heading, 'button', 'primary-button', '＋ 新建角色'); createButton.addEventListener('click', () => { const name = window.prompt('角色名称'); if (!name?.trim()) return; const role = window.prompt('角色定位', '主要角色') || '主要角色'; const character = { id: `character-${Date.now()}`, name: name.trim(), role: role.trim(), colorKey: 'mei', portraits: [] }; desktopState.data.characters.push(character); renderCharacters(); renderInspector(); markDirty(); showToast(`已创建角色「${character.name}」`); });
  const grid = addChild(view, 'div', 'character-grid'); (desktopState.data.characters || []).forEach((character) => { const card = addChild(grid, 'article', `character-card${activeDialogueBlock()?.character === character.name ? ' selected' : ''}`); const art = addChild(card, 'div', `large-character ${character.colorKey === 'yan' ? 'yan-art' : 'mei-art'}`); addChild(art, 'span', '', character.name); const cardCopy = addChild(card, 'div', 'character-card-copy'); const info = addChild(cardCopy, 'div'); addChild(info, 'h3', '', character.name); addChild(info, 'p', '', character.role || '未设置定位'); const dot = addChild(cardCopy, 'span', `color-dot ${character.colorKey === 'yan' ? 'blue' : 'pink'}`); void dot; const footer = addChild(card, 'div', 'card-foot'); addChild(footer, 'span', '', `${character.portraits?.length || 0} 个立绘`); const use = addChild(footer, 'button', 'asset-action character-use', '用于当前对白'); use.addEventListener('click', () => { const block = activeDialogueBlock(); if (!block) { showToast('请先回到编辑器选择一条对白'); return; } block.character = character.name; block.characterKey = character.colorKey || 'mei'; renderScene(); renderInspector(); markDirty(); showToast(`已切换为「${character.name}」`); }); });
  const empty = addChild(grid, 'button', 'character-card add-character'); addChild(empty, 'span', '', '＋'); addChild(empty, 'b', '', '添加角色'); addChild(empty, 'small', '', '从角色设定开始'); empty.addEventListener('click', () => createButton.click());
}
function openProjectMenu() {
  document.querySelector('.project-popover')?.remove(); const menu = node('div', 'project-popover'); addChild(menu, 'div', 'project-popover-title', '当前项目'); addChild(menu, 'b', '', desktopState.data?.title || '未命名项目'); addChild(menu, 'small', '', desktopState.filePath || '尚未保存到磁盘'); const actions = addChild(menu, 'div', 'project-popover-actions'); const open = addChild(actions, 'button', 'file-button', '打开项目'); const create = addChild(actions, 'button', 'file-button', '新建项目'); const view = addChild(actions, 'button', 'file-button save', '查看当前编辑器'); open.addEventListener('click', () => { menu.remove(); openProject(); }); create.addEventListener('click', () => { menu.remove(); newProject(); }); view.addEventListener('click', () => { menu.remove(); document.querySelector('[data-view="editor"]').click(); }); document.body.appendChild(menu); const anchor = document.getElementById('workspaceSwitcher').getBoundingClientRect(); menu.style.left = `${anchor.left}px`; menu.style.top = `${anchor.bottom + 8}px`; }
const baseApplyProject = applyProject;
applyProject = function (data, filePath = null) { baseApplyProject(data, filePath); renderCharacters(); renderInspector(); };
const baseRenderScene = renderScene;
renderScene = function () { baseRenderScene(); document.querySelectorAll('.script-block').forEach((block) => { block.draggable = true; }); renderInspector(); };
const baseRenderImportedAssets = renderImportedAssets;
renderImportedAssets = function () { baseRenderImportedAssets(); };
document.getElementById('workspaceSwitcher')?.addEventListener('click', openProjectMenu);
document.getElementById('windowMinimize')?.addEventListener('click', () => desktopApi?.minimize()); document.getElementById('windowMaximize')?.addEventListener('click', () => desktopApi?.toggleMaximize()); document.getElementById('windowClose')?.addEventListener('click', () => desktopApi?.closeWindow());
document.addEventListener('dragstart', (event) => { const block = event.target.closest('.script-block'); if (!block || !event.target.closest('.block-handle')) { if (event.target.closest('.script-block')) event.preventDefault(); return; } draggedBlockIndex = Number(block.dataset.blockIndex); block.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
document.addEventListener('dragover', (event) => { const block = event.target.closest('.script-block'); if (!block || draggedBlockIndex === null) return; event.preventDefault(); document.querySelectorAll('.script-block').forEach((item) => item.classList.remove('drag-over')); if (Number(block.dataset.blockIndex) !== draggedBlockIndex) block.classList.add('drag-over'); });
document.addEventListener('drop', (event) => { const target = event.target.closest('.script-block'); if (!target || draggedBlockIndex === null) return; event.preventDefault(); const targetIndex = Number(target.dataset.blockIndex); const scene = currentScene(); if (targetIndex !== draggedBlockIndex) { const [moved] = scene.blocks.splice(draggedBlockIndex, 1); scene.blocks.splice(targetIndex, 0, moved); selectedBlockIndex = targetIndex; renderScene(); markDirty(); showToast('对白顺序已调整'); } draggedBlockIndex = null; });
document.addEventListener('dragend', () => { draggedBlockIndex = null; document.querySelectorAll('.script-block').forEach((item) => item.classList.remove('drag-over', 'dragging')); });