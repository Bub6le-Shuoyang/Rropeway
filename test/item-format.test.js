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

test('物品内容块会分开保存调查反应和完整剧本内容流', () => {
  const block = normalizeItemBlock({
    id: 'item-block-a',
    itemId: 'item-key',
    investigation: { text: '钥匙背面刻着仓库编号。' },
    blocks: [
      { id: 'dialogue-a', type: 'dialogue', characterId: 'character-a', character: '林夏', text: '这把钥匙我见过。', statusTags: ['线索'] },
      { id: 'narration-a', type: 'narration', text: '钥匙在掌心里微微发热。' },
      { id: 'choice-a', type: 'choice', title: '如何处理钥匙？', options: [{ text: '收起来', targetBlockId: 'key-a' }] },
      { id: 'segment-a', type: 'segment', title: '调查结束', perspectiveCharacterId: 'character-a', images: [{ relativePath: 'assets/images/key.png' }] }
    ]
  });
  assert.equal(block.investigation.text, '钥匙背面刻着仓库编号。');
  assert.deepEqual(block.blocks.map((entry) => entry.type), ['dialogue', 'narration', 'choice', 'segment']);
  assert.equal(block.blocks[0].character, '林夏');
  assert.deepEqual(block.blocks[0].statusTags, ['线索']);
  assert.equal(block.blocks[1].text, '钥匙在掌心里微微发热。');
  assert.equal(block.blocks[2].options[0].targetBlockId, 'key-a');
  assert.equal(block.blocks[3].images[0].relativePath, 'assets/images/key.png');
});

test('旧角色反应数组会无损迁移为物品角色对白', () => {
  const block = normalizeItemBlock({ itemId: 'item-key', reactions: [{ id: 'legacy-a', characterId: 'character-a', text: '旧内容仍然保留。' }] });
  assert.equal(block.investigation.text, '');
  assert.equal(block.blocks.length, 1);
  assert.equal(block.blocks[0].id, 'legacy-a');
  assert.equal(block.blocks[0].text, '旧内容仍然保留。');
});

test('物品内容允许递归嵌套并保持每一层实例独立', () => {
  const block = normalizeItemBlock({
    id: 'outer-item',
    itemId: 'item-box',
    investigation: { text: '打开木盒。' },
    blocks: [{
      id: 'inner-item',
      type: 'item',
      itemId: 'item-key',
      investigation: { text: '拿起盒中的钥匙。' },
      blocks: [{ id: 'inner-dialogue', type: 'dialogue', character: '林夏', text: '钥匙还很新。' }]
    }]
  });
  assert.equal(block.blocks[0].type, 'item');
  assert.equal(block.blocks[0].investigation.text, '拿起盒中的钥匙。');
  assert.equal(block.blocks[0].blocks[0].text, '钥匙还很新。');
  assert.notEqual(block.blocks, block.blocks[0].blocks);
});
