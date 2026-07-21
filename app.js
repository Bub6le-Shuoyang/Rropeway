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
let suppressDeleteConfirmation = false;
let newDialogueCharacterId = '';
let savedTextRange = null;
let savedTextBlockIndex = null;

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
function setSaveStatus(status, time = '') { document.getElementById('saveStatus').textContent = status; document.getElementById('saveTime').textContent = time; }
function markDirty() { desktopState.dirty = true; desktopApi?.setDirty(true); setSaveStatus('有未保存修改', '现在'); }
function currentChapter() { return desktopState.data?.chapters?.[activeChapterIndex]; }
function currentScene() { return currentChapter()?.scenes?.[activeSceneIndex]; }
function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
function addChild(parent, tag, className, text) { const item = node(tag, className, text); parent.appendChild(item); return item; }
function requestTextInput(title, initialValue = '') {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog');
    addChild(dialog, 'h3', '', title);
    const input = addChild(dialog, 'input', 'editor-dialog-input');
    input.value = initialValue;
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const cancel = addChild(actions, 'button', 'file-button', '取消');
    const confirm = addChild(actions, 'button', 'file-button save', '确定');
    const close = (value) => { overlay.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', () => close(input.value.trim() || null));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') close(input.value.trim() || null); if (event.key === 'Escape') close(null); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
function requestConfirmation(message) {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog');
    addChild(dialog, 'h3', '', '请确认');
    addChild(dialog, 'p', 'editor-dialog-message', message);
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const cancel = addChild(actions, 'button', 'file-button', '取消');
    const confirm = addChild(actions, 'button', 'file-button save', '确定');
    const close = (value) => { overlay.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });
    document.body.appendChild(overlay);
  });
}

function requestCharacterForm(existing = null) {
  return new Promise((resolve) => {
    const value = existing || {};
    let selectedPreset = value.portraitPreset || 'none';
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog character-editor-dialog');
    addChild(dialog, 'h3', '', existing ? '编辑角色' : '新建角色');
    const fields = addChild(dialog, 'div', 'character-form-grid');
    const nameField = addChild(fields, 'label', 'character-form-field');
    addChild(nameField, 'span', '', '角色名称');
    const nameInput = addChild(nameField, 'input'); nameInput.value = value.name || '';
    const roleField = addChild(fields, 'label', 'character-form-field');
    addChild(roleField, 'span', '', '角色定位');
    const roleInput = addChild(roleField, 'input'); roleInput.value = value.role || '';
    const descriptionField = addChild(fields, 'label', 'character-form-field character-form-wide');
    addChild(descriptionField, 'span', '', '基础信息');
    const descriptionInput = addChild(descriptionField, 'textarea'); descriptionInput.value = value.description || ''; descriptionInput.placeholder = '年龄、身份、性格或其他设定…';
    const colorField = addChild(fields, 'label', 'character-form-field');
    addChild(colorField, 'span', '', '代表色');
    const colorInput = addChild(colorField, 'input'); colorInput.type = 'color'; colorInput.value = value.color || '#f2674f';
    const portraitField = addChild(dialog, 'div', 'character-portrait-field');
    addChild(portraitField, 'span', 'character-field-label', '默认立绘（可选）');
    const presets = addChild(portraitField, 'div', 'portrait-preset-grid');
    const presetItems = [
      { value: 'none', label: '不添加' },
      { value: 'tall-male', label: '高个男性' },
      { value: 'short-male', label: '矮个男性' },
      { value: 'tall-female', label: '高个女性' },
      { value: 'short-female', label: '矮个女性' }
    ];
    const renderPresetSelection = () => presets.querySelectorAll('.portrait-preset').forEach((item) => item.classList.toggle('selected', item.dataset.preset === selectedPreset));
    presetItems.forEach((preset) => {
      const button = addChild(presets, 'button', 'portrait-preset'); button.type = 'button'; button.dataset.preset = preset.value;
      const preview = addChild(button, 'div', `portrait-preset-preview${preset.value === 'none' ? ' no-portrait' : ` default-silhouette silhouette-${preset.value}`}`);
      preview.style.setProperty('--character-color', colorInput.value);
      addChild(button, 'span', '', preset.label);
      button.addEventListener('click', () => { selectedPreset = preset.value; renderPresetSelection(); });
    });
    colorInput.addEventListener('input', () => presets.querySelectorAll('.portrait-preset-preview').forEach((preview) => preview.style.setProperty('--character-color', colorInput.value)));
    renderPresetSelection();
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const cancel = addChild(actions, 'button', 'file-button', '取消');
    const confirm = addChild(actions, 'button', 'file-button save', existing ? '保存修改' : '创建角色');
    const close = (result) => { overlay.remove(); resolve(result); };
    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); nameInput.classList.add('invalid'); return; }
      close({ ...value, name, role: roleInput.value.trim(), description: descriptionInput.value.trim(), color: colorInput.value, portraitPreset: selectedPreset === 'none' ? null : selectedPreset, portraits: Array.isArray(value.portraits) ? value.portraits : [] });
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => nameInput.focus());
  });
}
function captureBlocks() {
  return [...document.querySelectorAll('.script-canvas .script-block')].map((block) => {
    if (block.classList.contains('segment-block')) return { type: 'segment', title: block.querySelector('.segment-title')?.textContent.trim() || '未命名分段', perspectiveCharacterId: block.dataset.perspectiveCharacterId || null };
    if (block.classList.contains('narration')) return { type: 'narration', text: block.querySelector('.block-content p')?.textContent.trim() || '' };
    if (block.classList.contains('choice-block')) return { type: 'choice', title: block.querySelector('.choice-title')?.textContent.trim() || '', options: [...block.querySelectorAll('.choices button')].map((item) => item.querySelector('.choice-text')?.textContent.trim() || '') };
    const paragraph = block.querySelector('.block-content p');
    return { type: 'dialogue', character: block.querySelector('.character-name')?.textContent.trim() || '未命名角色', characterId: block.dataset.characterId || '', characterKey: 'mei', characterColor: block.dataset.characterColor || '#f2674f', portraitPreset: block.dataset.portraitPreset || null, statusTags: [...block.querySelectorAll('.status-pill')].map((tag) => tag.textContent.trim()).filter(Boolean), voice: block.querySelector('.voice-pill')?.textContent.replace(/^♪\s*/, '').trim() || '', text: paragraph?.textContent.trim() || '', textHtml: sanitizeRichTextHtml(paragraph?.innerHTML || ''), textAlign: paragraph?.style.textAlign || 'left', note: block.querySelector('.block-note')?.textContent.replace(/^注：/, '').trim() || '', portrait: block.dataset.portrait || undefined };
  });
}
function requestDeleteConfirmation(message) {
  if (suppressDeleteConfirmation) return Promise.resolve(true);
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog');
    addChild(dialog, 'h3', '', '确认删除');
    addChild(dialog, 'p', 'editor-dialog-message', message);
    const option = addChild(dialog, 'label', 'delete-confirm-option');
    const checkbox = addChild(option, 'input'); checkbox.type = 'checkbox';
    addChild(option, 'span', '', '本次工作不再弹出该提示');
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const cancel = addChild(actions, 'button', 'file-button', '取消');
    const confirm = addChild(actions, 'button', 'file-button save', '删除');
    const close = (value) => { overlay.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => { if (checkbox.checked) suppressDeleteConfirmation = true; close(true); });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });
    document.body.appendChild(overlay);
  });
}
function sanitizeRichTextHtml(html) {
  const source = document.createElement('template');
  const output = document.createElement('div');
  source.innerHTML = String(html || '');
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'BR']);
  const copySafeNode = (sourceNode, targetParent) => {
    if (sourceNode.nodeType === Node.TEXT_NODE) { targetParent.appendChild(document.createTextNode(sourceNode.textContent)); return; }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE'].includes(sourceNode.tagName)) return;
    if (!allowedTags.has(sourceNode.tagName)) { [...sourceNode.childNodes].forEach((child) => copySafeNode(child, targetParent)); return; }
    if (sourceNode.tagName === 'BR') { targetParent.appendChild(document.createElement('br')); return; }
    const tagName = sourceNode.tagName === 'FONT' ? 'span' : sourceNode.tagName.toLowerCase();
    const safeNode = document.createElement(tagName);
    ['color', 'fontWeight', 'fontStyle', 'textDecoration', 'fontSize'].forEach((property) => { if (sourceNode.style?.[property]) safeNode.style[property] = sourceNode.style[property]; });
    if (sourceNode.tagName === 'FONT') {
      if (sourceNode.color) safeNode.style.color = sourceNode.color;
      const sizeMap = { '1': '11px', '2': '13px', '3': '16px', '4': '18px', '5': '22px', '6': '28px', '7': '36px' };
      if (sizeMap[sourceNode.size]) safeNode.style.fontSize = sizeMap[sourceNode.size];
    }
    [...sourceNode.childNodes].forEach((child) => copySafeNode(child, safeNode));
    targetParent.appendChild(safeNode);
  };
  [...source.content.childNodes].forEach((child) => copySafeNode(child, output));
  return output.innerHTML;
}
function syncCurrentScene() { const scene = currentScene(); if (scene) scene.blocks = captureBlocks(); }
function captureProject() { syncCurrentScene(); const data = desktopState.data; data.title = document.getElementById('workspaceTitle').textContent.trim(); data.chapters[0] && (data.chapters[0].title = data.chapters[0].title || '第一章'); return data; }

function perspectiveCharacterIdAt(index) {
  const blocks = currentScene()?.blocks || [];
  for (let blockIndex = index - 1; blockIndex >= 0; blockIndex -= 1) {
    if (blocks[blockIndex].type === 'segment') return blocks[blockIndex].perspectiveCharacterId || null;
  }
  return null;
}
function createBlockElement(block, index) {
  const blockClass = block.type === 'choice' ? 'choice-block' : block.type === 'segment' ? 'segment-block' : block.type;
  const wrapper = node('div', `script-block ${blockClass}${index === selectedBlockIndex ? ' selected' : ''}`);
  wrapper.dataset.blockIndex = String(index);
  const actions = addChild(wrapper, 'div', 'block-actions');
  const remove = addChild(actions, 'button', 'block-action delete', '\u00d7');
  remove.type = 'button'; remove.title = '\u5220\u9664'; remove.dataset.blockAction = 'delete';
  addChild(wrapper, 'div', 'block-handle', '⠿');
  const content = node('div', 'block-content');
  if (block.type === 'segment') {
    addChild(content, 'span', 'block-type', '对话分段');
    addChild(content, 'p', 'segment-title', block.title || '未命名分段');
    const perspective = (desktopState.data?.characters || []).find((item) => item.id === block.perspectiveCharacterId);
    addChild(content, 'small', 'segment-perspective', perspective ? `主视角：${perspective.name}` : '未设置主视角');
    if (block.perspectiveCharacterId) wrapper.dataset.perspectiveCharacterId = block.perspectiveCharacterId;
  } else if (block.type === 'narration') {
    addChild(content, 'span', 'block-type', '场景描述');
    addChild(content, 'p', '', block.text);
  } else if (block.type === 'choice') {
    addChild(wrapper, 'div', 'choice-icon', '↳'); addChild(content, 'span', 'block-type', '玩家选择'); addChild(content, 'p', 'choice-title', block.title);
    const choices = addChild(content, 'div', 'choices');
    (block.options || []).forEach((option) => { const button = addChild(choices, 'button'); addChild(button, 'span', 'choice-text', option); addChild(button, 'span', '', '→'); });
  } else {
    const character = (desktopState.data?.characters || []).find((item) => item.id === block.characterId || item.name === block.character);
    if (!Array.isArray(block.statusTags)) block.statusTags = [block.statusTag || block.emotion || ''].map((tag) => String(tag).trim()).filter(Boolean);
    const isPerspective = perspectiveCharacterIdAt(index) && perspectiveCharacterIdAt(index) === (block.characterId || character?.id);
    if (isPerspective) wrapper.classList.add('pov-dialogue');
    const thumb = addChild(wrapper, 'div', 'character-thumb', (block.character || '未').slice(0, 1)); thumb.style.background = block.characterColor || character?.color || '#f2674f';
    const meta = addChild(content, 'div', 'dialogue-meta'); const nameNode = addChild(meta, 'span', 'character-name', block.character); nameNode.style.color = block.characterColor || character?.color || '#f2674f'; if (isPerspective) addChild(meta, 'span', 'pov-pill', '主视角'); (block.statusTags || []).forEach((statusTag) => addChild(meta, 'span', 'status-pill', statusTag)); addChild(meta, 'span', 'voice-pill', `♪ ${block.voice || '未设定'}`);
    const paragraph = addChild(content, 'p');
    if (block.textHtml) paragraph.innerHTML = sanitizeRichTextHtml(block.textHtml); else paragraph.textContent = block.text || '';
    paragraph.style.textAlign = block.textAlign || 'left';
    if (block.note) addChild(content, 'div', 'block-note', `注：${block.note}`);
    if (block.portrait) wrapper.dataset.portrait = block.portrait; if (block.portraitPreset) wrapper.dataset.portraitPreset = block.portraitPreset; if (block.characterId || character?.id) wrapper.dataset.characterId = block.characterId || character.id; wrapper.dataset.characterColor = block.characterColor || character?.color || '#f2674f';
    void thumb;
  }
  wrapper.appendChild(content);
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
async function renameScene(index) { const scene = currentChapter()?.scenes?.[index]; if (!scene) return; const title = await requestTextInput('场景名称', scene.title); if (title) { scene.title = title; renderSceneTabs(); renderScene(); markDirty(); } }
function addScene() { syncCurrentScene(); const chapter = currentChapter(); chapter.scenes.push({ id: `scene-${Date.now()}`, number: String(chapter.scenes.length + 1).padStart(2, '0'), title: `未命名场景 ${chapter.scenes.length + 1}`, blocks: [] }); activeSceneIndex = chapter.scenes.length - 1; selectedBlockIndex = 0; renderSceneTabs(); renderScene(); markDirty(); showToast('已添加新场景'); }
function renderChapters() {
  const list = document.getElementById('chapterList');
  list.replaceChildren();
  (desktopState.data?.chapters || []).forEach((chapter, index) => {
    const entry = addChild(list, 'div', 'chapter-entry');
    const button = addChild(entry, 'button', `chapter${index === activeChapterIndex ? ' active' : ''}`);
    addChild(button, 'span', 'chapter-number', String(index + 1).padStart(2, '0'));
    const copy = addChild(button, 'span');
    addChild(copy, 'b', '', chapter.title);
    addChild(copy, 'small', '', `${chapter.scenes.length} 个场景 · ${chapter.status}`);
    const rename = addChild(entry, 'button', 'chapter-rename', '✎');
    rename.title = '修改章节名称';
    button.addEventListener('click', () => {
      syncCurrentScene();
      activeChapterIndex = index;
      activeSceneIndex = 0;
      selectedBlockIndex = 0;
      renderChapters();
      renderSceneTabs();
      renderScene();
      document.querySelector('[data-view="editor"]').click();
    });
    rename.addEventListener('click', async () => {
      const title = await requestTextInput('章节名称', chapter.title);
      if (!title) return;
      chapter.title = title;
      renderChapters();
      if (index === activeChapterIndex) renderScene();
      markDirty();
    });
  });
}

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

function syncDialogueCreationState() {
  const addButton = document.getElementById('addDialogue');
  if (!addButton) return;
  const characters = desktopState.data?.characters || [];
  if (!characters.some((character) => character.id === newDialogueCharacterId)) newDialogueCharacterId = '';
  addButton.disabled = !newDialogueCharacterId;
}
function applyProject(data, filePath = null) { desktopState.data = data; desktopState.filePath = filePath; activeChapterIndex = 0; activeSceneIndex = 0; selectedBlockIndex = 0; newDialogueCharacterId = ''; document.getElementById('workspaceTitle').textContent = data.title; syncDialogueCreationState(); renderChapters(); renderSceneTabs(); renderScene(); renderImportedAssets(); desktopState.dirty = false; desktopApi?.setDirty(false); setSaveStatus(filePath ? '已打开本地项目' : '本地新项目', filePath ? '刚刚' : '未保存'); }
async function saveProject() { if (!desktopApi) return false; try { const result = await desktopApi.saveProject({ filePath: desktopState.filePath, data: captureProject() }); if (!result) return false; desktopState.filePath = result.filePath; desktopState.data = result.data; rememberProject(result.filePath, result.data.title); desktopState.dirty = false; desktopApi.setDirty(false); localStorage.removeItem('scriptroom-draft'); setSaveStatus('已保存到本地', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); showToast('项目已保存'); return true; } catch (error) { showToast(error.message || '保存失败'); return false; } }
async function openProject() { if (desktopState.dirty && !(await requestConfirmation('当前项目有未保存修改，确定打开另一个项目吗？'))) return; try { const result = await desktopApi.openProject(); if (result) { applyProject(result.data, result.filePath); showToast('项目已打开'); } } catch (error) { showToast(error.message || '打开失败'); } }
async function newProject() { if (desktopState.dirty && !(await requestConfirmation('当前项目有未保存修改，确定新建项目吗？'))) return; const result = await desktopApi.newProject(); applyProject(result.data); showToast('已新建空白项目'); }
async function importAssets() { if (!desktopState.filePath) { if (!(await saveProject())) return; } try { const assets = await desktopApi.importAssets(desktopState.filePath); if (!assets.length) return; desktopState.data.assets.push(...assets); renderImportedAssets(); markDirty(); showToast(`已导入 ${assets.length} 个素材`); } catch (error) { showToast(error.message || '素材导入失败'); } }
function updatePreview() {
  syncCurrentScene();
  const scene = currentScene();
  const block = scene?.blocks?.[selectedBlockIndex];
  const stage = document.querySelector('.preview-scene');
  const character = document.querySelector('.preview-character');
  const speaker = document.getElementById('previewSpeaker');
  const text = document.getElementById('previewText');
  const options = document.querySelector('.preview-options');
  stage.style.backgroundImage = '';
  character.removeAttribute('style');
  character.className = 'preview-character no-portrait';
  speaker.textContent = block?.type === 'dialogue' ? block.character : block?.type === 'narration' ? '旁白' : '';
  text.textContent = block?.type === 'choice' ? block.title : block?.text || '当前场景没有可预览内容。';
  options.replaceChildren();
  if (block?.type === 'choice') (block.options || []).forEach((optionText) => addChild(options, 'button', '', optionText));
  if (scene?.background && desktopState.filePath) desktopApi.readAsset(desktopState.filePath, scene.background).then((src) => { if (src) stage.style.backgroundImage = `linear-gradient(180deg, transparent 35%, rgba(30,35,33,.55)), url("${src}")`; }).catch(() => {});
  if (block?.portrait && desktopState.filePath) {
    desktopApi.readAsset(desktopState.filePath, block.portrait).then((src) => { if (src) { character.className = 'preview-character'; character.style.background = `center bottom / contain no-repeat url("${src}")`; } }).catch(() => {});
  } else if (block?.portraitPreset) {
    character.className = `preview-character default-silhouette silhouette-${block.portraitPreset}`;
    character.style.setProperty('--character-color', block.characterColor || '#f2674f');
  }
}

navItems.forEach((item) => item.addEventListener('click', () => { const target = item.dataset.view; navItems.forEach((nav) => nav.classList.toggle('active', nav === item)); document.querySelector('.editor-layout').classList.toggle('hidden', target !== 'editor'); views.characters.classList.toggle('hidden', target !== 'characters'); views.assets.classList.toggle('hidden', target !== 'assets'); document.querySelector('.breadcrumb span').textContent = target === 'characters' ? '角色与立绘' : target === 'assets' ? '素材库' : '剧本编辑器'; if (target === 'characters') renderCharacters(); if (target === 'assets') renderImportedAssets(); }));
document.addEventListener('click', (event) => { const block = event.target.closest('.script-block'); if (block) { selectedBlockIndex = Number(block.dataset.blockIndex || 0); document.querySelectorAll('.script-block').forEach((item) => item.classList.toggle('selected', item === block)); renderInspector(); } if (event.target.closest('#addDialogue')) { syncCurrentScene(); const character = desktopState.data.characters?.find((item) => item.id === newDialogueCharacterId); if (!character) { showToast('请先在右侧设置新增对白角色'); return; } currentScene().blocks.push({ type: 'dialogue', character: character.name, characterId: character.id, characterKey: 'mei', characterColor: character.color || '#f2674f', portraitPreset: character.portraitPreset || null, statusTags: [], voice: '', text: '', textHtml: '', textAlign: 'left' }); selectedBlockIndex = currentScene().blocks.length - 1; renderScene(); document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] p`)?.focus(); markDirty(); showToast('已添加一条对白'); } if (event.target.closest('#addSegment')) { syncCurrentScene(); const segmentNumber = currentScene().blocks.filter((item) => item.type === 'segment').length + 1; currentScene().blocks.push({ type: 'segment', title: `分段 ${segmentNumber}`, perspectiveCharacterId: null }); selectedBlockIndex = currentScene().blocks.length - 1; renderScene(); markDirty(); showToast('已添加分段'); } });
document.addEventListener('input', (event) => { if (event.target.closest('[contenteditable="true"]')) { editHistory = editHistory.slice(0, historyIndex + 1); editHistory.push([...document.querySelectorAll('[contenteditable="true"]')].map((item) => item.innerHTML)); historyIndex = editHistory.length - 1; if (event.target.closest('.segment-title')) renderSegmentNavigator(); markDirty(); } });
document.querySelector('[title="撤销"]')?.addEventListener('click', () => { if (historyIndex > 0) { historyIndex -= 1; document.querySelectorAll('[contenteditable="true"]').forEach((item, index) => { item.innerHTML = editHistory[historyIndex][index] ?? item.innerHTML; }); markDirty(); } });
document.querySelector('[title="重做"]')?.addEventListener('click', () => { if (historyIndex < editHistory.length - 1) { historyIndex += 1; document.querySelectorAll('[contenteditable="true"]').forEach((item, index) => { item.innerHTML = editHistory[historyIndex][index] ?? item.innerHTML; }); markDirty(); } });
document.getElementById('addChapter')?.addEventListener('click', () => { const chapters = desktopState.data.chapters; const chapterNumber = chapters.length + 1; chapters.push({ id: `chapter-${Date.now()}`, title: `未命名章节 ${chapterNumber}`, status: '草稿', scenes: [{ id: `scene-${Date.now()}`, number: '01', title: '未命名场景', blocks: [] }] }); activeChapterIndex = chapters.length - 1; activeSceneIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]').click(); markDirty(); showToast('已添加新章节'); });
document.getElementById('newProjectBtn')?.addEventListener('click', newProject); document.getElementById('openProjectBtn')?.addEventListener('click', openProject); document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject); document.getElementById('importAssetsBtn')?.addEventListener('click', importAssets);
document.getElementById('previewBtn')?.addEventListener('click', () => { updatePreview(); document.getElementById('previewModal').classList.remove('hidden'); }); document.getElementById('closePreview')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden')); document.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden'));
document.addEventListener('keydown', (event) => { if (!(event.ctrlKey || event.metaKey)) return; const key = event.key.toLowerCase(); if (key === 's') { event.preventDefault(); saveProject(); } if (key === 'o') { event.preventDefault(); openProject(); } if (key === 'n') { event.preventDefault(); newProject(); } });
desktopApi?.onBeforeClose(async () => { const saved = await saveProject(); if (saved) desktopApi.finishClose(); else desktopApi.cancelClose(); });
setInterval(() => { if (desktopState.dirty && desktopState.data) localStorage.setItem('scriptroom-draft', JSON.stringify({ filePath: desktopState.filePath, data: captureProject(), savedAt: Date.now() })); }, 10000);
if (desktopApi) desktopApi.newProject().then(async (result) => { const draft = localStorage.getItem('scriptroom-draft'); if (draft && await requestConfirmation('发现上次未保存的临时草稿，是否恢复？')) { const recovered = JSON.parse(draft); applyProject(recovered.data, recovered.filePath); markDirty(); } else { applyProject(result.data); } editHistory = [[...document.querySelectorAll('[contenteditable="true"]')].map((item) => item.innerHTML)]; historyIndex = 0; });

// Interactive editor layer: characters, inspector controls, drag sorting and project switcher.
let draggedBlockIndex = null;
function activeDialogueBlock() { const scene = currentScene(); const block = scene?.blocks?.[selectedBlockIndex]; return block?.type === 'dialogue' ? block : null; }
function createInspectorSection(body, title, description = '') {
  const section = addChild(body, 'section', 'inspector-section');
  addChild(section, 'h3', '', title);
  if (description) addChild(section, 'p', 'inspector-section-description', description);
  return section;
}
function renderDialogueCreationSettings(body) {
  const section = createInspectorSection(body, '新增对白设置', '先选择角色，再使用对白流底部的“添加对白”。');
  const characters = desktopState.data?.characters || [];
  const group = addChild(section, 'div', 'property-group'); addChild(group, 'label', '', '新增对白角色');
  const select = addChild(group, 'select', 'select-control editor-select');
  const placeholder = addChild(select, 'option', '', characters.length ? '请选择角色' : '暂无角色，请先创建'); placeholder.value = ''; placeholder.disabled = !characters.length;
  characters.forEach((character) => { const option = addChild(select, 'option', '', character.name); option.value = character.id; option.selected = newDialogueCharacterId === character.id; });
  select.disabled = !characters.length;
  select.addEventListener('change', () => { newDialogueCharacterId = select.value; syncDialogueCreationState(); });
  syncDialogueCreationState();
}
function selectedDialogueParagraph() { return document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .block-content p[contenteditable="true"]`); }
function rememberTextSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const paragraph = container?.closest?.('.script-block.dialogue .block-content p[contenteditable="true"]');
  if (!paragraph) return;
  savedTextRange = range.cloneRange();
  savedTextBlockIndex = Number(paragraph.closest('.script-block').dataset.blockIndex);
}
function restoreTextSelection(paragraph) {
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (savedTextRange && savedTextBlockIndex === selectedBlockIndex && (paragraph === savedTextRange.commonAncestorContainer || paragraph.contains(savedTextRange.commonAncestorContainer))) selection.addRange(savedTextRange);
  else { const range = document.createRange(); range.selectNodeContents(paragraph); selection.addRange(range); }
}
function applyInlineTextFormat(command, value = null) {
  const block = activeDialogueBlock(); const paragraph = selectedDialogueParagraph();
  if (!block || !paragraph) return;
  paragraph.focus(); restoreTextSelection(paragraph);
  document.execCommand(command, false, value);
  block.text = paragraph.textContent;
  block.textHtml = sanitizeRichTextHtml(paragraph.innerHTML);
  rememberTextSelection();
  markDirty();
}
function applyParagraphAlignment(alignment) {
  const block = activeDialogueBlock(); const paragraph = selectedDialogueParagraph();
  if (!block || !paragraph) return;
  block.textAlign = alignment;
  paragraph.style.textAlign = alignment;
  markDirty();
}
function renderTextFormattingSettings(body, block) {
  const section = createInspectorSection(body, '文字编辑器', '选中对白文字后设置格式；未选中文字时会应用到整条对白。');
  if (!block) { section.classList.add('disabled'); addChild(section, 'div', 'inspector-empty compact', '请选择一条对白后使用文字格式。'); return; }
  const toolbar = addChild(section, 'div', 'text-format-toolbar');
  const addCommandButton = (label, title, command) => { const button = addChild(toolbar, 'button', 'text-format-button', label); button.type = 'button'; button.title = title; button.addEventListener('mousedown', (event) => event.preventDefault()); button.addEventListener('click', () => applyInlineTextFormat(command)); return button; };
  addCommandButton('B', '加粗', 'bold').classList.add('bold');
  addCommandButton('I', '斜体', 'italic').classList.add('italic');
  addCommandButton('U', '下划线', 'underline').classList.add('underline');
  addCommandButton('S', '删除线', 'strikeThrough').classList.add('strike');
  const sizeSelect = addChild(toolbar, 'select', 'text-format-select');
  [['3', '正常'], ['4', '较大'], ['5', '大字'], ['6', '标题']].forEach(([value, label]) => { const option = addChild(sizeSelect, 'option', '', label); option.value = value; });
  sizeSelect.addEventListener('change', () => { applyInlineTextFormat('fontSize', sizeSelect.value); sizeSelect.value = '3'; });
  const colorLabel = addChild(toolbar, 'label', 'text-color-control'); addChild(colorLabel, 'span', '', 'A');
  const colorInput = addChild(colorLabel, 'input'); colorInput.type = 'color'; colorInput.value = '#2d302f'; colorInput.title = '文字颜色'; colorInput.addEventListener('input', () => applyInlineTextFormat('foreColor', colorInput.value));
  const alignment = addChild(section, 'div', 'text-alignment-row');
  [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].forEach(([value, title]) => { const button = addChild(alignment, 'button', `text-align-button${(block.textAlign || 'left') === value ? ' active' : ''}`, value === 'left' ? '≡' : value === 'center' ? '≣' : '≡'); button.type = 'button'; button.title = title; if (value === 'right') button.classList.add('align-right-icon'); button.addEventListener('click', () => { applyParagraphAlignment(value); renderInspector(); }); });
  const clear = addChild(alignment, 'button', 'text-clear-button', '清除格式'); clear.type = 'button'; clear.addEventListener('mousedown', (event) => event.preventDefault()); clear.addEventListener('click', () => applyInlineTextFormat('removeFormat'));
}
document.addEventListener('selectionchange', rememberTextSelection);
function renderInspector() {
  const body = document.querySelector('.inspector-body'); if (!body) return; body.replaceChildren();
  const header = document.querySelector('.inspector-header span');
  const selectedBlock = currentScene()?.blocks?.[selectedBlockIndex];
  let dialogueBlock = null;
  if (selectedBlock?.type === 'segment') {
    if (header) header.textContent = '分段属性';
    const properties = createInspectorSection(body, '当前分段');
    const titleGroup = addChild(properties, 'div', 'property-group'); addChild(titleGroup, 'label', '', '分段名称');
    const titleInput = addChild(titleGroup, 'input', 'select-control editor-input'); titleInput.value = selectedBlock.title || ''; titleInput.placeholder = '输入分段名称';
    titleInput.addEventListener('input', () => { selectedBlock.title = titleInput.value; document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .segment-title`)?.replaceChildren(document.createTextNode(titleInput.value || '未命名分段')); renderSegmentNavigator(); markDirty(); });
    const perspectiveGroup = addChild(properties, 'div', 'property-group'); addChild(perspectiveGroup, 'label', '', '主视角角色');
    const perspectiveSelect = addChild(perspectiveGroup, 'select', 'select-control editor-select');
    const none = addChild(perspectiveSelect, 'option', '', '不设置主视角'); none.value = '';
    (desktopState.data.characters || []).forEach((character) => { const option = addChild(perspectiveSelect, 'option', '', character.name); option.value = character.id; option.selected = selectedBlock.perspectiveCharacterId === character.id; });
    perspectiveSelect.addEventListener('change', () => { selectedBlock.perspectiveCharacterId = perspectiveSelect.value || null; renderScene(); markDirty(); });
  } else {
    if (header) header.textContent = '对白属性';
    dialogueBlock = activeDialogueBlock();
    const properties = createInspectorSection(body, '当前对白');
    if (!dialogueBlock) addChild(properties, 'div', 'inspector-empty compact', '选择一条对白后，可编辑角色、状态标签和立绘属性。');
    else {
      const characters = desktopState.data.characters || [];
      const characterGroup = addChild(properties, 'div', 'property-group'); addChild(characterGroup, 'label', '', '当前角色');
      const characterSelect = addChild(characterGroup, 'select', 'select-control editor-select');
      characters.forEach((character) => { const option = addChild(characterSelect, 'option', '', character.name); option.value = character.id; if (character.name === dialogueBlock.character) option.selected = true; });
      if (!characters.length) { const option = addChild(characterSelect, 'option', '', '暂无角色，请先创建'); option.disabled = true; }
      characterSelect.addEventListener('change', () => { const character = characters.find((item) => item.id === characterSelect.value); if (!character) return; applyCharacterToBlock(character, dialogueBlock); renderScene(); markDirty(); });
      const statusGroup = addChild(properties, 'div', 'property-group'); addChild(statusGroup, 'label', '', '状态标签');
      const statusEditor = addChild(statusGroup, 'div', 'status-tag-editor');
      (dialogueBlock.statusTags || []).forEach((statusTag, tagIndex) => { const chip = addChild(statusEditor, 'span', 'status-tag-chip'); addChild(chip, 'span', '', statusTag); const removeTag = addChild(chip, 'button', '', '×'); removeTag.type = 'button'; removeTag.title = '删除标签'; removeTag.addEventListener('click', () => { dialogueBlock.statusTags.splice(tagIndex, 1); renderScene(); markDirty(); }); });
      const statusInput = addChild(statusEditor, 'input', 'status-tag-input'); statusInput.placeholder = '输入后按回车或点击其他位置';
      const commitStatusTag = (refocus) => { const value = statusInput.value.trim(); if (!value) return; dialogueBlock.statusTags ||= []; if (dialogueBlock.statusTags.includes(value)) { statusInput.value = ''; return; } dialogueBlock.statusTags.push(value); renderScene(); markDirty(); if (refocus) requestAnimationFrame(() => document.querySelector('.status-tag-input')?.focus()); };
      statusInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commitStatusTag(true); } }); statusInput.addEventListener('blur', () => setTimeout(() => commitStatusTag(false), 0));
      const voiceGroup = addChild(properties, 'div', 'property-group'); addChild(voiceGroup, 'label', '', '语音提示'); const voiceSelect = addChild(voiceGroup, 'select', 'select-control editor-select'); ['女声 · 轻', '女声 · 强', '男声 · 低', '男声 · 清晰', '无语音'].forEach((voice) => { const option = addChild(voiceSelect, 'option', '', voice); option.value = voice; option.selected = dialogueBlock.voice === voice; }); voiceSelect.addEventListener('change', () => { dialogueBlock.voice = voiceSelect.value; renderScene(); markDirty(); });
      const assetGroup = addChild(properties, 'div', 'property-group'); addChild(assetGroup, 'label', '', '当前立绘'); const assetSelect = addChild(assetGroup, 'select', 'select-control editor-select');
      const none = addChild(assetSelect, 'option', '', '不使用立绘'); none.value = 'none'; none.selected = !dialogueBlock.portrait && !dialogueBlock.portraitPreset;
      const selectedCharacter = characters.find((item) => item.name === dialogueBlock.character);
      if (selectedCharacter?.portraitPreset) { const preset = addChild(assetSelect, 'option', '', '角色默认立绘'); preset.value = `preset:${selectedCharacter.portraitPreset}`; preset.selected = !dialogueBlock.portrait && dialogueBlock.portraitPreset === selectedCharacter.portraitPreset; }
      (desktopState.data.assets || []).filter((asset) => !['mp3', 'wav', 'ogg'].includes(asset.type)).forEach((asset) => { const option = addChild(assetSelect, 'option', '', asset.name); option.value = `asset:${asset.relativePath}`; option.selected = dialogueBlock.portrait === asset.relativePath; });
      assetSelect.addEventListener('change', () => { if (assetSelect.value.startsWith('asset:')) { dialogueBlock.portrait = assetSelect.value.slice(6); dialogueBlock.portraitPreset = null; } else if (assetSelect.value.startsWith('preset:')) { dialogueBlock.portrait = undefined; dialogueBlock.portraitPreset = assetSelect.value.slice(7); } else { dialogueBlock.portrait = undefined; dialogueBlock.portraitPreset = null; } renderScene(); markDirty(); });
      const noteGroup = addChild(properties, 'div', 'property-group'); addChild(noteGroup, 'label', '', '创作备注'); const note = addChild(noteGroup, 'textarea', '', dialogueBlock.note || ''); note.placeholder = '给自己留下一句创作提示…'; note.addEventListener('input', () => { dialogueBlock.note = note.value; markDirty(); });
    }
  }
  renderDialogueCreationSettings(body);
  renderTextFormattingSettings(body, dialogueBlock);
}
function applyCharacterToBlock(character, block) {
  block.character = character.name;
  block.characterId = character.id;
  block.characterKey = 'mei';
  block.characterColor = character.color || '#f2674f';
  block.portraitPreset = character.portraitPreset || null;
  block.portrait = undefined;
}
function renderCharacters() {
  const view = document.getElementById('charactersView');
  if (!view) return;
  view.replaceChildren();
  const heading = addChild(view, 'div', 'section-title');
  const copy = addChild(heading, 'div');
  addChild(copy, 'div', 'eyebrow', 'CHARACTER LIBRARY');
  addChild(copy, 'h2', '', '角色与立绘');
  addChild(copy, 'p', 'muted', '管理角色基础信息、代表色和默认立绘。');
  const createButton = addChild(heading, 'button', 'primary-button', '＋ 新建角色');
  createButton.addEventListener('click', async () => {
    const character = await requestCharacterForm();
    if (!character) return;
    character.id = `character-${Date.now()}`;
    desktopState.data.characters.push(character);
    renderCharacters();
    syncDialogueCreationState();
    renderInspector();
    markDirty();
    showToast(`已创建角色「${character.name}」`);
  });
  const grid = addChild(view, 'div', 'character-grid');
  (desktopState.data.characters || []).forEach((character, characterIndex) => {
    const card = addChild(grid, 'article', `character-card${activeDialogueBlock()?.character === character.name ? ' selected' : ''}`);
    const art = addChild(card, 'div', 'character-portrait-card');
    art.style.setProperty('--character-color', character.color || '#f2674f');
    if (character.portraitPreset) addChild(art, 'div', `default-silhouette silhouette-${character.portraitPreset}`);
    else addChild(art, 'div', 'no-character-portrait', '未添加立绘');
    addChild(art, 'span', 'character-portrait-name', character.name);
    const cardCopy = addChild(card, 'div', 'character-card-copy');
    const info = addChild(cardCopy, 'div');
    addChild(info, 'h3', '', character.name);
    addChild(info, 'p', '', character.role || '未设置定位');
    const colorDot = addChild(cardCopy, 'span', 'color-dot'); colorDot.style.background = character.color || '#f2674f';
    if (character.description) addChild(card, 'p', 'character-description', character.description);
    const footer = addChild(card, 'div', 'card-foot');
    const edit = addChild(footer, 'button', 'character-card-action', '编辑信息');
    const use = addChild(footer, 'button', 'character-card-action primary', '用于当前对白');
    edit.addEventListener('click', async () => {
      const updated = await requestCharacterForm(character);
      if (!updated) return;
      desktopState.data.characters[characterIndex] = { ...character, ...updated };
      desktopState.data.chapters.forEach((chapter) => chapter.scenes.forEach((scene) => scene.blocks.forEach((block) => { if (block.type === 'dialogue' && (block.characterId === character.id || block.character === character.name)) applyCharacterToBlock(desktopState.data.characters[characterIndex], block); })));
      renderCharacters(); syncDialogueCreationState(); renderScene(); renderInspector(); markDirty();
    });
    use.addEventListener('click', () => {
      const block = activeDialogueBlock();
      if (!block) { showToast('请先回到编辑器选择一条对白'); return; }
      applyCharacterToBlock(character, block);
      renderScene(); renderInspector(); markDirty();
      showToast(`已切换为「${character.name}」`);
    });
  });
  if (!(desktopState.data.characters || []).length) {
    const empty = addChild(grid, 'button', 'character-empty-state');
    addChild(empty, 'span', '', '＋');
    addChild(empty, 'b', '', '创建第一个角色');
    addChild(empty, 'small', '', '设置名称、代表色和可选默认立绘');
    empty.addEventListener('click', () => createButton.click());
  }
}
function recentProjects() {
  try { return JSON.parse(localStorage.getItem('scriptroom-recent-projects') || '[]'); } catch { return []; }
}
function rememberProject(filePath, title) {
  if (!filePath) return;
  const projects = recentProjects().filter((item) => item.filePath !== filePath);
  projects.unshift({ filePath, title: title || '未命名项目' });
  localStorage.setItem('scriptroom-recent-projects', JSON.stringify(projects.slice(0, 8)));
}
async function openRecentProject(filePath) {
  if (filePath === desktopState.filePath) { document.querySelector('[data-view="editor"]').click(); return; }
  if (desktopState.dirty && !(await requestConfirmation('当前项目有未保存修改，确定切换项目吗？'))) return;
  try {
    const result = await desktopApi.openProjectPath(filePath);
    applyProject(result.data, result.filePath);
    document.querySelector('[data-view="editor"]').click();
    showToast('项目已切换');
  } catch (error) { showToast(error.message || '项目打开失败'); }
}
function openProjectMenu() {
  const existing = document.querySelector('.project-popover');
  if (existing) { existing.remove(); return; }
  const menu = node('div', 'project-popover');
  addChild(menu, 'div', 'project-popover-title', '项目列表');
  const list = addChild(menu, 'div', 'project-list');
  const entries = [{ filePath: desktopState.filePath, title: desktopState.data?.title || '未命名项目', current: true }];
  recentProjects().filter((item) => item.filePath !== desktopState.filePath).forEach((item) => entries.push({ ...item, current: false }));
  entries.forEach((project) => {
    const item = addChild(list, 'button', `project-list-item${project.current ? ' current' : ''}`);
    const copy = addChild(item, 'span', 'project-list-copy');
    addChild(copy, 'b', '', project.title);
    addChild(copy, 'small', '', project.filePath || '尚未保存到磁盘');
    if (project.current) addChild(item, 'span', 'project-current-mark', '当前');
    item.addEventListener('click', () => {
      menu.remove();
      if (project.filePath) openRecentProject(project.filePath);
      else document.querySelector('[data-view="editor"]').click();
    });
  });
  document.body.appendChild(menu);
  const anchor = document.getElementById('workspaceSwitcher').getBoundingClientRect();
  menu.style.left = `${anchor.left}px`;
  menu.style.top = `${anchor.bottom + 8}px`;
}
const baseApplyProject = applyProject;
applyProject = function (data, filePath = null) { baseApplyProject(data, filePath); if (filePath) rememberProject(filePath, data.title); renderCharacters(); renderInspector(); };
function updateEditorScrollTools() {
  const panel = document.querySelector('.script-panel'); const backToTop = document.getElementById('backToTop'); const navigator = document.getElementById('segmentNavigator');
  if (!panel || !backToTop || !navigator) return;
  backToTop.classList.toggle('hidden', panel.scrollTop < 320);
  let activeMarker = null;
  navigator.querySelectorAll('.segment-nav-marker').forEach((marker) => { if (panel.scrollTop + 120 >= Number(marker.dataset.target || 0)) activeMarker = marker; marker.classList.remove('active'); });
  activeMarker?.classList.add('active');
}
function renderSegmentNavigator() {
  requestAnimationFrame(() => {
    const panel = document.querySelector('.script-panel'); const canvas = document.querySelector('.script-canvas'); const navigator = document.getElementById('segmentNavigator');
    if (!panel || !canvas || !navigator) return;
    navigator.replaceChildren();
    const segments = [...canvas.querySelectorAll('.segment-block')];
    navigator.classList.toggle('hidden', !segments.length);
    if (!segments.length) { updateEditorScrollTools(); return; }
    addChild(navigator, 'span', 'segment-axis-line');
    const maxScroll = Math.max(1, panel.scrollHeight - panel.clientHeight);
    segments.forEach((segment, segmentIndex) => {
      const target = Math.max(0, segment.offsetTop + canvas.offsetTop - 24);
      const marker = addChild(navigator, 'button', 'segment-nav-marker'); marker.type = 'button'; marker.dataset.target = String(target); marker.style.top = `${Math.min(100, target / maxScroll * 100)}%`; marker.title = segment.querySelector('.segment-title')?.textContent || `分段 ${segmentIndex + 1}`;
      addChild(marker, 'span', 'segment-nav-dot'); addChild(marker, 'span', 'segment-nav-label', marker.title);
      marker.addEventListener('click', () => panel.scrollTo({ top: target, behavior: 'smooth' }));
    });
    updateEditorScrollTools();
  });
}
const baseRenderScene = renderScene;
renderScene = function () { baseRenderScene(); savedTextRange = null; savedTextBlockIndex = null; document.querySelectorAll('.block-handle').forEach((handle) => { handle.draggable = true; }); renderInspector(); renderSegmentNavigator(); };
const baseRenderImportedAssets = renderImportedAssets;
renderImportedAssets = function () { baseRenderImportedAssets(); };
document.getElementById('workspaceSwitcher')?.addEventListener('click', openProjectMenu);
document.querySelector('.script-panel')?.addEventListener('scroll', updateEditorScrollTools, { passive: true });
document.getElementById('backToTop')?.addEventListener('click', () => document.querySelector('.script-panel')?.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('resize', renderSegmentNavigator);
document.getElementById('windowMinimize')?.addEventListener('click', () => desktopApi?.minimize()); document.getElementById('windowMaximize')?.addEventListener('click', () => desktopApi?.toggleMaximize()); document.getElementById('windowClose')?.addEventListener('click', () => desktopApi?.closeWindow());
async function deleteBlock(index) {
  syncCurrentScene();
  const scene = currentScene();
  if (!scene?.blocks?.[index]) return;
  if (!(await requestDeleteConfirmation('确定删除这条内容吗？此操作无法直接撤销。'))) return;
  scene.blocks.splice(index, 1);
  selectedBlockIndex = Math.min(index, Math.max(0, scene.blocks.length - 1));
  renderScene();
  markDirty();
  showToast('\u5df2\u5220\u9664');
}
document.addEventListener('dragstart', (event) => { const handle = event.target.closest('.block-handle'); const block = handle?.closest('.script-block'); if (!block) return; draggedBlockIndex = Number(block.dataset.blockIndex); block.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', block.dataset.blockIndex); });
document.addEventListener('dragover', (event) => { const block = event.target.closest('.script-block'); if (!block || draggedBlockIndex === null) return; event.preventDefault(); document.querySelectorAll('.script-block').forEach((item) => item.classList.remove('drag-over')); if (Number(block.dataset.blockIndex) !== draggedBlockIndex) block.classList.add('drag-over'); });
document.addEventListener('drop', (event) => { const target = event.target.closest('.script-block'); if (!target || draggedBlockIndex === null) return; event.preventDefault(); const targetIndex = Number(target.dataset.blockIndex); syncCurrentScene(); const scene = currentScene(); if (targetIndex !== draggedBlockIndex) { const [moved] = scene.blocks.splice(draggedBlockIndex, 1); scene.blocks.splice(targetIndex, 0, moved); selectedBlockIndex = targetIndex; renderScene(); markDirty(); showToast('对白顺序已调整'); } draggedBlockIndex = null; });
document.addEventListener('dragend', () => { draggedBlockIndex = null; document.querySelectorAll('.script-block').forEach((item) => item.classList.remove('drag-over', 'dragging')); });
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-block-action]');
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    const block = action.closest('.script-block');
    const index = Number(block?.dataset.blockIndex);
    if (action.dataset.blockAction === 'delete') deleteBlock(index);
    return;
  }
  if (!event.target.closest('#workspaceSwitcher') && !event.target.closest('.project-popover')) document.querySelector('.project-popover')?.remove();
});
