(function exposeSceneTools(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewaySceneTools = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function dialogueIdentity(block, characters = []) {
    if (block?.type !== 'dialogue') return null;
    const characterId = String(block.characterId || '').trim();
    const characterName = String(block.character || '').trim();
    if (characterId) {
      const character = characters.find((item) => String(item?.id || '') === characterId);
      return { key: `character:${characterId}`, label: character?.name || characterName || '未知角色', characterId };
    }
    if (characterName) {
      const character = characters.find((item) => String(item?.name || '').trim() === characterName);
      if (character?.id) return { key: `character:${character.id}`, label: character.name, characterId: character.id };
      return { key: `name:${characterName}`, label: characterName, characterId: '' };
    }
    return { key: 'unassigned', label: '未设置角色', characterId: '' };
  }

  function collectSceneDialogueFilters(scene, characters = []) {
    const identities = new Map();
    (scene?.blocks || []).forEach((block) => {
      const identity = dialogueIdentity(block, characters);
      if (!identity) return;
      if (!identities.has(identity.key)) identities.set(identity.key, { ...identity, count: 0 });
      identities.get(identity.key).count += 1;
    });
    const characterOrder = new Map(characters.map((character, index) => [`character:${character.id}`, index]));
    const filters = [...identities.values()].sort((left, right) => {
      if (left.key === 'unassigned') return 1;
      if (right.key === 'unassigned') return -1;
      return (characterOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) - (characterOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER);
    });
    return [{ key: 'all', label: '全部对白', count: filters.reduce((total, item) => total + item.count, 0), characterId: '' }, ...filters];
  }

  function blockMatchesDialogueFilter(block, filterKey, characters = []) {
    if (!filterKey || filterKey === 'all') return true;
    return dialogueIdentity(block, characters)?.key === filterKey;
  }

  return { dialogueIdentity, collectSceneDialogueFilters, blockMatchesDialogueFilter };
}));
