const test = require('node:test');
const assert = require('node:assert/strict');
const { collectAssetReferences, removeAssetReferences } = require('../asset-references');

test('删除素材会清理场景、对白、分段和角色立绘引用', () => {
  const relativePath = 'assets/images/example.png';
  const project = {
    chapters: [{ scenes: [{
      background: relativePath,
      blocks: [
        { type: 'dialogue', avatar: relativePath, portrait: relativePath },
        { type: 'segment', images: [{ relativePath }, { relativePath: 'assets/images/keep.png' }] }
      ]
    }] }],
    characters: [{ avatarGroup: [{ relativePath }], portraitGroup: [relativePath, { relativePath }, 'assets/images/keep.png'] }]
  };

  assert.equal(removeAssetReferences(project, relativePath), 7);
  assert.equal(project.chapters[0].scenes[0].background, '');
  assert.equal(project.chapters[0].scenes[0].blocks[0].portrait, undefined);
  assert.equal(project.chapters[0].scenes[0].blocks[0].avatar, undefined);
  assert.deepEqual(project.chapters[0].scenes[0].blocks[1].images, [{ relativePath: 'assets/images/keep.png' }]);
  assert.deepEqual(project.characters[0].avatarGroup, []);
  assert.deepEqual(project.characters[0].portraitGroup, ['assets/images/keep.png']);
});

test('整理旧项目时只收集项目实际引用的素材路径', () => {
  const project = {
    assets: [{ relativePath: 'assets/images/library.png' }, { fileName: 'assets/audio/voice.ogg' }],
    chapters: [{ scenes: [{ background: 'assets/images/background.png', blocks: [{ portrait: 'assets/images/portrait.png' }, { images: [{ relativePath: 'assets/images/slide.png' }, { relativePath: '../outside.png' }] }] }] }],
    characters: [{ avatarGroup: [{ relativePath: 'assets/images/avatar.png' }], portraitGroup: ['assets/images/portrait.png', { relativePath: 'assets/images/alternate.png' }] }]
  };
  assert.deepEqual(collectAssetReferences(project).sort(), [
    'assets/audio/voice.ogg',
    'assets/images/alternate.png',
    'assets/images/avatar.png',
    'assets/images/background.png',
    'assets/images/library.png',
    'assets/images/portrait.png',
    'assets/images/slide.png'
  ]);
});
