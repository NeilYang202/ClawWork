import { isValidElement, type ReactNode, useEffect, useState, type ComponentPropsWithoutRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';

interface MarkdownContentProps {
  content: string;
  onImageClick?: (src: string) => void;
  showMessageCopy?: boolean;
  showCursor?: boolean;
}

function flattenTextContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(flattenTextContent).join('');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenTextContent(node.props.children);
  }

  return '';
}

function extractLang(children: ReactNode): string {
  if (!isValidElement<{ className?: string }>(children)) return '';
  const cls = children.props.className ?? '';
  const match = /language-(\S+)/.exec(cls);
  return match ? match[1] : '';
}

interface CopyActionButtonProps {
  label: string;
  copiedLabel: string;
  text: string;
  className?: string;
}

function CopyActionButton({ label, copiedLabel, text, className }: CopyActionButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (): Promise<void> => {
    await copyTextToClipboard(text);
    setCopied(true);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      className={cn(
        'h-7 w-7 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/90 backdrop-blur-sm',
        'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

const REMARK_PLUGINS = [remarkGfm] as const;
const REHYPE_PLUGINS = [rehypeHighlight] as const;

export default function MarkdownContent({
  content,
  onImageClick,
  showMessageCopy = false,
  showCursor = false,
}: MarkdownContentProps) {
  const { t } = useTranslation();
  const copyMessageLabel = t('chatMessage.copyMessage');
  const copyCodeLabel = t('chatMessage.copyCode');
  const copiedLabel = t('chatMessage.copied');

  return (
    <div className="group min-w-0">
      <div className={cn('flex min-w-0 items-start gap-2', showMessageCopy && 'justify-between')}>
        <div className="prose-chat min-w-0 flex-1">
          <Markdown
            remarkPlugins={[...REMARK_PLUGINS]}
            rehypePlugins={[...REHYPE_PLUGINS]}
            components={{
              table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
                <div className="overflow-x-auto my-2">
                  <table>{children}</table>
                </div>
              ),
              a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
                <a
                  href={href}
                  onClick={(e) => {
                    if (href && /^https?:\/\//.test(href)) {
                      e.preventDefault();
                      window.open(href, '_blank');
                    }
                  }}
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              img: ({ src, alt }: ComponentPropsWithoutRef<'img'>) => {
                const actualSrc = src?.startsWith('clawwork-media://')
                  ? `file://${src.replace('clawwork-media://', '')}`
                  : src;
                return (
                  <img
                    src={actualSrc}
                    alt={alt ?? ''}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                    className="max-w-full max-h-80 rounded-lg mt-2 cursor-pointer"
                    onClick={() => actualSrc && onImageClick?.(actualSrc)}
                  />
                );
              },
              pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => {
                const code = flattenTextContent(children).replace(/\n$/, '');
                const lang = extractLang(children);
                return (
                  <div className="group/code relative">
                    {lang && (
                      <span className="absolute left-3 top-2.5 text-xs text-[var(--text-muted)] select-none pointer-events-none">
                        {lang}
                      </span>
                    )}
                    <CopyActionButton
                      label={copyCodeLabel}
                      copiedLabel={copiedLabel}
                      text={code}
                      className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
                    />
                    <pre className="pt-10">{children}</pre>
                  </div>
                );
              },
            }}
          >
            {content}
          </Markdown>
        </div>
        {showMessageCopy && content.trim() && (
          <CopyActionButton
            label={copyMessageLabel}
            copiedLabel={copiedLabel}
            text={content}
            className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
      {showCursor && (
        <span className="inline-block w-1.5 h-4 bg-[var(--accent)] animate-pulse ml-0.5 align-middle rounded-sm" />
      )}
    </div>
  );
}
