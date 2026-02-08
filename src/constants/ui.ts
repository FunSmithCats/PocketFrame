/**
 * UI Constants for PocketFrame
 * Centralizes magic numbers and configuration values
 */

// Split slider constraints and keyboard step
export const SPLIT_SLIDER = {
  MIN: 0.05,
  MAX: 0.95,
  KEYBOARD_STEP: 0.02,
  KEYBOARD_LARGE_STEP: 0.1,
} as const;

// Timeline slider configuration
export const TIMELINE = {
  THUMBNAIL_HEIGHT: 40,
  THUMBNAIL_COUNT: 12,
  HANDLE_WIDTH: 10,
  // Reduced throttle for more responsive scrubbing (8ms = ~120fps max)
  // fastSeek() is very fast, so we can afford more frequent seeks
  SEEK_THROTTLE_MS: 8,
  MIN_TRIM_DISTANCE: 0.02,
  KEYBOARD_STEP: 0.01,
  KEYBOARD_LARGE_STEP: 0.05,
} as const;

// Sidebar slider configurations
export const SLIDERS = {
  CONTRAST: { MIN: 0.5, MAX: 2.0, STEP: 0.05 },
  CAMERA_RESPONSE: { MIN: 0, MAX: 1, STEP: 0.05 },
  FRAME_RATE: { MIN: 10, MAX: 60, STEP: 1 },
  LCD_GRID: { MIN: 0, MAX: 1, STEP: 0.05 },
  LCD_SHADOW: { MIN: 0, MAX: 1, STEP: 0.05 },
  LCD_GHOSTING: { MIN: 0, MAX: 0.5, STEP: 0.02 },
  LCD_BLACK_LEVEL: { MIN: 0, MAX: 0.15, STEP: 0.01 },
  AUDIO_HIGHPASS: { MIN: 100, MAX: 1000, STEP: 50 },
  AUDIO_LOWPASS: { MIN: 2000, MAX: 6000, STEP: 100 },
  AUDIO_BIT_DEPTH: { MIN: 4, MAX: 8, STEP: 1 },
  AUDIO_DISTORTION: { MIN: 0, MAX: 100, STEP: 5 },
} as const;
