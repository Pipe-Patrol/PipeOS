import { Circle, Square, Triangle, X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { useGamepad } from '@/input/useGamepad'

/**
 * What every control on the pad does, drawn where it sits on the pad.
 *
 * A LAYOUT, NOT A TABLE. The shortcut list already says all of this in two
 * columns, and two columns is the wrong shape for a thing you are holding: an
 * operator looking this up is trying to answer "which of these under my thumb
 * is record", and a list makes them translate a name into a position. Here the
 * left column is the pad's left half and the right column is its right half,
 * in the order the controls physically run down it.
 *
 * PLAYSTATION NAMING. The DualSense is the pad in the case, so cross, circle,
 * square and triangle are what is printed on the buttons and what is printed
 * here. The button INDICES are identical either way — the Gamepad API's
 * standard mapping puts cross where an Xbox pad puts A — so nothing in
 * useDriveInput cares which brand is plugged in, and an F310 still works with
 * the letters read off this diagram positionally.
 *
 * The four face glyphs are Phosphor shapes rather than drawings, so they sit on
 * the same weight curve as the rest of the icon set.
 */

interface Control {
  /** What is printed on the pad. */
  name: string
  glyph?: ReactNode
  action: string
  /** Said under the action when the control behaves unusually. */
  note?: string
}

const FACE: Control[] = [
  { name: 'Cross', glyph: <X size={13} weight="bold" />, action: 'Snapshot' },
  {
    name: 'Circle',
    glyph: <Circle size={13} weight="bold" />,
    action: 'Flag detection',
    note: 'Files whatever the model is surest about',
  },
  { name: 'Square', glyph: <Square size={13} weight="bold" />, action: 'Lights' },
  {
    name: 'Triangle',
    glyph: <Triangle size={13} weight="bold" />,
    action: 'Record',
    note: 'Starts, or stops',
  },
]

const RIGHT: Control[] = [
  { name: 'L1 · R1', action: 'Zoom out · in' },
  { name: 'Options', action: 'Return home', note: 'HOLD for a second — not a tap' },
]

const LEFT: Control[] = [
  { name: 'Left stick', action: 'Drive', note: 'Proportional. Forward is up' },
  { name: 'D-pad ↑ ↓', action: 'Drive', note: 'Full speed, no easing' },
  { name: 'D-pad ← →', action: 'Camera brightness' },
  { name: 'Create', action: 'Reset zoom and brightness' },
]

export function GamepadGuide() {
  const gamepad = useGamepad()

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-[12px] text-ink-400">
          Everything the driving screen does, without a keyboard.
        </p>
        <ConnectionChip connected={gamepad.connected} id={gamepad.id} />
      </div>

      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Group title="Left hand" controls={LEFT} />
        <div>
          <Group title="Right hand" controls={FACE} />
          <div className="mt-1">
            <Group title={null} controls={RIGHT} />
          </div>
        </div>
      </div>

      <p className="mt-4 border-t border-ink-800 pt-3 text-[11.5px] text-ink-500">
        L2 and R2 do nothing on purpose — they are the two controls a hand finds
        by accident, and nothing here is worth firing that way.
      </p>
    </div>
  )
}

function Group({ title, controls }: { title: string | null; controls: Control[] }) {
  return (
    <section>
      {title && <div className="label mb-1.5">{title}</div>}
      <ul>
        {controls.map((control) => (
          <li
            key={control.name}
            className="flex items-baseline gap-3 border-b border-ink-800/60 py-1.5 last:border-0"
          >
            <span className="flex w-[92px] shrink-0 items-center gap-1.5 text-[12px] text-ink-100">
              {control.glyph}
              {control.name}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-ink-0">{control.action}</span>
              {control.note && (
                <span className="block text-[11px] text-ink-500">{control.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Whether a pad is actually connected, and which.
 *
 * Here rather than left to the operator to work out, because a browser will not
 * report a gamepad until one of its buttons has been pressed — so "nothing
 * happens when I press circle" has two causes, and this separates them.
 */
function ConnectionChip({ connected, id }: { connected: boolean; id: string | null }) {
  if (!connected) {
    return (
      <span className="shrink-0 text-[11.5px] text-ink-500">
        Press any button to connect
      </span>
    )
  }
  return (
    <span
      className="shrink-0 truncate text-[11.5px] text-state-recording-signal"
      title={id ?? undefined}
    >
      Connected
    </span>
  )
}
