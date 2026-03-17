import { useEffect, useRef, useState, useCallback } from 'react';
import { File, Image, FileText, FolderPlus, AlertCircle } from 'lucide-react';
import type { FileIndexEntry } from '@clawwork/shared';
import { cn, formatFileSize } from '@/lib/utils';

interface FilePickerProps {
  visible: boolean;
  query: string;
  folders: string[];
  selectedIndex: number;
  onSelect: (entry: FileIndexEntry) => void;
  onHoverIndex: (index: number) => void;
  onClose: () => void;
  onItemsChange?: (items: FileIndexEntry[]) => void;
  onAddFolder?: () => void;
}

function tierIcon(tier: string, size: number) {
  if (tier === 'image') return <Image size={size} className="text-[var(--accent)]" />;
  if (tier === 'document') return <FileText size={size} className="text-amber-400" />;
  return <File size={size} className="text-[var(--text-muted)]" />;
}

export default function FilePicker({
  visible,
  query,
  folders,
  selectedIndex,
  onSelect,
  onHoverIndex,
  onClose: _onClose,
  onItemsChange,
  onAddFolder,
}: FilePickerProps) {
  const [files, setFiles] = useState<FileIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reqIdRef = useRef(0);

  const fetchFiles = useCallback(
    async (q: string, flds: string[]) => {
      const id = ++reqIdRef.current;
      setLoading(true);
      try {
        const res = await window.clawwork.listContextFiles(flds, q || undefined);
        if (id !== reqIdRef.current) return;
        if (res.ok && Array.isArray(res.result)) {
          const items = res.result as FileIndexEntry[];
          setFiles(items);
          onItemsChange?.(items);
        }
      } catch {
        if (id === reqIdRef.current) setFiles([]);
      }
      if (id === reqIdRef.current) setLoading(false);
    },
    [onItemsChange],
  );

  useEffect(() => {
    if (!visible) return;
    if (folders.length === 0) {
      setFiles([]);
      onItemsChange?.([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchFiles(query, folders), 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible, query, folders, fetchFiles, onItemsChange]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!visible) return null;

  if (folders.length === 0) {
    return (
      <div
        className={cn(
          'absolute bottom-full left-0 right-0 mb-2 z-50',
          'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]',
          'rounded-xl shadow-[var(--shadow-elevated)] p-4',
        )}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <AlertCircle size={20} className="text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">No context folders added</p>
          <button
            onClick={onAddFolder}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
              'bg-[var(--accent)] text-[var(--accent-contrast)]',
              'hover:opacity-90 active:scale-[0.98] transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-accent)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <FolderPlus size={14} />
            Add a Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 right-0 mb-2 z-50',
        'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]',
        'rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden',
      )}
    >
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {loading && files.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">Scanning files...</div>
        )}
        {!loading && files.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">No matching files</div>
        )}
        {files.map((f, i) => (
          <button
            key={f.absolutePath}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm',
              'hover:bg-[var(--bg-hover)] transition-colors',
              i === selectedIndex && 'bg-[var(--bg-hover)]',
              f.tier === 'unsupported' && 'opacity-40 cursor-not-allowed',
            )}
            onClick={() => f.tier !== 'unsupported' && onSelect(f)}
            onMouseEnter={() => onHoverIndex(i)}
          >
            {tierIcon(f.tier, 14)}
            <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">{f.relativePath}</span>
            <span className="flex-shrink-0 text-xs text-[var(--text-muted)]">{formatFileSize(f.size)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
