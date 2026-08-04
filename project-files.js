const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeProject } = require('./project-format');

const MANIFEST_FORMAT = 'rropeway-project-index';
const MANIFEST_VERSION = 2;
const STORAGE_FORMAT = 'split-json-v1';
const DATA_DIRECTORY = 'project-data';
const REVISIONS_DIRECTORY = 'revisions';

const COMPONENT_FORMATS = {
  project: 'rropeway-project-metadata',
  characters: 'rropeway-characters',
  items: 'rropeway-items',
  assets: 'rropeway-assets',
  relationshipGraph: 'rropeway-relationship-graph',
  sceneFlow: 'rropeway-scene-flow',
  chapters: 'rropeway-chapter-index',
  chapter: 'rropeway-chapter',
  scene: 'rropeway-scene',
};

function toPortablePath(...parts) {
  return path.posix.join(...parts.map((part) => String(part).replaceAll('\\', '/')));
}

function safeFileId(value, fallback) {
  const source = String(value || fallback || 'item');
  const readable = source.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 54);
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `${readable || fallback || 'item'}-${digest}`;
}

function createRevisionId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function projectRoot(projectPath) {
  return path.dirname(path.resolve(projectPath));
}

function resolveProjectReference(projectPath, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('项目索引包含无效文件路径。');
  }

  const root = projectRoot(projectPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('项目索引包含越界文件路径。');
  }
  return target;
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertDocument(document, format, revision, label) {
  if (!document || document.format !== format || document.version !== 1) {
    throw new Error(`${label}格式无效。`);
  }
  if (document.revision !== revision) {
    throw new Error(`${label}版本与项目索引不一致。`);
  }
}

async function readComponent(projectPath, relativePath, format, revision, label) {
  const document = await readJson(resolveProjectReference(projectPath, relativePath));
  assertDocument(document, format, revision, label);
  return document;
}

function isSplitManifest(value) {
  return Boolean(
    value
    && value.format === MANIFEST_FORMAT
    && value.version === MANIFEST_VERSION
    && value.storage === STORAGE_FORMAT,
  );
}

async function loadSplitProject(projectPath, manifest) {
  const revision = String(manifest.revision || '');
  if (!revision || !manifest.files) throw new Error('项目索引缺少版本或文件映射。');

  const [metadata, characters, items, assets, relationshipGraph, sceneFlow, chapterIndex] = await Promise.all([
    readComponent(projectPath, manifest.files.project, COMPONENT_FORMATS.project, revision, '项目元数据'),
    readComponent(projectPath, manifest.files.characters, COMPONENT_FORMATS.characters, revision, '角色数据'),
    manifest.files.items
      ? readComponent(projectPath, manifest.files.items, COMPONENT_FORMATS.items, revision, '物品数据')
      : Promise.resolve({ items: [] }),
    readComponent(projectPath, manifest.files.assets, COMPONENT_FORMATS.assets, revision, '素材数据'),
    readComponent(
      projectPath,
      manifest.files.relationshipGraph,
      COMPONENT_FORMATS.relationshipGraph,
      revision,
      '角色关系数据',
    ),
    readComponent(projectPath, manifest.files.sceneFlow, COMPONENT_FORMATS.sceneFlow, revision, '场景流程数据'),
    readComponent(projectPath, manifest.files.chapters, COMPONENT_FORMATS.chapters, revision, '章节索引'),
  ]);

  const chapterReferences = Array.isArray(chapterIndex.chapters) ? chapterIndex.chapters : [];
  const chapters = await Promise.all(chapterReferences.map(async (chapterReference) => {
    const chapterDocument = await readComponent(
      projectPath,
      chapterReference.file,
      COMPONENT_FORMATS.chapter,
      revision,
      '章节数据',
    );
    if (String(chapterDocument.id) !== String(chapterReference.id)) {
      throw new Error('章节索引与章节文件不一致。');
    }

    const sceneReferences = Array.isArray(chapterDocument.scenes) ? chapterDocument.scenes : [];
    const scenes = await Promise.all(sceneReferences.map(async (sceneReference) => {
      const sceneDocument = await readComponent(
        projectPath,
        sceneReference.file,
        COMPONENT_FORMATS.scene,
        revision,
        '场景数据',
      );
      if (String(sceneDocument.scene?.id) !== String(sceneReference.id)) {
        throw new Error('场景索引与场景文件不一致。');
      }
      return sceneDocument.scene;
    }));

    return {
      id: chapterDocument.id,
      title: chapterDocument.title,
      status: chapterDocument.status,
      scenes,
      branches: Array.isArray(chapterDocument.branches) ? chapterDocument.branches : [],
    };
  }));

  return normalizeProject({
    title: metadata.title,
    description: metadata.description,
    updatedAt: metadata.updatedAt,
    chapters,
    characters: characters.characters,
    items: items.items,
    assets: assets.assets,
    relationshipGraph: relationshipGraph.relationshipGraph,
    sceneFlow: sceneFlow.sceneFlow,
  });
}

async function readCandidate(projectPath, candidatePath) {
  const document = await readJson(candidatePath);
  if (!isSplitManifest(document)) {
    return {
      data: normalizeProject(document),
      storage: 'legacy-json',
      manifest: null,
      candidatePath,
    };
  }

  return {
    data: await loadSplitProject(projectPath, document),
    storage: STORAGE_FORMAT,
    manifest: document,
    candidatePath,
  };
}

async function readProjectFile(projectPath) {
  const target = path.resolve(projectPath);
  let primaryError;
  try {
    const result = await readCandidate(target, target);
    return {
      filePath: target,
      data: result.data,
      storage: result.storage,
      revision: result.manifest?.revision || null,
      recoveredFromBackup: false,
    };
  } catch (error) {
    primaryError = error;
  }

  try {
    const backupPath = `${target}.backup`;
    const result = await readCandidate(target, backupPath);
    return {
      filePath: target,
      data: result.data,
      storage: result.storage,
      revision: result.manifest?.revision || null,
      recoveredFromBackup: true,
      recoveryReason: primaryError?.message || '主项目文件无法读取。',
    };
  } catch (backupError) {
    throw new Error(`项目无法读取，备份恢复也失败：${primaryError?.message || '未知错误'}；${backupError.message}`);
  }
}

function componentDocument(format, revision, values) {
  return {
    format,
    version: 1,
    revision,
    ...values,
  };
}

async function writeRevision(stagingPath, rootRelativePath, revision, project) {
  const files = {
    project: toPortablePath(rootRelativePath, 'project.json'),
    characters: toPortablePath(rootRelativePath, 'characters.json'),
    items: toPortablePath(rootRelativePath, 'items.json'),
    assets: toPortablePath(rootRelativePath, 'assets.json'),
    relationshipGraph: toPortablePath(rootRelativePath, 'relationship-graph.json'),
    sceneFlow: toPortablePath(rootRelativePath, 'scene-flow.json'),
    chapters: toPortablePath(rootRelativePath, 'chapters.json'),
  };

  await Promise.all([
    writeJson(path.join(stagingPath, 'project.json'), componentDocument(COMPONENT_FORMATS.project, revision, {
      title: project.title,
      description: project.description,
      updatedAt: project.updatedAt,
    })),
    writeJson(path.join(stagingPath, 'characters.json'), componentDocument(COMPONENT_FORMATS.characters, revision, {
      characters: project.characters,
    })),
    writeJson(path.join(stagingPath, 'items.json'), componentDocument(COMPONENT_FORMATS.items, revision, {
      items: project.items,
    })),
    writeJson(path.join(stagingPath, 'assets.json'), componentDocument(COMPONENT_FORMATS.assets, revision, {
      assets: project.assets,
    })),
    writeJson(
      path.join(stagingPath, 'relationship-graph.json'),
      componentDocument(COMPONENT_FORMATS.relationshipGraph, revision, {
        relationshipGraph: project.relationshipGraph,
      }),
    ),
    writeJson(path.join(stagingPath, 'scene-flow.json'), componentDocument(COMPONENT_FORMATS.sceneFlow, revision, {
      sceneFlow: project.sceneFlow,
    })),
  ]);

  const chapterReferences = [];
  for (const [chapterIndex, chapter] of project.chapters.entries()) {
    const chapterFileName = `${String(chapterIndex + 1).padStart(3, '0')}-${safeFileId(chapter.id, 'chapter')}.json`;
    const chapterRelativePath = toPortablePath(rootRelativePath, 'chapters', chapterFileName);
    const sceneReferences = [];

    for (const [sceneIndex, scene] of chapter.scenes.entries()) {
      const sceneFileName = `${String(sceneIndex + 1).padStart(3, '0')}-${safeFileId(scene.id, 'scene')}.json`;
      const sceneRelativePath = toPortablePath(rootRelativePath, 'scenes', sceneFileName);
      sceneReferences.push({ id: scene.id, file: sceneRelativePath });
      await writeJson(path.join(stagingPath, 'scenes', sceneFileName), componentDocument(COMPONENT_FORMATS.scene, revision, {
        scene,
      }));
    }

    chapterReferences.push({ id: chapter.id, file: chapterRelativePath });
    await writeJson(path.join(stagingPath, 'chapters', chapterFileName), componentDocument(COMPONENT_FORMATS.chapter, revision, {
      id: chapter.id,
      title: chapter.title,
      status: chapter.status,
      scenes: sceneReferences,
      branches: Array.isArray(chapter.branches) ? chapter.branches : [],
    }));
  }

  await writeJson(path.join(stagingPath, 'chapters.json'), componentDocument(COMPONENT_FORMATS.chapters, revision, {
    chapters: chapterReferences,
  }));

  return files;
}

async function findValidPreviousProject(target) {
  for (const candidatePath of [target, `${target}.backup`]) {
    try {
      return await readCandidate(target, candidatePath);
    } catch {
      // Continue to the next recovery candidate.
    }
  }
  return null;
}

async function replaceManifest(target, manifest, shouldBackupPrimary) {
  const temporaryPath = `${target}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  const backupPath = `${target}.backup`;
  await writeJson(temporaryPath, manifest);

  if (shouldBackupPrimary) {
    await fs.copyFile(target, backupPath);
  }

  try {
    await fs.rm(target, { force: true });
    await fs.rename(temporaryPath, target);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    try {
      await fs.access(target);
    } catch {
      await fs.copyFile(backupPath, target).catch(() => {});
    }
    throw error;
  }
}

async function cleanupRevisions(projectPath, keepRevisions) {
  const revisionsPath = path.join(projectRoot(projectPath), DATA_DIRECTORY, REVISIONS_DIRECTORY);
  const keep = new Set([...keepRevisions].filter(Boolean));
  let entries = [];
  try {
    entries = await fs.readdir(revisionsPath, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
    .map((entry) => fs.rm(path.join(revisionsPath, entry.name), { recursive: true, force: true })));
}

async function writeProjectFile(projectPath, data) {
  const target = path.resolve(projectPath);
  const project = normalizeProject({ ...data, updatedAt: new Date().toISOString() });
  const revision = createRevisionId();
  const revisionsPath = path.join(projectRoot(target), DATA_DIRECTORY, REVISIONS_DIRECTORY);
  const rootRelativePath = toPortablePath(DATA_DIRECTORY, REVISIONS_DIRECTORY, revision);
  const finalRevisionPath = path.join(revisionsPath, revision);
  const stagingPath = path.join(revisionsPath, `.${revision}.tmp`);
  await fs.mkdir(revisionsPath, { recursive: true });

  let files;
  try {
    files = await writeRevision(stagingPath, rootRelativePath, revision, project);
    await fs.rename(stagingPath, finalRevisionPath);
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const previous = await findValidPreviousProject(target);
  const previousRevision = previous?.manifest?.revision || null;
  const shouldBackupPrimary = previous?.candidatePath === target;
  const manifest = {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    storage: STORAGE_FORMAT,
    title: project.title,
    updatedAt: project.updatedAt,
    revision,
    root: rootRelativePath,
    files,
  };

  try {
    await replaceManifest(target, manifest, shouldBackupPrimary);
  } catch (error) {
    await fs.rm(finalRevisionPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  await cleanupRevisions(target, [revision, previousRevision]).catch(() => {});
  return {
    filePath: target,
    data: project,
    storage: STORAGE_FORMAT,
    revision,
    recoveredFromBackup: false,
  };
}

module.exports = {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  STORAGE_FORMAT,
  isSplitManifest,
  readProjectFile,
  resolveProjectReference,
  writeProjectFile,
};
