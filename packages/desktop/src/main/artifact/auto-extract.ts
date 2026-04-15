import { BrowserWindow } from 'electron';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, sep, basename } from 'path';
import { homedir } from 'os';
import { extractImagesFromMarkdown, extractCodeBlocksFromMarkdown } from './extract.js';
import { saveArtifact, saveArtifactFromBuffer } from './save.js';
import { getDb } from '../db/index.js';
import { artifacts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { safeFetch } from '../net/safe-fetch.js';
import type { Artifact } from '@clawwork/shared';

interface AutoExtractParams {
  workspacePath: string;
  taskId: string;
  messageId: string;
  content: string;
  toolCalls?: unknown[];
}

export async function autoExtractArtifacts(params: AutoExtractParams): Promise<void> {
  const { workspacePath, taskId, messageId, content, toolCalls } = params;

  const db = getDb();
  const existingForMsg = db.select().from(artifacts).where(eq(artifacts.messageId, messageId)).all();
  if (existingForMsg.length > 0) return;

  const images = extractImagesFromMarkdown(content);
  const codeBlocks = extractCodeBlocksFromMarkdown(content);

  const saved: Artifact[] = [];

  for (const img of images) {
    try {
      let buffer: Buffer;
      if (img.isRemote) {
        buffer = await safeFetch(img.src);
      } else if (img.src.startsWith('clawwork-media://')) {
        const filePath = resolve(img.src.replace('clawwork-media://', ''));
        if (!filePath.startsWith(resolve(workspacePath) + sep)) continue;
        buffer = readFileSync(filePath);
      } else {
        continue;
      }
      const ext = img.src.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'png';
      const fileName = img.alt ? `${img.alt.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}` : `image.${ext}`;
      saved.push(
        await saveArtifactFromBuffer({ workspacePath, taskId, messageId, fileName, buffer, artifactType: 'image' }),
      );
    } catch (err) {
      console.error('[auto-extract] image save failed:', err);
    }
  }

  for (const block of codeBlocks) {
    try {
      saved.push(
        await saveArtifactFromBuffer({
          workspacePath,
          taskId,
          messageId,
          fileName: block.fileName,
          buffer: Buffer.from(block.content, 'utf-8'),
          artifactType: 'code',
          contentText: block.content,
        }),
      );
    } catch (err) {
      console.error('[auto-extract] code block save failed:', err);
    }
  }

  const candidates = collectToolFilePaths(toolCalls);
  const allowedPrefixes = [
    resolve(workspacePath) + sep,
    '/tmp' + sep,
    '/var/tmp' + sep,
    '/appl' + sep,
    resolve(homedir(), '.openclaw') + sep,
  ];
  for (const sourcePath of candidates) {
    try {
      const resolvedSource = resolve(sourcePath);
      if (!existsSync(resolvedSource) || !statSync(resolvedSource).isFile()) continue;
      if (!allowedPrefixes.some((prefix) => resolvedSource.startsWith(prefix))) continue;
      saved.push(
        await saveArtifact({
          workspacePath,
          taskId,
          messageId,
          sourcePath: resolvedSource,
          fileName: basename(resolvedSource),
        }),
      );
    } catch (err) {
      console.error('[auto-extract] tool file save failed:', err);
    }
  }

  if (saved.length === 0) return;

  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    for (const artifact of saved) {
      win.webContents.send('artifact:saved', artifact);
    }
  }
}

function collectToolFilePaths(toolCalls: unknown[] | undefined): string[] {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
  const pathKeys = new Set([
    'mediapath',
    'media_path',
    'filepath',
    'file_path',
    'path',
    'outputpath',
    'output_path',
    'outputfile',
    'output_file',
    'targetpath',
    'target_path',
    'localpath',
    'local_path',
  ]);
  const paths = new Set<string>();

  const visit = (value: unknown): void => {
    if (!value) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('/') || /^[a-zA-Z]:\\/.test(trimmed)) {
        paths.add(trimmed);
        return;
      }
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          visit(parsed);
        } catch {
          return;
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string' && pathKeys.has(k.toLowerCase())) {
          paths.add(v);
        } else {
          visit(v);
        }
      }
    }
  };

  for (const tc of toolCalls) {
    visit(tc);
  }
  return [...paths];
}
