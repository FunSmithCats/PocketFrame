/**
 * Bitcrusher AudioWorklet Processor
 * Reduces bit depth and sample rate for lo-fi Game Boy speaker simulation
 */
class BitcrusherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Sample-and-hold state for sample rate reduction
    this.lastSample = [0, 0]; // Per-channel held samples
    this.sampleCounter = 0;
  }

  static get parameterDescriptors() {
    return [
      {
        name: 'bitDepth',
        defaultValue: 6,
        minValue: 2,
        maxValue: 16,
        automationRate: 'k-rate',
      },
      {
        name: 'sampleRateReduction',
        defaultValue: 6, // Divide sample rate by this factor (~8kHz at 48kHz)
        minValue: 1,
        maxValue: 16,
        automationRate: 'k-rate',
      },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) {
      return true;
    }

    const bitDepth = parameters.bitDepth[0];
    const reduction = Math.floor(parameters.sampleRateReduction[0]);

    // Calculate quantization levels based on bit depth
    const levels = Math.pow(2, bitDepth);
    const step = 2 / levels; // -1 to 1 range

    const frameSize = output[0].length;

    // Process sample-by-sample (outer loop) to keep channels synchronized
    for (let i = 0; i < frameSize; i++) {
      const shouldUpdate = this.sampleCounter % reduction === 0;

      for (let channel = 0; channel < output.length; channel++) {
        const inputChannel = input[channel] || input[0]; // Fallback to first channel if mono
        const outputChannel = output[channel];

        // Sample rate reduction via sample-and-hold
        // Update held sample every `reduction` samples
        if (shouldUpdate) {
          let sample = inputChannel[i];

          // Bit depth reduction via quantization
          sample = Math.round(sample / step) * step;

          // Clamp to valid range
          sample = Math.max(-1, Math.min(1, sample));

          this.lastSample[channel] = sample;
        }

        // Output the held sample
        outputChannel[i] = this.lastSample[channel] || 0;
      }

      // Increment counter once per sample position (not per channel)
      this.sampleCounter++;
    }

    // Keep counter bounded but preserve modulo position for continuity
    if (this.sampleCounter > 1000000) {
      this.sampleCounter = this.sampleCounter % reduction;
    }

    return true;
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
