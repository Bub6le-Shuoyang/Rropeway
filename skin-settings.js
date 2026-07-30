(function initSkinSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RropewaySkinSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const FONT_FAMILIES = ['system', 'serif', 'rounded', 'mono'];
  const BACKGROUND_SIZES = ['cover', 'contain', 'auto'];
  const BACKGROUND_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

  const BUILTIN_SKINS = Object.freeze({
    paper: Object.freeze({
      presetId: 'paper',
      name: '暖纸书房',
      description: '偏白米色纸张与克制的橙红重点色',
      mode: 'light',
      accent: '#e7654f',
      background: '#f5f1e7',
      surface: '#fffdf7',
      sidebar: '#ece9df',
      chrome: '#f7f3e9',
      text: '#303432',
      muted: '#858b86',
      border: '#ddd8cc',
      card: '#fffefa',
      panelOpacity: 94,
      backgroundOpacity: 42,
      backgroundBlur: 0,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      radius: 8,
      density: 100,
      fontFamily: 'system',
      backgroundId: '',
      backgroundName: '',
    }),
    midnight: Object.freeze({
      presetId: 'midnight',
      name: '深海夜航',
      description: '低亮墨蓝工作区与暖珊瑚强调色',
      mode: 'dark',
      accent: '#ef8068',
      background: '#151a1d',
      surface: '#22282c',
      sidebar: '#1b2124',
      chrome: '#171c1f',
      text: '#e8ece9',
      muted: '#9aa49f',
      border: '#394247',
      card: '#252c30',
      panelOpacity: 93,
      backgroundOpacity: 36,
      backgroundBlur: 0,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      radius: 7,
      density: 96,
      fontFamily: 'system',
      backgroundId: '',
      backgroundName: '',
    }),
  });

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function color(value, fallback) {
    const normalized = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : fallback;
  }

  function presetSkin(presetId) {
    const preset = BUILTIN_SKINS[presetId] || BUILTIN_SKINS.paper;
    return { ...preset };
  }

  function normalizeSkinSettings(value = {}) {
    const presetId = value.presetId === 'midnight' ? 'midnight' : value.presetId === 'custom' ? 'custom' : 'paper';
    const base = presetId === 'custom'
      ? (value.mode === 'dark' ? BUILTIN_SKINS.midnight : BUILTIN_SKINS.paper)
      : BUILTIN_SKINS[presetId];
    return {
      presetId,
      name: String(value.name || (presetId === 'custom' ? '自定义皮肤' : base.name)).slice(0, 60),
      description: String(value.description || base.description).slice(0, 160),
      mode: ['light', 'dark'].includes(value.mode) ? value.mode : base.mode,
      accent: color(value.accent, base.accent),
      background: color(value.background, base.background),
      surface: color(value.surface, base.surface),
      sidebar: color(value.sidebar, base.sidebar),
      chrome: color(value.chrome, base.chrome),
      text: color(value.text, base.text),
      muted: color(value.muted, base.muted),
      border: color(value.border, base.border),
      card: color(value.card, base.card),
      panelOpacity: clamp(value.panelOpacity, 45, 100, base.panelOpacity),
      backgroundOpacity: clamp(value.backgroundOpacity, 0, 100, base.backgroundOpacity),
      backgroundBlur: clamp(value.backgroundBlur, 0, 20, base.backgroundBlur),
      backgroundSize: BACKGROUND_SIZES.includes(value.backgroundSize) ? value.backgroundSize : base.backgroundSize,
      backgroundPosition: BACKGROUND_POSITIONS.includes(value.backgroundPosition) ? value.backgroundPosition : base.backgroundPosition,
      radius: clamp(value.radius, 0, 18, base.radius),
      density: clamp(value.density, 85, 110, base.density),
      fontFamily: FONT_FAMILIES.includes(value.fontFamily) ? value.fontFamily : base.fontFamily,
      backgroundId: /^[a-f0-9-]{36}\.(png|jpe?g|webp)$/i.test(String(value.backgroundId || '')) ? String(value.backgroundId) : '',
      backgroundName: String(value.backgroundName || '').slice(0, 180),
    };
  }

  return {
    BACKGROUND_POSITIONS,
    BACKGROUND_SIZES,
    BUILTIN_SKINS,
    FONT_FAMILIES,
    normalizeSkinSettings,
    presetSkin,
  };
});
