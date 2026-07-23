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
        if (block.type === 'dialogue' && block.avatar === relativePath) { delete block.avatar; referenceCount += 1; }
        if (block.type === 'dialogue' && block.portrait === relativePath) { delete block.portrait; referenceCount += 1; }
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
        (block?.images || []).forEach((image) => add(image?.relativePath));
      });
    }));
    (project?.characters || []).forEach((character) => ['avatarGroup', 'portraitGroup', 'portraits'].forEach((groupName) => (character?.[groupName] || []).forEach((item) => add(typeof item === 'string' ? item : item?.relativePath))));
    return [...references];
  }

  return { collectAssetReferences, removeAssetReferences };
}));
