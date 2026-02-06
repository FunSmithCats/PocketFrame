/**
 * Game Boy Audio Processor
 * Real-time audio processing chain that simulates the Game Boy DMG-01 speaker
 * Uses Web Audio API with AudioWorklet for bit crushing
 */

export interface AudioSettings {
  highpass: number;    // Hz (100-1000) - bass cut frequency
  lowpass: number;     // Hz (2000-6000) - treble cut frequency
  bitDepth: number;    // bits (4-8) - quantization depth
  distortion: number;  // percent (0-100) - soft clipping amount
}

export class GameBoyAudioProcessor {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private highpassFilter: BiquadFilterNode | null = null;
  private lowpassFilter: BiquadFilterNode | null = null;
  private bitcrusherNode: AudioWorkletNode | null = null;
  private waveShaperNode: WaveShaperNode | null = null;
  private gainNode: GainNode | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isConnected = false;
  private isEnabled = false;
  // Track worklet loading per AudioContext (not global flag)
  private workletLoadedForContext = false;

  private settings: AudioSettings = {
    highpass: 500,
    lowpass: 3500,
    bitDepth: 6,
    distortion: 30,
  };

  async connect(video: HTMLVideoElement): Promise<void> {
    if (this.isConnected && this.videoElement === video && this.audioContext) {
      return;
    }

    // Dispose previous connections and close old AudioContext
    this.dispose();

    this.videoElement = video;
    this.audioContext = new AudioContext();
    // Reset worklet loaded flag for new AudioContext
    this.workletLoadedForContext = false;

    // Load the bitcrusher worklet for this AudioContext
    try {
      const workletUrl = new URL('./bitcrusher-processor.js', import.meta.url).href;
      await this.audioContext.audioWorklet.addModule(workletUrl);
      this.workletLoadedForContext = true;
    } catch (err) {
      console.error('Failed to load bitcrusher worklet:', err);
      // Continue without bitcrusher - other effects will still work
    }

    // Create source from video element
    this.sourceNode = this.audioContext.createMediaElementSource(video);

    // Create filter chain
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = this.settings.highpass;
    this.highpassFilter.Q.value = 0.707; // Butterworth

    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = this.settings.lowpass;
    this.lowpassFilter.Q.value = 0.707;

    // Create bitcrusher (if worklet loaded for this context)
    if (this.workletLoadedForContext) {
      this.bitcrusherNode = new AudioWorkletNode(this.audioContext, 'bitcrusher-processor', {
        parameterData: {
          bitDepth: this.settings.bitDepth,
          sampleRateReduction: 6, // ~8kHz effective sample rate
        },
      });
    }

    // Create waveshaper for soft clipping distortion
    this.waveShaperNode = this.audioContext.createWaveShaper();
    this.updateDistortionCurve();

    // Create gain node for output level control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    // Connect the chain based on enabled state
    this.updateAudioRouting();

    this.isConnected = true;
  }

  private updateAudioRouting(): void {
    if (!this.audioContext || !this.sourceNode || !this.gainNode) return;

    // Disconnect everything first
    this.sourceNode.disconnect();
    this.highpassFilter?.disconnect();
    this.lowpassFilter?.disconnect();
    this.bitcrusherNode?.disconnect();
    this.waveShaperNode?.disconnect();

    if (this.isEnabled) {
      // Connect through processing chain
      let currentNode: AudioNode = this.sourceNode;

      if (this.highpassFilter) {
        currentNode.connect(this.highpassFilter);
        currentNode = this.highpassFilter;
      }

      if (this.lowpassFilter) {
        currentNode.connect(this.lowpassFilter);
        currentNode = this.lowpassFilter;
      }

      if (this.bitcrusherNode) {
        currentNode.connect(this.bitcrusherNode);
        currentNode = this.bitcrusherNode;
      }

      if (this.waveShaperNode) {
        currentNode.connect(this.waveShaperNode);
        currentNode = this.waveShaperNode;
      }

      currentNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
    } else {
      // Bypass - connect source directly to destination
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
    }
  }

  private updateDistortionCurve(): void {
    if (!this.waveShaperNode) return;

    const amount = this.settings.distortion / 100;

    if (amount === 0) {
      this.waveShaperNode.curve = null;
      return;
    }

    // Create soft clipping curve
    const samples = 8192;
    const curve = new Float32Array(samples);
    const k = amount * 50; // Distortion intensity

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      // Soft clipping using tanh-like curve
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }

    this.waveShaperNode.curve = curve;
    this.waveShaperNode.oversample = '2x';
  }

  setEnabled(enabled: boolean): void {
    if (this.isEnabled === enabled) return;
    this.isEnabled = enabled;
    this.updateAudioRouting();
  }

  setSettings(settings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...settings };

    if (this.highpassFilter && settings.highpass !== undefined) {
      this.highpassFilter.frequency.value = settings.highpass;
    }

    if (this.lowpassFilter && settings.lowpass !== undefined) {
      this.lowpassFilter.frequency.value = settings.lowpass;
    }

    if (this.bitcrusherNode && settings.bitDepth !== undefined) {
      const bitDepthParam = this.bitcrusherNode.parameters.get('bitDepth');
      if (bitDepthParam) {
        bitDepthParam.value = settings.bitDepth;
      }
    }

    if (settings.distortion !== undefined) {
      this.updateDistortionCurve();
    }
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  isActive(): boolean {
    return this.isEnabled && this.isConnected;
  }

  dispose(): void {
    this.sourceNode?.disconnect();
    this.highpassFilter?.disconnect();
    this.lowpassFilter?.disconnect();
    this.bitcrusherNode?.disconnect();
    this.waveShaperNode?.disconnect();
    this.gainNode?.disconnect();

    // Close the AudioContext to free system resources
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.error);
    }

    this.sourceNode = null;
    this.highpassFilter = null;
    this.lowpassFilter = null;
    this.bitcrusherNode = null;
    this.waveShaperNode = null;
    this.gainNode = null;
    this.videoElement = null;
    this.isConnected = false;
    this.audioContext = null;
    this.workletLoadedForContext = false;
  }
}
