// Electron API types
export interface ElectronAPI {
  openFile: () => Promise<string | null>;
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
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
