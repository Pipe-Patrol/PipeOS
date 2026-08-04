import type { ReactNode } from 'react'

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-[13px] text-ink-400">{title}</p>
      {action}
    </div>
  )
}
