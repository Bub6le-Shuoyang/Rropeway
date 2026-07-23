const DEFAULT_PROJECT = {
  format: 'scriptroom-project',
  version: 1,
  title: 'Rropeway',
  description: '',
  chapters: [{
    id: 'chapter-1', title: '第一章', status: '草稿',
    scenes: [{ id: 'scene-1', number: '01', title: '未命名场景', blocks: [] }]
  }],
  characters: [],
  assets: [],
  updatedAt: new Date().toISOString()
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
let generatedIdCounter = 0;
function generatedId(prefix, index) {
  generatedIdCounter += 1;
  return `${prefix}-${Date.now()}-${generatedIdCounter}-${index}`;
}
function blockId(value, type, index) {
  return String(value.id || generatedId(type, index));
}
function normalizeChoiceOption(option, index) {
  if (option && typeof option === 'object') {
    return {
      id: String(option.id || generatedId('choice-option', index)),
      text: String(option.text || ''),
      targetBlockId: option.targetBlockId ? String(option.targetBlockId) : ''
    };
  }
  return { id: generatedId('choice-option', index), text: String(option || ''), targetBlockId: '' };
}
function normalizeBlock(block, index = 0) {
  const value = block && typeof block === 'object' ? block : {};
  if (value.type === 'choice') return { id: blockId(value, 'choice', index), type: 'choice', title: String(value.title || ''), options: Array.isArray(value.options) ? value.options.map(normalizeChoiceOption) : [] };
  if (value.type === 'narration') return { id: blockId(value, 'narration', index), type: 'narration', text: String(value.text || '') };
  if (value.type === 'segment') return {
    id: blockId(value, 'segment', index),
    type: 'segment',
    title: String(value.title || '未命名分段'),
    perspectiveCharacterId: value.perspectiveCharacterId ? String(value.perspectiveCharacterId) : null,
    images: Array.isArray(value.images) ? value.images.map((image, index) => ({
      id: String(image?.id || `segment-image-${Date.now()}-${index}`),
      assetId: image?.assetId ? String(image.assetId) : '',
      name: String(image?.name || '未命名图片'),
      relativePath: String(image?.relativePath || '')
    })).filter((image) => image.relativePath) : []
  };
  const legacyStatusTag = String(value.statusTag ?? value.emotion ?? '').trim();
  const statusTags = (Array.isArray(value.statusTags) ? value.statusTags : legacyStatusTag ? [legacyStatusTag] : []).map((tag) => String(tag).trim()).filter((tag, index, tags) => tag && tags.indexOf(tag) === index).sort((left, right) => Number(right === '关键节点') - Number(left === '关键节点'));
  return { id: blockId(value, 'dialogue', index), type: 'dialogue', character: String(value.character || ''), characterId: value.characterId ? String(value.characterId) : '', characterKey: value.characterKey === 'yan' ? 'yan' : 'mei', characterColor: String(value.characterColor || '#b8bcb8'), portraitPreset: value.portraitPreset ? String(value.portraitPreset) : null, statusTags, voice: String(value.voice || ''), text: String(value.text || ''), textHtml: String(value.textHtml || ''), textAlign: ['left', 'center', 'right'].includes(value.textAlign) ? value.textAlign : 'left', note: String(value.note || ''), avatar: value.avatar ? String(value.avatar) : undefined, portrait: value.portrait ? String(value.portrait) : undefined };
}
function normalizeCharacterMedia(items, groupName) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const value = typeof item === 'string' ? { relativePath: item } : item && typeof item === 'object' ? item : {};
    const relativePath = String(value.relativePath || value.fileName || '');
    if (!relativePath) return null;
    const fileName = relativePath.split('/').pop()?.split('\\').pop() || `${groupName}-${index + 1}`;
    const originalName = String(value.originalName || value.sourceName || value.name || fileName.replace(/\.[^.]+$/, '') || `${groupName}-${index + 1}`);
    return {
      id: String(value.id || `${groupName}-${Date.now()}-${index}`),
      name: originalName,
      originalName,
      alias: String(value.alias || ''),
      relativePath,
      type: String(value.type || fileName.split('.').pop() || '').toLowerCase()
    };
  }).filter(Boolean);
}
function normalizeCharacter(character, index) {
  const value = character && typeof character === 'object' ? character : {};
  const avatarGroup = normalizeCharacterMedia(value.avatarGroup || value.avatars, 'avatar');
  const portraitGroup = normalizeCharacterMedia(value.portraitGroup || value.portraits, 'portrait');
  return {
    id: String(value.id || `character-${Date.now()}-${index}`),
    name: String(value.name || `未命名角色 ${index + 1}`),
    role: String(value.role || ''),
    description: String(value.description || ''),
    color: /^#[0-9a-f]{6}$/i.test(value.color || '') ? value.color : '#f2674f',
    portraitPreset: ['tall-male', 'short-male', 'tall-female', 'short-female'].includes(value.portraitPreset) ? value.portraitPreset : null,
    avatarGroup,
    portraitGroup,
    defaultAvatarId: avatarGroup.some((item) => item.id === value.defaultAvatarId) ? String(value.defaultAvatarId) : avatarGroup[0]?.id || '',
    defaultPortraitId: portraitGroup.some((item) => item.id === value.defaultPortraitId) ? String(value.defaultPortraitId) : portraitGroup[0]?.id || ''
  };
}
function normalizeScene(scene, index) {
  const value = scene && typeof scene === 'object' ? scene : {};
  return { id: String(value.id || `scene-${Date.now()}-${index}`), number: String(value.number || String(index + 1).padStart(2, '0')), title: String(value.title || `未命名场景 ${index + 1}`), background: value.background ? String(value.background) : '', blocks: Array.isArray(value.blocks) ? value.blocks.map(normalizeBlock) : [] };
}
function normalizeRelationshipGraph(graph, characters) {
  const value = graph && typeof graph === 'object' ? graph : {};
  const characterIds = new Set(characters.map((character) => character.id));
  const positions = {};
  Object.entries(value.positions && typeof value.positions === 'object' ? value.positions : {}).forEach(([characterId, position]) => {
    if (!characterIds.has(characterId)) return;
    positions[characterId] = {
      x: Math.min(0.92, Math.max(0.08, Number.isFinite(Number(position?.x)) ? Number(position.x) : 0.5)),
      y: Math.min(0.88, Math.max(0.12, Number.isFinite(Number(position?.y)) ? Number(position.y) : 0.5))
    };
  });
  const relationships = (Array.isArray(value.relationships) ? value.relationships : []).map((relationship, index) => ({
    id: String(relationship?.id || `relationship-${Date.now()}-${index}`),
    sourceCharacterId: String(relationship?.sourceCharacterId || ''),
    targetCharacterId: String(relationship?.targetCharacterId || ''),
    label: String(relationship?.label || '关系'),
    color: /^#[0-9a-f]{6}$/i.test(relationship?.color || '') ? relationship.color : '#f2674f'
  })).filter((relationship) => relationship.sourceCharacterId !== relationship.targetCharacterId && characterIds.has(relationship.sourceCharacterId) && characterIds.has(relationship.targetCharacterId));
  return { positions, relationships };
}
function normalizeProject(input) {
  const value = input && typeof input === 'object' ? input : {};
  const chapters = Array.isArray(value.chapters) ? value.chapters : [];
  const characters = Array.isArray(value.characters) ? value.characters.map(normalizeCharacter) : [];
  const normalized = {
    format: 'scriptroom-project', version: 1, title: String(value.title || 'Rropeway'), description: String(value.description || ''),
    chapters: chapters.map((chapter, chapterIndex) => ({ id: String(chapter?.id || `chapter-${Date.now()}-${chapterIndex}`), title: String(chapter?.title || `第 ${chapterIndex + 1} 章`), status: String(chapter?.status || '草稿'), scenes: Array.isArray(chapter?.scenes) ? chapter.scenes.map(normalizeScene) : [] })),
    characters,
    relationshipGraph: normalizeRelationshipGraph(value.relationshipGraph, characters),
    assets: Array.isArray(value.assets) ? value.assets.map((asset) => ({ id: String(asset?.id || `asset-${Date.now()}`), name: String(asset?.name || '未命名素材'), fileName: String(asset?.fileName || ''), relativePath: String(asset?.relativePath || asset?.fileName || ''), type: String(asset?.type || ''), tags: (Array.isArray(asset?.tags) ? asset.tags : asset?.tag ? [asset.tag] : []).map((tag) => String(tag).trim()).filter((tag, index, tags) => tag && tags.indexOf(tag) === index) })) : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
  if (!normalized.chapters.length) normalized.chapters.push({ id: `chapter-${Date.now()}`, title: '第一章', status: '草稿', scenes: [] });
  normalized.chapters.forEach((chapter, chapterIndex) => { if (!chapter.scenes.length) chapter.scenes.push(normalizeScene({}, chapterIndex)); });
  return normalized;
}
module.exports = { DEFAULT_PROJECT, clone, normalizeProject };
