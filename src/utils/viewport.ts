/**
 * Viewport calculation utilities for PocketFrame
 * Handles letterbox/pillarbox layout for video display
 */

import { calculateProcessingResolution } from './resolution';

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportOptions {
  sourceWidth?: number;
  sourceHeight?: number;
  snapToIntegerScale?: boolean;
}

/**
 * Calculate letterbox/pillarbox viewport for displaying content with preserved aspect ratio.
 * Returns viewport coordinates and dimensions that fit the content within a container
 * while preserving the target aspect ratio.
 *
 * @param containerWidth - Width of the container
 * @param containerHeight - Height of the container
 * @param targetAspectRatio - Aspect ratio of the content to display (width/height)
 * @returns Viewport with position and dimensions
 */
export function calculateLetterboxViewport(
  containerWidth: number,
  containerHeight: number,
  targetAspectRatio: number,
  options: ViewportOptions = {}
): Viewport {
  if (options.snapToIntegerScale && options.sourceWidth && options.sourceHeight) {
    const maxScale = Math.min(
      containerWidth / options.sourceWidth,
      containerHeight / options.sourceHeight
    );

    if (Number.isFinite(maxScale) && maxScale >= 1) {
      const integerScale = Math.max(1, Math.floor(maxScale));
      const width = Math.max(1, Math.floor(options.sourceWidth * integerScale));
      const height = Math.max(1, Math.floor(options.sourceHeight * integerScale));
      const x = Math.floor((containerWidth - width) / 2);
      const y = Math.floor((containerHeight - height) / 2);
      return { x, y, width, height };
    }
  }

  const containerAspect = containerWidth / containerHeight;

  let width: number;
  let height: number;
  let x: number;
  let y: number;

  if (containerAspect > targetAspectRatio) {
    // Container is wider than content - pillarbox (black bars on sides)
    height = containerHeight;
    width = Math.round(height * targetAspectRatio);
    x = Math.round((containerWidth - width) / 2);
    y = 0;
  } else {
    // Container is taller than content - letterbox (black bars top/bottom)
    width = containerWidth;
    height = Math.round(width / targetAspectRatio);
    x = 0;
    y = Math.round((containerHeight - height) / 2);
  }

  return { x, y, width, height };
}

/**
 * Calculate preview viewport in CSS pixels using the same model as WebGL rendering:
 * processing-resolution aspect ratio + integer scale snapping + DPR-aware sizing.
 */
export function calculatePreviewViewportCss(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  ditherMode?: string,
  dpr: number = 1
): Viewport {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }

  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const { width: processWidth, height: processHeight } = calculateProcessingResolution(
    sourceWidth,
    sourceHeight,
    ditherMode
  );

  const deviceViewport = calculateLetterboxViewport(
    containerWidth * safeDpr,
    containerHeight * safeDpr,
    processWidth / processHeight,
    {
      sourceWidth: processWidth,
      sourceHeight: processHeight,
      snapToIntegerScale: true,
    }
  );

  return {
    x: deviceViewport.x / safeDpr,
    y: deviceViewport.y / safeDpr,
    width: deviceViewport.width / safeDpr,
    height: deviceViewport.height / safeDpr,
  };
}
