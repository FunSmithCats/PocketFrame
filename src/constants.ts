/**
 * Shared constants for PocketFrame
 */

// Base pixel density - the shorter dimension will use this value for processing resolution
export const BASE_PIXEL_DENSITY = 144;

// Game Boy Camera sensor capture area
export const GBCAM_SENSOR_WIDTH = 128;
export const GBCAM_SENSOR_HEIGHT = 112;
export const GBCAM_CROP_ASPECT = GBCAM_SENSOR_WIDTH / GBCAM_SENSOR_HEIGHT;
export const GBCAM_MIN_CROP_WIDTH_NORM = 0.2;

// Export scale factors
export const EXPORT_SCALE = {
  /** Scale factor for MP4 and PNG exports (4x for high quality) */
  HIGH_QUALITY: 4,
  /** Scale factor for GIF exports (2x to keep file size reasonable) */
  GIF: 2,
} as const;

// Default display dimensions
export const DEFAULT_DISPLAY: { WIDTH: number; HEIGHT: number } = {
  WIDTH: 640,
  HEIGHT: 576,
};

// Video processing defaults
export const PROCESSING_DEFAULTS: { WIDTH: number; HEIGHT: number; ASPECT_RATIO: number } = {
  WIDTH: 160,
  HEIGHT: 144,
  ASPECT_RATIO: 160 / 144,
};

// Export format types
export type ExportScaleType = keyof typeof EXPORT_SCALE;
