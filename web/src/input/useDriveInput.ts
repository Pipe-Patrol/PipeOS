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
 * Shift latches the current direction so a long crawl does not have to be held
 * down. It is a convenience over the key, not a second control path: a latched
 * throttle drops on every one of the releases below, exactly as a held key
 * does.
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
  /** True while Shift is holding the throttle open with no key down. */
  locked: boolean
  /**
   * True once a drive key has been held long enough to be worth a hint, and
   * only until the operator has actually used the latch. After that they know,
   * and the "Locked" chip is the whole of what needs saying.
   */
  lockHint: boolean
}

const KEY_FORWARD = new Set(['KeyW', 'ArrowUp'])
const KEY_REVERSE = new Set(['KeyS', 'ArrowDown'])
const KEY_LOCK = new Set(['ShiftLeft', 'ShiftRight'])

/**
 * How long a key must be held before the hint appears.
 *
 * Long enough that it never flashes during the taps and nudges that make up most
 * driving, short enough to arrive while the operator is still in the hold that
 * prompted it.
 */
const LOCK_HINT_DELAY_MS = 2500

/**
 * The hint teaches one thing, once.
 *
 * Shift-to-lock is a keystroke, not a warning: an operator who has used it
 * knows it, and showing it again every time they hold W for three seconds is
 * chrome over pipe wall for the rest of the robot's life. Once the latch has
 * actually been used the hint retires and only the "Locked" chip remains.
 *
 * Stored on the device rather than the run, because the thing being remembered
 * is whether this person has learned the control.
 */
const LOCK_LEARNED_KEY = 'pipepatrol.throttleLockLearned'

function lockLearned(): boolean {
  try {
    return window.localStorage.getItem(LOCK_LEARNED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberLockLearned(): void {
  try {
    window.localStorage.setItem(LOCK_LEARNED_KEY, '1')
  } catch {
    // Private browsing. The hint comes back next session, which is harmless.
  }
}

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
  const [locked, setLocked] = useState<DriveDirection>(null)
  const [hintArmed, setHintArmed] = useState(false)
  const [learned, setLearned] = useState(lockLearned)
  const gamepad = useGamepad()

  // What Shift would latch if it were pressed right now. Read inside the key
  // handler, so it has to be a ref rather than a closed-over value.
  const directionRef = useRef<DriveDirection>(null)

  const onSnapshotRef = useRef(onSnapshot)
  useEffect(() => {
    onSnapshotRef.current = onSnapshot
  })

  const release = useCallback(() => {
    setKeys({ forward: false, reverse: false })
    setLocked(null)
  }, [])

  // --- keyboard ---

  useEffect(() => {
    if (!enabled) return

    const down = (event: KeyboardEvent) => {
      if (KEY_LOCK.has(event.code)) {
        if (event.repeat) return
        // Latch what is moving now; press again to let go. Shift with nothing
        // moving does nothing — the lock can only ever extend a command the
        // operator has already given.
        setLocked((current) => {
          const next = current ? null : directionRef.current
          if (next) {
            rememberLockLearned()
            setLearned(true)
          }
          return next
        })
        return
      }

      if (event.code === 'Escape') {
        setLocked(null)
        return
      }

      if (event.repeat) return
      if (KEY_FORWARD.has(event.code)) {
        event.preventDefault()
        // Touching a drive key takes manual control back. The key is now held,
        // so this reads as "grab the throttle", not "stop".
        setLocked(null)
        setKeys((current) => ({ ...current, forward: true }))
      } else if (KEY_REVERSE.has(event.code)) {
        event.preventDefault()
        setLocked(null)
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

  // --- hint ---

  const holding = keys.forward || keys.reverse
  useEffect(() => {
    if (!enabled || locked || !holding) return
    const timer = window.setTimeout(() => setHintArmed(true), LOCK_HINT_DELAY_MS)
    // Disarmed on the way out so the next hold has to earn the delay again
    // rather than flashing the hint the instant a key goes down.
    return () => {
      window.clearTimeout(timer)
      setHintArmed(false)
    }
  }, [enabled, locked, holding])

  // --- resolve and send ---

  const lockedThrottle = locked === 'forward' ? 1 : locked === 'reverse' ? -1 : 0
  const heldThrottle = (keys.forward ? 1 : 0) - (keys.reverse ? 1 : 0)
  const keyboardThrottle = locked ? lockedThrottle : heldThrottle
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

  const direction: DriveDirection =
    throttle > 0 ? 'forward' : throttle < 0 ? 'reverse' : null

  useEffect(() => {
    directionRef.current = direction
  })

  return {
    throttle,
    direction,
    source,
    gamepadConnected: gamepad.connected,
    gamepadId: gamepad.id,
    locked: locked !== null,
    // Derived rather than stored, so there is no state that can survive the
    // key being let go and leave a hint hanging over the video.
    lockHint: hintArmed && holding && !locked && !learned,
  }
}
