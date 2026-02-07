import GIF from 'gif.js';
import type { FrameData } from '../VideoProcessor';
import type { SourceVideoDimensions } from '../ExportManager';
import { calculateScaledDimensions } from '../../utils';
import { EXPORT_SCALE } from '../../constants';

export async function encodeGif(
  frames: FrameData[],
  fps: number,
  onProgress: (progress: number) => void,
  _sourceDims?: SourceVideoDimensions
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error('No frames to encode');
  }

  // Get dimensions from frame data (already calculated by VideoProcessor)
  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;

  // Calculate output dimensions based on frame dimensions
  const outputDims = calculateScaledDimensions(frameWidth, frameHeight, EXPORT_SCALE.GIF);

  console.log('GIF frame dimensions:', frameWidth, 'x', frameHeight, '-> Output:', outputDims);

  return new Promise((resolve, reject) => {
    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: outputDims.width,
      height: outputDims.height,
      workerScript: '/gif.worker.js',
    });

    // Source canvas for reading frame data
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = frameWidth;
    srcCanvas.height = frameHeight;
    const srcCtx = srcCanvas.getContext('2d');

    // Output canvas for scaled frames
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outputDims.width;
    outCanvas.height = outputDims.height;
    const outCtx = outCanvas.getContext('2d');

    if (!srcCtx || !outCtx) {
      reject(new Error('Failed to get 2D canvas context'));
      return;
    }

    // Disable image smoothing for nearest-neighbor scaling (crisp pixels)
    outCtx.imageSmoothingEnabled = false;

    const delay = Math.round(1000 / fps);

    for (const frame of frames) {
      // Convert RGBA pixels to ImageData on source canvas
      const imageData = srcCtx.createImageData(frameWidth, frameHeight);
      // Pixels are already in correct orientation from RenderPipeline
      imageData.data.set(frame.pixels);
      // Ensure alpha is fully opaque
      for (let i = 3; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;
      }

      srcCtx.putImageData(imageData, 0, 0);

      // Scale to output canvas (direct scale, no letterboxing needed as frame matches aspect)
      outCtx.drawImage(srcCanvas, 0, 0, outputDims.width, outputDims.height);

      gif.addFrame(outCtx, { copy: true, delay });
    }

    gif.on('progress', (p: number) => onProgress(p));

    gif.on('finished', (blob: Blob) => {
      // Terminate workers to prevent memory leak
      // Access internal freeWorkers array and terminate each worker
      const gifAny = gif as unknown as { freeWorkers: Worker[] };
      if (gifAny.freeWorkers) {
        gifAny.freeWorkers.forEach((worker) => worker.terminate());
        gifAny.freeWorkers.length = 0;
      }
      resolve(blob);
    });

    gif.on('abort', () => {
      // Terminate workers on abort as well
      const gifAny = gif as unknown as { freeWorkers: Worker[] };
      if (gifAny.freeWorkers) {
        gifAny.freeWorkers.forEach((worker) => worker.terminate());
        gifAny.freeWorkers.length = 0;
      }
      reject(new Error('GIF encoding aborted'));
    });

    gif.render();
  });
}
