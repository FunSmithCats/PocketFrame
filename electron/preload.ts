const { contextBridge, ipcRenderer } = require('electron');

type AutomationCommand = 'run' | 'inspect';

export interface AutomationStartPayload {
  command: AutomationCommand;
  jobPath: string;
  cwd: string;
  jobId: string;
  timeoutMs: number;
}

export interface AutomationEventMessage {
  type: string;
  [key: string]: unknown;
}

let automationStartListener: ((payload: AutomationStartPayload) => void) | null = null;
let pendingAutomationStart: AutomationStartPayload | null = null;

ipcRenderer.on('automation:start', (_: unknown, payload: AutomationStartPayload) => {
  if (automationStartListener) {
    automationStartListener(payload);
    return;
  }

  pendingAutomationStart = payload;
});

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:saveFile', options),
  writeFile: (filePath: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('file:write', filePath, data),
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke('file:readText', filePath),
  fileExists: (filePath: string) =>
    ipcRenderer.invoke('file:exists', filePath),
  resolvePath: (basePath: string, targetPath: string) =>
    ipcRenderer.invoke('path:resolve', basePath, targetPath),
  toFileURL: (filePath: string) =>
    ipcRenderer.invoke('path:toFileURL', filePath),
  onAutomationStart: (listener: (payload: AutomationStartPayload) => void) => {
    automationStartListener = listener;
    if (pendingAutomationStart) {
      const queuedPayload = pendingAutomationStart;
      pendingAutomationStart = null;
      listener(queuedPayload);
    }
  },
  emitAutomationEvent: (event: AutomationEventMessage) => {
    ipcRenderer.send('automation:event', event);
  },
  notifyAutomationDone: () => {
    ipcRenderer.send('automation:done');
  },
  notifyAutomationFail: (payload: { error: string; code?: number; details?: unknown }) => {
    ipcRenderer.send('automation:fail', payload);
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  platform: process.platform,
});

export type ElectronAPI = {
  openFile: () => Promise<string | null>;
  openVideo: () => Promise<{ path: string; name: string; url: string } | null>;
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
  readTextFile: (filePath: string) => Promise<{ success: boolean; text?: string; error?: string }>;
  fileExists: (filePath: string) => Promise<boolean>;
  resolvePath: (basePath: string, targetPath: string) => Promise<string>;
  toFileURL: (filePath: string) => Promise<string>;
  onAutomationStart: (listener: (payload: AutomationStartPayload) => void) => void;
  emitAutomationEvent: (event: AutomationEventMessage) => void;
  notifyAutomationDone: () => void;
  notifyAutomationFail: (payload: { error: string; code?: number; details?: unknown }) => void;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  platform: NodeJS.Platform;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
