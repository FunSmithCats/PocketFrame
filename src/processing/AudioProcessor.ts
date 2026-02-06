// Audio bitcrush processor for retro 8-bit sound

const TARGET_SAMPLE_RATE = 22050;
const TARGET_BIT_DEPTH = 8;

export interface AudioProcessingOptions {
  enableBitcrush: boolean;
}

export async function extractAudio(videoSrc: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(videoSrc);
    const arrayBuffer = await response.arrayBuffer();

    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return audioBuffer;
  } catch {
    // Video might not have audio
    return null;
  }
}

export function bitcrushAudio(audioBuffer: AudioBuffer): AudioBuffer {
  const audioContext = new OfflineAudioContext(
    1, // mono
    Math.ceil(audioBuffer.length * TARGET_SAMPLE_RATE / audioBuffer.sampleRate),
    TARGET_SAMPLE_RATE
  );

  // Get original audio data
  const inputData = audioBuffer.getChannelData(0);

  // Resample to target rate
  const resampleRatio = TARGET_SAMPLE_RATE / audioBuffer.sampleRate;
  const outputLength = Math.ceil(inputData.length * resampleRatio);
  const outputData = new Float32Array(outputLength);

  // Simple linear interpolation for resampling
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i / resampleRatio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const t = srcIndex - srcIndexFloor;

    outputData[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
  }

  // Apply bit depth reduction
  const levels = Math.pow(2, TARGET_BIT_DEPTH);
  for (let i = 0; i < outputData.length; i++) {
    // Quantize to 8-bit levels
    outputData[i] = Math.round(outputData[i] * (levels / 2)) / (levels / 2);
  }

  // Create new audio buffer with processed data
  const outputBuffer = audioContext.createBuffer(1, outputLength, TARGET_SAMPLE_RATE);
  outputBuffer.copyToChannel(outputData, 0);

  return outputBuffer;
}

export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const samples = audioBuffer.getChannelData(0);
  const dataLength = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
