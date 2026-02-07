import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { writeFile, readFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { randomUUID } from 'crypto';

type AutomationCommand = 'run' | 'inspect';

interface AutomationCliConfig {
  command: AutomationCommand;
  jobPath: string;
  showUi: boolean;
  timeoutMs: number;
  jobId: string;
  cwd: string;
}

interface AutomationEventMessage {
  type: string;
  [key: string]: unknown;
}

interface AutomationFailureMessage {
  error?: string;
  code?: number;
  details?: unknown;
}

const DEFAULT_TIMEOUT_MS = 300_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let automationTimeout: ReturnType<typeof setTimeout> | null = null;
let automationFinished = false;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);

function emitJsonEvent(jobId: string, type: string, payload: Record<string, unknown> = {}): void {
  const event = {
    type,
    timestamp: new Date().toISOString(),
    jobId,
    ...payload,
  };

  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function parseAutomationCli(argv: string[]):
  | { mode: 'ui' }
  | { mode: 'invalid'; jobId: string; error: string }
  | { mode: 'automation'; config: AutomationCliConfig } {
  const args = argv.slice(2);

  if (args[0] === '--') {
    args.shift();
  }

  const first = args[0];
  if (!first) {
    return { mode: 'ui' };
  }

  if (first !== 'run' && first !== 'inspect') {
    return { mode: 'ui' };
  }

  const command = first;
  let jobPath: string | null = null;
  let showUi = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--job') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { mode: 'invalid', jobId: randomUUID(), error: 'Missing value for --job' };
      }
      jobPath = resolve(process.cwd(), value);
      i += 1;
      continue;
    }

    if (arg === '--show-ui') {
      showUi = true;
      continue;
    }

    if (arg === '--timeout-ms') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { mode: 'invalid', jobId: randomUUID(), error: 'Missing value for --timeout-ms' };
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { mode: 'invalid', jobId: randomUUID(), error: 'Invalid --timeout-ms value' };
      }
      timeoutMs = parsed;
      i += 1;
      continue;
    }

    return { mode: 'invalid', jobId: randomUUID(), error: `Unknown argument: ${arg}` };
  }

  if (!jobPath) {
    return { mode: 'invalid', jobId: randomUUID(), error: 'Missing required --job <path>' };
  }

  return {
    mode: 'automation',
    config: {
      command,
      jobPath,
      showUi,
      timeoutMs,
      jobId: randomUUID(),
      cwd: process.cwd(),
    },
  };
}

const parsedCli = parseAutomationCli(process.argv);

if (parsedCli.mode === 'invalid') {
  emitJsonEvent(parsedCli.jobId, 'job_error', {
    error: parsedCli.error,
    phase: 'load',
    code: 2,
  });
  process.exit(2);
}

const automationConfig = parsedCli.mode === 'automation' ? parsedCli.config : null;

function finishAutomation(exitCode: number): void {
  if (!automationConfig || automationFinished) {
    return;
  }

  automationFinished = true;
  if (automationTimeout) {
    clearTimeout(automationTimeout);
    automationTimeout = null;
  }

  process.exitCode = exitCode;
  app.exit(exitCode);
}

function startAutomation(): void {
  if (!automationConfig || !mainWindow || automationFinished) {
    return;
  }

  emitJsonEvent(automationConfig.jobId, 'session_start', {
    command: automationConfig.command,
    jobPath: automationConfig.jobPath,
    showUi: automationConfig.showUi,
    timeoutMs: automationConfig.timeoutMs,
  });

  automationTimeout = setTimeout(() => {
    emitJsonEvent(automationConfig.jobId, 'job_error', {
      error: `Automation timed out after ${automationConfig.timeoutMs}ms`,
      code: 124,
      phase: 'load',
    });
    finishAutomation(124);
  }, automationConfig.timeoutMs);

  mainWindow.webContents.send('automation:start', {
    command: automationConfig.command,
    jobPath: automationConfig.jobPath,
    cwd: automationConfig.cwd,
    jobId: automationConfig.jobId,
    timeoutMs: automationConfig.timeoutMs,
  });
}

function createWindow(): void {
  const isAutomation = Boolean(automationConfig);

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    show: !isAutomation || Boolean(automationConfig?.showUi),
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  if (isDev && devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (!isAutomation) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  if (isAutomation && !automationConfig?.showUi) {
    mainWindow.hide();
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (isAutomation) {
      startAutomation();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (automationConfig || process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (automationConfig) {
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('automation:event', (_, event: AutomationEventMessage) => {
  if (!automationConfig || automationFinished || !event || typeof event.type !== 'string') {
    return;
  }

  const { type, ...payload } = event;
  emitJsonEvent(automationConfig.jobId, type, payload);
});

ipcMain.on('automation:done', () => {
  finishAutomation(0);
});

ipcMain.on('automation:fail', (_, payload: AutomationFailureMessage) => {
  if (!automationConfig || automationFinished) {
    return;
  }

  emitJsonEvent(automationConfig.jobId, 'job_error', {
    error: payload?.error || 'Automation failed',
    phase: 'load',
    code: payload?.code ?? 3,
    details: payload?.details,
  });

  finishAutomation(payload?.code === 2 ? 2 : 3);
});

// IPC Handlers
ipcMain.handle('dialog:openFile', async () => {
  if (automationConfig) {
    return null;
  }

  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openVideo', async () => {
  if (automationConfig) {
    return null;
  }

  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: filePath.split(/[\\/]/).pop() || 'video',
    url: pathToFileURL(filePath).href,
  };
});

ipcMain.handle('dialog:saveFile', async (_, options: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
  if (automationConfig) {
    return null;
  }

  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('shell:openExternal', (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle('file:write', async (_, filePath: string, data: ArrayBuffer) => {
  try {
    await writeFile(filePath, Buffer.from(data));
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('file:readText', async (_, filePath: string) => {
  try {
    const text = await readFile(filePath, 'utf8');
    return { success: true, text };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('file:exists', async (_, filePath: string) => {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('path:resolve', (_, basePath: string, targetPath: string) => {
  return resolve(basePath, targetPath);
});

ipcMain.handle('path:toFileURL', (_, filePath: string) => {
  return pathToFileURL(filePath).href;
});
