import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildAppOnce, runCli, PROJECT_ROOT } from './helpers.mjs';

const fixtureVideo = path.join(PROJECT_ROOT, 'tests/fixtures/tiny-sample.mp4');

test.before(async () => {
  await buildAppOnce();
});

test('inspect emits validated settings and metadata', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/inspect-'));
  const jobPath = path.join(tempDir, 'inspect-job.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 1,
    inputPath: fixtureVideo,
    modeConfig: { format: 'mp4' },
    settings: {
      ditherMode: 'floydSteinberg',
      palette: 'PocketGrey',
      invertPalette: true,
      targetFps: 24,
      trim: {
        startSec: 0.1,
        endSec: 0.8,
      },
    },
  }, null, 2));

  const result = await runCli(['inspect', '--job', jobPath]);

  assert.equal(result.code, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const eventTypes = result.events.map((event) => event.type);
  assert.ok(eventTypes.includes('session_start'));
  assert.ok(eventTypes.includes('job_validated'));
  assert.ok(eventTypes.includes('inspect_result'));

  const inspectEvent = result.events.find((event) => event.type === 'inspect_result');
  assert.ok(inspectEvent, 'missing inspect_result event');

  assert.equal(inspectEvent.source.width, 160);
  assert.equal(inspectEvent.source.height, 144);
  assert.equal(inspectEvent.resolvedSettings.processing.ditherMode, 'floydSteinberg');
  assert.equal(inspectEvent.resolvedSettings.processing.cameraResponse, 0.8);
  assert.ok(inspectEvent.resolvedSettings.processing.cropRegion);
  assert.equal(typeof inspectEvent.resolvedSettings.processing.cropRegion.x, 'number');
  assert.equal(typeof inspectEvent.resolvedSettings.processing.cropRegion.y, 'number');
  assert.equal(typeof inspectEvent.resolvedSettings.processing.cropRegion.width, 'number');
  assert.equal(typeof inspectEvent.resolvedSettings.processing.cropRegion.height, 'number');
  assert.equal(inspectEvent.resolvedSettings.processing.invertPalette, true);
  assert.equal(inspectEvent.resolvedSettings.targetFps, 24);
  assert.equal(inspectEvent.resolvedSettings.trim.startSec, 0.1);
  assert.equal(inspectEvent.resolvedSettings.trim.endSec, 0.8);
});

test('inspect resolves explicit crop settings', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/inspect-crop-'));
  const jobPath = path.join(tempDir, 'inspect-crop-job.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 1,
    inputPath: fixtureVideo,
    modeConfig: { format: 'mp4' },
    settings: {
      ditherMode: 'gameBoyCamera',
      crop: { x: 0.25, y: 0.15, width: 0.5, height: 0.5 },
    },
  }, null, 2));

  const result = await runCli(['inspect', '--job', jobPath]);
  assert.equal(result.code, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const inspectEvent = result.events.find((event) => event.type === 'inspect_result');
  assert.ok(inspectEvent, 'missing inspect_result event');

  const crop = inspectEvent.resolvedSettings.processing.cropRegion;
  assert.ok(crop.width > 0);
  assert.ok(crop.height > 0);
  const ratio = (crop.width * inspectEvent.source.width) / (crop.height * inspectEvent.source.height);
  assert.ok(Math.abs(ratio - (8 / 7)) < 0.001);
});
