import { useEffect, useRef, useState } from 'react'

/**
 * Gamepad support, over the Gamepad API's standard mapping.
 *
 * The browser deliberately hides gamepads until one of their buttons is
 * pressed — a page cannot enumerate controllers on load, because that is a
 * fingerprinting vector. So "pairing" here is not a handshake we perform; it is
 * a prompt telling the operator to press a button, after which the pad appears.
 * That is what `connected` is for.
 *
 * BRAND-NEUTRAL INDICES. Standard mapping puts the DualSense's cross where an
 * Xbox pad puts A, circle where B is, and so on down the list, so the constants
 * below are correct for both and nothing here needs to know which is plugged
 * in. The console labels them the PlayStation way because that is the pad in
 * the case; components/live/GamepadGuide.tsx is where that choice lives.
 *
 * An F310 must have its rear switch on X (XInput). In D mode it does not report
 * standard mapping and nothing lines up.
 */

/** Sticks rest a little off centre. Below this is treated as released. */
const DEADZONE = 0.15

// DualSense names. Standard mapping puts cross where an Xbox pad puts A, so
// these indices are correct for both and only the labels differ.
export const GAMEPAD_BUTTONS = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  CREATE: 8,
  OPTIONS: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const

export interface GamepadSnapshot {
  connected: boolean
  id: string | null
  /** -1..1, forward positive. Left stick and the triggers merged. */
  throttle: number
  /** Right stick, -1..1 each. Pans the zoomed image. */
  pan: { x: number; y: number }
  /** Buttons pressed since the previous poll — edges, not held state. */
  pressed: number[]
  /**
   * Buttons down right now.
   *
   * Separate from `pressed` because one control needs it: Return to home is
   * held rather than tapped, so that the button which sends the robot back up
   * the pipe cannot be the one somebody catches with a thumb.
   */
  held: number[]
}

const IDLE: GamepadSnapshot = {
  connected: false,
  id: null,
  throttle: 0,
  pan: { x: 0, y: 0 },
  pressed: [],
  held: [],
}

export function useGamepad(): GamepadSnapshot {
  const [snapshot, setSnapshot] = useState<GamepadSnapshot>(IDLE)
  const previousButtons = useRef<boolean[]>([])

  useEffect(() => {
    let frame = 0

    const poll = () => {
      frame = requestAnimationFrame(poll)
      const pad = firstConnectedPad()

      if (!pad) {
        previousButtons.current = []
        setSnapshot((current) => (current.connected ? IDLE : current))
        return
      }

      const pressed: number[] = []
      const held: number[] = []
      pad.buttons.forEach((button, index) => {
        if (!button.pressed) return
        held.push(index)
        if (!previousButtons.current[index]) pressed.push(index)
      })
      previousButtons.current = pad.buttons.map((button) => button.pressed)

      const next: GamepadSnapshot = {
        connected: true,
        id: pad.id,
        throttle: readThrottle(pad),
        pan: readPan(pad),
        pressed,
        held,
      }

      // Returning the same object when nothing changed keeps a resting
      // controller from re-rendering the whole driving screen sixty times a
      // second, which an iPad notices.
      setSnapshot((current) => (unchanged(current, next) ? current : next))
    }

    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [])

  return snapshot
}

function unchanged(a: GamepadSnapshot, b: GamepadSnapshot): boolean {
  return (
    a.connected === b.connected &&
    a.id === b.id &&
    a.throttle === b.throttle &&
    a.pan.x === b.pan.x &&
    a.pan.y === b.pan.y &&
    a.pressed.length === 0 &&
    b.pressed.length === 0 &&
    sameButtons(a.held, b.held)
  )
}

function sameButtons(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function firstConnectedPad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? []
  for (const pad of pads) {
    if (pad?.connected) return pad
  }
  return null
}

/**
 * Two ways to ask for throttle, both proportional.
 *
 * The left stick is the one you steer with; the triggers are the one you drive
 * with, L2 forward and R2 back. Whichever is pushed further wins, so resting a
 * thumb on a centred stick never fights a trigger being squeezed.
 *
 * The d-pad no longer drives — up and down are zoom now.
 */
function readThrottle(pad: Gamepad): number {
  // Analog on a DualSense: `value` is 0..1 travel, not just pressed/not.
  const forward = pad.buttons[GAMEPAD_BUTTONS.L2]?.value ?? 0
  const back = pad.buttons[GAMEPAD_BUTTONS.R2]?.value ?? 0
  const trigger = curve(forward) - curve(back)

  // Axis 1 is the left stick's vertical, and it reports UP as negative.
  const stick = curve(-(pad.axes[1] ?? 0))

  return Math.abs(trigger) >= Math.abs(stick) ? trigger : stick
}

/** Right stick. Axes 2 and 3 in standard mapping. */
function readPan(pad: Gamepad): { x: number; y: number } {
  return {
    x: curve(pad.axes[2] ?? 0),
    y: curve(pad.axes[3] ?? 0),
  }
}

/**
 * Deadzone, rescaled.
 *
 * Sticks and worn triggers rest a little off centre. Rescaling rather than
 * simply cutting means the command starts at zero at the edge of the deadzone
 * instead of jumping to 0.15 the instant something is nudged.
 */
function curve(raw: number): number {
  if (Math.abs(raw) < DEADZONE) return 0
  const scaled = (Math.abs(raw) - DEADZONE) / (1 - DEADZONE)
  return Math.sign(raw) * Math.min(1, scaled)
}
