import { create } from 'zustand';
import type { PaletteName } from '../palettes';

export type DitherMode = 'none' | 'bayer2x2' | 'bayer4x4' | 'floydSteinberg';

export type ExportFormat = 'mp4' | 'gif' | 'png';

interface VideoInfo {
  src: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
}

interface AppState {
  // Video state
  videoInfo: VideoInfo | null;
  videoElement: HTMLVideoElement | null;
  isPlaying: boolean;
  currentTime: number;

  // Processing settings
  contrast: number;
  ditherMode: DitherMode;
  palette: PaletteName;
  invertPalette: boolean;
  targetFps: number;

  // Audio settings (for real-time preview and export)
  audioHighpass: number;
  audioLowpass: number;
  audioBitDepth: number;
  audioDistortion: number;

  // UI state
  splitPosition: number;
  showControls: boolean;
  isExporting: boolean;
  exportProgress: number;
  exportFormat: ExportFormat;
  enableAudioBitcrush: boolean;

  // LCD effect settings
  lcdGridIntensity: number;
  lcdShadowOpacity: number;
  lcdGhostingStrength: number;
  lcdBaselineAlpha: number;
  enableLcdEffects: boolean;

  // Trim settings (0-1 as percentage of video duration)
  trimStart: number;
  trimEnd: number;
  isScrubbing: boolean; // True when user is dragging timeline

  // Actions
  setVideoInfo: (info: VideoInfo | null) => void;
  setVideoElement: (element: HTMLVideoElement | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setContrast: (contrast: number) => void;
  setDitherMode: (mode: DitherMode) => void;
  setPalette: (palette: PaletteName) => void;
  setInvertPalette: (invert: boolean) => void;
  setTargetFps: (fps: number) => void;
  setAudioHighpass: (freq: number) => void;
  setAudioLowpass: (freq: number) => void;
  setAudioBitDepth: (bits: number) => void;
  setAudioDistortion: (amount: number) => void;
  setSplitPosition: (position: number) => void;
  setShowControls: (show: boolean) => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number) => void;
  setExportFormat: (format: ExportFormat) => void;
  setEnableAudioBitcrush: (enable: boolean) => void;
  setLcdGridIntensity: (value: number) => void;
  setLcdShadowOpacity: (value: number) => void;
  setLcdGhostingStrength: (value: number) => void;
  setLcdBaselineAlpha: (value: number) => void;
  setEnableLcdEffects: (enable: boolean) => void;
  setTrimStart: (value: number) => void;
  setTrimEnd: (value: number) => void;
  setIsScrubbing: (isScrubbing: boolean) => void;
  reset: () => void;
}

const initialState = {
  videoInfo: null,
  videoElement: null as HTMLVideoElement | null,
  isPlaying: false,
  currentTime: 0,
  contrast: 1.0,
  ditherMode: 'bayer4x4' as DitherMode,
  palette: '1989Green' as PaletteName,
  invertPalette: false,
  targetFps: 30,
  // Audio settings (Game Boy speaker simulation defaults)
  audioHighpass: 500,    // Hz - removes bass
  audioLowpass: 3500,    // Hz - removes sparkle
  audioBitDepth: 6,      // bits
  audioDistortion: 30,   // percent (soft clipping)
  splitPosition: 0.5,
  showControls: true,
  isExporting: false,
  exportProgress: 0,
  exportFormat: 'mp4' as ExportFormat,
  enableAudioBitcrush: false,
  // LCD effect defaults
  lcdGridIntensity: 0.7,
  lcdShadowOpacity: 0.35,
  lcdGhostingStrength: 0.3,
  lcdBaselineAlpha: 0.05,
  enableLcdEffects: true,
  // Trim defaults (full video)
  trimStart: 0,
  trimEnd: 1,
  isScrubbing: false,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setVideoInfo: (info) => set({ videoInfo: info }),
  setVideoElement: (element) => set({ videoElement: element }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setContrast: (contrast) => set({ contrast }),
  setDitherMode: (mode) => set({ ditherMode: mode }),
  setPalette: (palette) => set({ palette }),
  setInvertPalette: (invert) => set({ invertPalette: invert }),
  setTargetFps: (fps) => set({ targetFps: fps }),
  setAudioHighpass: (freq) => set({ audioHighpass: freq }),
  setAudioLowpass: (freq) => set({ audioLowpass: freq }),
  setAudioBitDepth: (bits) => set({ audioBitDepth: bits }),
  setAudioDistortion: (amount) => set({ audioDistortion: amount }),
  setSplitPosition: (position) => set({ splitPosition: position }),
  setShowControls: (show) => set({ showControls: show }),
  setIsExporting: (exporting) => set({ isExporting: exporting }),
  setExportProgress: (progress) => set({ exportProgress: progress }),
  setExportFormat: (format) => set({ exportFormat: format }),
  setEnableAudioBitcrush: (enable) => set({ enableAudioBitcrush: enable }),
  setLcdGridIntensity: (value) => set({ lcdGridIntensity: value }),
  setLcdShadowOpacity: (value) => set({ lcdShadowOpacity: value }),
  setLcdGhostingStrength: (value) => set({ lcdGhostingStrength: value }),
  setLcdBaselineAlpha: (value) => set({ lcdBaselineAlpha: value }),
  setEnableLcdEffects: (enable) => set({ enableLcdEffects: enable }),
  setTrimStart: (value) => set({ trimStart: Math.max(0, Math.min(value, 1)) }),
  setTrimEnd: (value) => set({ trimEnd: Math.max(0, Math.min(value, 1)) }),
  setIsScrubbing: (isScrubbing) => set({ isScrubbing }),
  reset: () => set(initialState),
}));

// Selector hooks for performance
export const useVideoInfo = () => useAppStore((s) => s.videoInfo);
export const useIsPlaying = () => useAppStore((s) => s.isPlaying);
export const useContrast = () => useAppStore((s) => s.contrast);
export const useDitherMode = () => useAppStore((s) => s.ditherMode);
export const usePalette = () => useAppStore((s) => s.palette);
export const useInvertPalette = () => useAppStore((s) => s.invertPalette);
export const useTargetFps = () => useAppStore((s) => s.targetFps);
export const useAudioHighpass = () => useAppStore((s) => s.audioHighpass);
export const useAudioLowpass = () => useAppStore((s) => s.audioLowpass);
export const useAudioBitDepth = () => useAppStore((s) => s.audioBitDepth);
export const useAudioDistortion = () => useAppStore((s) => s.audioDistortion);
export const useSplitPosition = () => useAppStore((s) => s.splitPosition);
export const useShowControls = () => useAppStore((s) => s.showControls);
export const useIsExporting = () => useAppStore((s) => s.isExporting);
export const useExportProgress = () => useAppStore((s) => s.exportProgress);
export const useLcdGridIntensity = () => useAppStore((s) => s.lcdGridIntensity);
export const useLcdShadowOpacity = () => useAppStore((s) => s.lcdShadowOpacity);
export const useLcdGhostingStrength = () => useAppStore((s) => s.lcdGhostingStrength);
export const useLcdBaselineAlpha = () => useAppStore((s) => s.lcdBaselineAlpha);
export const useEnableLcdEffects = () => useAppStore((s) => s.enableLcdEffects);
export const useTrimStart = () => useAppStore((s) => s.trimStart);
export const useTrimEnd = () => useAppStore((s) => s.trimEnd);
export const useIsScrubbing = () => useAppStore((s) => s.isScrubbing);
