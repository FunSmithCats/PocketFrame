import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import type { FrameData } from '../VideoProcessor';
import type { SourceVideoDimensions } from '../ExportManager';
import { calculateScaledDimensions } from '../../utils';
import { EXPORT_SCALE } from '../../constants';

export interface AudioExportSettings {
  highpass: number;
  lowpass: number;
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
      '-ar', '44100',  // Sample rate
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

    const audioArray = audioData instanceof Uint8Array
      ? new Uint8Array(audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength))
      : new TextEncoder().encode(audioData as string);

    return new Blob([audioArray.buffer as ArrayBuffer], { type: 'audio/wav' });
  } catch (error) {
    console.error('Failed to extract audio from video:', error);
    // Clean up files on error to prevent memory leaks
    await safeDeleteFile(ff, inputFile);
    await safeDeleteFile(ff, outputFile);
    return null;
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

  // Calculate output dimensions based on frame dimensions (4x scale with even dimensions for H.264)
  const outputDims = calculateScaledDimensions(frameWidth, frameHeight, EXPORT_SCALE.HIGH_QUALITY, true);

  console.log('Frame dimensions:', frameWidth, 'x', frameHeight, '-> Output:', outputDims);

  // Create a canvas for frame conversion
  const canvas = document.createElement('canvas');
  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get 2D canvas context');
  }

  // Write frames as PNG files
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const imageData = ctx.createImageData(frameWidth, frameHeight);

    // WebGL pixels are flipped vertically
    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const srcIdx = ((frameHeight - 1 - y) * frameWidth + x) * 4;
        const dstIdx = (y * frameWidth + x) * 4;
        imageData.data[dstIdx] = frame.pixels[srcIdx];
        imageData.data[dstIdx + 1] = frame.pixels[srcIdx + 1];
        imageData.data[dstIdx + 2] = frame.pixels[srcIdx + 2];
        imageData.data[dstIdx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });

    if (!pngBlob) {
      throw new Error(`Failed to create PNG blob for frame ${i + 1}`);
    }

    const pngData = await pngBlob.arrayBuffer();
    const frameNum = String(i + 1).padStart(5, '0');
    await ff.writeFile(`frame_${frameNum}.png`, new Uint8Array(pngData));

    // Frame extraction is 40% of total progress
    onProgress((i + 1) / frames.length * 0.4);
  }

  // Encode video
  const inputArgs = [
    '-framerate', fps.toString(),
    '-i', 'frame_%05d.png',
  ];

  // Scale to output dimensions with nearest neighbor for crisp pixels
  // pad filter centers the content if aspect ratios don't match exactly
  const scaleFilter = `scale=${outputDims.width}:${outputDims.height}:flags=neighbor:force_original_aspect_ratio=decrease,pad=${outputDims.width}:${outputDims.height}:(ow-iw)/2:(oh-ih)/2:black`;

  const outputArgs = [
    '-vf', scaleFilter,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'fast',
  ];

  // Handle audio if present
  console.log('Audio blob present:', !!audioBlob, 'Bitcrush enabled:', enableBitcrush);
  let hasAudio = false;

  if (audioBlob) {
    const audioData = await audioBlob.arrayBuffer();
    console.log('Audio blob size:', audioData.byteLength);
    await ff.writeFile('audio.wav', new Uint8Array(audioData));

    if (enableBitcrush) {
      // Game Boy DMG-01 speaker simulation:
      // Use audio settings from preview, or defaults
      const highpass = audioSettings?.highpass ?? 500;
      const lowpass = audioSettings?.lowpass ?? 3500;
      console.log(`Applying Game Boy speaker simulation (highpass=${highpass}Hz, lowpass=${lowpass}Hz)...`);
      try {
        await ff.exec([
          '-i', 'audio.wav',
          '-af', `highpass=f=${highpass},lowpass=f=${lowpass}`,
          '-ar', '8000',       // Low sample rate for lo-fi feel
          '-ac', '1',          // Mono (Game Boy had one speaker)
          '-c:a', 'pcm_s16le', // 16-bit PCM for filter processing
          '-y',
          'audio_crushed.wav',
        ]);

        // Verify the crushed audio was created
        const crushedData = await ff.readFile('audio_crushed.wav');
        if (crushedData instanceof Uint8Array && crushedData.byteLength > 44) {
          console.log('Bitcrush complete, crushed audio size:', crushedData.byteLength);
          inputArgs.push('-i', 'audio_crushed.wav');
          hasAudio = true;
        } else {
          console.warn('Bitcrush output invalid, falling back to original audio');
          inputArgs.push('-i', 'audio.wav');
          hasAudio = true;
        }
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
      '-b:a', '128k',
      '-shortest'
    );
  }

  outputArgs.push('output.mp4');

  // Add progress listener and track it for cleanup
  const progressHandler = ({ progress }: { progress: number }) => {
    // FFmpeg encoding is remaining 60% of total progress (after 40% frame extraction)
    onProgress(0.4 + progress * 0.6);
  };
  ff.on('progress', progressHandler);

  try {
    await ff.exec([...inputArgs, ...outputArgs]);

    const data = await ff.readFile('output.mp4');
    // FFmpeg.wasm readFile returns Uint8Array for binary files
    const dataArray = data instanceof Uint8Array
      ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
      : new TextEncoder().encode(data as string);

    return new Blob([dataArray.buffer as ArrayBuffer], { type: 'video/mp4' });
  } finally {
    // Remove progress listener to prevent accumulation
    ff.off('progress', progressHandler);

    // Cleanup all files
    for (let i = 0; i < frames.length; i++) {
      const frameNum = String(i + 1).padStart(5, '0');
      await safeDeleteFile(ff, `frame_${frameNum}.png`);
    }
    await safeDeleteFile(ff, 'output.mp4');
    if (audioBlob) {
      await safeDeleteFile(ff, 'audio.wav');
      if (enableBitcrush) {
        await safeDeleteFile(ff, 'audio_crushed.wav');
      }
    }
  }
}
