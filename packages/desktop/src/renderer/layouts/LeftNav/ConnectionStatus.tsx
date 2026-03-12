import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

type Status = 'connected' | 'connecting' | 'disconnected'

const STATUS_CONFIG: Record<Status, { color: string; label: string; pulse?: boolean }> = {
  connected: { color: 'bg-[var(--accent)]', label: '已连接' },
  connecting: { color: 'bg-[var(--warning)]', label: '连接中…', pulse: true },
  disconnected: { color: 'bg-[var(--danger)]', label: '已断开' },
}

interface ConnectionStatusProps {
  status: Status
  className?: string
}

export default function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  const cfg = STATUS_CONFIG[status]

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className={cn('flex items-center gap-2 px-3 py-1.5 text-xs', className)}
      >
        <span
          className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            cfg.color,
            cfg.pulse && 'animate-pulse',
          )}
        />
        <span className="text-[var(--text-muted)]">{cfg.label}</span>
      </motion.div>
    </AnimatePresence>
  )
}
