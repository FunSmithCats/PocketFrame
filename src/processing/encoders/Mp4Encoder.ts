import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import type { FrameData } from '../VideoProcessor';
import type { SourceVideoDimensions } from '../ExportManager';
import { calculateScaledDimensions } from '../../utils';

const VIDEO_CRF = '10';
const VIDEO_PRESET = 'slow';
const AAC_AUDIO_BITRATE = '320k';
const AAC_AUDIO_BITRATE_BITCRUSH = '192k';
const BITCRUSH_SAMPLE_RATE_REDUCTION = 6;
const FILTER_Q = 0.707;

export interface AudioExportSettings {
  highpass: number;
  lowpass: number;
  bitDepth: number;
  distortion: number;
  sampleRateReduction?: number;
}

let ffmpeg: FFmpeg | null = null;
let ffmpegLoaded = false;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpegLoaded) {
    return ffmpeg;
  }

  ffmpeg = new FFmpeg();

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  ffmpegLoaded = true;
  return ffmpeg;
}

/**
 * Safely delete FFmpeg virtual filesystem files
 */
async function safeDeleteFile(ff: FFmpeg, filename: string): Promise<void> {
  try {
    await ff.deleteFile(filename);
  } catch {
    // File may not exist, ignore error
  }
}

function fileDataToUint8Array(data: Uint8Array | string): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  return new TextEncoder().encode(data);
}

function clampAudioSample(sample: number): number {
  return Math.max(-1, Math.min(1, sample));
}

function applySoftClip(sample: number, distortionPercent: number): number {
  if (distortionPercent <= 0) {
    return sample;
  }

  // Match preview waveshaper curve from GameBoyAudioProcessor.
  const amount = distortionPercent / 100;
  const k = amount * 50;
  return ((3 + k) * sample * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(sample));
}

type BiquadType = 'highpass' | 'lowpass';

interface ParsedWavPcm16 {
  sampleRate: number;
  channelData: Float32Array[];
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

function parseWavPcm16(arrayBuffer: ArrayBuffer): ParsedWavPcm16 {
  const view = new DataView(arrayBuffer);

  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Unsupported WAV format: missing RIFF/WAVE header');
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkDataOffset + 16 <= view.byteLength) {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV PCM format: audioFormat=${audioFormat}, bitsPerSample=${bitsPerSample}`);
  }

  if (channels <= 0 || sampleRate <= 0 || dataOffset < 0) {
    throw new Error('Invalid WAV metadata');
  }

  const bytesPerSample = 2;
  const availableDataBytes = Math.max(0, Math.min(dataSize, view.byteLength - dataOffset));
  const totalSamples = Math.floor(availableDataBytes / bytesPerSample);
  const frames = Math.floor(totalSamples / channels);

  if (frames <= 0) {
    throw new Error('No PCM data in WAV');
  }

  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));

  let cursor = dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels; channel++) {
      channelData[channel][i] = view.getInt16(cursor, true) / 32768;
      cursor += bytesPerSample;
    }
  }

  return { sampleRate, channelData };
}

function createBiquadCoefficients(
  type: BiquadType,
  frequency: number,
  sampleRate: number,
  q: number
): BiquadCoefficients {
  const nyquist = sampleRate * 0.5;
  const safeFrequency = Math.max(10, Math.min(frequency, nyquist - 10));
  const w0 = (2 * Math.PI * safeFrequency) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  let b0: number;
  let b1: number;
  let b2: number;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  if (type === 'highpass') {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
  } else {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquadInPlace(samples: Float32Array, coeffs: BiquadCoefficients): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    samples[i] = y0;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

function applyPreviewEqFilters(
  channelData: Float32Array[],
  sampleRate: number,
  settings: AudioExportSettings
): void {
  const highpass = createBiquadCoefficients('highpass', settings.highpass, sampleRate, FILTER_Q);
  const lowpass = createBiquadCoefficients('lowpass', settings.lowpass, sampleRate, FILTER_Q);

  for (const channel of channelData) {
    applyBiquadInPlace(channel, highpass);
    applyBiquadInPlace(channel, lowpass);
  }
}

function applyPreviewBitcrushAndDistortion(
  channelData: Float32Array[],
  settings: AudioExportSettings
): void {
  const bitDepth = Math.max(2, Math.min(16, Math.round(settings.bitDepth)));
  const sampleRateReduction = Math.max(1, Math.round(settings.sampleRateReduction ?? BITCRUSH_SAMPLE_RATE_REDUCTION));
  const distortion = Math.max(0, Math.min(100, settings.distortion));
  const levels = 2 ** bitDepth;
  const quantStep = 2 / levels;

  for (let channel = 0; channel < channelData.length; channel++) {
    const data = channelData[channel];
    let heldSample = 0;

    for (let i = 0; i < data.length; i++) {
      if (i % sampleRateReduction === 0) {
        const quantized = Math.round(data[i] / quantStep) * quantStep;
        heldSample = clampAudioSample(quantized);
      }

      const distorted = applySoftClip(heldSample, distortion);
      data[i] = clampAudioSample(distorted);
    }
  }
}

function writeWavString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function channelDataToWav(channelData: Float32Array[], sampleRate: number): Blob {
  const channels = channelData.length;
  const frames = channels > 0 ? channelData[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = clampAudioSample(channelData[channel][i]);
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(pcm), true);
      offset += bytesPerSample;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Apply Game Boy DMG-01 speaker simulation (bitcrush) to a WAV audio blob.
 * Returns the processed audio as a WAV blob.
 */
export async function applyAudioBitcrush(
  audioBlob: Blob,
  audioSettings?: AudioExportSettings
): Promise<Blob> {
  try {
    const settings: AudioExportSettings = {
      highpass: audioSettings?.highpass ?? 500,
      lowpass: audioSettings?.lowpass ?? 3500,
      bitDepth: audioSettings?.bitDepth ?? 6,
      distortion: audioSettings?.distortion ?? 30,
      sampleRateReduction: audioSettings?.sampleRateReduction ?? BITCRUSH_SAMPLE_RATE_REDUCTION,
    };

    const rawAudioData = await audioBlob.arrayBuffer();
    const parsedWav = parseWavPcm16(rawAudioData);
    applyPreviewEqFilters(parsedWav.channelData, parsedWav.sampleRate, settings);
    applyPreviewBitcrushAndDistortion(parsedWav.channelData, settings);
    return channelDataToWav(parsedWav.channelData, parsedWav.sampleRate);
  } catch (err) {
    console.error('Bitcrush failed, returning original audio:', err);
    return audioBlob;
  }
}

/**
 * Extract audio from video source using FFmpeg
 * Handles both regular URLs and blob URLs
 * Supports trimming with startTime and endTime parameters
 */
export async function extractAudioFromVideo(
  videoSrc: string,
  startTime = 0,
  endTime?: number
): Promise<Blob | null> {
  const ff = await loadFFmpeg();
  const inputFile = 'input_video.mp4';
  const outputFile = 'extracted_audio.wav';

  try {
    console.log('Extracting audio from:', videoSrc, 'trim:', startTime, '-', endTime);

    // Fetch the video file - fetchFile handles blob URLs
    const videoData = await fetchFile(videoSrc);
    console.log('Video data fetched, size:', videoData.byteLength);

    await ff.writeFile(inputFile, videoData);

    // Build FFmpeg command with optional trim
    const ffmpegArgs = [
      '-i', inputFile,
    ];

    // Add seek to start time if specified
    if (startTime > 0) {
      ffmpegArgs.unshift('-ss', startTime.toString());
    }

    // Add duration if end time specified
    if (endTime !== undefined && endTime > startTime) {
      const duration = endTime - startTime;
      ffmpegArgs.push('-t', duration.toString());
    }

    ffmpegArgs.push(
      '-vn',  // No video
      '-acodec', 'pcm_s16le',  // PCM 16-bit little endian
      '-ac', '2',  // Stereo
      outputFile
    );

    // Extract audio to WAV format
    console.log('Running FFmpeg to extract audio with args:', ffmpegArgs.join(' '));
    await ff.exec(ffmpegArgs);

    // Read the extracted audio
    const audioData = await ff.readFile(outputFile);
    console.log('Audio extracted, size:', audioData instanceof Uint8Array ? audioData.byteLength : 'unknown');

    // Cleanup
    await safeDeleteFile(ff, inputFile);
    await safeDeleteFile(ff, outputFile);

    const audioArray = fileDataToUint8Array(audioData as Uint8Array | string);

    return new Blob([audioArray.buffer as ArrayBuffer], { type: 'audio/wav' });
  } catch (error) {
    console.error('Failed to extract audio from video:', error);
    // Clean up files on error to prevent memory leaks
    await safeDeleteFile(ff, inputFile);
    await safeDeleteFile(ff, outputFile);
    return null;
  }
}

/**
 * Fast audio merge for WebCodecs video exports.
 * Copies the already encoded video stream and only encodes audio.
 */
export async function muxMp4WithSourceAudio(
  videoBlob: Blob,
  sourceVideoSrc: string,
  startTime = 0,
  endTime?: number,
  enableBitcrush = false,
  audioSettings?: AudioExportSettings,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ff = await loadFFmpeg();
  const videoInputFile = 'webcodecs_video.mp4';
  const sourceInputFile = 'source_video.mp4';
  const crushedAudioFile = 'audio_crushed.wav';
  const outputFile = 'muxed_output.mp4';

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress);
  };
  ff.on('progress', progressHandler);

  try {
    await ff.writeFile(videoInputFile, new Uint8Array(await videoBlob.arrayBuffer()));

    const inputArgs: string[] = ['-i', videoInputFile];
    let hasAudio = false;

    if (enableBitcrush) {
      const extractedAudio = await extractAudioFromVideo(sourceVideoSrc, startTime, endTime);
      if (extractedAudio) {
        const crushedAudio = await applyAudioBitcrush(extractedAudio, audioSettings);
        await ff.writeFile(crushedAudioFile, new Uint8Array(await crushedAudio.arrayBuffer()));
        inputArgs.push('-i', crushedAudioFile);
        hasAudio = true;
      } else {
        console.warn('No source audio found for bitcrush mux; exporting video-only MP4');
      }
    } else {
      await ff.writeFile(sourceInputFile, await fetchFile(sourceVideoSrc));

      if (startTime > 0) {
        inputArgs.push('-ss', startTime.toString());
      }

      if (endTime !== undefined && endTime > startTime) {
        inputArgs.push('-t', (endTime - startTime).toString());
      }

      inputArgs.push('-i', sourceInputFile);
      hasAudio = true;
    }

    const outputArgs: string[] = ['-map', '0:v:0', '-c:v', 'copy'];
    if (hasAudio) {
      outputArgs.push(
        '-map', '1:a:0?',
        '-c:a', 'aac',
        '-b:a', enableBitcrush ? AAC_AUDIO_BITRATE_BITCRUSH : AAC_AUDIO_BITRATE
      );
    }

    outputArgs.push(
      '-shortest',
      '-movflags', '+faststart',
      '-y',
      outputFile
    );

    await ff.exec([...inputArgs, ...outputArgs]);

    const muxedData = await ff.readFile(outputFile);
    const dataArray = fileDataToUint8Array(muxedData as Uint8Array | string);
    return new Blob([dataArray.buffer as ArrayBuffer], { type: 'video/mp4' });
  } finally {
    ff.off('progress', progressHandler);
    await safeDeleteFile(ff, videoInputFile);
    await safeDeleteFile(ff, sourceInputFile);
    await safeDeleteFile(ff, crushedAudioFile);
    await safeDeleteFile(ff, outputFile);
  }
}

export async function encodeMp4(
  frames: FrameData[],
  fps: number,
  audioBlob: Blob | null,
  enableBitcrush: boolean,
  onProgress: (progress: number) => void,
  audioSettings?: AudioExportSettings,
  _sourceDims?: SourceVideoDimensions
): Promise<Blob> {
  const ff = await loadFFmpeg();

  if (frames.length === 0) {
    throw new Error('No frames to encode');
  }

  // Get dimensions from frame data (already calculated by VideoProcessor)
  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;

  // Frames are already final-size from VideoProcessor; only normalize to even dimensions if needed.
  const outputDims = calculateScaledDimensions(frameWidth, frameHeight, 1, true);

  console.log('Frame dimensions:', frameWidth, 'x', frameHeight, '-> Output:', outputDims);

  // Concatenate all frames into a single raw RGBA buffer
  const bytesPerFrame = frameWidth * frameHeight * 4;
  const totalBytes = bytesPerFrame * frames.length;
  const rawBuffer = new Uint8Array(totalBytes);

  for (let i = 0; i < frames.length; i++) {
    const offset = i * bytesPerFrame;
    rawBuffer.set(frames[i].pixels, offset);
    // Set alpha channel to 255 for each pixel (WebGL may have varying alpha)
    for (let j = offset + 3; j < offset + bytesPerFrame; j += 4) {
      rawBuffer[j] = 255;
    }
    // Raw buffer creation is 30% of total progress
    onProgress((i + 1) / frames.length * 0.3);
  }

  // Write raw pixel data to FFmpeg VFS
  await ff.writeFile('input.raw', rawBuffer);

  // Use rawvideo input format instead of PNG sequence
  const inputArgs = [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${frameWidth}x${frameHeight}`,
    '-r', fps.toString(),
    '-i', 'input.raw',
  ];

  const outputArgs = [
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', VIDEO_CRF,
    '-preset', VIDEO_PRESET,
    '-tune', 'animation',
  ];

  if (outputDims.width !== frameWidth || outputDims.height !== frameHeight) {
    // Only apply resize/pad when enforcing even dimensions changes frame size.
    const scaleFilter = `scale=${outputDims.width}:${outputDims.height}:flags=neighbor:force_original_aspect_ratio=decrease,pad=${outputDims.width}:${outputDims.height}:(ow-iw)/2:(oh-ih)/2:black`;
    outputArgs.unshift('-vf', scaleFilter);
  }

  // Handle audio if present
  console.log('Audio blob present:', !!audioBlob, 'Bitcrush enabled:', enableBitcrush);
  let hasAudio = false;

  if (audioBlob) {
    const audioData = await audioBlob.arrayBuffer();
    console.log('Audio blob size:', audioData.byteLength);
    await ff.writeFile('audio.wav', new Uint8Array(audioData));

    if (enableBitcrush) {
      const highpass = audioSettings?.highpass ?? 500;
      const lowpass = audioSettings?.lowpass ?? 3500;
      const bitDepth = audioSettings?.bitDepth ?? 6;
      const distortion = audioSettings?.distortion ?? 30;
      console.log(`Applying preview-matched Game Boy audio (highpass=${highpass}Hz, lowpass=${lowpass}Hz, bitDepth=${bitDepth}, distortion=${distortion}%)`);
      try {
        const crushedAudioBlob = await applyAudioBitcrush(audioBlob, audioSettings);
        await ff.writeFile('audio_crushed.wav', new Uint8Array(await crushedAudioBlob.arrayBuffer()));
        inputArgs.push('-i', 'audio_crushed.wav');
        hasAudio = true;
      } catch (err) {
        console.error('Bitcrush failed:', err);
        console.log('Falling back to original audio');
        inputArgs.push('-i', 'audio.wav');
        hasAudio = true;
      }
    } else {
      console.log('Using original audio (no bitcrush)');
      inputArgs.push('-i', 'audio.wav');
      hasAudio = true;
    }
  } else {
    console.log('No audio to include in export');
  }

  // Add stream mapping and audio encoding if we have audio
  if (hasAudio) {
    outputArgs.push(
      '-map', '0:v',           // Map video from first input (frames)
      '-map', '1:a',           // Map audio from second input (audio file)
      '-c:a', 'aac',
      '-b:a', enableBitcrush ? AAC_AUDIO_BITRATE_BITCRUSH : AAC_AUDIO_BITRATE,
      '-shortest'
    );
  }

  outputArgs.push('output.mp4');

  // Add progress listener and track it for cleanup
  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg encoding is remaining 70% of total progress (after 30% raw buffer creation)
    onProgress(0.3 + progress * 0.7);
  };
  ff.on('progress', progressHandler);

  try {
    await ff.exec([...inputArgs, ...outputArgs]);

    const data = await ff.readFile('output.mp4');
    // FFmpeg.wasm readFile returns Uint8Array for binary files
    const dataArray = fileDataToUint8Array(data as Uint8Array | string);

    return new Blob([dataArray.buffer as ArrayBuffer], { type: 'video/mp4' });
  } finally {
    // Remove progress listener to prevent accumulation
    ff.off('progress', progressHandler);

    // Cleanup all files
    await safeDeleteFile(ff, 'input.raw');
    await safeDeleteFile(ff, 'output.mp4');
    if (audioBlob) {
      await safeDeleteFile(ff, 'audio.wav');
      if (enableBitcrush) {
        await safeDeleteFile(ff, 'audio_crushed.wav');
      }
    }
  }
}
