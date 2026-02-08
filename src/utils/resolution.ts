/**
 * Resolution calculation utilities for PocketFrame
 * Centralizes all processing and output resolution logic
 */

import { BASE_PIXEL_DENSITY, EXPORT_SCALE, GBCAM_SENSOR_HEIGHT, GBCAM_SENSOR_WIDTH } from '../constants';
import type { ExportFormat } from '../state/store';

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Calculate processing resolution based on source aspect ratio.
 * The shorter dimension uses BASE_PIXEL_DENSITY, the longer scales proportionally.
 */
export function calculateProcessingResolution(
  sourceWidth: number,
  sourceHeight: number,
  ditherMode?: string
): Dimensions {
  if (ditherMode === 'gameBoyCamera') {
    return { width: GBCAM_SENSOR_WIDTH, height: GBCAM_SENSOR_HEIGHT };
  }

  const aspectRatio = sourceWidth / sourceHeight;

  if (aspectRatio >= 1) {
    // Landscape or square: height is base, width scales up
    const height = BASE_PIXEL_DENSITY;
    const width = Math.round(height * aspectRatio);
    return { width, height };
  } else {
    // Portrait: width is base, height scales up
    const width = BASE_PIXEL_DENSITY;
    const height = Math.round(width / aspectRatio);
    return { width, height };
  }
}

/**
 * Calculate output dimensions for export based on processing resolution and format.
 * Different formats use different scale factors.
 */
export function calculateOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  format: ExportFormat,
  ditherMode?: string
): Dimensions {
  // First get the processing resolution
  const proc = calculateProcessingResolution(sourceWidth, sourceHeight, ditherMode);

  // Different scale factors for different formats
  const scale = format === 'gif' ? EXPORT_SCALE.GIF : EXPORT_SCALE.HIGH_QUALITY;

  let width = proc.width * scale;
  let height = proc.height * scale;

  // Ensure even dimensions for video encoding (required for H.264)
  if (format === 'mp4') {
    if (width % 2 !== 0) width += 1;
    if (height % 2 !== 0) height += 1;
  }

  return { width, height };
}

/**
 * Calculate scaled output dimensions from frame dimensions.
 * Used by encoders when frame dimensions are already known.
 */
export function calculateScaledDimensions(
  frameWidth: number,
  frameHeight: number,
  scale: number,
  ensureEven: boolean = false
): Dimensions {
  let width = frameWidth * scale;
  let height = frameHeight * scale;

  if (ensureEven) {
    if (width % 2 !== 0) width += 1;
    if (height % 2 !== 0) height += 1;
  }

  return { width, height };
}
