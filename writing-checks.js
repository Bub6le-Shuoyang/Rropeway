(function exposeWritingChecks(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewayWritingChecks = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const LONG_DIALOGUE_LENGTH = 90;

  function plainText(value) {
    return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
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

    chapters.forEach((chapter, chapterIndex) => {
      (chapter.scenes || []).forEach((scene, sceneIndex) => {
        const sceneLocation = { view: 'editor', chapterIndex, sceneIndex, blockIndex: 0 };
        addAssetReference(scene.background, '场景背景', sceneLocation);
        (scene.blocks || []).forEach((block, blockIndex) => {
          const location = { view: 'editor', chapterIndex, sceneIndex, blockIndex };
          if (block.type === 'dialogue') {
            const text = plainText(block.textHtml || block.text);
            if (!text) addIssue({ severity: 'error', category: '空对白', title: '对白内容为空', detail: `${chapter.title} / ${scene.title}`, location });
            if (!block.characterId && !String(block.character || '').trim()) addIssue({ severity: 'warning', category: '未设置角色', title: '对白没有设置角色', detail: text.slice(0, 36) || `${chapter.title} / ${scene.title}`, location });
            if (text.length > LONG_DIALOGUE_LENGTH) addIssue({ severity: 'warning', category: '对白过长', title: `对白长度为 ${text.length} 字`, detail: `${text.slice(0, 42)}…`, location });
            const character = characterById.get(block.characterId) || characterByName.get(block.character);
            if (character && !block.portrait && !block.portraitPreset && !(character.portraitGroup || []).length && !character.portraitPreset) addIssue({ severity: 'warning', category: '缺少立绘', title: `${character.name} 没有可用立绘`, detail: `${chapter.title} / ${scene.title}`, location });
            addAssetReference(block.avatar, '对白头像', location);
            addAssetReference(block.portrait, '对白立绘', location);
            if ((block.statusTags || []).includes('关键节点')) criticalNodes.push({ id: String(block.id || ''), text, location, chapterTitle: chapter.title, sceneTitle: scene.title });
          }
          if (block.type === 'segment') (block.images || []).forEach((image) => addAssetReference(image.relativePath, '分段图片', location));
        });
      });
    });

    const criticalIds = new Set(criticalNodes.map((node) => node.id).filter(Boolean));
    chapters.forEach((chapter, chapterIndex) => {
      (chapter.scenes || []).forEach((scene, sceneIndex) => {
        (scene.blocks || []).forEach((block, blockIndex) => {
          if (block.type !== 'choice') return;
          const location = { view: 'editor', chapterIndex, sceneIndex, blockIndex };
          (block.options || []).forEach((option, optionIndex) => {
            const value = typeof option === 'string' ? { text: option, targetBlockId: '' } : option || {};
            if (!plainText(value.text)) addIssue({ severity: 'error', category: '未关联选项', title: `选项 ${optionIndex + 1} 内容为空`, detail: `${chapter.title} / ${scene.title}`, location });
            if (!value.targetBlockId) addIssue({ severity: 'warning', category: '未关联选项', title: `“${plainText(value.text) || `选项 ${optionIndex + 1}`}”未关联关键节点`, detail: `${chapter.title} / ${scene.title}`, location });
            else if (!criticalIds.has(String(value.targetBlockId))) addIssue({ severity: 'error', category: '未关联选项', title: `“${plainText(value.text) || `选项 ${optionIndex + 1}`}”的目标已失效`, detail: String(value.targetBlockId), location });
          });
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

  return { LONG_DIALOGUE_LENGTH, collectWritingIssues, plainText };
}));
