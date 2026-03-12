import { motion } from 'framer-motion'
import { MessageSquare, FileText, FolderOpen } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export interface SearchResult {
  type: 'task' | 'message' | 'artifact'
  id: string
  title: string
  snippet: string
  taskId?: string
}

interface SearchResultsProps {
  results: SearchResult[]
  onSelect: (result: SearchResult) => void
}

const ICON_MAP = {
  task: FolderOpen,
  message: MessageSquare,
  artifact: FileText,
} as const

const LABEL_MAP = {
  task: '任务',
  message: '消息',
  artifact: '文件',
} as const

const listItem = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.15 },
}

function highlightSnippet(text: string): React.ReactNode[] {
  const parts = text.split(/(<<.*?>>)/g)
  return parts.map((part, i) => {
    if (part.startsWith('<<') && part.endsWith('>>')) {
      return (
        <span key={i} className="text-[var(--accent)] font-medium">
          {part.slice(2, -2)}
        </span>
      )
    }
    return part
  })
}

export default function SearchResults({ results, onSelect }: SearchResultsProps) {
  const grouped = {
    task: results.filter((r) => r.type === 'task'),
    message: results.filter((r) => r.type === 'message'),
    artifact: results.filter((r) => r.type === 'artifact'),
  }

  const sections = (['task', 'message', 'artifact'] as const).filter(
    (t) => grouped[t].length > 0,
  )

  if (sections.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
        未找到结果
      </div>
    )
  }

  return (
    <ScrollArea className="max-h-[360px]">
      <div className="p-2 space-y-3">
        {sections.map((type) => (
          <div key={type}>
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] px-2 pb-1">
              {LABEL_MAP[type]} ({grouped[type].length})
            </p>
            {grouped[type].map((result, idx) => {
              const Icon = ICON_MAP[result.type]
              return (
                <motion.button
                  key={result.id}
                  {...listItem}
                  transition={{ ...listItem.transition, delay: idx * 0.03 }}
                  onClick={() => onSelect(result)}
                  className={cn(
                    'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left',
                    'transition-colors hover:bg-[var(--bg-hover)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring-accent)]',
                  )}
                >
                  <Icon
                    size={15}
                    className="mt-0.5 flex-shrink-0 text-[var(--text-muted)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)] truncate">
                      {result.title || '(无标题)'}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                      {highlightSnippet(result.snippet)}
                    </p>
                  </div>
                </motion.button>
              )
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
