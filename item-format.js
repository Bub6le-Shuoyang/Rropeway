(function exposeItemFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayItemFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function uniqueTags(tags) {
    const source = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,，]/) : [];
    return source.map((tag) => String(tag).trim()).filter((tag, index, values) => tag && values.indexOf(tag) === index);
  }

  function normalizeItemImage(image, index = 0) {
    const value = image && typeof image === 'object' ? image : {};
    const relativePath = String(value.relativePath || value.fileName || '').replaceAll('\\', '/');
    if (!relativePath) return null;
    const fileName = relativePath.split('/').pop() || `item-image-${index + 1}`;
    return {
      id: String(value.id || `item-image-${Date.now()}-${index}`),
      name: String(value.name || value.originalName || fileName.replace(/\.[^.]+$/, '') || `物品图片 ${index + 1}`),
      originalName: String(value.originalName || value.name || fileName),
      relativePath,
      type: String(value.type || fileName.split('.').pop() || '').toLowerCase()
    };
  }

  function normalizeItem(item, index = 0) {
    const value = item && typeof item === 'object' ? item : {};
    const images = (Array.isArray(value.images) ? value.images : []).map(normalizeItemImage).filter(Boolean);
    const requestedCover = String(value.coverImageId || '');
    return {
      id: String(value.id || `item-${Date.now()}-${index}`),
      name: String(value.name || `未命名物品 ${index + 1}`),
      tags: uniqueTags(value.tags),
      summary: String(value.summary || ''),
      effect: String(value.effect || ''),
      notes: String(value.notes || ''),
      images,
      coverImageId: images.some((image) => image.id === requestedCover) ? requestedCover : images[0]?.id || ''
    };
  }

  function normalizeItemDialogue(dialogue, index = 0) {
    const value = dialogue && typeof dialogue === 'object' ? dialogue : {};
    const legacyStatusTag = String(value.statusTag ?? value.emotion ?? '').trim();
    const statusTags = uniqueTags(Array.isArray(value.statusTags) ? value.statusTags : legacyStatusTag ? [legacyStatusTag] : [])
      .sort((left, right) => Number(right === '关键节点') - Number(left === '关键节点'));
    return {
      id: String(value.id || `item-dialogue-${Date.now()}-${index}`),
      type: 'dialogue',
      character: String(value.character || ''),
      characterId: String(value.characterId || ''),
      characterKey: value.characterKey === 'yan' ? 'yan' : 'mei',
      characterColor: String(value.characterColor || '#b8bcb8'),
      portraitPreset: value.portraitPreset ? String(value.portraitPreset) : null,
      statusTags,
      voice: String(value.voice || ''),
      text: String(value.text || ''),
      textHtml: String(value.textHtml || ''),
      textAlign: ['left', 'center', 'right'].includes(value.textAlign) ? value.textAlign : 'left',
      note: String(value.note || ''),
      avatar: value.avatar ? String(value.avatar) : undefined,
      portrait: value.portrait ? String(value.portrait) : undefined
    };
  }

  function normalizeItemBlock(block, index = 0, idFactory = null) {
    const value = block && typeof block === 'object' ? block : {};
    const investigationValue = value.investigation && typeof value.investigation === 'object' ? value.investigation : {};
    const dialogueSource = Array.isArray(value.dialogues) ? value.dialogues : Array.isArray(value.reactions) ? value.reactions : [];
    return {
      id: String(value.id || (idFactory ? idFactory('item', index) : `item-block-${Date.now()}-${index}`)),
      type: 'item',
      itemId: String(value.itemId || ''),
      investigation: { text: String(investigationValue.text || value.investigationText || value.reactionText || '') },
      dialogues: dialogueSource.map(normalizeItemDialogue)
    };
  }

  function matchesItem(item, query, tag = '') {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const normalizedTag = String(tag || '').trim();
    if (normalizedTag === '__uncategorized__' && item.tags?.length) return false;
    if (normalizedTag && normalizedTag !== '__uncategorized__' && !item.tags?.includes(normalizedTag)) return false;
    if (!normalizedQuery) return true;
    return [item.name, item.summary, item.effect, item.notes, ...(item.tags || [])]
      .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
  }

  return { matchesItem, normalizeItem, normalizeItemBlock, normalizeItemDialogue, normalizeItemImage, uniqueTags };
}));
