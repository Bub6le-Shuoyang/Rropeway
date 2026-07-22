const test = require('node:test');
const assert = require('node:assert/strict');
const { removeAssetReferences } = require('../asset-references');

test('删除素材会清理场景、对白、分段和角色立绘引用', () => {
  const relativePath = 'assets/images/example.png';
  const project = {
    chapters: [{ scenes: [{
      background: relativePath,
      blocks: [
        { type: 'dialogue', portrait: relativePath },
        { type: 'segment', images: [{ relativePath }, { relativePath: 'assets/images/keep.png' }] }
      ]
    }] }],
    characters: [{ portraits: [relativePath, { relativePath }, 'assets/images/keep.png'] }]
  };

  assert.equal(removeAssetReferences(project, relativePath), 5);
  assert.equal(project.chapters[0].scenes[0].background, '');
  assert.equal(project.chapters[0].scenes[0].blocks[0].portrait, undefined);
  assert.deepEqual(project.chapters[0].scenes[0].blocks[1].images, [{ relativePath: 'assets/images/keep.png' }]);
  assert.deepEqual(project.characters[0].portraits, ['assets/images/keep.png']);
});
