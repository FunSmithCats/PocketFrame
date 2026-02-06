// Floyd-Steinberg Error Diffusion Dither Worker

interface WorkerMessage {
  pixels: Uint8Array;
  width: number;
  height: number;
  palette: number[][];
}

// Find closest palette color
function findClosestColor(r: number, g: number, b: number, palette: number[][]): number {
  let minDist = Infinity;
  let closestIdx = 0;

  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const dist = dr * dr + dg * dg + db * db;

    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }

  return closestIdx;
}

// Floyd-Steinberg error diffusion
function floydSteinbergDither(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: number[][]
): Uint8Array {
  // Create working copy as float array for error accumulation
  const buffer = new Float32Array(width * height * 3);

  // Convert input to grayscale and store in buffer
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    // Luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    buffer[i * 3] = lum;
    buffer[i * 3 + 1] = lum;
    buffer[i * 3 + 2] = lum;
  }

  // Output buffer
  const output = new Uint8Array(width * height * 4);

  // Process each pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;

      // Get current pixel value (clamped)
      const oldR = Math.max(0, Math.min(255, buffer[idx]));
      const oldG = Math.max(0, Math.min(255, buffer[idx + 1]));
      const oldB = Math.max(0, Math.min(255, buffer[idx + 2]));

      // Find closest palette color
      const paletteIdx = findClosestColor(oldR, oldG, oldB, palette);
      const newR = palette[paletteIdx][0];
      const newG = palette[paletteIdx][1];
      const newB = palette[paletteIdx][2];

      // Store output
      const outIdx = (y * width + x) * 4;
      output[outIdx] = newR;
      output[outIdx + 1] = newG;
      output[outIdx + 2] = newB;
      output[outIdx + 3] = 255;

      // Calculate error
      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      // Distribute error to neighbors
      // Floyd-Steinberg coefficients: 7/16, 3/16, 5/16, 1/16

      // Right neighbor (x+1, y)
      if (x + 1 < width) {
        const nIdx = idx + 3;
        buffer[nIdx] += errR * 7 / 16;
        buffer[nIdx + 1] += errG * 7 / 16;
        buffer[nIdx + 2] += errB * 7 / 16;
      }

      // Bottom-left neighbor (x-1, y+1)
      if (x > 0 && y + 1 < height) {
        const nIdx = ((y + 1) * width + (x - 1)) * 3;
        buffer[nIdx] += errR * 3 / 16;
        buffer[nIdx + 1] += errG * 3 / 16;
        buffer[nIdx + 2] += errB * 3 / 16;
      }

      // Bottom neighbor (x, y+1)
      if (y + 1 < height) {
        const nIdx = ((y + 1) * width + x) * 3;
        buffer[nIdx] += errR * 5 / 16;
        buffer[nIdx + 1] += errG * 5 / 16;
        buffer[nIdx + 2] += errB * 5 / 16;
      }

      // Bottom-right neighbor (x+1, y+1)
      if (x + 1 < width && y + 1 < height) {
        const nIdx = ((y + 1) * width + (x + 1)) * 3;
        buffer[nIdx] += errR * 1 / 16;
        buffer[nIdx + 1] += errG * 1 / 16;
        buffer[nIdx + 2] += errB * 1 / 16;
      }
    }
  }

  return output;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { pixels, width, height, palette } = e.data;

  const result = floydSteinbergDither(pixels, width, height, palette);

  self.postMessage({ pixels: result }, { transfer: [result.buffer] });
};

export {};
