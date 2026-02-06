export type PaletteColor = [number, number, number];
export type Palette = [PaletteColor, PaletteColor, PaletteColor, PaletteColor];

export const PALETTES: Record<string, Palette> = {
  '1989Green': [
    [15, 56, 15],
    [48, 98, 48],
    [139, 172, 15],
    [155, 188, 15],
  ],
  'PocketGrey': [
    [0, 0, 0],
    [85, 85, 85],
    [170, 170, 170],
    [255, 255, 255],
  ],
  'MidnightBlue': [
    [13, 17, 43],
    [48, 58, 105],
    [107, 130, 165],
    [192, 203, 220],
  ],
  'HighContrastBW': [
    [0, 0, 0],
    [64, 64, 64],
    [192, 192, 192],
    [255, 255, 255],
  ],
  'RedBlack': [
    [0, 0, 0],
    [85, 0, 0],
    [170, 0, 0],
    [255, 0, 0],
  ],
};

export const PALETTE_NAMES = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

export type PaletteName = keyof typeof PALETTES;

export function getPaletteAsFloat(name: PaletteName, invert: boolean = false): Float32Array {
  const palette = PALETTES[name];
  const result = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    // When inverted, read from the opposite end of the palette
    const srcIdx = invert ? 3 - i : i;
    result[i * 3] = palette[srcIdx][0] / 255;
    result[i * 3 + 1] = palette[srcIdx][1] / 255;
    result[i * 3 + 2] = palette[srcIdx][2] / 255;
  }
  return result;
}
