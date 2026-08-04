import { useState } from 'react'

import { Button } from '@/components/primitives/Button'
import { ShieldIcon } from '@/components/primitives/icons'

/**
 * The preflight checks confirmed before every run.
 *
 * Edit this list to match your crew's SOP — it is the single source of truth
 * for what an operator confirms before the robot goes down a live pipe. These
 * are shown as a read-only list; the operator ticks one box below to assume
 * responsibility for all of them.
 */
export const PREFLIGHT_CHECKS = [
  'Housing is intact, no cracks or issues',
  'Pipe and working environment is safe',
  'Motors, camera, vents, and lights all tested',
  'Connection secure and clear to deploy',
  'Weather and surge risk checked',
  'Enough battery to proceed',
]

interface PreflightProps {
  checks: string[]
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Shown before every run, styled like the driving walkthrough.
 *
 * Unlike the walkthrough this is never remembered: it is re-confirmed once per
 * run, because a checklist that can be dismissed forever is not a checklist.
 * The single acknowledgement below must be ticked before the run can start.
 */
export function Preflight({ checks, busy, error, onConfirm, onCancel }: PreflightProps) {
  const [accepted, setAccepted] = useState(false)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-1000/75 backdrop-blur-sm">
      <div className="panel w-[min(520px,92vw)] rounded-lg p-5">
        <div className="flex items-center gap-2 text-state-warning-signal">
          <ShieldIcon className="size-5" />
          <h2 className="display text-[15px] text-ink-100">Preflight check</h2>
        </div>
        <p className="mt-2 text-[12px] text-ink-400">
          Before we start, confirm the safety check.
        </p>

        <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-ink-200">
          {checks.map((check) => (
            <li key={check} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-500" />
              {check}
            </li>
          ))}
        </ul>

        <label className="mt-4 flex items-start gap-3 rounded-panel border border-state-warning-signal/40 bg-state-warning-signal/10 px-3 py-2.5 text-[13px] text-ink-100">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5 accent-state-warning-signal"
          />
          I have checked all of the above, and assume responsibility.
        </label>

        {error && <p className="mt-3 text-[12px] text-state-fault-signal">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy || !accepted}>
            {busy ? 'Starting…' : 'Start run'}
          </Button>
        </div>
      </div>
    </div>
  )
}
