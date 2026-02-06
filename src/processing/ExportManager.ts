import { getVideoProcessor, type ProcessingSettings } from './VideoProcessor';
import { encodeMp4, extractAudioFromVideo, type AudioExportSettings } from './encoders/Mp4Encoder';
import { encodeGif } from './encoders/GifEncoder';
import { encodePngSequence } from './encoders/PngEncoder';
import type { ExportFormat } from '../state/store';

export interface SourceVideoDimensions {
  width: number;
  height: number;
}

export interface TrimRange {
  start: number; // 0-1 as percentage of duration
  end: number;   // 0-1 as percentage of duration
}

export interface ExportOptions {
  format: ExportFormat;
  fps: number;
  settings: ProcessingSettings;
  enableAudioBitcrush: boolean;
  audioSettings?: AudioExportSettings;
  sourceVideoDimensions?: SourceVideoDimensions;
  trimRange?: TrimRange;
  onProgress: (progress: number) => void;
}

export async function exportVideo(
  videoElement: HTMLVideoElement,
  options: ExportOptions
): Promise<Blob> {
  const { format, fps, settings, enableAudioBitcrush, audioSettings, sourceVideoDimensions, trimRange, onProgress } = options;
  const processor = getVideoProcessor();

  processor.setSettings(settings);

  // Get source dimensions from video element if not provided
  const sourceDims = sourceVideoDimensions || {
    width: videoElement.videoWidth,
    height: videoElement.videoHeight,
  };

  // Calculate trim times
  const duration = videoElement.duration;
  const startTime = trimRange ? trimRange.start * duration : 0;
  const endTime = trimRange ? trimRange.end * duration : duration;

  // Extract frames (0-50% of progress)
  const frames = await processor.extractFrames(
    videoElement,
    fps,
    (p) => onProgress(p * 0.5),
    startTime,
    endTime
  );

  // Encode based on format (50-100% of progress)
  let blob: Blob;

  switch (format) {
    case 'mp4': {
      // Extract audio from original video using FFmpeg
      console.log('Starting MP4 export, video src:', videoElement.src);
      console.log('Audio bitcrush enabled:', enableAudioBitcrush);
      console.log('Trim range:', startTime, '-', endTime);

      let audioBlob: Blob | null = null;
      try {
        audioBlob = await extractAudioFromVideo(videoElement.src, startTime, endTime);
        console.log('Audio extraction result:', audioBlob ? `Blob size: ${audioBlob.size}` : 'null');
      } catch (e) {
        console.warn('Could not extract audio:', e);
      }

      blob = await encodeMp4(
        frames,
        fps,
        audioBlob,
        enableAudioBitcrush,
        (p) => onProgress(0.5 + p * 0.5),
        audioSettings,
        sourceDims
      );
      break;
    }
    case 'gif': {
      blob = await encodeGif(
        frames,
        fps,
        (p) => onProgress(0.5 + p * 0.5),
        sourceDims
      );
      break;
    }
    case 'png': {
      blob = await encodePngSequence(
        frames,
        (p) => onProgress(0.5 + p * 0.5),
        sourceDims
      );
      break;
    }
  }

  return blob;
}

export function getExportFilename(originalName: string, format: ExportFormat): string {
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  const suffix = '_pocketframe';

  switch (format) {
    case 'mp4':
      return `${baseName}${suffix}.mp4`;
    case 'gif':
      return `${baseName}${suffix}.gif`;
    case 'png':
      return `${baseName}${suffix}_frames.zip`;
  }
}

export function getExportFilters(format: ExportFormat) {
  switch (format) {
    case 'mp4':
      return [{ name: 'MP4 Video', extensions: ['mp4'] }];
    case 'gif':
      return [{ name: 'GIF Animation', extensions: ['gif'] }];
    case 'png':
      return [{ name: 'ZIP Archive', extensions: ['zip'] }];
  }
}
