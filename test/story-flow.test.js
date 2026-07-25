const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSceneTransitions, flattenProjectScenes, nextSequentialSceneLocation, normalizeSceneFlow } = require('../story-flow');

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
