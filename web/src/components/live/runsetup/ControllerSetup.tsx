import { useState } from 'react'
import { CheckCircle, Circle } from '@phosphor-icons/react'

import { SettingRow } from '@/components/live/runsetup/SettingRow'
import { Button } from '@/components/primitives/Button'
import { phosphorWeight } from '@/components/primitives/iconStroke'
import { GAMEPAD_BUTTONS, useGamepad, type GamepadSnapshot } from '@/input/useGamepad'

const ICON_SIZE = 15

interface Step {
  id: string
  instruction: string
  /** True the moment the operator has done this one. */
  done: (pad: GamepadSnapshot) => boolean
}

/**
 * In order, and each one unlocks the next. A pad that reports a stick but has
 * its rear switch in D mode passes step one and fails step two, which is the
 * failure this exists to catch — and the only way to catch it is to ask the
 * operator to actually move the thing.
 */
const STEPS: Step[] = [
  {
    id: 'connect',
    instruction: 'Plug the controller in over USB and press any button on it',
    done: (pad) => pad.connected,
  },
  {
    id: 'forward',
    instruction: 'Push the left stick forward, or press up on the D-pad',
    done: (pad) => pad.throttle >= 0.5,
  },
  {
    id: 'reverse',
    instruction: 'Pull the same stick back towards you',
    done: (pad) => pad.throttle <= -0.5,
  },
  {
    id: 'capture',
    instruction: 'Press the A button',
    done: (pad) => pad.pressed.includes(GAMEPAD_BUTTONS.A),
  },
]

/**
 * Pairing a controller, by making the operator use it.
 *
 * A browser cannot enumerate gamepads until one of their buttons is pressed, so
 * there is no handshake to perform and nothing to click that would produce one.
 * What this does instead is walk the operator through four movements and
 * confirm each as it arrives, which tests the thing that actually goes wrong:
 * an F310 left in D mode reports as connected and then maps every axis
 * somewhere else. "Connected" would have told them nothing. "Push forward" and
 * a tick tells them the pad they are holding drives this robot.
 *
 * Nothing here commands the motors. Driving is locked while the panel is open,
 * so every movement below is read and discarded.
 */
export function ControllerSetup() {
  const pad = useGamepad()
  const [open, setOpen] = useState(false)
  const [reached, setReached] = useState(0)
  const [seen, setSeen] = useState(pad)

  // Adjusted during render rather than in an effect, which is the supported
  // pattern for state derived from something that changes underneath you: the
  // list is correct on the render that shows it, with no flash of the previous
  // step. useGamepad returns a stable object while nothing moves, so this runs
  // only when the pad actually did something.
  if (pad !== seen) {
    setSeen(pad)
    if (!pad.connected && reached > 0) {
      // A pad pulled out mid-setup invalidates everything after it.
      setReached(0)
    } else if (reached < STEPS.length && STEPS[reached].done(pad)) {
      // Forwards only. A stick returning to centre is not the operator
      // undoing anything.
      setReached(reached + 1)
    }
  }

  const complete = reached >= STEPS.length

  if (!open) {
    return (
      <SettingRow
        label="Controller"
        hint={
          complete
            ? `Ready${pad.id ? `, ${shortName(pad.id)}` : ''}`
            : pad.connected
              ? shortName(pad.id ?? 'Connected')
              : 'Not connected'
        }
      >
        <Button
          type="button"
          variant="quiet"
          onClick={() => setOpen(true)}
          className="h-8 px-2 text-[12px]"
        >
          {complete ? 'Test again' : 'Set up'}
        </Button>
      </SettingRow>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <SettingRow label="Controller setup">
        <Button
          type="button"
          variant="quiet"
          onClick={() => setOpen(false)}
          className="h-8 px-2 text-[12px]"
        >
          {complete ? 'Done' : 'Skip'}
        </Button>
      </SettingRow>

      <ol className="flex flex-col gap-1.5">
        {STEPS.map((step, index) => {
          const passed = index < reached
          const current = index === reached
          return (
            <li key={step.id} className="flex items-center gap-2.5">
              <span
                className={`shrink-0 ${passed ? 'text-state-recording-signal' : 'text-ink-600'}`}
                aria-hidden
              >
                {passed ? (
                  <CheckCircle size={ICON_SIZE} weight={phosphorWeight(ICON_SIZE)} />
                ) : (
                  <Circle
                    size={ICON_SIZE}
                    weight={phosphorWeight(ICON_SIZE)}
                    className={current ? 'animate-dot-pulse' : undefined}
                  />
                )}
              </span>
              <span
                className={`text-[12px] ${
                  current ? 'text-ink-100' : passed ? 'text-ink-400' : 'text-ink-600'
                }`}
              >
                {step.instruction}
              </span>
              <span className="sr-only">{passed ? 'done' : current ? 'waiting' : ''}</span>
            </li>
          )
        })}
      </ol>

      <p className="text-[11.5px] text-ink-400" role="status">
        {complete
          ? `Your ${pad.id ? shortName(pad.id) : 'controller'} is ready to drive with.`
          : pad.connected
            ? 'None of this moves the robot. The motors stay locked until the run has started.'
            : 'No controller has been detected yet.'}
      </p>

      {/* Always on show, not only once something has failed: the switch has to
          be in the right position BEFORE the pad is touched, and an operator
          who reads this after step two has already had to start over. */}
    </div>
  )
}

/** Browsers report gamepads as `Logitech ... (Vendor: 046d Product: c216)`. */
function shortName(id: string): string {
  return id.replace(/\s*\(.*\)\s*$/, '').trim() || id
}
