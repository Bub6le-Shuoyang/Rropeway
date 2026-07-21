const DEFAULT_PROJECT = {
  format: 'scriptroom-project',
  version: 1,
  title: '未命名项目',
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
  return { type: 'dialogue', character: String(value.character || '未命名角色'), characterKey: value.characterKey === 'yan' ? 'yan' : 'mei', emotion: String(value.emotion || ''), voice: String(value.voice || ''), text: String(value.text || ''), note: String(value.note || ''), portrait: value.portrait ? String(value.portrait) : undefined };
}
function normalizeScene(scene, index) {
  const value = scene && typeof scene === 'object' ? scene : {};
  return { id: String(value.id || `scene-${Date.now()}-${index}`), number: String(value.number || String(index + 1).padStart(2, '0')), title: String(value.title || `未命名场景 ${index + 1}`), background: value.background ? String(value.background) : '', blocks: Array.isArray(value.blocks) ? value.blocks.map(normalizeBlock) : [] };
}
function normalizeProject(input) {
  const value = input && typeof input === 'object' ? input : {};
  const chapters = Array.isArray(value.chapters) ? value.chapters : [];
  const normalized = {
    format: 'scriptroom-project', version: 1, title: String(value.title || '未命名项目'),
    chapters: chapters.map((chapter, chapterIndex) => ({ id: String(chapter?.id || `chapter-${Date.now()}-${chapterIndex}`), title: String(chapter?.title || `第 ${chapterIndex + 1} 章`), status: String(chapter?.status || '草稿'), scenes: Array.isArray(chapter?.scenes) ? chapter.scenes.map(normalizeScene) : [] })),
    characters: Array.isArray(value.characters) ? value.characters : [],
    assets: Array.isArray(value.assets) ? value.assets.map((asset) => ({ id: String(asset?.id || `asset-${Date.now()}`), name: String(asset?.name || '未命名素材'), fileName: String(asset?.fileName || ''), relativePath: String(asset?.relativePath || asset?.fileName || ''), type: String(asset?.type || '') })) : [],
    updatedAt: value.updatedAt || new Date().toISOString()
  };
  if (!normalized.chapters.length) normalized.chapters.push({ id: `chapter-${Date.now()}`, title: '第一章', status: '草稿', scenes: [] });
  normalized.chapters.forEach((chapter, chapterIndex) => { if (!chapter.scenes.length) chapter.scenes.push(normalizeScene({}, chapterIndex)); });
  return normalized;
}
module.exports = { DEFAULT_PROJECT, clone, normalizeProject };