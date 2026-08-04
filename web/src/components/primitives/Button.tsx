import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'quiet' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  default:
    'border-ink-800 bg-white/10 text-ink-100 hover:bg-white/16 active:bg-white/22',
  quiet:
    'border-transparent bg-transparent text-ink-400 hover:bg-white/8 hover:text-ink-100',
  danger:
    'border-state-fault-signal/60 bg-state-fault-signal/15 text-state-fault-signal hover:bg-state-fault-signal/25',
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

