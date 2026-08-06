const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeProject } = require('./project-format');

const MANIFEST_FORMAT = 'rropeway-project-index';
const MANIFEST_VERSION = 3;
const STORAGE_FORMAT = 'split-json-v2';
const LEGACY_MANIFEST_VERSION = 2;
const LEGACY_STORAGE_FORMAT = 'split-json-v1';
const DATA_DIRECTORY = 'project-data';
const COMPONENTS_DIRECTORY = 'components';
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

function safeFileId(value, fallback = 'item') {
  const source = String(value || fallback);
  const readable = source.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `${readable || fallback}-${digest}`;
}

function createRevisionId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function componentHash(format, values) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize({ format, version: 2, ...values }))).digest('hex');
}

function componentDocument(format, values) {
  const hash = componentHash(format, values);
  return { format, version: 2, hash, ...values };
}

function projectRoot(projectPath) { return path.dirname(path.resolve(projectPath)); }

function resolveProjectReference(projectPath, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) throw new Error('项目索引包含无效文件路径。');
  const root = projectRoot(projectPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('项目索引包含越界文件路径。');
  return target;
}

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isV2Manifest(value) {
  return Boolean(value && value.format === MANIFEST_FORMAT && value.version === MANIFEST_VERSION && value.storage === STORAGE_FORMAT);
}
function isV1Manifest(value) {
  return Boolean(value && value.format === MANIFEST_FORMAT && value.version === LEGACY_MANIFEST_VERSION && value.storage === LEGACY_STORAGE_FORMAT);
}
function isSplitManifest(value) { return isV2Manifest(value) || isV1Manifest(value); }

function normalizeReference(reference, label) {
  if (!reference || typeof reference !== 'object' || typeof reference.file !== 'string' || !/^[a-f0-9]{64}$/.test(reference.hash || '')) {
    throw new Error(`${label}索引无效。`);
  }
  return reference;
}

async function readV2Component(projectPath, reference, format, label) {
  const normalizedReference = normalizeReference(reference, label);
  const document = await readJson(resolveProjectReference(projectPath, normalizedReference.file));
  if (!document || document.format !== format || document.version !== 2 || document.hash !== normalizedReference.hash) throw new Error(`${label}格式或校验值无效。`);
  const { format: ignoredFormat, version: ignoredVersion, hash: ignoredHash, ...values } = document;
  if (componentHash(format, values) !== normalizedReference.hash) throw new Error(`${label}内容校验失败。`);
  return document;
}

async function loadV2Project(projectPath, manifest) {
  if (!manifest.files) throw new Error('项目索引缺少文件映射。');
  const [metadata, characters, items, assets, relationshipGraph, sceneFlow, chapterIndex] = await Promise.all([
    readV2Component(projectPath, manifest.files.project, COMPONENT_FORMATS.project, '项目元数据'),
    readV2Component(projectPath, manifest.files.characters, COMPONENT_FORMATS.characters, '角色数据'),
    manifest.files.items ? readV2Component(projectPath, manifest.files.items, COMPONENT_FORMATS.items, '物品数据') : Promise.resolve({ items: [] }),
    readV2Component(projectPath, manifest.files.assets, COMPONENT_FORMATS.assets, '素材数据'),
    readV2Component(projectPath, manifest.files.relationshipGraph, COMPONENT_FORMATS.relationshipGraph, '角色关系数据'),
    readV2Component(projectPath, manifest.files.sceneFlow, COMPONENT_FORMATS.sceneFlow, '场景流程数据'),
    readV2Component(projectPath, manifest.files.chapters, COMPONENT_FORMATS.chapters, '章节索引'),
  ]);

  const chapters = await Promise.all((chapterIndex.chapters || []).map(async (chapterReference) => {
    const chapterDocument = await readV2Component(projectPath, chapterReference, COMPONENT_FORMATS.chapter, '章节数据');
    if (String(chapterDocument.id) !== String(chapterReference.id)) throw new Error('章节索引与章节文件不一致。');
    const scenes = await Promise.all((chapterDocument.scenes || []).map(async (sceneReference) => {
      const sceneDocument = await readV2Component(projectPath, sceneReference, COMPONENT_FORMATS.scene, '场景数据');
      if (String(sceneDocument.scene?.id) !== String(sceneReference.id)) throw new Error('场景索引与场景文件不一致。');
      return sceneDocument.scene;
    }));
    return { id: chapterDocument.id, title: chapterDocument.title, status: chapterDocument.status, scenes, branches: chapterDocument.branches || [] };
  }));

  return normalizeProject({
    title: metadata.title, description: metadata.description, updatedAt: metadata.updatedAt, chapters,
    characters: characters.characters, items: items.items, assets: assets.assets,
    relationshipGraph: relationshipGraph.relationshipGraph, sceneFlow: sceneFlow.sceneFlow,
  });
}

function assertV1Document(document, format, revision, label) {
  if (!document || document.format !== format || document.version !== 1) throw new Error(`${label}格式无效。`);
  if (document.revision !== revision) throw new Error(`${label}版本与项目索引不一致。`);
}
async function readV1Component(projectPath, relativePath, format, revision, label) {
  const document = await readJson(resolveProjectReference(projectPath, relativePath));
  assertV1Document(document, format, revision, label);
  return document;
}

async function loadV1Project(projectPath, manifest) {
  const revision = String(manifest.revision || '');
  if (!revision || !manifest.files) throw new Error('项目索引缺少版本或文件映射。');
  const [metadata, characters, items, assets, relationshipGraph, sceneFlow, chapterIndex] = await Promise.all([
    readV1Component(projectPath, manifest.files.project, COMPONENT_FORMATS.project, revision, '项目元数据'),
    readV1Component(projectPath, manifest.files.characters, COMPONENT_FORMATS.characters, revision, '角色数据'),
    manifest.files.items ? readV1Component(projectPath, manifest.files.items, COMPONENT_FORMATS.items, revision, '物品数据') : Promise.resolve({ items: [] }),
    readV1Component(projectPath, manifest.files.assets, COMPONENT_FORMATS.assets, revision, '素材数据'),
    readV1Component(projectPath, manifest.files.relationshipGraph, COMPONENT_FORMATS.relationshipGraph, revision, '角色关系数据'),
    readV1Component(projectPath, manifest.files.sceneFlow, COMPONENT_FORMATS.sceneFlow, revision, '场景流程数据'),
    readV1Component(projectPath, manifest.files.chapters, COMPONENT_FORMATS.chapters, revision, '章节索引'),
  ]);
  const chapters = await Promise.all((chapterIndex.chapters || []).map(async (chapterReference) => {
    const chapterDocument = await readV1Component(projectPath, chapterReference.file, COMPONENT_FORMATS.chapter, revision, '章节数据');
    const scenes = await Promise.all((chapterDocument.scenes || []).map(async (sceneReference) => (await readV1Component(projectPath, sceneReference.file, COMPONENT_FORMATS.scene, revision, '场景数据')).scene));
    return { id: chapterDocument.id, title: chapterDocument.title, status: chapterDocument.status, scenes, branches: chapterDocument.branches || [] };
  }));
  return normalizeProject({ title: metadata.title, description: metadata.description, updatedAt: metadata.updatedAt, chapters, characters: characters.characters, items: items.items, assets: assets.assets, relationshipGraph: relationshipGraph.relationshipGraph, sceneFlow: sceneFlow.sceneFlow });
}

async function readCandidate(projectPath, candidatePath) {
  const document = await readJson(candidatePath);
  if (isV2Manifest(document)) return { data: await loadV2Project(projectPath, document), storage: STORAGE_FORMAT, manifest: document, candidatePath };
  if (isV1Manifest(document)) return { data: await loadV1Project(projectPath, document), storage: LEGACY_STORAGE_FORMAT, manifest: document, candidatePath };
  return { data: normalizeProject(document), storage: 'legacy-json', manifest: null, candidatePath };
}

async function readProjectFile(projectPath) {
  const target = path.resolve(projectPath);
  let primaryError;
  try {
    const result = await readCandidate(target, target);
    return { filePath: target, data: result.data, storage: result.storage, revision: result.manifest?.revision || null, recoveredFromBackup: false };
  } catch (error) { primaryError = error; }
  try {
    const result = await readCandidate(target, `${target}.backup`);
    return { filePath: target, data: result.data, storage: result.storage, revision: result.manifest?.revision || null, recoveredFromBackup: true, recoveryReason: primaryError?.message || '主项目文件无法读取。' };
  } catch (backupError) {
    throw new Error(`项目无法读取，备份恢复也失败：${primaryError?.message || '未知错误'}；${backupError.message}`);
  }
}

async function writeContentComponent(projectPath, category, identity, format, values) {
  const document = componentDocument(format, values);
  const fileName = `${safeFileId(identity, category)}-${document.hash.slice(0, 20)}.json`;
  const relativePath = toPortablePath(DATA_DIRECTORY, COMPONENTS_DIRECTORY, category, fileName);
  const target = resolveProjectReference(projectPath, relativePath);
  let validExisting = false;
  try {
    const existing = await readJson(target);
    const { format: existingFormat, version, hash, ...existingValues } = existing;
    validExisting = existingFormat === format && version === 2 && hash === document.hash && componentHash(format, existingValues) === hash;
  } catch {}
  if (!validExisting) {
    const temporaryPath = `${target}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    await writeJson(temporaryPath, document);
    await fs.rm(target, { force: true });
    await fs.rename(temporaryPath, target);
  }
  return { file: relativePath, hash: document.hash };
}

async function writeV2Components(projectPath, project) {
  const [projectReference, charactersReference, itemsReference, assetsReference, relationshipReference, flowReference] = await Promise.all([
    writeContentComponent(projectPath, 'project', 'project', COMPONENT_FORMATS.project, { title: project.title, description: project.description, updatedAt: project.updatedAt }),
    writeContentComponent(projectPath, 'characters', 'characters', COMPONENT_FORMATS.characters, { characters: project.characters }),
    writeContentComponent(projectPath, 'items', 'items', COMPONENT_FORMATS.items, { items: project.items }),
    writeContentComponent(projectPath, 'assets', 'assets', COMPONENT_FORMATS.assets, { assets: project.assets }),
    writeContentComponent(projectPath, 'relationship-graph', 'relationship-graph', COMPONENT_FORMATS.relationshipGraph, { relationshipGraph: project.relationshipGraph }),
    writeContentComponent(projectPath, 'scene-flow', 'scene-flow', COMPONENT_FORMATS.sceneFlow, { sceneFlow: project.sceneFlow }),
  ]);

  const chapterReferences = [];
  for (const chapter of project.chapters) {
    const sceneReferences = [];
    for (const scene of chapter.scenes) {
      const reference = await writeContentComponent(projectPath, 'scenes', scene.id, COMPONENT_FORMATS.scene, { scene });
      sceneReferences.push({ id: scene.id, ...reference });
    }
    const chapterReference = await writeContentComponent(projectPath, 'chapters', chapter.id, COMPONENT_FORMATS.chapter, {
      id: chapter.id, title: chapter.title, status: chapter.status, scenes: sceneReferences, branches: chapter.branches || [],
    });
    chapterReferences.push({ id: chapter.id, ...chapterReference });
  }
  const chaptersReference = await writeContentComponent(projectPath, 'chapter-index', 'chapters', COMPONENT_FORMATS.chapters, { chapters: chapterReferences });
  return { project: projectReference, characters: charactersReference, items: itemsReference, assets: assetsReference, relationshipGraph: relationshipReference, sceneFlow: flowReference, chapters: chaptersReference };
}

async function findValidPreviousProject(target) {
  for (const candidatePath of [target, `${target}.backup`]) {
    try { return await readCandidate(target, candidatePath); } catch {}
  }
  return null;
}

async function replaceManifest(target, manifest, shouldBackupPrimary) {
  const temporaryPath = `${target}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  const backupPath = `${target}.backup`;
  await writeJson(temporaryPath, manifest);
  if (shouldBackupPrimary) await fs.copyFile(target, backupPath);
  try {
    await fs.rm(target, { force: true });
    await fs.rename(temporaryPath, target);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    try { await fs.access(target); } catch { await fs.copyFile(backupPath, target).catch(() => {}); }
    throw error;
  }
}

async function collectV2References(projectPath, manifest) {
  const references = new Set();
  if (!isV2Manifest(manifest)) return references;
  const add = (reference) => { if (reference?.file) references.add(reference.file); };
  Object.values(manifest.files || {}).forEach(add);
  try {
    const chapterIndex = await readV2Component(projectPath, manifest.files.chapters, COMPONENT_FORMATS.chapters, '章节索引');
    for (const chapterReference of chapterIndex.chapters || []) {
      add(chapterReference);
      const chapter = await readV2Component(projectPath, chapterReference, COMPONENT_FORMATS.chapter, '章节数据');
      (chapter.scenes || []).forEach(add);
    }
  } catch {}
  return references;
}

async function listJsonFiles(root, current = root) {
  let entries = [];
  try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(root, target));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
  }
  return files;
}

async function cleanupComponents(projectPath, currentManifest, backupManifest) {
  const keep = new Set([...(await collectV2References(projectPath, currentManifest)), ...(await collectV2References(projectPath, backupManifest))]);
  const root = path.join(projectRoot(projectPath), DATA_DIRECTORY, COMPONENTS_DIRECTORY);
  for (const file of await listJsonFiles(root)) {
    const relative = toPortablePath(path.relative(projectRoot(projectPath), file));
    if (!keep.has(relative)) await fs.rm(file, { force: true });
  }
  if (!isV1Manifest(backupManifest)) await fs.rm(path.join(projectRoot(projectPath), DATA_DIRECTORY, REVISIONS_DIRECTORY), { recursive: true, force: true }).catch(() => {});
}

async function writeProjectFile(projectPath, data) {
  const target = path.resolve(projectPath);
  const project = normalizeProject({ ...data, updatedAt: new Date().toISOString() });
  const revision = createRevisionId();
  const files = await writeV2Components(target, project);
  const previous = await findValidPreviousProject(target);
  const shouldBackupPrimary = previous?.candidatePath === target;
  const manifest = { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, storage: STORAGE_FORMAT, title: project.title, updatedAt: project.updatedAt, revision, root: toPortablePath(DATA_DIRECTORY, COMPONENTS_DIRECTORY), files };
  await replaceManifest(target, manifest, shouldBackupPrimary);
  let backupManifest = null;
  try { backupManifest = await readJson(`${target}.backup`); } catch {}
  await cleanupComponents(target, manifest, backupManifest).catch(() => {});
  return { filePath: target, data: project, storage: STORAGE_FORMAT, revision, recoveredFromBackup: false };
}

module.exports = {
  MANIFEST_FORMAT, MANIFEST_VERSION, STORAGE_FORMAT, LEGACY_STORAGE_FORMAT,
  isSplitManifest, readProjectFile, resolveProjectReference, writeProjectFile,
};
