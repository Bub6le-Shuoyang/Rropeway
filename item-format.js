(function exposeItemFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayItemFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  let generatedIdCounter = 0;
  function generatedLocalId(prefix, index = 0) {
    generatedIdCounter += 1;
    return `${prefix}-${Date.now()}-${index}-${generatedIdCounter}`;
  }

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
      id: String(value.id || generatedLocalId('item-image', index)),
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
      id: String(value.id || generatedLocalId('item', index)),
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
      id: String(value.id || generatedLocalId('item-dialogue', index)),
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

  function normalizeChoiceOption(option, index = 0) {
    const value = option && typeof option === 'object' ? option : { text: option };
    return {
      id: String(value.id || generatedLocalId('item-choice-option', index)),
      text: String(value.text || ''),
      targetBlockId: value.targetBlockId ? String(value.targetBlockId) : ''
    };
  }

  function normalizeSegmentImage(image, index = 0) {
    const value = image && typeof image === 'object' ? image : {};
    const relativePath = String(value.relativePath || '').replaceAll('\\', '/');
    if (!relativePath) return null;
    return {
      id: String(value.id || generatedLocalId('item-segment-image', index)),
      assetId: value.assetId ? String(value.assetId) : '',
      name: String(value.name || '未命名图片'),
      relativePath
    };
  }

  function normalizeItemContentBlock(block, index = 0) {
    const value = block && typeof block === 'object' ? block : {};
    if (value.type === 'item') return normalizeItemBlock(value, index);
    if (value.type === 'narration') {
      return { id: String(value.id || generatedLocalId('item-narration', index)), type: 'narration', text: String(value.text || '') };
    }
    if (value.type === 'segment') {
      return {
        id: String(value.id || generatedLocalId('item-segment', index)),
        type: 'segment',
        title: String(value.title || '未命名分段'),
        perspectiveCharacterId: value.perspectiveCharacterId ? String(value.perspectiveCharacterId) : null,
        images: (Array.isArray(value.images) ? value.images : []).map(normalizeSegmentImage).filter(Boolean)
      };
    }
    if (value.type === 'choice') {
      return {
        id: String(value.id || generatedLocalId('item-choice', index)),
        type: 'choice',
        title: String(value.title || ''),
        options: (Array.isArray(value.options) ? value.options : []).map(normalizeChoiceOption)
      };
    }
    return normalizeItemDialogue(value, index);
  }

  function normalizeItemBlock(block, index = 0, idFactory = null) {
    const value = block && typeof block === 'object' ? block : {};
    const investigationValue = value.investigation && typeof value.investigation === 'object' ? value.investigation : {};
    const legacyDialogues = Array.isArray(value.dialogues) ? value.dialogues : Array.isArray(value.reactions) ? value.reactions : [];
    const contentSource = Array.isArray(value.blocks) ? value.blocks : legacyDialogues;
    return {
      id: String(value.id || (idFactory ? idFactory('item', index) : generatedLocalId('item-block', index))),
      type: 'item',
      itemId: String(value.itemId || ''),
      investigation: { text: String(investigationValue.text || value.investigationText || value.reactionText || '') },
      blocks: contentSource.map(normalizeItemContentBlock)
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

  function walkItemContent(itemBlock, visitor, parentPath = []) {
    (itemBlock?.blocks || []).forEach((contentBlock, index) => {
      const path = [...parentPath, index];
      visitor(contentBlock, path, itemBlock);
      if (contentBlock?.type === 'item') walkItemContent(contentBlock, visitor, path);
    });
  }

  return { matchesItem, normalizeItem, normalizeItemBlock, normalizeItemContentBlock, normalizeItemDialogue, normalizeItemImage, uniqueTags, walkItemContent };
}));
