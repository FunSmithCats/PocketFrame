const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:saveFile', options),
  writeFile: (filePath: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('file:write', filePath, data),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  platform: process.platform,
});

export type ElectronAPI = {
  openFile: () => Promise<string | null>;
  saveFile: (options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
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
