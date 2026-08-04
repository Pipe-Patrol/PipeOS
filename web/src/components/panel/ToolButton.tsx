import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tooltip and screen-reader name. Never optional. */
  label: string
  /** The key that does the same thing, appended to the tooltip. */
  hint?: string
  active?: boolean
  tone?: 'default' | 'fault'
  children: ReactNode
}

/**
 * One square in the palette.
 *
 * Every tool is the same size on purpose: an operator finds these by position
 * in a dark van, and a row of differently-sized buttons has no stable geometry
 * to learn. Active is a filled block, matching the sidebar — in a greyscale
 * palette a filled surface is the strongest signal available.
 */
export function ToolButton({
  label,
  hint,
  active = false,
  tone = 'default',
  className = '',
  children,
  ...props
}: ToolButtonProps) {
  const title = hint ? `${label} (${hint})` : label

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex size-10 shrink-0 items-center justify-center rounded-sm transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? tone === 'fault'
            ? 'bg-state-fault-surface text-ink-0'
            : 'bg-ink-800 text-ink-0'
          : 'text-ink-400 hover:bg-ink-900 hover:text-ink-100'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
