import type { Palette, PaletteColor } from '../../palettes';

interface MutableRgb {
  r: number;
  g: number;
  b: number;
}

function findClosestColorIndex(r: number, g: number, b: number, palette: readonly PaletteColor[]): number {
  let closestIdx = 0;
  let minDistance = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = dr * dr + dg * dg + db * db;

    if (distance < minDistance) {
      minDistance = distance;
      closestIdx = i;
    }
  }

  return closestIdx;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function addError(
  buffer: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  error: MutableRgb,
  factor: number
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }

  const index = (y * width + x) * 3;
  if (index < 0 || index + 2 >= buffer.length) {
    return;
  }

  buffer[index] += error.r * factor;
  buffer[index + 1] += error.g * factor;
  buffer[index + 2] += error.b * factor;
}

export function floydSteinbergDither(pixels: Uint8Array, width: number, height: number, palette: Palette): Uint8Array {
  const pixelCount = width * height;
  const working = new Float32Array(pixelCount * 3);

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    working[dstIdx] = pixels[srcIdx];
    working[dstIdx + 1] = pixels[srcIdx + 1];
    working[dstIdx + 2] = pixels[srcIdx + 2];
  }

  const output = new Uint8Array(pixelCount * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;

      const oldR = clampChannel(working[idx]);
      const oldG = clampChannel(working[idx + 1]);
      const oldB = clampChannel(working[idx + 2]);

      const colorIdx = findClosestColorIndex(oldR, oldG, oldB, palette);
      const color = palette[colorIdx];

      const outIdx = (y * width + x) * 4;
      output[outIdx] = color[0];
      output[outIdx + 1] = color[1];
      output[outIdx + 2] = color[2];
      output[outIdx + 3] = 255;

      const error: MutableRgb = {
        r: oldR - color[0],
        g: oldG - color[1],
        b: oldB - color[2],
      };

      addError(working, width, height, x + 1, y, error, 7 / 16);
      addError(working, width, height, x - 1, y + 1, error, 3 / 16);
      addError(working, width, height, x, y + 1, error, 5 / 16);
      addError(working, width, height, x + 1, y + 1, error, 1 / 16);
    }
  }

  return output;
}
