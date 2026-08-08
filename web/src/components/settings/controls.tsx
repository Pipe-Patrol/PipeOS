import type { ReactNode } from 'react'

/**
 * The pieces every settings section is built from.
 *
 * They exist because the screen had none: each section had invented its own
 * header size, its own row spacing and its own control, so a page of six
 * sections read as six pages. One row shape and one header shape is most of
 * what "redesign settings" actually means.
 */

/**
 * A section, with a header that is a header.
 *
 * The old ones used `label` — 10.5 px, ink-400, letter-spaced. That is the
 * style for a column heading inside a table, and using it for the title of a
 * section made every heading on the page quieter than the text underneath it.
 * A heading outranks its content or it is not doing anything.
 */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="display text-[15px] text-ink-0">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12px] leading-[16px] text-ink-400">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className="divide-y divide-ink-850">{children}</div>
    </section>
  )
}

/**
 * One setting: what it is on the left, the control on the right.
 *
 * Fixed height and one alignment for every row, so a column of them scans as a
 * column rather than as a stack of differently-shaped cards.
 */
export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-100">{label}</div>
        {hint && <p className="mt-0.5 text-[11.5px] leading-[15px] text-ink-500">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** A read-only fact about the robot. Same row rhythm as a setting. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-2">
      <span className="text-[13px] text-ink-300">{label}</span>
      <span className="tnum truncate text-[13px] text-ink-100">{value}</span>
    </div>
  )
}

/**
 * On or off.
 *
 * A switch rather than a checkbox: these are settings that take effect
 * immediately, and a checkbox implies a form with a save button somewhere.
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
        checked ? 'bg-ink-0' : 'bg-ink-700 hover:bg-ink-600'
      }`}
    >
      <span
        className={`absolute top-[3px] size-4 rounded-full transition-all ${
          checked ? 'left-[19px] bg-ink-1000' : 'left-[3px] bg-ink-300'
        }`}
      />
    </button>
  )
}

/** A short list of mutually exclusive choices, as one segmented control. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="flex shrink-0 rounded-panel border border-ink-800 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 min-w-[44px] rounded-[6px] px-2 text-[12.5px] transition-colors ${
            value === option.value
              ? 'bg-white/16 text-ink-0'
              : 'text-ink-400 hover:bg-white/8 hover:text-ink-100'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A number with a slider and its value beside it.
 *
 * The number is shown because several of these are thresholds that end up
 * explaining a decision the console made — "why did it not flag that" is
 * answered by a figure, not by a knob position.
 */
export function Range({
  value,
  min,
  max,
  step,
  display,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (next: number) => void
  label: string
}) {
  return (
    <>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slider w-[120px]"
        style={{ '--slider-fill': `${((value - min) / (max - min)) * 100}%` } as never}
      />
      <span className="tnum w-[52px] text-right text-[12.5px] text-ink-200">
        {display}
      </span>
    </>
  )
}
