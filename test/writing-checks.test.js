const test = require('node:test');
const assert = require('node:assert/strict');
const { collectWritingIssues } = require('../writing-checks');

test('写作检查覆盖对白、角色、素材、立绘、关键节点和选项关联', () => {
  const duplicateText = '灯塔下面藏着第二条通道';
  const project = {
    characters: [{ id: 'character-a', name: '林澈', portraitGroup: [], portraitPreset: null }],
    assets: [],
    chapters: [{ id: 'chapter-a', title: '第一章', scenes: [{ id: 'scene-a', title: '码头', background: 'assets/missing-bg.png', blocks: [
      { id: 'dialogue-empty', type: 'dialogue', text: '', statusTags: [] },
      { id: 'key-a', type: 'dialogue', characterId: 'character-a', character: '林澈', text: duplicateText, statusTags: ['关键节点'] },
      { id: 'key-b', type: 'dialogue', characterId: 'character-a', character: '林澈', text: duplicateText, statusTags: ['关键节点'] },
      { id: 'dialogue-long', type: 'dialogue', characterId: 'character-a', character: '林澈', text: '很'.repeat(100), statusTags: [] },
      { id: 'item-a', type: 'item', itemId: 'watch', investigation: { text: '表盖里有一道划痕。' }, blocks: [{ id: 'item-dialogue-empty', type: 'dialogue', text: '', statusTags: [] }, { id: 'item-choice-empty', type: 'choice', options: [{ text: '', targetBlockId: '' }] }, { id: 'item-segment', type: 'segment', images: [{ relativePath: 'assets/missing-item-clue.png' }] }, { id: 'nested-item', type: 'item', itemId: 'note', blocks: [{ id: 'nested-dialogue-empty', type: 'dialogue', text: '', statusTags: [] }] }] },
      { id: 'segment-a', type: 'segment', images: [{ relativePath: 'assets/missing-clue.png' }] },
      { id: 'choice-a', type: 'choice', options: [{ text: '', targetBlockId: '' }, { text: '进入灯塔', targetBlockId: 'missing-key' }] }
    ] }] }]
  };
  const { issues, assetReferences } = collectWritingIssues(project);
  const categories = new Set(issues.map((issue) => issue.category));
  ['空对白', '未设置角色', '对白过长', '失效素材', '缺少立绘', '重复关键节点', '未关联选项'].forEach((category) => assert.ok(categories.has(category), `缺少 ${category}`));
  assert.equal(assetReferences.length, 3);
  assert.ok(issues.every((issue) => issue.location));
  assert.ok(issues.some((issue) => issue.location?.itemDialogueId === 'item-dialogue-empty' && issue.category === '空对白'));
  assert.ok(issues.some((issue) => issue.location?.itemDialogueId === 'nested-dialogue-empty' && issue.location?.itemContentPath?.length === 2 && issue.category === '空对白'));
});
