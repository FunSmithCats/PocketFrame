import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildAppOnce, runCli, PROJECT_ROOT } from './helpers.mjs';

const fixtureVideo = path.join(PROJECT_ROOT, 'tests/fixtures/tiny-sample.mp4');

test.before(async () => {
  await buildAppOnce();
});

test('invalid schema returns exit code 2 with job_error event', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/invalid-schema-'));
  const jobPath = path.join(tempDir, 'job-invalid-schema.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 2,
    inputPath: fixtureVideo,
    modeConfig: { format: 'mp4' },
  }, null, 2));

  const result = await runCli(['inspect', '--job', jobPath]);

  assert.equal(result.code, 2, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const errorEvent = result.events.find((event) => event.type === 'job_error');
  assert.ok(errorEvent, 'expected job_error event');
});

test('missing input path returns exit code 2', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/missing-input-'));
  const jobPath = path.join(tempDir, 'job-missing-input.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 1,
    inputPath: path.join(tempDir, 'does-not-exist.mp4'),
    modeConfig: { format: 'mp4' },
  }, null, 2));

  const result = await runCli(['inspect', '--job', jobPath]);

  assert.equal(result.code, 2, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const errorEvent = result.events.find((event) => event.type === 'job_error');
  assert.ok(errorEvent, 'expected job_error event');
});

test('timeout exits with code 124', async () => {
  const tempDir = await fs.mkdtemp(path.join(PROJECT_ROOT, 'tests/tmp/timeout-'));
  const jobPath = path.join(tempDir, 'job-timeout.json');

  await fs.writeFile(jobPath, JSON.stringify({
    schemaVersion: 1,
    inputPath: fixtureVideo,
    modeConfig: { format: 'mp4' },
  }, null, 2));

  const result = await runCli(['inspect', '--job', jobPath, '--timeout-ms', '10']);

  assert.equal(result.code, 124, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const errorEvent = result.events.find((event) => event.type === 'job_error');
  assert.ok(errorEvent, 'expected job_error event');
  assert.equal(errorEvent.code, 124);
});
