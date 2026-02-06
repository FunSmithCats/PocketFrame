/**
 * Viewport calculation utilities for PocketFrame
 * Handles letterbox/pillarbox layout for video display
 */

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
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
  targetAspectRatio: number
): Viewport {
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
