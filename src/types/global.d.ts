export interface AutomationStartPayload {
  command: 'run' | 'inspect';
  jobPath: string;
  cwd: string;
  jobId: string;
  timeoutMs: number;
}

export interface AutomationEventMessage {
  type: string;
  [key: string]: unknown;
}

// Electron API types
export interface ElectronAPI {
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
