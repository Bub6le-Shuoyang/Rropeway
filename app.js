const desktopApi = window.scriptroom;
desktopApi?.getVersion?.().then((version) => { const label = document.getElementById('appVersion'); if (label) label.textContent = `v${version}`; }).catch(() => {});
const navItems = document.querySelectorAll('.nav-item');
const views = { editor: document.getElementById('editorView'), characters: document.getElementById('charactersView'), relationships: document.getElementById('relationshipsView'), assets: document.getElementById('assetsView'), home: document.getElementById('projectHomeView') };
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
let previewState = null;
let previewRenderToken = 0;
let selectedRelationshipId = '';
let relationshipResizeObserver = null;
const RELATIONSHIP_ZOOM_STORAGE_KEY = 'rropeway-relationship-zoom';
const MIN_RELATIONSHIP_ZOOM = 0.7;
const MAX_RELATIONSHIP_ZOOM = 1.4;
function clampRelationshipZoom(value) { return Math.round(Math.min(MAX_RELATIONSHIP_ZOOM, Math.max(MIN_RELATIONSHIP_ZOOM, Number(value) || 1)) * 10) / 10; }
let relationshipZoom = clampRelationshipZoom(localStorage.getItem(RELATIONSHIP_ZOOM_STORAGE_KEY));
const normalizedAvatarSourceCache = new Map();
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
function createContentId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function orderedStatusTags(tags) {
  return [...(tags || [])].sort((left, right) => Number(right === '关键节点') - Number(left === '关键节点'));
}
function criticalDialogueNodes() {
  const nodes = [];
  (desktopState.data?.chapters || []).forEach((chapter, chapterIndex) => {
    (chapter.scenes || []).forEach((scene, sceneIndex) => {
      (scene.blocks || []).forEach((block, blockIndex) => {
        if (block.type !== 'dialogue' || !(block.statusTags || []).includes('关键节点')) return;
        nodes.push({
          id: block.id,
          chapterIndex,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          sceneIndex,
          sceneTitle: scene.title,
          blockIndex,
          character: block.character || '未设置角色',
          text: String(block.text || '空对白'),
          label: `${chapter.title} / ${scene.title} · ${block.character || '未设置角色'}：${String(block.text || '空对白').slice(0, 24)}`
        });
      });
    });
  });
  return nodes;
}
function navigateToDialogueNode(blockId) {
  const target = criticalDialogueNodes().find((item) => item.id === blockId);
  if (!target) { showToast('关联的关键节点不存在或已取消“关键节点”状态'); return; }
  syncCurrentScene();
  activeChapterIndex = target.chapterIndex;
  activeSceneIndex = target.sceneIndex;
  selectedBlockIndex = target.blockIndex;
  expandedChapterIds.add(desktopState.data.chapters[target.chapterIndex].id);
  renderChapters(); renderSceneTabs(); renderScene(); renderInspector();
  requestAnimationFrame(() => document.querySelector(`.script-block[data-block-index="${target.blockIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
function createBlockElement(block, index) {
  const blockClass = block.type === 'choice' ? 'choice-block' : block.type === 'segment' ? 'segment-block' : block.type;
  const wrapper = node('div', `script-block ${blockClass}${index === selectedBlockIndex ? ' selected' : ''}`);
  wrapper.dataset.blockIndex = String(index);
  wrapper.dataset.blockId = block.id || createContentId(block.type || 'block');
  block.id = wrapper.dataset.blockId;
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
    block.options = Array.isArray(block.options) ? block.options.map((option) => typeof option === 'string' ? { id: createContentId('choice-option'), text: option, targetBlockId: '' } : { id: option.id || createContentId('choice-option'), text: option.text || '', targetBlockId: option.targetBlockId || '' }) : [];
    wrapper.dataset.choiceOptions = JSON.stringify(block.options);
    addChild(wrapper, 'div', 'choice-icon', '↳'); addChild(content, 'span', 'block-type', '玩家选择'); addChild(content, 'p', 'choice-title', block.title || '玩家将如何选择？');
    const choices = addChild(content, 'div', 'choices');
    const criticalNodes = criticalDialogueNodes();
    const syncChoiceOptions = () => { wrapper.dataset.choiceOptions = JSON.stringify(block.options); markDirty(); };
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
        syncCurrentScene();
        const liveChoice = currentScene()?.blocks?.find((item) => item.id === block.id);
        if (!liveChoice) return;
        liveChoice.options = (liveChoice.options || []).filter((item) => item.id !== option.id);
        renderScene(); markDirty();
      });
    });
    const addOption = addChild(content, 'button', 'choice-option-add', '＋ 添加选项'); addOption.type = 'button';
    addOption.addEventListener('click', () => {
      syncCurrentScene();
      const liveChoice = currentScene()?.blocks?.find((item) => item.id === block.id);
      if (!liveChoice) return;
      liveChoice.options ||= [];
      liveChoice.options.push({ id: createContentId('choice-option'), text: '', targetBlockId: '' });
      renderScene(); markDirty();
      requestAnimationFrame(() => document.querySelector(`.script-block[data-block-index="${index}"] .choice-option-row:last-child input`)?.focus());
    });
  } else {
    const character = (desktopState.data?.characters || []).find((item) => item.id === block.characterId || item.name === block.character);
    const hasCharacter = Boolean(character || String(block.character || '').trim());
    if (!Array.isArray(block.statusTags)) block.statusTags = [block.statusTag || block.emotion || ''].map((tag) => String(tag).trim()).filter(Boolean);
    const isPerspective = perspectiveCharacterIdAt(index) && perspectiveCharacterIdAt(index) === (block.characterId || character?.id);
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
function applyProject(data, filePath = null, options = {}) { clearTimeout(autoSaveTimer); autoSaveQueued = false; document.body.classList.remove('project-home-active'); views.home?.classList.add('hidden'); desktopState.data = data; desktopState.filePath = filePath; activeChapterIndex = 0; activeSceneIndex = 0; selectedBlockIndex = 0; newDialogueCharacterId = ''; expandedChapterIds.clear(); if (data.chapters[0]) expandedChapterIds.add(data.chapters[0].id); updateProjectTitle(data.title); syncDialogueCreationState(); renderChapters(); renderSceneTabs(); renderScene(); renderImportedAssets(); desktopState.dirty = false; desktopApi?.setDirty(false); setProjectLocationStatus(filePath ? '本地项目' : '本地新项目'); setSaveStatus(filePath ? '已保存' : '未保存'); updateProjectFolderAction(); document.querySelector('[data-view="editor"]')?.click(); if (options.resetHistory !== false) resetProjectHistory(); else updateUndoAvailability(); }
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
async function openProject() { if (desktopState.data && !(await prepareProjectSwitch('当前项目有未保存修改，确定打开另一个项目吗？'))) return; try { const result = await desktopApi.openProject(); if (result) { applyProject(result.data, result.filePath); showToast('项目已打开'); } } catch (error) { showToast(error.message || '打开失败'); } }
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
  const chapters = desktopState.data?.chapters || [];
  const chapter = chapters[previewState.chapterIndex];
  if (chapter?.scenes?.[previewState.sceneIndex + 1]) return { chapterIndex: previewState.chapterIndex, sceneIndex: previewState.sceneIndex + 1 };
  for (let chapterIndex = previewState.chapterIndex + 1; chapterIndex < chapters.length; chapterIndex += 1) {
    if (chapters[chapterIndex]?.scenes?.length) return { chapterIndex, sceneIndex: 0 };
  }
  return null;
}
function previewLocationForBlockId(blockId) {
  for (let chapterIndex = 0; chapterIndex < (desktopState.data?.chapters || []).length; chapterIndex += 1) {
    const chapter = desktopState.data.chapters[chapterIndex];
    for (let sceneIndex = 0; sceneIndex < (chapter.scenes || []).length; sceneIndex += 1) {
      const blockIndex = (chapter.scenes[sceneIndex].blocks || []).findIndex((block) => block.id === blockId);
      if (blockIndex >= 0) return { chapterIndex, sceneIndex, blockIndex };
    }
  }
  return null;
}
function setPreviewScene(location) {
  previewState = { chapterIndex: location.chapterIndex, sceneIndex: location.sceneIndex, blockIndex: location.blockIndex || 0, mode: 'playing' };
  if (!(previewSceneData()?.blocks || []).length) previewState.mode = 'scene-end';
  renderPreviewFrame();
}
function closeScenePreview() { document.getElementById('previewModal')?.classList.add('hidden'); previewState = null; previewRenderToken += 1; }
function startScenePreview() {
  syncCurrentScene();
  setPreviewScene({ chapterIndex: activeChapterIndex, sceneIndex: activeSceneIndex, blockIndex: 0 });
  document.getElementById('previewModal')?.classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('previewScene')?.focus());
}
function advanceScenePreview(fromChoice = false) {
  if (!previewState) return;
  if (previewState.mode === 'project-end') { closeScenePreview(); return; }
  if (previewState.mode === 'scene-end') {
    const nextScene = nextPreviewSceneLocation();
    if (nextScene) setPreviewScene(nextScene); else { previewState.mode = 'project-end'; renderPreviewFrame(); }
    return;
  }
  if (previewBlockData()?.type === 'choice' && !fromChoice) return;
  const blocks = previewSceneData()?.blocks || [];
  if (previewState.blockIndex + 1 < blocks.length) previewState.blockIndex += 1;
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
    document.getElementById('previewEndEyebrow').textContent = previewState.mode === 'scene-end' ? '本场景结束' : '预览结束';
    document.getElementById('previewEndTitle').textContent = nextScene ? desktopState.data.chapters[nextScene.chapterIndex].scenes[nextScene.sceneIndex].title : '已经到达项目末尾';
    document.getElementById('previewEndHint').textContent = nextScene ? '点击进入下一个场景' : '点击关闭预览';
    renderPreviewPortrait(document.getElementById('previewCharacterLeft'), 'left', null, false, renderToken);
    renderPreviewPortrait(document.getElementById('previewCharacterRight'), 'right', null, false, renderToken);
    return;
  }
  const perspectiveCharacterId = previewPerspectiveCharacterId(scene, previewState.blockIndex);
  const currentCharacterId = previewCharacterId(block);
  const otherCharacterId = previewOtherCharacterId(scene, previewState.blockIndex, perspectiveCharacterId);
  renderPreviewPortrait(document.getElementById('previewCharacterRight'), 'right', previewPortraitSpec(scene, perspectiveCharacterId, previewState.blockIndex), currentCharacterId === perspectiveCharacterId, renderToken);
  renderPreviewPortrait(document.getElementById('previewCharacterLeft'), 'left', previewPortraitSpec(scene, otherCharacterId || (!perspectiveCharacterId ? currentCharacterId : ''), previewState.blockIndex), currentCharacterId && currentCharacterId !== perspectiveCharacterId, renderToken);
  if (block?.type === 'segment') {
    dialogue.classList.add('hidden'); segmentCard.classList.remove('hidden');
    document.getElementById('previewSegmentTitle').textContent = block.title || '未命名分段';
    const perspective = desktopState.data?.characters?.find((character) => character.id === block.perspectiveCharacterId);
    document.getElementById('previewSegmentPerspective').textContent = perspective ? `主视角 · ${perspective.name}` : '未设置主视角';
    return;
  }
  if (block?.type === 'dialogue') {
    speaker.textContent = block.character || '未设置角色';
    if (block.textHtml) text.innerHTML = sanitizeRichTextHtml(block.textHtml); else text.textContent = block.text || '……';
  } else if (block?.type === 'narration') {
    dialogue.classList.add('narration'); speaker.textContent = '旁白'; text.textContent = block.text || '……';
  } else if (block?.type === 'choice') {
    dialogue.classList.add('choice-preview'); speaker.textContent = '玩家选择'; text.textContent = block.title || '请选择'; advanceHint.textContent = '选择后继续';
    (block.options || []).forEach((option) => {
      const value = typeof option === 'string' ? { text: option, targetBlockId: '' } : option;
      const button = addChild(options, 'button', '', value.text || '未命名选项');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const target = value.targetBlockId ? previewLocationForBlockId(value.targetBlockId) : null;
        if (target) { previewState = { ...target, mode: 'playing' }; renderPreviewFrame(); }
        else advanceScenePreview(true);
      });
    });
  } else text.textContent = '当前内容暂不支持预览。';
}

navItems.forEach((item) => item.addEventListener('click', () => {
  if (!desktopState.data) { showToast('请先创建或打开项目'); return; }
  const target = item.dataset.view;
  relationshipResizeObserver?.disconnect();
  relationshipResizeObserver = null;
  navItems.forEach((nav) => nav.classList.toggle('active', nav === item));
  document.querySelector('.editor-layout').classList.toggle('hidden', target !== 'editor');
  views.characters.classList.toggle('hidden', target !== 'characters'); views.relationships?.classList.add('hidden'); views.assets.classList.toggle('hidden', target !== 'assets');
  document.getElementById('floatingInspectorLayer')?.classList.toggle('hidden', target !== 'editor');
  const breadcrumb = document.querySelector('.breadcrumb'); const separator = breadcrumb?.querySelector('span:nth-child(2)'); const detail = breadcrumb?.querySelector('strong');
  breadcrumb?.querySelector('span:first-child')?.replaceChildren(document.createTextNode(target === 'characters' ? '角色与立绘' : target === 'assets' ? '项目素材库' : '剧本编辑器'));
  if (separator) separator.hidden = target !== 'editor'; if (detail) detail.hidden = target !== 'editor';
  if (target === 'characters') renderCharacters(); if (target === 'assets') renderImportedAssets();
}));
function revealNewBlock(blockIndex, focusSelector) {
  requestAnimationFrame(() => {
    const panel = document.querySelector('.script-panel');
    const block = document.querySelector(`.script-block[data-block-index="${blockIndex}"]`);
    panel?.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
    block?.querySelector(focusSelector)?.focus({ preventScroll: true });
  });
}
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
    const dialogue = { id: createContentId('dialogue'), type: 'dialogue', character: '', characterId: '', characterKey: 'mei', characterColor: '#b8bcb8', portraitPreset: null, statusTags: [], voice: '', text: '', textHtml: '', textAlign: 'left' };
    if (character) applyCharacterToBlock(character, dialogue);
    currentScene().blocks.push(dialogue);
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    revealNewBlock(selectedBlockIndex, '.block-content p');
    markDirty();
    showToast('已添加一条对白');
  }
  if (event.target.closest('#addChoice')) {
    syncCurrentScene();
    currentScene().blocks.push({ id: createContentId('choice'), type: 'choice', title: '玩家将如何选择？', options: [{ id: createContentId('choice-option'), text: '', targetBlockId: '' }, { id: createContentId('choice-option'), text: '', targetBlockId: '' }] });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    revealNewBlock(selectedBlockIndex, '.choice-option-text');
    markDirty();
    showToast('已添加玩家选择');
  }
  if (event.target.closest('#addNarration')) {
    syncCurrentScene();
    currentScene().blocks.push({ id: createContentId('narration'), type: 'narration', text: '' });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    revealNewBlock(selectedBlockIndex, '.narration-text');
    markDirty();
    showToast('已添加一条旁白');
  }
  if (event.target.closest('#addSegment')) {
    syncCurrentScene();
    const segmentNumber = currentScene().blocks.filter((item) => item.type === 'segment').length + 1;
    currentScene().blocks.push({ id: createContentId('segment'), type: 'segment', title: `分段 ${segmentNumber}`, perspectiveCharacterId: null });
    selectedBlockIndex = currentScene().blocks.length - 1;
    renderScene();
    revealNewBlock(selectedBlockIndex, '.segment-title');
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
document.getElementById('previewBtn')?.addEventListener('click', startScenePreview);
document.getElementById('closePreview')?.addEventListener('click', closeScenePreview);
document.querySelector('.modal-backdrop')?.addEventListener('click', closeScenePreview);
document.getElementById('previewScene')?.addEventListener('click', (event) => { if (!event.target.closest('.preview-options button')) advanceScenePreview(); });
document.addEventListener('keydown', (event) => { const previewOpen = !document.getElementById('previewModal')?.classList.contains('hidden'); if (previewOpen) { if (event.key === 'Escape') { event.preventDefault(); closeScenePreview(); return; } if (['Enter', ' ', 'ArrowRight'].includes(event.key)) { event.preventDefault(); advanceScenePreview(); return; } } const withCommand = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); if (event.key === 'F1') { event.preventDefault(); openApplicationDialog('help'); return; } if (event.key === 'F2') { event.preventDefault(); renameProject(); return; } if (!withCommand) { if (event.key === 'Escape') { closeCriticalNodePickers(); closeWindowProjectMenu(); closeWindowSettingsMenu(); setProjectSearchResultsOpen(false); document.querySelector('.application-dialog-overlay')?.remove(); } return; } if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoProjectChange(); else undoProjectChange(); return; } if (key === 'y') { event.preventDefault(); redoProjectChange(); return; } if (key === 's') { event.preventDefault(); saveProject(); } if (key === 'o') { event.preventDefault(); openProject(); } if (key === 'n') { event.preventDefault(); newProject(); } if (key === 'k' && !event.shiftKey) { event.preventDefault(); document.getElementById('projectSearchInput')?.focus(); } if (key === ',') { event.preventDefault(); closeWindowProjectMenu(); setWindowSettingsMenuOpen(true); } });
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
  if (selectedBlock?.type !== 'narration' && selectedBlock?.type !== 'choice') renderTextFormattingSettings(body, dialogueBlock);
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
  desktopState.data.relationshipGraph ||= { positions: {}, relationships: [] };
  desktopState.data.relationshipGraph.positions ||= {};
  desktopState.data.relationshipGraph.relationships ||= [];
  return desktopState.data.relationshipGraph;
}
function relationshipNodePosition(graph, characterId, characterIndex, characterCount) {
  if (graph.positions[characterId]) return graph.positions[characterId];
  const angle = characterCount === 1 ? -Math.PI / 2 : -Math.PI / 2 + (Math.PI * 2 * characterIndex) / characterCount;
  return { x: 0.5 + Math.cos(angle) * 0.31, y: 0.5 + Math.sin(angle) * 0.3 };
}
function showRelationshipGraph() {
  if (!desktopState.data) return;
  document.querySelector('.editor-layout')?.classList.add('hidden');
  views.characters?.classList.add('hidden');
  views.assets?.classList.add('hidden');
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
  const resetLayout = addChild(headingActions, 'button', 'file-button', '重新布局'); resetLayout.type = 'button';
  backButton.addEventListener('click', () => document.querySelector('[data-view="characters"]')?.click());
  resetLayout.addEventListener('click', () => { graph.positions = {}; selectedRelationshipId = ''; renderRelationshipGraph(); markDirty(); });
  const surface = addChild(view, 'div', 'relationship-surface');
  const edgeLayer = addChild(surface, 'div', 'relationship-edge-layer');
  const nodeLayer = addChild(surface, 'div', 'relationship-node-layer');
  const editor = addChild(surface, 'div', 'relationship-editor');
  if (!characters.length) {
    const empty = addChild(surface, 'div', 'relationship-empty');
    addChild(empty, 'b', '', '还没有角色');
    const create = addChild(empty, 'button', 'primary-button', '新建角色'); create.type = 'button'; create.addEventListener('click', () => document.querySelector('[data-view="characters"]')?.click());
    return;
  }
  const positions = new Map(characters.map((character, characterIndex) => [character.id, relationshipNodePosition(graph, character.id, characterIndex, characters.length)]));
  const surfacePoint = (position) => {
    const surfaceRect = surface.getBoundingClientRect();
    return {
      x: surfaceRect.width / 2 + (position.x - 0.5) * surfaceRect.width * relationshipZoom,
      y: surfaceRect.height / 2 + (position.y - 0.5) * surfaceRect.height * relationshipZoom
    };
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
      const targetX = Math.max(0, Math.min(surfaceRect.width, pointerEvent.clientX - surfaceRect.left)); const targetY = Math.max(0, Math.min(surfaceRect.height, pointerEvent.clientY - surfaceRect.top));
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
        const nextPosition = { x: Math.min(0.92, Math.max(0.08, startPosition.x + (pointerEvent.clientX - startX) / (surfaceRect.width * relationshipZoom))), y: Math.min(0.88, Math.max(0.12, startPosition.y + (pointerEvent.clientY - startY) / (surfaceRect.height * relationshipZoom))) };
        updateNodePosition(character.id, nextPosition); renderEdges();
      };
      const stopNode = (pointerEvent) => { characterNode.removeEventListener('pointermove', moveNode); characterNode.removeEventListener('pointerup', stopNode); if (characterNode.hasPointerCapture(pointerEvent.pointerId)) characterNode.releasePointerCapture(pointerEvent.pointerId); graph.positions[character.id] = positions.get(character.id); markDirty(); };
      characterNode.addEventListener('pointermove', moveNode); characterNode.addEventListener('pointerup', stopNode);
    });
    updateNodePosition(character.id, position);
  });
  const applyRelationshipZoom = (value, persist = true) => {
    relationshipZoom = clampRelationshipZoom(value);
    if (persist) localStorage.setItem(RELATIONSHIP_ZOOM_STORAGE_KEY, String(relationshipZoom));
    zoomReset.textContent = `${Math.round(relationshipZoom * 100)}%`;
    zoomOut.disabled = relationshipZoom <= MIN_RELATIONSHIP_ZOOM;
    zoomIn.disabled = relationshipZoom >= MAX_RELATIONSHIP_ZOOM;
    surface.style.setProperty('--relationship-grid-size', `${28 * relationshipZoom}px`);
    positions.forEach((position, characterId) => updateNodePosition(characterId, position));
    renderEdges();
  };
  zoomOut.addEventListener('click', () => applyRelationshipZoom(relationshipZoom - 0.1));
  zoomReset.addEventListener('click', () => applyRelationshipZoom(1));
  zoomIn.addEventListener('click', () => applyRelationshipZoom(relationshipZoom + 0.1));
  surface.addEventListener('wheel', (event) => {
    event.preventDefault();
    applyRelationshipZoom(relationshipZoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
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
    const colorDot = addChild(cardCopy, 'span', 'color-dot'); colorDot.style.background = character.color || '#f2674f';
    if (character.description) addChild(card, 'p', 'character-description', character.description);
    addChild(card, 'div', 'character-media-counts', `头像 ${characterMediaGroup(character, 'avatarGroup').length} · 立绘 ${characterMediaGroup(character, 'portraitGroup').length}`);
    const footer = addChild(card, 'div', 'card-foot');
    const media = addChild(footer, 'button', 'character-card-action', '头像与立绘');
    const edit = addChild(footer, 'button', 'character-card-action', '编辑信息');
    const use = addChild(footer, 'button', 'character-card-action primary', '用于当前对白');
    media.addEventListener('click', () => openCharacterMediaManager(character.id));
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
renderScene = function () { baseRenderScene(); savedTextRange = null; savedTextBlockIndex = null; document.querySelectorAll('.block-handle').forEach((handle) => { handle.draggable = true; }); renderInspector(); renderSegmentNavigator(); };
const baseRenderImportedAssets = renderImportedAssets;
renderImportedAssets = function () { baseRenderImportedAssets(); };
document.getElementById('workspaceSwitcher')?.addEventListener('click', openProjectMenu);
document.querySelector('.script-panel')?.addEventListener('scroll', updateEditorScrollTools, { passive: true });
document.querySelector('.script-panel')?.addEventListener('wheel', () => { const navigator = document.getElementById('segmentNavigator'); if (navigator) delete navigator.dataset.activeSegmentIndex; }, { passive: true });
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
