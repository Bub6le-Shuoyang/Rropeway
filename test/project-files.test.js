const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MANIFEST_FORMAT,
  STORAGE_FORMAT,
  readProjectFile,
  writeProjectFile,
} = require('../project-files');

async function createTemporaryProject(testContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rropeway-storage-'));
  testContext.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }));
  return {
    root,
    projectPath: path.join(root, '测试项目.scriptroom'),
  };
}

function projectFixture(title = '分卷存储测试') {
  return {
    title,
    description: '验证每个场景独立保存。',
    characters: [{ id: 'character-a', name: '林夏', color: '#ed6b4d' }],
    items: [{ id: 'item-key', name: '仓库钥匙', tags: ['线索'], summary: '锈迹斑斑。', images: [{ id: 'image-a', name: '正面', relativePath: 'assets/items/item-key/images/front.png' }], coverImageId: 'image-a' }, { id: 'item-box', name: '木盒', tags: ['容器'], images: [] }],
    assets: [{ id: 'asset-a', name: '码头', relativePath: 'assets/images/harbor.png' }],
    chapters: [
      {
        id: 'chapter-a',
        title: '第一章',
        scenes: [
          { id: 'scene-a', number: '01', title: '抵达码头', blocks: [{ id: 'dialogue-a', type: 'dialogue', characterId: 'character-a', character: '林夏', text: '船已经靠岸。' }] },
          { id: 'scene-b', number: '02', title: '进入仓库', blocks: [
            { id: 'narration-a', type: 'narration', text: '门轴发出沉闷的响声。' },
            { id: 'item-instance-a', type: 'item', itemId: 'item-key', investigation: { text: '钥匙背面刻着仓库编号。' }, blocks: [{ id: 'item-dialogue-a', type: 'dialogue', characterId: 'character-a', character: '林夏', text: '正好能打开这扇门。' }, { id: 'item-narration-a', type: 'narration', text: '锁芯轻轻转动。' }, { id: 'nested-item-a', type: 'item', itemId: 'item-box', investigation: { text: '钥匙打开了一个木盒。' }, blocks: [{ id: 'nested-choice-a', type: 'choice', title: '是否查看盒底？', options: [{ id: 'nested-option-a', text: '查看', targetBlockId: '' }] }] }] },
          ] },
        ],
      },
      {
        id: 'chapter-b',
        title: '第二章',
        scenes: [{ id: 'scene-c', number: '01', title: '灯塔', blocks: [] }],
      },
    ],
  };
}

function referencePath(root, reference) {
  return path.join(root, ...reference.file.split('/'));
}

async function readChapterDocuments(root, manifest) {
  const chapterIndex = JSON.parse(await fs.readFile(referencePath(root, manifest.files.chapters), 'utf8'));
  const chapters = await Promise.all(chapterIndex.chapters.map((reference) => fs.readFile(referencePath(root, reference), 'utf8').then(JSON.parse)));
  return { chapterIndex, chapters };
}

test('项目索引保持精简并将每个场景保存为独立 JSON', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const saved = await writeProjectFile(projectPath, projectFixture());
  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));

  assert.equal(manifest.format, MANIFEST_FORMAT);
  assert.equal(manifest.storage, STORAGE_FORMAT);
  assert.equal(manifest.revision, saved.revision);
  assert.equal(Object.hasOwn(manifest, 'chapters'), false);

  assert.equal(manifest.version, 3);
  const { chapterIndex, chapters } = await readChapterDocuments(root, manifest);
  assert.equal(chapterIndex.chapters.length, 2);
  assert.equal(chapters.flatMap((chapter) => chapter.scenes).length, 3);
  const itemDocument = JSON.parse(await fs.readFile(referencePath(root, manifest.files.items), 'utf8'));
  assert.equal(itemDocument.format, 'rropeway-items');
  assert.equal(itemDocument.items[0].name, '仓库钥匙');
  assert.equal(Object.hasOwn(itemDocument.items[0], 'investigation'), false);
  const firstChapter = chapters[0];
  const secondScene = JSON.parse(await fs.readFile(referencePath(root, firstChapter.scenes[1]), 'utf8'));
  assert.equal(secondScene.scene.blocks[1].itemId, 'item-key');
  assert.equal(secondScene.scene.blocks[1].investigation.text, '钥匙背面刻着仓库编号。');
  assert.equal(secondScene.scene.blocks[1].blocks[0].text, '正好能打开这扇门。');
  assert.equal(secondScene.scene.blocks[1].blocks[1].type, 'narration');
  assert.equal(secondScene.scene.blocks[1].blocks[2].itemId, 'item-box');
  assert.equal(secondScene.scene.blocks[1].blocks[2].blocks[0].type, 'choice');
  assert.equal(Object.hasOwn(itemDocument.items[1], 'blocks'), false);

  const opened = await readProjectFile(projectPath);
  assert.equal(opened.storage, STORAGE_FORMAT);
  assert.equal(opened.recoveredFromBackup, false);
  assert.deepEqual(opened.data.chapters.map((chapter) => chapter.scenes.map((scene) => scene.title)), [
    ['抵达码头', '进入仓库'],
    ['灯塔'],
  ]);
  assert.equal(opened.data.items[0].coverImageId, 'image-a');
  assert.equal(opened.data.chapters[0].scenes[1].blocks[1].blocks[2].investigation.text, '钥匙打开了一个木盒。');
});

test('支线触发方式随场景分卷保存且可完整恢复', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const project = projectFixture('支线分卷测试');
  project.chapters[0].branches = [{ id: 'branch-hidden-room', title: '隐藏房间支线', trigger: '调查仓库书架并持有黄铜钥匙', includeInFlow: false }];
  project.chapters[0].scenes.push({
    id: 'branch-hidden-room-1',
    number: '01',
    title: '发现暗门',
    kind: 'branch',
    branchId: 'branch-hidden-room',
    blocks: [{ id: 'branch-dialogue', type: 'narration', text: '暗门缓慢打开。' }],
  });
  project.chapters[0].scenes.push({ id: 'branch-hidden-room-2', number: '02', title: '进入密室', kind: 'branch', branchId: 'branch-hidden-room', blocks: [] });

  await writeProjectFile(projectPath, project);
  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const { chapters } = await readChapterDocuments(root, manifest);
  const firstChapter = chapters[0];
  const branchReference = firstChapter.scenes.find((scene) => scene.id === 'branch-hidden-room-1');
  const branchDocument = JSON.parse(await fs.readFile(referencePath(root, branchReference), 'utf8'));
  assert.equal(branchDocument.scene.kind, 'branch');
  assert.equal(branchDocument.scene.branchId, 'branch-hidden-room');
  assert.equal(Object.hasOwn(branchDocument.scene, 'branchTrigger'), false);
  assert.deepEqual(firstChapter.branches, project.chapters[0].branches);

  const opened = await readProjectFile(projectPath);
  const branch = opened.data.chapters[0].branches[0];
  const scenes = opened.data.chapters[0].scenes.filter((scene) => scene.branchId === branch.id);
  assert.equal(branch.trigger, '调查仓库书架并持有黄铜钥匙');
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].blocks[0].text, '暗门缓慢打开。');
});

test('未修改的组件按内容复用，备份仍指向上一索引', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const first = await writeProjectFile(projectPath, projectFixture('第一版'));
  const second = await writeProjectFile(projectPath, projectFixture('第二版'));
  const firstManifest = JSON.parse(await fs.readFile(`${projectPath}.backup`, 'utf8'));
  const secondManifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const firstChapters = await readChapterDocuments(root, firstManifest);
  const secondChapters = await readChapterDocuments(root, secondManifest);
  assert.deepEqual(firstChapters.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.hash)), secondChapters.chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.hash)));
  await assert.rejects(() => fs.access(path.join(root, 'project-data', 'revisions')));
  const backupManifest = JSON.parse(await fs.readFile(`${projectPath}.backup`, 'utf8'));
  assert.equal(backupManifest.revision, first.revision);
  assert.equal(secondManifest.revision, second.revision);
  const opened = await readProjectFile(projectPath);
  assert.equal(opened.data.title, '第二版');
});

test('修改单个场景时只生成该场景及其索引的新组件', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  await writeProjectFile(projectPath, projectFixture('局部保存'));
  const beforeManifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const before = await readChapterDocuments(root, beforeManifest);
  const changed = projectFixture('局部保存');
  changed.chapters[0].scenes[0].blocks[0].text = '只修改第一个场景。';
  await writeProjectFile(projectPath, changed);
  const afterManifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const after = await readChapterDocuments(root, afterManifest);
  assert.notEqual(after.chapters[0].scenes[0].hash, before.chapters[0].scenes[0].hash);
  assert.equal(after.chapters[0].scenes[1].hash, before.chapters[0].scenes[1].hash);
  assert.equal(after.chapters[1].scenes[0].hash, before.chapters[1].scenes[0].hash);
});

test('当前场景文件损坏时自动从上一版项目恢复', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  await writeProjectFile(projectPath, projectFixture('可恢复版本'));
  const changed = projectFixture('损坏版本');
  changed.chapters[0].scenes[0].blocks[0].text = '这是一个只存在于当前版本的修改。';
  await writeProjectFile(projectPath, changed);

  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const { chapters } = await readChapterDocuments(root, manifest);
  const scenePath = referencePath(root, chapters[0].scenes[0]);
  await fs.writeFile(scenePath, '{ invalid json', 'utf8');

  const opened = await readProjectFile(projectPath);
  assert.equal(opened.recoveredFromBackup, true);
  assert.equal(opened.data.title, '可恢复版本');
  assert.match(opened.recoveryReason, /JSON|Unexpected|position/i);
});

test('旧版单文件项目仍可读取并在保存后迁移为分卷格式', async (testContext) => {
  const { projectPath } = await createTemporaryProject(testContext);
  await fs.writeFile(projectPath, JSON.stringify(projectFixture('旧项目')), 'utf8');

  const legacy = await readProjectFile(projectPath);
  assert.equal(legacy.storage, 'legacy-json');
  assert.equal(legacy.data.title, '旧项目');

  await writeProjectFile(projectPath, legacy.data);
  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const legacyBackup = JSON.parse(await fs.readFile(`${projectPath}.backup`, 'utf8'));
  assert.equal(manifest.storage, STORAGE_FORMAT);
  assert.equal(legacyBackup.title, '旧项目');
});

test('split-json-v1 项目可读取并在保存后升级为内容寻址格式', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const revision = 'legacy-v1-revision';
  const revisionRoot = path.join(root, 'project-data', 'revisions', revision);
  const relativeRoot = `project-data/revisions/${revision}`;
  const project = projectFixture('旧分卷项目');
  const writeDocument = async (relativePath, format, values) => {
    const target = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ format, version: 1, revision, ...values }), 'utf8');
  };
  await fs.mkdir(revisionRoot, { recursive: true });
  await Promise.all([
    writeDocument(`${relativeRoot}/project.json`, 'rropeway-project-metadata', { title: project.title, description: project.description, updatedAt: new Date().toISOString() }),
    writeDocument(`${relativeRoot}/characters.json`, 'rropeway-characters', { characters: project.characters }),
    writeDocument(`${relativeRoot}/items.json`, 'rropeway-items', { items: project.items }),
    writeDocument(`${relativeRoot}/assets.json`, 'rropeway-assets', { assets: project.assets }),
    writeDocument(`${relativeRoot}/relationship-graph.json`, 'rropeway-relationship-graph', { relationshipGraph: {} }),
    writeDocument(`${relativeRoot}/scene-flow.json`, 'rropeway-scene-flow', { sceneFlow: {} }),
    writeDocument(`${relativeRoot}/scenes/scene-a.json`, 'rropeway-scene', { scene: project.chapters[0].scenes[0] }),
    writeDocument(`${relativeRoot}/chapters/chapter-a.json`, 'rropeway-chapter', { id: 'chapter-a', title: '第一章', status: '草稿', branches: [], scenes: [{ id: 'scene-a', file: `${relativeRoot}/scenes/scene-a.json` }] }),
    writeDocument(`${relativeRoot}/chapters.json`, 'rropeway-chapter-index', { chapters: [{ id: 'chapter-a', file: `${relativeRoot}/chapters/chapter-a.json` }] }),
  ]);
  await fs.writeFile(projectPath, JSON.stringify({
    format: MANIFEST_FORMAT, version: 2, storage: 'split-json-v1', revision, root: relativeRoot,
    files: {
      project: `${relativeRoot}/project.json`, characters: `${relativeRoot}/characters.json`, items: `${relativeRoot}/items.json`, assets: `${relativeRoot}/assets.json`,
      relationshipGraph: `${relativeRoot}/relationship-graph.json`, sceneFlow: `${relativeRoot}/scene-flow.json`, chapters: `${relativeRoot}/chapters.json`,
    },
  }), 'utf8');

  const opened = await readProjectFile(projectPath);
  assert.equal(opened.storage, 'split-json-v1');
  assert.equal(opened.data.chapters[0].scenes[0].title, '抵达码头');
  await writeProjectFile(projectPath, opened.data);
  assert.equal(JSON.parse(await fs.readFile(projectPath, 'utf8')).storage, STORAGE_FORMAT);
});

test('项目索引不能读取项目文件夹之外的文件', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const outsidePath = path.join(path.dirname(root), `outside-${Date.now()}.json`);
  testContext.after(() => fs.rm(outsidePath, { force: true }));
  await fs.writeFile(outsidePath, '{}', 'utf8');
  await fs.writeFile(projectPath, JSON.stringify({
    format: MANIFEST_FORMAT,
    version: 3,
    storage: STORAGE_FORMAT,
    revision: 'unsafe',
    files: {
      project: { file: `../${path.basename(outsidePath)}`, hash: 'a'.repeat(64) },
      characters: { file: 'project-data/characters.json', hash: 'a'.repeat(64) },
      assets: { file: 'project-data/assets.json', hash: 'a'.repeat(64) },
      relationshipGraph: { file: 'project-data/relationship.json', hash: 'a'.repeat(64) },
      sceneFlow: { file: 'project-data/flow.json', hash: 'a'.repeat(64) },
      chapters: { file: 'project-data/chapters.json', hash: 'a'.repeat(64) },
    },
  }), 'utf8');

  await assert.rejects(() => readProjectFile(projectPath), /越界文件路径|备份恢复也失败/);
});
