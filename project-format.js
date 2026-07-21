const DEFAULT_PROJECT = {
  format: 'scriptroom-project',
  version: 1,
  title: 'Rropeway',
  chapters: [{
    id: 'chapter-1', title: '第一章', status: '草稿',
    scenes: [{ id: 'scene-1', number: '01', title: '未命名场景', blocks: [] }]
  }],
  characters: [],
  assets: [],
  updatedAt: new Date().toISOString()
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeBlock(block) {
  const value = block && typeof block === 'object' ? block : {};
  if (value.type === 'choice') return { type: 'choice', title: String(value.title || ''), options: Array.isArray(value.options) ? value.options.map(String) : [] };
  if (value.type === 'narration') return { type: 'narration', text: String(value.text || '') };
  if (value.type === 'segment') return { type: 'segment', title: String(value.title || '未命名分段'), perspectiveCharacterId: value.perspectiveCharacterId ? String(value.perspectiveCharacterId) : null };
  const legacyStatusTag = String(value.statusTag ?? value.emotion ?? '').trim();
  const statusTags = (Array.isArray(value.statusTags) ? value.statusTags : legacyStatusTag ? [legacyStatusTag] : []).map((tag) => String(tag).trim()).filter((tag, index, tags) => tag && tags.indexOf(tag) === index);
  return { type: 'dialogue', character: String(value.character || '未命名角色'), characterId: value.characterId ? String(value.characterId) : '', characterKey: value.characterKey === 'yan' ? 'yan' : 'mei', characterColor: String(value.characterColor || '#f2674f'), portraitPreset: value.portraitPreset ? String(value.portraitPreset) : null, statusTags, voice: String(value.voice || ''), text: String(value.text || ''), note: String(value.note || ''), portrait: value.portrait ? String(value.portrait) : undefined };
}
function normalizeCharacter(character, index) {
  const value = character && typeof character === 'object' ? character : {};
  return {
    id: String(value.id || `character-${Date.now()}-${index}`),
    name: String(value.name || `未命名角色 ${index + 1}`),
    role: String(value.role || ''),
    description: String(value.description || ''),
    color: /^#[0-9a-f]{6}$/i.test(value.color || '') ? value.color : '#f2674f',
    portraitPreset: ['tall-male', 'short-male', 'tall-female', 'short-female'].includes(value.portraitPreset) ? value.portraitPreset : null,
    portraits: Array.isArray(value.portraits) ? value.portraits : []
  };
}
function normalizeScene(scene, index) {
  const value = scene && typeof scene === 'object' ? scene : {};
  return { id: String(value.id || `scene-${Date.now()}-${index}`), number: String(value.number || String(index + 1).padStart(2, '0')), title: String(value.title || `未命名场景 ${index + 1}`), background: value.background ? String(value.background) : '', blocks: Array.isArray(value.blocks) ? value.blocks.map(normalizeBlock) : [] };
}
function normalizeProject(input) {
  const value = input && typeof input === 'object' ? input : {};
  const chapters = Array.isArray(value.chapters) ? value.chapters : [];
  const normalized = {
    format: 'scriptroom-project', version: 1, title: String(value.title || 'Rropeway'),
    chapters: chapters.map((chapter, chapterIndex) => ({ id: String(chapter?.id || `chapter-${Date.now()}-${chapterIndex}`), title: String(chapter?.title || `第 ${chapterIndex + 1} 章`), status: String(chapter?.status || '草稿'), scenes: Array.isArray(chapter?.scenes) ? chapter.scenes.map(normalizeScene) : [] })),
    characters: Array.isArray(value.characters) ? value.characters.map(normalizeCharacter) : [],
    assets: Array.isArray(value.assets) ? value.assets.map((asset) => ({ id: String(asset?.id || `asset-${Date.now()}`), name: String(asset?.name || '未命名素材'), fileName: String(asset?.fileName || ''), relativePath: String(asset?.relativePath || asset?.fileName || ''), type: String(asset?.type || '') })) : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
  if (!normalized.chapters.length) normalized.chapters.push({ id: `chapter-${Date.now()}`, title: '第一章', status: '草稿', scenes: [] });
  normalized.chapters.forEach((chapter, chapterIndex) => { if (!chapter.scenes.length) chapter.scenes.push(normalizeScene({}, chapterIndex)); });
  return normalized;
}
module.exports = { DEFAULT_PROJECT, clone, normalizeProject };
