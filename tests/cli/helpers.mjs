import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../..');

let buildPromise;

export function buildAppOnce() {
  if (!buildPromise) {
    buildPromise = runNpm(['run', 'build:app']);
  }

  return buildPromise.then((result) => {
    if (result.code !== 0) {
      throw new Error(`build:app failed\n${result.stderr || result.stdout}`);
    }
  });
}

function runNpm(args) {
  return new Promise((resolve) => {
    const child = spawn('npm', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Detect whether we need xvfb-run (no $DISPLAY and xvfb-run is available).
 */
function needsXvfb() {
  if (process.env.DISPLAY) {
    return false;
  }

  try {
    execFileSync('which', ['xvfb-run'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether we need --no-sandbox (running as root).
 */
function needsNoSandbox() {
  return process.getuid?.() === 0;
}

const USE_XVFB = needsXvfb();
const USE_NO_SANDBOX = needsNoSandbox();

function runElectron(electronArgs) {
  return new Promise((resolve) => {
    const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'electron');

    const extraFlags = USE_NO_SANDBOX ? ['--no-sandbox'] : [];

    let cmd;
    let cmdArgs;

    if (USE_XVFB) {
      cmd = 'xvfb-run';
      cmdArgs = [
        '--auto-servernum',
        '--server-args=-screen 0 1280x1024x24',
        electronBin,
        ...extraFlags,
        '.',
        '--',
        ...electronArgs,
      ];
    } else {
      cmd = electronBin;
      cmdArgs = [...extraFlags, '.', '--', ...electronArgs];
    }

    const child = spawn(cmd, cmdArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runCli(args) {
  const result = await runElectron(args);

  const events = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    ...result,
    events,
  };
}
