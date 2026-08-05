import { useState } from 'react'

import { Button } from '@/components/primitives/Button'
import { ShieldIcon } from '@/components/primitives/icons'
import { readError } from '@/lib/errors'
import type { RobotClient } from '@/robot/client'

interface ShutdownDialogProps {
  client: RobotClient
  /** True while a run is open, so the dialog can say what it is about to close. */
  runActive: boolean
  onCancel: () => void
  /** Browser-side only: leave the robot running and go back to the picker. */
  onDisconnect: () => void
  /** The Pi accepted the halt and is going down. */
  onHalted: () => void
}

/**
 * The gate in front of powering the robot off.
 *
 * Worth being blunt about why this button exists at all: the alternative an
 * operator reaches for is the power switch, and cutting power with dirty pages
 * still in the kernel is what corrupts the SD card. So this is not a
 * convenience — it is the safe version of a thing that was going to happen
 * anyway.
 */
export function ShutdownDialog({
  client,
  runActive,
  onCancel,
  onDisconnect,
  onHalted,
}: ShutdownDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await client.request('/api/shutdown', { method: 'POST' })
      onHalted()
    } catch (caught) {
      setError(readError(caught))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-1000/75 p-4 backdrop-blur-sm">
      <div className="panel w-[min(480px,92vw)] rounded-lg p-5">
        <div className="flex items-center gap-2 text-state-fault-signal">
          <ShieldIcon className="size-5" />
          <h2 className="display text-[15px] text-ink-100">Shut down the robot</h2>
        </div>

        <p className="mt-2 text-[13px] text-ink-200">
          This powers the Pi off. It does not just disconnect this console.
        </p>

        <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-ink-300">
          {[
            'Stops the motors',
            runActive
              ? 'Ends the run in progress and saves it properly'
              : 'Flushes anything still unwritten',
            'Writes everything to the SD card',
            'Powers the Pi off',
          ].map((step) => (
            <li key={step} className="flex gap-2.5">
              <span
                aria-hidden
                className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-500"
              />
              {step}
            </li>
          ))}
        </ul>

        <p className="mt-4 rounded-panel border border-ink-800 bg-white/5 px-3 py-2.5 text-[12px] text-ink-400">
          Wait for the green LED on the Pi to stop blinking before you flip the switch.
          That is the card finishing its last write.
        </p>

        {error && (
          <p className="mt-3 text-[12px] text-state-fault-signal">
            Did not shut down: {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="quiet" onClick={onDisconnect} disabled={busy}>
            Just disconnect
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Shutting down…' : 'Shut down'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * What replaces the console once the Pi has accepted the halt.
 *
 * A full screen rather than a toast, because the instruction on it is the whole
 * point of the feature and an operator walking back to the van must not have to
 * go looking for it.
 */
export function PoweredOff() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel w-[min(420px,92vw)] rounded-lg p-6 text-center">
        <h1 className="display text-[16px] text-ink-100">Powering off</h1>
        <p className="mt-3 text-[13px] text-ink-300">
          The run is closed and everything is written to the card.
        </p>
        <p className="mt-3 text-[13px] text-ink-300">
          Wait for the green LED on the Pi to stop blinking, then it is safe to flip the
          switch.
        </p>
        <p className="mt-4 text-[12px] text-ink-500">
          Reload this page after the robot is powered up again.
        </p>
      </div>
    </div>
  )
}
