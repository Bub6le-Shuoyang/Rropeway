const path = require('node:path');

function sanitizeProjectName(value) {
  const name = String(value || 'Rropeway').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  return name || 'Rropeway';
}

function createProjectLocation(parentDirectory, title, suffix = 1) {
  const baseName = sanitizeProjectName(title);
  const folderName = suffix > 1 ? `${baseName} (${suffix})` : baseName;
  const folderPath = path.join(parentDirectory, folderName);
  return { folderPath, filePath: path.join(folderPath, `${folderName}.scriptroom`) };
}

function isProjectFilePath(filePath) {
  return typeof filePath === 'string' && ['.scriptroom', '.json'].includes(path.extname(filePath).toLowerCase());
}

function projectDirectory(filePath) {
  if (!isProjectFilePath(filePath)) throw new Error('项目路径无效');
  return path.dirname(path.resolve(filePath));
}

function isManagedProjectFolder(filePath) {
  if (!isProjectFilePath(filePath)) return false;
  const directory = projectDirectory(filePath);
  return path.basename(directory).toLowerCase() === path.basename(filePath, path.extname(filePath)).toLowerCase();
}

module.exports = { createProjectLocation, isManagedProjectFolder, isProjectFilePath, projectDirectory, sanitizeProjectName };
