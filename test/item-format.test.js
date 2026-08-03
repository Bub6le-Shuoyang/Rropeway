const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesItem, normalizeItem, normalizeItemBlock } = require('../item-format');

test('物品资料会规范化图片组、标签和封面', () => {
  const item = normalizeItem({
    id: 'item-key',
    name: '旧铜钥匙',
    tags: ['线索', ' 任务 ', '线索'],
    images: [
      { id: 'image-a', name: '正面', relativePath: 'assets\\items\\item-key\\images\\front.png' },
      { id: 'image-b', name: '背面', relativePath: 'assets/items/item-key/images/back.png' }
    ],
    coverImageId: 'image-b'
  });
  assert.deepEqual(item.tags, ['线索', '任务']);
  assert.equal(item.images[0].relativePath, 'assets/items/item-key/images/front.png');
  assert.equal(item.coverImageId, 'image-b');
  assert.equal(matchesItem(item, '旧铜', ''), true);
  assert.equal(matchesItem(item, '', '任务'), true);
  assert.equal(matchesItem(item, '', '__uncategorized__'), false);
});

test('物品内容块会分开保存调查反应和标准角色对白', () => {
  const block = normalizeItemBlock({
    id: 'item-block-a',
    itemId: 'item-key',
    investigation: { text: '钥匙背面刻着仓库编号。' },
    dialogues: [{ id: 'dialogue-a', characterId: 'character-a', character: '林夏', text: '这把钥匙我见过。', statusTags: ['线索'] }]
  });
  assert.equal(block.investigation.text, '钥匙背面刻着仓库编号。');
  assert.equal(block.dialogues[0].type, 'dialogue');
  assert.equal(block.dialogues[0].character, '林夏');
  assert.deepEqual(block.dialogues[0].statusTags, ['线索']);
});

test('旧角色反应数组会无损迁移为物品角色对白', () => {
  const block = normalizeItemBlock({ itemId: 'item-key', reactions: [{ id: 'legacy-a', characterId: 'character-a', text: '旧内容仍然保留。' }] });
  assert.equal(block.investigation.text, '');
  assert.equal(block.dialogues.length, 1);
  assert.equal(block.dialogues[0].id, 'legacy-a');
  assert.equal(block.dialogues[0].text, '旧内容仍然保留。');
});
