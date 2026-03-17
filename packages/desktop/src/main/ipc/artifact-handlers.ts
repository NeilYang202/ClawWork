import { ipcMain, BrowserWindow } from 'electron';
import { readFileSync } from 'fs';
import { resolve, sep } from 'path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { artifacts } from '../db/schema.js';
import { saveArtifact } from '../artifact/save.js';
import { commitArtifact } from '../artifact/git.js';
import { getWorkspacePath } from '../workspace/config.js';

interface SaveParams {
  taskId: string;
  sourcePath: string;
  messageId: string;
  fileName?: string;
  mediaType?: string;
}

export function registerArtifactHandlers(): void {
  ipcMain.handle('artifact:save', async (_event, params: SaveParams) => {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
      return { ok: false, error: 'workspace not configured' };
    }
    try {
      const artifact = await saveArtifact({
        workspacePath,
        taskId: params.taskId,
        sourcePath: params.sourcePath,
        messageId: params.messageId,
        fileName: params.fileName,
        mediaType: params.mediaType,
      });

      const sha = await commitArtifact(workspacePath, artifact.localPath);
      if (sha) {
        const db = getDb();
        db.update(artifacts).set({ gitSha: sha }).where(eq(artifacts.id, artifact.id)).run();
        artifact.gitSha = sha;
      }

      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send('artifact:saved', artifact);
      }

      return { ok: true, result: artifact };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('artifact:list', async (_event, params: { taskId?: string }) => {
    try {
      const db = getDb();
      const rows = params.taskId
        ? db.select().from(artifacts).where(eq(artifacts.taskId, params.taskId)).all()
        : db.select().from(artifacts).all();
      return { ok: true, result: rows };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('artifact:get', async (_event, params: { id: string }) => {
    try {
      const db = getDb();
      const rows = db.select().from(artifacts).where(eq(artifacts.id, params.id)).all();
      if (rows.length === 0) {
        return { ok: false, error: 'artifact not found' };
      }
      return { ok: true, result: rows[0] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('artifact:read-file', async (_event, params: { localPath: string }) => {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) return { ok: false, error: 'workspace not configured' };
    try {
      const normalizedBase = resolve(workspacePath);
      const fullPath = resolve(normalizedBase, params.localPath);
      if (!fullPath.startsWith(normalizedBase + sep) && fullPath !== normalizedBase) {
        return { ok: false, error: 'invalid path' };
      }
      const encoding = isTextFile(params.localPath) ? 'utf-8' : 'base64';
      const content = readFileSync(fullPath, encoding);
      return { ok: true, result: { content, encoding } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  });
}

const TEXT_EXTS = new Set([
  '.md',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.html',
  '.css',
  '.sql',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.sh',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.toml',
  '.env',
]);

function isTextFile(localPath: string): boolean {
  const dot = localPath.lastIndexOf('.');
  if (dot === -1) return true;
  return TEXT_EXTS.has(localPath.slice(dot).toLowerCase());
}
