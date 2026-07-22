const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createProjectLocation, isManagedProjectFolder, isProjectFilePath, sanitizeProjectName } = require('../project-storage');

test('新项目会创建项目名文件夹并将项目文件放在其中', () => {
  const location = createProjectLocation(path.join('C:', 'projects'), '测试仓库');
  assert.equal(location.folderPath, path.join('C:', 'projects', '测试仓库'));
  assert.equal(location.filePath, path.join('C:', 'projects', '测试仓库', '测试仓库.scriptroom'));
  assert.equal(isManagedProjectFolder(location.filePath), true);
});

test('同名项目使用带序号的完整独立文件夹', () => {
  const location = createProjectLocation(path.join('C:', 'projects'), '测试仓库', 2);
  assert.equal(path.basename(location.folderPath), '测试仓库 (2)');
  assert.equal(path.basename(location.filePath), '测试仓库 (2).scriptroom');
});

test('项目名会过滤 Windows 不允许的路径字符', () => {
  assert.equal(sanitizeProjectName('  剧本:第一章?  '), '剧本_第一章_');
  assert.equal(isProjectFilePath('example.txt'), false);
});
