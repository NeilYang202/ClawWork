import type { ChatAttachment } from '@clawwork/shared';
import { parseTaskIdFromSessionKey } from '@clawwork/shared';
import type { ObsUploadConfig } from '../workspace/config.js';

export interface UploadedFileRef {
  fileName: string;
  objectKey?: string;
  url?: string;
  openclawPath?: string;
}

interface ObsUploadResponse {
  files?: UploadedFileRef[];
}

function normalizeBaseUrl(serviceUrl: string): string {
  return serviceUrl.replace(/\/+$/, '');
}

export async function uploadAttachmentsToObs(params: {
  obs: ObsUploadConfig | undefined;
  gatewayId: string;
  sessionKey: string;
  attachments: ChatAttachment[];
  token?: string;
}): Promise<UploadedFileRef[]> {
  const { obs, gatewayId, sessionKey, attachments, token } = params;
  if (!obs?.enabled) return [];
  if (!obs.serviceUrl?.trim()) return [];
  if (!attachments.length) return [];

  const baseUrl = normalizeBaseUrl(obs.serviceUrl);
  const taskId = parseTaskIdFromSessionKey(sessionKey) ?? undefined;

  const response = await fetch(`${baseUrl}/api/obs/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      gatewayId,
      taskId,
      sessionKey,
      bucket: obs.bucket,
      basePath: obs.basePath,
      files: attachments,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as ObsUploadResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `obs upload failed: ${response.status}`);
  }

  return payload.files ?? [];
}

export function buildUploadInjection(refs: UploadedFileRef[]): string {
  if (!refs.length) return '';
  const lines: string[] = [];
  lines.push('<clawwork_uploaded_files>');
  for (const ref of refs) {
    const openclawPath = ref.openclawPath ?? (ref.objectKey ? `obs://${ref.objectKey}` : undefined) ?? ref.url ?? '';
    lines.push(`- file: ${ref.fileName}`);
    lines.push(`  openclaw_path: ${openclawPath}`);
    if (ref.url) lines.push(`  url: ${ref.url}`);
  }
  lines.push('Use the uploaded files by their openclaw_path values when needed.');
  lines.push('</clawwork_uploaded_files>');
  return lines.join('\n');
}
