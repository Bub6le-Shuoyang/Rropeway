const desktopApi = window.scriptroom;
desktopApi?.getVersion?.().then((version) => { const label = document.getElementById('appVersion'); if (label) label.textContent = `v${version}`; }).catch(() => {});
const navItems = document.querySelectorAll('.nav-item');
const views = { editor: document.getElementById('editorView'), characters: document.getElementById('charactersView'), assets: document.getElementById('assetsView'), home: document.getElementById('projectHomeView') };
const toast = document.getElementById('toast');
let desktopState = { filePath: null, data: null, dirty: false };
const LAST_PROJECT_STORAGE_KEY = 'scriptroom-last-project';
let activeChapterIndex = 0;
let activeSceneIndex = 0;
let selectedBlockIndex = 1;
let projectHistory = [];
let projectHistoryIndex = -1;
let restoringProjectHistory = false;
let editRevision = 0;
let autoSaveTimer = null;
let activeSavePromise = null;
let autoSaveQueued = false;
let suppressDeleteConfirmation = false;
let newDialogueCharacterId = '';
let savedTextRange = null;
let savedTextBlockIndex = null;
let segmentSlideshowTimers = new Set();
const expandedChapterIds = new Set();
let draggedChapterId = null;
let draggedSceneInfo = null;
let ignoreTreeClickUntil = 0;
const EDITOR_PREFERENCES_STORAGE_KEY = 'rropeway-editor-preferences';
const DEFAULT_EDITOR_PREFERENCES = { fontSize: 16, letterSpacing: 0, paragraphSpacing: 10, annotationSize: 9, slideshowInterval: 5 };
const LAYOUT_PREFERENCES_STORAGE_KEY = 'rropeway-layout-preferences';
const DEFAULT_LAYOUT_PREFERENCES = { sidebarCollapsed: false, sidebarWidth: 246, inspectorCollapsed: false, inspectorWidth: 276, floatingSections: [], floatingPositions: {} };

function normalizeEditorPreferences(value = {}) {
  const clamp = (input, minimum, maximum, fallback) => Math.min(maximum, Math.max(minimum, Number.isFinite(Number(input)) ? Number(input) : fallback));
  return {
    fontSize: clamp(value.fontSize, 12, 30, DEFAULT_EDITOR_PREFERENCES.fontSize),
    letterSpacing: clamp(value.letterSpacing, -1, 5, DEFAULT_EDITOR_PREFERENCES.letterSpacing),
    paragraphSpacing: clamp(value.paragraphSpacing, 0, 36, DEFAULT_EDITOR_PREFERENCES.paragraphSpacing),
    annotationSize: clamp(value.annotationSize, 6, 16, DEFAULT_EDITOR_PREFERENCES.annotationSize),
    slideshowInterval: clamp(value.slideshowInterval, 2, 30, DEFAULT_EDITOR_PREFERENCES.slideshowInterval)
  };
}
function currentEditorPreferences() {
  try { return normalizeEditorPreferences(JSON.parse(localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY) || '{}')); }
  catch { return { ...DEFAULT_EDITOR_PREFERENCES }; }
}
function applyEditorPreferences(value, persist = true) {
  const preferences = normalizeEditorPreferences(value);
  const root = document.documentElement;
  root.style.setProperty('--editor-font-size', `${preferences.fontSize}px`);
  root.style.setProperty('--editor-letter-spacing', `${preferences.letterSpacing}px`);
  root.style.setProperty('--editor-paragraph-spacing', `${preferences.paragraphSpacing}px`);
  root.style.setProperty('--editor-annotation-size', `${preferences.annotationSize}px`);
  if (persist) localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  return preferences;
}
function currentLayoutPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_STORAGE_KEY) || '{}');
    return {
      sidebarCollapsed: Boolean(stored.sidebarCollapsed),
      sidebarWidth: Math.min(380, Math.max(180, Number(stored.sidebarWidth) || DEFAULT_LAYOUT_PREFERENCES.sidebarWidth)),
      inspectorCollapsed: Boolean(stored.inspectorCollapsed),
      inspectorWidth: Math.min(460, Math.max(220, Number(stored.inspectorWidth) || DEFAULT_LAYOUT_PREFERENCES.inspectorWidth)),
      floatingSections: Array.isArray(stored.floatingSections) ? stored.floatingSections.filter((key) => ['properties', 'text'].includes(key)) : [],
      floatingPositions: stored.floatingPositions && typeof stored.floatingPositions === 'object' ? stored.floatingPositions : {}
    };
  } catch { return { ...DEFAULT_LAYOUT_PREFERENCES, floatingSections: [], floatingPositions: {} }; }
}
let layoutPreferences = currentLayoutPreferences();
function saveLayoutPreferences() { localStorage.setItem(LAYOUT_PREFERENCES_STORAGE_KEY, JSON.stringify(layoutPreferences)); }
function resetWindowLayout() {
  layoutPreferences = { ...DEFAULT_LAYOUT_PREFERENCES, floatingSections: [], floatingPositions: {} };
  applyLayoutPreferences(); renderInspector(); showToast('窗口布局已恢复默认');
}
function applyLayoutPreferences(persist = true) {
  document.body.classList.toggle('sidebar-collapsed', layoutPreferences.sidebarCollapsed);
  document.body.classList.toggle('inspector-collapsed', layoutPreferences.inspectorCollapsed);
  document.documentElement.style.setProperty('--sidebar-panel-width', `${layoutPreferences.sidebarWidth}px`);
  document.documentElement.style.setProperty('--inspector-panel-width', `${layoutPreferences.inspectorWidth}px`);
  const sidebarButton = document.getElementById('sidebarCollapseButton');
  if (sidebarButton) { sidebarButton.textContent = layoutPreferences.sidebarCollapsed ? '›' : '‹'; sidebarButton.title = layoutPreferences.sidebarCollapsed ? '展开左侧栏' : '收起左侧栏'; }
  const inspectorButton = document.getElementById('inspectorCollapseButton');
  if (inspectorButton) { inspectorButton.textContent = layoutPreferences.inspectorCollapsed ? '«' : '»'; inspectorButton.title = layoutPreferences.inspectorCollapsed ? '展开右侧栏' : '收起右侧栏'; }
  if (persist) saveLayoutPreferences();
}
function initializeLayoutControls() {
  const floatingLayer = document.getElementById('floatingInspectorLayer'); if (floatingLayer && floatingLayer.parentElement !== document.body) document.body.appendChild(floatingLayer);
  document.getElementById('sidebarCollapseButton')?.addEventListener('click', () => { layoutPreferences.sidebarCollapsed = !layoutPreferences.sidebarCollapsed; applyLayoutPreferences(); });
  document.getElementById('inspectorCollapseButton')?.addEventListener('click', () => { layoutPreferences.inspectorCollapsed = !layoutPreferences.inspectorCollapsed; applyLayoutPreferences(); });
  const resizeHandle = document.getElementById('inspectorResizeHandle');
  resizeHandle?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); layoutPreferences.inspectorCollapsed = false; applyLayoutPreferences(false);
    const startX = event.clientX; const startWidth = layoutPreferences.inspectorWidth;
    resizeHandle.setPointerCapture(event.pointerId); document.body.classList.add('inspector-resizing');
    const move = (moveEvent) => { layoutPreferences.inspectorWidth = Math.min(460, Math.max(220, startWidth + startX - moveEvent.clientX)); applyLayoutPreferences(false); };
    const finish = () => { document.body.classList.remove('inspector-resizing'); resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', finish); resizeHandle.removeEventListener('pointercancel', finish); saveLayoutPreferences(); };
    resizeHandle.addEventListener('pointermove', move); resizeHandle.addEventListener('pointerup', finish); resizeHandle.addEventListener('pointercancel', finish);
  });
  const sidebarResizeHandle = document.getElementById('sidebarResizeHandle');
  sidebarResizeHandle?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); layoutPreferences.sidebarCollapsed = false; applyLayoutPreferences(false);
    const startX = event.clientX; const startWidth = layoutPreferences.sidebarWidth;
    sidebarResizeHandle.setPointerCapture(event.pointerId); document.body.classList.add('sidebar-resizing');
    const move = (moveEvent) => { layoutPreferences.sidebarWidth = Math.min(380, Math.max(180, startWidth + moveEvent.clientX - startX)); applyLayoutPreferences(false); };
    const finish = () => { document.body.classList.remove('sidebar-resizing'); sidebarResizeHandle.removeEventListener('pointermove', move); sidebarResizeHandle.removeEventListener('pointerup', finish); sidebarResizeHandle.removeEventListener('pointercancel', finish); saveLayoutPreferences(); };
    sidebarResizeHandle.addEventListener('pointermove', move); sidebarResizeHandle.addEventListener('pointerup', finish); sidebarResizeHandle.addEventListener('pointercancel', finish);
  });
  window.addEventListener('resize', () => clampFloatingInspectorSections(true));
  applyLayoutPreferences(false);
}

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
function setSaveStatus(status) { document.getElementById('saveStatus').textContent = status; }
function setProjectLocationStatus(status) { document.getElementById('projectLocationStatus').textContent = status; }
function markDirty() {
  desktopState.dirty = true;
  editRevision += 1;
  desktopApi?.setDirty(true);
  setSaveStatus(desktopState.filePath ? '等待自动保存' : '未保存');
  recordProjectSnapshot();
  scheduleAutoSave();
}
function currentChapter() { return desktopState.data?.chapters?.[activeChapterIndex]; }
function currentScene() { return currentChapter()?.scenes?.[activeSceneIndex]; }
function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
function addChild(parent, tag, className, text) { const item = node(tag, className, text); parent.appendChild(item); return item; }
function clearSegmentSlideshows() {
  segmentSlideshowTimers.forEach((timer) => clearInterval(timer));
  segmentSlideshowTimers.clear();
}
function setupSegmentSlideshow(gallery, imageCount) {
  if (imageCount < 2) return;
  const track = gallery.querySelector('.segment-image-track');
  const dots = [...gallery.querySelectorAll('.segment-image-dot')];
  let activeIndex = 0;
  let timer = null;
  const showImage = (index) => {
    activeIndex = (index + imageCount) % imageCount;
    track.style.transform = `translateX(-${activeIndex * 100}%)`;
    dots.forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex === activeIndex));
  };
  const stop = () => { if (timer) { clearInterval(timer); segmentSlideshowTimers.delete(timer); } timer = null; };
  const start = () => {
    stop();
    timer = setInterval(() => showImage(activeIndex + 1), currentEditorPreferences().slideshowInterval * 1000);
    segmentSlideshowTimers.add(timer);
  };
  gallery.querySelector('.segment-image-previous')?.addEventListener('click', () => { showImage(activeIndex - 1); start(); });
  gallery.querySelector('.segment-image-next')?.addEventListener('click', () => { showImage(activeIndex + 1); start(); });
  dots.forEach((dot, dotIndex) => dot.addEventListener('click', () => { showImage(dotIndex); start(); }));
  gallery.addEventListener('mouseenter', stop);
  gallery.addEventListener('mouseleave', start);
  start();
}
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
    if (block.classList.contains('segment-block')) {
      let images = [];
      try { images = JSON.parse(block.dataset.segmentImages || '[]'); } catch {}
      return { type: 'segment', title: block.querySelector('.segment-title')?.textContent.trim() || '未命名分段', perspectiveCharacterId: block.dataset.perspectiveCharacterId || null, images };
    }
    if (block.classList.contains('narration')) return { type: 'narration', text: block.querySelector('.block-content p')?.textContent.trim() || '' };
    if (block.classList.contains('choice-block')) return { type: 'choice', title: block.querySelector('.choice-title')?.textContent.trim() || '', options: [...block.querySelectorAll('.choices button')].map((item) => item.querySelector('.choice-text')?.textContent.trim() || '') };
    const paragraph = block.querySelector('.block-content p');
    return { type: 'dialogue', character: block.querySelector('.character-name')?.textContent.trim() || '', characterId: block.dataset.characterId || '', characterKey: 'mei', characterColor: block.dataset.characterColor || '#b8bcb8', portraitPreset: block.dataset.portraitPreset || null, statusTags: [...block.querySelectorAll('.status-pill')].map((tag) => tag.textContent.trim()).filter(Boolean), voice: block.querySelector('.voice-pill')?.textContent.replace(/^♪\s*/, '').trim() || '', text: richTextPlainText(paragraph), textHtml: sanitizeRichTextHtml(paragraph?.innerHTML || ''), textAlign: paragraph?.style.textAlign || 'left', note: block.querySelector('.block-note')?.textContent.replace(/^注：/, '').trim() || '', portrait: block.dataset.portrait || undefined };
  });
}

function requestNotice(title, message) {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog');
    addChild(dialog, 'h3', '', title);
    addChild(dialog, 'p', 'editor-dialog-message', message);
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const confirm = addChild(actions, 'button', 'file-button save', '知道了');
    const close = () => { overlay.remove(); resolve(); };
    confirm.addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.body.appendChild(overlay);
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
function richTextPlainText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll('rt').forEach((annotation) => annotation.remove());
  return clone.textContent.trim();
}
function sanitizeRichTextHtml(html) {
  const source = document.createElement('template');
  const output = document.createElement('div');
  source.innerHTML = String(html || '');
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'SUP', 'SUB', 'RUBY', 'RT', 'BR']);
  const copySafeNode = (sourceNode, targetParent) => {
    if (sourceNode.nodeType === Node.TEXT_NODE) { targetParent.appendChild(document.createTextNode(sourceNode.textContent)); return; }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE'].includes(sourceNode.tagName)) return;
    if (!allowedTags.has(sourceNode.tagName)) { [...sourceNode.childNodes].forEach((child) => copySafeNode(child, targetParent)); return; }
    if (sourceNode.tagName === 'BR') { targetParent.appendChild(document.createElement('br')); return; }
    const tagName = sourceNode.tagName === 'FONT' ? 'span' : sourceNode.tagName.toLowerCase();
    const safeNode = document.createElement(tagName);
    ['color', 'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration', 'fontSize', 'fontFamily'].forEach((property) => { if (sourceNode.style?.[property]) safeNode.style[property] = sourceNode.style[property]; });
    if (sourceNode.tagName === 'FONT') {
      if (sourceNode.color) safeNode.style.color = sourceNode.color;
      if (sourceNode.face) safeNode.style.fontFamily = sourceNode.face;
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
function captureProject() { syncCurrentScene(); const data = desktopState.data; data.title = String(data.title || document.getElementById('workspaceTitle').textContent || 'Rropeway').trim(); data.chapters[0] && (data.chapters[0].title = data.chapters[0].title || '第一章'); return data; }
function updateUndoAvailability() {
  const undoButton = document.getElementById('undoProjectBtn');
  if (undoButton) undoButton.disabled = projectHistoryIndex <= 0;
  const toolbarUndo = document.querySelector('[title="撤销"]');
  const toolbarRedo = document.querySelector('[title="重做"]');
  if (toolbarUndo) toolbarUndo.disabled = projectHistoryIndex <= 0;
  if (toolbarRedo) toolbarRedo.disabled = projectHistoryIndex >= projectHistory.length - 1;
}
function resetProjectHistory() {
  if (!desktopState.data) return;
  projectHistory = [JSON.stringify(captureProject())];
  projectHistoryIndex = 0;
  updateUndoAvailability();
}
function recordProjectSnapshot() {
  if (restoringProjectHistory || !desktopState.data) return;
  const snapshot = JSON.stringify(captureProject());
  if (projectHistory[projectHistoryIndex] === snapshot) { updateUndoAvailability(); return; }
  projectHistory = projectHistory.slice(0, projectHistoryIndex + 1);
  projectHistory.push(snapshot);
  if (projectHistory.length > 120) projectHistory.shift();
  projectHistoryIndex = projectHistory.length - 1;
  updateUndoAvailability();
}
function restoreProjectHistory(targetIndex, message) {
  if (targetIndex < 0 || targetIndex >= projectHistory.length || targetIndex === projectHistoryIndex) return;
  clearTimeout(autoSaveTimer);
  const filePath = desktopState.filePath;
  restoringProjectHistory = true;
  projectHistoryIndex = targetIndex;
  applyProject(JSON.parse(projectHistory[projectHistoryIndex]), filePath, { resetHistory: false });
  restoringProjectHistory = false;
  desktopState.dirty = true;
  editRevision += 1;
  desktopApi?.setDirty(true);
  setSaveStatus(filePath ? '等待自动保存' : '未保存');
  updateUndoAvailability();
  scheduleAutoSave();
  showToast(message);
}
function undoProjectChange() {
  if (projectHistoryIndex <= 0) { showToast('没有可撤回的操作'); return; }
  restoreProjectHistory(projectHistoryIndex - 1, '已撤回上一步');
}
function redoProjectChange() {
  if (projectHistoryIndex >= projectHistory.length - 1) { showToast('没有可重做的操作'); return; }
  restoreProjectHistory(projectHistoryIndex + 1, '已重做');
}

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
    const images = Array.isArray(block.images) ? block.images : [];
    wrapper.dataset.segmentImages = JSON.stringify(images);
    wrapper.classList.toggle('has-images', images.length > 0);
    addChild(content, 'span', 'block-type', '对话分段');
    addChild(content, 'p', 'segment-title', block.title || '未命名分段');
    const perspective = (desktopState.data?.characters || []).find((item) => item.id === block.perspectiveCharacterId);
    addChild(content, 'small', 'segment-perspective', perspective ? `主视角：${perspective.name}` : '未设置主视角');
    if (block.perspectiveCharacterId) wrapper.dataset.perspectiveCharacterId = block.perspectiveCharacterId;
    if (images.length) {
      const gallery = addChild(content, 'div', 'segment-image-gallery segment-image-carousel');
      const viewport = addChild(gallery, 'div', 'segment-image-viewport');
      const track = addChild(viewport, 'div', 'segment-image-track');
      images.forEach((image) => {
        const figure = addChild(track, 'figure', 'segment-image-card segment-image-slide');
        const imageNode = addChild(figure, 'img'); imageNode.alt = image.name || '分段图片';
        addChild(figure, 'figcaption', '', image.name || '未命名图片');
        if (desktopState.filePath && image.relativePath) desktopApi.readAsset(desktopState.filePath, image.relativePath).then((src) => { if (src) imageNode.src = src; }).catch(() => figure.classList.add('asset-missing'));
      });
      if (images.length > 1) {
        const previous = addChild(gallery, 'button', 'segment-image-nav segment-image-previous', '‹'); previous.type = 'button'; previous.title = '上一张';
        const next = addChild(gallery, 'button', 'segment-image-nav segment-image-next', '›'); next.type = 'button'; next.title = '下一张';
        const dots = addChild(gallery, 'div', 'segment-image-dots');
        images.forEach((_image, imageIndex) => { const dot = addChild(dots, 'button', `segment-image-dot${imageIndex === 0 ? ' active' : ''}`); dot.type = 'button'; dot.title = `查看第 ${imageIndex + 1} 张`; });
      }
      setupSegmentSlideshow(gallery, images.length);
    }
  } else if (block.type === 'narration') {
    const paragraph = addChild(content, 'p', 'narration-text', block.text);
    paragraph.dataset.placeholder = '输入旁白内容…';
  } else if (block.type === 'choice') {
    addChild(wrapper, 'div', 'choice-icon', '↳'); addChild(content, 'span', 'block-type', '玩家选择'); addChild(content, 'p', 'choice-title', block.title);
    const choices = addChild(content, 'div', 'choices');
    (block.options || []).forEach((option) => { const button = addChild(choices, 'button'); addChild(button, 'span', 'choice-text', option); addChild(button, 'span', '', '→'); });
  } else {
    const character = (desktopState.data?.characters || []).find((item) => item.id === block.characterId || item.name === block.character);
    const hasCharacter = Boolean(character || String(block.character || '').trim());
    if (!Array.isArray(block.statusTags)) block.statusTags = [block.statusTag || block.emotion || ''].map((tag) => String(tag).trim()).filter(Boolean);
    const isPerspective = perspectiveCharacterIdAt(index) && perspectiveCharacterIdAt(index) === (block.characterId || character?.id);
    if (isPerspective) wrapper.classList.add('pov-dialogue');
    if (!hasCharacter) wrapper.classList.add('unassigned-dialogue');
    const meta = addChild(content, 'div', 'dialogue-meta');
    if (hasCharacter) {
      const thumb = addChild(meta, 'div', 'character-thumb', (block.character || character?.name || '').slice(0, 1)); thumb.style.background = block.characterColor || character?.color || '#f2674f';
      const nameNode = addChild(meta, 'span', 'character-name', block.character || character?.name || ''); nameNode.style.color = block.characterColor || character?.color || '#f2674f';
    } else addChild(meta, 'span', 'unassigned-character-hint', '未设置角色');
    if (isPerspective) addChild(meta, 'span', 'pov-pill', '主视角'); (block.statusTags || []).forEach((statusTag) => addChild(meta, 'span', 'status-pill', statusTag)); addChild(meta, 'span', 'voice-pill', `♪ ${block.voice || '未设定'}`);
    const paragraph = addChild(content, 'p');
    if (block.textHtml) paragraph.innerHTML = sanitizeRichTextHtml(block.textHtml); else paragraph.textContent = block.text || '';
    paragraph.style.textAlign = block.textAlign || 'left';
    if (block.note) addChild(content, 'div', 'block-note', `注：${block.note}`);
    if (block.portrait) wrapper.dataset.portrait = block.portrait; if (block.portraitPreset) wrapper.dataset.portraitPreset = block.portraitPreset; if (block.characterId || character?.id) wrapper.dataset.characterId = block.characterId || character.id; wrapper.dataset.characterColor = block.characterColor || character?.color || '#b8bcb8';
  }
  wrapper.appendChild(content);
  wrapper.querySelectorAll('p').forEach((paragraph) => { paragraph.contentEditable = 'true'; });
  return wrapper;
}

function renderScene() {
  clearSegmentSlideshows();
  const scene = currentScene(); if (!scene) return;
  const canvas = document.querySelector('.script-canvas'); const addButton = document.getElementById('flowAddActions');
  canvas.querySelectorAll('.script-block').forEach((block) => block.remove());
  (scene.blocks || []).forEach((block, index) => canvas.insertBefore(createBlockElement(block, index), addButton));
  selectedBlockIndex = Math.min(selectedBlockIndex, Math.max(0, (scene.blocks || []).length - 1));
  document.getElementById('sceneTitle').textContent = scene.title;
  document.getElementById('sceneSummary').textContent = scene.blocks?.length ? `${scene.blocks.length} 个内容块` : '空白场景';
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
function normalizeSceneNumbers(chapter) { chapter.scenes.forEach((scene, sceneIndex) => { scene.number = String(sceneIndex + 1).padStart(2, '0'); }); }
function closeTreeContextMenu() { document.querySelector('.tree-context-menu')?.remove(); }
function openTreeContextMenu(event, items) {
  event.preventDefault(); event.stopPropagation(); closeTreeContextMenu();
  const menu = addChild(document.body, 'div', 'tree-context-menu');
  items.forEach((item) => { const button = addChild(menu, 'button', item.danger ? 'danger' : '', item.label); button.type = 'button'; button.addEventListener('click', () => { closeTreeContextMenu(); item.action(); }); });
  const left = Math.min(event.clientX, window.innerWidth - 180); const top = Math.min(event.clientY, window.innerHeight - items.length * 36 - 16);
  menu.style.left = `${Math.max(8, left)}px`; menu.style.top = `${Math.max(8, top)}px`;
}
function restoreTreeSelection(chapterId, sceneId) {
  const chapters = desktopState.data.chapters;
  activeChapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === chapterId));
  const scenes = chapters[activeChapterIndex]?.scenes || [];
  activeSceneIndex = Math.max(0, scenes.findIndex((scene) => scene.id === sceneId));
  selectedBlockIndex = 0;
}
function finishTreeMutation(chapterId, sceneId, message) {
  restoreTreeSelection(chapterId, sceneId); renderChapters(); renderSceneTabs(); renderScene(); markDirty(); if (message) showToast(message);
}
function moveChapter(chapterId, targetChapterId) {
  if (!chapterId || chapterId === targetChapterId) return;
  syncCurrentScene();
  const chapters = desktopState.data.chapters; const activeChapterId = currentChapter()?.id; const activeSceneId = currentScene()?.id;
  const sourceIndex = chapters.findIndex((chapter) => chapter.id === chapterId); let targetIndex = chapters.findIndex((chapter) => chapter.id === targetChapterId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = chapters.splice(sourceIndex, 1); chapters.splice(targetIndex, 0, moved);
  finishTreeMutation(activeChapterId, activeSceneId, '章节顺序已调整');
}
function moveScene(sceneInfo, targetChapterId, targetSceneId = null) {
  if (!sceneInfo) return;
  syncCurrentScene();
  const chapters = desktopState.data.chapters; const activeChapterId = currentChapter()?.id; const activeSceneId = currentScene()?.id;
  const sourceChapter = chapters.find((chapter) => chapter.id === sceneInfo.chapterId); const targetChapter = chapters.find((chapter) => chapter.id === targetChapterId);
  if (!sourceChapter || !targetChapter) return;
  const sourceIndex = sourceChapter.scenes.findIndex((scene) => scene.id === sceneInfo.sceneId); if (sourceIndex < 0) return;
  if (sourceChapter !== targetChapter && sourceChapter.scenes.length <= 1) { showToast('每个章节至少需要保留一个场景'); return; }
  if (sourceChapter === targetChapter && targetSceneId === sceneInfo.sceneId) return;
  let targetIndex = targetSceneId ? targetChapter.scenes.findIndex((scene) => scene.id === targetSceneId) : targetChapter.scenes.length;
  if (targetIndex < 0) targetIndex = targetChapter.scenes.length;
  const [moved] = sourceChapter.scenes.splice(sourceIndex, 1);
  targetChapter.scenes.splice(targetIndex, 0, moved);
  normalizeSceneNumbers(sourceChapter); if (targetChapter !== sourceChapter) normalizeSceneNumbers(targetChapter);
  expandedChapterIds.add(targetChapter.id); expandedChapterIds.add(sourceChapter.id);
  finishTreeMutation(activeSceneId === moved.id ? targetChapter.id : activeChapterId, activeSceneId, '场景顺序已调整');
}
async function deleteChapter(chapterIndex) {
  const chapters = desktopState.data.chapters;
  if (chapters.length <= 1) { showToast('至少需要保留一个章节'); return; }
  const chapter = chapters[chapterIndex]; if (!chapter || !(await requestDeleteConfirmation(`确定删除章节「${chapter.title}」及其中全部场景吗？`))) return;
  syncCurrentScene(); const activeChapterId = currentChapter()?.id; const activeSceneId = currentScene()?.id;
  chapters.splice(chapterIndex, 1); expandedChapterIds.delete(chapter.id);
  const nextChapter = chapters[Math.min(chapterIndex, chapters.length - 1)]; const keepChapterId = activeChapterId === chapter.id ? nextChapter.id : activeChapterId; const keepSceneId = activeChapterId === chapter.id ? nextChapter.scenes[0]?.id : activeSceneId;
  expandedChapterIds.add(keepChapterId); finishTreeMutation(keepChapterId, keepSceneId, '章节已删除');
}
async function deleteScene(chapterIndex, sceneIndex) {
  const chapter = desktopState.data.chapters[chapterIndex];
  if (!chapter || chapter.scenes.length <= 1) { showToast('每个章节至少需要保留一个场景'); return; }
  const scene = chapter.scenes[sceneIndex]; if (!scene || !(await requestDeleteConfirmation(`确定删除场景「${scene.title}」吗？`))) return;
  syncCurrentScene(); const activeChapterId = currentChapter()?.id; const activeSceneId = currentScene()?.id;
  chapter.scenes.splice(sceneIndex, 1); normalizeSceneNumbers(chapter);
  const nextScene = chapter.scenes[Math.min(sceneIndex, chapter.scenes.length - 1)]; const keepSceneId = activeSceneId === scene.id ? nextScene.id : activeSceneId;
  finishTreeMutation(activeChapterId, keepSceneId, '场景已删除');
}
function clearTreeDragState() { if (draggedChapterId || draggedSceneInfo) ignoreTreeClickUntil = Date.now() + 160; draggedChapterId = null; draggedSceneInfo = null; document.querySelectorAll('.chapter-tree-node,.chapter-scene-entry').forEach((item) => item.classList.remove('dragging', 'drag-over')); }
async function renameChapterAt(chapterIndex) {
  const chapter = desktopState.data.chapters[chapterIndex];
  if (!chapter) return;
  const title = await requestTextInput('章节名称', chapter.title);
  if (!title) return;
  chapter.title = title;
  renderChapters();
  if (chapterIndex === activeChapterIndex) renderScene();
  markDirty();
}
async function renameSceneAt(chapterIndex, sceneIndex) {
  const scene = desktopState.data.chapters[chapterIndex]?.scenes?.[sceneIndex];
  if (!scene) return;
  const title = await requestTextInput('场景名称', scene.title);
  if (!title) return;
  scene.title = title;
  renderChapters();
  if (chapterIndex === activeChapterIndex) { renderSceneTabs(); renderScene(); }
  markDirty();
}
function renderChapters() {
  const list = document.getElementById('chapterList');
  list.replaceChildren();
  (desktopState.data?.chapters || []).forEach((chapter, index) => {
    const isExpanded = expandedChapterIds.has(chapter.id);
    const treeNode = addChild(list, 'div', 'chapter-tree-node');
    const entry = addChild(treeNode, 'div', 'chapter-entry');
    const toggle = addChild(entry, 'button', 'chapter-tree-toggle', isExpanded ? '▾' : '▸'); toggle.type = 'button'; toggle.title = isExpanded ? '折叠章节' : '展开章节';
    const button = addChild(entry, 'button', `chapter${index === activeChapterIndex ? ' active' : ''}`); button.draggable = true; button.title = '按住拖动章节，双击重命名';
    addChild(button, 'b', '', chapter.title);
    addChild(entry, 'span', 'chapter-scene-count', String(chapter.scenes.length));
    toggle.addEventListener('click', () => { if (isExpanded) expandedChapterIds.delete(chapter.id); else expandedChapterIds.add(chapter.id); renderChapters(); });
    button.addEventListener('click', () => {
      if (Date.now() < ignoreTreeClickUntil) return;
      syncCurrentScene();
      const wasActiveChapter = index === activeChapterIndex;
      expandedChapterIds.add(chapter.id);
      activeChapterIndex = index;
      activeSceneIndex = wasActiveChapter ? Math.min(activeSceneIndex, chapter.scenes.length - 1) : 0;
      selectedBlockIndex = 0;
      renderChapters();
      renderSceneTabs();
      renderScene();
      document.querySelector('[data-view="editor"]').click();
    });
    button.addEventListener('dblclick', (event) => { event.preventDefault(); renameChapterAt(index); });
    entry.addEventListener('contextmenu', (event) => openTreeContextMenu(event, [
      { label: '重命名章节', action: () => renameChapterAt(index) },
      { label: '删除章节', danger: true, action: () => deleteChapter(index) }
    ]));
    button.addEventListener('dragstart', (event) => { event.stopPropagation(); draggedChapterId = chapter.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', chapter.id); treeNode.classList.add('dragging'); });
    button.addEventListener('dragend', clearTreeDragState);
    treeNode.addEventListener('dragover', (event) => { if (!draggedChapterId && !draggedSceneInfo) return; event.preventDefault(); event.stopPropagation(); treeNode.classList.add('drag-over'); });
    treeNode.addEventListener('dragleave', () => treeNode.classList.remove('drag-over'));
    treeNode.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); if (draggedChapterId) moveChapter(draggedChapterId, chapter.id); else if (draggedSceneInfo) moveScene(draggedSceneInfo, chapter.id); clearTreeDragState(); });
    if (isExpanded) {
      const sceneList = addChild(treeNode, 'div', 'chapter-scene-list');
      chapter.scenes.forEach((scene, sceneIndex) => {
        const sceneEntry = addChild(sceneList, 'div', 'chapter-scene-entry');
        const sceneButton = addChild(sceneEntry, 'button', `chapter-scene-file${index === activeChapterIndex && sceneIndex === activeSceneIndex ? ' active' : ''}`); sceneButton.draggable = true; sceneButton.title = '按住拖动场景，双击重命名';
        addChild(sceneButton, 'span', 'scene-file-name', scene.title);
        addChild(sceneButton, 'span', 'scene-file-number', scene.number);
        sceneButton.addEventListener('click', () => {
          if (Date.now() < ignoreTreeClickUntil) return;
          syncCurrentScene();
          expandedChapterIds.add(chapter.id);
          activeChapterIndex = index;
          activeSceneIndex = sceneIndex;
          selectedBlockIndex = 0;
          renderChapters();
          renderSceneTabs();
          renderScene();
          document.querySelector('[data-view="editor"]').click();
        });
        sceneButton.addEventListener('dblclick', (event) => { event.preventDefault(); renameSceneAt(index, sceneIndex); });
        sceneEntry.addEventListener('contextmenu', (event) => openTreeContextMenu(event, [
          { label: '重命名场景', action: () => renameSceneAt(index, sceneIndex) },
          { label: '删除场景', danger: true, action: () => deleteScene(index, sceneIndex) }
        ]));
        sceneButton.addEventListener('dragstart', (event) => { event.stopPropagation(); draggedSceneInfo = { chapterId: chapter.id, sceneId: scene.id }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', scene.id); sceneEntry.classList.add('dragging'); });
        sceneButton.addEventListener('dragend', clearTreeDragState);
        sceneEntry.addEventListener('dragover', (event) => { if (!draggedSceneInfo) return; event.preventDefault(); event.stopPropagation(); sceneEntry.classList.add('drag-over'); });
        sceneEntry.addEventListener('dragleave', () => sceneEntry.classList.remove('drag-over'));
        sceneEntry.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); moveScene(draggedSceneInfo, chapter.id, scene.id); clearTreeDragState(); });
      });
    }
  });
}

function renderImportedAssets() {
  const grid = document.querySelector('.asset-grid'); if (!grid) return; grid.replaceChildren();
  const assets = desktopState.data?.assets || [];
  if (!assets.length) {
    const empty = node('div', 'asset-library-empty'); empty.dataset.imported = 'true';
    addChild(empty, 'b', '', '素材库还是空的'); addChild(empty, 'span', '', '导入图片后会复制到当前项目的 assets/images 目录。');
    grid.appendChild(empty);
    return;
  }
  const groups = new Map();
  assets.forEach((asset) => { const tag = asset.tags?.[0] || '未归档'; if (!groups.has(tag)) groups.set(tag, []); groups.get(tag).push(asset); });
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => { if (left === '未归档') return -1; if (right === '未归档') return 1; return left.localeCompare(right, 'zh-CN'); });
  orderedGroups.forEach(([tag, taggedAssets]) => {
    const group = addChild(grid, 'section', 'asset-tag-group'); group.dataset.imported = 'true';
    const heading = addChild(group, 'div', 'asset-tag-group-heading'); addChild(heading, 'h3', '', tag); addChild(heading, 'span', '', `${taggedAssets.length} 项素材`);
    const groupGrid = addChild(group, 'div', 'asset-tag-group-grid');
    taggedAssets.forEach((asset) => renderAssetCard(asset, groupGrid));
  });
}
function renderAssetCard(asset, grid) {
    const card = node('div', 'asset-card imported-asset'); card.dataset.imported = 'true'; card.dataset.assetId = asset.id;
    const kind = ['mp3', 'wav', 'ogg'].includes(asset.type) ? '音效' : '图片';
    const header = addChild(card, 'div', 'asset-card-header'); addChild(header, 'span', 'asset-kind', kind);
    const tagButton = addChild(header, 'button', `asset-tag-button${asset.tags?.length ? ' assigned' : ''}`, asset.tags?.[0] ? `# ${asset.tags[0]}` : '# 归档'); tagButton.type = 'button'; tagButton.title = asset.tags?.[0] ? `归档于 ${asset.tags[0]}，点击修改` : '将素材归档到 Tag'; tagButton.addEventListener('click', () => editAssetTag(asset));
    const nameRow = addChild(card, 'div', 'asset-name-row');
    const name = addChild(nameRow, 'b', 'asset-name', asset.name); name.title = asset.name;
    const rename = addChild(nameRow, 'button', 'asset-rename-button', '✎'); rename.type = 'button'; rename.title = '重命名素材'; rename.setAttribute('aria-label', `重命名素材 ${asset.name}`); rename.addEventListener('click', () => renameAsset(asset));
    const actions = addChild(card, 'div', 'asset-actions');
    if (kind === '图片') { const background = addChild(actions, 'button', 'asset-action', '设为背景'); background.addEventListener('click', () => bindAsset(asset, 'background')); const portrait = addChild(actions, 'button', 'asset-action', '设为立绘'); portrait.addEventListener('click', () => bindAsset(asset, 'portrait')); }
    const show = addChild(actions, 'button', 'asset-action', '打开位置'); show.addEventListener('click', () => desktopApi?.showItem(desktopState.filePath, asset.relativePath));
    const remove = addChild(actions, 'button', 'asset-action danger', '删除'); remove.addEventListener('click', () => deleteAsset(asset));
    if (desktopState.filePath && kind === '图片') desktopApi.readAsset(desktopState.filePath, asset.relativePath).then((src) => { if (src) card.style.backgroundImage = `linear-gradient(180deg, transparent 25%, rgba(30,35,33,.7)), url("${src}")`; }).catch(() => {});
    grid.appendChild(card);
}
function requestAssetTag(asset) {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay'); const dialog = addChild(overlay, 'div', 'editor-dialog');
    addChild(dialog, 'h3', '', '素材归档 Tag'); addChild(dialog, 'p', 'editor-dialog-message', '每个素材可归档到一个 Tag；留空或点击“取消归档”会放回未归档分类。');
    const input = addChild(dialog, 'input', 'editor-dialog-input'); input.value = asset.tags?.[0] || ''; input.placeholder = '例如：背景、角色立绘、战斗音效';
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const unarchive = addChild(actions, 'button', 'file-button', '取消归档'); unarchive.type = 'button'; unarchive.disabled = !asset.tags?.length;
    const cancel = addChild(actions, 'button', 'file-button', '取消'); cancel.type = 'button';
    const save = addChild(actions, 'button', 'file-button save', '保存'); save.type = 'button';
    const close = (value) => { overlay.remove(); resolve(value); };
    unarchive.addEventListener('click', () => close(''));
    cancel.addEventListener('click', () => close(null)); save.addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') close(input.value.trim()); if (event.key === 'Escape') close(null); });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    document.body.appendChild(overlay); requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
async function editAssetTag(asset) {
  const tag = await requestAssetTag(asset); if (tag === null) return;
  asset.tags = tag ? [tag] : [];
  renderImportedAssets(); markDirty(); showToast(tag ? `素材已归档到“${tag}”` : '素材已移回未归档');
}
async function renameAsset(asset) {
  const nextName = await requestTextInput('重命名素材', asset.name || '未命名素材');
  if (!nextName || nextName === asset.name) return;
  const previousName = asset.name;
  asset.name = nextName;
  (desktopState.data?.chapters || []).forEach((chapter) => chapter.scenes.forEach((scene) => scene.blocks.forEach((block) => {
    if (block.type !== 'segment' || !Array.isArray(block.images)) return;
    block.images.forEach((image) => { if ((image.assetId && image.assetId === asset.id) || image.relativePath === asset.relativePath) image.name = nextName; });
  })));
  renderImportedAssets(); renderScene(); renderInspector(); markDirty();
  showToast(`已将“${previousName}”重命名为“${nextName}”`);
}
function bindAsset(asset, mode) { syncCurrentScene(); const scene = currentScene(); if (mode === 'background') { scene.background = asset.relativePath; showToast(`已将「${asset.name}」设为场景背景`); } else { const block = scene.blocks[selectedBlockIndex]; if (!block || block.type !== 'dialogue') { showToast('请先选择一条对白'); return; } block.portrait = asset.relativePath; document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"]`)?.setAttribute('data-portrait', asset.relativePath); showToast(`已将「${asset.name}」绑定到当前对白`); } markDirty(); }

function setDialogueCharacterMenuOpen(open) {
  const picker = document.getElementById('dialogueCharacterPicker');
  const button = document.getElementById('dialogueCharacterPickerButton');
  const menu = document.getElementById('dialogueCharacterMenu');
  if (!picker || !button || !menu) return;
  picker.classList.toggle('open', open);
  menu.hidden = !open;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}
function removeAssetReferences(relativePath) {
  return window.RropewayAssetReferences.removeAssetReferences(desktopState.data, relativePath);
}
async function deleteAsset(asset) {
  if (!desktopState.filePath || !asset?.relativePath) return;
  const confirmed = await requestConfirmation(`确定删除素材“${asset.name}”吗？\n素材文件会移入回收站，并从场景、对白和分段中移除全部引用。`);
  if (!confirmed) return;
  try {
    await desktopApi.deleteAsset(desktopState.filePath, asset.relativePath);
    const referenceCount = removeAssetReferences(asset.relativePath);
    desktopState.data.assets = desktopState.data.assets.filter((item) => item.id !== asset.id);
    renderImportedAssets(); renderScene(); renderInspector(); markDirty();
    showToast(referenceCount ? `素材已删除，并清理 ${referenceCount} 处引用` : '素材已删除');
  } catch (error) { showToast(error.message || '素材删除失败'); }
}
function syncDialogueCreationState() {
  const addButton = document.getElementById('addDialogue');
  const avatar = document.getElementById('dialogueCharacterPickerAvatar');
  const label = document.getElementById('dialogueCharacterPickerLabel');
  const menu = document.getElementById('dialogueCharacterMenu');
  if (!addButton || !avatar || !label || !menu) return;
  const characters = desktopState.data?.characters || [];
  if (!characters.some((character) => character.id === newDialogueCharacterId)) newDialogueCharacterId = '';
  const selectedCharacter = characters.find((character) => character.id === newDialogueCharacterId);
  avatar.textContent = selectedCharacter ? selectedCharacter.name.slice(0, 1) : '—';
  avatar.style.background = selectedCharacter?.color || '#ffe5da';
  avatar.style.color = selectedCharacter ? '#fff' : '#c96c56';
  label.textContent = selectedCharacter?.name || '不设置角色';
  menu.replaceChildren();
  addChild(menu, 'div', 'dialogue-character-menu-title', '新增对白角色');
  const addOption = (character) => {
    const characterId = character?.id || '';
    const option = addChild(menu, 'button', `dialogue-character-option${characterId === newDialogueCharacterId ? ' selected' : ''}`); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(characterId === newDialogueCharacterId));
    const optionAvatar = addChild(option, 'span', 'dialogue-character-option-avatar', character ? character.name.slice(0, 1) : '—'); optionAvatar.style.background = character?.color || '#ffe5da'; optionAvatar.style.color = character ? '#fff' : '#c96c56';
    const copy = addChild(option, 'span', 'dialogue-character-option-copy'); addChild(copy, 'b', '', character?.name || '不设置角色'); addChild(copy, 'small', '', character?.role || (character ? '未设置角色定位' : '对白中不显示头像和名称'));
    addChild(option, 'span', 'dialogue-character-option-check', characterId === newDialogueCharacterId ? '✓' : '');
    option.addEventListener('click', () => { newDialogueCharacterId = characterId; syncDialogueCreationState(); setDialogueCharacterMenuOpen(false); });
  };
  addOption(null);
  characters.forEach(addOption);
  if (!characters.length) addChild(menu, 'div', 'dialogue-character-menu-empty', '可前往“角色与立绘”创建角色');
  addButton.disabled = false;
}
function updateProjectTitle(title) {
  const normalizedTitle = String(title || '').trim() || 'Rropeway';
  desktopState.data.title = normalizedTitle;
  document.getElementById('workspaceTitle').textContent = normalizedTitle;
  document.title = `${normalizedTitle} · Rropeway`;
  return normalizedTitle;
}
async function renameProject() {
  if (!desktopState.data) return;
  const title = await requestTextInput('项目名称', desktopState.data.title || 'Rropeway');
  if (!title?.trim()) return;
  const normalizedTitle = updateProjectTitle(title);
  if (desktopState.filePath) rememberProject(desktopState.filePath, normalizedTitle);
  renderProjectSearchResults();
  markDirty();
  showToast(`项目已重命名为「${normalizedTitle}」`);
}
function applyProject(data, filePath = null, options = {}) { clearTimeout(autoSaveTimer); autoSaveQueued = false; document.body.classList.remove('project-home-active'); views.home?.classList.add('hidden'); desktopState.data = data; desktopState.filePath = filePath; activeChapterIndex = 0; activeSceneIndex = 0; selectedBlockIndex = 0; newDialogueCharacterId = ''; expandedChapterIds.clear(); if (data.chapters[0]) expandedChapterIds.add(data.chapters[0].id); updateProjectTitle(data.title); syncDialogueCreationState(); renderChapters(); renderSceneTabs(); renderScene(); renderImportedAssets(); desktopState.dirty = false; desktopApi?.setDirty(false); setProjectLocationStatus(filePath ? '本地项目' : '本地新项目'); setSaveStatus(filePath ? '已保存' : '未保存'); document.querySelector('[data-view="editor"]')?.click(); if (options.resetHistory !== false) resetProjectHistory(); else updateUndoAvailability(); }
function scheduleAutoSave(delay = 700) {
  clearTimeout(autoSaveTimer);
  if (!desktopState.filePath || !desktopState.dirty || restoringProjectHistory) return;
  autoSaveTimer = setTimeout(() => saveProject({ silent: true }), delay);
}
async function saveProject(options = {}) {
  if (!desktopApi) return false;
  const silent = Boolean(options.silent);
  clearTimeout(autoSaveTimer);
  if (activeSavePromise) { autoSaveQueued = true; return activeSavePromise; }
  const revisionAtStart = editRevision;
  const payload = { filePath: desktopState.filePath, data: JSON.parse(JSON.stringify(captureProject())) };
  setSaveStatus(silent ? '正在自动保存' : '正在保存');
  activeSavePromise = (async () => {
    try {
      const result = await desktopApi.saveProject(payload);
      if (!result) { setSaveStatus('未保存'); return false; }
      desktopState.filePath = result.filePath;
      setProjectLocationStatus('本地项目');
      rememberProject(result.filePath, result.data.title);
      if (editRevision === revisionAtStart) {
        desktopState.data = result.data;
        desktopState.dirty = false;
        desktopApi.setDirty(false);
        localStorage.removeItem('scriptroom-draft');
        setSaveStatus('已保存');
      } else {
        desktopState.dirty = true;
        desktopApi.setDirty(true);
        autoSaveQueued = true;
        setSaveStatus('未保存');
      }
      if (!silent) showToast('项目已保存');
      return true;
    } catch (error) {
      setSaveStatus('保存失败');
      showToast(error.message || '保存失败');
      return false;
    }
  })();
  const saved = await activeSavePromise;
  activeSavePromise = null;
  if (autoSaveQueued) { autoSaveQueued = false; scheduleAutoSave(160); }
  return saved;
}
async function prepareProjectSwitch(message) {
  if (!desktopState.dirty) return true;
  if (desktopState.filePath) {
    clearTimeout(autoSaveTimer);
    autoSaveQueued = false;
    while (activeSavePromise) await activeSavePromise;
    if (desktopState.dirty) return saveProject({ silent: true });
    return true;
  }
  return requestConfirmation(message);
}
function showProjectHome(resetForm = false) {
  clearTimeout(autoSaveTimer);
  desktopState = { filePath: null, data: null, dirty: false };
  desktopApi?.setDirty(false);
  projectHistory = [];
  projectHistoryIndex = -1;
  document.body.classList.add('project-home-active');
  views.home?.classList.remove('hidden');
  navItems.forEach((item) => item.classList.remove('active'));
  document.getElementById('chapterList')?.replaceChildren();
  document.getElementById('workspaceTitle').textContent = '未打开项目';
  document.title = 'Rropeway · 本地剧本编辑器';
  setProjectLocationStatus('本地');
  setSaveStatus('未打开项目');
  updateUndoAvailability();
  if (resetForm) document.getElementById('projectCreateForm')?.reset();
}
async function createProjectFromHome(event) {
  event?.preventDefault();
  const title = document.getElementById('projectCreateName')?.value.trim();
  const description = document.getElementById('projectCreateDescription')?.value.trim();
  const directory = document.getElementById('projectCreateLocation')?.value.trim();
  if (!title) { showToast('请输入仓库名称'); document.getElementById('projectCreateName')?.focus(); return; }
  if (!directory) { showToast('请选择项目保存位置'); return; }
  try {
    const result = await desktopApi.createProject({ title, description, directory });
    applyProject(result.data, result.filePath);
    showToast('项目已创建');
  } catch (error) { showToast(error.message || '项目创建失败'); }
}
async function openProject() { if (desktopState.data && !(await prepareProjectSwitch('当前项目有未保存修改，确定打开另一个项目吗？'))) return; try { const result = await desktopApi.openProject(); if (result) { applyProject(result.data, result.filePath); showToast('项目已打开'); } } catch (error) { showToast(error.message || '打开失败'); } }
async function newProject() { if (desktopState.data && !(await prepareProjectSwitch('当前项目有未保存修改，确定新建项目吗？'))) return; showProjectHome(true); document.getElementById('projectCreateName')?.focus(); }
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

navItems.forEach((item) => item.addEventListener('click', () => {
  if (!desktopState.data) { showToast('请先创建或打开项目'); return; }
  const target = item.dataset.view;
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  document.querySelector('.editor-layout').classList.toggle('hidden', target !== 'editor');
  views.characters.classList.toggle('hidden', target !== 'characters'); views.assets.classList.toggle('hidden', target !== 'assets');
  document.getElementById('floatingInspectorLayer')?.classList.toggle('hidden', target !== 'editor');
  const breadcrumb = document.querySelector('.breadcrumb'); const separator = breadcrumb?.querySelector('span:nth-child(2)'); const detail = breadcrumb?.querySelector('strong');
  breadcrumb?.querySelector('span:first-child')?.replaceChildren(document.createTextNode(target === 'characters' ? '角色与立绘' : target === 'assets' ? '项目素材库' : '剧本编辑器'));
  if (separator) separator.hidden = target !== 'editor'; if (detail) detail.hidden = target !== 'editor';
  if (target === 'characters') renderCharacters(); if (target === 'assets') renderImportedAssets();
}));
document.addEventListener('click', (event) => {
  const block = event.target.closest('.script-block');
  if (block) {
    selectedBlockIndex = Number(block.dataset.blockIndex || 0);
    document.querySelectorAll('.script-block').forEach((item) => item.classList.toggle('selected', item === block));
    renderInspector();
  }
  if (event.target.closest('#addDialogue')) {
    syncCurrentScene();
    const character = desktopState.data.characters?.find((item) => item.id === newDialogueCharacterId);
    currentScene().blocks.push({ type: 'dialogue', character: character?.name || '', characterId: character?.id || '', characterKey: 'mei', characterColor: character?.color || '#b8bcb8', portraitPreset: character?.portraitPreset || null, statusTags: [], voice: '', text: '', textHtml: '', textAlign: 'left' });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] p`)?.focus();
    markDirty();
    showToast('已添加一条对白');
  }
  if (event.target.closest('#addNarration')) {
    syncCurrentScene();
    currentScene().blocks.push({ type: 'narration', text: '' });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .narration-text`)?.focus();
    markDirty();
    showToast('已添加一条旁白');
  }
  if (event.target.closest('#addSegment')) {
    syncCurrentScene();
    const segmentNumber = currentScene().blocks.filter((item) => item.type === 'segment').length + 1;
    currentScene().blocks.push({ type: 'segment', title: `分段 ${segmentNumber}`, perspectiveCharacterId: null });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    markDirty();
    showToast('已添加分段');
  }
});
document.getElementById('dialogueCharacterPickerButton')?.addEventListener('click', (event) => { event.stopPropagation(); const menu = document.getElementById('dialogueCharacterMenu'); setDialogueCharacterMenuOpen(Boolean(menu?.hidden)); });
document.addEventListener('click', (event) => { if (!event.target.closest('#dialogueCharacterPicker')) setDialogueCharacterMenuOpen(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setDialogueCharacterMenuOpen(false); });
document.addEventListener('input', (event) => { if (event.target.closest('[contenteditable="true"]')) { if (event.target.closest('.segment-title')) renderSegmentNavigator(); markDirty(); } });
document.querySelector('[title="撤销"]')?.addEventListener('click', undoProjectChange);
document.querySelector('[title="重做"]')?.addEventListener('click', redoProjectChange);
document.getElementById('addChapter')?.addEventListener('click', () => { const chapters = desktopState.data.chapters; const chapterNumber = chapters.length + 1; const chapter = { id: `chapter-${Date.now()}`, title: `未命名章节 ${chapterNumber}`, status: '草稿', scenes: [{ id: `scene-${Date.now()}`, number: '01', title: '未命名场景', blocks: [] }] }; chapters.push(chapter); expandedChapterIds.add(chapter.id); activeChapterIndex = chapters.length - 1; activeSceneIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]').click(); markDirty(); showToast('已添加新章节'); });
function setWindowProjectMenuOpen(open) {
  const menu = document.getElementById('windowProjectMenu'); const button = document.getElementById('projectMenuButton');
  if (!menu || !button) return;
  menu.hidden = !open;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}
function closeWindowProjectMenu() { setWindowProjectMenuOpen(false); }
document.getElementById('projectMenuButton')?.addEventListener('click', (event) => { event.stopPropagation(); closeWindowSettingsMenu(); const menu = document.getElementById('windowProjectMenu'); setWindowProjectMenuOpen(Boolean(menu?.hidden)); });
document.getElementById('newProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); newProject(); }); document.getElementById('openProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); openProject(); }); document.getElementById('saveProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); saveProject(); }); document.getElementById('undoProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); undoProjectChange(); }); document.getElementById('renameProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); renameProject(); }); document.getElementById('importAssetsBtn')?.addEventListener('click', importAssets);
function applyInterfaceScale(scale, persist = true) {
  const safeScale = [90, 100, 110].includes(Number(scale)) ? Number(scale) : 100;
  document.body.style.zoom = String(safeScale / 100);
  if (persist) localStorage.setItem('rropeway-interface-scale', String(safeScale));
  updateSettingsMenuState();
}
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
function currentThemePreference() {
  const value = localStorage.getItem('rropeway-theme') || 'light';
  return ['light', 'dark', 'system'].includes(value) ? value : 'light';
}
function updateSettingsMenuState() {
  const theme = currentThemePreference();
  const scale = Number(localStorage.getItem('rropeway-interface-scale') || 100);
  document.querySelectorAll('[data-theme-option]').forEach((button) => button.classList.toggle('active', button.dataset.themeOption === theme));
  document.querySelectorAll('[data-scale-option]').forEach((button) => button.classList.toggle('active', Number(button.dataset.scaleOption) === scale));
}
function applyThemePreference(theme, persist = true) {
  const preference = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
  const resolvedTheme = preference === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : preference;
  document.body.dataset.theme = resolvedTheme;
  document.body.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#171a1d' : '#f8f7f4');
  if (persist) localStorage.setItem('rropeway-theme', preference);
  updateSettingsMenuState();
}
function setWindowSettingsMenuOpen(open) {
  const menu = document.getElementById('windowSettingsMenu'); const button = document.getElementById('windowSettingsButton');
  if (!menu || !button) return;
  menu.hidden = !open;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
  if (open) updateSettingsMenuState();
}
function closeWindowSettingsMenu() { setWindowSettingsMenuOpen(false); }
function openApplicationDialog(type) {
  document.querySelector('.application-dialog-overlay')?.remove();
  const overlay = addChild(document.body, 'div', 'editor-dialog-overlay application-dialog-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog application-dialog');
  const header = addChild(dialog, 'div', 'application-dialog-header');
  addChild(header, 'h3', '', '帮助与快捷键');
  const close = addChild(header, 'button', 'application-dialog-close', '×'); close.type = 'button'; close.title = '关闭';
  const body = addChild(dialog, 'div', 'application-dialog-body');
  addChild(body, 'p', 'application-dialog-description', '常用操作均可通过键盘或章节树完成。');
  const shortcuts = addChild(body, 'div', 'shortcut-list');
  [['全项目搜索', 'Ctrl + K'], ['新建项目', 'Ctrl + N'], ['打开项目', 'Ctrl + O'], ['保存项目', 'Ctrl + S'], ['打开设置', 'Ctrl + ,'], ['撤回上一步', 'Ctrl + Z'], ['重命名章节或场景', '双击名称'], ['管理章节或场景', '右键菜单'], ['调整章节或场景顺序', '按住对应行拖动']].forEach(([label, keys]) => {
    const row = addChild(shortcuts, 'div', 'shortcut-row'); addChild(row, 'span', '', label); addChild(row, 'kbd', '', keys);
  });
  const dismiss = () => overlay.remove();
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
}
function openEditorPreferencesDialog() {
  document.querySelector('.application-dialog-overlay')?.remove();
  const overlay = addChild(document.body, 'div', 'editor-dialog-overlay application-dialog-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog application-dialog editor-preferences-dialog');
  const header = addChild(dialog, 'div', 'application-dialog-header');
  const heading = addChild(header, 'div'); addChild(heading, 'h3', '', '编辑器偏好设置'); addChild(heading, 'p', 'preferences-dialog-subtitle', '设置新项目和所有剧本编辑区域使用的默认文字样式。');
  const close = addChild(header, 'button', 'application-dialog-close', '×'); close.type = 'button'; close.title = '关闭';
  const body = addChild(dialog, 'div', 'application-dialog-body preferences-dialog-body');
  const preview = addChild(body, 'div', 'editor-preferences-preview');
  addChild(preview, 'span', 'editor-preferences-preview-label', '实时预览');
  const previewMeta = addChild(preview, 'div', 'editor-preferences-preview-meta'); addChild(previewMeta, 'span', 'editor-preferences-preview-avatar', '林'); addChild(previewMeta, 'b', '', '林澈');
  const previewText = addChild(preview, 'p'); previewText.append(document.createTextNode('码头的灯正在逐盏熄灭，')); const ruby = addChild(previewText, 'ruby', '', '潮声'); addChild(ruby, 'rt', '', '环境提示'); previewText.append(document.createTextNode('比平时更近。'));
  const controls = addChild(body, 'div', 'editor-preferences-controls');
  const definitions = [
    { key: 'fontSize', label: '默认字号', description: '对白和旁白正文的基础字号', min: 12, max: 30, step: 1, unit: 'px' },
    { key: 'letterSpacing', label: '文字间距', description: '调整每个字符之间的距离', min: -1, max: 5, step: 0.1, unit: 'px' },
    { key: 'paragraphSpacing', label: '段落间距', description: '正文段落之间及角色信息后的留白', min: 0, max: 36, step: 1, unit: 'px' },
    { key: 'annotationSize', label: '上方注释字号', description: '显示在正文上方的小型注释文字', min: 6, max: 16, step: 1, unit: 'px' },
    { key: 'slideshowInterval', label: '分段图片轮播', description: '多张分段图片自动切换的时间间隔', min: 2, max: 30, step: 1, unit: '秒' }
  ];
  const initial = currentEditorPreferences();
  const inputs = {};
  const updatePreview = () => {
    const values = normalizeEditorPreferences(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.number.value])));
    previewText.style.fontSize = `${values.fontSize}px`;
    previewText.style.letterSpacing = `${values.letterSpacing}px`;
    previewText.style.marginTop = `${values.paragraphSpacing}px`;
    previewText.querySelector('rt').style.fontSize = `${values.annotationSize}px`;
  };
  definitions.forEach((definition) => {
    const row = addChild(controls, 'div', 'editor-preference-row');
    const copy = addChild(row, 'div', 'editor-preference-copy'); addChild(copy, 'b', '', definition.label); addChild(copy, 'small', '', definition.description);
    const inputArea = addChild(row, 'div', 'editor-preference-inputs');
    const range = addChild(inputArea, 'input'); range.type = 'range'; range.min = String(definition.min); range.max = String(definition.max); range.step = String(definition.step); range.value = String(initial[definition.key]);
    const numberWrap = addChild(inputArea, 'label', 'editor-preference-number'); const number = addChild(numberWrap, 'input'); number.type = 'number'; number.min = String(definition.min); number.max = String(definition.max); number.step = String(definition.step); number.value = String(initial[definition.key]); addChild(numberWrap, 'span', '', definition.unit);
    inputs[definition.key] = { range, number };
    range.addEventListener('input', () => { number.value = range.value; updatePreview(); });
    number.addEventListener('input', () => { range.value = number.value; updatePreview(); });
  });
  const actions = addChild(body, 'div', 'editor-dialog-actions preferences-dialog-actions');
  const reset = addChild(actions, 'button', 'file-button preferences-reset-button', '恢复默认'); reset.type = 'button';
  const cancel = addChild(actions, 'button', 'file-button', '取消'); cancel.type = 'button';
  const save = addChild(actions, 'button', 'file-button save', '保存偏好'); save.type = 'button';
  const dismiss = () => overlay.remove();
  reset.addEventListener('click', () => { Object.entries(inputs).forEach(([key, input]) => { input.range.value = String(DEFAULT_EDITOR_PREFERENCES[key]); input.number.value = String(DEFAULT_EDITOR_PREFERENCES[key]); }); updatePreview(); });
  cancel.addEventListener('click', dismiss);
  close.addEventListener('click', dismiss);
  save.addEventListener('click', () => { applyEditorPreferences(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.number.value]))); renderScene(); dismiss(); showToast('编辑器偏好已保存'); });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
  updatePreview();
}
document.getElementById('windowSettingsButton')?.addEventListener('click', (event) => { event.stopPropagation(); closeWindowProjectMenu(); const menu = document.getElementById('windowSettingsMenu'); setWindowSettingsMenuOpen(Boolean(menu?.hidden)); });
document.querySelectorAll('[data-theme-option]').forEach((button) => button.addEventListener('click', () => { applyThemePreference(button.dataset.themeOption); closeWindowSettingsMenu(); }));
document.querySelectorAll('[data-scale-option]').forEach((button) => button.addEventListener('click', () => { applyInterfaceScale(Number(button.dataset.scaleOption)); closeWindowSettingsMenu(); }));
document.getElementById('editorPreferencesBtn')?.addEventListener('click', () => { closeWindowSettingsMenu(); openEditorPreferencesDialog(); });
document.getElementById('resetWindowLayoutBtn')?.addEventListener('click', () => { closeWindowSettingsMenu(); resetWindowLayout(); });
document.getElementById('windowHelpButton')?.addEventListener('click', () => { closeWindowProjectMenu(); closeWindowSettingsMenu(); openApplicationDialog('help'); });
systemThemeQuery.addEventListener('change', () => { if (currentThemePreference() === 'system') applyThemePreference('system', false); });
function projectSearchText(value) {
  const container = document.createElement('div'); container.innerHTML = String(value || ''); return (container.textContent || '').replace(/\s+/g, ' ').trim();
}
function collectProjectSearchResults(query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || !desktopState.data) return [];
  const results = [];
  const matches = (...values) => values.some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
  if (matches(desktopState.data.title)) results.push({ type: '项目', title: desktopState.data.title, detail: desktopState.filePath || '尚未保存到磁盘', view: 'editor', chapterIndex: activeChapterIndex, sceneIndex: activeSceneIndex });
  (desktopState.data.chapters || []).forEach((chapter, chapterIndex) => {
    if (matches(chapter.title, chapter.status)) results.push({ type: '章节', title: chapter.title, detail: `${chapter.scenes.length} 个场景`, view: 'editor', chapterIndex, sceneIndex: 0 });
    (chapter.scenes || []).forEach((scene, sceneIndex) => {
      if (matches(scene.title, scene.number)) results.push({ type: '场景', title: scene.title, detail: chapter.title, view: 'editor', chapterIndex, sceneIndex });
      (scene.blocks || []).forEach((block, blockIndex) => {
        const text = projectSearchText(block.textHtml || block.text || block.title || '');
        const tags = (block.statusTags || []).join(' ');
        if (!matches(text, block.character, tags, block.note)) return;
        results.push({ type: block.type === 'segment' ? '分段' : '对白', title: text || block.character || '未命名内容', detail: `${chapter.title} / ${scene.title}${block.character ? ` · ${block.character}` : ''}`, view: 'editor', chapterIndex, sceneIndex, blockIndex });
      });
    });
  });
  (desktopState.data.characters || []).forEach((character) => { if (matches(character.name, character.role, character.description)) results.push({ type: '角色', title: character.name, detail: character.role || '未设置定位', view: 'characters', characterId: character.id }); });
  (desktopState.data.assets || []).forEach((asset) => { if (matches(asset.name, asset.fileName, asset.type)) results.push({ type: '素材', title: asset.name, detail: asset.fileName || asset.type, view: 'assets', assetId: asset.id }); });
  return results.slice(0, 24);
}
function setProjectSearchResultsOpen(open) {
  const results = document.getElementById('projectSearchResults');
  if (!results) return;
  results.hidden = !open;
  results.classList.toggle('hidden', !open);
}
function navigateToProjectSearchResult(result) {
  if (result.view === 'editor') {
    syncCurrentScene(); activeChapterIndex = result.chapterIndex; activeSceneIndex = result.sceneIndex; selectedBlockIndex = result.blockIndex ?? 0;
    expandedChapterIds.add(currentChapter().id); renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]')?.click();
    if (Number.isInteger(result.blockIndex)) requestAnimationFrame(() => document.querySelector(`.script-block[data-block-index="${result.blockIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else {
    document.querySelector(`[data-view="${result.view}"]`)?.click();
    requestAnimationFrame(() => document.querySelector(result.characterId ? `[data-character-id="${result.characterId}"]` : `[data-asset-id="${result.assetId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  setProjectSearchResultsOpen(false);
}
function renderProjectSearchResults() {
  const input = document.getElementById('projectSearchInput'); const container = document.getElementById('projectSearchResults');
  if (!input || !container) return;
  const query = input.value.trim(); const results = collectProjectSearchResults(query); container.replaceChildren();
  if (!query) { setProjectSearchResultsOpen(false); return; }
  if (!results.length) addChild(container, 'div', 'project-search-empty', '没有找到匹配内容');
  results.forEach((result) => {
    const button = addChild(container, 'button', 'project-search-result'); button.type = 'button';
    addChild(button, 'span', 'project-search-result-type', result.type); const copy = addChild(button, 'span', 'project-search-result-copy'); addChild(copy, 'b', '', result.title); addChild(copy, 'small', '', result.detail);
    button.addEventListener('click', () => navigateToProjectSearchResult(result));
  });
  setProjectSearchResultsOpen(true);
}
document.getElementById('projectSearchInput')?.addEventListener('input', renderProjectSearchResults);
document.getElementById('projectSearchInput')?.addEventListener('focus', renderProjectSearchResults);
document.getElementById('projectCreateForm')?.addEventListener('submit', createProjectFromHome);
document.getElementById('chooseProjectLocationBtn')?.addEventListener('click', async () => { const directory = await desktopApi.chooseProjectDirectory(); if (directory) document.getElementById('projectCreateLocation').value = directory; });
document.getElementById('openProjectFromHomeBtn')?.addEventListener('click', openProject);
document.getElementById('previewBtn')?.addEventListener('click', () => { updatePreview(); document.getElementById('previewModal').classList.remove('hidden'); }); document.getElementById('closePreview')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden')); document.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('previewModal').classList.add('hidden'));
document.addEventListener('keydown', (event) => { const withCommand = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); if (event.key === 'F1') { event.preventDefault(); openApplicationDialog('help'); return; } if (event.key === 'F2') { event.preventDefault(); renameProject(); return; } if (!withCommand) { if (event.key === 'Escape') { closeWindowProjectMenu(); closeWindowSettingsMenu(); setProjectSearchResultsOpen(false); document.querySelector('.application-dialog-overlay')?.remove(); } return; } if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoProjectChange(); else undoProjectChange(); return; } if (key === 'y') { event.preventDefault(); redoProjectChange(); return; } if (key === 's') { event.preventDefault(); saveProject(); } if (key === 'o') { event.preventDefault(); openProject(); } if (key === 'n') { event.preventDefault(); newProject(); } if (key === 'k') { event.preventDefault(); document.getElementById('projectSearchInput')?.focus(); } if (key === ',') { event.preventDefault(); closeWindowProjectMenu(); setWindowSettingsMenuOpen(true); } });
applyThemePreference(currentThemePreference(), false);
applyInterfaceScale(Number(localStorage.getItem('rropeway-interface-scale') || 100), false);
applyEditorPreferences(currentEditorPreferences(), false);
initializeLayoutControls();
desktopApi?.onBeforeClose(async () => { const saved = await saveProject(); if (saved) desktopApi.finishClose(); else desktopApi.cancelClose(); });
setInterval(() => { if (desktopState.dirty && desktopState.data) localStorage.setItem('scriptroom-draft', JSON.stringify({ filePath: desktopState.filePath, data: captureProject(), savedAt: Date.now() })); }, 10000);
if (desktopApi) initializeProject();

// Interactive editor layer: characters, inspector controls, drag sorting and project switcher.
let draggedBlockIndex = null;
function activeDialogueBlock() { const scene = currentScene(); const block = scene?.blocks?.[selectedBlockIndex]; return block?.type === 'dialogue' ? block : null; }
function setInspectorSectionFloating(sectionKey, floating) {
  const keys = new Set(layoutPreferences.floatingSections);
  if (floating) keys.add(sectionKey); else keys.delete(sectionKey);
  layoutPreferences.floatingSections = [...keys];
  if (keys.has('properties') && keys.has('text')) layoutPreferences.inspectorCollapsed = true;
  if (!floating) layoutPreferences.inspectorCollapsed = false;
  applyLayoutPreferences();
  renderInspector();
}
function makeFloatingInspectorSectionDraggable(section, sectionKey, handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const rect = section.getBoundingClientRect();
    const layerRect = section.offsetParent?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    section.classList.add('dragging');
    const move = (moveEvent) => {
      const left = Math.min(Math.max(0, layerRect.width - section.offsetWidth), Math.max(0, moveEvent.clientX - offsetX - layerRect.left));
      const top = Math.min(Math.max(0, layerRect.height - section.offsetHeight), Math.max(0, moveEvent.clientY - offsetY - layerRect.top));
      section.style.left = `${left}px`; section.style.top = `${top}px`;
      layoutPreferences.floatingPositions[sectionKey] = { left, top };
    };
    const finish = () => { section.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish); saveLayoutPreferences(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  });
}
function setInspectorFloatButtonIcon(button, floating) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 22 22'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', floating ? 'M4.5 5.5h13v11h-13z M13.5 5.5v11' : 'M5 8v9h9 M10 5h7v7 M17 5l-8 8');
  svg.appendChild(path); button.replaceChildren(svg);
}
function clampFloatingInspectorSections(persist = false) {
  const layer = document.getElementById('floatingInspectorLayer'); if (!layer) return;
  layer.querySelectorAll('.floating-inspector-section').forEach((section) => {
    const sectionKey = section.dataset.inspectorSectionKey; if (!sectionKey) return;
    const left = Math.min(Math.max(0, layer.clientWidth - section.offsetWidth), Math.max(0, Number.parseFloat(section.style.left) || 0));
    const top = Math.min(Math.max(0, layer.clientHeight - section.offsetHeight), Math.max(0, Number.parseFloat(section.style.top) || 0));
    section.style.left = `${left}px`; section.style.top = `${top}px`; layoutPreferences.floatingPositions[sectionKey] = { left, top };
  });
  if (persist) saveLayoutPreferences();
}
function createInspectorSection(body, title, description = '', sectionKey = '') {
  const floating = sectionKey && layoutPreferences.floatingSections.includes(sectionKey);
  const target = floating ? document.getElementById('floatingInspectorLayer') : body;
  const section = addChild(target, 'section', `inspector-section${floating ? ' floating-inspector-section' : ''}`);
  if (sectionKey) section.dataset.inspectorSectionKey = sectionKey;
  const heading = addChild(section, 'div', 'inspector-section-heading');
  addChild(heading, 'h3', '', title);
  if (sectionKey) {
    const floatButton = addChild(heading, 'button', 'inspector-section-float-button'); floatButton.type = 'button'; floatButton.title = floating ? '停靠到右侧栏' : '移到悬浮窗'; floatButton.setAttribute('aria-label', floatButton.title); setInspectorFloatButtonIcon(floatButton, floating);
    floatButton.addEventListener('click', () => setInspectorSectionFloating(sectionKey, !floating));
  }
  if (description) addChild(section, 'p', 'inspector-section-description', description);
  if (floating) {
    const defaultPosition = sectionKey === 'text' ? { left: Math.max(20, window.innerWidth - 410), top: 430 } : { left: Math.max(20, window.innerWidth - 410), top: 78 };
    const position = layoutPreferences.floatingPositions[sectionKey] || defaultPosition;
    const layer = document.getElementById('floatingInspectorLayer'); const layerWidth = layer?.clientWidth || window.innerWidth; const layerHeight = layer?.clientHeight || window.innerHeight;
    section.style.left = `${Math.min(Math.max(0, layerWidth - section.offsetWidth), Math.max(0, Number(position.left) || 0))}px`; section.style.top = `${Math.min(Math.max(0, layerHeight - section.offsetHeight), Math.max(0, Number(position.top) || 0))}px`;
    makeFloatingInspectorSectionDraggable(section, sectionKey, heading);
  }
  return section;
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
  block.text = richTextPlainText(paragraph);
  block.textHtml = sanitizeRichTextHtml(paragraph.innerHTML);
  rememberTextSelection();
  markDirty();
}
async function applyRubyAnnotation() {
  const block = activeDialogueBlock(); const paragraph = selectedDialogueParagraph();
  if (!block || !paragraph) return;
  paragraph.focus(); restoreTextSelection(paragraph);
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) { showToast('请先选中需要添加上方注释的文字'); return; }
  rememberTextSelection();
  const annotation = await requestTextInput('文字上方注释', '');
  if (!annotation) return;
  paragraph.focus(); restoreTextSelection(paragraph);
  const activeSelection = window.getSelection();
  if (!activeSelection?.rangeCount || activeSelection.isCollapsed) return;
  const range = activeSelection.getRangeAt(0);
  const ruby = document.createElement('ruby'); ruby.appendChild(range.extractContents()); const annotationNode = document.createElement('rt'); annotationNode.textContent = annotation; ruby.appendChild(annotationNode); range.insertNode(ruby);
  activeSelection.removeAllRanges(); const caret = document.createRange(); caret.setStartAfter(ruby); caret.collapse(true); activeSelection.addRange(caret);
  block.text = richTextPlainText(paragraph);
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
  const section = createInspectorSection(body, '文字编辑器', '选中对白文字后设置格式；未选中文字时会应用到整条对白。', 'text');
  if (!block) { section.classList.add('disabled'); addChild(section, 'div', 'inspector-empty compact', '请选择一条对白后使用文字格式。'); return; }
  const toolbar = addChild(section, 'div', 'text-format-toolbar');
  const addCommandButton = (label, title, command) => { const button = addChild(toolbar, 'button', 'text-format-button', label); button.type = 'button'; button.title = title; button.addEventListener('mousedown', (event) => event.preventDefault()); button.addEventListener('click', () => applyInlineTextFormat(command)); return button; };
  addCommandButton('B', '加粗', 'bold').classList.add('bold');
  addCommandButton('I', '斜体', 'italic').classList.add('italic');
  addCommandButton('U', '下划线', 'underline').classList.add('underline');
  addCommandButton('S', '删除线', 'strikeThrough').classList.add('strike');
  addCommandButton('x²', '上标', 'superscript');
  addCommandButton('x₂', '下标', 'subscript');
  const annotationButton = addChild(toolbar, 'button', 'text-format-button text-annotation-button', '上注'); annotationButton.type = 'button'; annotationButton.title = '在选中文字上方添加小型注释'; annotationButton.addEventListener('mousedown', (event) => event.preventDefault()); annotationButton.addEventListener('click', applyRubyAnnotation);
  const fontSelect = addChild(toolbar, 'select', 'text-format-select text-font-select');
  [['', '字体'], ['Microsoft YaHei', '微软雅黑'], ['SimSun', '宋体'], ['KaiTi', '楷体'], ['Arial', 'Arial']].forEach(([value, label]) => { const option = addChild(fontSelect, 'option', '', label); option.value = value; });
  fontSelect.addEventListener('change', () => { if (fontSelect.value) applyInlineTextFormat('fontName', fontSelect.value); fontSelect.value = ''; });
  const sizeSelect = addChild(toolbar, 'select', 'text-format-select text-size-select');
  [['', '字号'], ['2', '13 px'], ['3', '16 px'], ['4', '18 px'], ['5', '22 px'], ['6', '28 px']].forEach(([value, label]) => { const option = addChild(sizeSelect, 'option', '', label); option.value = value; });
  sizeSelect.addEventListener('change', () => { if (sizeSelect.value) applyInlineTextFormat('fontSize', sizeSelect.value); sizeSelect.value = ''; });
  const colorLabel = addChild(toolbar, 'label', 'text-color-control'); addChild(colorLabel, 'span', '', 'A');
  const colorInput = addChild(colorLabel, 'input'); colorInput.type = 'color'; colorInput.value = '#2d302f'; colorInput.title = '文字颜色'; colorInput.addEventListener('input', () => applyInlineTextFormat('foreColor', colorInput.value));
  const highlightLabel = addChild(toolbar, 'label', 'text-color-control text-highlight-control'); addChild(highlightLabel, 'span', '', '▰');
  const highlightInput = addChild(highlightLabel, 'input'); highlightInput.type = 'color'; highlightInput.value = '#ffe1a8'; highlightInput.title = '文字高亮'; highlightInput.addEventListener('input', () => applyInlineTextFormat('hiliteColor', highlightInput.value));
  const alignment = addChild(section, 'div', 'text-alignment-row');
  [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].forEach(([value, title]) => { const button = addChild(alignment, 'button', `text-align-button${(block.textAlign || 'left') === value ? ' active' : ''}`, value === 'left' ? '≡' : value === 'center' ? '≣' : '≡'); button.type = 'button'; button.title = title; if (value === 'right') button.classList.add('align-right-icon'); button.addEventListener('click', () => { applyParagraphAlignment(value); renderInspector(); }); });
  const clear = addChild(alignment, 'button', 'text-clear-button', '清除格式'); clear.type = 'button'; clear.addEventListener('mousedown', (event) => event.preventDefault()); clear.addEventListener('click', () => applyInlineTextFormat('removeFormat'));
}
document.addEventListener('selectionchange', rememberTextSelection);
const IMAGE_ASSET_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
function segmentImageFromAsset(asset) {
  return { id: `segment-image-${Date.now()}-${Math.random().toString(16).slice(2)}`, assetId: asset.id || '', name: asset.name || '未命名图片', relativePath: asset.relativePath };
}
function refreshSegmentImages(message) {
  renderScene();
  renderInspector();
  renderImportedAssets();
  markDirty();
  if (message) showToast(message);
}
async function importImagesIntoSegment(segment) {
  if (!desktopState.filePath && !(await saveProject())) return;
  try {
    const assets = await desktopApi.importImages(desktopState.filePath);
    if (!assets.length) return;
    desktopState.data.assets.push(...assets);
    segment.images ||= [];
    segment.images.push(...assets.map(segmentImageFromAsset));
    refreshSegmentImages(`已添加 ${assets.length} 张分段图片`);
  } catch (error) { showToast(error.message || '图片导入失败'); }
}
function renderSegmentImageSettings(section, segment) {
  segment.images ||= [];
  const imageGroup = addChild(section, 'div', 'property-group segment-image-settings');
  addChild(imageGroup, 'label', '', '分段图片');
  if (!segment.images.length) addChild(imageGroup, 'div', 'inspector-empty compact', '尚未添加图片，可从本地或素材库选择多张图片。');
  const list = addChild(imageGroup, 'div', 'segment-image-inspector-list');
  segment.images.forEach((image, imageIndex) => {
    const row = addChild(list, 'div', 'segment-image-inspector-row');
    const thumbnail = addChild(row, 'img'); thumbnail.alt = image.name || '分段图片';
    if (desktopState.filePath && image.relativePath) desktopApi.readAsset(desktopState.filePath, image.relativePath).then((src) => { if (src) thumbnail.src = src; }).catch(() => row.classList.add('asset-missing'));
    const copy = addChild(row, 'div', 'segment-image-inspector-copy'); addChild(copy, 'b', '', image.name || '未命名图片'); addChild(copy, 'small', '', `${imageIndex + 1} / ${segment.images.length}`);
    const actions = addChild(row, 'div', 'segment-image-inspector-actions');
    const up = addChild(actions, 'button', '', '↑'); up.type = 'button'; up.title = '前移'; up.disabled = imageIndex === 0;
    const down = addChild(actions, 'button', '', '↓'); down.type = 'button'; down.title = '后移'; down.disabled = imageIndex === segment.images.length - 1;
    const remove = addChild(actions, 'button', 'danger', '×'); remove.type = 'button'; remove.title = '移除';
    up.addEventListener('click', () => { const [moved] = segment.images.splice(imageIndex, 1); segment.images.splice(imageIndex - 1, 0, moved); refreshSegmentImages('图片顺序已调整'); });
    down.addEventListener('click', () => { const [moved] = segment.images.splice(imageIndex, 1); segment.images.splice(imageIndex + 1, 0, moved); refreshSegmentImages('图片顺序已调整'); });
    remove.addEventListener('click', () => { segment.images.splice(imageIndex, 1); refreshSegmentImages('已从分段移除图片'); });
  });
  const actions = addChild(imageGroup, 'div', 'segment-image-source-actions');
  const localButton = addChild(actions, 'button', 'file-button', '从本地选择'); localButton.type = 'button'; localButton.addEventListener('click', () => importImagesIntoSegment(segment));
  const assetSelect = addChild(actions, 'select', 'select-control editor-select');
  const availableAssets = (desktopState.data.assets || []).filter((asset) => IMAGE_ASSET_TYPES.has(String(asset.type).toLowerCase()));
  const placeholder = addChild(assetSelect, 'option', '', availableAssets.length ? '从素材库选择' : '素材库暂无图片'); placeholder.value = ''; placeholder.disabled = !availableAssets.length;
  availableAssets.forEach((asset) => { const option = addChild(assetSelect, 'option', '', asset.name); option.value = asset.id; });
  const addAssetButton = addChild(actions, 'button', 'file-button', '添加'); addAssetButton.type = 'button'; addAssetButton.disabled = !availableAssets.length;
  addAssetButton.addEventListener('click', () => {
    const asset = availableAssets.find((item) => item.id === assetSelect.value);
    if (!asset) { showToast('请先选择素材库图片'); return; }
    if (segment.images.some((image) => image.relativePath === asset.relativePath)) { showToast('这张图片已经在当前分段中'); return; }
    segment.images.push(segmentImageFromAsset(asset));
    refreshSegmentImages('已从素材库添加图片');
  });
}
function renderInspector() {
  const body = document.querySelector('.inspector-body'); if (!body) return; body.replaceChildren();
  document.getElementById('floatingInspectorLayer')?.replaceChildren();
  const header = document.querySelector('.inspector-header span');
  const selectedBlock = currentScene()?.blocks?.[selectedBlockIndex];
  let dialogueBlock = null;
  if (selectedBlock?.type === 'segment') {
    if (header) header.textContent = '分段属性';
    const properties = createInspectorSection(body, '当前分段', '', 'properties');
    const titleGroup = addChild(properties, 'div', 'property-group'); addChild(titleGroup, 'label', '', '分段名称');
    const titleInput = addChild(titleGroup, 'input', 'select-control editor-input'); titleInput.value = selectedBlock.title || ''; titleInput.placeholder = '输入分段名称';
    titleInput.addEventListener('input', () => { selectedBlock.title = titleInput.value; document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .segment-title`)?.replaceChildren(document.createTextNode(titleInput.value || '未命名分段')); renderSegmentNavigator(); markDirty(); });
    const perspectiveGroup = addChild(properties, 'div', 'property-group'); addChild(perspectiveGroup, 'label', '', '主视角角色');
    const perspectiveSelect = addChild(perspectiveGroup, 'select', 'select-control editor-select');
    const none = addChild(perspectiveSelect, 'option', '', '不设置主视角'); none.value = '';
    (desktopState.data.characters || []).forEach((character) => { const option = addChild(perspectiveSelect, 'option', '', character.name); option.value = character.id; option.selected = selectedBlock.perspectiveCharacterId === character.id; });
    perspectiveSelect.addEventListener('change', () => { selectedBlock.perspectiveCharacterId = perspectiveSelect.value || null; renderScene(); markDirty(); });
    renderSegmentImageSettings(properties, selectedBlock);
  } else if (selectedBlock?.type === 'narration') {
    if (header) header.textContent = '旁白';
    const properties = createInspectorSection(body, '当前旁白', '', 'properties');
    addChild(properties, 'div', 'inspector-empty compact', '旁白无需设置角色、状态标签或立绘，直接在左侧编辑内容。');
  } else {
    if (header) header.textContent = '对白属性';
    dialogueBlock = activeDialogueBlock();
    const properties = createInspectorSection(body, '当前对白', '', 'properties');
    if (!dialogueBlock) addChild(properties, 'div', 'inspector-empty compact', '选择一条对白后，可编辑角色、状态标签和立绘属性。');
    else {
      const characters = desktopState.data.characters || [];
      const characterGroup = addChild(properties, 'div', 'property-group'); addChild(characterGroup, 'label', '', '当前角色');
      const characterSelect = addChild(characterGroup, 'select', 'select-control editor-select');
      const noCharacter = addChild(characterSelect, 'option', '', '未设置角色'); noCharacter.value = ''; noCharacter.selected = !dialogueBlock.characterId && !dialogueBlock.character;
      characters.forEach((character) => { const option = addChild(characterSelect, 'option', '', character.name); option.value = character.id; if (character.name === dialogueBlock.character) option.selected = true; });
      characterSelect.addEventListener('change', () => { const character = characters.find((item) => item.id === characterSelect.value); if (character) applyCharacterToBlock(character, dialogueBlock); else { dialogueBlock.character = ''; dialogueBlock.characterId = ''; dialogueBlock.characterColor = '#b8bcb8'; dialogueBlock.portraitPreset = null; dialogueBlock.portrait = undefined; } renderScene(); markDirty(); });
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
  if (selectedBlock?.type !== 'narration') renderTextFormattingSettings(body, dialogueBlock);
  requestAnimationFrame(() => clampFloatingInspectorSections());
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
    const card = addChild(grid, 'article', `character-card${activeDialogueBlock()?.character === character.name ? ' selected' : ''}`); card.dataset.characterId = character.id;
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
  try {
    const projects = JSON.parse(localStorage.getItem('scriptroom-recent-projects') || '[]');
    if (!Array.isArray(projects)) return [];
    const seen = new Set();
    return projects.filter((item) => { if (!item?.filePath || seen.has(item.filePath)) return false; seen.add(item.filePath); return true; });
  } catch { return []; }
}
function lastProjectPath() {
  return localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || '';
}
function rememberLastProject(filePath) {
  if (filePath) localStorage.setItem(LAST_PROJECT_STORAGE_KEY, filePath);
  else localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
}
function rememberProject(filePath, title) {
  if (!filePath) return;
  const projects = recentProjects().filter((item) => item.filePath !== filePath);
  projects.unshift({ filePath, title: title || '未命名项目', openedAt: Date.now() });
  localStorage.setItem('scriptroom-recent-projects', JSON.stringify(projects));
  rememberLastProject(filePath);
}
function forgetRecentProject(filePath) {
  localStorage.setItem('scriptroom-recent-projects', JSON.stringify(recentProjects().filter((item) => item.filePath !== filePath)));
  if (lastProjectPath() === filePath) rememberLastProject(null);
}
async function initializeProject() {
  const draft = localStorage.getItem('scriptroom-draft');
  if (draft) {
    try {
      if (await requestConfirmation('发现上次未保存的临时草稿，是否恢复？')) {
        const recovered = JSON.parse(draft);
        applyProject(recovered.data, recovered.filePath);
        markDirty();
        return;
      }
    } catch {
      localStorage.removeItem('scriptroom-draft');
    }
  }
  const candidates = [lastProjectPath(), ...recentProjects().map((item) => item.filePath)].filter((filePath, index, paths) => filePath && paths.indexOf(filePath) === index);
  for (const filePath of candidates) {
    try {
      if (await desktopApi.projectExists(filePath)) {
        const result = await desktopApi.openProjectPath(filePath);
        applyProject(result.data, result.filePath);
        return;
      }
    } catch {}
    forgetRecentProject(filePath);
  }
  if (candidates.length) showToast('不存在的项目已从历史记录中清理');
  showProjectHome(true);
}
async function openRecentProject(filePath) {
  if (filePath === desktopState.filePath) { document.querySelector('[data-view="editor"]').click(); return; }
  if (!(await prepareProjectSwitch('当前项目有未保存修改，确定切换项目吗？'))) return;
  if (!(await desktopApi.projectExists(filePath))) {
    forgetRecentProject(filePath);
    await requestNotice('项目文件不存在', `找不到项目文件：${filePath}\n这条历史记录已自动删除。`);
    return;
  }
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
  const entries = [];
  if (desktopState.data) entries.push({ filePath: desktopState.filePath, title: desktopState.data.title || '未命名项目', current: true });
  recentProjects().filter((item) => item.filePath !== desktopState.filePath).forEach((item) => entries.push({ ...item, current: false }));
  if (!entries.length) addChild(list, 'div', 'project-list-empty', '暂无本地项目，点击“新建项目”创建仓库。');
  entries.forEach((project) => {
    const row = addChild(list, 'div', `project-list-row${project.current ? ' current' : ''}`);
    const item = addChild(row, 'button', `project-list-item${project.current ? ' current' : ''}`);
    const copy = addChild(item, 'span', 'project-list-copy');
    const projectTitle = addChild(copy, 'b', '', project.title); projectTitle.title = project.title;
    const projectPath = addChild(copy, 'small', '', project.filePath || '尚未保存到磁盘'); projectPath.title = project.filePath || '尚未保存到磁盘';
    if (project.current) addChild(item, 'span', 'project-current-mark', '当前');
    item.addEventListener('click', () => {
      menu.remove();
      if (project.filePath) openRecentProject(project.filePath);
      else document.querySelector('[data-view="editor"]').click();
    });
    if (project.filePath) {
      const remove = addChild(row, 'button', 'project-list-delete', '×'); remove.type = 'button'; remove.title = `删除项目「${project.title}」`;
      remove.addEventListener('click', async (event) => { event.stopPropagation(); menu.remove(); await deleteProjectEntry(project); });
    }
  });
  document.body.appendChild(menu);
  const anchor = document.getElementById('workspaceSwitcher').getBoundingClientRect();
  menu.style.left = `${anchor.left}px`;
  menu.style.top = `${anchor.bottom + 8}px`;
}
const baseApplyProject = applyProject;
applyProject = function (data, filePath = null, options = {}) { baseApplyProject(data, filePath, options); if (filePath) rememberProject(filePath, data.title); else rememberLastProject(null); renderCharacters(); renderInspector(); };
function updateEditorScrollTools() {
  const panel = document.querySelector('.script-panel'); const backToTop = document.getElementById('backToTop'); const navigator = document.getElementById('segmentNavigator');
  if (!panel || !backToTop || !navigator) return;
  backToTop.classList.toggle('hidden', panel.scrollTop < 320);
  let activeMarker = null;
  navigator.querySelectorAll('.segment-nav-marker').forEach((marker) => { if (panel.scrollTop + 120 >= Number(marker.dataset.target || 0)) activeMarker = marker; marker.classList.remove('active'); });
  activeMarker?.classList.add('active');
}
async function deleteProjectEntry(project) {
  if (!project?.filePath) return;
  const confirmed = await requestConfirmation(`确定删除项目“${project.title}”吗？\n项目文件、备份和同目录 assets 素材文件夹将移入回收站，历史记录也会删除。`);
  if (!confirmed) return;
  try {
    await desktopApi.deleteProject(project.filePath);
    forgetRecentProject(project.filePath);
    const deletingCurrent = project.filePath === desktopState.filePath;
    if (deletingCurrent) {
      localStorage.removeItem('scriptroom-draft');
      desktopState.dirty = false;
      desktopApi.setDirty(false);
      showProjectHome(true);
      for (const nextProject of recentProjects()) {
        if (!(await desktopApi.projectExists(nextProject.filePath))) { forgetRecentProject(nextProject.filePath); continue; }
        const result = await desktopApi.openProjectPath(nextProject.filePath);
        applyProject(result.data, result.filePath);
        break;
      }
    }
    showToast('项目已移入回收站');
  } catch (error) { showToast(error.message || '项目删除失败'); }
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
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Backspace' || event.ctrlKey || event.metaKey || event.altKey) return;
  const focused = document.activeElement;
  if (focused?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
  const block = currentScene()?.blocks?.[selectedBlockIndex];
  if (block?.type !== 'dialogue') return;
  event.preventDefault();
  deleteBlock(selectedBlockIndex);
});
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
  if (!event.target.closest('.window-menu')) { closeWindowProjectMenu(); closeWindowSettingsMenu(); }
  if (!event.target.closest('#projectSearch')) setProjectSearchResultsOpen(false);
  if (!event.target.closest('.tree-context-menu')) closeTreeContextMenu();
});
