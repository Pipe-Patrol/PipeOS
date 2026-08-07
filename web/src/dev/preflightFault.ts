/**
 * Fake preflight failures, for testing the gate without breaking a robot.
 *
 * Press **T then P** while the run setup panel is open to arm it, and again to
 * clear it. There is no button for this on purpose: it must not be reachable by
 * an operator, and `import.meta.env.DEV` drops the whole thing from the build
 * that ships to the Pi.
 *
 * What it fakes is deliberately mixed — two blocking failures and three
 * warnings — because the interesting case is not "everything is red", it is
 * whether the panel still lets a run start past warnings while holding it shut
 * on the rows that matter.
 */

import { useEffect, useSyncExternalStore } from 'react'

import { READING, type Check } from '@/components/live/runsetup/checks'

const ENABLED = import.meta.env.DEV

/** The rows the simulation overrides, and what it turns them into. */
const FAULTS: Record<string, Pick<Check, 'status' | 'value'>> = {
  camera: { status: 'fail', value: READING.fault },
  battery: { status: 'fail', value: '18%' },
  lights: { status: 'warn', value: READING.notDetected },
  imu: { status: 'warn', value: READING.degraded },
  storage: { status: 'warn', value: '1.2 GB free' },
}

/** Two presses within this window count as the gesture. */
const SEQUENCE_MS = 700

const listeners = new Set<() => void>()
let armed = false

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function faultsArmed(): boolean {
  return armed
}

function toggleFaults(): void {
  armed = !armed
  console.info(`[preflight] simulated faults ${armed ? 'armed' : 'cleared'}`)
  for (const listener of listeners) listener()
}

/** Overlay the fake failures on a real check list. Identity when disarmed. */
export function applyFaults(checks: Check[], active: boolean): Check[] {
  if (!active) return checks
  return checks.map((check) => {
    const fault = FAULTS[check.id]
    return fault ? { ...check, ...fault } : check
  })
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/**
 * Listens for T then P and reports whether the simulation is armed.
 *
 * Always returns false in a production build and binds nothing, so the caller
 * can use it unconditionally.
 */
export function useSimulatedFaults(): boolean {
  const active = useSyncExternalStore(subscribe, faultsArmed, () => false)

  useEffect(() => {
    if (!ENABLED) return
    let lastT = 0

    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return

      if (event.code === 'KeyT') {
        lastT = Date.now()
        return
      }
      if (event.code === 'KeyP' && lastT > 0 && Date.now() - lastT < SEQUENCE_MS) {
        lastT = 0
        toggleFaults()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return ENABLED && active
}
