import { ipcMain } from 'electron';
import { updateTrayStatus, isTrayEnabled, setTrayEnabled } from '../tray.js';
import type { TrayStatus, TrayTaskInfo } from '../tray.js';

export function registerTrayHandlers(): void {
  ipcMain.on('tray:update-status', (_event, payload: { status: TrayStatus; tasks: TrayTaskInfo[] }) => {
    updateTrayStatus({ status: payload.status, tasks: payload.tasks ?? [] });
  });

  ipcMain.handle('tray:get-enabled', () => {
    return isTrayEnabled();
  });

  ipcMain.handle('tray:set-enabled', (_event, enabled: boolean) => {
    setTrayEnabled(enabled);
    return true;
  });
}
