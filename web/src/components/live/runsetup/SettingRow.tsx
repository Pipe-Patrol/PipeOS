import type { ReactNode } from 'react'

import { InfoHint } from '@/components/primitives/InfoHint'

/**
 * ONE SHAPE FOR EVERY SETTING IN THE PANEL.
 *
 * The panel had four type sizes doing the same job — a 10.5px `label` over the
 * sample rate, a 13px heading over the record toggle, a 20px readout on the
 * compass — and the effect was that two controls of equal importance looked
 * like a heading and a footnote. Size is meant to say what something IS, not
 * which component happened to render it.
 *
 * So: the name is always 13px, the supporting line under it is always 11.5px,
 * and the value or control is always at the right. Anything in this panel that
 * does not go through here is a deliberate exception and there should be a
 * reason for it.
 */

interface SettingRowProps {
  label: string
  /** The line under the name. For what the setting does, not what it is set to. */
  hint?: string
  /** Tooltip content, shown behind an info icon beside the name. */
  info?: ReactNode
  /** The control or reading, laid out at the right of the row. */
  children?: ReactNode
  /**
   * Put the control on its own line under the name. For anything too wide to
   * sit beside it — a map, a wrapping set of chips.
   */
  stack?: boolean
}

export function SettingRow({ label, hint, info, children, stack }: SettingRowProps) {
  const name = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[13px] text-ink-100">{label}</span>
      {info && <InfoHint label={`About ${label.toLowerCase()}`}>{info}</InfoHint>}
    </div>
  )

  if (stack) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">{name}</div>
        {hint && <p className="mt-0.5 text-[11.5px] leading-[15px] text-ink-400">{hint}</p>}
        <div className="mt-2">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {name}
        {hint && <p className="mt-0.5 text-[11.5px] leading-[15px] text-ink-400">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

/** A reading at the right of a row. The one size every value is shown at. */
export function RowValue({ children }: { children: ReactNode }) {
  return <span className="text-[12px] tnum text-ink-200">{children}</span>
}
