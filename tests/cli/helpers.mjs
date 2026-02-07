import { spawn } from 'node:child_process';
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

export async function runCli(args) {
  const result = await runNpm(['run', 'cli:built', '--', ...args]);

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
