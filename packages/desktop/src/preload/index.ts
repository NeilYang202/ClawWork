import { contextBridge } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Expose Electron APIs to renderer via contextBridge
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
}
