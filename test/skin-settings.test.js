const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_SKINS, normalizeSkinSettings, presetSkin } = require('../skin-settings');

test('内置皮肤包含暖纸书房和深海夜航两套完整配置', () => {
  assert.deepEqual(Object.keys(BUILTIN_SKINS), ['paper', 'midnight']);
  assert.equal(presetSkin('paper').mode, 'light');
  assert.equal(presetSkin('midnight').mode, 'dark');
  assert.match(presetSkin('paper').accent, /^#[0-9a-f]{6}$/);
  assert.match(presetSkin('midnight').surface, /^#[0-9a-f]{6}$/);
});

test('自定义皮肤会校正颜色、透明度、模糊和布局范围', () => {
  const skin = normalizeSkinSettings({
    presetId: 'custom',
    mode: 'dark',
    accent: '#12ABEF',
    background: 'invalid',
    panelOpacity: 12,
    backgroundOpacity: 140,
    backgroundBlur: 99,
    radius: -5,
    density: 120,
    fontFamily: 'mono',
  });
  assert.equal(skin.accent, '#12abef');
  assert.equal(skin.background, BUILTIN_SKINS.midnight.background);
  assert.equal(skin.panelOpacity, 45);
  assert.equal(skin.backgroundOpacity, 100);
  assert.equal(skin.backgroundBlur, 20);
  assert.equal(skin.radius, 0);
  assert.equal(skin.density, 110);
  assert.equal(skin.fontFamily, 'mono');
});

test('皮肤背景只接受应用生成的安全文件标识', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000.webp';
  assert.equal(normalizeSkinSettings({ presetId: 'custom', backgroundId: validId }).backgroundId, validId);
  assert.equal(normalizeSkinSettings({ presetId: 'custom', backgroundId: '../outside.png' }).backgroundId, '');
  assert.equal(normalizeSkinSettings({ presetId: 'custom', backgroundId: 'image.svg' }).backgroundId, '');
});
