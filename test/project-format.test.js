const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PROJECT, normalizeProject } = require('../project-format');

test('默认项目只包含空白编辑结构', () => {
  const project = normalizeProject(DEFAULT_PROJECT);
  assert.equal(project.format, 'scriptroom-project');
  assert.equal(project.title, 'Rropeway');
  assert.ok(project.chapters.length > 0);
  assert.ok(project.chapters[0].scenes.length > 0);
  assert.equal(project.chapters[0].scenes[0].blocks.length, 0);
});

test('损坏或空项目会被补齐为可编辑结构', () => {
  const project = normalizeProject({ title: 123, chapters: [{ title: null, scenes: null }] });
  assert.equal(project.title, '123');
  assert.equal(project.chapters[0].title, '第 1 章');
  assert.equal(project.chapters[0].scenes.length, 1);
  assert.deepEqual(project.chapters[0].scenes[0].blocks, []);
});

test('自定义项目名称会在项目数据中保留', () => {
  const project = normalizeProject({ title: '星港调查局' });
  assert.equal(project.title, '星港调查局');
});

test('素材只保留项目内相对路径字段', () => {
  const project = normalizeProject({ assets: [{ name: '立绘.png', fileName: 'assets/a.png' }] });
  assert.equal(project.assets[0].relativePath, 'assets/a.png');
  assert.equal(project.assets[0].fileName, 'assets/a.png');
});
test('角色代表色和默认立绘会被规范化保存', () => {
  const project = normalizeProject({ characters: [{ name: '角色A', color: '#12abef', portraitPreset: 'short-female', description: '测试角色' }] });
  assert.equal(project.characters[0].color, '#12abef');
  assert.equal(project.characters[0].portraitPreset, 'short-female');
  assert.equal(project.characters[0].description, '测试角色');
});

test('对白多个状态标签和角色标识会被保存', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', character: '角色A', characterId: 'character-a', statusTags: ['压低声音', '受伤', '受伤', ''] }] }] }] });
  const block = project.chapters[0].scenes[0].blocks[0];
  assert.equal(block.characterId, 'character-a');
  assert.deepEqual(block.statusTags, ['压低声音', '受伤']);
});

test('旧情绪标签会迁移为状态标签并支持分段主视角', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', emotion: '紧张' }, { type: 'segment', title: '调查开始', perspectiveCharacterId: 'character-a' }] }] }] });
  assert.deepEqual(project.chapters[0].scenes[0].blocks[0].statusTags, ['紧张']);
  assert.deepEqual(project.chapters[0].scenes[0].blocks[1], { type: 'segment', title: '调查开始', perspectiveCharacterId: 'character-a' });
});

test('对白文字格式字段会被保存并校正对齐方式', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', text: '重点', textHtml: '<b>重点</b>', textAlign: 'center' }, { type: 'dialogue', textAlign: 'invalid' }] }] }] });
  assert.equal(project.chapters[0].scenes[0].blocks[0].textHtml, '<b>重点</b>');
  assert.equal(project.chapters[0].scenes[0].blocks[0].textAlign, 'center');
  assert.equal(project.chapters[0].scenes[0].blocks[1].textAlign, 'left');
});
