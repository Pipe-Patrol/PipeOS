import { useState } from 'react'

import { Button } from '@/components/primitives/Button'
import { GamepadIcon } from '@/components/primitives/icons'

// Bumped from `walkthroughSeen` so anyone silently opted out by the old
// default-checked box sees the walkthrough again. It now shows every run until
// the operator chooses to dismiss it.
const SEEN_KEY = 'pipepatrol.walkthroughDismissed'

interface WalkthroughProps {
  gamepadConnected: boolean
  gamepadId: string | null
  onClose: () => void
}

export function hasSeenWalkthrough(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Private browsing. It will show again next run, which is harmless.
  }
}

/**
 * Shown when a run starts — every run, until the operator opts out.
 *
 * It exists because two of the controls are invisible: there is no on-screen
 * d-pad, and the gamepad cannot appear until a button is pressed. Neither is
 * discoverable by looking at the screen, so the screen has to say so.
 *
 * The controller step is live — it watches for the pad and confirms when it
 * arrives, which is the only "pairing" a browser can offer.
 */
export function Walkthrough({
  gamepadConnected,
  gamepadId,
  onClose,
}: WalkthroughProps) {
  // Unchecked by default: the walkthrough shows on every run unless the
  // operator actively opts out.
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const dismiss = () => {
    if (dontShowAgain) markSeen()
    onClose()
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-1000/75 backdrop-blur-sm">
      <div className="panel w-[min(520px,92vw)] rounded-lg p-5">
        <h2 className="display text-[15px]">Driving this thing</h2>

        <ol className="mt-4 flex flex-col gap-4">
          <Step index={1} title="Keyboard">
            <Keys keys={['W', '↑']} /> forward · <Keys keys={['S', '↓']} /> back
          </Step>

          <Step index={2} title="Controller">
            <span className="flex flex-wrap items-center gap-2">
              <GamepadIcon className="size-4 text-ink-400" />
              {gamepadConnected ? (
                <span className="text-state-recording-signal">
                  Connected{gamepadId ? ` — ${shortName(gamepadId)}` : ''}
                </span>
              ) : (
                <span>Press any button on the pad</span>
              )}
            </span>
          </Step>

          <Step index={3} title="Capture">
            <Keys keys={['C']} /> snapshot · <Keys keys={['D']} /> defect ·{' '}
            <Keys keys={['R']} /> record · <Keys keys={['?']} /> all shortcuts
          </Step>
        </ol>

        <div className="mt-5 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-[12px] text-ink-400">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
              className="accent-white"
            />
            Don&rsquo;t show this again
          </label>
          <Button onClick={dismiss}>Start driving</Button>
        </div>
      </div>
    </div>
  )
}

function Step({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-800 text-[11px] text-ink-400">
        {index}
      </span>
      <div className="min-w-0 text-[12px] leading-relaxed text-ink-400">
        <h3 className="label mb-1">{title}</h3>
        {children}
      </div>
    </li>
  )
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

/** Browsers report gamepads as `Logitech ... (Vendor: 046d Product: c216)`. */
function shortName(id: string): string {
  return id.replace(/\s*\(.*\)\s*$/, '').trim() || id
}
