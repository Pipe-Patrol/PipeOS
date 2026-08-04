import { useCallback, useEffect, useRef, useState } from 'react'

import type { RobotClient } from '@/robot/client'
import { GAMEPAD_BUTTONS, useGamepad } from '@/input/useGamepad'

/**
 * Everything that can move the robot, reduced to one throttle.
 *
 * Forward and back only — there is no steering control, because the chassis
 * turns by driving one track, and mixing a turn into a straight-line crawl is
 * how an operator ends up wedged sideways in a pipe.
 *
 * Three sources, in priority order:
 *
 *   gamepad    proportional, wins while it is off centre
 *   keyboard   full speed, wins while a key is held
 *   nothing    zero — which is still a command, and still gets sent
 *
 * The safety rules here mirror the ones in the server, on purpose. Losing
 * focus, hiding the tab, or dropping the link all zero the throttle locally
 * rather than waiting for the watchdog: the watchdog is the backstop, not the
 * mechanism.
 */

export type DriveDirection = 'forward' | 'reverse' | null
export type DriveSource = 'keyboard' | 'gamepad' | null

export interface DriveInput {
  throttle: number
  direction: DriveDirection
  source: DriveSource
  gamepadConnected: boolean
  gamepadId: string | null
}

const KEY_FORWARD = new Set(['KeyW', 'ArrowUp'])
const KEY_REVERSE = new Set(['KeyS', 'ArrowDown'])

export interface DriveInputOptions {
  client: RobotClient | null
  /** False while a modal owns the keyboard, or the link is down. */
  enabled: boolean
  onSnapshot?: () => void
}

export function useDriveInput({
  client,
  enabled,
  onSnapshot,
}: DriveInputOptions): DriveInput {
  const [keys, setKeys] = useState({ forward: false, reverse: false })
  const gamepad = useGamepad()

  const onSnapshotRef = useRef(onSnapshot)
  useEffect(() => {
    onSnapshotRef.current = onSnapshot
  })

  const release = useCallback(() => setKeys({ forward: false, reverse: false }), [])

  // --- keyboard ---

  useEffect(() => {
    if (!enabled) return

    const down = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (KEY_FORWARD.has(event.code)) {
        event.preventDefault()
        setKeys((current) => ({ ...current, forward: true }))
      } else if (KEY_REVERSE.has(event.code)) {
        event.preventDefault()
        setKeys((current) => ({ ...current, reverse: true }))
      }
    }

    const up = (event: KeyboardEvent) => {
      if (KEY_FORWARD.has(event.code)) setKeys((c) => ({ ...c, forward: false }))
      else if (KEY_REVERSE.has(event.code)) setKeys((c) => ({ ...c, reverse: false }))
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      // Clear on teardown, not on the disabled branch: a key held when the
      // link drops would otherwise still be held when it comes back, and the
      // robot would drive off the moment it reconnected.
      release()
    }
  }, [enabled, release])

  // A key held when the window loses focus would otherwise stay held forever.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) release()
    }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [release])

  // --- gamepad buttons ---

  useEffect(() => {
    if (!enabled || gamepad.pressed.length === 0) return
    if (gamepad.pressed.includes(GAMEPAD_BUTTONS.A)) onSnapshotRef.current?.()
  }, [enabled, gamepad.pressed])

  // --- resolve and send ---

  const keyboardThrottle = (keys.forward ? 1 : 0) - (keys.reverse ? 1 : 0)
  const gamepadThrottle = enabled ? gamepad.throttle : 0

  let throttle = 0
  let source: DriveSource = null
  if (gamepadThrottle !== 0) {
    throttle = gamepadThrottle
    source = 'gamepad'
  } else if (keyboardThrottle !== 0) {
    throttle = keyboardThrottle
    source = 'keyboard'
  }
  if (!enabled) throttle = 0

  useEffect(() => {
    // Both tracks get the same command. Straight line, by design.
    client?.setDrive(throttle, throttle)
  }, [client, throttle])

  // Leaving the screen must not leave a throttle set.
  useEffect(() => {
    return () => client?.setDrive(0, 0)
  }, [client])

  return {
    throttle,
    direction: throttle > 0 ? 'forward' : throttle < 0 ? 'reverse' : null,
    source,
    gamepadConnected: gamepad.connected,
    gamepadId: gamepad.id,
  }
}
