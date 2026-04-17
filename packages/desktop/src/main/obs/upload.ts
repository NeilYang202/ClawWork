import type { ChatAttachment } from '@clawwork/shared';
import { parseTaskIdFromSessionKey } from '@clawwork/shared';

export interface UploadedFileRef {
  fileName: string;
  objectKey?: string;
  url?: string;
  openclawPath?: string;
}

interface ObsUploadResponse {
  files?: UploadedFileRef[];
  detail?: string;
  message?: string;
}

function normalizeBaseUrl(serviceUrl: string): string {
  return serviceUrl.replace(/\/+$/, '');
}

export async function uploadAttachmentsToObs(params: {
  serviceUrl: string | undefined;
  gatewayId: string;
  sessionKey: string;
  attachments: ChatAttachment[];
  token?: string;
}): Promise<UploadedFileRef[]> {
  const { serviceUrl, gatewayId, sessionKey, attachments, token } = params;
  return uploadFilesToObs({
    serviceUrl,
    gatewayId,
    sessionKey,
    files: attachments.map((item) => ({
      mimeType: item.mimeType,
      fileName: item.fileName,
      content: item.content,
    })),
    token,
  });
}

export async function uploadGeneratedFileToObs(params: {
  serviceUrl: string | undefined;
  gatewayId: string;
  sessionKey: string;
  taskId?: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  token?: string;
}): Promise<UploadedFileRef[]> {
  return uploadFilesToObs({
    serviceUrl: params.serviceUrl,
    gatewayId: params.gatewayId,
    sessionKey: params.sessionKey,
    taskId: params.taskId,
    files: [{ mimeType: params.mimeType, fileName: params.fileName, content: params.contentBase64 }],
    token: params.token,
  });
}

async function uploadFilesToObs(params: {
  serviceUrl: string | undefined;
  gatewayId: string;
  sessionKey: string;
  taskId?: string;
  files: Array<{ mimeType: string; fileName: string; content: string }>;
  token?: string;
}): Promise<UploadedFileRef[]> {
  const { serviceUrl, gatewayId, sessionKey, taskId, files, token } = params;
  if (!serviceUrl?.trim()) return [];
  if (!files.length) return [];

  const baseUrl = normalizeBaseUrl(serviceUrl);
  const resolvedTaskId = taskId ?? parseTaskIdFromSessionKey(sessionKey) ?? undefined;

  const response = await fetch(`${baseUrl}/api/obs/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      gatewayId,
      taskId: resolvedTaskId,
      sessionKey,
      files,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as ObsUploadResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || payload.message || `obs upload failed: ${response.status}`);
  }

  return payload.files ?? [];
}

export function buildUploadInjection(refs: UploadedFileRef[]): string {
  if (!refs.length) return '';
  const lines: string[] = [];
  lines.push('<clawwork_uploaded_files>');
  for (const ref of refs) {
    lines.push(`- file: ${ref.fileName}`);
    if (ref.url) lines.push(`  download_url: ${ref.url}`);
  }
  lines.push('Use the uploaded files by their download_url values when needed.');
  lines.push('</clawwork_uploaded_files>');
  return lines.join('\n');
}
