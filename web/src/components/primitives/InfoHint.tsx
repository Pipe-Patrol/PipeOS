import type { ReactNode } from 'react'
import { Info } from '@phosphor-icons/react'

import { phosphorWeight } from '@/components/primitives/iconStroke'

const ICON_SIZE = 15

interface InfoHintProps {
  /** What the icon is about, for screen readers and the tooltip's own label. */
  label: string
  children: ReactNode
}

/**
 * An explanation that costs no space until it is wanted.
 *
 * For text that an operator needs once and then never again: how a control
 * works, why it exists, what happens if it is skipped. Anything that has to be
 * read every time belongs on the panel, not behind a hover.
 *
 * It opens on focus as well as hover, so it is reachable from a keyboard, and
 * the tooltip hangs from the right edge of the icon because these sit at the
 * right of a narrow panel and a left-anchored one would run off it.
 */
export function InfoHint({ label, children }: InfoHintProps) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="rounded-sm p-0.5 text-ink-500 transition-colors hover:text-ink-100 focus-visible:text-ink-100 focus-visible:outline-none"
      >
        <Info size={ICON_SIZE} weight={phosphorWeight(ICON_SIZE)} />
      </button>

      <span
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden w-60 rounded-panel border border-ink-700 bg-ink-900 px-3 py-2 text-[11.5px] leading-[16px] text-ink-300 shadow-lg group-focus-within:block group-hover:block"
      >
        {children}
      </span>
    </span>
  )
}
