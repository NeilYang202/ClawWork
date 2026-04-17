import { BrowserWindow } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import type { Artifact } from '@clawwork/shared';
import { getObsFileEvents } from '../auth/client.js';
import type { ObsFileEvent } from '../auth/client.js';
import { getAuthConfig, getAuthSession } from '../auth/session.js';
import { getWorkspacePath } from '../workspace/config.js';

const POLL_INTERVAL_MS = 2000;
const ERROR_RETRY_MS = 5000;
const MAX_TRACKED_EVENTS = 500;

let timer: NodeJS.Timeout | null = null;
let running = false;
let cursor = '$';
const seenEventIds: string[] = [];
const seenEventSet = new Set<string>();

function rememberEventId(eventId: string): void {
  if (seenEventSet.has(eventId)) return;
  seenEventSet.add(eventId);
  seenEventIds.push(eventId);
  if (seenEventIds.length > MAX_TRACKED_EVENTS) {
    const removed = seenEventIds.shift();
    if (removed) seenEventSet.delete(removed);
  }
}

function inferFileName(fileName: string | undefined): string {
  const raw = (fileName ?? '').trim();
  if (raw) return raw;
  return `artifact-${Date.now()}.bin`;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const replaced = trimmed.replace(/[\\/:*?"<>|]+/g, '_');
  return replaced || `artifact-${Date.now()}.bin`;
}

function ensureSyncDir(workspacePath: string): string {
  const target = join(workspacePath, 'downloads');
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
  return target;
}

function uniqueFilePath(dir: string, fileName: string): { fullPath: string; finalName: string } {
  const safe = sanitizeFileName(fileName);
  const ext = extname(safe);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  const direct = join(dir, safe);
  if (!existsSync(direct)) return { fullPath: direct, finalName: safe };
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const finalName = `${base}-${suffix}${ext}`;
  return { fullPath: join(dir, finalName), finalName };
}

function inferArtifactType(mimeType?: string | null): 'file' | 'image' {
  return (mimeType ?? '').toLowerCase().startsWith('image/') ? 'image' : 'file';
}

function parseContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) return asciiMatch[1];
  return null;
}

function resolveDownloadUrl(raw: string, serviceUrl: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    return `${serviceUrl.replace(/\/+$/, '')}${trimmed}`;
  }
  return `${serviceUrl.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
}

async function fetchBuffer(url: string, token: string): Promise<{ buffer: Buffer; fileName?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`download failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const fileName = parseContentDisposition(response.headers.get('content-disposition'));
    return { buffer: Buffer.from(arrayBuffer), fileName: fileName ?? undefined };
  } finally {
    clearTimeout(timeout);
  }
}

async function syncEvent(event: ObsFileEvent, token: string): Promise<void> {
  if (!event.url?.trim()) return;
  const auth = getAuthConfig();
  const serviceUrl = auth.serviceUrl?.trim();
  if (!serviceUrl) return;
  const workspacePath = getWorkspacePath();
  if (!workspacePath) return;

  const { buffer, fileName } = await fetchBuffer(resolveDownloadUrl(event.url, serviceUrl), token);
  const targetDir = ensureSyncDir(workspacePath);
  const { fullPath, finalName } = uniqueFilePath(targetDir, inferFileName(fileName ?? event.fileName));
  writeFileSync(fullPath, buffer);

  const artifact: Artifact = {
    id: `sync:${event.eventId}`,
    taskId: '__workspace__',
    messageId: 'workspace',
    type: inferArtifactType(event.mimeType),
    name: finalName,
    filePath: fullPath,
    localPath: `downloads/${finalName}`.replace(/\\/g, '/'),
    mimeType: event.mimeType ?? '',
    size: buffer.length,
    createdAt: event.createdAt || new Date().toISOString(),
  };

  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('artifact:saved', artifact);
  }
}

async function pollOnce(): Promise<void> {
  const session = getAuthSession();
  const token = session?.token;
  if (!token) return;

  const auth = getAuthConfig();
  if (!auth.serviceUrl?.trim()) return;

  const result = await getObsFileEvents(auth, token, { cursor, limit: 100 });
  const events = Array.isArray(result.items) ? result.items : [];
  for (const event of events) {
    if (!event?.eventId || seenEventSet.has(event.eventId)) continue;
    try {
      await syncEvent(event, token);
      rememberEventId(event.eventId);
    } catch {
      rememberEventId(event.eventId);
    }
  }
  if (result.cursor) {
    cursor = result.cursor;
  }
}

async function tick(): Promise<void> {
  if (!running) return;
  let nextDelay = POLL_INTERVAL_MS;
  try {
    await pollOnce();
  } catch {
    nextDelay = ERROR_RETRY_MS;
  }
  if (!running) return;
  timer = setTimeout(() => {
    void tick();
  }, nextDelay);
}

export function startObsFileSync(): void {
  if (running) return;
  running = true;
  cursor = '$';
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void tick();
}

export function stopObsFileSync(): void {
  running = false;
  cursor = '$';
  seenEventIds.length = 0;
  seenEventSet.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
