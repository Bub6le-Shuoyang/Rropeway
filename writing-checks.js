(function exposeWritingChecks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayWritingChecks = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const LONG_DIALOGUE_LENGTH = 90;

  function plainText(value) {
    return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function walkItemContent(itemBlock, visitor, parentPath = []) {
    (itemBlock?.blocks || []).forEach((contentBlock, index) => {
      const path = [...parentPath, index];
      visitor(contentBlock, path);
      if (contentBlock?.type === 'item') walkItemContent(contentBlock, visitor, path);
    });
  }

  function emptyWritingMetrics() {
    return {
      blocks: 0,
      words: 0,
      dialogues: 0,
      narrations: 0,
      choices: 0,
      choiceOptions: 0,
      segments: 0,
      items: 0,
      images: 0,
      criticalNodes: 0,
      characterIds: new Set()
    };
  }

  function countWritingCharacters(value) {
    return plainText(value).replace(/\s/g, '').length;
  }

  function addBlockToWritingMetrics(metrics, block) {
    if (!block || typeof block !== 'object') return;
    metrics.blocks += 1;
    if (block.type === 'dialogue') {
      metrics.dialogues += 1;
      metrics.words += countWritingCharacters(block.textHtml || block.text);
      const characterKey = String(block.characterId || block.character || '').trim();
      if (characterKey) metrics.characterIds.add(characterKey);
      if ((block.statusTags || []).includes('关键节点')) metrics.criticalNodes += 1;
    } else if (block.type === 'narration') {
      metrics.narrations += 1;
      metrics.words += countWritingCharacters(block.textHtml || block.text);
    } else if (block.type === 'choice') {
      metrics.choices += 1;
      metrics.words += countWritingCharacters(block.title || block.text);
      (block.options || []).forEach((option) => {
        const value = typeof option === 'string' ? { text: option } : option || {};
        metrics.choiceOptions += 1;
        metrics.words += countWritingCharacters(value.text);
      });
    } else if (block.type === 'segment') {
      metrics.segments += 1;
      metrics.words += countWritingCharacters(block.title || block.text);
      metrics.images += Array.isArray(block.images) ? block.images.length : 0;
    } else if (block.type === 'item') {
      metrics.items += 1;
      metrics.words += countWritingCharacters(block.investigation?.text || block.investigationText);
      (block.blocks || []).forEach((child) => addBlockToWritingMetrics(metrics, child));
    }
  }

  function finalizeWritingMetrics(metrics) {
    return {
      blocks: metrics.blocks,
      words: metrics.words,
      dialogues: metrics.dialogues,
      narrations: metrics.narrations,
      choices: metrics.choices,
      choiceOptions: metrics.choiceOptions,
      segments: metrics.segments,
      items: metrics.items,
      images: metrics.images,
      criticalNodes: metrics.criticalNodes,
      characters: metrics.characterIds.size
    };
  }

  function mergeWritingMetrics(target, source) {
    ['blocks', 'words', 'dialogues', 'narrations', 'choices', 'choiceOptions', 'segments', 'items', 'images', 'criticalNodes'].forEach((key) => { target[key] += source[key]; });
    source.characterIds.forEach((characterId) => target.characterIds.add(characterId));
  }

  function collectWritingStatistics(project, issues = []) {
    const totalMetrics = emptyWritingMetrics();
    const issueCountsByScene = new Map();
    (issues || []).forEach((issue) => {
      const location = issue?.location || {};
      if (location.view !== 'editor' || !Number.isInteger(location.chapterIndex) || !Number.isInteger(location.sceneIndex)) return;
      const key = `${location.chapterIndex}:${location.sceneIndex}`;
      if (!issueCountsByScene.has(key)) issueCountsByScene.set(key, { total: 0, errors: 0, warnings: 0 });
      const counts = issueCountsByScene.get(key);
      counts.total += 1;
      if (issue.severity === 'error') counts.errors += 1;
      else counts.warnings += 1;
    });
    const chapters = (project?.chapters || []).map((chapter, chapterIndex) => {
      const chapterMetrics = emptyWritingMetrics();
      const scenes = (chapter.scenes || []).map((scene, sceneIndex) => {
        const sceneMetrics = emptyWritingMetrics();
        if (scene.background) sceneMetrics.images += 1;
        (scene.blocks || []).forEach((block) => addBlockToWritingMetrics(sceneMetrics, block));
        mergeWritingMetrics(chapterMetrics, sceneMetrics);
        mergeWritingMetrics(totalMetrics, sceneMetrics);
        return {
          id: scene.id,
          title: scene.title || `场景 ${sceneIndex + 1}`,
          number: scene.number || '',
          chapterIndex,
          sceneIndex,
          branchId: scene.branchId || '',
          isBranch: Boolean(scene.branchId),
          metrics: finalizeWritingMetrics(sceneMetrics),
          issues: issueCountsByScene.get(`${chapterIndex}:${sceneIndex}`) || { total: 0, errors: 0, warnings: 0 }
        };
      });
      return {
        id: chapter.id,
        title: chapter.title || `第 ${chapterIndex + 1} 章`,
        chapterIndex,
        sceneCount: scenes.length,
        metrics: finalizeWritingMetrics(chapterMetrics),
        scenes
      };
    });
    const issueTotals = (issues || []).reduce((counts, issue) => {
      counts.total += 1;
      if (issue?.severity === 'error') counts.errors += 1;
      else counts.warnings += 1;
      return counts;
    }, { total: 0, errors: 0, warnings: 0 });
    return {
      totals: { ...finalizeWritingMetrics(totalMetrics), chapters: chapters.length, scenes: chapters.reduce((count, chapter) => count + chapter.sceneCount, 0), issues: issueTotals },
      chapters
    };
  }

  function collectWritingIssues(project) {
    const issues = [];
    const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
    const characters = Array.isArray(project?.characters) ? project.characters : [];
    const characterById = new Map(characters.map((character) => [character.id, character]));
    const characterByName = new Map(characters.map((character) => [character.name, character]));
    const knownAssetPaths = new Set();
    (project?.assets || []).forEach((asset) => { if (asset?.relativePath || asset?.fileName) knownAssetPaths.add(String(asset.relativePath || asset.fileName)); });
    characters.forEach((character) => {
      [...(character.avatarGroup || []), ...(character.portraitGroup || [])].forEach((media) => { if (media?.relativePath) knownAssetPaths.add(String(media.relativePath)); });
    });
    (project?.items || []).forEach((item) => (item.images || []).forEach((image) => { if (image?.relativePath) knownAssetPaths.add(String(image.relativePath)); }));
    const criticalNodes = [];
    const assetReferences = [];
    let issueCounter = 0;
    const addIssue = (issue) => issues.push({ id: `writing-issue-${++issueCounter}`, ...issue });
    const addAssetReference = (relativePath, label, location) => {
      if (!relativePath) return;
      const path = String(relativePath);
      assetReferences.push({ relativePath: path, label, location });
      if (!knownAssetPaths.has(path)) addIssue({ severity: 'error', category: '失效素材', title: `${label}引用未登记`, detail: path, location });
    };
    const inspectDialogue = (block, location, chapter, scene) => {
      const text = plainText(block.textHtml || block.text);
      if (!text) addIssue({ severity: 'error', category: '空对白', title: '对白内容为空', detail: `${chapter.title} / ${scene.title}`, location });
      if (!block.characterId && !String(block.character || '').trim()) addIssue({ severity: 'warning', category: '未设置角色', title: '对白没有设置角色', detail: text.slice(0, 36) || `${chapter.title} / ${scene.title}`, location });
      if (text.length > LONG_DIALOGUE_LENGTH) addIssue({ severity: 'warning', category: '对白过长', title: `对白长度为 ${text.length} 字`, detail: `${text.slice(0, 42)}…`, location });
      const character = characterById.get(block.characterId) || characterByName.get(block.character);
      if (character && !block.portrait && !block.portraitPreset && !(character.portraitGroup || []).length && !character.portraitPreset) addIssue({ severity: 'warning', category: '缺少立绘', title: `${character.name} 没有可用立绘`, detail: `${chapter.title} / ${scene.title}`, location });
      addAssetReference(block.avatar, '对白头像', location);
      addAssetReference(block.portrait, '对白立绘', location);
      if ((block.statusTags || []).includes('关键节点')) criticalNodes.push({ id: String(block.id || ''), text, location, chapterTitle: chapter.title, sceneTitle: scene.title });
    };

    chapters.forEach((chapter, chapterIndex) => {
      (chapter.scenes || []).forEach((scene, sceneIndex) => {
        const sceneLocation = { view: 'editor', chapterIndex, sceneIndex, blockIndex: 0 };
        addAssetReference(scene.background, '场景背景', sceneLocation);
        (scene.blocks || []).forEach((block, blockIndex) => {
          const location = { view: 'editor', chapterIndex, sceneIndex, blockIndex };
          if (block.type === 'dialogue') inspectDialogue(block, location, chapter, scene);
          if (block.type === 'item') walkItemContent(block, (contentBlock, itemContentPath) => {
            const contentLocation = { ...location, itemDialogueId: contentBlock.id, itemContentPath };
            if (contentBlock.type === 'dialogue') inspectDialogue(contentBlock, contentLocation, chapter, scene);
            if (contentBlock.type === 'segment') (contentBlock.images || []).forEach((image) => addAssetReference(image.relativePath, '物品分段图片', contentLocation));
          });
          if (block.type === 'segment') (block.images || []).forEach((image) => addAssetReference(image.relativePath, '分段图片', location));
        });
      });
    });

    const criticalIds = new Set(criticalNodes.map((node) => node.id).filter(Boolean));
    chapters.forEach((chapter, chapterIndex) => {
      (chapter.scenes || []).forEach((scene, sceneIndex) => {
        (scene.blocks || []).forEach((block, blockIndex) => {
          const location = { view: 'editor', chapterIndex, sceneIndex, blockIndex };
          const choices = block.type === 'choice' ? [{ block, location }] : [];
          if (block.type === 'item') walkItemContent(block, (contentBlock, itemContentPath) => {
            if (contentBlock.type === 'choice') choices.push({ block: contentBlock, location: { ...location, itemDialogueId: contentBlock.id, itemContentPath } });
          });
          choices.forEach(({ block: choice, location: choiceLocation }) => (choice.options || []).forEach((option, optionIndex) => {
            const value = typeof option === 'string' ? { text: option, targetBlockId: '' } : option || {};
            if (!plainText(value.text)) addIssue({ severity: 'error', category: '未关联选项', title: `选项 ${optionIndex + 1} 内容为空`, detail: `${chapter.title} / ${scene.title}`, location: choiceLocation });
            if (!value.targetBlockId) addIssue({ severity: 'warning', category: '未关联选项', title: `“${plainText(value.text) || `选项 ${optionIndex + 1}`}”未关联关键节点`, detail: `${chapter.title} / ${scene.title}`, location: choiceLocation });
            else if (!criticalIds.has(String(value.targetBlockId))) addIssue({ severity: 'error', category: '未关联选项', title: `“${plainText(value.text) || `选项 ${optionIndex + 1}`}”的目标已失效`, detail: String(value.targetBlockId), location: choiceLocation });
          }));
        });
      });
    });

    const duplicateNodeGroups = new Map();
    criticalNodes.forEach((node) => {
      const key = node.text.toLocaleLowerCase();
      if (!key) return;
      if (!duplicateNodeGroups.has(key)) duplicateNodeGroups.set(key, []);
      duplicateNodeGroups.get(key).push(node);
    });
    duplicateNodeGroups.forEach((nodes) => {
      if (nodes.length < 2) return;
      nodes.slice(1).forEach((node) => addIssue({ severity: 'warning', category: '重复关键节点', title: `关键节点“${node.text.slice(0, 32)}”重复`, detail: `首次出现于 ${nodes[0].chapterTitle} / ${nodes[0].sceneTitle}`, location: node.location }));
    });
    const duplicatedIds = new Map();
    criticalNodes.forEach((node) => {
      if (!node.id) return;
      if (!duplicatedIds.has(node.id)) duplicatedIds.set(node.id, []);
      duplicatedIds.get(node.id).push(node);
    });
    duplicatedIds.forEach((nodes, blockId) => {
      if (nodes.length < 2) return;
      nodes.slice(1).forEach((node) => addIssue({ severity: 'error', category: '重复关键节点', title: '关键节点标识重复', detail: blockId, location: node.location }));
    });

    issues.sort((left, right) => Number(right.severity === 'error') - Number(left.severity === 'error'));
    return { issues, assetReferences };
  }

  return { LONG_DIALOGUE_LENGTH, collectWritingIssues, collectWritingStatistics, plainText };
}));
