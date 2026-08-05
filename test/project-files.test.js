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
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));
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
            { id: 'item-instance-a', type: 'item', itemId: 'item-key', investigation: { text: '钥匙背面刻着仓库编号。' }, blocks: [{ id: 'item-dialogue-a', type: 'dialogue', characterId: 'character-a', character: '林夏', text: '正好能打开这扇门。' }, { id: 'item-narration-a', type: 'narration', text: '锁芯轻轻转动。' }, { id: 'nested-item-a', type: 'item', itemId: 'item-box', investigation: { text: '钥匙打开了一个木盒。' }, blocks: [{ id: 'nested-choice-a', type: 'choice', title: '是否查看盒底？', options: [{ text: '查看', targetBlockId: '' }] }] }] },
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

test('项目索引保持精简并将每个场景保存为独立 JSON', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const saved = await writeProjectFile(projectPath, projectFixture());
  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));

  assert.equal(manifest.format, MANIFEST_FORMAT);
  assert.equal(manifest.storage, STORAGE_FORMAT);
  assert.equal(manifest.revision, saved.revision);
  assert.equal(Object.hasOwn(manifest, 'chapters'), false);

  const revisionRoot = path.join(root, ...manifest.root.split('/'));
  const sceneFiles = await fs.readdir(path.join(revisionRoot, 'scenes'));
  const chapterFiles = await fs.readdir(path.join(revisionRoot, 'chapters'));
  assert.equal(sceneFiles.length, 3);
  assert.equal(chapterFiles.length, 2);
  const itemDocument = JSON.parse(await fs.readFile(path.join(root, ...manifest.files.items.split('/')), 'utf8'));
  assert.equal(itemDocument.format, 'rropeway-items');
  assert.equal(itemDocument.items[0].name, '仓库钥匙');
  assert.equal(Object.hasOwn(itemDocument.items[0], 'investigation'), false);
  const chapterDocument = JSON.parse(await fs.readFile(path.join(root, ...manifest.files.chapters.split('/')), 'utf8'));
  const firstChapter = JSON.parse(await fs.readFile(path.join(root, ...chapterDocument.chapters[0].file.split('/')), 'utf8'));
  const secondScene = JSON.parse(await fs.readFile(path.join(root, ...firstChapter.scenes[1].file.split('/')), 'utf8'));
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
  const chapterDocument = JSON.parse(await fs.readFile(path.join(root, ...manifest.files.chapters.split('/')), 'utf8'));
  const firstChapter = JSON.parse(await fs.readFile(path.join(root, ...chapterDocument.chapters[0].file.split('/')), 'utf8'));
  const branchReference = firstChapter.scenes.find((scene) => scene.id === 'branch-hidden-room-1');
  const branchDocument = JSON.parse(await fs.readFile(path.join(root, ...branchReference.file.split('/')), 'utf8'));
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

test('保存只保留当前与上一版本并让备份指向可恢复版本', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const first = await writeProjectFile(projectPath, projectFixture('第一版'));
  const second = await writeProjectFile(projectPath, projectFixture('第二版'));

  const revisionsPath = path.join(root, 'project-data', 'revisions');
  const revisions = (await fs.readdir(revisionsPath)).sort();
  assert.deepEqual(revisions.sort(), [first.revision, second.revision].sort());

  const backupManifest = JSON.parse(await fs.readFile(`${projectPath}.backup`, 'utf8'));
  assert.equal(backupManifest.revision, first.revision);
  const opened = await readProjectFile(projectPath);
  assert.equal(opened.data.title, '第二版');
});

test('当前场景文件损坏时自动从上一版项目恢复', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  await writeProjectFile(projectPath, projectFixture('可恢复版本'));
  await writeProjectFile(projectPath, projectFixture('损坏版本'));

  const manifest = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  const chapterIndex = JSON.parse(await fs.readFile(path.join(root, ...manifest.files.chapters.split('/')), 'utf8'));
  const chapter = JSON.parse(await fs.readFile(path.join(root, ...chapterIndex.chapters[0].file.split('/')), 'utf8'));
  const scenePath = path.join(root, ...chapter.scenes[0].file.split('/'));
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

test('项目索引不能读取项目文件夹之外的文件', async (testContext) => {
  const { root, projectPath } = await createTemporaryProject(testContext);
  const outsidePath = path.join(path.dirname(root), `outside-${Date.now()}.json`);
  testContext.after(() => fs.rm(outsidePath, { force: true }));
  await fs.writeFile(outsidePath, '{}', 'utf8');
  await fs.writeFile(projectPath, JSON.stringify({
    format: MANIFEST_FORMAT,
    version: 2,
    storage: STORAGE_FORMAT,
    revision: 'unsafe',
    files: {
      project: `../${path.basename(outsidePath)}`,
      characters: 'project-data/characters.json',
      assets: 'project-data/assets.json',
      relationshipGraph: 'project-data/relationship.json',
      sceneFlow: 'project-data/flow.json',
      chapters: 'project-data/chapters.json',
    },
  }), 'utf8');

  await assert.rejects(() => readProjectFile(projectPath), /越界文件路径|备份恢复也失败/);
});
