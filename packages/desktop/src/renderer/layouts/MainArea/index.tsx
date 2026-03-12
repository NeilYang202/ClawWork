import { PanelRightOpen, Send } from 'lucide-react';

interface MainAreaProps {
  onTogglePanel: () => void;
}

export default function MainArea({ onTogglePanel }: MainAreaProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="titlebar-drag flex items-center justify-between h-12 px-4 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 pl-16">
          <h2 className="text-sm font-medium text-[var(--text-primary)] truncate">
            设计登录页面
          </h2>
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)]">
            进行中
          </span>
        </div>
        <button
          onClick={onTogglePanel}
          className="titlebar-no-drag p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="切换上下文面板"
        >
          <PanelRightOpen size={18} />
        </button>
      </header>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Welcome placeholder */}
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center mb-4">
              <span className="text-[var(--accent)] text-xl font-bold">C</span>
            </div>
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
              ClawWork
            </h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md">
              描述你的任务，AI 将帮你规划并执行。过程中产生的文件会自动归档管理。
            </p>
          </div>
        </div>
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 px-6 pb-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-3">
            <textarea
              rows={1}
              placeholder="描述你的任务…"
              className="flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none max-h-32"
            />
            <button className="flex-shrink-0 p-2 rounded-lg bg-[var(--accent)] text-black hover:opacity-90 transition-opacity">
              <Send size={16} />
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] text-center mt-2">
            由 OpenClaw 驱动 · 任务文件自动 Git 归档
          </p>
        </div>
      </div>
    </div>
  );
}
