// Bitcrush AudioWorkletProcessor
// Reduces sample rate and bit depth for retro 8-bit sound

class BitcrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'bitDepth',
        defaultValue: 8,
        minValue: 1,
        maxValue: 16,
        automationRate: 'k-rate',
      },
      {
        name: 'sampleRateReduction',
        defaultValue: 2,
        minValue: 1,
        maxValue: 32,
        automationRate: 'k-rate',
      },
      {
        name: 'wet',
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.lastSampleL = 0;
    this.lastSampleR = 0;
    this.sampleCounter = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) {
      return true;
    }

    const bitDepth = parameters.bitDepth[0];
    const sampleRateReduction = Math.floor(parameters.sampleRateReduction[0]);
    const wet = parameters.wet[0];

    const levels = Math.pow(2, bitDepth);

    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel] || input[0];
      const outputChannel = output[channel];

      for (let i = 0; i < outputChannel.length; i++) {
        // Sample rate reduction - hold samples
        if (this.sampleCounter % sampleRateReduction === 0) {
          // Bit depth reduction - quantize
          let sample = inputChannel[i];
          sample = Math.round(sample * levels) / levels;

          if (channel === 0) {
            this.lastSampleL = sample;
          } else {
            this.lastSampleR = sample;
          }
        }

        // Mix dry/wet
        const drySample = inputChannel[i];
        const wetSample = channel === 0 ? this.lastSampleL : this.lastSampleR;
        outputChannel[i] = drySample * (1 - wet) + wetSample * wet;

        if (channel === 0) {
          this.sampleCounter++;
        }
      }
    }

    return true;
  }
}

registerProcessor('bitcrush-processor', BitcrushProcessor);
