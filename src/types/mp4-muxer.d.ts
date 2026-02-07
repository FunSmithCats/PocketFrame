declare module 'mp4-muxer' {
  export class ArrayBufferTarget {
    buffer: ArrayBuffer;
  }

  export interface MuxerVideoConfig {
    codec: string;
    width: number;
    height: number;
    frameRate: number;
  }

  export interface MuxerAudioConfig {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
  }

  export interface MuxerOptions {
    target: ArrayBufferTarget;
    video?: MuxerVideoConfig;
    audio?: MuxerAudioConfig;
    fastStart?: 'in-memory' | 'fragmented' | boolean;
  }

  export class Muxer {
    constructor(options: MuxerOptions);
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
    addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
    finalize(): void;
  }
}
