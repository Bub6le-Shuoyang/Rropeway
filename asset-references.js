(function exposeAssetReferences(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayAssetReferences = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function removeAssetReferences(project, relativePath) {
    if (!project || !relativePath) return 0;
    let referenceCount = 0;
    (project.chapters || []).forEach((chapter) => (chapter.scenes || []).forEach((scene) => {
      if (scene.background === relativePath) { scene.background = ''; referenceCount += 1; }
      (scene.blocks || []).forEach((block) => {
        if (block.type === 'dialogue' && block.portrait === relativePath) { delete block.portrait; referenceCount += 1; }
        if (block.type === 'segment' && Array.isArray(block.images)) {
          const remaining = block.images.filter((image) => image.relativePath !== relativePath);
          referenceCount += block.images.length - remaining.length;
          block.images = remaining;
        }
      });
    }));
    (project.characters || []).forEach((character) => {
      if (!Array.isArray(character.portraits)) return;
      const remaining = character.portraits.filter((portrait) => (typeof portrait === 'string' ? portrait : portrait?.relativePath) !== relativePath);
      referenceCount += character.portraits.length - remaining.length;
      character.portraits = remaining;
    });
    return referenceCount;
  }

  return { removeAssetReferences };
}));
