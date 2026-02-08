import { SLIDERS } from '../constants/ui';
import type { CropRegionNormalized, DitherMode } from '../state/store';
import { PALETTE_NAMES, type PaletteName } from '../palettes';
import type { ProcessingSettings } from '../processing/VideoProcessor';
import { clampAndNormalizeCrop, getDefaultCenteredCrop } from '../utils';
import jobSchema from './schema/job.v1.json';

export type AutomationCommand = 'run' | 'inspect';

export interface AutomationStartPayload {
  command: AutomationCommand;
  jobPath: string;
  cwd: string;
  jobId: string;
  timeoutMs: number;
}

export interface ParsedAutomationJob {
  schemaVersion: 1;
  format: 'mp4';
  inputPath: string;
  outputPath: string | null;
  settings: {
    contrast: number;
    cameraResponse: number;
    crop: CropRegionNormalized | null;
    ditherMode: DitherMode;
    palette: PaletteName;
    invertPalette: boolean;
    targetFps: number;
    enableAudioBitcrush: boolean;
    audio: {
      highpass: number;
      lowpass: number;
      bitDepth: number;
      distortion: number;
    };
    lcd: {
      enabled: boolean;
      gridIntensity: number;
      shadowOpacity: number;
      ghostingStrength: number;
      baselineAlpha: number;
    };
    trim: {
      startSec: number;
      endSec: number | null;
    };
  };
}

export interface SourceVideoMetadata {
  name: string;
  width: number;
  height: number;
  duration: number;
  estimatedFps: number;
}

export interface ResolvedAutomationJob {
  command: AutomationCommand;
  schemaVersion: 1;
  format: 'mp4';
  inputPath: string;
  outputPath: string | null;
  source: SourceVideoMetadata;
  settings: {
    processing: ProcessingSettings;
    targetFps: number;
    enableAudioBitcrush: boolean;
    audio: {
      highpass: number;
      lowpass: number;
      bitDepth: number;
      distortion: number;
    };
    trim: {
      startSec: number;
      endSec: number;
      startPercent: number;
      endPercent: number;
    };
  };
}

type JsonRecord = Record<string, unknown>;

const SCHEMA_VERSION = Number(jobSchema.properties.schemaVersion.const || 1) as 1;

export class JobValidationError extends Error {
  readonly code = 2;

  constructor(message: string) {
    super(message);
    this.name = 'JobValidationError';
  }
}

const DEFAULTS = {
  contrast: 1.0,
  cameraResponse: 0.8,
  ditherMode: 'bayer4x4' as DitherMode,
  palette: '1989Green' as PaletteName,
  invertPalette: false,
  targetFps: 30,
  enableAudioBitcrush: false,
  audioHighpass: 500,
  audioLowpass: 3500,
  audioBitDepth: 6,
  audioDistortion: 30,
  lcdEnabled: true,
  lcdGridIntensity: 0.7,
  lcdShadowOpacity: 0.35,
  lcdGhostingStrength: 0.3,
  lcdBaselineAlpha: 0.05,
  trimStartSec: 0,
} as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function ensureString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new JobValidationError(`${label} must be a non-empty string`);
  }

  return value;
}

function validateDitherMode(value: unknown): DitherMode {
  const allowed: DitherMode[] = ['none', 'bayer2x2', 'bayer4x4', 'floydSteinberg', 'gameBoyCamera'];
  if (typeof value === 'string' && allowed.includes(value as DitherMode)) {
    return value as DitherMode;
  }
  return DEFAULTS.ditherMode;
}

function validatePalette(value: unknown): PaletteName {
  if (typeof value === 'string' && PALETTE_NAMES.includes(value as PaletteName)) {
    return value as PaletteName;
  }
  return DEFAULTS.palette;
}

function validateCrop(value: unknown): CropRegionNormalized | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = asNumber(value.x);
  const y = asNumber(value.y);
  const width = asNumber(value.width);
  const height = asNumber(value.height);

  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, 1),
    height: clamp(height, 0, 1),
  };
}

function optionalRecord(value: unknown): JsonRecord {
  if (isRecord(value)) {
    return value;
  }

  return {};
}

async function resolvePath(cwd: string, pathValue: string): Promise<string> {
  const api = window.electronAPI;
  if (!api) {
    throw new JobValidationError('Electron API unavailable in automation mode');
  }

  return api.resolvePath(cwd, pathValue);
}

async function assertPathExists(pathValue: string, label: string): Promise<void> {
  const api = window.electronAPI;
  if (!api) {
    throw new JobValidationError('Electron API unavailable in automation mode');
  }

  const exists = await api.fileExists(pathValue);
  if (!exists) {
    throw new JobValidationError(`${label} does not exist: ${pathValue}`);
  }
}

export async function parseAndValidateJob(start: AutomationStartPayload): Promise<ParsedAutomationJob> {
  const api = window.electronAPI;
  if (!api) {
    throw new JobValidationError('Electron API unavailable in automation mode');
  }

  const readResult = await api.readTextFile(start.jobPath);
  if (!readResult.success || !readResult.text) {
    throw new JobValidationError(`Failed to read job file: ${readResult.error || start.jobPath}`);
  }

  let jsonValue: unknown;
  try {
    jsonValue = JSON.parse(readResult.text);
  } catch (error) {
    throw new JobValidationError(`Job file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(jsonValue)) {
    throw new JobValidationError('Job file root must be an object');
  }

  const schemaVersion = asNumber(jsonValue.schemaVersion);
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new JobValidationError(`Unsupported schemaVersion. Expected ${SCHEMA_VERSION}`);
  }

  const inputPathRaw = ensureString(jsonValue.inputPath, 'inputPath');
  const modeConfig = optionalRecord(jsonValue.modeConfig);
  if (modeConfig.format !== 'mp4') {
    throw new JobValidationError('modeConfig.format must be "mp4" in v1');
  }

  const outputPathRaw = jsonValue.outputPath;
  if (start.command === 'run') {
    ensureString(outputPathRaw, 'outputPath');
  }

  const inputPath = await resolvePath(start.cwd, inputPathRaw);
  await assertPathExists(inputPath, 'inputPath');

  const outputPath = typeof outputPathRaw === 'string'
    ? await resolvePath(start.cwd, outputPathRaw)
    : null;

  if (start.command === 'run' && outputPath) {
    const exists = await api.fileExists(outputPath);
    if (exists) {
      throw new JobValidationError(`outputPath already exists: ${outputPath}`);
    }
  }

  const settingsRecord = optionalRecord(jsonValue.settings);
  const audioRecord = optionalRecord(settingsRecord.audio);
  const lcdRecord = optionalRecord(settingsRecord.lcd);
  const trimRecord = optionalRecord(settingsRecord.trim);

  const contrast = clamp(asNumber(settingsRecord.contrast) ?? DEFAULTS.contrast, SLIDERS.CONTRAST.MIN, SLIDERS.CONTRAST.MAX);
  const targetFps = Math.round(clamp(asNumber(settingsRecord.targetFps) ?? DEFAULTS.targetFps, SLIDERS.FRAME_RATE.MIN, SLIDERS.FRAME_RATE.MAX));

  const trimStartSec = Math.max(0, asNumber(trimRecord.startSec) ?? DEFAULTS.trimStartSec);
  const trimEndSecRaw = asNumber(trimRecord.endSec);
  const trimEndSec = trimEndSecRaw !== null ? Math.max(trimStartSec, trimEndSecRaw) : null;

  return {
    schemaVersion: 1,
    format: 'mp4',
    inputPath,
    outputPath,
    settings: {
      contrast,
      cameraResponse: clamp(asNumber(settingsRecord.cameraResponse) ?? DEFAULTS.cameraResponse, 0, 1),
      crop: validateCrop(settingsRecord.crop),
      ditherMode: validateDitherMode(settingsRecord.ditherMode),
      palette: validatePalette(settingsRecord.palette),
      invertPalette: Boolean(settingsRecord.invertPalette ?? DEFAULTS.invertPalette),
      targetFps,
      enableAudioBitcrush: Boolean(settingsRecord.enableAudioBitcrush ?? DEFAULTS.enableAudioBitcrush),
      audio: {
        highpass: Math.round(clamp(asNumber(audioRecord.highpass) ?? DEFAULTS.audioHighpass, SLIDERS.AUDIO_HIGHPASS.MIN, SLIDERS.AUDIO_HIGHPASS.MAX)),
        lowpass: Math.round(clamp(asNumber(audioRecord.lowpass) ?? DEFAULTS.audioLowpass, SLIDERS.AUDIO_LOWPASS.MIN, SLIDERS.AUDIO_LOWPASS.MAX)),
        bitDepth: Math.round(clamp(asNumber(audioRecord.bitDepth) ?? DEFAULTS.audioBitDepth, SLIDERS.AUDIO_BIT_DEPTH.MIN, SLIDERS.AUDIO_BIT_DEPTH.MAX)),
        distortion: Math.round(clamp(asNumber(audioRecord.distortion) ?? DEFAULTS.audioDistortion, SLIDERS.AUDIO_DISTORTION.MIN, SLIDERS.AUDIO_DISTORTION.MAX)),
      },
      lcd: {
        enabled: Boolean(lcdRecord.enabled ?? DEFAULTS.lcdEnabled),
        gridIntensity: clamp(asNumber(lcdRecord.gridIntensity) ?? DEFAULTS.lcdGridIntensity, SLIDERS.LCD_GRID.MIN, SLIDERS.LCD_GRID.MAX),
        shadowOpacity: clamp(asNumber(lcdRecord.shadowOpacity) ?? DEFAULTS.lcdShadowOpacity, SLIDERS.LCD_SHADOW.MIN, SLIDERS.LCD_SHADOW.MAX),
        ghostingStrength: clamp(asNumber(lcdRecord.ghostingStrength) ?? DEFAULTS.lcdGhostingStrength, SLIDERS.LCD_GHOSTING.MIN, SLIDERS.LCD_GHOSTING.MAX),
        baselineAlpha: clamp(asNumber(lcdRecord.baselineAlpha) ?? DEFAULTS.lcdBaselineAlpha, SLIDERS.LCD_BLACK_LEVEL.MIN, SLIDERS.LCD_BLACK_LEVEL.MAX),
      },
      trim: {
        startSec: trimStartSec,
        endSec: trimEndSec,
      },
    },
  };
}

export function resolveJobForSource(
  command: AutomationCommand,
  parsedJob: ParsedAutomationJob,
  source: SourceVideoMetadata
): ResolvedAutomationJob {
  const maxFps = Math.min(60, Math.max(10, Math.round(source.estimatedFps || 60)));
  const targetFps = Math.round(clamp(parsedJob.settings.targetFps, 10, maxFps));

  const trimStartSec = clamp(parsedJob.settings.trim.startSec, 0, source.duration);
  const trimEndSec = parsedJob.settings.trim.endSec === null
    ? source.duration
    : clamp(parsedJob.settings.trim.endSec, trimStartSec, source.duration);

  const durationSafe = source.duration > 0 ? source.duration : 1;

  const crop = parsedJob.settings.crop
    ? clampAndNormalizeCrop(parsedJob.settings.crop, source.width, source.height)
    : getDefaultCenteredCrop(source.width, source.height);

  return {
    command,
    schemaVersion: parsedJob.schemaVersion,
    format: parsedJob.format,
    inputPath: parsedJob.inputPath,
    outputPath: parsedJob.outputPath,
    source,
    settings: {
      processing: {
        contrast: parsedJob.settings.contrast,
        cameraResponse: parsedJob.settings.cameraResponse,
        cropRegion: crop as CropRegionNormalized,
        ditherMode: parsedJob.settings.ditherMode,
        palette: parsedJob.settings.palette,
        invertPalette: parsedJob.settings.invertPalette,
        lcd: {
          enabled: parsedJob.settings.lcd.enabled,
          gridIntensity: parsedJob.settings.lcd.gridIntensity,
          shadowOpacity: parsedJob.settings.lcd.shadowOpacity,
          ghostingStrength: parsedJob.settings.lcd.ghostingStrength,
          baselineAlpha: parsedJob.settings.lcd.baselineAlpha,
        },
      },
      targetFps,
      enableAudioBitcrush: parsedJob.settings.enableAudioBitcrush,
      audio: {
        highpass: parsedJob.settings.audio.highpass,
        lowpass: parsedJob.settings.audio.lowpass,
        bitDepth: parsedJob.settings.audio.bitDepth,
        distortion: parsedJob.settings.audio.distortion,
      },
      trim: {
        startSec: trimStartSec,
        endSec: trimEndSec,
        startPercent: trimStartSec / durationSafe,
        endPercent: trimEndSec / durationSafe,
      },
    },
  };
}
