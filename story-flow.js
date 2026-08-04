(function exposeStoryFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayStoryFlow = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function flattenProjectScenes(chapters) {
    const scenes = [];
    (Array.isArray(chapters) ? chapters : []).forEach((chapter, chapterIndex) => {
      (Array.isArray(chapter?.scenes) ? chapter.scenes : []).forEach((scene, sceneIndex) => {
        const branch = scene?.kind === 'branch'
          ? (Array.isArray(chapter?.branches) ? chapter.branches.find((item) => String(item?.id || '') === String(scene?.branchId || '')) : null)
          : null;
        scenes.push({
          id: String(scene?.id || ''),
          scene,
          sceneIndex,
          chapter,
          chapterIndex,
          branch
        });
      });
    });
    return scenes.filter((item) => item.id);
  }

  function isBranchScene(scene) {
    return scene?.kind === 'branch';
  }

  function branchForScene(chapter, scene) {
    if (!isBranchScene(scene)) return null;
    return (Array.isArray(chapter?.branches) ? chapter.branches : []).find((branch) => String(branch?.id || '') === String(scene?.branchId || '')) || null;
  }

  function isSceneIncludedInFlow(scene, chapter = null) {
    if (!isBranchScene(scene)) return true;
    const branch = branchForScene(chapter, scene);
    return branch ? branch.includeInFlow === true : scene.includeInFlow === true;
  }

  function flattenFlowScenes(chapters) {
    return flattenProjectScenes(chapters).filter((item) => isSceneIncludedInFlow(item.scene, item.chapter));
  }

  function flattenProjectBranches(chapters) {
    const result = [];
    (Array.isArray(chapters) ? chapters : []).forEach((chapter, chapterIndex) => {
      const sceneItems = flattenProjectScenes([chapter]).map((item) => ({ ...item, chapterIndex }));
      const groupedSceneIds = new Set();
      (Array.isArray(chapter?.branches) ? chapter.branches : []).forEach((branch, branchIndex) => {
        const scenes = sceneItems.filter((item) => item.scene.kind === 'branch' && String(item.scene.branchId || '') === String(branch?.id || ''));
        if (!scenes.length) return;
        scenes.forEach((item) => groupedSceneIds.add(item.id));
        result.push({ id: String(branch.id), branch, branchIndex, chapter, chapterIndex, scenes });
      });
      sceneItems.filter((item) => item.scene.kind === 'branch' && !groupedSceneIds.has(item.id)).forEach((item, legacyIndex) => {
        const branch = { id: String(item.scene.branchId || `branch-${item.id}`), title: String(item.scene.branchTitle || item.scene.title || `未命名支线 ${legacyIndex + 1}`), trigger: String(item.scene.branchTrigger || ''), includeInFlow: item.scene.includeInFlow === true };
        result.push({ id: branch.id, branch, branchIndex: result.length, chapter, chapterIndex, scenes: [item] });
      });
    });
    return result;
  }

  function defaultSceneTransitions(chapters) {
    const scenes = flattenFlowScenes(chapters);
    return scenes.slice(0, -1).map((item, index) => ({ sourceSceneId: item.id, targetSceneId: scenes[index + 1].id }));
  }

  function nextSequentialSceneLocation(chapters, chapterIndex, sceneIndex, sameChapterOnly = false, includeBranches = false) {
    const source = Array.isArray(chapters) ? chapters : [];
    const chapter = source[chapterIndex];
    if (Array.isArray(chapter?.scenes)) {
      for (let nextSceneIndex = sceneIndex + 1; nextSceneIndex < chapter.scenes.length; nextSceneIndex += 1) {
        if (includeBranches || !isBranchScene(chapter.scenes[nextSceneIndex])) return { chapterIndex, sceneIndex: nextSceneIndex };
      }
    }
    if (sameChapterOnly) return null;
    for (let nextChapterIndex = chapterIndex + 1; nextChapterIndex < source.length; nextChapterIndex += 1) {
      const scenes = Array.isArray(source[nextChapterIndex]?.scenes) ? source[nextChapterIndex].scenes : [];
      for (let nextSceneIndex = 0; nextSceneIndex < scenes.length; nextSceneIndex += 1) {
        if (includeBranches || !isBranchScene(scenes[nextSceneIndex])) return { chapterIndex: nextChapterIndex, sceneIndex: nextSceneIndex };
      }
    }
    return null;
  }

  function normalizeSceneFlow(input, chapters) {
    const value = input && typeof input === 'object' ? input : {};
    const scenes = flattenFlowScenes(chapters);
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

  return { branchForScene, defaultSceneTransitions, flattenFlowScenes, flattenProjectBranches, flattenProjectScenes, isBranchScene, isSceneIncludedInFlow, nextSequentialSceneLocation, normalizeSceneFlow };
}));
