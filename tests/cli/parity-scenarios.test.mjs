import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { buildAppOnce, runCli, PROJECT_ROOT } from './helpers.mjs';

const fixtureVideo = path.join(PROJECT_ROOT, 'tests/fixtures/tiny-sample.mp4');

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function runJob(tempDir, outputName, settings) {
  const outputPath = path.join(tempDir, outputName);
  const jobPath = path.join(tempDir, `${outputName}.json`);

  const job = {
    schemaVersion: 1,
    inputPath: fixtureVideo,
    outputPath,
    modeConfig: { format: 'mp4' },
    settings: {
      targetFps: 10,
      trim: { startSec: 0, endSec: 0.6 },
      ...settings,
    },
  };

  await fs.writeFile(jobPath, JSON.stringify(job, null, 2));
  const result = await runCli(['run', '--job', jobPath]);

  assert.equal(result.code, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const data = await fs.readFile(outputPath);
  return hashBuffer(data);
}

test.before(async () => {
  await buildAppOnce();
});

test('invert palette changes exported output', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/parity-invert-'));
  const normalHash = await runJob(tempDir, 'normal.mp4', {
    ditherMode: 'bayer4x4',
    invertPalette: false,
    lcd: { enabled: false },
  });

  const invertedHash = await runJob(tempDir, 'inverted.mp4', {
    ditherMode: 'bayer4x4',
    invertPalette: true,
    lcd: { enabled: false },
  });

  assert.notEqual(normalHash, invertedHash);
});

test('lcd effect changes exported output', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/parity-lcd-'));
  const withoutLcd = await runJob(tempDir, 'lcd-off.mp4', {
    ditherMode: 'bayer4x4',
    lcd: { enabled: false },
  });

  const withLcd = await runJob(tempDir, 'lcd-on.mp4', {
    ditherMode: 'bayer4x4',
    lcd: {
      enabled: true,
      gridIntensity: 0.75,
      shadowOpacity: 0.35,
      ghostingStrength: 0.25,
      baselineAlpha: 0.04,
    },
  });

  assert.notEqual(withoutLcd, withLcd);
});

test('floyd steinberg output differs from bayer4x4', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/parity-dither-'));
  const bayerHash = await runJob(tempDir, 'bayer.mp4', {
    ditherMode: 'bayer4x4',
    lcd: { enabled: false },
  });

  const floydHash = await runJob(tempDir, 'floyd.mp4', {
    ditherMode: 'floydSteinberg',
    lcd: { enabled: false },
  });

  assert.notEqual(bayerHash, floydHash);
});
