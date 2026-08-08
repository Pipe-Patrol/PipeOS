import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'primary' | 'quiet' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

/**
 * BORDER TINTS SIT CLOSE TO THEIR FILL. A tinted control is one object, and a
 * border several steps stronger than the surface behind it reads as two —
 * an outline with something else inside it. The border is there to define an
 * edge, not to announce anything, so it runs about ten points of alpha above
 * the fill and no more. The colour still says warning or fault; the edge does
 * not have to say it a second time, louder.
 */
const VARIANTS: Record<Variant, string> = {
  default:
    'border-white/14 bg-white/10 text-ink-100 hover:bg-white/16 active:bg-white/22',
  /**
   * The one action on a screen that moves the job forward. There is never more
   * than one on show at a time — a second would make the first mean nothing.
   */
  primary:
    'border-transparent bg-ink-0 text-ink-1000 hover:bg-ink-100 active:bg-ink-200 disabled:bg-white/10 disabled:text-ink-400',
  quiet:
    'border-transparent bg-transparent text-ink-400 hover:bg-white/8 hover:text-ink-100',
  danger:
    'border-state-fault-signal/25 bg-state-fault-signal/15 text-state-fault-signal hover:bg-state-fault-signal/25',
}

export function Button({ variant = 'default', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-panel border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

