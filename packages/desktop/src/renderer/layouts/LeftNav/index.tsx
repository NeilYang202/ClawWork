import {
  Plus,
  Search,
  FolderOpen,
  Settings,
  MessageSquare,
} from 'lucide-react';

/** Static task item for skeleton UI */
function TaskItem({
  title,
  time,
  active = false,
}: {
  title: string;
  time: string;
  active?: boolean;
}) {
  return (
    <button
      className={`titlebar-no-drag w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        active
          ? 'bg-[var(--accent-dim)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      <MessageSquare size={16} className="mt-0.5 flex-shrink-0 opacity-50" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{time}</p>
      </div>
    </button>
  );
}

export default function LeftNav() {
  return (
    <div className="flex flex-col h-full pt-10">
      {/* New Task + Search */}
      <div className="px-3 pb-3 space-y-2 flex-shrink-0">
        <button className="titlebar-no-drag w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-[var(--accent)] text-black font-medium text-sm hover:opacity-90 transition-opacity">
          <Plus size={16} />
          新任务
        </button>

        <div className="titlebar-no-drag relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="搜索任务…"
            className="w-full h-8 pl-8 pr-3 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-accent)] transition-colors"
          />
        </div>
      </div>

      {/* Files shortcut */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button className="titlebar-no-drag w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          <FolderOpen size={16} className="opacity-60" />
          文件管理
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-3 py-2">
          进行中
        </p>
        <TaskItem title="设计登录页面" time="2 分钟前" active />
        <TaskItem title="API 接口对接" time="15 分钟前" />

        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-3 py-2 mt-3">
          已完成
        </p>
        <TaskItem title="项目环境搭建" time="昨天" />
      </div>

      {/* Settings */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-[var(--border)]">
        <button className="titlebar-no-drag w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Settings size={16} className="opacity-60" />
          设置
        </button>
      </div>
    </div>
  );
}
