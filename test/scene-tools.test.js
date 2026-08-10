const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSceneDialogueFilters, blockMatchesDialogueFilter } = require('../scene-tools');

test('场景对白筛选按实际出场角色统计且不混入旁白和分段', () => {
  const characters = [{ id: 'character-a', name: '林澈' }, { id: 'character-b', name: '周岚' }];
  const scene = { blocks: [
    { type: 'dialogue', characterId: 'character-b', character: '周岚', text: '第一句' },
    { type: 'narration', text: '雨停了。' },
    { type: 'dialogue', characterId: 'character-a', character: '林澈', text: '第二句' },
    { type: 'dialogue', characterId: 'character-a', character: '林澈', text: '第三句' },
    { type: 'dialogue', character: '', text: '待分配' },
    { type: 'segment', title: '分段 1' }
  ] };
  assert.deepEqual(collectSceneDialogueFilters(scene, characters).map(({ key, label, count }) => ({ key, label, count })), [
    { key: 'all', label: '全部对白', count: 4 },
    { key: 'character:character-a', label: '林澈', count: 2 },
    { key: 'character:character-b', label: '周岚', count: 1 },
    { key: 'unassigned', label: '未设置角色', count: 1 }
  ]);
  assert.equal(blockMatchesDialogueFilter(scene.blocks[2], 'character:character-a', characters), true);
  assert.equal(blockMatchesDialogueFilter(scene.blocks[0], 'character:character-a', characters), false);
  assert.equal(blockMatchesDialogueFilter(scene.blocks[1], 'character:character-a', characters), false);
  assert.equal(blockMatchesDialogueFilter(scene.blocks[3], 'all', characters), true);
});

test('旧对白只有角色名称时仍能匹配角色筛选', () => {
  const characters = [{ id: 'character-a', name: '林澈' }];
  const block = { type: 'dialogue', character: '林澈' };
  assert.equal(blockMatchesDialogueFilter(block, 'character:character-a', characters), true);
});
