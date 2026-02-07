import JSZip from 'jszip';
import type { FrameData } from '../VideoProcessor';
import type { SourceVideoDimensions } from '../ExportManager';
import { calculateScaledDimensions } from '../../utils';
import { EXPORT_SCALE } from '../../constants';

export async function encodePngSequence(
  frames: FrameData[],
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
  const outputDims = calculateScaledDimensions(frameWidth, frameHeight, EXPORT_SCALE.HIGH_QUALITY);

  console.log('PNG frame dimensions:', frameWidth, 'x', frameHeight, '-> Output:', outputDims);

  const zip = new JSZip();

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
    throw new Error('Failed to get 2D canvas context');
  }

  // Disable image smoothing for nearest-neighbor scaling (crisp pixels)
  outCtx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // Convert RGBA pixels to ImageData on source canvas
    const imageData = srcCtx.createImageData(frameWidth, frameHeight);
    // Pixels are already in correct orientation from RenderPipeline
    imageData.data.set(frame.pixels);
    // Ensure alpha is fully opaque
    for (let i = 3; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255;
    }

    srcCtx.putImageData(imageData, 0, 0);

    // Scale to output canvas (direct scale, no letterboxing needed)
    outCtx.drawImage(srcCanvas, 0, 0, outputDims.width, outputDims.height);

    // Convert output canvas to PNG blob
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((blob) => resolve(blob), 'image/png');
    });

    if (!pngBlob) {
      throw new Error(`Failed to create PNG blob for frame ${i + 1}`);
    }

    // Add to zip with zero-padded filename
    const frameNum = String(i + 1).padStart(5, '0');
    zip.file(`frame_${frameNum}.png`, pngBlob);

    onProgress((i + 1) / frames.length);
  }

  return zip.generateAsync({ type: 'blob' });
}
