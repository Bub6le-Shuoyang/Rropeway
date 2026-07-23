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
test('旁白块无需角色字段即可保存', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'narration', text: '雨声逐渐停了。', character: '不应保留' }] }] }] });
  const block = project.chapters[0].scenes[0].blocks[0];
  assert.match(block.id, /^narration-/);
  assert.equal(block.type, 'narration');
  assert.equal(block.text, '雨声逐渐停了。');
});

test('损坏或空项目会被补齐为可编辑结构', () => {
  const project = normalizeProject({ title: 123, chapters: [{ title: null, scenes: null }] });
  assert.equal(project.title, '123');
  assert.equal(project.chapters[0].title, '第 1 章');
  assert.equal(project.chapters[0].scenes.length, 1);
  assert.deepEqual(project.chapters[0].scenes[0].blocks, []);
});

test('自定义项目名称会在项目数据中保留', () => {
  const project = normalizeProject({ title: '星港调查局', description: '一部本地悬疑剧本' });
  assert.equal(project.title, '星港调查局');
  assert.equal(project.description, '一部本地悬疑剧本');
});

test('素材会保留项目内路径、二次命名和归档标签', () => {
  const project = normalizeProject({ assets: [{ name: '码头夜景（重命名）', fileName: 'assets/a.png', tags: ['背景', ' 背景 ', '夜景'] }] });
  assert.equal(project.assets[0].name, '码头夜景（重命名）');
  assert.equal(project.assets[0].relativePath, 'assets/a.png');
  assert.equal(project.assets[0].fileName, 'assets/a.png');
  assert.deepEqual(project.assets[0].tags, ['背景', '夜景']);
});
test('角色代表色和默认立绘会被规范化保存', () => {
  const project = normalizeProject({ characters: [{ name: '角色A', color: '#12abef', portraitPreset: 'short-female', description: '测试角色', avatars: ['assets/characters/a/avatars/normal.png'], portraits: [{ id: 'portrait-smile', name: '微笑', alias: '调查状态', relativePath: 'assets/characters/a/portraits/smile.png' }] }] });
  assert.equal(project.characters[0].color, '#12abef');
  assert.equal(project.characters[0].portraitPreset, 'short-female');
  assert.equal(project.characters[0].description, '测试角色');
  assert.equal(project.characters[0].avatarGroup[0].relativePath, 'assets/characters/a/avatars/normal.png');
  assert.equal(project.characters[0].portraitGroup[0].name, '微笑');
  assert.equal(project.characters[0].portraitGroup[0].originalName, '微笑');
  assert.equal(project.characters[0].portraitGroup[0].alias, '调查状态');
  assert.equal(project.characters[0].defaultAvatarId, project.characters[0].avatarGroup[0].id);
  assert.equal(project.characters[0].defaultPortraitId, 'portrait-smile');
});

test('对白多个状态标签和角色标识会被保存', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', character: '角色A', characterId: 'character-a', statusTags: ['压低声音', '关键节点', '受伤', '受伤', ''] }] }] }] });
  const block = project.chapters[0].scenes[0].blocks[0];
  assert.equal(block.characterId, 'character-a');
  assert.deepEqual(block.statusTags, ['关键节点', '压低声音', '受伤']);
});

test('对白允许不设置角色', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', text: '稍后再分配角色' }] }] }] });
  const block = project.chapters[0].scenes[0].blocks[0];
  assert.equal(block.character, '');
  assert.equal(block.characterId, '');
  assert.equal(block.characterColor, '#b8bcb8');
});

test('旧情绪标签会迁移为状态标签并支持分段主视角', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', emotion: '紧张' }, { type: 'segment', title: '调查开始', perspectiveCharacterId: 'character-a' }] }] }] });
  assert.deepEqual(project.chapters[0].scenes[0].blocks[0].statusTags, ['紧张']);
  const segment = project.chapters[0].scenes[0].blocks[1];
  assert.match(segment.id, /^segment-/);
  assert.equal(segment.title, '调查开始');
  assert.equal(segment.perspectiveCharacterId, 'character-a');
  assert.deepEqual(segment.images, []);
});

test('分段图片会保存素材引用并过滤无效路径', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'segment', images: [{ id: 'image-a', assetId: 'asset-a', name: '线索板', relativePath: 'assets/clue.png' }, { name: '无效图片' }] }] }] }] });
  assert.deepEqual(project.chapters[0].scenes[0].blocks[0].images, [{ id: 'image-a', assetId: 'asset-a', name: '线索板', relativePath: 'assets/clue.png' }]);
});

test('对白文字格式字段会被保存并校正对齐方式', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [{ type: 'dialogue', text: '重点', textHtml: '<b>重点</b>', textAlign: 'center', note: '这里需要停顿', avatar: 'assets/characters/a/avatars/smile.png' }, { type: 'dialogue', text: '码头', textHtml: '<ruby>码头<rt>地点</rt></ruby>' }, { type: 'dialogue', textAlign: 'invalid' }] }] }] });
  assert.equal(project.chapters[0].scenes[0].blocks[0].textHtml, '<b>重点</b>');
  assert.equal(project.chapters[0].scenes[0].blocks[0].textAlign, 'center');
  assert.equal(project.chapters[0].scenes[0].blocks[0].note, '这里需要停顿');
  assert.equal(project.chapters[0].scenes[0].blocks[0].avatar, 'assets/characters/a/avatars/smile.png');
  assert.equal(project.chapters[0].scenes[0].blocks[1].textHtml, '<ruby>码头<rt>地点</rt></ruby>');
  assert.equal(project.chapters[0].scenes[0].blocks[2].textAlign, 'left');
});

test('玩家选择会迁移旧选项并保存关键节点关联', () => {
  const project = normalizeProject({ chapters: [{ scenes: [{ blocks: [
    { id: 'dialogue-key', type: 'dialogue', statusTags: ['关键节点'], text: '抵达灯塔' },
    { id: 'choice-a', type: 'choice', title: '选择路线', options: ['走海岸', { id: 'option-b', text: '进入隧道', targetBlockId: 'dialogue-key' }] }
  ] }] }] });
  const [dialogue, choice] = project.chapters[0].scenes[0].blocks;
  assert.equal(dialogue.id, 'dialogue-key');
  assert.equal(choice.id, 'choice-a');
  assert.equal(choice.options[0].text, '走海岸');
  assert.equal(choice.options[0].targetBlockId, '');
  assert.deepEqual(choice.options[1], { id: 'option-b', text: '进入隧道', targetBlockId: 'dialogue-key' });
});

test('角色关系图会保存节点位置并过滤无效关系', () => {
  const project = normalizeProject({
    characters: [{ id: 'character-a', name: '角色A' }, { id: 'character-b', name: '角色B' }],
    relationshipGraph: {
      positions: { 'character-a': { x: 0.2, y: 0.3 }, missing: { x: 0.5, y: 0.5 } },
      relationships: [
        { id: 'relation-a', sourceCharacterId: 'character-a', targetCharacterId: 'character-b', label: '搭档', color: '#12abef' },
        { sourceCharacterId: 'character-a', targetCharacterId: 'missing' }
      ]
    }
  });
  assert.deepEqual(project.relationshipGraph.positions['character-a'], { x: 0.2, y: 0.3 });
  assert.equal(project.relationshipGraph.relationships.length, 1);
  assert.equal(project.relationshipGraph.relationships[0].label, '搭档');
});
