import type { ReactNode } from 'react'

import { ControllerSetup } from '@/components/live/runsetup/ControllerSetup'
import { SettingRow } from '@/components/live/runsetup/SettingRow'

/**
 * How the robot is driven, read before the run rather than after it.
 *
 * This used to be a modal that appeared once the run had already started, which
 * put it on screen at the one moment the operator had somewhere else to look.
 * It belongs here: two of the controls are invisible — there is no on-screen
 * d-pad and a gamepad cannot announce itself until a button is pressed — so the
 * screen has to say so, and the setup panel is where the operator already is.
 */
export function ControlsSection() {
  return (
    <div className="flex flex-col gap-2.5">
      <SettingRow label="Drive">
        <Keys keys={['W', '↑']} /> <Word>forward</Word> <Keys keys={['S', '↓']} />{' '}
        <Word>back</Word>
      </SettingRow>

      <SettingRow label="Capture">
        <Keys keys={['C']} /> <Word>snapshot</Word> <Keys keys={['D']} />{' '}
        <Word>defect</Word> <Keys keys={['R']} /> <Word>record</Word>
      </SettingRow>

      <SettingRow label="Help">
        <Keys keys={['?']} /> <Word>all shortcuts</Word>
      </SettingRow>

      <ControllerSetup />
    </div>
  )
}

function Word({ children }: { children: ReactNode }) {
  return <span className="text-[12px] text-ink-400">{children}</span>
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded-sm border border-ink-800 px-1.5 py-0.5 text-[11px] text-ink-100"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
