import { toast } from 'sonner';
import type { PendingImage, PendingUploadFile } from './types';
import { MAX_IMAGE_SIZE, MAX_UPLOAD_FILE_SIZE, GATEWAY_INJECTED_MODEL } from './constants';

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

export function getModelLabel(model: string | undefined, fallback?: string): string {
  if (!model || model === GATEWAY_INJECTED_MODEL) return fallback ?? 'Default';
  return model.split('/').pop() ?? model;
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function processImageFiles(files: File[], t: TranslateFn): PendingImage[] {
  const accepted: PendingImage[] = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error(
        t('chatInput.imageTooLarge', {
          fileName: file.name,
          defaultValue: `${file.name} exceeds 5MB limit`,
        }),
      );
      continue;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(
        t('chatInput.invalidImageType', {
          fileName: file.name,
          defaultValue: `${file.name} is not an image`,
        }),
      );
      continue;
    }
    accepted.push({ file, previewUrl: URL.createObjectURL(file) });
  }
  return accepted;
}

const DOC_MIME_PREFIXES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const DOC_EXT_RE = /\.(txt|pdf|doc|docx|xls|xlsx|ppt|pptx|csv)$/i;

export function processUploadFiles(files: File[], t: TranslateFn): { images: PendingImage[]; files: PendingUploadFile[] } {
  const images: PendingImage[] = [];
  const docs: PendingUploadFile[] = [];
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(
          t('chatInput.imageTooLarge', {
            fileName: file.name,
            defaultValue: `${file.name} exceeds 5MB limit`,
          }),
        );
        continue;
      }
      images.push({ file, previewUrl: URL.createObjectURL(file) });
      continue;
    }

    const isDocType = DOC_MIME_PREFIXES.includes(file.type) || DOC_EXT_RE.test(file.name);
    if (!isDocType) {
      toast.error(
        t('chatInput.unsupportedUploadType', {
          fileName: file.name,
          defaultValue: `${file.name} type is not supported`,
        }),
      );
      continue;
    }
    if (file.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error(
        t('chatInput.fileTooLarge', {
          fileName: file.name,
          defaultValue: `${file.name} exceeds 20MB limit`,
        }),
      );
      continue;
    }
    docs.push({ file });
  }
  return { images, files: docs };
}

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
