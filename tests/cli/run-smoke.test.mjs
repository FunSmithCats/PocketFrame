import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildAppOnce, runCli, PROJECT_ROOT } from './helpers.mjs';

const fixtureVideo = path.join(PROJECT_ROOT, 'tests/fixtures/tiny-sample.mp4');

test.before(async () => {
  await buildAppOnce();
});

test('run exports mp4 and emits progress + completion events', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/run-'));
  const outputPath = path.join(tempDir, 'output.mp4');
  const jobPath = path.join(tempDir, 'run-job.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 1,
    inputPath: fixtureVideo,
    outputPath,
    modeConfig: { format: 'mp4' },
    settings: {
      contrast: 1.1,
      ditherMode: 'floydSteinberg',
      palette: '1989Green',
      targetFps: 15,
      enableAudioBitcrush: true,
      lcd: {
        enabled: true,
        gridIntensity: 0.65,
        shadowOpacity: 0.25,
        ghostingStrength: 0.2,
        baselineAlpha: 0.02,
      },
      trim: {
        startSec: 0.0,
        endSec: 0.8,
      },
    },
  }, null, 2));

  const result = await runCli(['run', '--job', jobPath]);

  assert.equal(result.code, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 0, 'expected non-empty output file');

  const eventTypes = result.events.map((event) => event.type);
  assert.ok(eventTypes.includes('session_start'));
  assert.ok(eventTypes.includes('job_validated'));
  assert.ok(eventTypes.includes('job_complete'));

  const phases = result.events
    .filter((event) => event.type === 'progress')
    .map((event) => event.phase);

  assert.ok(phases.includes('load'));
  assert.ok(phases.includes('extract'));
  assert.ok(phases.includes('encode'));
  assert.ok(phases.includes('write'));

  const completion = result.events.find((event) => event.type === 'job_complete');
  assert.ok(completion, 'missing job_complete event');
  assert.equal(completion.outputPath, outputPath);
  assert.ok(completion.bytesWritten > 0);
  assert.equal(completion.resolvedSettings.processing.ditherMode, 'floydSteinberg');
  assert.equal(completion.resolvedSettings.processing.cameraResponse, 0.8);
  assert.ok(completion.resolvedSettings.processing.cropRegion);
});
