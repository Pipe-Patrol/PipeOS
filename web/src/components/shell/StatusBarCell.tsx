import type { ReactNode } from 'react'

interface StatusBarCellProps {
  children: ReactNode
  /** Suppresses the leading rule on the first cell in a group. */
  first?: boolean
}

/**
 * One slot in the status bar's right-hand cluster.
 *
 * Fixed-width columns separated by hairline rules, not values strung together
 * with middots. Columns hold their position as the numbers inside them change,
 * so an operator learns where to look once instead of re-reading the row every
 * time a digit gains a character.
 */
export function StatusBarCell({ children, first = false }: StatusBarCellProps) {
  return (
    <div
      className={`flex h-full min-w-[82px] flex-col justify-center gap-[3px] px-3.5 ${
        first ? '' : 'border-l border-ink-0/12'
      }`}
    >
      {children}
    </div>
  )
}
