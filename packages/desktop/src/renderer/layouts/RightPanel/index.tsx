import { X, FileText, GitBranch } from 'lucide-react';

interface RightPanelProps {
  onClose: () => void;
}

export default function RightPanel({ onClose }: RightPanelProps) {
  return (
    <div className="flex flex-col h-full pt-10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--border)] flex-shrink-0">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          上下文
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Artifacts section */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
            任务产物
          </h4>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)]">
              <FileText size={14} className="opacity-60" />
              <span className="truncate">暂无文件</span>
            </div>
          </div>
        </section>

        {/* Git section */}
        <section>
          <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
            版本记录
          </h4>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)]">
            <GitBranch size={14} className="opacity-60" />
            <span className="truncate">暂无提交</span>
          </div>
        </section>
      </div>
    </div>
  );
}
