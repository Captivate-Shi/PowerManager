export const palettes = [['graphite', '石墨白'], ['ice', '冰蓝灰'], ['warm', '暖钛灰']] as const;
export type Palette = typeof palettes[number][0];
const paletteKey = 'yudian.appearance.palette';

export function readPalette(): Palette {
  try {
    const value = localStorage.getItem(paletteKey);
    return palettes.find(([id]) => id === value)?.[0] ?? 'graphite';
  } catch { return 'graphite'; }
}

export function applyMainPalette(palette: Palette) {
  // Radix portals are mounted under body, outside the Dashboard subtree.
  document.documentElement.dataset.mainTheme = palette;
}

export function savePalette(palette: Palette) {
  try { localStorage.setItem(paletteKey, palette); } catch { /* The current window still keeps the choice. */ }
}
