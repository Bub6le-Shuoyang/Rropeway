(function exposeStoryFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayStoryFlow = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function flattenProjectScenes(chapters) {
    const scenes = [];
    (Array.isArray(chapters) ? chapters : []).forEach((chapter, chapterIndex) => {
      (Array.isArray(chapter?.scenes) ? chapter.scenes : []).forEach((scene, sceneIndex) => {
        scenes.push({
          id: String(scene?.id || ''),
          scene,
          sceneIndex,
          chapter,
          chapterIndex
        });
      });
    });
    return scenes.filter((item) => item.id);
  }

  function defaultSceneTransitions(chapters) {
    const scenes = flattenProjectScenes(chapters);
    return scenes.slice(0, -1).map((item, index) => ({ sourceSceneId: item.id, targetSceneId: scenes[index + 1].id }));
  }

  function nextSequentialSceneLocation(chapters, chapterIndex, sceneIndex, sameChapterOnly = false) {
    const source = Array.isArray(chapters) ? chapters : [];
    const chapter = source[chapterIndex];
    if (Array.isArray(chapter?.scenes) && chapter.scenes[sceneIndex + 1]) return { chapterIndex, sceneIndex: sceneIndex + 1 };
    if (sameChapterOnly) return null;
    for (let nextChapterIndex = chapterIndex + 1; nextChapterIndex < source.length; nextChapterIndex += 1) {
      if (Array.isArray(source[nextChapterIndex]?.scenes) && source[nextChapterIndex].scenes.length) {
        return { chapterIndex: nextChapterIndex, sceneIndex: 0 };
      }
    }
    return null;
  }

  function normalizeSceneFlow(input, chapters) {
    const value = input && typeof input === 'object' ? input : {};
    const scenes = flattenProjectScenes(chapters);
    const sceneIds = new Set(scenes.map((item) => item.id));
    const finiteNumber = (number, fallback) => Number.isFinite(Number(number)) ? Number(number) : fallback;
    const positions = {};
    Object.entries(value.positions && typeof value.positions === 'object' ? value.positions : {}).forEach(([sceneId, position]) => {
      if (!sceneIds.has(sceneId)) return;
      positions[sceneId] = { x: finiteNumber(position?.x, 0.5), y: finiteNumber(position?.y, 0.5) };
    });
    const sourceTransitions = Array.isArray(value.transitions) ? value.transitions : defaultSceneTransitions(chapters);
    const seenSources = new Set();
    const transitions = sourceTransitions.map((transition) => ({
      sourceSceneId: String(transition?.sourceSceneId || ''),
      targetSceneId: String(transition?.targetSceneId || '')
    })).filter((transition) => {
      if (!sceneIds.has(transition.sourceSceneId) || !sceneIds.has(transition.targetSceneId) || transition.sourceSceneId === transition.targetSceneId || seenSources.has(transition.sourceSceneId)) return false;
      seenSources.add(transition.sourceSceneId);
      return true;
    });
    const viewportValue = value.viewport && typeof value.viewport === 'object' ? value.viewport : {};
    return {
      positions,
      transitions,
      startSceneId: sceneIds.has(String(value.startSceneId || '')) ? String(value.startSceneId) : scenes[0]?.id || '',
      viewport: {
        centerX: finiteNumber(viewportValue.centerX, 0.5),
        centerY: finiteNumber(viewportValue.centerY, 0.5),
        zoom: Math.min(2.2, Math.max(0.35, finiteNumber(viewportValue.zoom, 1)))
      }
    };
  }

  return { defaultSceneTransitions, flattenProjectScenes, nextSequentialSceneLocation, normalizeSceneFlow };
}));
