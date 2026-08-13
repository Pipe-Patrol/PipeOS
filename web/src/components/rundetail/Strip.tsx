import type { ReactNode } from 'react'

import { TrashIcon } from '@/components/primitives/icons'

/**
 * Rows five, six and seven: defects, recordings and captures.
 *
 * ONE COMPONENT FOR ALL THREE, because they are the same thing about different
 * content — a titled row of cards, every card selectable, every selection
 * landing in the same preview. Three hand-built strips would have drifted into
 * three card sizes and three hover states within a week, and the page would
 * read as three unrelated sections rather than as one list said three ways.
 */

export function Strip({
  title,
  count,
  empty,
  action,
  children,
}: {
  title: string
  count: number
  empty: string
  /** Optional control in the header, e.g. "Delete all". */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-baseline justify-between gap-4 border-b border-ink-800 px-4 py-2.5">
        <h2 className="display text-[13px] text-ink-0">{title}</h2>
        <div className="flex items-center gap-3">
          {count > 0 && action}
          <span className="tnum text-[12px] text-ink-500">{count}</span>
        </div>
      </header>

      {count === 0 ? (
        <p className="px-4 py-4 text-[12px] text-ink-500">{empty}</p>
      ) : (
        // Scrolls sideways rather than wrapping: a strip is a strip, and a run
        // with sixty captures should not push the page down by six rows.
        <div className="group/strip flex gap-2 overflow-x-auto px-4 py-3">{children}</div>
      )}
    </section>
  )
}

/**
 * One card in a strip.
 *
 * Fixed width so a row of them is a row and not a ragged edge, and the selected
 * one is ringed rather than tinted — a tint would fight whatever colour the
 * defect class already brought to the thumbnail.
 */
export function Card({
  selected,
  onClick,
  onDelete,
  deleteLabel,
  label,
  caption,
  children,
}: {
  selected: boolean
  onClick: () => void
  /** Shown as a corner control. Omit for cards that cannot be deleted. */
  onDelete?: () => void
  deleteLabel?: string
  label: string
  caption: string
  children: ReactNode
}) {
  // The delete control is a SIBLING of the card, not a child of it. The card is
  // a button, and a button inside a button is invalid markup that browsers
  // resolve however they like -- usually by making the inner one unclickable.
  return (
    <div className="relative w-[132px] shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={label}
        className={`w-full overflow-hidden rounded-panel border text-left transition-colors ${
          selected
            ? 'border-white/28 bg-white/12'
            : 'border-ink-800 hover:border-ink-700 hover:bg-white/5'
        }`}
      >
        <div className="relative aspect-[4/3] w-full bg-black">{children}</div>
        <div className="px-2 py-1.5">
          <div className="truncate text-[12px] text-ink-100">{label}</div>
          <div className="tnum truncate text-[11px] text-ink-500">{caption}</div>
        </div>
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title={deleteLabel ?? `Delete ${label}`}
          aria-label={deleteLabel ?? `Delete ${label}`}
          className="absolute top-1 right-1 rounded-sm bg-black/55 p-1 text-ink-300 opacity-0 transition-opacity hover:text-state-fault-signal focus-visible:opacity-100 group-hover/strip:opacity-100"
        >
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  )
}
