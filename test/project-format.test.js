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