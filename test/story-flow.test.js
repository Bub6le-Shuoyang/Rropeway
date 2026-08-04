const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSceneTransitions, flattenFlowScenes, flattenProjectBranches, flattenProjectScenes, nextSequentialSceneLocation, normalizeSceneFlow } = require('../story-flow');

const chapters = [
  { id: 'chapter-a', title: '第一章', scenes: [{ id: 'scene-a', title: '起点' }, { id: 'scene-b', title: '岔路' }] },
  { id: 'chapter-b', title: '第二章', scenes: [{ id: 'scene-c', title: '结局' }] }
];

test('默认流程按项目中的章节和场景顺序连接', () => {
  assert.deepEqual(flattenProjectScenes(chapters).map((item) => item.id), ['scene-a', 'scene-b', 'scene-c']);
  assert.deepEqual(defaultSceneTransitions(chapters), [
    { sourceSceneId: 'scene-a', targetSceneId: 'scene-b' },
    { sourceSceneId: 'scene-b', targetSceneId: 'scene-c' }
  ]);
});

test('场景流程支持跨章节非线性顺序和无限坐标', () => {
  const flow = normalizeSceneFlow({
    positions: { 'scene-a': { x: -1.2, y: 2.4 }, missing: { x: 0, y: 0 } },
    transitions: [
      { sourceSceneId: 'scene-a', targetSceneId: 'scene-c' },
      { sourceSceneId: 'scene-c', targetSceneId: 'scene-b' },
      { sourceSceneId: 'scene-a', targetSceneId: 'scene-b' },
      { sourceSceneId: 'scene-b', targetSceneId: 'missing' }
    ],
    startSceneId: 'scene-c',
    viewport: { centerX: 1.4, centerY: -0.6, zoom: 4 }
  }, chapters);
  assert.deepEqual(flow.positions['scene-a'], { x: -1.2, y: 2.4 });
  assert.deepEqual(flow.transitions, [
    { sourceSceneId: 'scene-a', targetSceneId: 'scene-c' },
    { sourceSceneId: 'scene-c', targetSceneId: 'scene-b' }
  ]);
  assert.equal(flow.startSceneId, 'scene-c');
  assert.deepEqual(flow.viewport, { centerX: 1.4, centerY: -0.6, zoom: 2.2 });
});

test('显式清空顺序连接会保留无连接流程', () => {
  assert.deepEqual(normalizeSceneFlow({ transitions: [] }, chapters).transitions, []);
});

test('章节预览只在当前章节内顺序切换场景', () => {
  assert.deepEqual(nextSequentialSceneLocation(chapters, 0, 0, true), { chapterIndex: 0, sceneIndex: 1 });
  assert.equal(nextSequentialSceneLocation(chapters, 0, 1, true), null);
  assert.deepEqual(nextSequentialSceneLocation(chapters, 0, 1, false), { chapterIndex: 1, sceneIndex: 0 });
});

test('支线默认不进入流程图，手动加入后才参与流程', () => {
  const projectChapters = [{
    id: 'chapter-a',
    scenes: [
      { id: 'scene-a', title: '主线起点' },
      { id: 'branch-a', title: '隐藏房间', kind: 'branch', includeInFlow: false },
      { id: 'scene-b', title: '主线终点' },
      { id: 'branch-b', title: '已加入支线', kind: 'branch', includeInFlow: true }
    ]
  }];
  assert.deepEqual(flattenProjectScenes(projectChapters).map((item) => item.id), ['scene-a', 'branch-a', 'scene-b', 'branch-b']);
  assert.deepEqual(flattenFlowScenes(projectChapters).map((item) => item.id), ['scene-a', 'scene-b', 'branch-b']);
  assert.deepEqual(defaultSceneTransitions(projectChapters), [
    { sourceSceneId: 'scene-a', targetSceneId: 'scene-b' },
    { sourceSceneId: 'scene-b', targetSceneId: 'branch-b' }
  ]);
  const flow = normalizeSceneFlow({
    transitions: [
      { sourceSceneId: 'scene-a', targetSceneId: 'branch-a' },
      { sourceSceneId: 'scene-a', targetSceneId: 'scene-b' },
      { sourceSceneId: 'scene-b', targetSceneId: 'branch-b' }
    ]
  }, projectChapters);
  assert.deepEqual(flow.transitions, [
    { sourceSceneId: 'scene-a', targetSceneId: 'scene-b' },
    { sourceSceneId: 'scene-b', targetSceneId: 'branch-b' }
  ]);
});

test('普通章节预览跳过支线场景', () => {
  const projectChapters = [{ scenes: [
    { id: 'scene-a' },
    { id: 'branch-a', kind: 'branch' },
    { id: 'scene-b' }
  ] }];
  assert.deepEqual(nextSequentialSceneLocation(projectChapters, 0, 0, true), { chapterIndex: 0, sceneIndex: 2 });
  assert.deepEqual(nextSequentialSceneLocation(projectChapters, 0, 0, true, true), { chapterIndex: 0, sceneIndex: 1 });
});

test('一条支线可包含多个独立场景并由支线分组统一控制流程参与状态', () => {
  const projectChapters = [{
    id: 'chapter-a',
    title: '第一章',
    branches: [{ id: 'branch-a', title: '密室支线', trigger: '获得钥匙', includeInFlow: false }],
    scenes: [
      { id: 'scene-a', title: '主线' },
      { id: 'branch-a-1', title: '发现暗门', kind: 'branch', branchId: 'branch-a' },
      { id: 'branch-a-2', title: '进入密室', kind: 'branch', branchId: 'branch-a' }
    ]
  }];
  const [branch] = flattenProjectBranches(projectChapters);
  assert.equal(branch.branch.title, '密室支线');
  assert.deepEqual(branch.scenes.map((item) => item.id), ['branch-a-1', 'branch-a-2']);
  assert.deepEqual(flattenFlowScenes(projectChapters).map((item) => item.id), ['scene-a']);
  projectChapters[0].branches[0].includeInFlow = true;
  assert.deepEqual(flattenFlowScenes(projectChapters).map((item) => item.id), ['scene-a', 'branch-a-1', 'branch-a-2']);
});
