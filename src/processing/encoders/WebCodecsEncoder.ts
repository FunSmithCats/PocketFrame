import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { FrameData } from '../VideoProcessor';
import { calculateScaledDimensions } from '../../utils';
import { EXPORT_SCALE } from '../../constants';

const DEFAULT_BITRATE_MULTIPLIER = 0.9; // bits per pixel per frame (near-lossless for pixel art)
const MIN_VIDEO_BITRATE = 8_000_000;
const MAX_VIDEO_BITRATE = 40_000_000;
const AUDIO_BITRATE = 320_000;
const ENCODE_QUEUE_BACKPRESSURE = 30;

export interface WebCodecsEncoderOptions {
  fps: number;
  frameWidth: number;
  frameHeight: number;
  bitrate?: number;
  includeAudio?: boolean;
}

export interface WebCodecsSupportResult {
  supported: boolean;
  reason?: string;
}

export async function isWebCodecsSupported(): Promise<WebCodecsSupportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { supported: false, reason: 'WebCodecs APIs not available' };
  }

  if (typeof VideoEncoder.isConfigSupported !== 'function') {
    return { supported: false, reason: 'VideoEncoder.isConfigSupported not available' };
  }

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: 640,
      height: 480,
      bitrate: 2_000_000,
      framerate: 30,
    });

    return { supported: !!support.supported };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'Unknown WebCodecs support error',
    };
  }
}

export class WebCodecsEncoder {
  private encoder: VideoEncoder;
  private muxer: Muxer;
  private target: ArrayBufferTarget;
  private frameIndex = 0;
  private frameDurationUs: number;
  private srcCanvas: HTMLCanvasElement;
  private outCanvas: HTMLCanvasElement;
  private srcCtx: CanvasRenderingContext2D;
  private outCtx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private outputWidth: number;
  private outputHeight: number;
  private scaledWidth: number;
  private scaledHeight: number;
  private offsetX: number;
  private offsetY: number;
  private keyframeInterval: number;
  private closed = false;
  private audioBlob: Blob | null = null;
  private encoderError: Error | null = null;

  constructor(options: WebCodecsEncoderOptions) {
    const { fps, frameWidth, frameHeight } = options;
    const outputDims = calculateScaledDimensions(frameWidth, frameHeight, EXPORT_SCALE.HIGH_QUALITY, true);

    this.outputWidth = outputDims.width;
    this.outputHeight = outputDims.height;

    const scale = Math.min(this.outputWidth / frameWidth, this.outputHeight / frameHeight);
    this.scaledWidth = Math.floor(frameWidth * scale);
    this.scaledHeight = Math.floor(frameHeight * scale);
    this.offsetX = Math.floor((this.outputWidth - this.scaledWidth) / 2);
    this.offsetY = Math.floor((this.outputHeight - this.scaledHeight) / 2);

    this.frameDurationUs = Math.round(1_000_000 / fps);
    this.keyframeInterval = Math.max(1, Math.round(fps * 2));

    const targetBitrate = options.bitrate ?? Math.round(this.outputWidth * this.outputHeight * fps * DEFAULT_BITRATE_MULTIPLIER);
    const bitrate = Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, targetBitrate));

    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: 'avc',
        width: this.outputWidth,
        height: this.outputHeight,
        frameRate: fps,
      },
      ...(options.includeAudio ? {
        audio: {
          codec: 'aac',
          sampleRate: 44100,
          numberOfChannels: 2,
        },
      } : {}),
      fastStart: 'in-memory',
    });

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.muxer.addVideoChunk(chunk, meta);
      },
      error: (err) => {
        console.error('WebCodecs encode error:', err);
        this.encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });

    this.encoder.configure({
      codec: 'avc1.42001f',
      width: this.outputWidth,
      height: this.outputHeight,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-software',
    });

    this.srcCanvas = document.createElement('canvas');
    this.srcCanvas.width = frameWidth;
    this.srcCanvas.height = frameHeight;
    const srcCtx = this.srcCanvas.getContext('2d');

    this.outCanvas = document.createElement('canvas');
    this.outCanvas.width = this.outputWidth;
    this.outCanvas.height = this.outputHeight;
    const outCtx = this.outCanvas.getContext('2d');

    if (!srcCtx || !outCtx) {
      throw new Error('Failed to get 2D canvas context for WebCodecs encoder');
    }

    this.srcCtx = srcCtx;
    this.outCtx = outCtx;
    this.outCtx.imageSmoothingEnabled = false;
    this.imageData = this.srcCtx.createImageData(frameWidth, frameHeight);
  }

  getOutputDimensions(): { width: number; height: number } {
    return { width: this.outputWidth, height: this.outputHeight };
  }

  setAudioBlob(blob: Blob): void {
    this.audioBlob = blob;
  }

  private throwIfEncoderErrored(): void {
    if (this.encoderError) {
      throw this.encoderError;
    }
  }

  async encodeFrame(frame: FrameData): Promise<void> {
    this.throwIfEncoderErrored();

    if (this.closed) {
      throw new Error('WebCodecs encoder is closed');
    }

    const { pixels } = frame;
    const data = this.imageData.data;

    data.set(pixels);
    // Ensure alpha = 255 (WebGL may have varying alpha)
    for (let j = 3; j < data.length; j += 4) {
      data[j] = 255;
    }

    this.srcCtx.putImageData(this.imageData, 0, 0);

    this.outCtx.fillStyle = '#000';
    this.outCtx.fillRect(0, 0, this.outputWidth, this.outputHeight);
    this.outCtx.drawImage(
      this.srcCanvas,
      this.offsetX,
      this.offsetY,
      this.scaledWidth,
      this.scaledHeight
    );

    const timestamp = this.frameIndex * this.frameDurationUs;
    const videoFrame = new VideoFrame(this.outCanvas, {
      timestamp,
      duration: this.frameDurationUs,
    });

    try {
      this.encoder.encode(videoFrame, {
        keyFrame: this.frameIndex % this.keyframeInterval === 0,
      });
    } finally {
      videoFrame.close();
    }
    this.frameIndex += 1;

    if (this.encoder.encodeQueueSize > ENCODE_QUEUE_BACKPRESSURE) {
      await this.encoder.flush();
      this.throwIfEncoderErrored();
    }
  }

  async finalize(): Promise<Blob> {
    this.throwIfEncoderErrored();

    if (this.closed) {
      throw new Error('WebCodecs encoder is already finalized');
    }

    await this.encoder.flush();
    this.throwIfEncoderErrored();

    if (this.audioBlob) {
      await this.encodeAudio(this.audioBlob);
      this.throwIfEncoderErrored();
    }

    this.muxer.finalize();
    this.encoder.close();
    this.closed = true;

    return new Blob([this.target.buffer], { type: 'video/mp4' });
  }

  private async encodeAudio(audioBlob: Blob): Promise<void> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const wavView = new DataView(arrayBuffer);

    // Parse WAV header (PCM 16-bit LE, produced by FFmpeg)
    const channels = wavView.getUint16(22, true);
    const sampleRate = wavView.getUint32(24, true);
    const bitsPerSample = wavView.getUint16(34, true);

    // PCM data starts after 44-byte WAV header
    const dataOffset = 44;
    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = (arrayBuffer.byteLength - dataOffset) / bytesPerSample;
    const framesCount = totalSamples / channels;

    // Convert 16-bit PCM to Float32 interleaved
    const float32Data = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const byteOffset = dataOffset + i * bytesPerSample;
      const sample = wavView.getInt16(byteOffset, true);
      float32Data[i] = sample / 32768;
    }

    // De-interleave into planar format for AudioData
    const planarData = new Float32Array(totalSamples);
    for (let ch = 0; ch < channels; ch++) {
      for (let i = 0; i < framesCount; i++) {
        planarData[ch * framesCount + i] = float32Data[i * channels + ch];
      }
    }

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        this.muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => console.error('Audio encode error:', err),
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channels,
      bitrate: AUDIO_BITRATE,
    });

    // Feed audio in chunks of 1024 frames (standard AAC frame size)
    const chunkSize = 1024;
    for (let offset = 0; offset < framesCount; offset += chunkSize) {
      const remaining = Math.min(chunkSize, framesCount - offset);

      // Build planar chunk for this segment
      const chunkData = new Float32Array(remaining * channels);
      for (let ch = 0; ch < channels; ch++) {
        for (let i = 0; i < remaining; i++) {
          chunkData[ch * remaining + i] = planarData[ch * framesCount + offset + i];
        }
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: remaining,
        numberOfChannels: channels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: chunkData,
      });

      audioEncoder.encode(audioData);
      audioData.close();

      // Back-pressure: flush periodically
      if (audioEncoder.encodeQueueSize > 30) {
        await audioEncoder.flush();
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    try {
      this.encoder.close();
    } catch {
      // Ignore close errors when aborting.
    }

    this.closed = true;
  }
}
