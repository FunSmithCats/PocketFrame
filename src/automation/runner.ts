import { exportVideo } from '../processing/ExportManager';
import { calculateOutputDimensions, calculateProcessingResolution } from '../utils';
import {
  parseAndValidateJob,
  resolveJobForSource,
  type AutomationStartPayload,
  type ResolvedAutomationJob,
} from './job';

export interface AutomationEvent {
  type: string;
  [key: string]: unknown;
}

interface LoadedVideo {
  element: HTMLVideoElement;
  source: {
    name: string;
    width: number;
    height: number;
    duration: number;
    estimatedFps: number;
  };
  cleanup: () => void;
}

function getFileNameFromPath(pathValue: string): string {
  const segments = pathValue.split(/[\\/]/);
  return segments[segments.length - 1] || 'video';
}

function getDimensions(job: ResolvedAutomationJob) {
  const processing = calculateProcessingResolution(
    job.source.width,
    job.source.height,
    job.settings.processing.ditherMode
  );
  const output = calculateOutputDimensions(
    job.source.width,
    job.source.height,
    'mp4',
    job.settings.processing.ditherMode
  );

  return {
    processing,
    output,
  };
}

async function loadVideo(inputPath: string): Promise<LoadedVideo> {
  const api = window.electronAPI;
  if (!api) {
    throw new Error('Electron API unavailable in automation mode');
  }

  const src = await api.toFileURL(inputPath);
  const video = document.createElement('video');
  video.className = 'hidden';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  const cleanup = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  };

  const loaded = await new Promise<LoadedVideo>((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);

      resolve({
        element: video,
        source: {
          name: getFileNameFromPath(inputPath),
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          estimatedFps: 60,
        },
        cleanup,
      });
    };

    const onError = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      reject(new Error(`Failed to load input video: ${inputPath}`));
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });

    video.src = src;
    document.body.appendChild(video);
    video.load();
  });

  if (!Number.isFinite(loaded.source.duration) || loaded.source.duration <= 0) {
    loaded.cleanup();
    throw new Error('Input video metadata is invalid (duration <= 0)');
  }

  return loaded;
}

function toResolvedSettingsPayload(job: ResolvedAutomationJob) {
  return {
    targetFps: job.settings.targetFps,
    processing: {
      contrast: job.settings.processing.contrast,
      cameraResponse: job.settings.processing.cameraResponse,
      cropRegion: { ...job.settings.processing.cropRegion },
      ditherMode: job.settings.processing.ditherMode,
      palette: job.settings.processing.palette,
      invertPalette: job.settings.processing.invertPalette,
      lcd: { ...job.settings.processing.lcd },
    },
    enableAudioBitcrush: job.settings.enableAudioBitcrush,
    audio: { ...job.settings.audio },
    trim: { ...job.settings.trim },
  };
}

export async function runAutomationCommand(
  start: AutomationStartPayload,
  emit: (event: AutomationEvent) => void
): Promise<void> {
  emit({
    type: 'progress',
    phase: 'load',
    value: 0,
  });

  const parsedJob = await parseAndValidateJob(start);

  let loaded: LoadedVideo | null = null;

  try {
    loaded = await loadVideo(parsedJob.inputPath);
    const resolved = resolveJobForSource(start.command, parsedJob, loaded.source);
    const dimensions = getDimensions(resolved);

    emit({
      type: 'job_validated',
      command: start.command,
      schemaVersion: resolved.schemaVersion,
      format: resolved.format,
      inputPath: resolved.inputPath,
      outputPath: resolved.outputPath,
      source: resolved.source,
      dimensions,
      resolvedSettings: toResolvedSettingsPayload(resolved),
    });

    emit({
      type: 'progress',
      phase: 'load',
      value: 1,
    });

    if (start.command === 'inspect') {
      emit({
        type: 'inspect_result',
        command: start.command,
        source: resolved.source,
        dimensions,
        resolvedSettings: toResolvedSettingsPayload(resolved),
      });
      return;
    }

    if (!resolved.outputPath) {
      throw new Error('outputPath is required for run command');
    }

    const startedAt = Date.now();

    const blob = await exportVideo(loaded.element, {
      format: 'mp4',
      fps: resolved.settings.targetFps,
      settings: resolved.settings.processing,
      enableAudioBitcrush: resolved.settings.enableAudioBitcrush,
      audioSettings: {
        highpass: resolved.settings.audio.highpass,
        lowpass: resolved.settings.audio.lowpass,
        bitDepth: resolved.settings.audio.bitDepth,
        distortion: resolved.settings.audio.distortion,
      },
      sourceVideoDimensions: {
        width: resolved.source.width,
        height: resolved.source.height,
      },
      trimRange: {
        start: resolved.settings.trim.startPercent,
        end: resolved.settings.trim.endPercent,
      },
      onProgress: () => {
        // Keep UI progress support in ExportManager without emitting duplicate CLI events.
      },
      onPhaseProgress: (phase, value) => {
        emit({
          type: 'progress',
          phase,
          value,
        });
      },
    });

    emit({
      type: 'progress',
      phase: 'write',
      value: 0,
    });

    const arrayBuffer = await blob.arrayBuffer();
    const writeResult = await window.electronAPI?.writeFile(resolved.outputPath, arrayBuffer);
    if (!writeResult || !writeResult.success) {
      throw new Error(writeResult?.error || `Failed to write output file: ${resolved.outputPath}`);
    }

    emit({
      type: 'progress',
      phase: 'write',
      value: 1,
    });

    emit({
      type: 'job_complete',
      outputPath: resolved.outputPath,
      bytesWritten: blob.size,
      durationMs: Date.now() - startedAt,
      source: resolved.source,
      dimensions,
      resolvedSettings: toResolvedSettingsPayload(resolved),
    });
  } finally {
    loaded?.cleanup();
  }
}
