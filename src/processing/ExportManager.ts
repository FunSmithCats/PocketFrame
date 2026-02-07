import { getVideoProcessor, type ProcessingSettings } from './VideoProcessor';
import { encodeMp4, extractAudioFromVideo, muxMp4WithSourceAudio, type AudioExportSettings } from './encoders/Mp4Encoder';
import { WebCodecsEncoder, isWebCodecsSupported } from './encoders/WebCodecsEncoder';
import { encodeGif } from './encoders/GifEncoder';
import { encodePngSequence } from './encoders/PngEncoder';
import type { ExportFormat } from '../state/store';

function isMacEnvironment(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /Macintosh|Mac OS X/i.test(userAgent) || /Mac/i.test(platform);
}

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
  onPhaseProgress?: (phase: 'load' | 'extract' | 'encode' | 'write', value: number) => void;
}

export async function exportVideo(
  videoElement: HTMLVideoElement,
  options: ExportOptions
): Promise<Blob> {
  const {
    format,
    fps,
    settings,
    enableAudioBitcrush,
    audioSettings,
    sourceVideoDimensions,
    trimRange,
    onProgress,
    onPhaseProgress
  } = options;
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

  let blob: Blob;

  switch (format) {
    case 'mp4': {
      const isMac = isMacEnvironment();
      const webCodecsAllowed = !isMac;
      console.log(`MP4 export encoder selection: webCodecsAllowed=${webCodecsAllowed}, isMac=${isMac}`);
      const webCodecsSupport = webCodecsAllowed
        ? await isWebCodecsSupported()
        : { supported: false, reason: 'Disabled on macOS for export stability' };

      if (webCodecsSupport.supported) {
        console.log('Using WebCodecs streaming export for MP4');

        const needsAudio = !!videoElement.src;

        processor.setSourceVideoDimensions(videoElement.videoWidth, videoElement.videoHeight);
        const processingDims = processor.getProcessingDimensions();
        const encoder = new WebCodecsEncoder({
          fps,
          frameWidth: processingDims.width,
          frameHeight: processingDims.height,
        });

        let webCodecsVideoBlob: Blob | null = null;

        try {
          await processor.extractFramesStreaming(
            videoElement,
            fps,
            async (frame) => {
              await encoder.encodeFrame(frame);
            },
            (p) => {
              onPhaseProgress?.('extract', p);
              onProgress(Math.min(0.88, p * 0.88));
            },
            startTime,
            endTime
          );

          onPhaseProgress?.('extract', 1);
          onPhaseProgress?.('encode', 0.5);
          onProgress(0.9);
          webCodecsVideoBlob = await encoder.finalize();
          onPhaseProgress?.('encode', 0.8);
        } catch (error) {
          encoder.close();
          console.warn('WebCodecs export failed, falling back to FFmpeg:', error);
        }

        if (webCodecsVideoBlob) {
          blob = webCodecsVideoBlob;

          if (needsAudio) {
            try {
              onProgress(0.92);
              blob = await muxMp4WithSourceAudio(
                webCodecsVideoBlob,
                videoElement.src,
                startTime,
                endTime,
                enableAudioBitcrush,
                audioSettings,
                (p) => {
                  onPhaseProgress?.('encode', 0.8 + p * 0.2);
                  onProgress(0.92 + p * 0.08);
                }
              );
            } catch (audioMuxError) {
              console.warn('Audio mux failed for WebCodecs export, returning video-only MP4:', audioMuxError);
            }
          }

          onPhaseProgress?.('encode', 1);
          onProgress(1);
          break;
        }
      } else {
        console.warn('WebCodecs not supported, falling back to FFmpeg export:', webCodecsSupport.reason);
      }

      console.log('Starting MP4 export (FFmpeg), video src:', videoElement.src);
      console.log('Audio bitcrush enabled:', enableAudioBitcrush);
      console.log('Trim range:', startTime, '-', endTime);

      // Start audio extraction in parallel with frame extraction
      const audioPromise = extractAudioFromVideo(videoElement.src, startTime, endTime)
        .catch((e) => { console.warn('Could not extract audio:', e); return null; });

      const frames = await processor.extractFrames(
        videoElement,
        fps,
        (p) => {
          onPhaseProgress?.('extract', p);
          onProgress(p * 0.5);
        },
        startTime,
        endTime
      );
      onPhaseProgress?.('extract', 1);

      const audioBlob = await audioPromise;
      console.log('Audio extraction result:', audioBlob ? `Blob size: ${audioBlob.size}` : 'null');

      blob = await encodeMp4(
        frames,
        fps,
        audioBlob,
        enableAudioBitcrush,
        (p) => {
          onPhaseProgress?.('encode', p);
          onProgress(0.5 + p * 0.5);
        },
        audioSettings,
        sourceDims
      );
      onPhaseProgress?.('encode', 1);
      break;
    }
    case 'gif': {
      const frames = await processor.extractFrames(
        videoElement,
        fps,
        (p) => {
          onPhaseProgress?.('extract', p);
          onProgress(p * 0.5);
        },
        startTime,
        endTime
      );
      onPhaseProgress?.('extract', 1);
      blob = await encodeGif(
        frames,
        fps,
        (p) => {
          onPhaseProgress?.('encode', p);
          onProgress(0.5 + p * 0.5);
        },
        sourceDims
      );
      onPhaseProgress?.('encode', 1);
      break;
    }
    case 'png': {
      const frames = await processor.extractFrames(
        videoElement,
        fps,
        (p) => {
          onPhaseProgress?.('extract', p);
          onProgress(p * 0.5);
        },
        startTime,
        endTime
      );
      onPhaseProgress?.('extract', 1);
      blob = await encodePngSequence(
        frames,
        (p) => {
          onPhaseProgress?.('encode', p);
          onProgress(0.5 + p * 0.5);
        },
        sourceDims
      );
      onPhaseProgress?.('encode', 1);
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
