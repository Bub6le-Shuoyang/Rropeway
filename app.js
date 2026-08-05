const desktopApi = window.scriptroom;
const storyFlowTools = window.RropewayStoryFlow;
const writingCheckTools = window.RropewayWritingChecks;
const skinSettingsTools = window.RropewaySkinSettings;
const itemFormatTools = window.RropewayItemFormat;
desktopApi?.getVersion?.().then((version) => { const label = document.getElementById('appVersion'); if (label) label.textContent = `v${version}`; }).catch(() => {});
const navItems = document.querySelectorAll('.nav-item');
const views = { editor: document.getElementById('editorView'), characters: document.getElementById('charactersView'), relationships: document.getElementById('relationshipsView'), items: document.getElementById('itemsView'), assets: document.getElementById('assetsView'), checks: document.getElementById('writingChecksView'), flow: document.getElementById('sceneFlowView'), home: document.getElementById('projectHomeView') };
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
let savedTextDialogueId = '';
let selectedItemDialogueId = '';
let itemDialogueEditorState = null;
let segmentSlideshowTimers = new Set();
let previewState = null;
let previewRenderToken = 0;
let selectedRelationshipId = '';
let relationshipResizeObserver = null;
let sceneFlowResizeObserver = null;
let writingCheckRenderToken = 0;
let writingCheckFilter = 'all';
let itemSearchQuery = '';
let itemTagFilter = '';
const MIN_SCENE_FLOW_ZOOM = 0.35;
const MAX_SCENE_FLOW_ZOOM = 2.2;
const RELATIONSHIP_ZOOM_STORAGE_KEY = 'rropeway-relationship-zoom';
const MIN_RELATIONSHIP_ZOOM = 0.3;
const MAX_RELATIONSHIP_ZOOM = 2.5;
const RELATIONSHIP_NOTE_COLORS = ['#fff1a8', '#dff3cf', '#d9eff7', '#ffd9cf', '#eadffd'];
function clampRelationshipZoom(value) { return Math.round(Math.min(MAX_RELATIONSHIP_ZOOM, Math.max(MIN_RELATIONSHIP_ZOOM, Number(value) || 1)) * 10) / 10; }
let relationshipZoom = clampRelationshipZoom(localStorage.getItem(RELATIONSHIP_ZOOM_STORAGE_KEY));
const normalizedAvatarSourceCache = new Map();
const expandedChapterIds = new Set();
const expandedBranchIds = new Set();
let draggedChapterId = null;
let draggedSceneInfo = null;
let ignoreTreeClickUntil = 0;
const EDITOR_PREFERENCES_STORAGE_KEY = 'rropeway-editor-preferences';
const DEFAULT_EDITOR_PREFERENCES = { fontSize: 16, letterSpacing: 0, paragraphSpacing: 10, annotationSize: 9, slideshowInterval: 5 };
const SKIN_SETTINGS_STORAGE_KEY = 'rropeway-skin-settings';
const SKIN_FONT_STACKS = {
  system: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif',
  rounded: '"Nunito", "Arial Rounded MT Bold", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"Cascadia Code", "SFMono-Regular", Consolas, "Microsoft YaHei", monospace'
};
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
let activeSkinSettings = null;
let activeSkinBackgroundDataUrl = '';
let dismissActiveSkinEditor = null;
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
      close({ ...value, name, role: roleInput.value.trim(), description: descriptionInput.value.trim(), color: colorInput.value, portraitPreset: selectedPreset === 'none' ? null : selectedPreset, avatarGroup: Array.isArray(value.avatarGroup) ? value.avatarGroup : [], portraitGroup: Array.isArray(value.portraitGroup) ? value.portraitGroup : [], defaultAvatarId: value.defaultAvatarId || '', defaultPortraitId: value.defaultPortraitId || '' });
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => nameInput.focus());
  });
}
function characterMediaOriginalName(item) { return String(item?.originalName || item?.name || '未命名表情'); }
function characterMediaDisplayName(item) { return String(item?.alias || '').trim() || characterMediaOriginalName(item); }
function characterMediaGroup(character, groupName) {
  const items = Array.isArray(character?.[groupName]) ? character[groupName] : [];
  const defaultId = groupName === 'avatarGroup' ? character?.defaultAvatarId : character?.defaultPortraitId;
  if (!defaultId) return [...items];
  return [...items].sort((left, right) => Number(right.id === defaultId) - Number(left.id === defaultId));
}
function characterDefaultMedia(character, groupName) {
  const items = characterMediaGroup(character, groupName);
  const defaultId = groupName === 'avatarGroup' ? character?.defaultAvatarId : character?.defaultPortraitId;
  return items.find((item) => item.id === defaultId) || items[0] || null;
}
function loadProjectImage(relativePath, image, container = image) {
  if (!desktopState.filePath || !relativePath || !image) return;
  desktopApi.readAsset(desktopState.filePath, relativePath).then((src) => { if (src && image.isConnected) image.src = src; }).catch(() => container?.classList.add('asset-missing'));
}
function renderCharacterDefaultAvatar(container, character, imageClass = '') {
  if (!container) return;
  const fallbackText = String(character?.name || '').trim().slice(0, 1) || '—';
  const defaultAvatar = characterDefaultMedia(character, 'avatarGroup');
  const showFallback = () => {
    if (!container.isConnected) return;
    container.classList.remove('has-avatar-image');
    container.classList.add('asset-missing');
    container.replaceChildren(document.createTextNode(fallbackText));
  };
  container.replaceChildren();
  container.classList.remove('has-avatar-image', 'asset-missing');
  if (!defaultAvatar?.relativePath || !desktopState.filePath) {
    container.textContent = fallbackText;
    return;
  }
  const image = addChild(container, 'img', imageClass);
  image.alt = `${character.name || '角色'}头像`;
  image.addEventListener('load', () => { if (container.isConnected) container.classList.add('has-avatar-image'); }, { once: true });
  image.addEventListener('error', showFallback, { once: true });
  desktopApi.readAsset(desktopState.filePath, defaultAvatar.relativePath).then((src) => {
    if (!src || !image.isConnected) { showFallback(); return; }
    image.src = src;
  }).catch(showFallback);
}
function normalizeDialogueAvatarSource(cacheKey, source) {
  if (normalizedAvatarSourceCache.has(cacheKey)) return normalizedAvatarSourceCache.get(cacheKey);
  const normalization = new Promise((resolve) => {
    const sourceImage = new Image();
    sourceImage.onload = () => {
      const sampleSize = 192;
      const sampleCanvas = document.createElement('canvas'); sampleCanvas.width = sampleSize; sampleCanvas.height = sampleSize;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      sampleContext.drawImage(sourceImage, 0, 0, sampleSize, sampleSize);
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      let minimumX = sampleSize; let minimumY = sampleSize; let maximumX = -1; let maximumY = -1;
      for (let pixelIndex = 0; pixelIndex < sampleSize * sampleSize; pixelIndex += 1) {
        if (pixels[pixelIndex * 4 + 3] <= 12) continue;
        const pixelX = pixelIndex % sampleSize;
        const pixelY = Math.floor(pixelIndex / sampleSize);
        minimumX = Math.min(minimumX, pixelX); minimumY = Math.min(minimumY, pixelY);
        maximumX = Math.max(maximumX, pixelX); maximumY = Math.max(maximumY, pixelY);
      }
      if (maximumX < minimumX || (minimumX <= 2 && minimumY <= 2 && maximumX >= sampleSize - 3 && maximumY >= sampleSize - 3)) { resolve(source); return; }
      const scaleX = sourceImage.naturalWidth / sampleSize;
      const scaleY = sourceImage.naturalHeight / sampleSize;
      const contentWidth = (maximumX - minimumX + 1) * scaleX;
      const contentHeight = (maximumY - minimumY + 1) * scaleY;
      const padding = Math.max(contentWidth, contentHeight) * 0.02;
      const sourceX = Math.max(0, minimumX * scaleX - padding);
      const sourceY = Math.max(0, minimumY * scaleY - padding);
      const sourceWidth = Math.min(sourceImage.naturalWidth - sourceX, contentWidth + padding * 2);
      const sourceHeight = Math.min(sourceImage.naturalHeight - sourceY, contentHeight + padding * 2);
      const outputCanvas = document.createElement('canvas'); outputCanvas.width = 512; outputCanvas.height = 512;
      const outputContext = outputCanvas.getContext('2d');
      const outputScale = Math.max(500 / sourceWidth, 500 / sourceHeight);
      const outputWidth = sourceWidth * outputScale;
      const outputHeight = sourceHeight * outputScale;
      outputContext.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, (512 - outputWidth) / 2, (512 - outputHeight) / 2, outputWidth, outputHeight);
      resolve(outputCanvas.toDataURL('image/png'));
    };
    sourceImage.onerror = () => resolve(source);
    sourceImage.src = source;
  });
  normalizedAvatarSourceCache.set(cacheKey, normalization);
  return normalization;
}
async function openPortraitAvatarCrop(characterId, portrait, onCreated) {
  const character = desktopState.data?.characters?.find((item) => item.id === characterId);
  if (!character || !portrait?.relativePath || !desktopState.filePath) return;
  let source;
  try { source = await desktopApi.readAsset(desktopState.filePath, portrait.relativePath); }
  catch (error) { showToast(error.message || '无法读取立绘'); return; }
  if (!source) { showToast('无法读取立绘'); return; }
  const sourceImage = new Image();
  try { await new Promise((resolve, reject) => { sourceImage.onload = resolve; sourceImage.onerror = reject; sourceImage.src = source; }); }
  catch { showToast('立绘图片加载失败'); return; }

  const overlay = node('div', 'editor-dialog-overlay character-crop-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog character-crop-dialog');
  const heading = addChild(dialog, 'div', 'character-crop-heading');
  const headingCopy = addChild(heading, 'div');
  addChild(headingCopy, 'h3', '', '从立绘生成头像');
  addChild(headingCopy, 'p', '', `${character.name} · ${characterMediaDisplayName(portrait)}`);
  const closeButton = addChild(heading, 'button', 'character-media-close', '×'); closeButton.type = 'button'; closeButton.title = '关闭';
  const content = addChild(dialog, 'div', 'character-crop-content');
  const stage = addChild(content, 'div', 'character-crop-stage');
  const canvas = addChild(stage, 'canvas', 'character-crop-canvas'); canvas.width = 512; canvas.height = 512;
  addChild(stage, 'span', 'character-crop-hint', '拖动画面调整头像区域');
  const controls = addChild(content, 'div', 'character-crop-controls');
  const nameLabel = addChild(controls, 'label', 'character-crop-field'); addChild(nameLabel, 'span', '', '头像名称');
  const nameInput = addChild(nameLabel, 'input', 'editor-dialog-input'); nameInput.value = `${characterMediaDisplayName(portrait)} 头像`;
  const zoomLabel = addChild(controls, 'label', 'character-crop-field'); addChild(zoomLabel, 'span', '', '画面缩放');
  const zoomRow = addChild(zoomLabel, 'div', 'character-crop-zoom');
  const zoomInput = addChild(zoomRow, 'input'); zoomInput.type = 'range'; zoomInput.min = '1'; zoomInput.max = '3'; zoomInput.step = '0.01'; zoomInput.value = '1';
  const zoomValue = addChild(zoomRow, 'output', '', '100%');
  const actionRow = addChild(controls, 'div', 'character-crop-actions');
  const resetButton = addChild(actionRow, 'button', 'file-button', '重置位置'); resetButton.type = 'button';
  const saveButton = addChild(actionRow, 'button', 'file-button save', '生成头像'); saveButton.type = 'button';

  const context = canvas.getContext('2d');
  const cropState = { zoom: 1, offsetX: 0, offsetY: 0, dragging: false, pointerX: 0, pointerY: 0 };
  const baseScale = Math.max(canvas.width / sourceImage.naturalWidth, canvas.height / sourceImage.naturalHeight);
  const dimensions = () => ({ width: sourceImage.naturalWidth * baseScale * cropState.zoom, height: sourceImage.naturalHeight * baseScale * cropState.zoom });
  const clampOffsets = () => {
    const size = dimensions();
    cropState.offsetX = Math.max((canvas.width - size.width) / 2, Math.min((size.width - canvas.width) / 2, cropState.offsetX));
    cropState.offsetY = Math.max((canvas.height - size.height) / 2, Math.min((size.height - canvas.height) / 2, cropState.offsetY));
  };
  const draw = () => {
    clampOffsets();
    const size = dimensions();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, (canvas.width - size.width) / 2 + cropState.offsetX, (canvas.height - size.height) / 2 + cropState.offsetY, size.width, size.height);
  };
  const resetCrop = () => {
    cropState.zoom = 1;
    cropState.offsetX = 0;
    const size = dimensions();
    cropState.offsetY = Math.max(0, (size.height - canvas.height) / 2);
    zoomInput.value = '1';
    zoomValue.textContent = '100%';
    draw();
  };
  const updateZoom = (nextZoom) => {
    cropState.zoom = Math.max(1, Math.min(3, nextZoom));
    zoomInput.value = String(cropState.zoom);
    zoomValue.textContent = `${Math.round(cropState.zoom * 100)}%`;
    draw();
  };
  canvas.addEventListener('pointerdown', (event) => { cropState.dragging = true; cropState.pointerX = event.clientX; cropState.pointerY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    if (!cropState.dragging) return;
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    cropState.offsetX += (event.clientX - cropState.pointerX) * ratio;
    cropState.offsetY += (event.clientY - cropState.pointerY) * ratio;
    cropState.pointerX = event.clientX;
    cropState.pointerY = event.clientY;
    draw();
  });
  const stopDragging = (event) => { cropState.dragging = false; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); updateZoom(cropState.zoom + (event.deltaY < 0 ? 0.08 : -0.08)); }, { passive: false });
  zoomInput.addEventListener('input', () => updateZoom(Number(zoomInput.value)));
  resetButton.addEventListener('click', resetCrop);
  const close = () => overlay.remove();
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || `${characterMediaDisplayName(portrait)} 头像`;
    saveButton.disabled = true;
    saveButton.textContent = '正在生成…';
    try {
      const avatar = await desktopApi.saveCroppedAvatar(desktopState.filePath, character.id, { name, dataUrl: canvas.toDataURL('image/png') });
      const liveCharacter = desktopState.data.characters.find((item) => item.id === character.id);
      liveCharacter.avatarGroup ||= [];
      liveCharacter.avatarGroup.push(avatar);
      if (!liveCharacter.defaultAvatarId) liveCharacter.defaultAvatarId = avatar.id;
      close();
      onCreated?.(avatar);
      markDirty();
      showToast('头像已生成并加入头像组');
    } catch (error) {
      saveButton.disabled = false;
      saveButton.textContent = '生成头像';
      showToast(error.message || '头像生成失败');
    }
  });
  document.body.appendChild(overlay);
  resetCrop();
}
function openCharacterMediaManager(characterId) {
  const overlay = node('div', 'editor-dialog-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog character-media-dialog');
  const heading = addChild(dialog, 'div', 'character-media-heading');
  const headingCopy = addChild(heading, 'div');
  const title = addChild(headingCopy, 'h3');
  const pathHint = addChild(headingCopy, 'p', 'character-media-path');
  const closeButton = addChild(heading, 'button', 'character-media-close', '×'); closeButton.type = 'button'; closeButton.title = '关闭';
  const body = addChild(dialog, 'div', 'character-media-body');
  const close = () => { overlay.remove(); renderCharacters(); renderScene(); renderInspector(); };
  const renderManager = () => {
    const character = desktopState.data?.characters?.find((item) => item.id === characterId);
    if (!character) { close(); return; }
    title.textContent = `${character.name} · 表情素材`;
    pathHint.textContent = `assets/characters/${character.id}/`;
    body.replaceChildren();
    const renderGroup = (groupName, folderName, label, description, square) => {
      const section = addChild(body, 'section', 'character-media-section');
      const sectionHeading = addChild(section, 'div', 'character-media-section-heading');
      const copy = addChild(sectionHeading, 'div'); addChild(copy, 'h4', '', label); addChild(copy, 'p', '', description);
      const importButton = addChild(sectionHeading, 'button', 'file-button save', `＋ 导入${label}`); importButton.type = 'button';
      const items = characterMediaGroup(character, groupName);
      const grid = addChild(section, 'div', `character-media-grid${square ? ' avatar-grid' : ' portrait-grid'}`);
      const defaultProperty = groupName === 'avatarGroup' ? 'defaultAvatarId' : 'defaultPortraitId';
      const updateDefaultIndicators = () => {
        const liveCharacter = desktopState.data?.characters?.find((entry) => entry.id === character.id);
        let defaultCard = null;
        grid.querySelectorAll('.character-media-item').forEach((mediaCard) => {
          const selected = mediaCard.dataset.mediaId === liveCharacter?.[defaultProperty];
          if (selected) defaultCard = mediaCard;
          mediaCard.classList.toggle('default', selected);
          const preview = mediaCard.querySelector('.character-media-preview');
          let mark = preview.querySelector('.character-media-default-mark');
          if (selected && !mark) mark = addChild(preview, 'span', 'character-media-default-mark', '默认');
          if (!selected) mark?.remove();
          const button = mediaCard.querySelector('[data-default-action]');
          if (button) { button.disabled = selected; button.textContent = selected ? '当前默认' : '设为默认'; }
        });
        if (defaultCard && grid.firstElementChild !== defaultCard) grid.prepend(defaultCard);
      };
      items.forEach((item, itemIndex) => {
        const card = addChild(grid, 'article', 'character-media-item'); card.dataset.mediaId = item.id;
        const preview = addChild(card, 'div', `character-media-preview${square ? ' square' : ' standing'}`);
        const image = addChild(preview, 'img'); image.alt = characterMediaDisplayName(item); loadProjectImage(item.relativePath, image, preview);
        const originalName = addChild(card, 'div', 'character-media-original-name', characterMediaOriginalName(item)); originalName.title = characterMediaOriginalName(item);
        const nameInput = addChild(card, 'input', 'character-media-name'); nameInput.value = item.alias || ''; nameInput.placeholder = '添加别名'; nameInput.title = item.alias || '未设置别名';
        nameInput.addEventListener('change', () => {
          const liveCharacter = desktopState.data?.characters?.find((entry) => entry.id === character.id);
          const liveItem = characterMediaGroup(liveCharacter, groupName).find((media) => media.id === item.id);
          if (!liveItem) return;
          liveItem.alias = nameInput.value.trim();
          nameInput.value = liveItem.alias;
          nameInput.title = liveItem.alias || '未设置别名';
          image.alt = characterMediaDisplayName(liveItem);
          markDirty();
        });
        const actions = addChild(card, 'div', 'character-media-actions');
        const makeDefault = addChild(actions, 'button', 'character-media-action', '设为默认'); makeDefault.type = 'button'; makeDefault.dataset.defaultAction = 'true';
        makeDefault.addEventListener('click', () => {
          const liveCharacter = desktopState.data?.characters?.find((entry) => entry.id === character.id);
          if (!liveCharacter || liveCharacter[defaultProperty] === item.id) return;
          liveCharacter[defaultProperty] = item.id;
          updateDefaultIndicators();
          markDirty();
        });
        if (!square) {
          const cropAvatar = addChild(actions, 'button', 'character-media-action crop-avatar', '裁为头像'); cropAvatar.type = 'button';
          cropAvatar.addEventListener('click', () => openPortraitAvatarCrop(character.id, item, renderManager));
        }
        const locate = addChild(actions, 'button', 'character-media-action', '源文件地址'); locate.type = 'button'; locate.addEventListener('click', () => desktopApi.showItem(desktopState.filePath, item.relativePath));
        const remove = addChild(actions, 'button', 'character-media-action danger', '删除'); remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!(await requestDeleteConfirmation(`确定删除表情素材“${characterMediaDisplayName(item)}”吗？项目中的对应引用会一并清理。`))) return;
          try {
            await desktopApi.deleteAsset(desktopState.filePath, item.relativePath);
            removeAssetReferences(item.relativePath);
            const liveCharacter = desktopState.data?.characters?.find((entry) => entry.id === character.id);
            if (!liveCharacter) return;
            const group = characterMediaGroup(liveCharacter, groupName);
            liveCharacter[groupName] = group.filter((media) => media.id !== item.id);
            if (groupName === 'avatarGroup' && liveCharacter.defaultAvatarId === item.id) liveCharacter.defaultAvatarId = liveCharacter.avatarGroup[0]?.id || '';
            if (groupName === 'portraitGroup' && liveCharacter.defaultPortraitId === item.id) liveCharacter.defaultPortraitId = liveCharacter.portraitGroup[0]?.id || '';
            renderManager(); markDirty(); showToast('角色表情素材已删除');
          } catch (error) { showToast(error.message || '删除失败'); }
        });
      });
      updateDefaultIndicators();
      if (!items.length) addChild(grid, 'div', 'character-media-empty', `尚未导入${label}`);
      importButton.addEventListener('click', async () => {
        if (!desktopState.filePath && !(await saveProject())) return;
        try {
          const imported = await desktopApi.importCharacterMedia(desktopState.filePath, character.id, folderName);
          if (!imported.length) return;
          const liveCharacter = desktopState.data.characters.find((item) => item.id === character.id);
          liveCharacter[groupName] ||= [];
          liveCharacter[groupName].push(...imported);
          if (groupName === 'avatarGroup' && !liveCharacter.defaultAvatarId) liveCharacter.defaultAvatarId = imported[0].id;
          if (groupName === 'portraitGroup' && !liveCharacter.defaultPortraitId) liveCharacter.defaultPortraitId = imported[0].id;
          renderManager(); markDirty(); showToast(`已导入 ${imported.length} 个${label}表情`);
        } catch (error) { showToast(error.message || '角色素材导入失败'); }
      });
    };
    renderGroup('avatarGroup', 'avatars', '头像组', '正方形头像，可拆分普通、开心、生气等表情。', true);
    renderGroup('portraitGroup', 'portraits', '立绘组', '完整立绘，可为不同表情分别导入独立图片。', false);
  };
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.body.appendChild(overlay);
  renderManager();
}
function captureBlocks() {
  return [...document.querySelectorAll('.script-canvas .script-block')].map((block) => {
    if (block.classList.contains('segment-block')) {
      let images = [];
      try { images = JSON.parse(block.dataset.segmentImages || '[]'); } catch {}
      return { id: block.dataset.blockId, type: 'segment', title: block.querySelector('.segment-title')?.textContent.trim() || '未命名分段', perspectiveCharacterId: block.dataset.perspectiveCharacterId || null, images };
    }
    if (block.classList.contains('narration')) return { id: block.dataset.blockId, type: 'narration', text: block.querySelector('.block-content p')?.textContent.trim() || '' };
    if (block.classList.contains('choice-block')) {
      let options = [];
      try { options = JSON.parse(block.dataset.choiceOptions || '[]'); } catch {}
      return { id: block.dataset.blockId, type: 'choice', title: block.querySelector('.choice-title')?.textContent.trim() || '', options };
    }
    if (block.classList.contains('item-block')) {
      let itemBlocks = [];
      try { itemBlocks = JSON.parse(block.dataset.itemBlocks || '[]'); } catch {}
      const investigationNode = block.querySelector('.script-item-investigation-text');
      return {
        id: block.dataset.blockId,
        type: 'item',
        itemId: block.dataset.itemId || '',
        investigation: { text: investigationNode?.classList.contains('empty') ? '' : investigationNode?.textContent.trim() || '' },
        blocks: itemBlocks
      };
    }
    const paragraph = block.querySelector('.block-content p');
    return { id: block.dataset.blockId, type: 'dialogue', character: block.querySelector('.character-name')?.textContent.trim() || '', characterId: block.dataset.characterId || '', characterKey: 'mei', characterColor: block.dataset.characterColor || '#b8bcb8', portraitPreset: block.dataset.portraitPreset || null, statusTags: [...block.querySelectorAll('.status-pill')].map((tag) => tag.textContent.trim()).filter(Boolean), voice: block.querySelector('.voice-pill')?.textContent.replace(/^♪\s*/, '').trim() || '', text: richTextPlainText(paragraph), textHtml: sanitizeRichTextHtml(paragraph?.innerHTML || ''), textAlign: paragraph?.style.textAlign || 'left', note: block.querySelector('.block-note')?.textContent.replace(/^(?:创作备注|注)：/, '').trim() || '', avatar: block.dataset.avatar || undefined, portrait: block.dataset.portrait || undefined };
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
function updateSceneWordCount() {
  const wordEl = document.getElementById('sceneWordCountValue');
  if (!wordEl) return;
  let total = 0;
  const characterIds = new Set();
  let dialogues = 0, choices = 0, narrations = 0;
  document.querySelectorAll('.script-canvas > .script-block').forEach((block) => {
    if (block.classList.contains('dialogue')) {
      dialogues++;
      const cid = block.dataset.characterId;
      if (cid) characterIds.add(cid);
    } else if (block.classList.contains('item-block')) {
      let itemBlocks = [];
      try { itemBlocks = JSON.parse(block.dataset.itemBlocks || '[]'); } catch {}
      const countItemContent = (contents) => (contents || []).forEach((itemContent) => {
        if (itemContent.type === 'dialogue') { dialogues += 1; if (itemContent.characterId) characterIds.add(itemContent.characterId); }
        if (itemContent.type === 'narration') narrations += 1;
        if (itemContent.type === 'choice') choices += (itemContent.options || []).length;
        total += writingCheckTools.plainText(itemContent.textHtml || itemContent.text || itemContent.title).length;
        (itemContent.options || []).forEach((option) => { total += String(option.text || '').trim().length; });
        if (itemContent.type === 'item') { total += String(itemContent.investigation?.text || '').trim().length; countItemContent(itemContent.blocks); }
      });
      countItemContent(itemBlocks);
      const investigation = block.querySelector('.script-item-investigation-text');
      if (investigation && !investigation.classList.contains('empty')) total += investigation.textContent.trim().length;
    } else if (block.classList.contains('choice-block')) {
      choices += block.querySelectorAll('.choice-option-text').length;
    } else if (block.classList.contains('narration')) {
      narrations++;
    }
    block.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      if (el.closest('.choice-option-target')) return;
      const text = richTextPlainText(el);
      if (text) total += text.length;
    });
    block.querySelectorAll('.choice-option-text').forEach((input) => {
      if (input.value) total += input.value.trim().length;
    });
  });
  wordEl.textContent = total.toLocaleString();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statCharacters', `${characterIds.size} 角色`);
  set('statDialogues', `${dialogues} 对话`);
  set('statChoices', `${choices} 选项`);
  set('statNarrations', `${narrations} 旁白`);
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
function syncCurrentScene() {
  const scene = currentScene();
  if (!scene || itemDialogueEditorState) return;
  scene.blocks = captureBlocks();
}
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
  for (let blockIndex = Math.min(index - 1, blocks.length - 1); blockIndex >= 0; blockIndex -= 1) {
    if (blocks[blockIndex]?.type === 'segment') return blocks[blockIndex].perspectiveCharacterId || null;
  }
  return null;
}
function createContentId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function walkItemContent(itemBlock, visitor) {
  if (itemFormatTools?.walkItemContent) itemFormatTools.walkItemContent(itemBlock, visitor);
}
function flattenedItemPreviewBlocks(itemBlock) {
  const frames = [];
  const collect = (owner) => (owner?.blocks || []).forEach((block, index) => {
    frames.push({ block, owner, index });
    if (block.type === 'item') collect(block);
  });
  collect(itemBlock);
  return frames;
}
function orderedStatusTags(tags) {
  return [...(tags || [])].sort((left, right) => Number(right === '关键节点') - Number(left === '关键节点'));
}
function criticalDialogueNodes() {
  const nodes = [];
  (desktopState.data?.chapters || []).forEach((chapter, chapterIndex) => {
    (chapter.scenes || []).forEach((scene, sceneIndex) => {
      (scene.blocks || []).forEach((block, blockIndex) => {
        const dialogues = block.type === 'dialogue' ? [{ dialogue: block, itemPath: [] }] : [];
        if (block.type === 'item') walkItemContent(block, (entry, path) => { if (entry.type === 'dialogue') dialogues.push({ dialogue: entry, itemPath: path }); });
        dialogues.forEach(({ dialogue, itemPath }) => {
          if (!(dialogue.statusTags || []).includes('关键节点')) return;
          nodes.push({
            id: dialogue.id,
            chapterIndex,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            sceneIndex,
            sceneTitle: scene.title,
            blockIndex,
            itemDialogueId: block.type === 'item' ? dialogue.id : '',
            itemPath,
            character: dialogue.character || '未设置角色',
            text: String(dialogue.text || '空对白'),
            label: `${chapter.title} / ${scene.title} · ${dialogue.character || '未设置角色'}：${String(dialogue.text || '空对白').slice(0, 24)}`
          });
        });
      });
    });
  });
  return nodes;
}
function navigateToDialogueNode(blockId) {
  const target = criticalDialogueNodes().find((item) => item.id === blockId);
  if (!target) { showToast('关联的关键节点不存在或已取消“关键节点”状态'); return; }
  navigateToProjectBlock(target.chapterIndex, target.sceneIndex, target.blockIndex);
  if (target.itemDialogueId) {
    const root = currentScene()?.blocks?.[target.blockIndex];
    const nestedItemIds = [];
    let cursor = root;
    for (const index of (target.itemPath || []).slice(0, -1)) {
      cursor = cursor?.blocks?.[index];
      if (cursor?.type === 'item') nestedItemIds.push(cursor.id);
    }
    openItemDialogueEditor(root?.id, nestedItemIds);
    selectedItemDialogueId = target.itemDialogueId;
    renderItemDialogueEditor();
  }
}
function navigateToProjectBlock(chapterIndex, sceneIndex, blockIndex = 0) {
  if (!desktopState.data?.chapters?.[chapterIndex]?.scenes?.[sceneIndex]) return;
  syncCurrentScene();
  activeChapterIndex = chapterIndex;
  activeSceneIndex = sceneIndex;
  selectedBlockIndex = Math.max(0, blockIndex);
  expandedChapterIds.add(desktopState.data.chapters[chapterIndex].id);
  const targetScene = desktopState.data.chapters[chapterIndex].scenes[sceneIndex];
  if (targetScene.branchId) expandedBranchIds.add(targetScene.branchId);
  document.querySelector('[data-view="editor"]')?.click();
  renderChapters(); renderSceneTabs(); renderScene(); renderInspector();
  requestAnimationFrame(() => document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}
function closeCriticalNodePickers(except = null) {
  document.querySelectorAll('.choice-target-picker.open').forEach((picker) => { if (picker !== except) picker.classList.remove('open'); });
}
function createCriticalNodePicker(parent, option, criticalNodes, onChange) {
  const picker = addChild(parent, 'div', 'choice-target-picker');
  const trigger = addChild(picker, 'button', 'choice-target-trigger'); trigger.type = 'button';
  const triggerCopy = addChild(trigger, 'span', 'choice-target-trigger-copy');
  const triggerTitle = addChild(triggerCopy, 'b');
  const triggerDetail = addChild(triggerCopy, 'small');
  addChild(trigger, 'span', 'choice-target-chevron', '⌄');
  const panel = addChild(picker, 'div', 'choice-target-panel');
  const controls = addChild(panel, 'div', 'choice-target-controls');
  const search = addChild(controls, 'input', 'choice-target-search'); search.type = 'search'; search.placeholder = '搜索角色、场景或对白内容';
  const chapterFilter = addChild(controls, 'select', 'choice-target-chapter-filter');
  const allChapters = addChild(chapterFilter, 'option', '', '全部章节'); allChapters.value = '';
  [...new Map(criticalNodes.map((target) => [target.chapterId, target])).values()].forEach((target) => { const chapterOption = addChild(chapterFilter, 'option', '', target.chapterTitle); chapterOption.value = target.chapterId; });
  const list = addChild(panel, 'div', 'choice-target-list');
  const selectedTarget = () => criticalNodes.find((target) => target.id === option.targetBlockId);
  const updateTrigger = () => {
    const target = selectedTarget();
    picker.classList.toggle('has-value', Boolean(option.targetBlockId));
    triggerTitle.textContent = target ? `${target.character}：${target.text.slice(0, 18)}` : option.targetBlockId ? '关联节点已失效' : '选择关键节点';
    triggerDetail.textContent = target ? `${target.chapterTitle} / ${target.sceneTitle}` : option.targetBlockId ? '请重新选择目标节点' : '可搜索或按章节筛选';
  };
  const chooseTarget = (targetBlockId) => {
    option.targetBlockId = targetBlockId;
    updateTrigger();
    closeCriticalNodePickers();
    onChange();
  };
  const renderList = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const chapterId = chapterFilter.value;
    const filtered = criticalNodes.filter((target) => (!chapterId || target.chapterId === chapterId) && (!query || `${target.chapterTitle} ${target.sceneTitle} ${target.character} ${target.text}`.toLocaleLowerCase().includes(query)));
    list.replaceChildren();
    const clear = addChild(list, 'button', `choice-target-item clear${option.targetBlockId ? '' : ' selected'}`); clear.type = 'button';
    addChild(clear, 'b', '', '不关联关键节点'); addChild(clear, 'small', '', '保留为普通玩家选项'); clear.addEventListener('click', () => chooseTarget(''));
    if (!filtered.length) { addChild(list, 'div', 'choice-target-empty', '没有找到符合条件的关键节点'); return; }
    let previousChapterId = null;
    filtered.forEach((target) => {
      if (target.chapterId !== previousChapterId) { addChild(list, 'div', 'choice-target-group-title', target.chapterTitle); previousChapterId = target.chapterId; }
      const item = addChild(list, 'button', `choice-target-item${option.targetBlockId === target.id ? ' selected' : ''}`); item.type = 'button';
      const copy = addChild(item, 'span'); addChild(copy, 'b', '', `${target.character}：${target.text.slice(0, 34)}`); addChild(copy, 'small', '', target.sceneTitle);
      addChild(item, 'span', 'choice-target-item-mark', option.targetBlockId === target.id ? '✓' : '');
      item.addEventListener('click', () => chooseTarget(target.id));
    });
  };
  trigger.addEventListener('click', (event) => { event.stopPropagation(); const opening = !picker.classList.contains('open'); closeCriticalNodePickers(picker); picker.classList.toggle('open', opening); if (opening) { renderList(); requestAnimationFrame(() => search.focus()); } });
  panel.addEventListener('click', (event) => event.stopPropagation());
  search.addEventListener('input', renderList);
  chapterFilter.addEventListener('change', renderList);
  updateTrigger();
  return picker;
}
function createBlockElement(block, index, options = {}) {
  const blockClass = block.type === 'choice' ? 'choice-block' : block.type === 'segment' ? 'segment-block' : block.type === 'item' ? 'item-block' : block.type;
  const selected = options.selectedBlockId ? block.id === options.selectedBlockId : index === selectedBlockIndex;
  const wrapper = node('div', `script-block ${blockClass}${selected ? ' selected' : ''}`);
  wrapper.dataset.blockIndex = String(index);
  wrapper.dataset.blockId = block.id || createContentId(block.type || 'block');
  block.id = wrapper.dataset.blockId;
  const actions = addChild(wrapper, 'div', 'block-actions');
  const segmentHasImages = block.type === 'segment' && Array.isArray(block.images) && block.images.length > 0;
  if (!segmentHasImages) {
    const remove = addChild(actions, 'button', 'block-action delete', '\u00d7');
    remove.type = 'button'; remove.title = block.type === 'segment' ? '删除分段' : '\u5220\u9664'; remove.dataset.blockAction = 'delete';
  }
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
        const removeSegment = addChild(figure, 'button', 'segment-image-remove', '×'); removeSegment.type = 'button'; removeSegment.title = '删除分段'; removeSegment.setAttribute('aria-label', '删除分段');
        removeSegment.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (options.onDelete) options.onDelete(block, index); else deleteBlock(index); });
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
  } else if (block.type === 'item') {
    const item = (desktopState.data?.items || []).find((entry) => entry.id === block.itemId);
    block.investigation = block.investigation && typeof block.investigation === 'object' ? block.investigation : { text: '' };
    block.blocks = Array.isArray(block.blocks) ? block.blocks : [];
    wrapper.dataset.itemId = block.itemId || '';
    wrapper.dataset.itemBlocks = JSON.stringify(block.blocks);
    const visual = addChild(content, 'div', 'script-item-visual');
    const cover = item?.images?.find((image) => image.id === item.coverImageId) || item?.images?.[0];
    if (cover?.relativePath && desktopState.filePath) {
      const image = addChild(visual, 'img'); image.alt = item?.name || '物品';
      loadProjectImage(cover.relativePath, image, visual);
    } else addChild(visual, 'span', 'script-item-placeholder', '◇');
    const copy = addChild(content, 'div', 'script-item-copy');
    addChild(copy, 'span', 'block-type', '物品');
    addChild(copy, 'h3', 'script-item-name', item?.name || '物品已失效');
    if (item?.tags?.length) {
      const tags = addChild(copy, 'div', 'script-item-tags');
      item.tags.forEach((tag) => addChild(tags, 'span', '', tag));
    }
    if (item?.summary) addChild(copy, 'div', 'script-item-summary', item.summary);
    const investigation = addChild(copy, 'div', 'script-item-investigation');
    addChild(investigation, 'span', 'script-item-section-label', '调查反应');
    const investigationText = addChild(investigation, 'div', `script-item-investigation-text${block.investigation.text ? '' : ' empty'}`, block.investigation.text || '尚未填写调查反应');
    const dialogueList = addChild(copy, 'div', 'item-dialogue-list item-dialogue-summary-list');
    const dialogueHeading = addChild(dialogueList, 'div', 'item-dialogue-summary-heading');
    addChild(dialogueHeading, 'span', 'script-item-section-label', '物品内容流');
    addChild(dialogueHeading, 'small', '', `${block.blocks.length} 项`);
    if (!block.blocks.length) addChild(dialogueList, 'span', 'item-dialogue-empty', '尚未添加对白、旁白、选择、物品或分段');
    block.blocks.slice(0, 3).forEach((contentBlock) => {
      const entry = addChild(dialogueList, 'div', 'item-dialogue-summary-entry');
      const character = contentBlock.type === 'dialogue' ? (desktopState.data?.characters || []).find((candidate) => candidate.id === contentBlock.characterId || candidate.name === contentBlock.character) : null;
      const nestedItem = contentBlock.type === 'item' ? (desktopState.data?.items || []).find((entry) => entry.id === contentBlock.itemId) : null;
      const typeLabels = { dialogue: '对白', narration: '旁白', choice: '选择', item: '物品', segment: '分段' };
      const avatar = addChild(entry, 'div', `item-dialogue-summary-avatar type-${contentBlock.type}`, contentBlock.type === 'dialogue' ? (contentBlock.character || character?.name || '?').slice(0, 1) : contentBlock.type === 'narration' ? '旁' : contentBlock.type === 'choice' ? '选' : contentBlock.type === 'item' ? '物' : '段');
      avatar.style.background = contentBlock.type === 'dialogue' ? contentBlock.characterColor || character?.color || '#b8bcb8' : 'var(--accent-soft)';
      const avatarPath = contentBlock.type === 'dialogue' ? contentBlock.avatar || characterDefaultMedia(character, 'avatarGroup')?.relativePath || '' : '';
      if (avatarPath && desktopState.filePath) loadProjectImage(avatarPath, (() => { const image = addChild(avatar, 'img'); image.alt = `${contentBlock.character || character?.name || '角色'}头像`; return image; })(), avatar);
      const summary = addChild(entry, 'div', 'item-dialogue-summary-copy');
      addChild(summary, 'b', '', contentBlock.type === 'dialogue' ? contentBlock.character || character?.name || '未设置角色' : typeLabels[contentBlock.type] || '内容');
      const summaryText = contentBlock.type === 'item' ? nestedItem?.name : contentBlock.type === 'choice' || contentBlock.type === 'segment' ? contentBlock.title : contentBlock.textHtml || contentBlock.text;
      addChild(summary, 'span', '', writingCheckTools.plainText(summaryText) || `尚未填写${typeLabels[contentBlock.type] || '内容'}`);
    });
    if (block.blocks.length > 3) addChild(dialogueList, 'span', 'item-dialogue-summary-more', `另有 ${block.blocks.length - 3} 项内容`);
    const editDialogues = addChild(copy, 'button', 'item-dialogue-open-editor', '编辑物品内容'); editDialogues.type = 'button';
    editDialogues.addEventListener('click', (event) => { event.stopPropagation(); openItemDialogueEditor(block.id); });
  } else if (block.type === 'narration') {
    const paragraph = addChild(content, 'p', 'narration-text', block.text);
    paragraph.dataset.placeholder = '输入旁白内容…';
  } else if (block.type === 'choice') {
    block.options = Array.isArray(block.options) ? block.options.map((option) => typeof option === 'string' ? { id: createContentId('choice-option'), text: option, targetBlockId: '' } : { id: option.id || createContentId('choice-option'), text: option.text || '', targetBlockId: option.targetBlockId || '' }) : [];
    wrapper.dataset.choiceOptions = JSON.stringify(block.options);
    addChild(wrapper, 'div', 'choice-icon', '↳'); addChild(content, 'span', 'block-type', '玩家选择'); addChild(content, 'p', 'choice-title', block.title || '玩家将如何选择？');
    const choices = addChild(content, 'div', 'choices');
    const criticalNodes = criticalDialogueNodes();
    const syncChoiceOptions = () => { wrapper.dataset.choiceOptions = JSON.stringify(block.options); options.onChange?.(block); markDirty(); };
    block.options.forEach((option, optionIndex) => {
      const row = addChild(choices, 'div', 'choice-option-row');
      const textInput = addChild(row, 'input', 'choice-option-text'); textInput.value = option.text; textInput.placeholder = `选项 ${optionIndex + 1}`;
      textInput.addEventListener('input', () => { option.text = textInput.value; syncChoiceOptions(); });
      let jump = null;
      createCriticalNodePicker(row, option, criticalNodes, () => { syncChoiceOptions(); jump.disabled = !option.targetBlockId; });
      jump = addChild(row, 'button', 'choice-option-jump', '↗'); jump.type = 'button'; jump.title = '定位关联节点'; jump.disabled = !option.targetBlockId;
      jump.addEventListener('click', () => navigateToDialogueNode(option.targetBlockId));
      const removeOption = addChild(row, 'button', 'choice-option-remove', '×'); removeOption.type = 'button'; removeOption.title = '删除选项';
      removeOption.addEventListener('click', () => {
        if (!options.context) syncCurrentScene();
        const liveChoice = options.getBlock ? options.getBlock(block.id) : currentScene()?.blocks?.find((item) => item.id === block.id);
        if (!liveChoice) return;
        liveChoice.options = (liveChoice.options || []).filter((item) => item.id !== option.id);
        if (options.refresh) options.refresh(); else renderScene();
        options.onChange?.(liveChoice); markDirty();
      });
    });
    const addOption = addChild(content, 'button', 'choice-option-add', '＋ 添加选项'); addOption.type = 'button';
    addOption.addEventListener('click', () => {
      if (!options.context) syncCurrentScene();
      const liveChoice = options.getBlock ? options.getBlock(block.id) : currentScene()?.blocks?.find((item) => item.id === block.id);
      if (!liveChoice) return;
      liveChoice.options ||= [];
      liveChoice.options.push({ id: createContentId('choice-option'), text: '', targetBlockId: '' });
      if (options.refresh) options.refresh(); else renderScene();
      options.onChange?.(liveChoice); markDirty();
      requestAnimationFrame(() => document.querySelector(`${options.context ? '#itemDialogueEditor ' : ''}.script-block[data-block-index="${index}"] .choice-option-row:last-child input`)?.focus());
    });
  } else {
    const character = (desktopState.data?.characters || []).find((item) => item.id === block.characterId || item.name === block.character);
    const hasCharacter = Boolean(character || String(block.character || '').trim());
    if (!Array.isArray(block.statusTags)) block.statusTags = [block.statusTag || block.emotion || ''].map((tag) => String(tag).trim()).filter(Boolean);
    const perspectiveCharacterId = Object.hasOwn(options, 'perspectiveCharacterId') ? options.perspectiveCharacterId : perspectiveCharacterIdAt(index);
    const isPerspective = Boolean(perspectiveCharacterId && perspectiveCharacterId === (block.characterId || character?.id));
    if (isPerspective) wrapper.classList.add('pov-dialogue');
    if (!hasCharacter) wrapper.classList.add('unassigned-dialogue');
    const meta = addChild(content, 'div', 'dialogue-meta');
    if (hasCharacter) {
      const avatarPath = block.avatar || characterDefaultMedia(character, 'avatarGroup')?.relativePath || '';
      const thumb = addChild(wrapper, 'div', 'character-thumb dialogue-avatar', (block.character || character?.name || '').slice(0, 1)); thumb.style.background = block.characterColor || character?.color || '#f2674f'; thumb.style.setProperty('--character-color', block.characterColor || character?.color || '#f2674f');
      if (avatarPath && desktopState.filePath) desktopApi.readAsset(desktopState.filePath, avatarPath).then(async (src) => {
        if (!src || !thumb.isConnected) return;
        const normalizedSource = await normalizeDialogueAvatarSource(avatarPath, src);
        if (!thumb.isConnected) return;
        thumb.textContent = '';
        thumb.classList.add('has-avatar-image');
        const avatarImage = addChild(thumb, 'img', 'dialogue-avatar-image');
        avatarImage.alt = `${block.character || character?.name || '角色'}头像`;
        avatarImage.src = normalizedSource;
      }).catch(() => thumb.classList.add('asset-missing'));
      const nameNode = addChild(meta, 'span', 'character-name', block.character || character?.name || ''); nameNode.style.color = block.characterColor || character?.color || '#f2674f';
    } else addChild(meta, 'span', 'unassigned-character-hint', '未设置角色');
    if (isPerspective) addChild(meta, 'span', 'pov-pill', '主视角'); orderedStatusTags(block.statusTags).forEach((statusTag) => addChild(meta, 'span', `status-pill${statusTag === '关键节点' ? ' critical-node-tag' : ''}`, statusTag)); addChild(meta, 'span', 'voice-pill', `♪ ${block.voice || '未设定'}`);
    const paragraph = addChild(content, 'p');
    if (block.textHtml) paragraph.innerHTML = sanitizeRichTextHtml(block.textHtml); else paragraph.textContent = block.text || '';
    paragraph.style.textAlign = block.textAlign || 'left';
    if (block.note) addChild(content, 'div', 'block-note', `创作备注：${block.note}`);
    if (block.avatar) wrapper.dataset.avatar = block.avatar; if (block.portrait) wrapper.dataset.portrait = block.portrait; if (block.portraitPreset) wrapper.dataset.portraitPreset = block.portraitPreset; if (block.characterId || character?.id) wrapper.dataset.characterId = block.characterId || character.id; wrapper.dataset.characterColor = block.characterColor || character?.color || '#b8bcb8';
  }
  wrapper.appendChild(content);
  wrapper.querySelectorAll('p').forEach((paragraph) => { paragraph.contentEditable = 'true'; });
  return wrapper;
}

function syncDialogueNoteDisplay(blockIndex, value) {
  const content = document.querySelector(`.script-block[data-block-index="${blockIndex}"] .block-content`);
  if (!content) return;
  let noteNode = content.querySelector('.block-note');
  const note = String(value || '').trim();
  if (!note) { noteNode?.remove(); return; }
  if (!noteNode) noteNode = addChild(content, 'div', 'block-note');
  noteNode.textContent = `创作备注：${note}`;
}

function positionFlowAddActions() {
  const canvas = document.querySelector('.script-canvas');
  const actions = document.getElementById('flowAddActions');
  if (!canvas || !actions) return;
  const selectedBlock = canvas.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"]`);
  actions.classList.toggle('empty-scene', !selectedBlock);
  if (selectedBlock) selectedBlock.insertAdjacentElement('afterend', actions);
  else canvas.appendChild(actions);
}

function isBranchScene(scene) {
  return storyFlowTools?.isBranchScene ? storyFlowTools.isBranchScene(scene) : scene?.kind === 'branch';
}

function branchGroupForScene(scene, chapter = currentChapter()) {
  if (!isBranchScene(scene)) return null;
  return (chapter?.branches || []).find((branch) => branch.id === scene.branchId) || null;
}

function branchScenes(chapter, branchId) {
  return (chapter?.scenes || []).filter((scene) => isBranchScene(scene) && scene.branchId === branchId);
}

function renderBranchTriggerPanel(scene) {
  const panel = document.getElementById('branchTriggerPanel');
  const input = document.getElementById('branchTriggerInput');
  const status = document.getElementById('branchFlowStatus');
  const toggle = document.getElementById('branchFlowToggle');
  if (!panel || !input || !status || !toggle) return;
  const isBranch = isBranchScene(scene);
  panel.classList.toggle('hidden', !isBranch);
  if (!isBranch) return;
  const branch = branchGroupForScene(scene);
  const badge = panel.querySelector('.branch-trigger-badge');
  if (badge) badge.textContent = branch?.title ? `支线 · ${branch.title}` : '支线';
  input.value = branch?.trigger || '';
  const included = branch?.includeInFlow === true;
  status.textContent = included ? '已加入流程图' : '默认不参与流程图';
  status.classList.toggle('included', included);
  toggle.textContent = included ? '从流程图移出' : '加入流程图';
  toggle.classList.toggle('included', included);
}

function renderScene() {
  clearSegmentSlideshows();
  const scene = currentScene(); if (!scene) return;
  const canvas = document.querySelector('.script-canvas'); const addButton = document.getElementById('flowAddActions');
  selectedBlockIndex = Math.min(selectedBlockIndex, Math.max(0, (scene.blocks || []).length - 1));
  canvas.querySelectorAll('.script-block').forEach((block) => block.remove());
  (scene.blocks || []).forEach((block, index) => canvas.insertBefore(createBlockElement(block, index), addButton));
  positionFlowAddActions();
  document.getElementById('sceneTitle').textContent = scene.title;
  document.getElementById('sceneSummary').textContent = scene.blocks?.length ? `${isBranchScene(scene) ? '支线 · ' : ''}${scene.blocks.length} 个内容块` : (isBranchScene(scene) ? '空白支线' : '空白场景');
  renderBranchTriggerPanel(scene);
  const breadcrumbTitle = document.getElementById('breadcrumbSceneTitle');
  if (breadcrumbTitle) { breadcrumbTitle.classList.remove('editing'); breadcrumbTitle.textContent = `第 ${activeChapterIndex + 1} 章 · ${scene.title}`; }
}
function renderSceneTabs() {
  const tabs = document.querySelector('.scene-tabs'); tabs.replaceChildren(); const chapter = currentChapter(); const activeScene = currentScene();
  const sceneItems = (chapter?.scenes || []).map((scene, index) => ({ scene, index })).filter(({ scene }) => isBranchScene(activeScene) ? scene.branchId === activeScene.branchId : !isBranchScene(scene));
  sceneItems.forEach(({ scene, index }) => { const branch = branchGroupForScene(scene, chapter); const button = addChild(tabs, 'button', `scene-tab${isBranchScene(scene) ? ' branch' : ''}${index === activeSceneIndex ? ' active' : ''}`); button.title = isBranchScene(scene) ? `${branch?.title || '支线'} · ${branch?.includeInFlow ? '已加入流程图' : '默认不参与流程图'}` : scene.title; button.append(document.createTextNode(`${scene.number} `)); addChild(button, 'span', '', scene.title); button.addEventListener('click', () => activateScene(index)); button.addEventListener('dblclick', () => renameScene(index)); });
  const add = addChild(tabs, 'button', 'add-scene', '＋'); add.title = isBranchScene(activeScene) ? '添加支线场景' : '添加场景'; add.addEventListener('click', () => { if (isBranchScene(currentScene())) addBranchScene(activeChapterIndex, currentScene().branchId); else addScene(); });
}
function activateScene(index) { syncCurrentScene(); activeSceneIndex = index; selectedBlockIndex = 0; renderSceneTabs(); renderScene(); }
async function renameScene(index) { const scene = currentChapter()?.scenes?.[index]; if (!scene) return; const title = await requestTextInput('场景名称', scene.title); if (title) { scene.title = title; renderChapters(); renderSceneTabs(); renderScene(); markDirty(); } }
function resizeBreadcrumbSceneInput(input) {
  input.style.width = `${Math.max(96, Math.min(360, Array.from(input.value || '').length * 14 + 24))}px`;
}
function previewBreadcrumbSceneTitle(value) {
  const title = String(value || '').trim() || '未命名场景';
  const editorTitle = document.getElementById('sceneTitle');
  const activeSceneTab = document.querySelector('.scene-tab.active span');
  const activeSceneFile = document.querySelector('.chapter-scene-file.active .scene-file-name');
  if (editorTitle) editorTitle.textContent = title;
  if (activeSceneTab) activeSceneTab.textContent = title;
  if (activeSceneFile) activeSceneFile.textContent = title;
}
function beginBreadcrumbSceneRename() {
  const detail = document.getElementById('breadcrumbSceneTitle');
  const scene = currentScene();
  if (!detail || !scene || detail.classList.contains('editing') || document.querySelector('.editor-layout')?.classList.contains('hidden')) return;
  detail.classList.add('editing');
  detail.replaceChildren();
  addChild(detail, 'span', 'breadcrumb-chapter-prefix', `第 ${activeChapterIndex + 1} 章 ·`);
  const input = addChild(detail, 'input', 'breadcrumb-scene-input'); input.type = 'text'; input.value = scene.title; input.maxLength = 80; input.setAttribute('aria-label', '当前场景名称');
  resizeBreadcrumbSceneInput(input);
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const nextTitle = input.value.trim();
    if (save && nextTitle && nextTitle !== scene.title) {
      scene.title = nextTitle;
      renderChapters();
      renderSceneTabs();
      renderScene();
      markDirty();
      showToast('场景名称已更新');
      return;
    }
    renderScene();
  };
  input.addEventListener('input', () => { resizeBreadcrumbSceneInput(input); previewBreadcrumbSceneTitle(input.value); });
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); previewBreadcrumbSceneTitle(scene.title); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    const caretPosition = input.value.length;
    input.setSelectionRange(caretPosition, caretPosition);
  });
}
const breadcrumbSceneTitle = document.getElementById('breadcrumbSceneTitle');
breadcrumbSceneTitle?.addEventListener('click', beginBreadcrumbSceneRename);
breadcrumbSceneTitle?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginBreadcrumbSceneRename(); } });
function addScene() {
  syncCurrentScene();
  const chapter = currentChapter();
  if (!chapter) return;
  const sceneNumber = chapter.scenes.filter((scene) => !isBranchScene(scene)).length + 1;
  const insertionIndex = chapter.scenes.findIndex(isBranchScene);
  const scene = { id: `scene-${Date.now()}`, number: String(sceneNumber).padStart(2, '0'), title: `未命名场景 ${sceneNumber}`, kind: 'scene', branchId: '', background: '', blocks: [] };
  if (insertionIndex < 0) chapter.scenes.push(scene); else chapter.scenes.splice(insertionIndex, 0, scene);
  activeSceneIndex = chapter.scenes.indexOf(scene);
  selectedBlockIndex = 0;
  normalizeSceneNumbers(chapter);
  renderChapters(); renderSceneTabs(); renderScene(); markDirty(); showToast('已添加新场景');
}
function addBranch(chapterIndex = activeChapterIndex) {
  syncCurrentScene();
  const chapter = desktopState.data?.chapters?.[chapterIndex];
  if (!chapter) return;
  chapter.branches ||= [];
  const branchNumber = chapter.branches.length + 1;
  const branchId = `branch-${Date.now()}`;
  chapter.branches.push({ id: branchId, title: `未命名支线 ${branchNumber}`, trigger: '', includeInFlow: false });
  const scene = { id: `branch-scene-${Date.now()}`, number: '01', title: '场景 1', kind: 'branch', branchId, background: '', blocks: [] };
  chapter.scenes.push(scene);
  expandedChapterIds.add(chapter.id);
  expandedBranchIds.add(branchId);
  activeChapterIndex = chapterIndex;
  activeSceneIndex = chapter.scenes.indexOf(scene);
  selectedBlockIndex = 0;
  normalizeSceneNumbers(chapter);
  renderChapters(); renderSceneTabs(); renderScene();
  document.querySelector('[data-view="editor"]')?.click();
  markDirty(); showToast('已添加支线');
}
function addBranchScene(chapterIndex, branchId) {
  syncCurrentScene();
  const chapter = desktopState.data?.chapters?.[chapterIndex];
  const branch = (chapter?.branches || []).find((item) => item.id === branchId);
  if (!chapter || !branch) return;
  const existingScenes = branchScenes(chapter, branchId);
  const sceneNumber = existingScenes.length + 1;
  const scene = { id: `branch-scene-${Date.now()}`, number: String(sceneNumber).padStart(2, '0'), title: `场景 ${sceneNumber}`, kind: 'branch', branchId, background: '', blocks: [] };
  const lastIndex = Math.max(...existingScenes.map((item) => chapter.scenes.indexOf(item)));
  chapter.scenes.splice(Number.isFinite(lastIndex) ? lastIndex + 1 : chapter.scenes.length, 0, scene);
  expandedChapterIds.add(chapter.id); expandedBranchIds.add(branchId);
  activeChapterIndex = chapterIndex; activeSceneIndex = chapter.scenes.indexOf(scene); selectedBlockIndex = 0;
  normalizeSceneNumbers(chapter); renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]')?.click(); markDirty(); showToast('已添加支线场景');
}
function normalizeSceneNumbers(chapter) {
  let sceneNumber = 0;
  const branchNumbers = new Map();
  chapter.scenes.forEach((scene) => {
    if (isBranchScene(scene)) { const next = (branchNumbers.get(scene.branchId) || 0) + 1; branchNumbers.set(scene.branchId, next); scene.number = String(next).padStart(2, '0'); }
    else scene.number = String(++sceneNumber).padStart(2, '0');
  });
}
function setBranchFlowParticipation(chapterIndex, sceneIndex, included) {
  syncCurrentScene();
  const chapter = desktopState.data?.chapters?.[chapterIndex];
  const scene = chapter?.scenes?.[sceneIndex];
  const branch = branchGroupForScene(scene, chapter);
  if (!branch) return;
  branch.includeInFlow = Boolean(included);
  desktopState.data.sceneFlow = storyFlowTools.normalizeSceneFlow(desktopState.data.sceneFlow, desktopState.data.chapters);
  renderChapters();
  if (chapterIndex === activeChapterIndex && sceneIndex === activeSceneIndex) renderBranchTriggerPanel(scene);
  if (!views.flow?.classList.contains('hidden')) renderSceneFlow();
  markDirty();
  showToast(branch.includeInFlow ? '支线已加入流程图' : '支线已从流程图移出');
}
document.getElementById('branchTriggerInput')?.addEventListener('input', (event) => {
  const scene = currentScene();
  const branch = branchGroupForScene(scene);
  if (!branch) return;
  branch.trigger = event.target.value;
  markDirty();
});
document.getElementById('branchFlowToggle')?.addEventListener('click', () => {
  const scene = currentScene();
  const branch = branchGroupForScene(scene);
  if (!branch) return;
  setBranchFlowParticipation(activeChapterIndex, activeSceneIndex, !branch.includeInFlow);
});
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
  const sourceScene = sourceChapter.scenes[sourceIndex];
  const targetScene = targetSceneId ? targetChapter.scenes.find((scene) => scene.id === targetSceneId) : null;
  if (isBranchScene(sourceScene) && (sourceChapter !== targetChapter || !isBranchScene(targetScene) || sourceScene.branchId !== targetScene.branchId)) { showToast('支线场景只能在所属支线内调整顺序'); return; }
  if (!isBranchScene(sourceScene) && isBranchScene(targetScene)) { showToast('普通场景不能移入支线'); return; }
  if (sourceChapter !== targetChapter && sourceChapter.scenes.length <= 1) { showToast('每个章节至少需要保留一个场景'); return; }
  if (sourceChapter !== targetChapter && !isBranchScene(sourceScene) && sourceChapter.scenes.filter((scene) => !isBranchScene(scene)).length <= 1) { showToast('每个章节至少需要保留一个普通场景'); return; }
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
  desktopState.data.sceneFlow = storyFlowTools.normalizeSceneFlow(desktopState.data.sceneFlow, desktopState.data.chapters);
  const nextChapter = chapters[Math.min(chapterIndex, chapters.length - 1)]; const keepChapterId = activeChapterId === chapter.id ? nextChapter.id : activeChapterId; const keepSceneId = activeChapterId === chapter.id ? nextChapter.scenes[0]?.id : activeSceneId;
  expandedChapterIds.add(keepChapterId); finishTreeMutation(keepChapterId, keepSceneId, '章节已删除');
}
async function deleteScene(chapterIndex, sceneIndex) {
  const chapter = desktopState.data.chapters[chapterIndex];
  if (!chapter || chapter.scenes.length <= 1) { showToast('每个章节至少需要保留一个场景'); return; }
  const scene = chapter.scenes[sceneIndex]; const sceneType = isBranchScene(scene) ? '支线场景' : '场景';
  if (!scene) return;
  if (isBranchScene(scene) && branchScenes(chapter, scene.branchId).length <= 1) { showToast('每条支线至少需要保留一个场景，可从支线菜单删除整条支线'); return; }
  if (!isBranchScene(scene) && chapter.scenes.filter((item) => !isBranchScene(item)).length <= 1) { showToast('每个章节至少需要保留一个普通场景'); return; }
  if (!(await requestDeleteConfirmation(`确定删除${sceneType}「${scene.title}」吗？`))) return;
  syncCurrentScene(); const activeChapterId = currentChapter()?.id; const activeSceneId = currentScene()?.id;
  chapter.scenes.splice(sceneIndex, 1); normalizeSceneNumbers(chapter);
  const nextScene = chapter.scenes[Math.min(sceneIndex, chapter.scenes.length - 1)]; const keepSceneId = activeSceneId === scene.id ? nextScene.id : activeSceneId;
  desktopState.data.sceneFlow = storyFlowTools.normalizeSceneFlow(desktopState.data.sceneFlow, desktopState.data.chapters);
  finishTreeMutation(activeChapterId, keepSceneId, `${sceneType}已删除`);
}
async function deleteBranch(chapterIndex, branchId) {
  const chapter = desktopState.data.chapters[chapterIndex];
  const branch = (chapter?.branches || []).find((item) => item.id === branchId);
  if (!chapter || !branch || !(await requestDeleteConfirmation(`确定删除支线「${branch.title}」及其中全部场景吗？`))) return;
  syncCurrentScene();
  const activeSceneId = currentScene()?.id;
  const deletedSceneIds = new Set(branchScenes(chapter, branchId).map((scene) => scene.id));
  chapter.scenes = chapter.scenes.filter((scene) => scene.branchId !== branchId);
  chapter.branches = chapter.branches.filter((item) => item.id !== branchId);
  expandedBranchIds.delete(branchId);
  normalizeSceneNumbers(chapter);
  desktopState.data.sceneFlow = storyFlowTools.normalizeSceneFlow(desktopState.data.sceneFlow, desktopState.data.chapters);
  const keepScene = deletedSceneIds.has(activeSceneId) ? chapter.scenes.find((scene) => !isBranchScene(scene)) || chapter.scenes[0] : chapter.scenes.find((scene) => scene.id === activeSceneId);
  finishTreeMutation(chapter.id, keepScene?.id, '支线已删除');
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
async function renameBranchAt(chapterIndex, branchId) {
  const branch = desktopState.data.chapters[chapterIndex]?.branches?.find((item) => item.id === branchId);
  if (!branch) return;
  const title = await requestTextInput('支线名称', branch.title);
  if (!title) return;
  branch.title = title;
  renderChapters();
  if (chapterIndex === activeChapterIndex && currentScene()?.branchId === branchId) renderScene();
  if (!views.flow?.classList.contains('hidden')) renderSceneFlow();
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
      activeSceneIndex = wasActiveChapter ? Math.min(activeSceneIndex, chapter.scenes.length - 1) : Math.max(0, chapter.scenes.findIndex((scene) => !isBranchScene(scene)));
      selectedBlockIndex = 0;
      renderChapters();
      renderSceneTabs();
      renderScene();
      document.querySelector('[data-view="editor"]').click();
    });
    button.addEventListener('dblclick', (event) => { event.preventDefault(); renameChapterAt(index); });
    entry.addEventListener('contextmenu', (event) => openTreeContextMenu(event, [
      { label: '添加支线', action: () => addBranch(index) },
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
      const createSceneEntry = (parent, scene, sceneIndex, nestedBranch = false) => {
        const sceneEntry = addChild(parent, 'div', `chapter-scene-entry${nestedBranch ? ' branch-scene' : ''}`);
        const sceneButton = addChild(sceneEntry, 'button', `chapter-scene-file${nestedBranch ? ' branch-scene-file' : ''}${index === activeChapterIndex && sceneIndex === activeSceneIndex ? ' active' : ''}`); sceneButton.draggable = true; sceneButton.title = nestedBranch ? '按住拖动支线场景，双击重命名' : '按住拖动场景，双击重命名';
        addChild(sceneButton, 'span', 'scene-file-name', scene.title);
        addChild(sceneButton, 'span', 'scene-file-number', scene.number);
        sceneButton.addEventListener('click', () => {
          if (Date.now() < ignoreTreeClickUntil) return;
          syncCurrentScene();
          expandedChapterIds.add(chapter.id);
          if (nestedBranch) expandedBranchIds.add(scene.branchId);
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
      };
      chapter.scenes.forEach((scene, sceneIndex) => { if (!isBranchScene(scene)) createSceneEntry(sceneList, scene, sceneIndex); });
      (chapter.branches || []).forEach((branch) => {
        const scenes = branchScenes(chapter, branch.id);
        if (!scenes.length) return;
        const isBranchExpanded = expandedBranchIds.has(branch.id);
        const active = index === activeChapterIndex && currentScene()?.branchId === branch.id;
        const branchGroup = addChild(sceneList, 'section', `chapter-branch-group${active ? ' active' : ''}`);
        const branchEntry = addChild(branchGroup, 'div', 'chapter-branch-entry');
        const branchToggle = addChild(branchEntry, 'button', 'chapter-branch-toggle', isBranchExpanded ? '▾' : '▸'); branchToggle.type = 'button'; branchToggle.title = isBranchExpanded ? '折叠支线' : '展开支线';
        const branchButton = addChild(branchEntry, 'button', 'chapter-branch-button'); branchButton.type = 'button'; branchButton.title = `${branch.trigger || '尚未填写触发方式'} · ${branch.includeInFlow ? '已加入流程图' : '默认不参与流程图'}`;
        addChild(branchButton, 'b', '', branch.title);
        addChild(branchButton, 'span', `chapter-branch-flow${branch.includeInFlow ? ' included' : ''}`, branch.includeInFlow ? '流程中' : '支线');
        addChild(branchEntry, 'span', 'chapter-branch-count', String(scenes.length));
        branchToggle.addEventListener('click', () => { if (isBranchExpanded) expandedBranchIds.delete(branch.id); else expandedBranchIds.add(branch.id); renderChapters(); });
        branchButton.addEventListener('click', () => { syncCurrentScene(); expandedChapterIds.add(chapter.id); expandedBranchIds.add(branch.id); activeChapterIndex = index; activeSceneIndex = chapter.scenes.indexOf(scenes[0]); selectedBlockIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]')?.click(); });
        branchButton.addEventListener('dblclick', (event) => { event.preventDefault(); renameBranchAt(index, branch.id); });
        branchEntry.addEventListener('contextmenu', (event) => openTreeContextMenu(event, [
          { label: '添加场景', action: () => addBranchScene(index, branch.id) },
          { label: branch.includeInFlow ? '从流程图移出' : '添加到流程图', action: () => setBranchFlowParticipation(index, chapter.scenes.indexOf(scenes[0]), !branch.includeInFlow) },
          { label: '重命名支线', action: () => renameBranchAt(index, branch.id) },
          { label: '删除支线', danger: true, action: () => deleteBranch(index, branch.id) }
        ]));
        if (isBranchExpanded) {
          const branchSceneList = addChild(branchGroup, 'div', 'chapter-branch-scene-list');
          scenes.forEach((scene) => createSceneEntry(branchSceneList, scene, chapter.scenes.indexOf(scene), true));
          const addSceneButton = addChild(branchSceneList, 'button', 'chapter-add-branch-scene', '＋ 添加场景'); addSceneButton.type = 'button'; addSceneButton.addEventListener('click', (event) => { event.stopPropagation(); addBranchScene(index, branch.id); });
        }
      });
      const addBranchButton = addChild(sceneList, 'button', 'chapter-add-branch', '＋ 添加支线');
      addBranchButton.type = 'button';
      addBranchButton.addEventListener('click', (event) => { event.stopPropagation(); addBranch(index); });
    }
  });
}

function itemCoverImage(item) {
  return item?.images?.find((image) => image.id === item.coverImageId) || item?.images?.[0] || null;
}
function itemTagValues() {
  return [...new Set((desktopState.data?.items || []).flatMap((item) => item.tags || []))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}
function requestItemForm(initial = null) {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay');
    const dialog = addChild(overlay, 'div', 'editor-dialog item-editor-dialog');
    addChild(dialog, 'h3', '', initial ? '编辑物品资料' : '新建物品');
    const form = addChild(dialog, 'form', 'item-editor-form');
    const field = (label, value, placeholder, rows = 0) => {
      const wrapper = addChild(form, 'label', 'item-editor-field'); addChild(wrapper, 'span', '', label);
      const control = addChild(wrapper, rows ? 'textarea' : 'input', 'editor-dialog-input');
      control.value = value || ''; control.placeholder = placeholder; if (rows) control.rows = rows;
      return control;
    };
    const name = field('名称', initial?.name, '例如：锈蚀的铜钥匙'); name.maxLength = 80; name.required = true;
    const tags = field('检索 Tag', (initial?.tags || []).join('，'), '例如：线索，任务，道具');
    const summary = field('简介', initial?.summary, '物品的外观、来源或基本描述', 3);
    const effect = field('效果', initial?.effect, '获得、使用或触发后会发生什么', 3);
    const notes = field('备注', initial?.notes, '仅供创作者查看的补充信息', 3);
    const actions = addChild(dialog, 'div', 'editor-dialog-actions');
    const cancel = addChild(actions, 'button', 'file-button', '取消'); cancel.type = 'button';
    const save = addChild(actions, 'button', 'file-button save', '保存'); save.type = 'submit'; form.appendChild(actions);
    const close = (value) => { overlay.remove(); resolve(value); };
    cancel.addEventListener('click', () => close(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const itemName = name.value.trim();
      if (!itemName) { name.focus(); return; }
      close({
        name: itemName,
        tags: itemFormatTools.uniqueTags(tags.value),
        summary: summary.value.trim(),
        effect: effect.value.trim(),
        notes: notes.value.trim()
      });
    });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    document.body.appendChild(overlay); requestAnimationFrame(() => name.focus());
  });
}
async function importItemImages(itemId, refresh) {
  if (!desktopState.filePath && !(await saveProject())) return;
  try {
    const imported = await desktopApi.importItemImages(desktopState.filePath, itemId);
    if (!imported?.length) return;
    const item = desktopState.data.items.find((entry) => entry.id === itemId);
    if (!item) return;
    item.images ||= [];
    item.images.push(...imported);
    if (!item.coverImageId) item.coverImageId = imported[0].id;
    markDirty(); refresh(); renderItems(); renderScene();
    showToast(`已导入 ${imported.length} 张物品图片`);
  } catch (error) { showToast(error.message || '物品图片导入失败'); }
}
function openItemImageManager(itemId) {
  const overlay = node('div', 'editor-dialog-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog item-image-manager-dialog');
  const header = addChild(dialog, 'div', 'item-manager-header');
  const title = addChild(header, 'div'); addChild(title, 'h3', '', '物品图片组'); addChild(title, 'p', 'editor-dialog-message', '图片存入该物品专属目录；封面始终排在第一位。');
  const importButton = addChild(header, 'button', 'primary-button', '＋ 导入图片'); importButton.type = 'button';
  const grid = addChild(dialog, 'div', 'item-image-manager-grid');
  const footer = addChild(dialog, 'div', 'editor-dialog-actions'); const closeButton = addChild(footer, 'button', 'file-button save', '完成'); closeButton.type = 'button';
  const close = () => { overlay.remove(); renderItems(); renderScene(); renderInspector(); };
  const render = () => {
    const item = desktopState.data.items.find((entry) => entry.id === itemId);
    grid.replaceChildren();
    if (!item) { close(); return; }
    const images = [...(item.images || [])].sort((left, right) => Number(right.id === item.coverImageId) - Number(left.id === item.coverImageId));
    if (!images.length) {
      const empty = addChild(grid, 'div', 'item-image-manager-empty'); addChild(empty, 'b', '', '暂无图片'); addChild(empty, 'span', '', '可一次选择多张图片建立图片组。');
    }
    images.forEach((image) => {
      const card = addChild(grid, 'article', `item-image-manager-card${image.id === item.coverImageId ? ' cover' : ''}`);
      const visual = addChild(card, 'div', 'item-image-manager-visual'); const imageNode = addChild(visual, 'img'); imageNode.alt = image.name; loadProjectImage(image.relativePath, imageNode, visual);
      if (image.id === item.coverImageId) addChild(visual, 'span', 'item-cover-badge', '封面');
      const name = addChild(card, 'b', 'item-image-manager-name', image.name); name.title = image.name;
      const actions = addChild(card, 'div', 'item-image-manager-actions');
      const cover = addChild(actions, 'button', 'file-button', image.id === item.coverImageId ? '当前封面' : '设为封面'); cover.type = 'button'; cover.disabled = image.id === item.coverImageId;
      cover.addEventListener('click', () => { const liveItem = desktopState.data.items.find((entry) => entry.id === itemId); if (!liveItem) return; liveItem.coverImageId = image.id; render(); renderItems(); renderScene(); markDirty(); });
      const rename = addChild(actions, 'button', 'file-button', '重命名'); rename.type = 'button'; rename.addEventListener('click', async () => { const next = await requestTextInput('图片名称', image.name); if (!next) return; const liveItem = desktopState.data.items.find((entry) => entry.id === itemId); const liveImage = liveItem?.images?.find((entry) => entry.id === image.id); if (!liveImage) return; liveImage.name = next; render(); renderItems(); renderScene(); markDirty(); });
      const show = addChild(actions, 'button', 'file-button', '源文件'); show.type = 'button'; show.addEventListener('click', () => desktopApi.showItem(desktopState.filePath, image.relativePath));
      const remove = addChild(actions, 'button', 'file-button danger', '删除'); remove.type = 'button'; remove.addEventListener('click', async () => {
        if (!(await requestDeleteConfirmation(`确定删除图片“${image.name}”吗？文件会移入回收站。`))) return;
        try {
          await desktopApi.deleteAsset(desktopState.filePath, image.relativePath);
          const liveItem = desktopState.data.items.find((entry) => entry.id === itemId); if (!liveItem) return;
          liveItem.images = (liveItem.images || []).filter((entry) => entry.id !== image.id);
          if (liveItem.coverImageId === image.id) liveItem.coverImageId = liveItem.images[0]?.id || '';
          render(); renderItems(); renderScene(); markDirty();
        } catch (error) { showToast(error.message || '图片删除失败'); }
      });
    });
  };
  importButton.addEventListener('click', () => importItemImages(itemId, render));
  closeButton.addEventListener('click', close); overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.body.appendChild(overlay); render();
}
function insertItemReference(item) {
  if (!item || !currentScene()) return;
  syncCurrentScene();
  insertBlockAfterSelection({ id: createContentId('item'), type: 'item', itemId: item.id, investigation: { text: '' }, blocks: [] });
  selectedItemDialogueId = '';
  renderScene(); renderInspector(); markDirty();
  revealNewBlock(selectedBlockIndex, '.script-item-name');
  showToast(`已插入物品「${item.name}」`);
}
function requestItemSelection() {
  return new Promise((resolve) => {
    const overlay = node('div', 'editor-dialog-overlay'); const dialog = addChild(overlay, 'div', 'editor-dialog item-picker-dialog');
    addChild(dialog, 'h3', '', '插入物品'); addChild(dialog, 'p', 'editor-dialog-message', '搜索并选择项目物品；每次插入都拥有独立的调查反应和完整剧本内容流。');
    const search = addChild(dialog, 'input', 'editor-dialog-input'); search.type = 'search'; search.placeholder = '搜索名称、Tag、简介或效果';
    const list = addChild(dialog, 'div', 'item-picker-list');
    const actions = addChild(dialog, 'div', 'editor-dialog-actions'); const cancel = addChild(actions, 'button', 'file-button', '取消'); cancel.type = 'button';
    const close = (value) => { overlay.remove(); resolve(value); };
    const render = () => {
      const query = search.value.trim(); list.replaceChildren();
      const matches = (desktopState.data.items || []).filter((item) => itemFormatTools.matchesItem(item, query));
      if (!matches.length) addChild(list, 'div', 'item-picker-empty', '没有匹配的物品');
      matches.forEach((item) => {
        const button = addChild(list, 'button', 'item-picker-option'); button.type = 'button';
        const cover = itemCoverImage(item); const visual = addChild(button, 'span', 'item-picker-option-visual');
        if (cover?.relativePath && desktopState.filePath) { const image = addChild(visual, 'img'); image.alt = ''; loadProjectImage(cover.relativePath, image, visual); } else visual.textContent = '◇';
        const copy = addChild(button, 'span', 'item-picker-option-copy'); addChild(copy, 'b', '', item.name); addChild(copy, 'small', '', item.tags?.length ? item.tags.join(' · ') : '未分类');
        button.addEventListener('click', () => close(item));
      });
    };
    search.addEventListener('input', render); cancel.addEventListener('click', () => close(null)); overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null); });
    document.body.appendChild(overlay); render(); requestAnimationFrame(() => search.focus());
  });
}
async function deleteProjectItem(item) {
  if (!(await requestConfirmation(`确定删除物品“${item.name}”吗？\n物品图片会移入回收站，剧本中的该物品引用也会一并移除。`))) return;
  try {
    if (desktopState.filePath) await desktopApi.deleteItemStorage(desktopState.filePath, item.id);
    let removedBlocks = 0;
    const removeReferences = (blocks) => (blocks || []).filter((block) => {
      if (block.type === 'item' && block.itemId === item.id) { removedBlocks += 1; return false; }
      if (block.type === 'item') block.blocks = removeReferences(block.blocks);
      return true;
    });
    desktopState.data.chapters.forEach((chapter) => chapter.scenes.forEach((scene) => { scene.blocks = removeReferences(scene.blocks); }));
    desktopState.data.items = desktopState.data.items.filter((entry) => entry.id !== item.id);
    renderItems(); renderScene(); renderInspector(); markDirty();
    showToast(removedBlocks ? `物品已删除，并清理 ${removedBlocks} 处剧本引用` : '物品已删除');
  } catch (error) { showToast(error.message || '物品删除失败'); }
}
function renderItems() {
  const view = views.items; if (!view) return;
  desktopState.data.items ||= [];
  view.replaceChildren();
  const heading = addChild(view, 'div', 'section-title'); const copy = addChild(heading, 'div');
  addChild(copy, 'div', 'eyebrow', 'ITEM LIBRARY'); addChild(copy, 'h2', '', '物品'); addChild(copy, 'p', 'muted', '管理项目级物品资料、图片组和检索分类。');
  const create = addChild(heading, 'button', 'primary-button', '＋ 新建物品'); create.type = 'button';
  create.addEventListener('click', async () => {
    const values = await requestItemForm(); if (!values) return;
    const item = itemFormatTools.normalizeItem({ id: createContentId('item'), ...values });
    desktopState.data.items.push(item); renderItems(); markDirty(); showToast(`已创建物品「${item.name}」`);
  });
  const tools = addChild(view, 'div', 'item-library-tools');
  const search = addChild(tools, 'input', 'item-library-search'); search.type = 'search'; search.placeholder = '搜索物品名称、Tag、简介、效果或备注'; search.value = itemSearchQuery;
  const filters = addChild(view, 'div', 'item-tag-filters');
  const renderFilters = () => {
    filters.replaceChildren();
    const choices = [['', '全部'], ['__uncategorized__', '未分类'], ...itemTagValues().map((tag) => [tag, tag])];
    choices.forEach(([value, label]) => { const button = addChild(filters, 'button', `item-tag-filter${itemTagFilter === value ? ' active' : ''}`, label); button.type = 'button'; button.addEventListener('click', () => { itemTagFilter = value; renderItems(); }); });
  };
  const grid = addChild(view, 'div', 'item-library-grid');
  const renderGrid = () => {
    grid.replaceChildren();
    const items = desktopState.data.items.filter((item) => itemFormatTools.matchesItem(item, itemSearchQuery, itemTagFilter));
    if (!items.length) {
      const empty = addChild(grid, 'div', 'item-library-empty'); addChild(empty, 'b', '', desktopState.data.items.length ? '没有匹配的物品' : '物品库还是空的'); addChild(empty, 'span', '', desktopState.data.items.length ? '调整搜索词或 Tag 筛选。' : '创建物品后，可在任意场景中多次插入并独立设置调查反应与角色对白。');
      return;
    }
    items.forEach((item) => {
      const card = addChild(grid, 'article', 'item-library-card'); card.dataset.itemId = item.id;
      const visual = addChild(card, 'div', 'item-library-card-visual'); const cover = itemCoverImage(item);
      if (cover?.relativePath && desktopState.filePath) { const image = addChild(visual, 'img'); image.alt = item.name; loadProjectImage(cover.relativePath, image, visual); } else addChild(visual, 'span', 'item-library-placeholder', '◇');
      if (item.images?.length > 1) addChild(visual, 'span', 'item-image-count', `${item.images.length} 张`);
      const body = addChild(card, 'div', 'item-library-card-body'); addChild(body, 'h3', '', item.name);
      const tags = addChild(body, 'div', 'item-library-card-tags'); if (item.tags?.length) item.tags.forEach((tag) => addChild(tags, 'span', '', tag)); else addChild(tags, 'span', 'muted-tag', '未分类');
      if (item.summary) { const row = addChild(body, 'div', 'item-library-detail'); addChild(row, 'b', '', '简介'); addChild(row, 'span', '', item.summary); }
      if (item.effect) { const row = addChild(body, 'div', 'item-library-detail'); addChild(row, 'b', '', '效果'); addChild(row, 'span', '', item.effect); }
      if (item.notes) { const row = addChild(body, 'div', 'item-library-detail note'); addChild(row, 'b', '', '备注'); addChild(row, 'span', '', item.notes); }
      const actions = addChild(card, 'div', 'item-library-card-actions');
      const images = addChild(actions, 'button', 'file-button', `图片组 ${item.images?.length || 0}`); images.type = 'button'; images.addEventListener('click', () => openItemImageManager(item.id));
      const edit = addChild(actions, 'button', 'file-button', '编辑资料'); edit.type = 'button'; edit.addEventListener('click', async () => { const values = await requestItemForm(item); if (!values) return; Object.assign(item, values); renderItems(); renderScene(); markDirty(); });
      const insert = addChild(actions, 'button', 'file-button save', '插入剧本'); insert.type = 'button'; insert.addEventListener('click', () => { document.querySelector('[data-view="editor"]')?.click(); insertItemReference(item); });
      const remove = addChild(actions, 'button', 'file-button danger', '删除'); remove.type = 'button'; remove.addEventListener('click', () => deleteProjectItem(item));
    });
  };
  search.addEventListener('input', () => { itemSearchQuery = search.value; renderGrid(); });
  renderFilters(); renderGrid();
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
  avatar.style.background = selectedCharacter?.color || '#ffe5da';
  avatar.style.color = selectedCharacter ? '#fff' : '#c96c56';
  renderCharacterDefaultAvatar(avatar, selectedCharacter, 'dialogue-character-picker-avatar-image');
  label.textContent = selectedCharacter?.name || '不设置角色';
  menu.replaceChildren();
  addChild(menu, 'div', 'dialogue-character-menu-title', '新增对白角色');
  const addOption = (character) => {
    const characterId = character?.id || '';
    const option = addChild(menu, 'button', `dialogue-character-option${characterId === newDialogueCharacterId ? ' selected' : ''}`); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(characterId === newDialogueCharacterId));
    const optionAvatar = addChild(option, 'span', 'dialogue-character-option-avatar'); optionAvatar.style.background = character?.color || '#ffe5da'; optionAvatar.style.color = character ? '#fff' : '#c96c56'; renderCharacterDefaultAvatar(optionAvatar, character, 'dialogue-character-option-avatar-image');
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
function applyProject(data, filePath = null, options = {}) { clearTimeout(autoSaveTimer); autoSaveQueued = false; itemDialogueEditorState = null; document.getElementById('itemDialogueEditor')?.classList.add('hidden'); document.body.classList.remove('item-dialogue-editor-open'); document.body.classList.remove('project-home-active'); views.home?.classList.add('hidden'); desktopState.data = data; desktopState.filePath = filePath; activeChapterIndex = 0; activeSceneIndex = 0; selectedBlockIndex = 0; newDialogueCharacterId = ''; expandedChapterIds.clear(); expandedBranchIds.clear(); if (data.chapters[0]) expandedChapterIds.add(data.chapters[0].id); updateProjectTitle(data.title); syncDialogueCreationState(); renderChapters(); renderSceneTabs(); renderScene(); renderImportedAssets(); desktopState.dirty = false; desktopApi?.setDirty(false); setProjectLocationStatus(filePath ? '本地项目' : '本地新项目'); setSaveStatus(filePath ? '已保存' : '未保存'); updateProjectFolderAction(); document.querySelector('[data-view="editor"]')?.click(); if (options.resetHistory !== false) resetProjectHistory(); else updateUndoAvailability(); }
function applyOpenedProjectResult(result, successMessage = '') {
  applyProject(result.data, result.filePath);
  if (result.recoveredFromBackup) {
    desktopState.dirty = true;
    desktopApi?.setDirty(true);
    setSaveStatus('已从备份恢复，待保存');
    showToast('主项目数据异常，已从上一版本恢复，请保存确认');
    return;
  }
  if (successMessage) showToast(successMessage);
}
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
      if (result.previousFilePath && result.previousFilePath !== result.filePath) forgetRecentProject(result.previousFilePath);
      desktopState.filePath = result.filePath;
      updateProjectFolderAction();
      setProjectLocationStatus('本地项目');
      rememberProject(result.filePath, result.data.title);
      if (editRevision === revisionAtStart) {
        if (!desktopState.data) desktopState.data = result.data;
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
  updateProjectFolderAction();
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
async function openProject() { if (desktopState.data && !(await prepareProjectSwitch('当前项目有未保存修改，确定打开另一个项目吗？'))) return; try { const result = await desktopApi.openProject(); if (result) applyOpenedProjectResult(result, '项目已打开'); } catch (error) { showToast(error.message || '打开失败'); } }
async function newProject() { if (desktopState.data && !(await prepareProjectSwitch('当前项目有未保存修改，确定新建项目吗？'))) return; showProjectHome(true); document.getElementById('projectCreateName')?.focus(); }
async function importAssets() { if (!desktopState.filePath) { if (!(await saveProject())) return; } try { const assets = await desktopApi.importAssets(desktopState.filePath); if (!assets.length) return; desktopState.data.assets.push(...assets); renderImportedAssets(); markDirty(); showToast(`已导入 ${assets.length} 个素材`); } catch (error) { showToast(error.message || '素材导入失败'); } }
function previewSceneData() { return desktopState.data?.chapters?.[previewState?.chapterIndex]?.scenes?.[previewState?.sceneIndex] || null; }
function previewBlockData() { return previewSceneData()?.blocks?.[previewState?.blockIndex] || null; }
function previewPerspectiveCharacterId(scene, blockIndex) {
  for (let index = blockIndex; index >= 0; index -= 1) {
    if (scene.blocks[index]?.type === 'segment') return scene.blocks[index].perspectiveCharacterId || '';
  }
  return '';
}

function createCharacterMediaSearchPicker(parent, items, currentPath, onChange) {
  const picker = addChild(parent, 'div', 'character-media-picker');
  const input = addChild(picker, 'input', 'select-control character-media-picker-input');
  input.placeholder = items.length ? '按头像原名搜索' : '当前角色没有头像';
  input.disabled = !items.length;
  const panel = addChild(picker, 'div', 'character-media-picker-panel'); panel.hidden = true;
  let selectedPath = currentPath || '';
  let visibleItems = [...items];
  const selectedItem = () => items.find((item) => item.relativePath === selectedPath);
  const syncInput = () => { input.value = selectedItem() ? characterMediaOriginalName(selectedItem()) : ''; };
  const choose = (item) => {
    selectedPath = item?.relativePath || '';
    syncInput();
    panel.hidden = true;
    onChange(selectedPath);
  };
  const renderOptions = (query = '') => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    visibleItems = items.filter((item) => {
      if (!normalizedQuery) return true;
      return characterMediaOriginalName(item).toLocaleLowerCase().includes(normalizedQuery) || String(item.alias || '').toLocaleLowerCase().includes(normalizedQuery);
    });
    panel.replaceChildren();
    const none = addChild(panel, 'button', `character-media-picker-option${selectedPath ? '' : ' selected'}`); none.type = 'button';
    addChild(none, 'span', 'character-media-picker-empty', '不使用头像');
    none.addEventListener('mousedown', (event) => event.preventDefault());
    none.addEventListener('click', () => choose(null));
    visibleItems.forEach((item) => {
      const option = addChild(panel, 'button', `character-media-picker-option${selectedPath === item.relativePath ? ' selected' : ''}`); option.type = 'button';
      addChild(option, 'b', '', characterMediaOriginalName(item));
      if (item.alias) addChild(option, 'small', '', `别名：${item.alias}`);
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(item));
    });
    if (normalizedQuery && !visibleItems.length) addChild(panel, 'div', 'character-media-picker-empty', '没有匹配的头像');
  };
  input.addEventListener('focus', () => { renderOptions(input.value); panel.hidden = false; });
  input.addEventListener('input', () => { renderOptions(input.value); panel.hidden = false; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { panel.hidden = true; syncInput(); input.blur(); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = input.value.trim().toLocaleLowerCase();
    const exactOriginal = items.find((item) => characterMediaOriginalName(item).toLocaleLowerCase() === query);
    const exactAlias = items.find((item) => String(item.alias || '').toLocaleLowerCase() === query);
    choose(exactOriginal || exactAlias || visibleItems[0] || null);
  });
  input.addEventListener('blur', () => setTimeout(() => { panel.hidden = true; syncInput(); }, 100));
  syncInput();
  return picker;
}
function previewCharacterId(block) {
  if (block?.type !== 'dialogue') return '';
  if (block.characterId) return block.characterId;
  return desktopState.data?.characters?.find((character) => character.name === block.character)?.id || '';
}
function previewDirectDialoguePortraitSpec(dialogue) {
  const characterId = previewCharacterId(dialogue);
  if (!characterId) return null;
  const character = desktopState.data?.characters?.find((item) => item.id === characterId);
  const defaultPortrait = characterDefaultMedia(character, 'portraitGroup');
  return {
    name: character?.name || dialogue.character || '',
    portrait: dialogue.portrait || defaultPortrait?.relativePath || '',
    portraitPreset: (dialogue.portrait || defaultPortrait) ? null : dialogue.portraitPreset || character?.portraitPreset || null,
    color: dialogue.characterColor || character?.color || '#f2674f'
  };
}
function previewPortraitSpec(scene, characterId, blockIndex) {
  if (!characterId) return null;
  const character = desktopState.data?.characters?.find((item) => item.id === characterId);
  const candidates = [];
  for (let index = blockIndex; index >= 0; index -= 1) if (previewCharacterId(scene.blocks[index]) === characterId) candidates.push(scene.blocks[index]);
  for (let index = blockIndex + 1; index < scene.blocks.length; index += 1) if (previewCharacterId(scene.blocks[index]) === characterId) candidates.push(scene.blocks[index]);
  const portraitBlock = candidates.find((block) => block.portrait || block.portraitPreset) || candidates[0];
  const defaultPortrait = characterDefaultMedia(character, 'portraitGroup');
  return {
    name: character?.name || portraitBlock?.character || '',
    portrait: portraitBlock?.portrait || defaultPortrait?.relativePath || '',
    portraitPreset: (portraitBlock?.portrait || defaultPortrait) ? null : portraitBlock?.portraitPreset || character?.portraitPreset || null,
    color: portraitBlock?.characterColor || character?.color || '#f2674f'
  };
}
function previewOtherCharacterId(scene, blockIndex, perspectiveCharacterId) {
  const currentCharacterId = previewCharacterId(scene.blocks[blockIndex]);
  if (currentCharacterId && currentCharacterId !== perspectiveCharacterId) return currentCharacterId;
  for (let index = blockIndex - 1; index >= 0; index -= 1) {
    const characterId = previewCharacterId(scene.blocks[index]);
    if (characterId && characterId !== perspectiveCharacterId) return characterId;
  }
  return '';
}
function renderPreviewPortrait(element, side, spec, speaking, renderToken) {
  element.removeAttribute('style');
  element.className = `preview-character preview-character-${side}${spec ? '' : ' no-portrait'}${speaking ? ' speaking' : ''}`;
  element.hidden = !spec;
  element.replaceChildren();
  if (!spec) return;
  element.title = spec.name || '';
  if (spec.portrait && desktopState.filePath) {
    element.classList.add('asset-portrait');
    desktopApi.readAsset(desktopState.filePath, spec.portrait).then((src) => {
      if (!src || renderToken !== previewRenderToken) return;
      element.style.background = `center bottom / contain no-repeat url("${src}")`;
    }).catch(() => element.classList.add('asset-missing'));
  } else if (spec.portraitPreset) {
    element.classList.add('default-silhouette', `silhouette-${spec.portraitPreset}`);
    element.style.setProperty('--character-color', spec.color);
  }
  if (spec.name) addChild(element, 'span', 'preview-character-name', spec.name);
}
function nextPreviewSceneLocation() {
  if (previewState?.followSceneFlow) {
    const scene = previewSceneData();
    const transition = ensureSceneFlow().transitions.find((item) => item.sourceSceneId === scene?.id);
    return transition ? sceneFlowLocation(transition.targetSceneId) : null;
  }
  if (previewState?.scope === 'branch') {
    const chapter = desktopState.data?.chapters?.[previewState.chapterIndex];
    const nextSceneIndex = (chapter?.scenes || []).findIndex((scene, index) => index > previewState.sceneIndex && scene.branchId === previewState.scopeBranchId);
    return nextSceneIndex >= 0 ? { chapterIndex: previewState.chapterIndex, sceneIndex: nextSceneIndex } : null;
  }
  const chapters = desktopState.data?.chapters || [];
  return storyFlowTools.nextSequentialSceneLocation(chapters, previewState.chapterIndex, previewState.sceneIndex, previewState.scope === 'chapter');
}
function previewLocationForBlockId(blockId) {
  for (let chapterIndex = 0; chapterIndex < (desktopState.data?.chapters || []).length; chapterIndex += 1) {
    const chapter = desktopState.data.chapters[chapterIndex];
    for (let sceneIndex = 0; sceneIndex < (chapter.scenes || []).length; sceneIndex += 1) {
      const blocks = chapter.scenes[sceneIndex].blocks || [];
      const directIndex = blocks.findIndex((block) => block.id === blockId);
      if (directIndex >= 0) return { chapterIndex, sceneIndex, blockIndex: directIndex, itemContentIndex: -1 };
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        if (blocks[blockIndex].type !== 'item') continue;
        const itemContentIndex = flattenedItemPreviewBlocks(blocks[blockIndex]).findIndex((frame) => frame.block.id === blockId);
        if (itemContentIndex >= 0) return { chapterIndex, sceneIndex, blockIndex, itemContentIndex };
      }
    }
  }
  return null;
}
function previewLocationInScope(location) {
  if (previewState?.scope === 'branch') return desktopState.data?.chapters?.[location?.chapterIndex]?.scenes?.[location?.sceneIndex]?.branchId === previewState.scopeBranchId;
  if (previewState?.scope !== 'chapter') return true;
  const targetScene = desktopState.data?.chapters?.[location?.chapterIndex]?.scenes?.[location?.sceneIndex];
  return location?.chapterIndex === previewState.scopeChapterIndex && !isBranchScene(targetScene);
}
function setPreviewScene(location, options = {}) {
  previewState = { ...options, chapterIndex: location.chapterIndex, sceneIndex: location.sceneIndex, blockIndex: location.blockIndex || 0, itemContentIndex: -1, mode: 'playing' };
  if (!(previewSceneData()?.blocks || []).length) previewState.mode = 'scene-end';
  renderPreviewFrame();
}
function closeScenePreview() { document.getElementById('previewModal')?.classList.add('hidden'); previewState = null; previewRenderToken += 1; }
function startScenePreview() {
  syncCurrentScene();
  const chapter = desktopState.data?.chapters?.[activeChapterIndex];
  const activeScene = chapter?.scenes?.[activeSceneIndex];
  const branchPreview = isBranchScene(activeScene);
  const firstSceneIndex = branchPreview ? Math.max(0, (chapter?.scenes || []).findIndex((scene) => scene.branchId === activeScene.branchId)) : Math.max(0, (chapter?.scenes || []).findIndex((scene) => !isBranchScene(scene)));
  document.querySelector('.preview-title-copy span').textContent = branchPreview ? '▶ 当前支线预览' : '▶ 当前章节预览';
  setPreviewScene({ chapterIndex: activeChapterIndex, sceneIndex: firstSceneIndex, blockIndex: 0 }, branchPreview
    ? { followSceneFlow: false, scope: 'branch', scopeChapterIndex: activeChapterIndex, scopeBranchId: activeScene.branchId }
    : { followSceneFlow: false, scope: 'chapter', scopeChapterIndex: activeChapterIndex });
  document.getElementById('previewModal')?.classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('previewScene')?.focus());
}
function startProjectFlowPreview() {
  syncCurrentScene();
  const graph = ensureSceneFlow();
  const location = sceneFlowLocation(graph.startSceneId);
  if (!location) { showToast('流程图中没有可预览的起点场景'); return; }
  document.querySelector('.preview-title-copy span').textContent = '▶ 完整流程预览';
  setPreviewScene(location, { followSceneFlow: true, scope: 'project' });
  document.getElementById('previewModal')?.classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('previewScene')?.focus());
}
function advanceScenePreview(fromChoice = false) {
  if (!previewState) return;
  if (previewState.mode === 'project-end') { closeScenePreview(); return; }
  if (previewState.mode === 'scene-end') {
    const nextScene = nextPreviewSceneLocation();
    if (nextScene) setPreviewScene(nextScene, { followSceneFlow: previewState.followSceneFlow, scope: previewState.scope, scopeChapterIndex: previewState.scopeChapterIndex, scopeBranchId: previewState.scopeBranchId });
    else closeScenePreview();
    return;
  }
  const previewOuterBlock = previewBlockData();
  const previewFrames = previewOuterBlock?.type === 'item' ? flattenedItemPreviewBlocks(previewOuterBlock) : [];
  const previewInnerBlock = previewState.itemContentIndex >= 0 ? previewFrames[previewState.itemContentIndex]?.block : null;
  if ((previewInnerBlock || previewOuterBlock)?.type === 'choice' && !fromChoice) return;
  if (previewBlockData()?.type === 'item') {
    const itemBlocks = flattenedItemPreviewBlocks(previewBlockData());
    if ((previewState.itemContentIndex ?? -1) < itemBlocks.length - 1) { previewState.itemContentIndex = (previewState.itemContentIndex ?? -1) + 1; renderPreviewFrame(); return; }
    previewState.itemContentIndex = -1;
  }
  const blocks = previewSceneData()?.blocks || [];
  if (previewState.blockIndex + 1 < blocks.length) { previewState.blockIndex += 1; previewState.itemContentIndex = -1; }
  else previewState.mode = 'scene-end';
  renderPreviewFrame();
}
function renderPreviewFrame() {
  if (!previewState) return;
  const renderToken = ++previewRenderToken;
  const chapter = desktopState.data?.chapters?.[previewState.chapterIndex];
  const scene = previewSceneData();
  const block = previewBlockData();
  const stage = document.getElementById('previewScene');
  const dialogue = document.getElementById('previewDialogue');
  const speaker = document.getElementById('previewSpeaker');
  const text = document.getElementById('previewText');
  const options = document.querySelector('.preview-options');
  const segmentCard = document.getElementById('previewSegmentCard');
  const endCard = document.getElementById('previewEndCard');
  const advanceHint = document.getElementById('previewAdvanceHint');
  document.getElementById('previewSceneName').textContent = scene?.title || '未命名场景';
  document.getElementById('previewSceneLocation').textContent = `${chapter?.title || '未命名章节'} · ${scene?.title || '未命名场景'}`;
  document.getElementById('previewProgress').textContent = previewState.mode === 'playing' ? `${Math.min(previewState.blockIndex + 1, scene?.blocks?.length || 0)} / ${scene?.blocks?.length || 0}` : previewState.mode === 'scene-end' ? '场景结束' : '预览结束';
  stage.style.backgroundImage = '';
  dialogue.className = 'preview-dialogue'; dialogue.classList.remove('hidden');
  segmentCard.classList.add('hidden'); endCard.classList.add('hidden');
  speaker.textContent = ''; text.textContent = ''; options.replaceChildren(); advanceHint.textContent = '点击继续';
  if (scene?.background && desktopState.filePath) desktopApi.readAsset(desktopState.filePath, scene.background).then((src) => { if (src && renderToken === previewRenderToken) stage.style.backgroundImage = `linear-gradient(180deg, rgba(21,24,25,.06) 20%, rgba(20,24,25,.62) 100%), url("${src}")`; }).catch(() => {});
  if (previewState.mode !== 'playing') {
    dialogue.classList.add('hidden'); endCard.classList.remove('hidden');
    const nextScene = previewState.mode === 'scene-end' ? nextPreviewSceneLocation() : null;
    const chapterComplete = previewState.scope === 'chapter' && !nextScene;
    document.getElementById('previewEndEyebrow').textContent = nextScene ? '本场景结束' : chapterComplete ? '本章节结束' : '完整预览结束';
    document.getElementById('previewEndTitle').textContent = nextScene ? desktopState.data.chapters[nextScene.chapterIndex].scenes[nextScene.sceneIndex].title : chapterComplete ? chapter?.title || '当前章节' : '流程已播放完成';
    document.getElementById('previewEndHint').textContent = nextScene ? '点击进入下一个场景' : '点击关闭预览';
    renderPreviewPortrait(document.getElementById('previewCharacterLeft'), 'left', null, false, renderToken);
    renderPreviewPortrait(document.getElementById('previewCharacterRight'), 'right', null, false, renderToken);
    return;
  }
  const itemFrame = block?.type === 'item' && previewState.itemContentIndex >= 0 ? flattenedItemPreviewBlocks(block)[previewState.itemContentIndex] : null;
  const itemContent = itemFrame?.block || null;
  const displayBlock = itemContent || block;
  const perspectiveCharacterId = itemContent ? itemPerspectiveCharacterIdAt(itemFrame.owner.blocks || [], itemFrame.index) || previewPerspectiveCharacterId(scene, previewState.blockIndex) : previewPerspectiveCharacterId(scene, previewState.blockIndex);
  const currentCharacterId = previewCharacterId(displayBlock);
  const otherCharacterId = previewOtherCharacterId(scene, previewState.blockIndex, perspectiveCharacterId);
  const currentPortraitSpec = itemContent?.type === 'dialogue' ? previewDirectDialoguePortraitSpec(itemContent) : previewPortraitSpec(scene, currentCharacterId, previewState.blockIndex);
  const rightPortraitSpec = currentCharacterId && currentCharacterId === perspectiveCharacterId ? currentPortraitSpec : previewPortraitSpec(scene, perspectiveCharacterId, previewState.blockIndex);
  const leftPortraitSpec = currentCharacterId && currentCharacterId !== perspectiveCharacterId ? currentPortraitSpec : previewPortraitSpec(scene, otherCharacterId || (!perspectiveCharacterId ? currentCharacterId : ''), previewState.blockIndex);
  renderPreviewPortrait(document.getElementById('previewCharacterRight'), 'right', rightPortraitSpec, currentCharacterId === perspectiveCharacterId, renderToken);
  renderPreviewPortrait(document.getElementById('previewCharacterLeft'), 'left', leftPortraitSpec, currentCharacterId && currentCharacterId !== perspectiveCharacterId, renderToken);
  if (displayBlock?.type === 'segment') {
    dialogue.classList.add('hidden'); segmentCard.classList.remove('hidden');
    document.getElementById('previewSegmentTitle').textContent = displayBlock.title || '未命名分段';
    const perspective = desktopState.data?.characters?.find((character) => character.id === displayBlock.perspectiveCharacterId);
    document.getElementById('previewSegmentPerspective').textContent = perspective ? `主视角 · ${perspective.name}` : '未设置主视角';
    return;
  }
  if (displayBlock?.type === 'dialogue') {
    speaker.textContent = displayBlock.character || desktopState.data.characters?.find((character) => character.id === displayBlock.characterId)?.name || '未设置角色';
    if (displayBlock.textHtml) text.innerHTML = sanitizeRichTextHtml(displayBlock.textHtml); else text.textContent = displayBlock.text || '……';
  } else if (displayBlock?.type === 'narration') {
    dialogue.classList.add('narration'); speaker.textContent = '旁白'; text.textContent = displayBlock.text || '……';
  } else if (displayBlock?.type === 'choice') {
    dialogue.classList.add('choice-preview'); speaker.textContent = '玩家选择'; text.textContent = displayBlock.title || '请选择'; advanceHint.textContent = '选择后继续';
    (displayBlock.options || []).forEach((option) => {
      const value = typeof option === 'string' ? { text: option, targetBlockId: '' } : option;
      const button = addChild(options, 'button', '', value.text || '未命名选项');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const target = value.targetBlockId ? previewLocationForBlockId(value.targetBlockId) : null;
        if (target && previewLocationInScope(target)) { previewState = { ...previewState, ...target, itemContentIndex: target.itemContentIndex ?? -1, mode: 'playing' }; renderPreviewFrame(); }
        else if (target) { showToast('该选项指向其他章节，本次章节预览将继续播放当前章节'); advanceScenePreview(true); }
        else advanceScenePreview(true);
      });
    });
  } else if (displayBlock?.type === 'item') {
    const item = (desktopState.data.items || []).find((entry) => entry.id === displayBlock.itemId);
    dialogue.classList.add('item-preview');
    speaker.textContent = item ? `调查 · ${item.name}` : '物品已失效';
    text.textContent = displayBlock.investigation?.text || item?.summary || '尚未填写调查反应。';
  } else text.textContent = '当前内容暂不支持预览。';
}

function writingIssueLocationLabel(issue) {
  const location = issue.location || {};
  if (location.view === 'editor') {
    const chapter = desktopState.data?.chapters?.[location.chapterIndex];
    const scene = chapter?.scenes?.[location.sceneIndex];
    return `${chapter?.title || '未知章节'} / ${scene?.title || '未知场景'}`;
  }
  if (location.view === 'characters') return '角色与立绘';
  if (location.view === 'assets') return '素材库';
  return '项目';
}
function navigateToWritingIssue(issue) {
  const location = issue.location || {};
  if (location.view === 'editor') {
    navigateToProjectBlock(location.chapterIndex, location.sceneIndex, location.blockIndex);
    if (location.itemDialogueId) requestAnimationFrame(() => {
      const root = currentScene()?.blocks?.[location.blockIndex];
      const nestedIds = [];
      let cursor = root;
      for (const index of (location.itemContentPath || []).slice(0, -1)) {
        cursor = cursor?.blocks?.[index];
        if (cursor?.type === 'item') nestedIds.push(cursor.id);
      }
      openItemDialogueEditor(root?.id, nestedIds);
      selectedItemDialogueId = location.itemDialogueId;
      renderItemDialogueEditor();
    });
    return;
  }
  if (location.view === 'characters') {
    document.querySelector('[data-view="characters"]')?.click();
    requestAnimationFrame(() => document.querySelector(`.character-card[data-character-id="${location.characterId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return;
  }
  if (location.view === 'assets') {
    document.querySelector('[data-view="assets"]')?.click();
    requestAnimationFrame(() => document.querySelector(`.asset-card[data-asset-id="${location.assetId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
}
async function physicalAssetIssues(assetReferences, renderToken) {
  if (!desktopState.filePath || !desktopApi?.assetExists) return [];
  const targets = new Map();
  assetReferences.forEach((reference) => { if (reference.relativePath && !targets.has(reference.relativePath)) targets.set(reference.relativePath, reference); });
  (desktopState.data.assets || []).forEach((asset) => {
    const relativePath = asset.relativePath || asset.fileName;
    if (relativePath && !targets.has(relativePath)) targets.set(relativePath, { relativePath, label: asset.name || '素材', location: { view: 'assets', assetId: asset.id } });
  });
  (desktopState.data.characters || []).forEach((character) => {
    [...(character.avatarGroup || []), ...(character.portraitGroup || [])].forEach((media) => {
      if (media.relativePath && !targets.has(media.relativePath)) targets.set(media.relativePath, { relativePath: media.relativePath, label: `${character.name} · ${media.name}`, location: { view: 'characters', characterId: character.id } });
    });
  });
  const results = await Promise.all([...targets.values()].map(async (target) => {
    try { return await desktopApi.assetExists(desktopState.filePath, target.relativePath) ? null : target; }
    catch { return target; }
  }));
  if (renderToken !== writingCheckRenderToken) return [];
  return results.filter(Boolean).map((target, index) => ({ id: `physical-asset-issue-${index}`, severity: 'error', category: '失效素材', title: `${target.label}文件不存在`, detail: target.relativePath, location: target.location }));
}
function renderWritingIssueResults(view, issues, checkingDisk = false) {
  const previous = view.querySelector('.writing-check-results');
  previous?.remove();
  const results = addChild(view, 'div', 'writing-check-results');
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const summary = addChild(results, 'div', 'writing-check-summary');
  [['全部问题', issues.length, 'all'], ['需要修复', errors, 'error'], ['建议调整', warnings, 'warning']].forEach(([label, count, filter]) => {
    const button = addChild(summary, 'button', `writing-check-summary-item${writingCheckFilter === filter ? ' active' : ''}`); button.type = 'button'; button.dataset.filter = filter;
    addChild(button, 'b', '', String(count)); addChild(button, 'span', '', label);
    button.addEventListener('click', () => { writingCheckFilter = filter; renderWritingIssueResults(view, issues, checkingDisk); });
  });
  if (checkingDisk) addChild(results, 'div', 'writing-check-scanning', '正在核对本地素材文件…');
  const visibleIssues = issues.filter((issue) => writingCheckFilter === 'all' || issue.severity === writingCheckFilter);
  if (!visibleIssues.length) {
    const empty = addChild(results, 'div', 'writing-check-empty'); addChild(empty, 'b', '', issues.length ? '当前筛选下没有问题' : '没有发现写作问题'); addChild(empty, 'span', '', issues.length ? '可以切换其他问题类型继续查看。' : '当前对白、角色、素材与选择关联均通过检查。');
    return;
  }
  const grouped = new Map();
  visibleIssues.forEach((issue) => { if (!grouped.has(issue.category)) grouped.set(issue.category, []); grouped.get(issue.category).push(issue); });
  grouped.forEach((categoryIssues, category) => {
    const section = addChild(results, 'section', 'writing-check-group');
    const heading = addChild(section, 'div', 'writing-check-group-heading'); addChild(heading, 'h3', '', category); addChild(heading, 'span', '', String(categoryIssues.length));
    const list = addChild(section, 'div', 'writing-check-list');
    categoryIssues.forEach((issue) => {
      const item = addChild(list, 'button', `writing-check-item ${issue.severity}`); item.type = 'button'; item.addEventListener('click', () => navigateToWritingIssue(issue));
      addChild(item, 'span', 'writing-check-severity', issue.severity === 'error' ? '!' : '·');
      const copy = addChild(item, 'span', 'writing-check-copy'); addChild(copy, 'b', '', issue.title); addChild(copy, 'small', '', issue.detail || writingIssueLocationLabel(issue));
      addChild(item, 'span', 'writing-check-location', writingIssueLocationLabel(issue)); addChild(item, 'span', 'writing-check-jump', '›');
    });
  });
}
async function renderWritingChecks() {
  const view = views.checks;
  if (!view || !desktopState.data || !writingCheckTools) return;
  const renderToken = ++writingCheckRenderToken;
  view.replaceChildren();
  const heading = addChild(view, 'div', 'section-title writing-check-heading');
  const copy = addChild(heading, 'div'); addChild(copy, 'div', 'eyebrow', 'SCRIPT HEALTH'); addChild(copy, 'h2', '', '写作检查'); addChild(copy, 'p', 'muted', `检查 ${(storyFlowTools?.flattenProjectScenes(desktopState.data.chapters) || []).length} 个场景`);
  const refresh = addChild(heading, 'button', 'file-button', '重新检查'); refresh.type = 'button'; refresh.addEventListener('click', renderWritingChecks);
  const baseResult = writingCheckTools.collectWritingIssues(desktopState.data);
  renderWritingIssueResults(view, baseResult.issues, Boolean(desktopState.filePath));
  const diskIssues = await physicalAssetIssues(baseResult.assetReferences, renderToken);
  if (renderToken !== writingCheckRenderToken) return;
  renderWritingIssueResults(view, [...baseResult.issues, ...diskIssues], false);
}

function ensureSceneFlow() {
  desktopState.data.sceneFlow = storyFlowTools.normalizeSceneFlow(desktopState.data.sceneFlow, desktopState.data.chapters);
  return desktopState.data.sceneFlow;
}
function sceneFlowLocation(sceneId) {
  const item = storyFlowTools.flattenProjectScenes(desktopState.data?.chapters).find((sceneItem) => sceneItem.id === sceneId);
  return item ? { chapterIndex: item.chapterIndex, sceneIndex: item.sceneIndex, blockIndex: 0 } : null;
}
function sceneFlowChoiceEdges(sceneItems) {
  const sceneIdByBlockId = new Map();
  sceneItems.forEach((item) => (item.scene.blocks || []).forEach((block) => {
    if (block.id) sceneIdByBlockId.set(block.id, item.id);
    if (block.type === 'item') walkItemContent(block, (entry) => { if (entry.id) sceneIdByBlockId.set(entry.id, item.id); });
  }));
  const edges = new Map();
  sceneItems.forEach((item) => {
    (item.scene.blocks || []).forEach((block) => {
      const choices = block.type === 'choice' ? [block] : [];
      if (block.type === 'item') walkItemContent(block, (entry) => { if (entry.type === 'choice') choices.push(entry); });
      choices.forEach((choice) => (choice.options || []).forEach((option) => {
        const value = typeof option === 'string' ? { text: option, targetBlockId: '' } : option || {};
        const targetSceneId = sceneIdByBlockId.get(value.targetBlockId);
        if (!targetSceneId || targetSceneId === item.id) return;
        const key = `${item.id}:${targetSceneId}`;
        if (!edges.has(key)) edges.set(key, { sourceSceneId: item.id, targetSceneId, labels: [] });
        if (value.text) edges.get(key).labels.push(String(value.text));
      }));
    });
  });
  return [...edges.values()];
}
function renderSceneFlow() {
  const view = views.flow;
  if (!view || !desktopState.data || !storyFlowTools) return;
  const graph = ensureSceneFlow();
  const allSceneItems = storyFlowTools.flattenProjectScenes(desktopState.data.chapters);
  const sceneItems = storyFlowTools.flattenFlowScenes(desktopState.data.chapters);
  const excludedBranches = storyFlowTools.flattenProjectBranches(desktopState.data.chapters).filter((item) => item.branch.includeInFlow !== true);
  const sceneById = new Map(sceneItems.map((item) => [item.id, item]));
  const positions = new Map(sceneItems.map((item) => [item.id, graph.positions[item.id] || { x: 0.22 + item.sceneIndex * 0.31, y: 0.22 + item.chapterIndex * 0.3 }]));
  let flowZoom = Math.min(MAX_SCENE_FLOW_ZOOM, Math.max(MIN_SCENE_FLOW_ZOOM, Number(graph.viewport.zoom) || 1));
  sceneFlowResizeObserver?.disconnect(); sceneFlowResizeObserver = null;
  view.replaceChildren();
  const heading = addChild(view, 'div', 'scene-flow-heading');
  const title = addChild(heading, 'div'); addChild(title, 'div', 'eyebrow', 'PROJECT STORY FLOW'); addChild(title, 'h2', '', '全项目流程图'); addChild(title, 'p', 'muted', `${sceneItems.length} 个流程场景 · ${graph.transitions.length} 条顺序连接${excludedBranches.length ? ` · ${excludedBranches.length} 条支线待编排` : ''}`);
  const actions = addChild(heading, 'div', 'scene-flow-heading-actions');
  const zoomControls = addChild(actions, 'div', 'scene-flow-zoom-controls');
  const zoomOut = addChild(zoomControls, 'button', 'scene-flow-zoom-button', '−'); zoomOut.type = 'button'; zoomOut.title = '缩小流程图';
  const zoomReset = addChild(zoomControls, 'button', 'scene-flow-zoom-value', `${Math.round(flowZoom * 100)}%`); zoomReset.type = 'button'; zoomReset.title = '恢复 100%';
  const zoomIn = addChild(zoomControls, 'button', 'scene-flow-zoom-button', '+'); zoomIn.type = 'button'; zoomIn.title = '放大流程图';
  const defaultOrder = addChild(actions, 'button', 'file-button', '默认顺序'); defaultOrder.type = 'button';
  const resetLayout = addChild(actions, 'button', 'file-button', '重置布局'); resetLayout.type = 'button';
  const preview = addChild(actions, 'button', 'primary-button', '▶ 完整预览'); preview.type = 'button';
  if (excludedBranches.length) {
    const tray = addChild(view, 'section', 'scene-flow-branch-tray');
    const trayHeading = addChild(tray, 'div', 'scene-flow-branch-tray-heading');
    const trayCopy = addChild(trayHeading, 'div'); addChild(trayCopy, 'b', '', '待编排支线'); addChild(trayCopy, 'span', '', '默认不参与流程，手动加入后可连接和预览');
    const trayList = addChild(tray, 'div', 'scene-flow-branch-tray-list');
    excludedBranches.forEach((item) => {
      const branch = addChild(trayList, 'button', 'scene-flow-branch-chip'); branch.type = 'button'; branch.title = item.branch.trigger || '尚未填写触发方式';
      addChild(branch, 'span', 'scene-flow-branch-chip-chapter', item.chapter.title);
      addChild(branch, 'b', '', `${item.branch.title} · ${item.scenes.length} 场`);
      addChild(branch, 'span', 'scene-flow-branch-chip-add', '＋ 加入');
      branch.addEventListener('click', () => setBranchFlowParticipation(item.chapterIndex, item.scenes[0].sceneIndex, true));
    });
  }
  const surface = addChild(view, 'div', 'scene-flow-surface'); surface.tabIndex = 0;
  const edgeLayer = addChild(surface, 'div', 'scene-flow-edge-layer');
  const nodeLayer = addChild(surface, 'div', 'scene-flow-node-layer');
  const surfacePoint = (position) => {
    const rect = surface.getBoundingClientRect();
    return { x: rect.width / 2 + (position.x - graph.viewport.centerX) * rect.width * flowZoom, y: rect.height / 2 + (position.y - graph.viewport.centerY) * rect.height * flowZoom };
  };
  const updateGrid = () => {
    const origin = surfacePoint({ x: 0, y: 0 });
    surface.style.backgroundPosition = `${origin.x}px ${origin.y}px`;
    surface.style.setProperty('--scene-flow-grid-size', `${28 * flowZoom}px`);
  };
  const updateNodePosition = (sceneId, position) => {
    positions.set(sceneId, position);
    const element = nodeLayer.querySelector(`[data-scene-id="${sceneId}"]`);
    if (!element) return;
    const point = surfacePoint(position); element.style.left = `${point.x}px`; element.style.top = `${point.y}px`; element.style.setProperty('--scene-flow-node-scale', flowZoom);
  };
  const edgePoints = (sourceSceneId, targetSceneId) => {
    const source = surfacePoint(positions.get(sourceSceneId)); const target = surfacePoint(positions.get(targetSceneId));
    const deltaX = target.x - source.x; const deltaY = target.y - source.y; const centerDistance = Math.hypot(deltaX, deltaY);
    if (centerDistance < 1) return null;
    const directionX = deltaX / centerDistance; const directionY = deltaY / centerDistance;
    const halfWidth = 104 * flowZoom; const halfHeight = 58 * flowZoom;
    const inset = 1 / Math.max(Math.abs(directionX) / halfWidth, Math.abs(directionY) / halfHeight);
    if (centerDistance <= inset * 2 + 8) return null;
    const sourceX = source.x + directionX * inset; const sourceY = source.y + directionY * inset;
    const targetX = target.x - directionX * inset; const targetY = target.y - directionY * inset;
    return { sourceX, sourceY, targetX, targetY, distance: Math.hypot(targetX - sourceX, targetY - sourceY), angle: Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI };
  };
  const renderEdges = () => {
    edgeLayer.replaceChildren();
    graph.transitions.forEach((transition) => {
      if (!positions.has(transition.sourceSceneId) || !positions.has(transition.targetSceneId)) return;
      const points = edgePoints(transition.sourceSceneId, transition.targetSceneId); if (!points) return;
      const line = addChild(edgeLayer, 'button', 'scene-flow-edge sequence'); line.type = 'button'; line.title = '点击移除下一场连接';
      line.style.left = `${points.sourceX}px`; line.style.top = `${points.sourceY}px`; line.style.width = `${points.distance}px`; line.style.transform = `translateY(-50%) rotate(${points.angle}deg)`;
      line.addEventListener('click', () => { graph.transitions = graph.transitions.filter((item) => item.sourceSceneId !== transition.sourceSceneId); renderEdges(); renderNodes(); markDirty(); });
      const label = addChild(edgeLayer, 'span', 'scene-flow-edge-label sequence', '下一场'); label.style.left = `${(points.sourceX + points.targetX) / 2}px`; label.style.top = `${(points.sourceY + points.targetY) / 2}px`; label.style.setProperty('--scene-flow-label-scale', flowZoom);
    });
    sceneFlowChoiceEdges(sceneItems).forEach((edge) => {
      if (!positions.has(edge.sourceSceneId) || !positions.has(edge.targetSceneId)) return;
      const points = edgePoints(edge.sourceSceneId, edge.targetSceneId); if (!points) return;
      const line = addChild(edgeLayer, 'span', 'scene-flow-edge choice'); line.style.left = `${points.sourceX}px`; line.style.top = `${points.sourceY}px`; line.style.width = `${points.distance}px`; line.style.transform = `translateY(-50%) rotate(${points.angle}deg)`;
      const text = edge.labels.length === 1 ? edge.labels[0] : `${edge.labels.length} 个选择`;
      const label = addChild(edgeLayer, 'span', 'scene-flow-edge-label choice', text); label.title = edge.labels.join(' / '); label.style.left = `${(points.sourceX + points.targetX) / 2}px`; label.style.top = `${(points.sourceY + points.targetY) / 2}px`; label.style.setProperty('--scene-flow-label-scale', flowZoom);
    });
  };
  const startConnection = (event, sourceSceneId) => {
    event.preventDefault(); event.stopPropagation();
    const previewLine = addChild(edgeLayer, 'span', 'scene-flow-edge-preview'); const rect = surface.getBoundingClientRect();
    const move = (pointerEvent) => {
      const source = surfacePoint(positions.get(sourceSceneId)); const targetX = pointerEvent.clientX - rect.left; const targetY = pointerEvent.clientY - rect.top;
      previewLine.style.left = `${source.x}px`; previewLine.style.top = `${source.y}px`; previewLine.style.width = `${Math.hypot(targetX - source.x, targetY - source.y)}px`; previewLine.style.transform = `translateY(-50%) rotate(${Math.atan2(targetY - source.y, targetX - source.x) * 180 / Math.PI}deg)`;
    };
    const stop = (pointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); previewLine.remove();
      const targetSceneId = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('.scene-flow-node')?.dataset.sceneId;
      if (!targetSceneId || targetSceneId === sourceSceneId) return;
      graph.transitions = graph.transitions.filter((transition) => transition.sourceSceneId !== sourceSceneId);
      graph.transitions.push({ sourceSceneId, targetSceneId }); renderEdges(); renderNodes(); markDirty();
    };
    move(event); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  const renderNodes = () => {
    nodeLayer.replaceChildren();
    sceneItems.forEach((item) => {
      const transition = graph.transitions.find((entry) => entry.sourceSceneId === item.id);
      const targetScene = transition ? sceneById.get(transition.targetSceneId) : null;
      const branchScene = isBranchScene(item.scene);
      const sceneNode = addChild(nodeLayer, 'article', `scene-flow-node${branchScene ? ' branch' : ''}${graph.startSceneId === item.id ? ' start' : ''}`); sceneNode.dataset.sceneId = item.id;
      const nodeHeader = addChild(sceneNode, 'div', 'scene-flow-node-header');
      const nodeIdentity = addChild(nodeHeader, 'div', 'scene-flow-node-identity'); addChild(nodeIdentity, 'span', 'scene-flow-chapter', branchScene ? `${item.chapter.title} · ${item.branch?.title || '支线'}` : item.chapter.title); if (branchScene) addChild(nodeIdentity, 'span', 'scene-flow-branch-badge', '支线');
      const nodeHeaderActions = addChild(nodeHeader, 'div', 'scene-flow-node-header-actions');
      const startButton = addChild(nodeHeaderActions, 'button', 'scene-flow-start', graph.startSceneId === item.id ? '起点' : '设为起点'); startButton.type = 'button'; startButton.title = '设置完整预览起点';
      if (branchScene) { const removeBranch = addChild(nodeHeaderActions, 'button', 'scene-flow-remove-branch', '×'); removeBranch.type = 'button'; removeBranch.title = '从流程图移出支线'; removeBranch.addEventListener('click', (event) => { event.stopPropagation(); setBranchFlowParticipation(item.chapterIndex, item.sceneIndex, false); }); }
      const body = addChild(sceneNode, 'div', 'scene-flow-node-body'); addChild(body, 'h3', '', item.scene.title); addChild(body, 'p', '', `${item.scene.blocks?.length || 0} 个内容块`);
      const footer = addChild(sceneNode, 'div', 'scene-flow-node-footer'); addChild(footer, 'span', '', targetScene ? `下一场 · ${targetScene.scene.title}` : '流程终点');
      const open = addChild(footer, 'button', 'scene-flow-open', '↗'); open.type = 'button'; open.title = '打开场景';
      const connector = addChild(sceneNode, 'button', 'scene-flow-connector'); connector.type = 'button'; connector.title = '拖动设置下一场'; connector.setAttribute('aria-label', `设置${item.scene.title}的下一场`);
      startButton.addEventListener('click', () => { graph.startSceneId = item.id; renderNodes(); markDirty(); });
      open.addEventListener('click', () => navigateToProjectBlock(item.chapterIndex, item.sceneIndex, 0));
      connector.addEventListener('pointerdown', (event) => startConnection(event, item.id));
      sceneNode.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button')) return;
        event.preventDefault(); const rect = surface.getBoundingClientRect(); const startPosition = positions.get(item.id); const startX = event.clientX; const startY = event.clientY;
        sceneNode.setPointerCapture(event.pointerId); sceneNode.classList.add('dragging');
        const move = (pointerEvent) => { const position = { x: startPosition.x + (pointerEvent.clientX - startX) / (rect.width * flowZoom), y: startPosition.y + (pointerEvent.clientY - startY) / (rect.height * flowZoom) }; updateNodePosition(item.id, position); renderEdges(); };
        const stop = (pointerEvent) => { sceneNode.removeEventListener('pointermove', move); sceneNode.removeEventListener('pointerup', stop); sceneNode.removeEventListener('pointercancel', stop); sceneNode.classList.remove('dragging'); if (sceneNode.hasPointerCapture(pointerEvent.pointerId)) sceneNode.releasePointerCapture(pointerEvent.pointerId); graph.positions[item.id] = positions.get(item.id); markDirty(); };
        sceneNode.addEventListener('pointermove', move); sceneNode.addEventListener('pointerup', stop); sceneNode.addEventListener('pointercancel', stop);
      });
      updateNodePosition(item.id, positions.get(item.id));
    });
  };
  const applyZoom = (value, persist = true) => {
    const previous = flowZoom; flowZoom = Math.round(Math.min(MAX_SCENE_FLOW_ZOOM, Math.max(MIN_SCENE_FLOW_ZOOM, Number(value) || 1)) * 20) / 20; graph.viewport.zoom = flowZoom;
    zoomReset.textContent = `${Math.round(flowZoom * 100)}%`; zoomOut.disabled = flowZoom <= MIN_SCENE_FLOW_ZOOM; zoomIn.disabled = flowZoom >= MAX_SCENE_FLOW_ZOOM;
    updateGrid(); positions.forEach((position, sceneId) => updateNodePosition(sceneId, position)); renderEdges(); if (persist && previous !== flowZoom) markDirty();
  };
  zoomOut.addEventListener('click', () => applyZoom(flowZoom - 0.1)); zoomReset.addEventListener('click', () => applyZoom(1)); zoomIn.addEventListener('click', () => applyZoom(flowZoom + 0.1));
  defaultOrder.addEventListener('click', () => { graph.transitions = storyFlowTools.defaultSceneTransitions(desktopState.data.chapters); graph.startSceneId = sceneItems[0]?.id || ''; renderNodes(); renderEdges(); markDirty(); showToast('已恢复默认场景顺序'); });
  resetLayout.addEventListener('click', () => { graph.positions = {}; graph.viewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }; renderSceneFlow(); markDirty(); });
  preview.addEventListener('click', startProjectFlowPreview);
  surface.addEventListener('wheel', (event) => { event.preventDefault(); applyZoom(flowZoom + (event.deltaY < 0 ? 0.1 : -0.1)); }, { passive: false });
  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.scene-flow-node, .scene-flow-edge, button')) return;
    event.preventDefault(); surface.focus({ preventScroll: true }); const rect = surface.getBoundingClientRect(); const startCenter = { x: graph.viewport.centerX, y: graph.viewport.centerY }; const startX = event.clientX; const startY = event.clientY;
    surface.setPointerCapture(event.pointerId); surface.classList.add('panning');
    const move = (pointerEvent) => { graph.viewport.centerX = startCenter.x - (pointerEvent.clientX - startX) / (rect.width * flowZoom); graph.viewport.centerY = startCenter.y - (pointerEvent.clientY - startY) / (rect.height * flowZoom); updateGrid(); positions.forEach((position, sceneId) => updateNodePosition(sceneId, position)); renderEdges(); };
    const stop = (pointerEvent) => { surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerup', stop); surface.removeEventListener('pointercancel', stop); surface.classList.remove('panning'); if (surface.hasPointerCapture(pointerEvent.pointerId)) surface.releasePointerCapture(pointerEvent.pointerId); markDirty(); };
    surface.addEventListener('pointermove', move); surface.addEventListener('pointerup', stop); surface.addEventListener('pointercancel', stop);
  });
  renderNodes(); applyZoom(flowZoom, false);
  sceneFlowResizeObserver = new ResizeObserver(() => applyZoom(flowZoom, false)); sceneFlowResizeObserver.observe(surface);
}

navItems.forEach((item) => item.addEventListener('click', () => {
  if (!desktopState.data) { showToast('请先创建或打开项目'); return; }
  if (itemDialogueEditorState) closeItemDialogueEditor();
  const target = item.dataset.view;
  relationshipResizeObserver?.disconnect();
  relationshipResizeObserver = null;
  sceneFlowResizeObserver?.disconnect();
  sceneFlowResizeObserver = null;
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  document.querySelector('.editor-layout').classList.toggle('hidden', target !== 'editor');
  views.characters.classList.toggle('hidden', target !== 'characters'); views.relationships?.classList.add('hidden'); views.items?.classList.toggle('hidden', target !== 'items'); views.assets.classList.toggle('hidden', target !== 'assets'); views.checks?.classList.toggle('hidden', target !== 'checks'); views.flow?.classList.toggle('hidden', target !== 'flow');
  document.getElementById('floatingInspectorLayer')?.classList.toggle('hidden', target !== 'editor');
  const breadcrumb = document.querySelector('.breadcrumb'); const separator = breadcrumb?.querySelector('span:nth-child(2)'); const detail = breadcrumb?.querySelector('strong');
  const breadcrumbTitles = { characters: '角色与立绘', items: '项目物品库', assets: '项目素材库', checks: '写作检查', flow: '全项目流程图', editor: '剧本编辑器' };
  breadcrumb?.querySelector('span:first-child')?.replaceChildren(document.createTextNode(breadcrumbTitles[target] || '剧本编辑器'));
  if (separator) separator.hidden = target !== 'editor'; if (detail) detail.hidden = target !== 'editor';
  if (target === 'characters') renderCharacters(); if (target === 'items') renderItems(); if (target === 'assets') renderImportedAssets(); if (target === 'checks') renderWritingChecks(); if (target === 'flow') renderSceneFlow();
}));
function revealNewBlock(blockIndex, focusSelector) {
  requestAnimationFrame(() => {
    const block = document.querySelector(`.script-block[data-block-index="${blockIndex}"]`);
    block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block?.querySelector(focusSelector)?.focus({ preventScroll: true });
  });
}
function insertBlockAfterSelection(block) {
  const scene = currentScene();
  if (!scene) return -1;
  scene.blocks ||= [];
  const selectedIndex = Number.isInteger(selectedBlockIndex) && scene.blocks[selectedBlockIndex] ? selectedBlockIndex : scene.blocks.length - 1;
  const insertionIndex = selectedIndex + 1;
  scene.blocks.splice(insertionIndex, 0, block);
  selectedBlockIndex = insertionIndex;
  return insertionIndex;
}
document.addEventListener('click', (event) => {
  const block = event.target.closest('.script-block');
  if (block) {
    selectedBlockIndex = Number(block.dataset.blockIndex || 0);
    document.querySelectorAll('.script-block').forEach((item) => item.classList.toggle('selected', item === block));
    positionFlowAddActions();
    renderInspector();
  }
  if (event.target.closest('#addDialogue')) {
    syncCurrentScene();
    const character = desktopState.data.characters?.find((item) => item.id === newDialogueCharacterId);
    const dialogue = { id: createContentId('dialogue'), type: 'dialogue', character: '', characterId: '', characterKey: 'mei', characterColor: '#b8bcb8', portraitPreset: null, statusTags: [], voice: '', text: '', textHtml: '', textAlign: 'left' };
    if (character) applyCharacterToBlock(character, dialogue);
    insertBlockAfterSelection(dialogue);
    renderScene();
    revealNewBlock(selectedBlockIndex, '.block-content p');
    markDirty();
    showToast('已添加一条对白');
  }
  if (event.target.closest('#addChoice')) {
    syncCurrentScene();
    insertBlockAfterSelection({ id: createContentId('choice'), type: 'choice', title: '玩家将如何选择？', options: [{ id: createContentId('choice-option'), text: '', targetBlockId: '' }, { id: createContentId('choice-option'), text: '', targetBlockId: '' }] });
    renderScene();
    revealNewBlock(selectedBlockIndex, '.choice-option-text');
    markDirty();
    showToast('已添加玩家选择');
  }
  if (event.target.closest('#addNarration')) {
    syncCurrentScene();
    insertBlockAfterSelection({ id: createContentId('narration'), type: 'narration', text: '' });
    renderScene();
    revealNewBlock(selectedBlockIndex, '.narration-text');
    markDirty();
    showToast('已添加一条旁白');
  }
  if (event.target.closest('#addItem')) {
    if (!(desktopState.data.items || []).length) {
      showToast('请先在物品页创建物品');
      document.querySelector('[data-view="items"]')?.click();
      return;
    }
    requestItemSelection().then((item) => { if (item) insertItemReference(item); });
  }
  if (event.target.closest('#addSegment')) {
    syncCurrentScene();
    const segmentNumber = currentScene().blocks.filter((item) => item.type === 'segment').length + 1;
    insertBlockAfterSelection({ id: createContentId('segment'), type: 'segment', title: `分段 ${segmentNumber}`, perspectiveCharacterId: null });
    renderScene();
    revealNewBlock(selectedBlockIndex, '.segment-title');
    markDirty();
    showToast('已添加分段');
  }
});
document.getElementById('dialogueCharacterPickerButton')?.addEventListener('click', (event) => { event.stopPropagation(); const menu = document.getElementById('dialogueCharacterMenu'); setDialogueCharacterMenuOpen(Boolean(menu?.hidden)); });
document.addEventListener('click', (event) => { if (!event.target.closest('#dialogueCharacterPicker')) setDialogueCharacterMenuOpen(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setDialogueCharacterMenuOpen(false); });
document.addEventListener('input', (event) => {
  if (event.target.closest('#itemDialogueEditor')) return;
  if (event.target.closest('[contenteditable="true"]')) {
    if (event.target.closest('.segment-title')) renderSegmentNavigator();
    updateSceneWordCount();
    markDirty();
  } else if (event.target.classList.contains('choice-option-text')) updateSceneWordCount();
});
document.querySelector('[title="撤销"]')?.addEventListener('click', undoProjectChange);
document.querySelector('[title="重做"]')?.addEventListener('click', redoProjectChange);
document.getElementById('addChapter')?.addEventListener('click', () => { const chapters = desktopState.data.chapters; const chapterNumber = chapters.length + 1; const chapter = { id: `chapter-${Date.now()}`, title: `未命名章节 ${chapterNumber}`, status: '草稿', scenes: [{ id: `scene-${Date.now()}`, number: '01', title: '未命名场景', kind: 'scene', branchId: '', background: '', blocks: [] }], branches: [] }; chapters.push(chapter); expandedChapterIds.add(chapter.id); activeChapterIndex = chapters.length - 1; activeSceneIndex = 0; renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]').click(); markDirty(); showToast('已添加新章节'); });
function setWindowProjectMenuOpen(open) {
  const menu = document.getElementById('windowProjectMenu'); const button = document.getElementById('projectMenuButton');
  if (!menu || !button) return;
  menu.hidden = !open;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}
function closeWindowProjectMenu() { setWindowProjectMenuOpen(false); }
function ensureProjectFolderAction() {
  if (document.getElementById('openProjectFolderBtn')) return;
  const renameButton = document.getElementById('renameProjectBtn');
  if (!renameButton) return;
  const button = node('button'); button.id = 'openProjectFolderBtn'; button.type = 'button';
  addChild(button, 'span', '', '在资源管理器中打开'); addChild(button, 'kbd', '', '↗');
  renameButton.insertAdjacentElement('afterend', button);
}
function updateProjectFolderAction() {
  const button = document.getElementById('openProjectFolderBtn');
  if (button) button.disabled = !desktopState.filePath;
}
async function openCurrentProjectFolder() {
  closeWindowProjectMenu();
  if (!desktopState.filePath) { showToast('请先保存项目'); return; }
  try {
    clearTimeout(autoSaveTimer);
    while (activeSavePromise) await activeSavePromise;
    if (desktopState.dirty) {
      if (!(await saveProject({ silent: true }))) return;
    } else {
      const result = await desktopApi.organizeProjectStorage({ filePath: desktopState.filePath, data: JSON.parse(JSON.stringify(captureProject())) });
      if (result.previousFilePath && result.previousFilePath !== result.filePath) forgetRecentProject(result.previousFilePath);
      desktopState.filePath = result.filePath;
      desktopState.data = result.data;
      rememberProject(result.filePath, result.data.title);
      updateProjectFolderAction();
      if (result.migrated) showToast(result.cleanupIncomplete ? '项目已整理，旧文件未能完全清理' : '旧项目已整理到独立文件夹');
    }
    await desktopApi.openProjectFolder(desktopState.filePath);
  }
  catch (error) { showToast(error.message || '项目文件夹打开失败'); }
}
ensureProjectFolderAction();
updateProjectFolderAction();
document.getElementById('projectMenuButton')?.addEventListener('click', (event) => { event.stopPropagation(); closeWindowSettingsMenu(); const menu = document.getElementById('windowProjectMenu'); setWindowProjectMenuOpen(Boolean(menu?.hidden)); });
document.getElementById('newProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); newProject(); }); document.getElementById('openProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); openProject(); }); document.getElementById('saveProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); saveProject(); }); document.getElementById('undoProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); undoProjectChange(); }); document.getElementById('renameProjectBtn')?.addEventListener('click', () => { closeWindowProjectMenu(); renameProject(); }); document.getElementById('openProjectFolderBtn')?.addEventListener('click', openCurrentProjectFolder); document.getElementById('importAssetsBtn')?.addEventListener('click', importAssets);
function currentSkinSettings() {
  try {
    const stored = localStorage.getItem(SKIN_SETTINGS_STORAGE_KEY);
    if (stored) return skinSettingsTools.normalizeSkinSettings(JSON.parse(stored));
  } catch {}
  const theme = currentThemePreference();
  const resolved = theme === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : theme;
  return skinSettingsTools.presetSkin(resolved === 'dark' ? 'midnight' : 'paper');
}
function applySkinVisual(settings, backgroundDataUrl = activeSkinBackgroundDataUrl, persist = false, syncTheme = true) {
  const normalized = skinSettingsTools.normalizeSkinSettings(settings);
  activeSkinSettings = normalized;
  activeSkinBackgroundDataUrl = normalized.backgroundId ? String(backgroundDataUrl || '') : '';
  const root = document.documentElement;
  const body = document.body;
  const density = normalized.density / 100;
  root.style.setProperty('--bg', normalized.background);
  root.style.setProperty('--panel', normalized.card);
  root.style.setProperty('--ink', normalized.text);
  root.style.setProperty('--muted', normalized.muted);
  root.style.setProperty('--line', normalized.border);
  root.style.setProperty('--accent', normalized.accent);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${normalized.accent} 14%, transparent)`);
  root.style.setProperty('--skin-background', normalized.background);
  root.style.setProperty('--skin-surface', normalized.surface);
  root.style.setProperty('--skin-sidebar', normalized.sidebar);
  root.style.setProperty('--skin-chrome', normalized.chrome);
  root.style.setProperty('--skin-text', normalized.text);
  root.style.setProperty('--skin-muted', normalized.muted);
  root.style.setProperty('--skin-border', normalized.border);
  root.style.setProperty('--skin-accent', normalized.accent);
  root.style.setProperty('--skin-card', normalized.card);
  root.style.setProperty('--skin-panel-opacity', `${normalized.panelOpacity}%`);
  root.style.setProperty('--skin-background-opacity', String(normalized.backgroundOpacity / 100));
  root.style.setProperty('--skin-background-blur', `${normalized.backgroundBlur}px`);
  root.style.setProperty('--skin-background-size', normalized.backgroundSize);
  root.style.setProperty('--skin-background-position', normalized.backgroundPosition);
  root.style.setProperty('--skin-background-repeat', normalized.backgroundSize === 'auto' ? 'repeat' : 'no-repeat');
  root.style.setProperty('--skin-background-image', activeSkinBackgroundDataUrl ? `url("${activeSkinBackgroundDataUrl}")` : 'none');
  root.style.setProperty('--skin-radius', `${normalized.radius}px`);
  root.style.setProperty('--skin-density', String(density));
  root.style.setProperty('--skin-font-family', SKIN_FONT_STACKS[normalized.fontFamily] || SKIN_FONT_STACKS.system);
  body.dataset.skinActive = 'true';
  body.dataset.skinPreset = normalized.presetId;
  body.dataset.theme = normalized.mode;
  body.dataset.themePreference = syncTheme ? normalized.mode : currentThemePreference();
  root.style.colorScheme = normalized.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', normalized.chrome);
  if (persist) {
    localStorage.setItem(SKIN_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    if (syncTheme) localStorage.setItem('rropeway-theme', normalized.mode);
  }
  updateSettingsMenuState();
  return normalized;
}
async function createSkinBackgroundObjectUrl(backgroundId) {
  const payload = await desktopApi.readSkinBackground(backgroundId);
  if (typeof payload === 'string') return payload;
  if (!payload?.mime || !payload?.data) throw new Error('皮肤背景数据无效');
  return URL.createObjectURL(new Blob([payload.data], { type: payload.mime }));
}
function releaseSkinBackgroundObjectUrl(value) {
  if (String(value || '').startsWith('blob:')) URL.revokeObjectURL(value);
}
async function loadSkinBackground(settings, persistMissing = false) {
  const normalized = skinSettingsTools.normalizeSkinSettings(settings);
  if (!normalized.backgroundId || !desktopApi?.readSkinBackground) {
    applySkinVisual(normalized, '', false);
    return '';
  }
  try {
    const objectUrl = await createSkinBackgroundObjectUrl(normalized.backgroundId);
    if (activeSkinBackgroundDataUrl && activeSkinBackgroundDataUrl !== objectUrl) releaseSkinBackgroundObjectUrl(activeSkinBackgroundDataUrl);
    applySkinVisual(normalized, objectUrl, false);
    return objectUrl;
  } catch {
    const repaired = { ...normalized, presetId: 'custom', backgroundId: '', backgroundName: '' };
    applySkinVisual(repaired, '', persistMissing);
    if (persistMissing) showToast('皮肤背景文件不存在，已恢复纯色背景');
    return '';
  }
}
async function initializeSkinSystem() {
  const settings = currentSkinSettings();
  applySkinVisual(settings, '', false);
  await loadSkinBackground(settings, true);
}
function applyThemeSkin(theme) {
  const preference = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
  const resolved = preference === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : preference;
  const previousBackgroundId = activeSkinSettings?.backgroundId;
  const previousBackgroundUrl = activeSkinBackgroundDataUrl;
  localStorage.setItem('rropeway-theme', preference);
  applySkinVisual(skinSettingsTools.presetSkin(resolved === 'dark' ? 'midnight' : 'paper'), '', true, false);
  document.body.dataset.themePreference = preference;
  updateSettingsMenuState();
  if (previousBackgroundId) desktopApi?.removeSkinBackground?.(previousBackgroundId).catch(() => {});
  releaseSkinBackgroundObjectUrl(previousBackgroundUrl);
}
function applyInterfaceScale(scale, persist = true) {
  const safeScale = [90, 100, 110].includes(Number(scale)) ? Number(scale) : 100;
  const scaleFactor = safeScale / 100;
  const inverseScale = 1 / scaleFactor;
  document.body.style.removeProperty('transform');
  document.body.style.removeProperty('transform-origin');
  document.body.style.removeProperty('width');
  document.body.style.removeProperty('height');
  document.body.style.zoom = String(scaleFactor);
  document.documentElement.style.setProperty('--interface-scale', String(scaleFactor));
  document.documentElement.style.setProperty('--interface-viewport-width', `${100 * inverseScale}vw`);
  document.documentElement.style.setProperty('--interface-viewport-height', `${100 * inverseScale}vh`);
  document.body.dataset.interfaceScale = String(safeScale);
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
  dismissActiveSkinEditor?.(false);
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
  dismissActiveSkinEditor?.(false);
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
function openSkinEditorDialog() {
  dismissActiveSkinEditor?.(false);
  document.querySelector('.application-dialog-overlay')?.remove();
  const originalSettings = { ...(activeSkinSettings || currentSkinSettings()) };
  const originalBackgroundDataUrl = activeSkinBackgroundDataUrl;
  let draft = { ...originalSettings };
  let draftBackgroundDataUrl = originalBackgroundDataUrl;
  let stagedBackgroundId = '';
  let closed = false;
  const clearDraftBackgroundPreview = () => {
    if (draftBackgroundDataUrl && draftBackgroundDataUrl !== originalBackgroundDataUrl) releaseSkinBackgroundObjectUrl(draftBackgroundDataUrl);
    draftBackgroundDataUrl = '';
  };

  const overlay = addChild(document.body, 'div', 'editor-dialog-overlay application-dialog-overlay skin-editor-overlay');
  const dialog = addChild(overlay, 'div', 'editor-dialog application-dialog skin-editor-dialog');
  const header = addChild(dialog, 'div', 'application-dialog-header skin-editor-header');
  const heading = addChild(header, 'div');
  addChild(heading, 'h3', '', '外观皮肤编辑');
  addChild(heading, 'p', 'preferences-dialog-subtitle', '选择内置皮肤或自由调整整个工作区，所有修改都会实时预览。');
  const close = addChild(header, 'button', 'application-dialog-close', '×'); close.type = 'button'; close.title = '关闭';

  const preview = addChild(dialog, 'div', 'skin-live-preview');
  const previewBackdrop = addChild(preview, 'div', 'skin-live-preview-backdrop');
  const previewChrome = addChild(preview, 'div', 'skin-preview-chrome'); addChild(previewChrome, 'span', '', '✦ Rropeway'); addChild(previewChrome, 'i'); addChild(previewChrome, 'i');
  const previewWorkspace = addChild(preview, 'div', 'skin-preview-workspace');
  const previewSidebar = addChild(previewWorkspace, 'div', 'skin-preview-sidebar'); addChild(previewSidebar, 'b', '', '项目大纲'); addChild(previewSidebar, 'span', 'active', '第一章'); addChild(previewSidebar, 'span', '', '第二章');
  const previewMain = addChild(previewWorkspace, 'div', 'skin-preview-main'); addChild(previewMain, 'small', '', 'SCRIPT EDITOR'); addChild(previewMain, 'h4', '', '港口的最后一班船'); const previewCard = addChild(previewMain, 'div', 'skin-preview-card'); addChild(previewCard, 'b', '', '林澈'); addChild(previewCard, 'p', '', '潮声正从灯塔方向传来。');

  const body = addChild(dialog, 'div', 'skin-editor-body');
  const presetColumn = addChild(body, 'section', 'skin-preset-column');
  addChild(presetColumn, 'h4', '', '内置皮肤');
  addChild(presetColumn, 'p', 'skin-control-description', '可以直接使用，也可以作为自定义起点。');
  const presetList = addChild(presetColumn, 'div', 'skin-preset-list');
  const presetButtons = {};
  Object.values(skinSettingsTools.BUILTIN_SKINS).forEach((preset) => {
    const button = addChild(presetList, 'button', 'skin-preset-option'); button.type = 'button'; button.dataset.presetId = preset.presetId;
    const swatches = addChild(button, 'span', 'skin-preset-swatches');
    [preset.background, preset.sidebar, preset.card, preset.accent].forEach((color) => { const swatch = addChild(swatches, 'i'); swatch.style.background = color; });
    const copy = addChild(button, 'span', 'skin-preset-copy'); addChild(copy, 'b', '', preset.name); addChild(copy, 'small', '', preset.description);
    addChild(button, 'span', 'skin-preset-check', '✓');
    presetButtons[preset.presetId] = button;
  });

  const controlsColumn = addChild(body, 'section', 'skin-controls-column');
  const controls = {};
  const markCustom = () => {
    draft.presetId = 'custom';
    draft.name = '自定义皮肤';
    draft.description = '本机自定义外观';
  };
  const applyDraft = () => {
    draft = skinSettingsTools.normalizeSkinSettings(draft);
    applySkinVisual(draft, draftBackgroundDataUrl, false);
    preview.style.setProperty('--preview-bg', draft.background);
    preview.style.setProperty('--preview-surface', draft.surface);
    preview.style.setProperty('--preview-sidebar', draft.sidebar);
    preview.style.setProperty('--preview-chrome', draft.chrome);
    preview.style.setProperty('--preview-text', draft.text);
    preview.style.setProperty('--preview-muted', draft.muted);
    preview.style.setProperty('--preview-border', draft.border);
    preview.style.setProperty('--preview-accent', draft.accent);
    preview.style.setProperty('--preview-card', draft.card);
    preview.style.setProperty('--preview-radius', `${draft.radius}px`);
    previewBackdrop.style.backgroundImage = draftBackgroundDataUrl ? `url("${draftBackgroundDataUrl}")` : 'none';
    previewBackdrop.style.backgroundSize = draft.backgroundSize;
    previewBackdrop.style.backgroundPosition = draft.backgroundPosition;
    previewBackdrop.style.opacity = String(draft.backgroundOpacity / 100);
    previewBackdrop.style.filter = `blur(${draft.backgroundBlur}px)`;
    Object.entries(presetButtons).forEach(([presetId, button]) => button.classList.toggle('active', draft.presetId === presetId));
  };
  const createSection = (title, description) => {
    const section = addChild(controlsColumn, 'div', 'skin-control-section');
    addChild(section, 'h4', '', title);
    if (description) addChild(section, 'p', 'skin-control-description', description);
    return section;
  };
  const createSelect = (parent, key, label, values) => {
    const row = addChild(parent, 'label', 'skin-select-row'); addChild(row, 'span', '', label);
    const select = addChild(row, 'select');
    values.forEach(([value, name]) => { const option = document.createElement('option'); option.value = value; option.textContent = name; select.appendChild(option); });
    controls[key] = select;
    select.addEventListener('change', () => { markCustom(); draft[key] = select.value; applyDraft(); });
    return select;
  };
  const createRange = (parent, key, label, minimum, maximum, unit) => {
    const row = addChild(parent, 'label', 'skin-range-row');
    const copy = addChild(row, 'span'); addChild(copy, 'b', '', label); const output = addChild(copy, 'small');
    const input = addChild(row, 'input'); input.type = 'range'; input.min = String(minimum); input.max = String(maximum); input.step = '1';
    controls[key] = { input, output, unit };
    input.addEventListener('input', () => { markCustom(); draft[key] = Number(input.value); output.textContent = `${input.value}${unit}`; applyDraft(); });
  };

  const modeSection = createSection('基础模式', '决定系统控件和未覆盖区域使用浅色或深色。');
  const modeControl = addChild(modeSection, 'div', 'skin-mode-control');
  ['light', 'dark'].forEach((mode) => { const button = addChild(modeControl, 'button', 'skin-mode-button', mode === 'light' ? '浅色基底' : '深色基底'); button.type = 'button'; button.dataset.mode = mode; button.addEventListener('click', () => { markCustom(); draft.mode = mode; applyDraft(); syncControls(); }); });

  const colorSection = createSection('界面配色', '点击色块或直接输入十六进制颜色。');
  const colorGrid = addChild(colorSection, 'div', 'skin-color-grid');
  [
    ['accent', '重点色'], ['background', '背景色'], ['surface', '内容面板'], ['sidebar', '左侧栏'],
    ['chrome', '顶部栏'], ['text', '主要文字'], ['muted', '次要文字'], ['border', '分割线'], ['card', '对白卡片']
  ].forEach(([key, label]) => {
    const row = addChild(colorGrid, 'label', 'skin-color-control'); addChild(row, 'span', '', label);
    const inputs = addChild(row, 'span', 'skin-color-inputs'); const picker = addChild(inputs, 'input'); picker.type = 'color'; picker.setAttribute('aria-label', `${label}取色`); const textInput = addChild(inputs, 'input'); textInput.type = 'text'; textInput.maxLength = 7; textInput.spellcheck = false;
    controls[key] = { picker, text: textInput };
    picker.addEventListener('input', () => { markCustom(); draft[key] = picker.value; textInput.value = picker.value; applyDraft(); });
    textInput.addEventListener('input', () => { if (!/^#[0-9a-f]{6}$/i.test(textInput.value)) return; markCustom(); draft[key] = textInput.value; picker.value = textInput.value; applyDraft(); });
    textInput.addEventListener('blur', () => { textInput.value = draft[key]; });
  });

  const backgroundSection = createSection('背景图片', '图片保存在 Rropeway 本机数据目录，不会写入剧本仓库。');
  const backgroundRow = addChild(backgroundSection, 'div', 'skin-background-row');
  const backgroundCopy = addChild(backgroundRow, 'div', 'skin-background-copy'); addChild(backgroundCopy, 'b', '', '自定义背景'); const backgroundName = addChild(backgroundCopy, 'small', '', '未选择图片');
  const backgroundActions = addChild(backgroundRow, 'div', 'skin-background-actions');
  const uploadBackground = addChild(backgroundActions, 'button', 'file-button', '选择图片'); uploadBackground.type = 'button';
  const removeBackground = addChild(backgroundActions, 'button', 'file-button', '移除'); removeBackground.type = 'button';
  const backgroundSelects = addChild(backgroundSection, 'div', 'skin-select-grid');
  createSelect(backgroundSelects, 'backgroundSize', '显示方式', [['cover', '铺满'], ['contain', '完整显示'], ['auto', '原始尺寸 / 平铺']]);
  createSelect(backgroundSelects, 'backgroundPosition', '对齐位置', [['center', '居中'], ['top', '顶部'], ['bottom', '底部'], ['left', '左侧'], ['right', '右侧']]);
  createRange(backgroundSection, 'backgroundOpacity', '图片强度', 0, 100, '%');
  createRange(backgroundSection, 'backgroundBlur', '背景模糊', 0, 20, 'px');
  createRange(backgroundSection, 'panelOpacity', '面板不透明度', 45, 100, '%');

  const detailSection = createSection('细节与排版', '统一调整组件圆角、信息密度和界面字体。');
  createRange(detailSection, 'radius', '组件圆角', 0, 18, 'px');
  createRange(detailSection, 'density', '界面密度', 85, 110, '%');
  createSelect(detailSection, 'fontFamily', '界面字体', [['system', '系统无衬线'], ['serif', '衬线书稿'], ['rounded', '圆体'], ['mono', '等宽字体']]);

  const syncControls = () => {
    Object.entries(controls).forEach(([key, control]) => {
      if (control.picker) { control.picker.value = draft[key]; control.text.value = draft[key]; }
      else if (control.input) { control.input.value = String(draft[key]); control.output.textContent = `${draft[key]}${control.unit}`; }
      else control.value = draft[key];
    });
    modeControl.querySelectorAll('.skin-mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === draft.mode));
    backgroundName.textContent = draft.backgroundName || '未选择图片';
    backgroundName.title = draft.backgroundName || '';
    removeBackground.disabled = !draft.backgroundId;
    Object.entries(presetButtons).forEach(([presetId, button]) => button.classList.toggle('active', draft.presetId === presetId));
  };

  Object.entries(presetButtons).forEach(([presetId, button]) => button.addEventListener('click', () => {
    draft = skinSettingsTools.presetSkin(presetId);
    clearDraftBackgroundPreview();
    syncControls(); applyDraft();
  }));
  uploadBackground.addEventListener('click', async () => {
    uploadBackground.disabled = true;
    try {
      const imported = await desktopApi?.importSkinBackground?.();
      if (!imported) return;
      if (stagedBackgroundId && stagedBackgroundId !== originalSettings.backgroundId) await desktopApi.removeSkinBackground(stagedBackgroundId).catch(() => {});
      stagedBackgroundId = imported.id;
      draft.backgroundId = imported.id;
      draft.backgroundName = imported.name;
      draft.panelOpacity = Math.min(draft.panelOpacity, 86);
      markCustom();
      if (draftBackgroundDataUrl && draftBackgroundDataUrl !== originalBackgroundDataUrl) releaseSkinBackgroundObjectUrl(draftBackgroundDataUrl);
      draftBackgroundDataUrl = await createSkinBackgroundObjectUrl(imported.id);
      syncControls(); applyDraft();
    } catch (error) { showToast(error.message || '背景图片导入失败'); }
    finally { uploadBackground.disabled = false; }
  });
  removeBackground.addEventListener('click', () => { markCustom(); draft.backgroundId = ''; draft.backgroundName = ''; clearDraftBackgroundPreview(); syncControls(); applyDraft(); });

  const actions = addChild(dialog, 'div', 'editor-dialog-actions skin-editor-actions');
  const reset = addChild(actions, 'button', 'file-button skin-reset-button', '恢复暖纸书房'); reset.type = 'button';
  const cancel = addChild(actions, 'button', 'file-button', '取消'); cancel.type = 'button';
  const save = addChild(actions, 'button', 'file-button save', '保存皮肤'); save.type = 'button';
  const cleanupStagedBackground = async (savedBackgroundId = '') => {
    if (stagedBackgroundId && stagedBackgroundId !== savedBackgroundId && stagedBackgroundId !== originalSettings.backgroundId) {
      await desktopApi?.removeSkinBackground?.(stagedBackgroundId).catch(() => {});
    }
  };
  const dismiss = async (saveChanges) => {
    if (closed) return;
    closed = true;
    dismissActiveSkinEditor = null;
    document.removeEventListener('keydown', handleKeydown);
    if (saveChanges) {
      const saved = applySkinVisual(draft, draftBackgroundDataUrl, true);
      if (originalSettings.backgroundId && originalSettings.backgroundId !== saved.backgroundId) await desktopApi?.removeSkinBackground?.(originalSettings.backgroundId).catch(() => {});
      if (originalBackgroundDataUrl && originalBackgroundDataUrl !== draftBackgroundDataUrl) releaseSkinBackgroundObjectUrl(originalBackgroundDataUrl);
      await cleanupStagedBackground(saved.backgroundId);
      showToast('外观皮肤已保存');
    } else {
      applySkinVisual(originalSettings, originalBackgroundDataUrl, false);
      if (draftBackgroundDataUrl && draftBackgroundDataUrl !== originalBackgroundDataUrl) releaseSkinBackgroundObjectUrl(draftBackgroundDataUrl);
      await cleanupStagedBackground();
    }
    overlay.remove();
  };
  const handleKeydown = (event) => { if (event.key === 'Escape') dismiss(false); };
  dismissActiveSkinEditor = dismiss;
  document.addEventListener('keydown', handleKeydown);
  close.addEventListener('click', () => dismiss(false));
  cancel.addEventListener('click', () => dismiss(false));
  save.addEventListener('click', () => dismiss(true));
  reset.addEventListener('click', () => { draft = skinSettingsTools.presetSkin('paper'); clearDraftBackgroundPreview(); syncControls(); applyDraft(); });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(false); });
  syncControls(); applyDraft();
}
document.getElementById('windowSettingsButton')?.addEventListener('click', (event) => { event.stopPropagation(); closeWindowProjectMenu(); const menu = document.getElementById('windowSettingsMenu'); setWindowSettingsMenuOpen(Boolean(menu?.hidden)); });
document.querySelectorAll('[data-theme-option]').forEach((button) => button.addEventListener('click', () => { applyThemeSkin(button.dataset.themeOption); closeWindowSettingsMenu(); }));
document.querySelectorAll('[data-scale-option]').forEach((button) => button.addEventListener('click', () => { applyInterfaceScale(Number(button.dataset.scaleOption)); closeWindowSettingsMenu(); }));
document.getElementById('skinEditorBtn')?.addEventListener('click', () => { closeWindowSettingsMenu(); openSkinEditorDialog(); });
document.getElementById('editorPreferencesBtn')?.addEventListener('click', () => { closeWindowSettingsMenu(); openEditorPreferencesDialog(); });
document.getElementById('resetWindowLayoutBtn')?.addEventListener('click', () => { closeWindowSettingsMenu(); resetWindowLayout(); });
document.getElementById('windowHelpButton')?.addEventListener('click', () => { closeWindowProjectMenu(); closeWindowSettingsMenu(); openApplicationDialog('help'); });
systemThemeQuery.addEventListener('change', () => { if (currentThemePreference() === 'system') applyThemeSkin('system'); });
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
    (chapter.branches || []).forEach((branch) => {
      const sceneIndex = chapter.scenes.findIndex((scene) => scene.branchId === branch.id);
      if (sceneIndex >= 0 && matches(branch.title, branch.trigger)) results.push({ type: '支线', title: branch.title, detail: branch.trigger || chapter.title, view: 'editor', chapterIndex, sceneIndex, branchId: branch.id });
    });
    (chapter.scenes || []).forEach((scene, sceneIndex) => {
      const branch = branchGroupForScene(scene, chapter);
      if (matches(scene.title, scene.number)) results.push({ type: isBranchScene(scene) ? '支线场景' : '场景', title: scene.title, detail: branch ? `${chapter.title} / ${branch.title}` : chapter.title, view: 'editor', chapterIndex, sceneIndex, branchId: branch?.id || '' });
      (scene.blocks || []).forEach((block, blockIndex) => {
        const linkedItem = block.type === 'item' ? (desktopState.data.items || []).find((item) => item.id === block.itemId) : null;
        if (block.type === 'item') {
          if (matches(linkedItem?.name, linkedItem?.summary, linkedItem?.effect, linkedItem?.notes, block.investigation?.text, ...(linkedItem?.tags || []))) {
            results.push({ type: '物品引用', title: linkedItem?.name || '物品已失效', detail: `${chapter.title} / ${scene.title}`, view: 'editor', chapterIndex, sceneIndex, blockIndex });
          }
          walkItemContent(block, (contentBlock, itemContentPath, ownerItemBlock) => {
            const contentItem = contentBlock.type === 'item' ? (desktopState.data.items || []).find((item) => item.id === contentBlock.itemId) : null;
            const contentText = projectSearchText(contentBlock.textHtml || contentBlock.text || contentBlock.title || '');
            const optionText = (contentBlock.options || []).map((option) => option.text || '').join(' ');
            if (!matches(contentText, optionText, contentBlock.character, contentBlock.note, contentBlock.investigation?.text, contentItem?.name, contentItem?.summary, ...(contentBlock.statusTags || []))) return;
            const typeLabel = contentBlock.type === 'dialogue' ? '物品对白' : contentBlock.type === 'narration' ? '物品旁白' : contentBlock.type === 'choice' ? '物品选择' : contentBlock.type === 'item' ? '嵌套物品' : '物品分段';
            const ownerItem = (desktopState.data.items || []).find((item) => item.id === ownerItemBlock?.itemId);
            results.push({ type: typeLabel, title: contentItem?.name || contentText || contentBlock.character || '未命名内容', detail: `${chapter.title} / ${scene.title} · ${ownerItem?.name || linkedItem?.name || '物品'}`, view: 'editor', chapterIndex, sceneIndex, blockIndex, itemDialogueId: contentBlock.id, itemContentPath });
          });
          return;
        }
        const text = projectSearchText(block.textHtml || block.text || block.title || linkedItem?.name || '');
        const tags = (block.statusTags || []).join(' ');
        if (!matches(text, block.character, tags, block.note, linkedItem?.summary, ...(linkedItem?.tags || []))) return;
        const resultType = block.type === 'segment' ? '分段' : block.type === 'item' ? '物品引用' : block.type === 'choice' ? '选择' : block.type === 'narration' ? '旁白' : '对白';
        results.push({ type: resultType, title: text || block.character || '未命名内容', detail: `${chapter.title} / ${scene.title}${block.character ? ` · ${block.character}` : ''}`, view: 'editor', chapterIndex, sceneIndex, blockIndex });
      });
    });
  });
  (desktopState.data.characters || []).forEach((character) => { if (matches(character.name, character.role, character.description)) results.push({ type: '角色', title: character.name, detail: character.role || '未设置定位', view: 'characters', characterId: character.id }); });
  (desktopState.data.items || []).forEach((item) => { if (matches(item.name, item.summary, item.effect, item.notes, ...(item.tags || []))) results.push({ type: '物品', title: item.name, detail: item.tags?.length ? item.tags.join(' · ') : '未分类', view: 'items', itemId: item.id }); });
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
    selectedItemDialogueId = result.itemDialogueId || '';
    expandedChapterIds.add(currentChapter().id); if (result.branchId) expandedBranchIds.add(result.branchId); renderChapters(); renderSceneTabs(); renderScene(); document.querySelector('[data-view="editor"]')?.click();
    if (result.itemDialogueId) requestAnimationFrame(() => {
      const root = currentScene()?.blocks?.[result.blockIndex];
      const nestedIds = [];
      let cursor = root;
      for (const index of (result.itemContentPath || []).slice(0, -1)) {
        cursor = cursor?.blocks?.[index];
        if (cursor?.type === 'item') nestedIds.push(cursor.id);
      }
      openItemDialogueEditor(root?.id, nestedIds);
      selectedItemDialogueId = result.itemDialogueId;
      renderItemDialogueEditor();
    });
    else if (Number.isInteger(result.blockIndex)) requestAnimationFrame(() => document.querySelector(`.script-block[data-block-index="${result.blockIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else {
    document.querySelector(`[data-view="${result.view}"]`)?.click();
    requestAnimationFrame(() => document.querySelector(result.characterId ? `[data-character-id="${result.characterId}"]` : result.itemId ? `[data-item-id="${result.itemId}"]` : `[data-asset-id="${result.assetId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
document.getElementById('previewBtn')?.addEventListener('click', startScenePreview);
document.getElementById('closePreview')?.addEventListener('click', closeScenePreview);
document.querySelector('.modal-backdrop')?.addEventListener('click', closeScenePreview);
document.getElementById('previewScene')?.addEventListener('click', (event) => { if (!event.target.closest('.preview-options button')) advanceScenePreview(); });
document.addEventListener('keydown', (event) => { const previewOpen = !document.getElementById('previewModal')?.classList.contains('hidden'); if (previewOpen) { if (event.key === 'Escape') { event.preventDefault(); closeScenePreview(); return; } if (['Enter', ' ', 'ArrowRight'].includes(event.key)) { event.preventDefault(); advanceScenePreview(); return; } } const withCommand = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); if (event.key === 'F1') { event.preventDefault(); openApplicationDialog('help'); return; } if (event.key === 'F2') { event.preventDefault(); renameProject(); return; } if (!withCommand) { if (event.key === 'Escape') { closeCriticalNodePickers(); closeWindowProjectMenu(); closeWindowSettingsMenu(); setProjectSearchResultsOpen(false); document.querySelector('.application-dialog-overlay')?.remove(); } return; } if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoProjectChange(); else undoProjectChange(); return; } if (key === 'y') { event.preventDefault(); redoProjectChange(); return; } if (key === 's') { event.preventDefault(); saveProject(); } if (key === 'o') { event.preventDefault(); openProject(); } if (key === 'n') { event.preventDefault(); newProject(); } if (key === 'k' && !event.shiftKey) { event.preventDefault(); document.getElementById('projectSearchInput')?.focus(); } if (key === ',') { event.preventDefault(); closeWindowProjectMenu(); setWindowSettingsMenuOpen(true); } });
applyThemePreference(currentThemePreference(), false);
initializeSkinSystem();
applyInterfaceScale(Number(localStorage.getItem('rropeway-interface-scale') || 100), false);
applyEditorPreferences(currentEditorPreferences(), false);
initializeLayoutControls();
desktopApi?.onBeforeClose(async () => { const saved = await saveProject(); if (saved) desktopApi.finishClose(); else desktopApi.cancelClose(); });
setInterval(() => { if (desktopState.dirty && desktopState.data) localStorage.setItem('scriptroom-draft', JSON.stringify({ filePath: desktopState.filePath, data: captureProject(), savedAt: Date.now() })); }, 10000);
if (desktopApi) initializeProject();

// Interactive editor layer: characters, inspector controls, drag sorting and project switcher.
let draggedBlockIndex = null;
function activeDialogueBlock() { const scene = currentScene(); const block = scene?.blocks?.[selectedBlockIndex]; return block?.type === 'dialogue' ? block : null; }
function activeItemBlock() { if (itemDialogueEditorState) return itemDialogueEditorBlock(); const block = currentScene()?.blocks?.[selectedBlockIndex]; return block?.type === 'item' ? block : null; }
function activeItemDialogueBlock() { const block = activeItemBlock()?.blocks?.find((entry) => entry.id === selectedItemDialogueId); return block?.type === 'dialogue' ? block : null; }
function activeTextDialogueBlock() { return activeDialogueBlock() || activeItemDialogueBlock(); }
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
function selectedDialogueParagraph() {
  if (itemDialogueEditorState && selectedItemDialogueId) return document.querySelector(`.item-dialogue-detail-card[data-dialogue-id="${selectedItemDialogueId}"] .block-content p[contenteditable="true"]`);
  if (activeItemBlock() && selectedItemDialogueId) return document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .item-dialogue-entry[data-dialogue-id="${selectedItemDialogueId}"] .item-dialogue-text[contenteditable="true"]`);
  return document.querySelector(`.script-block[data-block-index="${selectedBlockIndex}"] .block-content p[contenteditable="true"]`);
}
function rememberTextSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const paragraph = container?.closest?.('.script-block.dialogue .block-content p[contenteditable="true"], .item-dialogue-text[contenteditable="true"]');
  if (!paragraph) return;
  savedTextRange = range.cloneRange();
  savedTextBlockIndex = Number(paragraph.closest('.script-block').dataset.blockIndex);
  savedTextDialogueId = paragraph.closest('.item-dialogue-entry, .item-dialogue-detail-card')?.dataset.dialogueId || '';
}
function restoreTextSelection(paragraph) {
  const selection = window.getSelection();
  selection.removeAllRanges();
  const dialogueId = paragraph.closest('.item-dialogue-entry, .item-dialogue-detail-card')?.dataset.dialogueId || '';
  const activeBlockIndex = itemDialogueEditorState ? Number(paragraph.closest('.script-block')?.dataset.blockIndex) : selectedBlockIndex;
  if (savedTextRange && savedTextBlockIndex === activeBlockIndex && savedTextDialogueId === dialogueId && (paragraph === savedTextRange.commonAncestorContainer || paragraph.contains(savedTextRange.commonAncestorContainer))) selection.addRange(savedTextRange);
  else { const range = document.createRange(); range.selectNodeContents(paragraph); selection.addRange(range); }
}
function applyInlineTextFormat(command, value = null) {
  const block = activeTextDialogueBlock(); const paragraph = selectedDialogueParagraph();
  if (!block || !paragraph) return;
  paragraph.focus(); restoreTextSelection(paragraph);
  document.execCommand(command, false, value);
  block.text = richTextPlainText(paragraph);
  block.textHtml = sanitizeRichTextHtml(paragraph.innerHTML);
  rememberTextSelection();
  if (itemDialogueEditorState) syncItemInstanceSummary(activeItemBlock());
  markDirty();
}
async function applyRubyAnnotation() {
  const block = activeTextDialogueBlock(); const paragraph = selectedDialogueParagraph();
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
  if (itemDialogueEditorState) syncItemInstanceSummary(activeItemBlock());
  markDirty();
}
function applyParagraphAlignment(alignment) {
  const block = activeTextDialogueBlock(); const paragraph = selectedDialogueParagraph();
  if (!block || !paragraph) return;
  block.textAlign = alignment;
  paragraph.style.textAlign = alignment;
  if (itemDialogueEditorState) syncItemInstanceSummary(activeItemBlock());
  markDirty();
}
function renderTextFormattingSettings(body, block, options = {}) {
  const section = createInspectorSection(body, '文字编辑器', '选中对白文字后设置格式；未选中文字时会应用到整条对白。', options.sectionKey === undefined ? 'text' : options.sectionKey);
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
  [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].forEach(([value, title]) => { const button = addChild(alignment, 'button', `text-align-button${(block.textAlign || 'left') === value ? ' active' : ''}`, value === 'left' ? '≡' : value === 'center' ? '≣' : '≡'); button.type = 'button'; button.title = title; if (value === 'right') button.classList.add('align-right-icon'); button.addEventListener('click', () => { applyParagraphAlignment(value); if (itemDialogueEditorState) renderItemDialogueEditorInspector(); else renderInspector(); }); });
  const clear = addChild(alignment, 'button', 'text-clear-button', '清除格式'); clear.type = 'button'; clear.addEventListener('mousedown', (event) => event.preventDefault()); clear.addEventListener('click', () => applyInlineTextFormat('removeFormat'));
}
document.addEventListener('selectionchange', rememberTextSelection);
const IMAGE_ASSET_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
function segmentImageFromAsset(asset) {
  return { id: `segment-image-${Date.now()}-${Math.random().toString(16).slice(2)}`, assetId: asset.id || '', name: asset.name || '未命名图片', relativePath: asset.relativePath };
}
function removeSegmentImage(segmentId, imageIndex) {
  syncCurrentScene();
  const segment = currentScene()?.blocks?.find((block) => block.id === segmentId && block.type === 'segment');
  if (!segment?.images?.[imageIndex]) return;
  segment.images.splice(imageIndex, 1);
  refreshSegmentImages('已从分段移除图片');
}
function refreshSegmentImages(message) {
  renderScene();
  renderInspector();
  renderImportedAssets();
  markDirty();
  if (message) showToast(message);
}
async function importImagesIntoSegment(segment, refresh = refreshSegmentImages) {
  if (!desktopState.filePath && !(await saveProject())) return;
  try {
    const assets = await desktopApi.importImages(desktopState.filePath);
    if (!assets.length) return;
    desktopState.data.assets.push(...assets);
    segment.images ||= [];
    segment.images.push(...assets.map(segmentImageFromAsset));
    refresh(`已添加 ${assets.length} 张分段图片`);
  } catch (error) { showToast(error.message || '图片导入失败'); }
}
function renderSegmentImageSettings(section, segment, options = {}) {
  const refresh = options.refresh || refreshSegmentImages;
  segment.images ||= [];
  const imageGroup = addChild(section, 'div', 'property-group segment-image-settings');
  addChild(imageGroup, 'label', '', '分段图片');
  if (!segment.images.length) addChild(imageGroup, 'div', 'inspector-empty compact', '尚未添加图片，可从本地或素材库选择多张图片。');
  const list = addChild(imageGroup, 'div', 'segment-image-inspector-list');
  segment.images.forEach((image, imageIndex) => {
    const row = addChild(list, 'div', 'segment-image-inspector-row');
    const preview = addChild(row, 'div', 'segment-image-inspector-preview');
    const thumbnail = addChild(preview, 'img'); thumbnail.alt = image.name || '分段图片';
    const previewRemove = addChild(preview, 'button', 'segment-image-inspector-remove', '×'); previewRemove.type = 'button'; previewRemove.title = '移除分段图片'; previewRemove.setAttribute('aria-label', `移除分段图片 ${image.name || imageIndex + 1}`);
    previewRemove.addEventListener('click', () => { segment.images.splice(imageIndex, 1); refresh('已从分段移除图片'); });
    if (desktopState.filePath && image.relativePath) desktopApi.readAsset(desktopState.filePath, image.relativePath).then((src) => { if (src) thumbnail.src = src; }).catch(() => row.classList.add('asset-missing'));
    const copy = addChild(row, 'div', 'segment-image-inspector-copy'); addChild(copy, 'b', '', image.name || '未命名图片'); addChild(copy, 'small', '', `${imageIndex + 1} / ${segment.images.length}`);
    const actions = addChild(row, 'div', 'segment-image-inspector-actions');
    const up = addChild(actions, 'button', '', '↑'); up.type = 'button'; up.title = '前移'; up.disabled = imageIndex === 0;
    const down = addChild(actions, 'button', '', '↓'); down.type = 'button'; down.title = '后移'; down.disabled = imageIndex === segment.images.length - 1;
    up.addEventListener('click', () => { const [moved] = segment.images.splice(imageIndex, 1); segment.images.splice(imageIndex - 1, 0, moved); refresh('图片顺序已调整'); });
    down.addEventListener('click', () => { const [moved] = segment.images.splice(imageIndex, 1); segment.images.splice(imageIndex + 1, 0, moved); refresh('图片顺序已调整'); });
  });
  const actions = addChild(imageGroup, 'div', 'segment-image-source-actions');
  const localButton = addChild(actions, 'button', 'file-button', '从本地选择'); localButton.type = 'button'; localButton.addEventListener('click', () => importImagesIntoSegment(segment, refresh));
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
    refresh('已从素材库添加图片');
  });
}
function createEmptyItemContent(type, characterId = '', itemId = '') {
  if (type === 'narration') return itemFormatTools.normalizeItemContentBlock({ id: createContentId('item-narration'), type, text: '' });
  if (type === 'choice') return itemFormatTools.normalizeItemContentBlock({ id: createContentId('item-choice'), type, title: '玩家将如何选择？', options: [{ id: createContentId('choice-option'), text: '', targetBlockId: '' }, { id: createContentId('choice-option'), text: '', targetBlockId: '' }] });
  if (type === 'item') return itemFormatTools.normalizeItemContentBlock({ id: createContentId('item'), type, itemId, investigation: { text: '' }, blocks: [] });
  if (type === 'segment') return itemFormatTools.normalizeItemContentBlock({ id: createContentId('item-segment'), type, title: '未命名分段', perspectiveCharacterId: null, images: [] });
  const dialogue = itemFormatTools.normalizeItemDialogue({ id: createContentId('item-dialogue') });
  const character = desktopState.data.characters?.find((item) => item.id === characterId);
  if (character) applyCharacterToBlock(character, dialogue);
  return dialogue;
}
function syncItemContentDataset(itemBlock) {
  const wrapper = document.querySelector(`.script-block[data-block-id="${itemBlock.id}"]`);
  if (wrapper) wrapper.dataset.itemBlocks = JSON.stringify(itemBlock.blocks || []);
}
function renderItemDialogueSettings(body, itemBlock, dialogue, options = {}) {
  const refresh = options.refresh || (() => { renderScene(); renderInspector(); });
  const section = createInspectorSection(body, '当前对白', '这条对白只属于当前物品实例。');
  if (!dialogue) { addChild(section, 'div', 'inspector-empty compact', '请选择一条对白。'); return null; }
  const characters = desktopState.data.characters || [];
  const characterGroup = addChild(section, 'div', 'property-group'); addChild(characterGroup, 'label', '', '当前角色');
  const characterSelect = addChild(characterGroup, 'select', 'select-control editor-select');
  const noCharacter = addChild(characterSelect, 'option', '', '未设置角色'); noCharacter.value = ''; noCharacter.selected = !dialogue.characterId && !dialogue.character;
  characters.forEach((character) => { const option = addChild(characterSelect, 'option', '', character.name); option.value = character.id; option.selected = character.id === dialogue.characterId || (!dialogue.characterId && character.name === dialogue.character); });
  characterSelect.addEventListener('change', () => {
    const character = characters.find((item) => item.id === characterSelect.value);
    if (character) applyCharacterToBlock(character, dialogue);
    else { dialogue.character = ''; dialogue.characterId = ''; dialogue.characterColor = '#b8bcb8'; dialogue.portraitPreset = null; dialogue.avatar = undefined; dialogue.portrait = undefined; }
    syncItemContentDataset(itemBlock); refresh(); markDirty();
  });
  const statusGroup = addChild(section, 'div', 'property-group'); addChild(statusGroup, 'label', '', '状态标签');
  const statusEditor = addChild(statusGroup, 'div', 'status-tag-editor');
  if (!(dialogue.statusTags || []).includes('关键节点')) {
    const enableCritical = addChild(statusEditor, 'button', 'status-tag-chip critical-node-placeholder', '关键节点'); enableCritical.type = 'button'; enableCritical.title = '点击将当前对白设置为关键节点';
    enableCritical.addEventListener('click', () => { dialogue.statusTags ||= []; dialogue.statusTags.unshift('关键节点'); syncItemContentDataset(itemBlock); refresh(); markDirty(); showToast('当前对白已设为关键节点'); });
  }
  orderedStatusTags(dialogue.statusTags).forEach((statusTag) => {
    const chip = addChild(statusEditor, 'span', `status-tag-chip${statusTag === '关键节点' ? ' critical-node-tag' : ''}`); addChild(chip, 'span', '', statusTag);
    const remove = addChild(chip, 'button', '', '×'); remove.type = 'button'; remove.title = '删除标签';
    remove.addEventListener('click', () => { dialogue.statusTags = (dialogue.statusTags || []).filter((tag) => tag !== statusTag); syncItemContentDataset(itemBlock); refresh(); markDirty(); });
  });
  const statusInput = addChild(statusEditor, 'input', 'status-tag-input'); statusInput.placeholder = '输入后按回车';
  const commitStatusTag = () => { const value = statusInput.value.trim(); if (!value || (dialogue.statusTags || []).includes(value)) return; dialogue.statusTags ||= []; if (value === '关键节点') dialogue.statusTags.unshift(value); else dialogue.statusTags.push(value); syncItemContentDataset(itemBlock); refresh(); markDirty(); };
  statusInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commitStatusTag(); } });
  statusInput.addEventListener('blur', () => setTimeout(commitStatusTag, 0));
  const voiceGroup = addChild(section, 'div', 'property-group'); addChild(voiceGroup, 'label', '', '语音提示');
  const voiceSelect = addChild(voiceGroup, 'select', 'select-control editor-select');
  ['女声 · 轻', '女声 · 强', '男声 · 低', '男声 · 清晰', '无语音'].forEach((voice) => { const option = addChild(voiceSelect, 'option', '', voice); option.value = voice; option.selected = dialogue.voice === voice; });
  voiceSelect.addEventListener('change', () => { dialogue.voice = voiceSelect.value; syncItemContentDataset(itemBlock); refresh(); markDirty(); });
  const selectedCharacter = characters.find((item) => item.id === dialogue.characterId || item.name === dialogue.character);
  const avatarGroup = addChild(section, 'div', 'property-group'); addChild(avatarGroup, 'label', '', '当前头像表情');
  createCharacterMediaSearchPicker(avatarGroup, characterMediaGroup(selectedCharacter, 'avatarGroup'), dialogue.avatar, (relativePath) => { dialogue.avatar = relativePath || undefined; syncItemContentDataset(itemBlock); refresh(); markDirty(); });
  const portraitGroup = addChild(section, 'div', 'property-group'); addChild(portraitGroup, 'label', '', '当前立绘表情');
  const portraitSelect = addChild(portraitGroup, 'select', 'select-control editor-select');
  const none = addChild(portraitSelect, 'option', '', '不使用立绘'); none.value = 'none'; none.selected = !dialogue.portrait && !dialogue.portraitPreset;
  characterMediaGroup(selectedCharacter, 'portraitGroup').forEach((portrait) => { const option = addChild(portraitSelect, 'option', '', portrait.name); option.value = `asset:${portrait.relativePath}`; option.selected = dialogue.portrait === portrait.relativePath; });
  if (selectedCharacter?.portraitPreset) { const option = addChild(portraitSelect, 'option', '', '角色默认立绘'); option.value = `preset:${selectedCharacter.portraitPreset}`; option.selected = !dialogue.portrait && dialogue.portraitPreset === selectedCharacter.portraitPreset; }
  portraitSelect.addEventListener('change', () => { if (portraitSelect.value.startsWith('asset:')) { dialogue.portrait = portraitSelect.value.slice(6); dialogue.portraitPreset = null; } else if (portraitSelect.value.startsWith('preset:')) { dialogue.portrait = undefined; dialogue.portraitPreset = portraitSelect.value.slice(7); } else { dialogue.portrait = undefined; dialogue.portraitPreset = null; } syncItemContentDataset(itemBlock); refresh(); markDirty(); });
  const noteGroup = addChild(section, 'div', 'property-group'); addChild(noteGroup, 'label', '', '创作备注');
  const note = addChild(noteGroup, 'textarea', ''); note.value = dialogue.note || ''; note.placeholder = '只供创作者查看的对白提示…';
  note.addEventListener('input', () => {
    dialogue.note = note.value; syncItemContentDataset(itemBlock);
    const copy = document.querySelector(`.item-dialogue-detail-card[data-dialogue-id="${dialogue.id}"] .block-content, .item-dialogue-entry[data-dialogue-id="${dialogue.id}"] .item-dialogue-copy`); let display = copy?.querySelector('.item-dialogue-note, .block-note');
    if (!note.value.trim()) display?.remove(); else { if (!display && copy) display = addChild(copy, 'div', copy.closest('.item-dialogue-detail-card') ? 'block-note' : 'item-dialogue-note'); if (display) display.textContent = `创作备注：${note.value}`; }
    markDirty();
  });
  return dialogue;
}
function itemDialogueEditorScene() {
  if (!itemDialogueEditorState) return null;
  return desktopState.data?.chapters?.[itemDialogueEditorState.chapterIndex]?.scenes?.[itemDialogueEditorState.sceneIndex] || null;
}
function itemDialogueEditorRootBlock() {
  const rootId = itemDialogueEditorState?.path?.[0] || itemDialogueEditorState?.blockId;
  return itemDialogueEditorScene()?.blocks?.find((block) => block.id === rootId && block.type === 'item') || null;
}
function itemDialogueEditorBlock() {
  let block = itemDialogueEditorRootBlock();
  const path = itemDialogueEditorState?.path || (itemDialogueEditorState?.blockId ? [itemDialogueEditorState.blockId] : []);
  for (const nestedId of path.slice(1)) {
    block = block?.blocks?.find((entry) => entry.type === 'item' && entry.id === nestedId) || null;
    if (!block) break;
  }
  return block;
}
function syncItemInstanceSummary(itemBlock) {
  const rootBlock = itemDialogueEditorRootBlock() || itemBlock;
  if (!rootBlock) return;
  syncItemContentDataset(rootBlock);
  const wrapper = document.querySelector(`.script-block.item-block[data-block-id="${rootBlock.id}"]`);
  const investigation = wrapper?.querySelector('.script-item-investigation-text');
  if (investigation && rootBlock === itemBlock) {
    investigation.textContent = rootBlock.investigation?.text || '尚未填写调查反应';
    investigation.classList.toggle('empty', !rootBlock.investigation?.text?.trim());
  }
}
function itemPerspectiveCharacterIdAt(blocks, index) {
  for (let blockIndex = Math.min(index - 1, blocks.length - 1); blockIndex >= 0; blockIndex -= 1) {
    if (blocks[blockIndex]?.type === 'segment') return blocks[blockIndex].perspectiveCharacterId || null;
  }
  return null;
}
async function deleteItemContentBlock(itemBlock, index) {
  if (!itemBlock?.blocks?.[index]) return;
  if (!(await requestDeleteConfirmation('确定删除这条物品内容吗？此操作无法直接撤销。'))) return;
  itemBlock.blocks.splice(index, 1);
  selectedItemDialogueId = itemBlock.blocks[Math.min(index, itemBlock.blocks.length - 1)]?.id || '';
  syncItemInstanceSummary(itemBlock);
  renderScene(); renderItemDialogueEditor(); markDirty();
}
function createItemContentDetailCard(contentBlock, index, itemBlock) {
  const scene = itemDialogueEditorScene();
  const rootBlock = itemDialogueEditorRootBlock();
  const itemBlockIndex = scene?.blocks?.findIndex((block) => block.id === rootBlock?.id) ?? -1;
  const scenePerspective = itemBlockIndex >= 0 ? perspectiveCharacterIdAt(itemBlockIndex) : '';
  const perspectiveCharacterId = itemPerspectiveCharacterIdAt(itemBlock.blocks || [], index) || scenePerspective;
  const refresh = () => { syncItemInstanceSummary(itemBlock); renderScene(); renderItemDialogueEditor(); };
  const card = createBlockElement(contentBlock, index, {
    context: 'item',
    selectedBlockId: selectedItemDialogueId,
    perspectiveCharacterId,
    getBlock: (id) => itemBlock.blocks.find((block) => block.id === id),
    onChange: () => syncItemInstanceSummary(itemBlock),
    onDelete: () => deleteItemContentBlock(itemBlock, index),
    refresh
  });
  card.classList.add('item-dialogue-detail-card', 'item-content-detail-card');
  card.classList.toggle('selected', contentBlock.id === selectedItemDialogueId);
  card.dataset.contentId = contentBlock.id;
  if (contentBlock.type === 'dialogue') card.dataset.dialogueId = contentBlock.id;
  card.dataset.blockIndex = String(index);
  card.classList.remove('pov-dialogue');
  if (contentBlock.type === 'dialogue' && perspectiveCharacterId && perspectiveCharacterId === contentBlock.characterId) card.classList.add('pov-dialogue');
  const paragraph = card.querySelector('.block-content p');
  if (paragraph) {
    paragraph.dataset.placeholder = contentBlock.type === 'dialogue' ? '输入角色对白…' : contentBlock.type === 'narration' ? '输入旁白内容…' : contentBlock.type === 'segment' ? '输入分段名称…' : '输入选择标题…';
    paragraph.addEventListener('input', () => {
      if (contentBlock.type === 'dialogue') {
        contentBlock.text = richTextPlainText(paragraph);
        contentBlock.textHtml = sanitizeRichTextHtml(paragraph.innerHTML);
      } else if (contentBlock.type === 'narration') contentBlock.text = paragraph.textContent || '';
      else contentBlock.title = paragraph.textContent || '';
      syncItemInstanceSummary(itemBlock);
      updateSceneWordCount();
      markDirty();
    });
  }
  const action = card.querySelector('[data-block-action="delete"]');
  if (action) {
    delete action.dataset.blockAction;
    action.title = '删除当前内容';
    action.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopPropagation();
      deleteItemContentBlock(itemBlock, index);
    });
  }
  card.addEventListener('click', (event) => {
    event.stopPropagation();
    if (selectedItemDialogueId === contentBlock.id) return;
    selectedItemDialogueId = contentBlock.id;
    document.querySelectorAll('.item-dialogue-detail-card').forEach((entry) => entry.classList.toggle('selected', entry === card));
    positionItemDialogueAddActions();
    renderItemDialogueEditorInspector();
  });
  const handle = card.querySelector('.block-handle');
  if (handle) {
    handle.draggable = true;
    handle.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      itemDialogueEditorState.draggedIndex = index;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', contentBlock.id);
    });
  }
  card.addEventListener('dragover', (event) => {
    if (itemDialogueEditorState?.draggedIndex === null || itemDialogueEditorState?.draggedIndex === undefined) return;
    event.preventDefault(); event.stopPropagation();
    document.querySelectorAll('.item-dialogue-detail-card').forEach((entry) => entry.classList.remove('drag-over'));
    if (itemDialogueEditorState.draggedIndex !== index) card.classList.add('drag-over');
  });
  card.addEventListener('drop', (event) => {
    event.preventDefault(); event.stopPropagation();
    const sourceIndex = itemDialogueEditorState?.draggedIndex;
    if (!Number.isInteger(sourceIndex) || sourceIndex === index) return;
    const [moved] = itemBlock.blocks.splice(sourceIndex, 1);
    itemBlock.blocks.splice(index, 0, moved);
    itemDialogueEditorState.draggedIndex = null;
    selectedItemDialogueId = moved.id;
    syncItemInstanceSummary(itemBlock);
    renderScene(); renderItemDialogueEditor(); markDirty();
    showToast('物品内容顺序已调整');
  });
  card.addEventListener('dragend', (event) => {
    event.stopPropagation();
    if (itemDialogueEditorState) itemDialogueEditorState.draggedIndex = null;
    document.querySelectorAll('.item-dialogue-detail-card').forEach((entry) => entry.classList.remove('drag-over', 'dragging'));
  });
  return card;
}
function positionItemDialogueAddActions() {
  const list = document.getElementById('itemDialogueDetailList');
  const actions = document.getElementById('itemDialogueDetailAdd');
  if (!list || !actions) return;
  const selected = list.querySelector(`.item-content-detail-card[data-content-id="${selectedItemDialogueId}"]`);
  if (selected) selected.insertAdjacentElement('afterend', actions);
  else list.appendChild(actions);
}
function renderItemDialogueEditorInspector() {
  const body = document.getElementById('itemDialogueDetailInspector');
  const itemBlock = itemDialogueEditorBlock();
  if (!body || !itemBlock) return;
  body.replaceChildren();
  const refresh = () => {
    syncItemInstanceSummary(itemBlock);
    renderScene();
    renderItemDialogueEditor();
  };
  const selectedBlock = itemBlock.blocks?.find((block) => block.id === selectedItemDialogueId) || null;
  if (!selectedBlock) { addChild(body, 'div', 'inspector-empty', '选择一项内容后编辑属性。'); return; }
  if (selectedBlock.type === 'dialogue') {
    const dialogue = renderItemDialogueSettings(body, itemBlock, selectedBlock, { refresh });
    renderTextFormattingSettings(body, dialogue, { sectionKey: '' });
  } else if (selectedBlock.type === 'segment') {
    const section = createInspectorSection(body, '当前分段', '分段会影响其后对白的主视角。');
    const titleGroup = addChild(section, 'div', 'property-group'); addChild(titleGroup, 'label', '', '分段名称');
    const title = addChild(titleGroup, 'input', 'select-control'); title.value = selectedBlock.title || '';
    title.addEventListener('input', () => { selectedBlock.title = title.value; syncItemInstanceSummary(itemBlock); const node = document.querySelector(`.item-content-detail-card[data-content-id="${selectedBlock.id}"] .segment-title`); if (node) node.textContent = title.value || '未命名分段'; markDirty(); });
    const perspectiveGroup = addChild(section, 'div', 'property-group'); addChild(perspectiveGroup, 'label', '', '主视角角色');
    const perspective = addChild(perspectiveGroup, 'select', 'select-control editor-select'); const none = addChild(perspective, 'option', '', '不设置主视角'); none.value = '';
    (desktopState.data.characters || []).forEach((character) => { const option = addChild(perspective, 'option', '', character.name); option.value = character.id; option.selected = selectedBlock.perspectiveCharacterId === character.id; });
    perspective.addEventListener('change', () => { selectedBlock.perspectiveCharacterId = perspective.value || null; refresh(); markDirty(); });
    renderSegmentImageSettings(section, selectedBlock, { refresh: (message) => { syncItemInstanceSummary(itemBlock); renderItemDialogueEditor(); renderScene(); renderImportedAssets(); markDirty(); if (message) showToast(message); } });
  } else if (selectedBlock.type === 'choice') {
    const section = createInspectorSection(body, '玩家选择', '直接在左侧内容卡中编辑标题、选项和关键节点关联。');
    addChild(section, 'div', 'inspector-empty compact', `${selectedBlock.options?.length || 0} 个选项`);
  } else if (selectedBlock.type === 'item') {
    const nestedItem = (desktopState.data.items || []).find((entry) => entry.id === selectedBlock.itemId);
    const section = createInspectorSection(body, '嵌套物品', '这是当前场景内的独立物品实例，可以继续包含完整内容流。');
    addChild(section, 'div', 'inspector-empty compact', `${nestedItem?.name || '物品已失效'} · ${selectedBlock.blocks?.length || 0} 项内容`);
    const enter = addChild(section, 'button', 'file-button primary', '进入物品内容'); enter.type = 'button';
    enter.addEventListener('click', () => openItemDialogueEditor(selectedBlock.id));
  } else {
    const section = createInspectorSection(body, '旁白', '旁白无需角色或立绘设置。');
    addChild(section, 'div', 'inspector-empty compact', '直接在左侧编辑旁白文字。');
  }
}
function renderItemDialogueEditor() {
  const editor = document.getElementById('itemDialogueEditor');
  const itemBlock = itemDialogueEditorBlock();
  const scene = itemDialogueEditorScene();
  if (!editor || !itemBlock || !scene) { closeItemDialogueEditor(true); return; }
  itemBlock.investigation ||= { text: '' };
  itemBlock.blocks ||= [];
  if (!itemBlock.blocks.some((block) => block.id === selectedItemDialogueId)) selectedItemDialogueId = itemBlock.blocks[0]?.id || '';
  const item = (desktopState.data.items || []).find((entry) => entry.id === itemBlock.itemId);
  const backButton = document.getElementById('closeItemDialogueEditor');
  const nestedLevel = (itemDialogueEditorState.path?.length || 1) > 1;
  if (backButton) { backButton.title = nestedLevel ? '返回上级物品' : '返回剧本编辑器'; backButton.setAttribute('aria-label', backButton.title); }
  document.getElementById('itemDialogueEditorTitle').textContent = item?.name || '物品已失效';
  const pathNames = [];
  let pathBlock = itemDialogueEditorRootBlock();
  if (pathBlock) pathNames.push((desktopState.data.items || []).find((entry) => entry.id === pathBlock.itemId)?.name || '物品已失效');
  for (const nestedId of (itemDialogueEditorState.path || []).slice(1)) {
    pathBlock = pathBlock?.blocks?.find((entry) => entry.type === 'item' && entry.id === nestedId) || null;
    if (pathBlock) pathNames.push((desktopState.data.items || []).find((entry) => entry.id === pathBlock.itemId)?.name || '物品已失效');
  }
  document.getElementById('itemDialogueEditorContext').textContent = `${desktopState.data.chapters[itemDialogueEditorState.chapterIndex]?.title || '未命名章节'} / ${scene.title} / ${pathNames.join(' › ')}`;
  document.getElementById('itemDialogueEditorCount').textContent = `${itemBlock.blocks.length} 项内容`;
  const investigation = document.getElementById('itemInvestigationDetailInput');
  investigation.value = itemBlock.investigation.text || '';
  investigation.oninput = () => {
    itemBlock.investigation.text = investigation.value;
    syncItemInstanceSummary(itemBlock);
    updateSceneWordCount();
    markDirty();
  };
  const list = document.getElementById('itemDialogueDetailList');
  const addActions = document.getElementById('itemDialogueDetailAdd');
  if (addActions?.parentElement === list) list.parentElement.appendChild(addActions);
  list.replaceChildren();
  if (!itemBlock.blocks.length) {
    const empty = addChild(list, 'div', 'item-dialogue-detail-empty');
    addChild(empty, 'b', '', '还没有物品内容');
    addChild(empty, 'span', '', '可添加对白、玩家选择、旁白、物品或分段。');
  }
  itemBlock.blocks.forEach((contentBlock, index) => list.appendChild(createItemContentDetailCard(contentBlock, index, itemBlock)));
  const characterSelect = document.getElementById('itemDialogueNewCharacter');
  characterSelect.replaceChildren();
  const noCharacter = addChild(characterSelect, 'option', '', '不设置角色'); noCharacter.value = '';
  (desktopState.data.characters || []).forEach((character) => { const option = addChild(characterSelect, 'option', '', character.name); option.value = character.id; });
  characterSelect.value = itemDialogueEditorState.newCharacterId || '';
  characterSelect.onchange = () => { itemDialogueEditorState.newCharacterId = characterSelect.value; };
  document.querySelectorAll('[data-item-content-type]').forEach((button) => {
    button.onclick = async () => {
      const type = button.dataset.itemContentType;
      let selectedItem = null;
      if (type === 'item') {
        selectedItem = await requestItemSelection();
        if (!selectedItem) return;
      }
      const contentBlock = createEmptyItemContent(type, characterSelect.value, selectedItem?.id || '');
      const selectedIndex = itemBlock.blocks.findIndex((entry) => entry.id === selectedItemDialogueId);
      const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : itemBlock.blocks.length;
      itemBlock.blocks.splice(insertionIndex, 0, contentBlock);
      selectedItemDialogueId = contentBlock.id;
      syncItemInstanceSummary(itemBlock);
      renderScene(); renderItemDialogueEditor(); markDirty();
      requestAnimationFrame(() => {
        if (contentBlock.type === 'item') document.querySelector(`.item-content-detail-card[data-content-id="${contentBlock.id}"] .item-dialogue-open-editor`)?.focus();
        else document.querySelector(`.item-content-detail-card[data-content-id="${contentBlock.id}"] .block-content p`)?.focus();
      });
    };
  });
  positionItemDialogueAddActions();
  renderItemDialogueEditorInspector();
}
function openItemDialogueEditor(blockId, nestedPath = []) {
  syncCurrentScene();
  let block = null;
  if (itemDialogueEditorState) {
    const current = itemDialogueEditorBlock();
    block = current?.blocks?.find((entry) => entry.id === blockId && entry.type === 'item') || null;
    if (block) itemDialogueEditorState.path = [...(itemDialogueEditorState.path || [itemDialogueEditorState.blockId]), blockId];
  } else {
    block = currentScene()?.blocks?.find((entry) => entry.id === blockId && entry.type === 'item') || null;
    if (block) {
      const path = [blockId];
      let cursor = block;
      for (const nestedId of nestedPath) {
        cursor = cursor?.blocks?.find((entry) => entry.id === nestedId && entry.type === 'item') || null;
        if (!cursor) break;
        path.push(nestedId);
      }
      block = cursor || block;
      itemDialogueEditorState = { chapterIndex: activeChapterIndex, sceneIndex: activeSceneIndex, blockId, path, newCharacterId: '', draggedIndex: null };
    }
  }
  if (!block) { showToast('物品实例已失效'); return; }
  selectedItemDialogueId = block.blocks?.[0]?.id || '';
  const editor = document.getElementById('itemDialogueEditor');
  editor.classList.remove('hidden'); editor.setAttribute('aria-hidden', 'false');
  document.body.classList.add('item-dialogue-editor-open');
  renderItemDialogueEditor();
  requestAnimationFrame(() => document.getElementById('itemInvestigationDetailInput')?.focus());
}
function closeItemDialogueEditor(force = false) {
  if (!force && (itemDialogueEditorState?.path?.length || 0) > 1) {
    const childId = itemDialogueEditorState.path.pop();
    selectedItemDialogueId = childId || itemDialogueEditorBlock()?.blocks?.[0]?.id || '';
    renderScene(); renderItemDialogueEditor();
    requestAnimationFrame(() => document.querySelector(`.item-content-detail-card[data-content-id="${childId}"]`)?.focus?.());
    return;
  }
  const state = itemDialogueEditorState;
  const blockId = state?.path?.[0] || state?.blockId;
  itemDialogueEditorState = null;
  selectedItemDialogueId = '';
  const editor = document.getElementById('itemDialogueEditor');
  editor?.classList.add('hidden'); editor?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('item-dialogue-editor-open');
  if (desktopState.data) { renderScene(); renderInspector(); }
  if (blockId) requestAnimationFrame(() => document.querySelector(`.script-block.item-block[data-block-id="${blockId}"]`)?.focus?.());
}
document.getElementById('closeItemDialogueEditor')?.addEventListener('click', () => closeItemDialogueEditor());
document.getElementById('itemDialogueEditor')?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeItemDialogueEditor(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); saveProject(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) redoProjectChange(); else undoProjectChange(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); redoProjectChange(); return; }
  if (event.key === 'Backspace' && !event.target.closest('input, textarea, select, button, [contenteditable="true"]')) {
    const itemBlock = itemDialogueEditorBlock(); const index = itemBlock?.blocks?.findIndex((block) => block.id === selectedItemDialogueId) ?? -1;
    if (index >= 0) { event.preventDefault(); event.stopPropagation(); deleteItemContentBlock(itemBlock, index); return; }
  }
  event.stopPropagation();
});
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
  } else if (selectedBlock?.type === 'item') {
    if (header) header.textContent = '物品设置';
    const properties = createInspectorSection(body, '当前物品', '', 'properties');
    const items = desktopState.data.items || [];
    const itemGroup = addChild(properties, 'div', 'property-group'); addChild(itemGroup, 'label', '', '引用物品');
    const itemSelect = addChild(itemGroup, 'select', 'select-control editor-select');
    if (!items.length) { const option = addChild(itemSelect, 'option', '', '物品库为空'); option.value = ''; itemSelect.disabled = true; }
    items.forEach((item) => { const option = addChild(itemSelect, 'option', '', item.name); option.value = item.id; option.selected = item.id === selectedBlock.itemId; });
    itemSelect.addEventListener('change', () => { selectedBlock.itemId = itemSelect.value; renderScene(); renderInspector(); markDirty(); });
    const currentItem = items.find((item) => item.id === selectedBlock.itemId);
    if (currentItem) {
      const reference = addChild(properties, 'div', 'item-inspector-reference');
      addChild(reference, 'b', '', currentItem.name);
      addChild(reference, 'span', '', currentItem.summary || currentItem.effect || '尚未填写物品说明');
      const openItem = addChild(reference, 'button', 'file-button', '打开物品资料'); openItem.type = 'button'; openItem.addEventListener('click', () => { document.querySelector('[data-view="items"]')?.click(); requestAnimationFrame(() => document.querySelector(`[data-item-id="${currentItem.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); });
    }
    const investigationSection = createInspectorSection(body, '调查反应', '玩家调查该物品后显示的独立文案。');
    selectedBlock.investigation ||= { text: '' };
    const investigationText = addChild(investigationSection, 'textarea', 'item-investigation-editor'); investigationText.rows = 4; investigationText.value = selectedBlock.investigation.text || ''; investigationText.placeholder = '例如：翻过怀表后，表盖内侧露出一道新鲜划痕。';
    investigationText.addEventListener('input', () => {
      selectedBlock.investigation.text = investigationText.value;
      const display = document.querySelector(`.script-block[data-block-id="${selectedBlock.id}"] .script-item-investigation-text`);
      if (display) { display.textContent = investigationText.value || '尚未填写调查反应'; display.classList.toggle('empty', !investigationText.value.trim()); }
      updateSceneWordCount();
      markDirty();
    });
    selectedBlock.blocks ||= [];
    const dialogueOverview = createInspectorSection(body, '物品内容流', '物品卡仅展示摘要；进入专用界面后可编辑对白、选择、旁白和分段。');
    const overview = addChild(dialogueOverview, 'div', 'item-dialogue-inspector-overview');
    const counts = selectedBlock.blocks.reduce((result, contentBlock) => { result[contentBlock.type] = (result[contentBlock.type] || 0) + 1; return result; }, {});
    addChild(overview, 'b', '', `${selectedBlock.blocks.length} 项剧本内容`);
    addChild(overview, 'span', '', selectedBlock.blocks.length ? `对白 ${counts.dialogue || 0} · 旁白 ${counts.narration || 0} · 选择 ${counts.choice || 0} · 分段 ${counts.segment || 0}` : '尚未添加物品内容。');
    const openDialogueEditor = addChild(dialogueOverview, 'button', 'primary-button', '编辑物品内容'); openDialogueEditor.type = 'button'; openDialogueEditor.addEventListener('click', () => openItemDialogueEditor(selectedBlock.id));
  } else if (selectedBlock?.type === 'narration') {
    if (header) header.textContent = '旁白';
    const properties = createInspectorSection(body, '当前旁白', '', 'properties');
    addChild(properties, 'div', 'inspector-empty compact', '旁白无需设置角色、状态标签或立绘，直接在左侧编辑内容。');
  } else if (selectedBlock?.type === 'choice') {
    if (header) header.textContent = '玩家选择';
    const properties = createInspectorSection(body, '分支关联', '', 'properties');
    addChild(properties, 'div', 'inspector-empty compact', '直接在左侧选择组件中添加、删除选项，并为每个选项关联全仓库的“关键节点”对白。');
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
      characterSelect.addEventListener('change', () => { const character = characters.find((item) => item.id === characterSelect.value); if (character) applyCharacterToBlock(character, dialogueBlock); else { dialogueBlock.character = ''; dialogueBlock.characterId = ''; dialogueBlock.characterColor = '#b8bcb8'; dialogueBlock.portraitPreset = null; dialogueBlock.avatar = undefined; dialogueBlock.portrait = undefined; } renderScene(); markDirty(); });
      const statusGroup = addChild(properties, 'div', 'property-group'); addChild(statusGroup, 'label', '', '状态标签');
      const statusEditor = addChild(statusGroup, 'div', 'status-tag-editor');
      if (!(dialogueBlock.statusTags || []).includes('关键节点')) {
        const enableCritical = addChild(statusEditor, 'button', 'status-tag-chip critical-node-placeholder', '关键节点'); enableCritical.type = 'button'; enableCritical.title = '点击将当前对白设置为关键节点';
        enableCritical.addEventListener('click', () => { syncCurrentScene(); const liveDialogue = currentScene()?.blocks?.find((item) => item.id === dialogueBlock.id); if (!liveDialogue) return; liveDialogue.statusTags ||= []; liveDialogue.statusTags.unshift('关键节点'); renderScene(); markDirty(); renderInspector(); showToast('当前对白已设为关键节点'); });
      }
      orderedStatusTags(dialogueBlock.statusTags).forEach((statusTag) => { const chip = addChild(statusEditor, 'span', `status-tag-chip${statusTag === '关键节点' ? ' critical-node-tag' : ''}`); addChild(chip, 'span', '', statusTag); const removeTag = addChild(chip, 'button', '', '×'); removeTag.type = 'button'; removeTag.title = '删除标签'; removeTag.addEventListener('click', () => { syncCurrentScene(); const liveDialogue = currentScene()?.blocks?.find((item) => item.id === dialogueBlock.id); if (!liveDialogue) return; const tagIndex = liveDialogue.statusTags.indexOf(statusTag); if (tagIndex >= 0) liveDialogue.statusTags.splice(tagIndex, 1); renderScene(); markDirty(); renderInspector(); }); });
      const statusInput = addChild(statusEditor, 'input', 'status-tag-input'); statusInput.placeholder = '输入后按回车或点击其他位置';
      const commitStatusTag = (refocus) => { const value = statusInput.value.trim(); if (!value) return; syncCurrentScene(); const liveDialogue = currentScene()?.blocks?.find((item) => item.id === dialogueBlock.id); if (!liveDialogue) return; liveDialogue.statusTags ||= []; if (liveDialogue.statusTags.includes(value)) { statusInput.value = ''; return; } if (value === '关键节点') liveDialogue.statusTags.unshift(value); else liveDialogue.statusTags.push(value); renderScene(); markDirty(); renderInspector(); if (refocus) requestAnimationFrame(() => document.querySelector('.status-tag-input')?.focus()); };
      statusInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commitStatusTag(true); } }); statusInput.addEventListener('blur', () => setTimeout(() => commitStatusTag(false), 0));
      const voiceGroup = addChild(properties, 'div', 'property-group'); addChild(voiceGroup, 'label', '', '语音提示'); const voiceSelect = addChild(voiceGroup, 'select', 'select-control editor-select'); ['女声 · 轻', '女声 · 强', '男声 · 低', '男声 · 清晰', '无语音'].forEach((voice) => { const option = addChild(voiceSelect, 'option', '', voice); option.value = voice; option.selected = dialogueBlock.voice === voice; }); voiceSelect.addEventListener('change', () => { dialogueBlock.voice = voiceSelect.value; renderScene(); markDirty(); });
      const selectedCharacter = characters.find((item) => item.id === dialogueBlock.characterId || item.name === dialogueBlock.character);
      const avatarGroup = addChild(properties, 'div', 'property-group'); addChild(avatarGroup, 'label', '', '当前头像表情');
      createCharacterMediaSearchPicker(avatarGroup, characterMediaGroup(selectedCharacter, 'avatarGroup'), dialogueBlock.avatar, (relativePath) => { dialogueBlock.avatar = relativePath || undefined; renderScene(); markDirty(); });
      const assetGroup = addChild(properties, 'div', 'property-group'); addChild(assetGroup, 'label', '', '当前立绘表情'); const assetSelect = addChild(assetGroup, 'select', 'select-control editor-select');
      const none = addChild(assetSelect, 'option', '', '不使用立绘'); none.value = 'none'; none.selected = !dialogueBlock.portrait && !dialogueBlock.portraitPreset;
      characterMediaGroup(selectedCharacter, 'portraitGroup').forEach((portrait) => { const option = addChild(assetSelect, 'option', '', portrait.name); option.value = `asset:${portrait.relativePath}`; option.selected = dialogueBlock.portrait === portrait.relativePath; });
      if (selectedCharacter?.portraitPreset) { const preset = addChild(assetSelect, 'option', '', '角色默认立绘'); preset.value = `preset:${selectedCharacter.portraitPreset}`; preset.selected = !dialogueBlock.portrait && dialogueBlock.portraitPreset === selectedCharacter.portraitPreset; }
      (desktopState.data.assets || []).filter((asset) => !['mp3', 'wav', 'ogg'].includes(asset.type)).forEach((asset) => { const option = addChild(assetSelect, 'option', '', asset.name); option.value = `asset:${asset.relativePath}`; option.selected = dialogueBlock.portrait === asset.relativePath; });
      assetSelect.addEventListener('change', () => { if (assetSelect.value.startsWith('asset:')) { dialogueBlock.portrait = assetSelect.value.slice(6); dialogueBlock.portraitPreset = null; } else if (assetSelect.value.startsWith('preset:')) { dialogueBlock.portrait = undefined; dialogueBlock.portraitPreset = assetSelect.value.slice(7); } else { dialogueBlock.portrait = undefined; dialogueBlock.portraitPreset = null; } renderScene(); markDirty(); });
      const noteBlockIndex = selectedBlockIndex;
      const noteGroup = addChild(properties, 'div', 'property-group'); addChild(noteGroup, 'label', '', '创作备注'); const note = addChild(noteGroup, 'textarea', '', dialogueBlock.note || ''); note.placeholder = '给自己留下一句创作提示…'; note.addEventListener('input', () => { dialogueBlock.note = note.value; syncDialogueNoteDisplay(noteBlockIndex, note.value); markDirty(); });
    }
  }
  if (selectedBlock?.type === 'dialogue') renderTextFormattingSettings(body, dialogueBlock);
  requestAnimationFrame(() => clampFloatingInspectorSections());
}
function applyCharacterToBlock(character, block) {
  const defaultAvatar = characterDefaultMedia(character, 'avatarGroup');
  const defaultPortrait = characterDefaultMedia(character, 'portraitGroup');
  block.character = character.name;
  block.characterId = character.id;
  block.characterKey = 'mei';
  block.characterColor = character.color || '#f2674f';
  block.avatar = defaultAvatar?.relativePath || undefined;
  block.portrait = defaultPortrait?.relativePath || undefined;
  block.portraitPreset = defaultPortrait ? null : character.portraitPreset || null;
}
function ensureRelationshipGraph() {
  desktopState.data.relationshipGraph ||= { positions: {}, relationships: [], notes: [], viewport: { centerX: 0.5, centerY: 0.5, zoom: 1 } };
  desktopState.data.relationshipGraph.positions ||= {};
  desktopState.data.relationshipGraph.relationships ||= [];
  desktopState.data.relationshipGraph.notes ||= [];
  desktopState.data.relationshipGraph.viewport ||= { centerX: 0.5, centerY: 0.5, zoom: relationshipZoom };
  desktopState.data.relationshipGraph.viewport.centerX = Number.isFinite(Number(desktopState.data.relationshipGraph.viewport.centerX)) ? Number(desktopState.data.relationshipGraph.viewport.centerX) : 0.5;
  desktopState.data.relationshipGraph.viewport.centerY = Number.isFinite(Number(desktopState.data.relationshipGraph.viewport.centerY)) ? Number(desktopState.data.relationshipGraph.viewport.centerY) : 0.5;
  desktopState.data.relationshipGraph.viewport.zoom = clampRelationshipZoom(desktopState.data.relationshipGraph.viewport.zoom);
  return desktopState.data.relationshipGraph;
}
function relationshipNodePosition(graph, characterId, characterIndex, characterCount) {
  if (graph.positions[characterId]) return graph.positions[characterId];
  const angle = characterCount === 1 ? -Math.PI / 2 : -Math.PI / 2 + (Math.PI * 2 * characterIndex) / characterCount;
  return { x: 0.5 + Math.cos(angle) * 0.31, y: 0.5 + Math.sin(angle) * 0.3 };
}
function showRelationshipGraph() {
  if (!desktopState.data) return;
  sceneFlowResizeObserver?.disconnect(); sceneFlowResizeObserver = null;
  document.querySelector('.editor-layout')?.classList.add('hidden');
  views.characters?.classList.add('hidden');
  views.assets?.classList.add('hidden');
  views.checks?.classList.add('hidden');
  views.flow?.classList.add('hidden');
  views.relationships?.classList.remove('hidden');
  document.getElementById('floatingInspectorLayer')?.classList.add('hidden');
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === 'characters'));
  const breadcrumb = document.querySelector('.breadcrumb');
  breadcrumb?.querySelector('span:first-child')?.replaceChildren(document.createTextNode('角色关系图'));
  const separator = breadcrumb?.querySelector('span:nth-child(2)'); const detail = breadcrumb?.querySelector('strong');
  if (separator) separator.hidden = true; if (detail) detail.hidden = true;
  renderRelationshipGraph();
}
function renderRelationshipGraph() {
  const view = views.relationships;
  if (!view || !desktopState.data) return;
  const graph = ensureRelationshipGraph();
  relationshipZoom = clampRelationshipZoom(graph.viewport.zoom);
  const characters = desktopState.data.characters || [];
  if (selectedRelationshipId && !graph.relationships.some((relationship) => relationship.id === selectedRelationshipId)) selectedRelationshipId = '';
  relationshipResizeObserver?.disconnect();
  relationshipResizeObserver = null;
  view.replaceChildren();
  const heading = addChild(view, 'div', 'relationship-heading');
  const headingCopy = addChild(heading, 'div', 'relationship-heading-copy');
  const backButton = addChild(headingCopy, 'button', 'relationship-back', '×'); backButton.type = 'button'; backButton.title = '退出关系图'; backButton.setAttribute('aria-label', '退出关系图');
  const titleCopy = addChild(headingCopy, 'div'); addChild(titleCopy, 'div', 'eyebrow', 'CHARACTER RELATIONSHIP MAP'); addChild(titleCopy, 'h2', '', '角色关系图');
  const headingActions = addChild(heading, 'div', 'relationship-heading-actions');
  const zoomControls = addChild(headingActions, 'div', 'relationship-zoom-controls');
  const zoomOut = addChild(zoomControls, 'button', 'relationship-zoom-button', '−'); zoomOut.type = 'button'; zoomOut.title = '缩小关系图'; zoomOut.setAttribute('aria-label', '缩小关系图');
  const zoomReset = addChild(zoomControls, 'button', 'relationship-zoom-value', `${Math.round(relationshipZoom * 100)}%`); zoomReset.type = 'button'; zoomReset.title = '恢复 100%';
  const zoomIn = addChild(zoomControls, 'button', 'relationship-zoom-button', '+'); zoomIn.type = 'button'; zoomIn.title = '放大关系图'; zoomIn.setAttribute('aria-label', '放大关系图');
  const addNote = addChild(headingActions, 'button', 'file-button relationship-add-note', '＋ 便签'); addNote.type = 'button'; addNote.title = '添加便签；在画布中也可以粘贴文本';
  const resetLayout = addChild(headingActions, 'button', 'file-button', '重新布局'); resetLayout.type = 'button';
  backButton.addEventListener('click', () => document.querySelector('[data-view="characters"]')?.click());
  resetLayout.addEventListener('click', () => { graph.positions = {}; graph.viewport = { centerX: 0.5, centerY: 0.5, zoom: 1 }; relationshipZoom = 1; selectedRelationshipId = ''; renderRelationshipGraph(); markDirty(); });
  const surface = addChild(view, 'div', 'relationship-surface');
  surface.tabIndex = 0;
  const edgeLayer = addChild(surface, 'div', 'relationship-edge-layer');
  const nodeLayer = addChild(surface, 'div', 'relationship-node-layer');
  const noteLayer = addChild(surface, 'div', 'relationship-note-layer');
  const editor = addChild(surface, 'div', 'relationship-editor');
  if (!characters.length) {
    const empty = addChild(surface, 'div', 'relationship-empty');
    addChild(empty, 'b', '', '还没有角色');
    const create = addChild(empty, 'button', 'primary-button', '新建角色'); create.type = 'button'; create.addEventListener('click', () => document.querySelector('[data-view="characters"]')?.click());
  }
  const positions = new Map(characters.map((character, characterIndex) => [character.id, relationshipNodePosition(graph, character.id, characterIndex, characters.length)]));
  const surfacePoint = (position) => {
    const surfaceRect = surface.getBoundingClientRect();
    return {
      x: surfaceRect.width / 2 + (position.x - graph.viewport.centerX) * surfaceRect.width * relationshipZoom,
      y: surfaceRect.height / 2 + (position.y - graph.viewport.centerY) * surfaceRect.height * relationshipZoom
    };
  };
  const graphPoint = (surfaceX, surfaceY) => {
    const surfaceRect = surface.getBoundingClientRect();
    return {
      x: graph.viewport.centerX + (surfaceX - surfaceRect.width / 2) / (surfaceRect.width * relationshipZoom),
      y: graph.viewport.centerY + (surfaceY - surfaceRect.height / 2) / (surfaceRect.height * relationshipZoom)
    };
  };
  const updateSurfaceGrid = () => {
    const origin = surfacePoint({ x: 0, y: 0 });
    surface.style.backgroundPosition = `${origin.x}px ${origin.y}px`;
  };
  const updateNodePosition = (characterId, position) => {
    positions.set(characterId, position);
    const characterNode = nodeLayer.querySelector(`[data-character-id="${characterId}"]`);
    if (characterNode) {
      const point = surfacePoint(position);
      characterNode.style.left = `${point.x}px`;
      characterNode.style.top = `${point.y}px`;
      characterNode.style.setProperty('--relationship-node-scale', relationshipZoom);
    }
  };
  const updateNotePosition = (note) => {
    const noteElement = noteLayer.querySelector(`[data-note-id="${note.id}"]`);
    if (!noteElement) return;
    const point = surfacePoint(note);
    noteElement.style.left = `${point.x}px`;
    noteElement.style.top = `${point.y}px`;
    noteElement.style.setProperty('--relationship-note-scale', relationshipZoom);
  };
  const renderNotes = () => {
    noteLayer.replaceChildren();
    graph.notes.forEach((note) => {
      const noteElement = addChild(noteLayer, 'article', 'relationship-note'); noteElement.dataset.noteId = note.id; noteElement.style.setProperty('--relationship-note-color', note.color);
      const noteHeader = addChild(noteElement, 'div', 'relationship-note-header');
      const colorButton = addChild(noteHeader, 'button', 'relationship-note-color'); colorButton.type = 'button'; colorButton.title = '切换便签颜色'; colorButton.style.background = note.color;
      addChild(noteHeader, 'span', 'relationship-note-label', '便签');
      const deleteNote = addChild(noteHeader, 'button', 'relationship-note-delete', '×'); deleteNote.type = 'button'; deleteNote.title = '删除便签'; deleteNote.setAttribute('aria-label', '删除便签');
      const text = addChild(noteElement, 'textarea', 'relationship-note-text'); text.value = note.text; text.placeholder = '记录人物动机、冲突或待补内容…'; text.setAttribute('aria-label', '便签内容');
      text.addEventListener('input', () => { note.text = text.value; markDirty(); });
      colorButton.addEventListener('click', () => {
        const colorIndex = RELATIONSHIP_NOTE_COLORS.indexOf(note.color);
        note.color = RELATIONSHIP_NOTE_COLORS[(colorIndex + 1 + RELATIONSHIP_NOTE_COLORS.length) % RELATIONSHIP_NOTE_COLORS.length];
        noteElement.style.setProperty('--relationship-note-color', note.color);
        colorButton.style.background = note.color;
        markDirty();
      });
      deleteNote.addEventListener('click', async () => {
        if (!(await requestDeleteConfirmation('确定删除这张便签吗？'))) return;
        graph.notes = graph.notes.filter((item) => item.id !== note.id);
        renderNotes();
        markDirty();
      });
      noteHeader.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button')) return;
        event.preventDefault();
        const surfaceRect = surface.getBoundingClientRect();
        const startPosition = { x: note.x, y: note.y }; const startX = event.clientX; const startY = event.clientY;
        noteHeader.setPointerCapture(event.pointerId); noteElement.classList.add('dragging');
        const moveNote = (pointerEvent) => {
          note.x = startPosition.x + (pointerEvent.clientX - startX) / (surfaceRect.width * relationshipZoom);
          note.y = startPosition.y + (pointerEvent.clientY - startY) / (surfaceRect.height * relationshipZoom);
          updateNotePosition(note);
        };
        const stopNote = (pointerEvent) => {
          noteHeader.removeEventListener('pointermove', moveNote); noteHeader.removeEventListener('pointerup', stopNote); noteHeader.removeEventListener('pointercancel', stopNote); noteElement.classList.remove('dragging');
          if (noteHeader.hasPointerCapture(pointerEvent.pointerId)) noteHeader.releasePointerCapture(pointerEvent.pointerId);
          markDirty();
        };
        noteHeader.addEventListener('pointermove', moveNote); noteHeader.addEventListener('pointerup', stopNote); noteHeader.addEventListener('pointercancel', stopNote);
      });
      updateNotePosition(note);
    });
  };
  let latestCanvasPoint = { x: surface.clientWidth / 2, y: surface.clientHeight / 2 };
  const createNote = (noteText = '', placement = latestCanvasPoint) => {
    const position = graphPoint(placement.x, placement.y);
    const note = { id: `relationship-note-${Date.now()}`, text: String(noteText || ''), color: RELATIONSHIP_NOTE_COLORS[graph.notes.length % RELATIONSHIP_NOTE_COLORS.length], x: position.x, y: position.y };
    graph.notes.push(note);
    renderNotes();
    markDirty();
    requestAnimationFrame(() => noteLayer.querySelector(`[data-note-id="${note.id}"] .relationship-note-text`)?.focus());
  };
  addNote.addEventListener('click', () => createNote('', { x: surface.clientWidth / 2 + (graph.notes.length % 4) * 22, y: surface.clientHeight / 2 + (graph.notes.length % 4) * 18 }));
  surface.addEventListener('pointermove', (event) => {
    const surfaceRect = surface.getBoundingClientRect();
    latestCanvasPoint = { x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top };
  });
  view.onpaste = (event) => {
    if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
    const pastedText = event.clipboardData?.getData('text/plain')?.trim();
    if (!pastedText) return;
    event.preventDefault();
    createNote(pastedText);
  };
  const renderEditor = () => {
    editor.replaceChildren();
    const relationship = graph.relationships.find((item) => item.id === selectedRelationshipId);
    editor.classList.toggle('hidden', !relationship);
    if (!relationship) return;
    const sourceCharacter = characters.find((item) => item.id === relationship.sourceCharacterId);
    const targetCharacter = characters.find((item) => item.id === relationship.targetCharacterId);
    const names = addChild(editor, 'div', 'relationship-editor-names');
    addChild(names, 'b', '', sourceCharacter?.name || '未知角色'); addChild(names, 'span', '', '→'); addChild(names, 'b', '', targetCharacter?.name || '未知角色');
    const labelInput = addChild(editor, 'input', 'relationship-label-input'); labelInput.value = relationship.label; labelInput.placeholder = '关系名称';
    const colorInput = addChild(editor, 'input', 'relationship-color-input'); colorInput.type = 'color'; colorInput.value = relationship.color;
    const remove = addChild(editor, 'button', 'relationship-delete', '×'); remove.type = 'button'; remove.title = '删除关系';
    labelInput.addEventListener('change', () => { relationship.label = labelInput.value.trim() || '关系'; renderEdges(); markDirty(); });
    colorInput.addEventListener('change', () => { relationship.color = colorInput.value; renderEdges(); markDirty(); });
    remove.addEventListener('click', () => { graph.relationships = graph.relationships.filter((item) => item.id !== relationship.id); selectedRelationshipId = ''; renderEdges(); markDirty(); });
  };
  const renderEdges = () => {
    edgeLayer.replaceChildren();
    graph.relationships.forEach((relationship) => {
      const sourcePosition = positions.get(relationship.sourceCharacterId);
      const targetPosition = positions.get(relationship.targetCharacterId);
      if (!sourcePosition || !targetPosition) return;
      const sourceCenter = surfacePoint(sourcePosition);
      const targetCenter = surfacePoint(targetPosition);
      const centerDeltaX = targetCenter.x - sourceCenter.x;
      const centerDeltaY = targetCenter.y - sourceCenter.y;
      const centerDistance = Math.hypot(centerDeltaX, centerDeltaY);
      if (centerDistance < 1) return;
      const directionX = centerDeltaX / centerDistance;
      const directionY = centerDeltaY / centerDistance;
      const reciprocal = graph.relationships.some((item) => item.sourceCharacterId === relationship.targetCharacterId && item.targetCharacterId === relationship.sourceCharacterId);
      const perpendicularOffset = reciprocal ? 9 * relationshipZoom : 0;
      const offsetX = -directionY * perpendicularOffset;
      const offsetY = directionX * perpendicularOffset;
      const nodeHalfWidth = 86 * relationshipZoom;
      const nodeHalfHeight = 33 * relationshipZoom;
      const nodeInset = 1 / Math.max(Math.abs(directionX) / nodeHalfWidth, Math.abs(directionY) / nodeHalfHeight);
      if (centerDistance <= nodeInset * 2 + 8) return;
      const sourceX = sourceCenter.x + directionX * nodeInset + offsetX;
      const sourceY = sourceCenter.y + directionY * nodeInset + offsetY;
      const targetX = targetCenter.x - directionX * nodeInset + offsetX;
      const targetY = targetCenter.y - directionY * nodeInset + offsetY;
      const distance = Math.max(0, Math.hypot(targetX - sourceX, targetY - sourceY));
      const angle = Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI;
      const line = addChild(edgeLayer, 'button', `relationship-edge${selectedRelationshipId === relationship.id ? ' selected' : ''}`); line.type = 'button'; line.title = relationship.label;
      line.style.left = `${sourceX}px`; line.style.top = `${sourceY}px`; line.style.width = `${distance}px`; line.style.transform = `translateY(-50%) rotate(${angle}deg)`; line.style.setProperty('--relationship-color', relationship.color);
      line.addEventListener('click', () => { selectedRelationshipId = relationship.id; renderEdges(); });
      const label = addChild(edgeLayer, 'button', `relationship-edge-label${selectedRelationshipId === relationship.id ? ' selected' : ''}`, relationship.label); label.type = 'button'; label.style.left = `${(sourceX + targetX) / 2}px`; label.style.top = `${(sourceY + targetY) / 2}px`; label.style.setProperty('--relationship-color', relationship.color); label.style.setProperty('--relationship-label-scale', relationshipZoom);
      label.addEventListener('click', () => { selectedRelationshipId = relationship.id; renderEdges(); });
    });
    renderEditor();
  };
  const startRelationship = (event, sourceCharacterId) => {
    event.preventDefault(); event.stopPropagation();
    const sourcePosition = positions.get(sourceCharacterId); const surfaceRect = surface.getBoundingClientRect();
    const previewLine = addChild(edgeLayer, 'div', 'relationship-edge-preview');
    const updatePreview = (pointerEvent) => {
      const sourcePoint = surfacePoint(sourcePosition); const sourceX = sourcePoint.x; const sourceY = sourcePoint.y;
      const targetX = pointerEvent.clientX - surfaceRect.left; const targetY = pointerEvent.clientY - surfaceRect.top;
      previewLine.style.left = `${sourceX}px`; previewLine.style.top = `${sourceY}px`; previewLine.style.width = `${Math.hypot(targetX - sourceX, targetY - sourceY)}px`; previewLine.style.transform = `translateY(-50%) rotate(${Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI}deg)`;
    };
    const stopRelationship = (pointerEvent) => {
      window.removeEventListener('pointermove', updatePreview); window.removeEventListener('pointerup', stopRelationship); previewLine.remove();
      const targetNode = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest('.relationship-node');
      const targetCharacterId = targetNode?.dataset.characterId;
      if (!targetCharacterId || targetCharacterId === sourceCharacterId) return;
      const existing = graph.relationships.find((item) => item.sourceCharacterId === sourceCharacterId && item.targetCharacterId === targetCharacterId);
      if (existing) selectedRelationshipId = existing.id;
      else {
        const relationship = { id: `relationship-${Date.now()}`, sourceCharacterId, targetCharacterId, label: '关系', color: '#f2674f' };
        graph.relationships.push(relationship); selectedRelationshipId = relationship.id; markDirty();
      }
      renderEdges();
    };
    updatePreview(event); window.addEventListener('pointermove', updatePreview); window.addEventListener('pointerup', stopRelationship);
  };
  characters.forEach((character, characterIndex) => {
    const position = positions.get(character.id);
    const characterNode = addChild(nodeLayer, 'article', 'relationship-node'); characterNode.dataset.characterId = character.id; characterNode.style.setProperty('--character-color', character.color || '#f2674f');
    const avatar = addChild(characterNode, 'div', 'relationship-node-avatar');
    renderCharacterDefaultAvatar(avatar, character, 'relationship-node-avatar-image');
    const copy = addChild(characterNode, 'div', 'relationship-node-copy'); addChild(copy, 'b', '', character.name); addChild(copy, 'small', '', character.role || '未设置定位');
    const connector = addChild(characterNode, 'button', 'relationship-node-connector'); connector.type = 'button'; connector.title = '拖动创建关系'; connector.setAttribute('aria-label', `从${character.name}创建关系`);
    connector.addEventListener('pointerdown', (event) => startRelationship(event, character.id));
    characterNode.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.relationship-node-connector')) return;
      event.preventDefault();
      const surfaceRect = surface.getBoundingClientRect();
      const startPosition = positions.get(character.id); const startX = event.clientX; const startY = event.clientY;
      characterNode.setPointerCapture(event.pointerId);
      const moveNode = (pointerEvent) => {
        const nextPosition = { x: startPosition.x + (pointerEvent.clientX - startX) / (surfaceRect.width * relationshipZoom), y: startPosition.y + (pointerEvent.clientY - startY) / (surfaceRect.height * relationshipZoom) };
        updateNodePosition(character.id, nextPosition); renderEdges();
      };
      const stopNode = (pointerEvent) => { characterNode.removeEventListener('pointermove', moveNode); characterNode.removeEventListener('pointerup', stopNode); characterNode.removeEventListener('pointercancel', stopNode); if (characterNode.hasPointerCapture(pointerEvent.pointerId)) characterNode.releasePointerCapture(pointerEvent.pointerId); graph.positions[character.id] = positions.get(character.id); markDirty(); };
      characterNode.addEventListener('pointermove', moveNode); characterNode.addEventListener('pointerup', stopNode); characterNode.addEventListener('pointercancel', stopNode);
    });
    updateNodePosition(character.id, position);
  });
  const applyRelationshipZoom = (value, persist = true, anchorPoint = null) => {
    const previousZoom = relationshipZoom;
    const anchoredGraphPoint = anchorPoint ? graphPoint(anchorPoint.x, anchorPoint.y) : null;
    relationshipZoom = clampRelationshipZoom(value);
    if (anchoredGraphPoint && previousZoom !== relationshipZoom) {
      const surfaceRect = surface.getBoundingClientRect();
      graph.viewport.centerX = anchoredGraphPoint.x - (anchorPoint.x - surfaceRect.width / 2) / (surfaceRect.width * relationshipZoom);
      graph.viewport.centerY = anchoredGraphPoint.y - (anchorPoint.y - surfaceRect.height / 2) / (surfaceRect.height * relationshipZoom);
    }
    graph.viewport.zoom = relationshipZoom;
    if (persist) localStorage.setItem(RELATIONSHIP_ZOOM_STORAGE_KEY, String(relationshipZoom));
    zoomReset.textContent = `${Math.round(relationshipZoom * 100)}%`;
    zoomOut.disabled = relationshipZoom <= MIN_RELATIONSHIP_ZOOM;
    zoomIn.disabled = relationshipZoom >= MAX_RELATIONSHIP_ZOOM;
    surface.style.setProperty('--relationship-grid-size', `${28 * relationshipZoom}px`);
    updateSurfaceGrid();
    positions.forEach((position, characterId) => updateNodePosition(characterId, position));
    renderNotes();
    renderEdges();
    if (persist && previousZoom !== relationshipZoom) markDirty();
  };
  zoomOut.addEventListener('click', () => applyRelationshipZoom(relationshipZoom - 0.1));
  zoomReset.addEventListener('click', () => applyRelationshipZoom(1));
  zoomIn.addEventListener('click', () => applyRelationshipZoom(relationshipZoom + 0.1));
  surface.addEventListener('wheel', (event) => {
    if (event.target.closest('textarea, input')) return;
    event.preventDefault();
    const surfaceRect = surface.getBoundingClientRect();
    applyRelationshipZoom(relationshipZoom + (event.deltaY < 0 ? 0.1 : -0.1), true, { x: event.clientX - surfaceRect.left, y: event.clientY - surfaceRect.top });
  }, { passive: false });
  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.relationship-node, .relationship-note, .relationship-edge, .relationship-edge-label, .relationship-editor, button, input, textarea')) return;
    event.preventDefault(); surface.focus({ preventScroll: true });
    const surfaceRect = surface.getBoundingClientRect();
    const startCenter = { x: graph.viewport.centerX, y: graph.viewport.centerY }; const startX = event.clientX; const startY = event.clientY;
    surface.setPointerCapture(event.pointerId); surface.classList.add('panning');
    const moveCanvas = (pointerEvent) => {
      graph.viewport.centerX = startCenter.x - (pointerEvent.clientX - startX) / (surfaceRect.width * relationshipZoom);
      graph.viewport.centerY = startCenter.y - (pointerEvent.clientY - startY) / (surfaceRect.height * relationshipZoom);
      updateSurfaceGrid();
      positions.forEach((position, characterId) => updateNodePosition(characterId, position));
      renderNotes(); renderEdges();
    };
    const stopCanvas = (pointerEvent) => {
      surface.removeEventListener('pointermove', moveCanvas); surface.removeEventListener('pointerup', stopCanvas); surface.removeEventListener('pointercancel', stopCanvas); surface.classList.remove('panning');
      if (surface.hasPointerCapture(pointerEvent.pointerId)) surface.releasePointerCapture(pointerEvent.pointerId);
      markDirty();
    };
    surface.addEventListener('pointermove', moveCanvas); surface.addEventListener('pointerup', stopCanvas); surface.addEventListener('pointercancel', stopCanvas);
  });
  relationshipResizeObserver = new ResizeObserver(() => applyRelationshipZoom(relationshipZoom, false));
  relationshipResizeObserver.observe(surface);
  applyRelationshipZoom(relationshipZoom, false);
}
function renderCharacters() {
  const view = document.getElementById('charactersView');
  if (!view) return;
  view.replaceChildren();
  const heading = addChild(view, 'div', 'section-title');
  const copy = addChild(heading, 'div');
  addChild(copy, 'div', 'eyebrow', 'CHARACTER LIBRARY');
  addChild(copy, 'h2', '', '角色与立绘');
  addChild(copy, 'p', 'muted', '管理角色信息、头像表情组和立绘表情组。');
  const headingActions = addChild(heading, 'div', 'heading-actions');
  const relationshipsButton = addChild(headingActions, 'button', 'file-button', '关系图'); relationshipsButton.type = 'button'; relationshipsButton.addEventListener('click', showRelationshipGraph);
  const createButton = addChild(headingActions, 'button', 'primary-button', '＋ 新建角色');
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
    const defaultPortrait = characterDefaultMedia(character, 'portraitGroup');
    const defaultAvatar = characterDefaultMedia(character, 'avatarGroup');
    if (defaultPortrait) { const image = addChild(art, 'img', 'character-card-portrait-image'); image.alt = defaultPortrait.name; loadProjectImage(defaultPortrait.relativePath, image, art); }
    else if (character.portraitPreset) addChild(art, 'div', `default-silhouette silhouette-${character.portraitPreset}`);
    else addChild(art, 'div', 'no-character-portrait', '未添加立绘');
    if (defaultAvatar) { const avatar = addChild(art, 'div', 'character-card-avatar'); const image = addChild(avatar, 'img'); image.alt = defaultAvatar.name; loadProjectImage(defaultAvatar.relativePath, image, avatar); }
    addChild(art, 'span', 'character-portrait-name', character.name);
    const cardCopy = addChild(card, 'div', 'character-card-copy');
    const info = addChild(cardCopy, 'div');
    addChild(info, 'h3', '', character.name);
    addChild(info, 'p', '', character.role || '未设置定位');
    const cardMeta = addChild(cardCopy, 'div', 'character-card-meta');
    addChild(cardMeta, 'span', 'character-media-counts', `头像 ${characterMediaGroup(character, 'avatarGroup').length} · 立绘 ${characterMediaGroup(character, 'portraitGroup').length}`);
    const colorDot = addChild(cardMeta, 'span', 'color-dot'); colorDot.style.background = character.color || '#f2674f'; colorDot.title = '角色代表色';
    if (character.description) addChild(card, 'p', 'character-description', character.description);
    const footer = addChild(card, 'div', 'card-foot');
    const media = addChild(footer, 'button', 'character-card-action', '头像与立绘');
    const edit = addChild(footer, 'button', 'character-card-action', '编辑信息');
    const use = addChild(footer, 'button', 'character-card-action primary', '用于当前对白');
    media.addEventListener('click', () => openCharacterMediaManager(character.id));
    edit.addEventListener('click', async () => {
      const updated = await requestCharacterForm(character);
      if (!updated) return;
      desktopState.data.characters[characterIndex] = { ...character, ...updated };
      desktopState.data.chapters.forEach((chapter) => chapter.scenes.forEach((scene) => scene.blocks.forEach((block) => {
        if (block.type === 'dialogue' && (block.characterId === character.id || block.character === character.name)) applyCharacterToBlock(desktopState.data.characters[characterIndex], block);
        if (block.type === 'item') walkItemContent(block, (dialogue) => { if (dialogue.type === 'dialogue' && (dialogue.characterId === character.id || dialogue.character === character.name)) applyCharacterToBlock(desktopState.data.characters[characterIndex], dialogue); });
      })));
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
        applyOpenedProjectResult(result);
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
    applyOpenedProjectResult(result, '项目已切换');
    document.querySelector('[data-view="editor"]').click();
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
  const panel = document.querySelector('.script-panel-scroll'); const backToTop = document.getElementById('backToTop'); const navigator = document.getElementById('segmentNavigator');
  if (!panel || !backToTop || !navigator) return;
  backToTop.classList.toggle('hidden', panel.scrollTop < 320);
  const markers = [...navigator.querySelectorAll('.segment-nav-marker')];
  const pinnedMarker = markers.find((marker) => marker.dataset.segmentIndex === navigator.dataset.activeSegmentIndex);
  if (pinnedMarker) {
    markers.forEach((marker) => marker.classList.toggle('active', marker === pinnedMarker));
    return;
  }
  let activeMarker = null;
  markers.forEach((marker) => { if (panel.scrollTop + 120 >= Number(marker.dataset.target || 0)) activeMarker = marker; marker.classList.remove('active'); });
  activeMarker?.classList.add('active');
}
async function deleteProjectEntry(project) {
  if (!project?.filePath) return;
  const confirmed = await requestConfirmation(`确定删除项目“${project.title}”吗？\n项目文件夹及其中的素材、备份将移入回收站，历史记录也会删除。`);
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
        applyOpenedProjectResult(result);
        break;
      }
    }
    showToast('项目已移入回收站');
  } catch (error) { showToast(error.message || '项目删除失败'); }
}
function renderSegmentNavigator() {
  requestAnimationFrame(() => {
    const panel = document.querySelector('.script-panel-scroll'); const canvas = document.querySelector('.script-canvas'); const navigator = document.getElementById('segmentNavigator');
    if (!panel || !canvas || !navigator) return;
    delete navigator.dataset.activeSegmentIndex;
    navigator.replaceChildren();
    const segments = [...canvas.querySelectorAll('.segment-block')];
    navigator.classList.toggle('hidden', !segments.length);
    if (!segments.length) { updateEditorScrollTools(); return; }
    addChild(navigator, 'span', 'segment-axis-line');
    const contentHeight = Math.max(1, canvas.scrollHeight);
    segments.forEach((segment, segmentIndex) => {
      const target = Math.max(0, segment.offsetTop + canvas.offsetTop - 24);
      const label = segment.querySelector('.segment-title')?.textContent || `分段 ${segmentIndex + 1}`;
      const segmentCenter = segment.offsetTop + segment.offsetHeight / 2;
      const marker = addChild(navigator, 'button', 'segment-nav-marker'); marker.type = 'button'; marker.dataset.target = String(target); marker.dataset.segmentIndex = String(segmentIndex); marker.style.top = `${Math.max(0, Math.min(100, segmentCenter / contentHeight * 100))}%`; marker.setAttribute('aria-label', label);
      addChild(marker, 'span', 'segment-nav-dot'); addChild(marker, 'span', 'segment-nav-label', label);
      marker.addEventListener('click', () => { navigator.dataset.activeSegmentIndex = String(segmentIndex); navigator.querySelectorAll('.segment-nav-marker').forEach((item) => item.classList.toggle('active', item === marker)); panel.scrollTo({ top: target, behavior: 'smooth' }); });
    });
    updateEditorScrollTools();
  });
}
const baseRenderScene = renderScene;
renderScene = function () { baseRenderScene(); savedTextRange = null; savedTextBlockIndex = null; savedTextDialogueId = ''; document.querySelectorAll('.block-handle').forEach((handle) => { handle.draggable = true; }); renderInspector(); renderSegmentNavigator(); updateSceneWordCount(); };
const baseRenderImportedAssets = renderImportedAssets;
renderImportedAssets = function () { baseRenderImportedAssets(); };
document.getElementById('workspaceSwitcher')?.addEventListener('click', openProjectMenu);
document.querySelector('.script-panel-scroll')?.addEventListener('scroll', updateEditorScrollTools, { passive: true });
document.querySelector('.script-panel-scroll')?.addEventListener('wheel', () => { const navigator = document.getElementById('segmentNavigator'); if (navigator) delete navigator.dataset.activeSegmentIndex; }, { passive: true });
document.getElementById('backToTop')?.addEventListener('click', () => document.querySelector('.script-panel-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
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
  if (!event.target.closest('.choice-target-picker')) closeCriticalNodePickers();
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
