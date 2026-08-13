import { useEffect, useRef, useState } from 'react'

/**
 * Gamepad support, built around the Logitech F310 in XInput mode.
 *
 * The browser deliberately hides gamepads until one of their buttons is
 * pressed — a page cannot enumerate controllers on load, because that is a
 * fingerprinting vector. So "pairing" here is not a handshake we perform; it is
 * a prompt telling the operator to press a button, after which the pad appears.
 * That is what `connected` is for.
 *
 * Set the F310's rear switch to X (XInput). In D mode the axis and button
 * indices below are different and nothing will map correctly.
 */

/** Sticks rest a little off centre. Below this is treated as released. */
const DEADZONE = 0.15

export const GAMEPAD_BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  BACK: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const

// The triggers (6, 7) are deliberately unmapped. They are the two controls an
// operator brushes without meaning to while holding the pad, and everything
// worth reaching for fits on the faces and shoulders without them.

export interface GamepadSnapshot {
  connected: boolean
  id: string | null
  /** -1..1, forward positive. Stick and d-pad merged. */
  throttle: number
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

function readThrottle(pad: Gamepad): number {
  // The d-pad wins when held: it is an unambiguous full-speed request, where a
  // stick is a proportional one.
  if (pad.buttons[GAMEPAD_BUTTONS.DPAD_UP]?.pressed) return 1
  if (pad.buttons[GAMEPAD_BUTTONS.DPAD_DOWN]?.pressed) return -1

  // Axis 1 is the left stick's vertical, and it reports UP as negative.
  const raw = -(pad.axes[1] ?? 0)
  if (Math.abs(raw) < DEADZONE) return 0

  // Rescale so the command starts at zero at the edge of the deadzone rather
  // than jumping to 0.15 the instant the stick is nudged.
  const scaled = (Math.abs(raw) - DEADZONE) / (1 - DEADZONE)
  return Math.sign(raw) * Math.min(1, scaled)
}
