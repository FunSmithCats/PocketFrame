// Floyd-Steinberg Error Diffusion Dither Worker

import { floydSteinbergDither } from '../processing/dither/floydSteinberg';
import type { Palette } from '../palettes';

interface WorkerMessage {
  pixels: Uint8Array;
  width: number;
  height: number;
  palette: Palette;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { pixels, width, height, palette } = e.data;

  const result = floydSteinbergDither(pixels, width, height, palette);

  self.postMessage({ pixels: result }, { transfer: [result.buffer] });
};

export {};
