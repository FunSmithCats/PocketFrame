import { RenderPipeline } from '../webgl/pipeline/RenderPipeline';
import type { DitherMode } from '../state/store';
import { PALETTES, type Palette, type PaletteName } from '../palettes';
import { floydSteinbergDither } from './dither/floydSteinberg';

// Initial canvas size (will be resized when video dimensions are set)
const INITIAL_SIZE = 160;

export interface ProcessingSettings {
  contrast: number;
  ditherMode: DitherMode;
  palette: PaletteName;
  invertPalette: boolean;
  lcd: {
    enabled: boolean;
    gridIntensity: number;
    shadowOpacity: number;
    ghostingStrength: number;
    baselineAlpha: number;
  };
}

export interface FrameData {
  pixels: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
}

export type StreamingFrameHandler = (frame: FrameData) => void | Promise<void>;

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: () => void) => number;
  cancelVideoFrameCallback: (id: number) => void;
};

export class VideoProcessor {
  private canvas: OffscreenCanvas;
  private pipeline: RenderPipeline;
  private processWidth = INITIAL_SIZE;
  private processHeight = INITIAL_SIZE;
  private currentSettings: ProcessingSettings = {
    contrast: 1.0,
    ditherMode: 'bayer4x4',
    palette: '1989Green',
    invertPalette: false,
    lcd: {
      enabled: true,
      gridIntensity: 0.7,
      shadowOpacity: 0.35,
      ghostingStrength: 0.3,
      baselineAlpha: 0.05,
    },
  };

  constructor() {
    this.canvas = new OffscreenCanvas(INITIAL_SIZE, INITIAL_SIZE);
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }

    this.pipeline = new RenderPipeline(gl);
  }

  setSourceVideoDimensions(width: number, height: number): void {
    this.pipeline.setSourceVideoInfo(width, height);
    const dims = this.pipeline.getProcessingDimensions();
    this.processWidth = dims.width;
    this.processHeight = dims.height;
    this.canvas.width = this.processWidth;
    this.canvas.height = this.processHeight;
  }

  setSettings(settings: ProcessingSettings): void {
    this.currentSettings = settings;
    this.pipeline.setContrast(settings.contrast);
    this.pipeline.setDitherMode(settings.ditherMode);
    this.pipeline.setPalette(settings.palette);
    this.pipeline.setInvertPalette(settings.invertPalette);
    this.pipeline.setLcdEffectsEnabled(settings.lcd.enabled);
    this.pipeline.setGridIntensity(settings.lcd.gridIntensity);
    this.pipeline.setShadowOpacity(settings.lcd.shadowOpacity);
    this.pipeline.setGhostingStrength(settings.lcd.ghostingStrength);
    this.pipeline.setBaselineAlpha(settings.lcd.baselineAlpha);
  }

  processFrame(video: HTMLVideoElement): FrameData {
    let pixels: Uint8Array;

    if (this.currentSettings.ditherMode === 'floydSteinberg') {
      this.pipeline.renderProcessed(video);
      const contrastPixels = this.pipeline.getContrastPixels();
      const basePalette = PALETTES[this.currentSettings.palette];
      const palette: Palette = this.currentSettings.invertPalette
        ? [...basePalette].reverse() as Palette
        : basePalette;
      const floydPixels = floydSteinbergDither(
        contrastPixels,
        this.processWidth,
        this.processHeight,
        palette
      );
      this.pipeline.renderExportFromPixels(floydPixels, this.currentSettings.lcd.enabled);
      pixels = this.pipeline.getProcessedPixels();
    } else {
      this.pipeline.renderProcessed(video);
      pixels = this.pipeline.getProcessedPixels();
    }

    return {
      pixels,
      width: this.processWidth,
      height: this.processHeight,
      timestamp: video.currentTime,
    };
  }

  getProcessingDimensions(): { width: number; height: number } {
    return { width: this.processWidth, height: this.processHeight };
  }

  /**
   * Calculate the max safe playback rate for frame capture.
   * At 60Hz display, requestVideoFrameCallback fires ~60 times/sec.
   * To not miss frames: 60 / playbackRate >= targetFps
   */
  private getPlaybackRate(fps: number): number {
    return Math.max(1, Math.min(Math.floor(60 / fps), 8));
  }

  async extractFrames(
    video: HTMLVideoElement,
    fps: number,
    onProgress: (progress: number) => void,
    startTime = 0,
    endTime?: number
  ): Promise<FrameData[]> {
    const duration = video.duration;
    const actualEndTime = endTime ?? duration;
    const trimDuration = actualEndTime - startTime;
    const totalFrames = Math.floor(trimDuration * fps);

    if (duration <= 0 || totalFrames <= 0 || !isFinite(duration)) {
      console.warn('Video has no valid duration, returning empty frames');
      return [];
    }

    const rate = this.getPlaybackRate(fps);
    console.log(`Extracting ${totalFrames} frames at ${rate}x speed from ${startTime.toFixed(2)}s to ${actualEndTime.toFixed(2)}s`);

    this.setSourceVideoDimensions(video.videoWidth, video.videoHeight);

    return this.extractFramesAccelerated(video, fps, startTime, actualEndTime, totalFrames, rate, onProgress);
  }

  async extractFramesStreaming(
    video: HTMLVideoElement,
    fps: number,
    onFrame: StreamingFrameHandler,
    onProgress: (progress: number) => void,
    startTime = 0,
    endTime?: number
  ): Promise<number> {
    const duration = video.duration;
    const actualEndTime = endTime ?? duration;
    const trimDuration = actualEndTime - startTime;
    const totalFrames = Math.floor(trimDuration * fps);

    if (duration <= 0 || totalFrames <= 0 || !isFinite(duration)) {
      console.warn('Video has no valid duration, returning empty stream');
      return 0;
    }

    const rate = this.getPlaybackRate(fps);
    console.log(`Streaming ${totalFrames} frames at ${rate}x speed from ${startTime.toFixed(2)}s to ${actualEndTime.toFixed(2)}s`);

    this.setSourceVideoDimensions(video.videoWidth, video.videoHeight);

    return this.extractFramesAcceleratedStreaming(
      video, fps, startTime, actualEndTime, totalFrames, rate, onFrame, onProgress
    );
  }

  /**
   * Extract frames using accelerated playback with requestVideoFrameCallback.
   * Plays the video at Nx speed and captures frames as they're presented.
   */
  private async extractFramesAccelerated(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    video.pause();
    video.muted = true;

    if (video.readyState < 2) {
      await this.waitForReady(video);
    }

    // Seek to start position
    await this.seekTo(video, startTime);

    const hasRVFC = 'requestVideoFrameCallback' in video;

    if (hasRVFC) {
      return this.extractWithRVFC(video, fps, startTime, endTime, totalFrames, playbackRate, onProgress);
    }

    return this.extractWithRAF(video, fps, startTime, endTime, totalFrames, playbackRate, onProgress);
  }

  private extractWithRVFC(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    return new Promise((resolve, reject) => {
      const frames: FrameData[] = [];
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;
      const vrvfc = video as VideoWithRVFC;

      const timeout = setTimeout(() => {
        video.pause();
        video.playbackRate = 1;
        if (frames.length > 0) {
          console.warn(`Timeout, returning ${frames.length} frames`);
          resolve(frames);
        } else {
          reject(new Error('Frame extraction timed out'));
        }
      }, 120000);

      const done = () => {
        clearTimeout(timeout);
        video.pause();
        video.playbackRate = 1;
        console.log(`Extracted ${frames.length} frames via accelerated playback (${playbackRate}x)`);
        resolve(frames);
      };

      const captureFrame = () => {
        if (frames.length >= totalFrames || video.currentTime >= endTime) {
          done();
          return;
        }

        while (video.currentTime >= nextCaptureTime && frames.length < totalFrames) {
          const frame = this.processFrame(video);
          frames.push(frame);
          nextCaptureTime = startTime + frames.length * frameInterval;
          onProgress(frames.length / totalFrames);
        }

        vrvfc.requestVideoFrameCallback(captureFrame);
      };

      video.addEventListener('ended', done, { once: true });
      video.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Video error during extraction'));
      }, { once: true });

      video.playbackRate = playbackRate;
      vrvfc.requestVideoFrameCallback(captureFrame);
      video.play().catch(reject);
    });
  }

  private extractWithRAF(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    return new Promise((resolve, reject) => {
      const frames: FrameData[] = [];
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;
      let rafId = 0;

      const timeout = setTimeout(() => {
        cancelAnimationFrame(rafId);
        video.pause();
        video.playbackRate = 1;
        if (frames.length > 0) {
          resolve(frames);
        } else {
          reject(new Error('Frame extraction timed out'));
        }
      }, 120000);

      const done = () => {
        clearTimeout(timeout);
        cancelAnimationFrame(rafId);
        video.pause();
        video.playbackRate = 1;
        console.log(`Extracted ${frames.length} frames via RAF fallback (${playbackRate}x)`);
        resolve(frames);
      };

      const tick = () => {
        if (frames.length >= totalFrames || video.currentTime >= endTime || video.paused || video.ended) {
          done();
          return;
        }

        while (video.currentTime >= nextCaptureTime && frames.length < totalFrames) {
          frames.push(this.processFrame(video));
          nextCaptureTime = startTime + frames.length * frameInterval;
          onProgress(frames.length / totalFrames);
        }

        rafId = requestAnimationFrame(tick);
      };

      video.addEventListener('ended', done, { once: true });

      video.playbackRate = playbackRate;
      rafId = requestAnimationFrame(tick);
      video.play().catch(reject);
    });
  }

  /**
   * Streaming extraction with accelerated playback.
   * Captures frames synchronously and queues encoding without pausing the video.
   */
  private async extractFramesAcceleratedStreaming(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onFrame: StreamingFrameHandler,
    onProgress: (progress: number) => void
  ): Promise<number> {
    video.pause();
    video.muted = true;

    if (video.readyState < 2) {
      await this.waitForReady(video);
    }

    await this.seekTo(video, startTime);

    const hasRVFC = 'requestVideoFrameCallback' in video;

    if (hasRVFC) {
      return this.streamWithRVFC(video, fps, startTime, endTime, totalFrames, playbackRate, onFrame, onProgress);
    }

    return this.streamWithRAF(video, fps, startTime, endTime, totalFrames, playbackRate, onFrame, onProgress);
  }

  private streamWithRVFC(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onFrame: StreamingFrameHandler,
    onProgress: (progress: number) => void
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let framesCaptured = 0;
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;
      let settled = false;
      const pendingEncodes: Promise<void>[] = [];
      const vrvfc = video as VideoWithRVFC;

      const finalize = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        video.pause();
        video.playbackRate = 1;
        // Wait for all queued encodes to finish
        Promise.all(pendingEncodes)
          .then(() => {
            console.log(`Streamed ${framesCaptured} frames via accelerated playback (${playbackRate}x)`);
            resolve(framesCaptured);
          })
          .catch(reject);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        video.pause();
        video.playbackRate = 1;
        reject(error);
      };

      const timeout = setTimeout(() => {
        if (framesCaptured > 0) finalize();
        else fail(new Error('Frame streaming timed out'));
      }, 120000);

      const captureFrame = () => {
        if (settled) return;

        if (framesCaptured >= totalFrames || video.currentTime >= endTime) {
          finalize();
          return;
        }

        while (video.currentTime >= nextCaptureTime && framesCaptured < totalFrames) {
          const frame = this.processFrame(video);
          const encodePromise = Promise.resolve(onFrame(frame)).catch((err) => fail(err as Error));
          pendingEncodes.push(encodePromise as Promise<void>);
          framesCaptured++;
          nextCaptureTime = startTime + framesCaptured * frameInterval;
          onProgress(framesCaptured / totalFrames);
        }

        vrvfc.requestVideoFrameCallback(captureFrame);
      };

      video.addEventListener('ended', finalize, { once: true });
      video.addEventListener('error', () => fail(new Error('Video error during extraction')), { once: true });

      video.playbackRate = playbackRate;
      vrvfc.requestVideoFrameCallback(captureFrame);
      video.play().catch((err) => fail(err as Error));
    });
  }

  private streamWithRAF(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    playbackRate: number,
    onFrame: StreamingFrameHandler,
    onProgress: (progress: number) => void
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let framesCaptured = 0;
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;
      let settled = false;
      let rafId = 0;
      const pendingEncodes: Promise<void>[] = [];

      const finalize = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancelAnimationFrame(rafId);
        video.pause();
        video.playbackRate = 1;
        Promise.all(pendingEncodes)
          .then(() => {
            console.log(`Streamed ${framesCaptured} frames via RAF fallback (${playbackRate}x)`);
            resolve(framesCaptured);
          })
          .catch(reject);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancelAnimationFrame(rafId);
        video.pause();
        video.playbackRate = 1;
        reject(error);
      };

      const timeout = setTimeout(() => {
        if (framesCaptured > 0) finalize();
        else fail(new Error('Frame streaming timed out'));
      }, 120000);

      const tick = () => {
        if (settled) return;

        if (framesCaptured >= totalFrames || video.currentTime >= endTime || video.paused || video.ended) {
          finalize();
          return;
        }

        while (video.currentTime >= nextCaptureTime && framesCaptured < totalFrames) {
          const frame = this.processFrame(video);
          const encodePromise = Promise.resolve(onFrame(frame)).catch((err) => fail(err as Error));
          pendingEncodes.push(encodePromise as Promise<void>);
          framesCaptured++;
          nextCaptureTime = startTime + framesCaptured * frameInterval;
          onProgress(framesCaptured / totalFrames);
        }

        rafId = requestAnimationFrame(tick);
      };

      video.addEventListener('ended', finalize, { once: true });

      video.playbackRate = playbackRate;
      rafId = requestAnimationFrame(tick);
      video.play().catch((err) => fail(err as Error));
    });
  }

  private waitForReady(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video not ready')), 30000);
      const onCanPlay = () => {
        clearTimeout(timeout);
        video.removeEventListener('canplay', onCanPlay);
        resolve();
      };
      video.addEventListener('canplay', onCanPlay);
    });
  }

  /**
   * Seek to a target time and wait for the frame to be decoded.
   * Always goes through attemptSeek to ensure the 'seeked' event fires.
   */
  private async seekTo(
    video: HTMLVideoElement,
    targetTime: number,
    timeout = 15000,
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.attemptSeek(video, targetTime, timeout);
        return;
      } catch (error) {
        lastError = error as Error;
        console.warn(`Seek attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    throw lastError || new Error('Video seek failed after retries');
  }

  private attemptSeek(video: HTMLVideoElement, targetTime: number, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };

      const onSeeked = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      const onError = (e: Event) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`Video seek error: ${(e as ErrorEvent).message || 'Unknown error'}`));
      };

      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);

      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`Video seek timed out after ${timeout}ms`));
      }, timeout);

      video.currentTime = targetTime;
    });
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}

// Singleton for export operations
let processorInstance: VideoProcessor | null = null;

export function getVideoProcessor(): VideoProcessor {
  if (!processorInstance) {
    processorInstance = new VideoProcessor();
  }
  return processorInstance;
}
