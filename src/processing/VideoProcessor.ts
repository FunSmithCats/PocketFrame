import { RenderPipeline } from '../webgl/pipeline/RenderPipeline';
import type { DitherMode } from '../state/store';
import type { PaletteName } from '../palettes';

// Initial canvas size (will be resized when video dimensions are set)
const INITIAL_SIZE = 160;

export interface ProcessingSettings {
  contrast: number;
  ditherMode: DitherMode;
  palette: PaletteName;
}

export interface FrameData {
  pixels: Uint8Array;
  width: number;
  height: number;
  timestamp: number;
}

export class VideoProcessor {
  private canvas: OffscreenCanvas;
  private pipeline: RenderPipeline;
  private processWidth = INITIAL_SIZE;
  private processHeight = INITIAL_SIZE;

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
    // Update pipeline with source video info (calculates dynamic processing resolution)
    this.pipeline.setSourceVideoInfo(width, height);

    // Get the calculated processing dimensions
    const dims = this.pipeline.getProcessingDimensions();
    this.processWidth = dims.width;
    this.processHeight = dims.height;

    // Resize canvas to match processing dimensions
    this.canvas.width = this.processWidth;
    this.canvas.height = this.processHeight;
  }

  setSettings(settings: ProcessingSettings): void {
    this.pipeline.setContrast(settings.contrast);
    this.pipeline.setDitherMode(settings.ditherMode);
    this.pipeline.setPalette(settings.palette);
  }

  processFrame(video: HTMLVideoElement): FrameData {
    this.pipeline.renderProcessed(video);
    const pixels = this.pipeline.getProcessedPixels();

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

    // Validate video has content
    if (duration <= 0 || totalFrames <= 0 || !isFinite(duration)) {
      console.warn('Video has no valid duration, returning empty frames');
      return [];
    }

    console.log(`Extracting ${totalFrames} frames from ${startTime.toFixed(2)}s to ${actualEndTime.toFixed(2)}s`);

    // Set source video dimensions to calculate processing resolution
    this.setSourceVideoDimensions(video.videoWidth, video.videoHeight);

    // Use play-based extraction for better performance with long videos
    return this.extractFramesPlayBased(video, fps, startTime, actualEndTime, totalFrames, onProgress);
  }

  /**
   * Extract frames by playing the video and capturing at intervals.
   * More reliable for long videos than individual seeks.
   */
  private async extractFramesPlayBased(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    video.pause();

    // Ensure video is ready
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Video not ready')), 30000);
        const onCanPlay = () => {
          clearTimeout(timeout);
          video.removeEventListener('canplay', onCanPlay);
          resolve();
        };
        video.addEventListener('canplay', onCanPlay);
      });
    }

    // Seek to start position
    video.currentTime = startTime;
    await this.waitForSeek(video, startTime, 30000);

    // Check if requestVideoFrameCallback is available (more accurate timing)
    if ('requestVideoFrameCallback' in video) {
      return this.extractWithVideoFrameCallback(video, fps, startTime, endTime, totalFrames, onProgress);
    }

    // Fallback: use timeupdate-based extraction
    return this.extractWithTimeUpdate(video, fps, startTime, endTime, totalFrames, onProgress);
  }

  /**
   * Extract frames using requestVideoFrameCallback (more accurate).
   */
  private extractWithVideoFrameCallback(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    return new Promise((resolve, reject) => {
      const frames: FrameData[] = [];
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;
      let lastCapturedTime = -1;

      const captureFrame = () => {
        if (frames.length >= totalFrames || video.currentTime >= endTime) {
          video.pause();
          console.log(`Extracted ${frames.length} frames using requestVideoFrameCallback`);
          resolve(frames);
          return;
        }

        // Capture frame if we've reached or passed the next capture time
        if (video.currentTime >= nextCaptureTime && video.currentTime !== lastCapturedTime) {
          const frame = this.processFrame(video);
          frames.push(frame);
          lastCapturedTime = video.currentTime;
          nextCaptureTime = startTime + (frames.length * frameInterval);
          onProgress(frames.length / totalFrames);
        }

        // Request next frame callback
        (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
          .requestVideoFrameCallback(captureFrame);
      };

      // Set up timeout for safety
      const timeout = setTimeout(() => {
        video.pause();
        if (frames.length > 0) {
          console.warn(`Timeout during extraction, returning ${frames.length} frames`);
          resolve(frames);
        } else {
          reject(new Error('Frame extraction timed out'));
        }
      }, 120000); // 2 minute timeout

      video.addEventListener('ended', () => {
        clearTimeout(timeout);
        video.pause();
        resolve(frames);
      }, { once: true });

      video.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Video error during extraction'));
      }, { once: true });

      // Start playback and frame capture
      (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number })
        .requestVideoFrameCallback(captureFrame);
      video.play().catch(reject);
    });
  }

  /**
   * Fallback extraction using timeupdate events.
   */
  private extractWithTimeUpdate(
    video: HTMLVideoElement,
    fps: number,
    startTime: number,
    endTime: number,
    totalFrames: number,
    onProgress: (progress: number) => void
  ): Promise<FrameData[]> {
    return new Promise((resolve, reject) => {
      const frames: FrameData[] = [];
      const frameInterval = 1 / fps;
      let nextCaptureTime = startTime;

      const onTimeUpdate = () => {
        if (frames.length >= totalFrames || video.currentTime >= endTime) {
          video.pause();
          video.removeEventListener('timeupdate', onTimeUpdate);
          console.log(`Extracted ${frames.length} frames using timeupdate`);
          resolve(frames);
          return;
        }

        // Capture frames as we pass each target time
        while (video.currentTime >= nextCaptureTime && frames.length < totalFrames) {
          const frame = this.processFrame(video);
          frames.push(frame);
          nextCaptureTime = startTime + (frames.length * frameInterval);
          onProgress(frames.length / totalFrames);
        }
      };

      // Set up timeout for safety
      const timeout = setTimeout(() => {
        video.pause();
        video.removeEventListener('timeupdate', onTimeUpdate);
        if (frames.length > 0) {
          console.warn(`Timeout during extraction, returning ${frames.length} frames`);
          resolve(frames);
        } else {
          reject(new Error('Frame extraction timed out'));
        }
      }, 120000); // 2 minute timeout

      video.addEventListener('ended', () => {
        clearTimeout(timeout);
        video.pause();
        video.removeEventListener('timeupdate', onTimeUpdate);
        resolve(frames);
      }, { once: true });

      video.addEventListener('error', () => {
        clearTimeout(timeout);
        video.removeEventListener('timeupdate', onTimeUpdate);
        reject(new Error('Video error during extraction'));
      }, { once: true });

      video.addEventListener('timeupdate', onTimeUpdate);
      video.play().catch(reject);
    });
  }

  /**
   * Wait for video to seek to target time with timeout, retry logic, and race condition protection.
   * Adds listener BEFORE setting currentTime to prevent race conditions.
   */
  private async waitForSeek(
    video: HTMLVideoElement,
    targetTime: number,
    timeout = 15000,
    maxRetries = 3
  ): Promise<void> {
    // If already at target time (within tolerance), no need to seek
    if (Math.abs(video.currentTime - targetTime) < 0.001) {
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.attemptSeek(video, targetTime, timeout);
        return; // Success
      } catch (error) {
        lastError = error as Error;
        console.warn(`Seek attempt ${attempt + 1}/${maxRetries} failed:`, lastError.message);

        // Brief pause before retry
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    throw lastError || new Error('Video seek failed after retries');
  }

  /**
   * Single seek attempt with timeout.
   */
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

      // Add listeners BEFORE setting currentTime to prevent race condition
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);

      // Set timeout to prevent infinite hang
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(new Error(`Video seek timed out after ${timeout}ms`));
      }, timeout);

      // Now set the target time
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
