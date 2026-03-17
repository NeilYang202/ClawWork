import { BrowserWindow } from 'electron';
import type { DebugEvent } from '@clawwork/shared';
import type { DebugLogger } from './logger.js';
import { createDebugLogger } from './logger.js';

const noop = (): DebugEvent => ({ ts: '', level: 'debug', domain: 'app', event: '' }) as DebugEvent;
let debugLogger: DebugLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  log: noop,
  getRecentEvents: () => [],
  currentFilePath: () => '',
};

export function initDebugLogger(debugDir: string): DebugLogger {
  debugLogger = createDebugLogger({
    debugDir,
    console: true,
    onEvent: broadcastDebugEvent,
  });
  return debugLogger;
}

export function getDebugLogger(): DebugLogger {
  return debugLogger;
}

function broadcastDebugEvent(event: DebugEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('debug-event', event);
    } catch {
      // ignore broadcast failures for windows closing during dispatch
    }
  }
}
