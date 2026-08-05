(function exposeAssetReferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayAssetReferences = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function walkItemContent(itemBlock, visitor) {
    (itemBlock?.blocks || []).forEach((contentBlock) => {
      visitor(contentBlock);
      if (contentBlock?.type === 'item') walkItemContent(contentBlock, visitor);
    });
  }

  function removeAssetReferences(project, relativePath) {
    if (!project || !relativePath) return 0;
    let referenceCount = 0;
    (project.chapters || []).forEach((chapter) => (chapter.scenes || []).forEach((scene) => {
      if (scene.background === relativePath) { scene.background = ''; referenceCount += 1; }
      (scene.blocks || []).forEach((block) => {
        if (block.type === 'dialogue' && block.avatar === relativePath) { delete block.avatar; referenceCount += 1; }
        if (block.type === 'dialogue' && block.portrait === relativePath) { delete block.portrait; referenceCount += 1; }
        if (block.type === 'item') walkItemContent(block, (contentBlock) => {
          if (contentBlock.avatar === relativePath) { delete contentBlock.avatar; referenceCount += 1; }
          if (contentBlock.portrait === relativePath) { delete contentBlock.portrait; referenceCount += 1; }
          if (contentBlock.type === 'segment' && Array.isArray(contentBlock.images)) {
            const remaining = contentBlock.images.filter((image) => image.relativePath !== relativePath);
            referenceCount += contentBlock.images.length - remaining.length;
            contentBlock.images = remaining;
          }
        });
        if (block.type === 'segment' && Array.isArray(block.images)) {
          const remaining = block.images.filter((image) => image.relativePath !== relativePath);
          referenceCount += block.images.length - remaining.length;
          block.images = remaining;
        }
      });
    }));
    (project.characters || []).forEach((character) => {
      ['avatarGroup', 'portraitGroup', 'portraits'].forEach((groupName) => {
        if (!Array.isArray(character[groupName])) return;
        const remaining = character[groupName].filter((item) => (typeof item === 'string' ? item : item?.relativePath) !== relativePath);
        referenceCount += character[groupName].length - remaining.length;
        character[groupName] = remaining;
      });
    });
    (project.items || []).forEach((item) => {
      if (!Array.isArray(item.images)) return;
      const remaining = item.images.filter((image) => image?.relativePath !== relativePath);
      const removedIds = new Set(item.images.filter((image) => image?.relativePath === relativePath).map((image) => image.id));
      referenceCount += item.images.length - remaining.length;
      item.images = remaining;
      if (removedIds.has(item.coverImageId)) item.coverImageId = remaining[0]?.id || '';
    });
    return referenceCount;
  }

  function collectAssetReferences(project) {
    const references = new Set();
    const add = (relativePath) => {
      const normalized = String(relativePath || '').replaceAll('\\', '/');
      if (normalized.startsWith('assets/')) references.add(normalized);
    };
    (project?.assets || []).forEach((asset) => add(asset?.relativePath || asset?.fileName));
    (project?.chapters || []).forEach((chapter) => (chapter.scenes || []).forEach((scene) => {
      add(scene?.background);
      (scene?.blocks || []).forEach((block) => {
        add(block?.portrait);
        add(block?.avatar);
        if (block?.type === 'item') walkItemContent(block, (contentBlock) => { add(contentBlock?.portrait); add(contentBlock?.avatar); (contentBlock?.images || []).forEach((image) => add(image?.relativePath)); });
        (block?.images || []).forEach((image) => add(image?.relativePath));
      });
    }));
    (project?.characters || []).forEach((character) => ['avatarGroup', 'portraitGroup', 'portraits'].forEach((groupName) => (character?.[groupName] || []).forEach((item) => add(typeof item === 'string' ? item : item?.relativePath))));
    (project?.items || []).forEach((item) => (item?.images || []).forEach((image) => add(image?.relativePath)));
    return [...references];
  }

  return { collectAssetReferences, removeAssetReferences };
}));
