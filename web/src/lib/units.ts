import { useCallback, useSyncExternalStore } from 'react'

/**
 * Which temperature scale the console shows.
 *
 * The robot is metric end to end and stays that way: the DHT reports
 * millidegrees C, telemetry carries `temperature_c`, and every test is written
 * in Celsius. This is a display preference and nothing more — the conversion
 * happens in the formatter, at the last possible moment, so no Fahrenheit
 * number is ever stored, sent, or filed against a defect.
 *
 * It lives on the operator's device rather than the robot on purpose. Two crews
 * sharing a robot should not fight over the setting, and a console loaded on a
 * laptop that has never seen this robot before should still open in the scale
 * that laptop was left on.
 */

export type TempUnit = 'C' | 'F'

const KEY = 'pipepatrol.tempUnit'
const DEFAULT: TempUnit = 'C'

const listeners = new Set<() => void>()
// Read once and held here, because useSyncExternalStore compares snapshots by
// identity and a fresh localStorage read on every render would be a new answer
// to the same question. Also keeps the setting working in private browsing,
// where the write below throws: the tab still agrees with itself.
let current: TempUnit = read()

function read(): TempUnit {
  try {
    return window.localStorage.getItem(KEY) === 'F' ? 'F' : DEFAULT
  } catch {
    return DEFAULT
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTempUnit(): TempUnit {
  return current
}

export function setTempUnit(unit: TempUnit): void {
  if (unit === current) return
  current = unit
  try {
    window.localStorage.setItem(KEY, unit)
  } catch {
    // Private browsing. The choice holds for this tab and is forgotten on
    // reload, which is better than refusing to change at all.
  }
  for (const listener of listeners) listener()
}

// A second tab is a real case here — a supervisor watching the live screen on
// one and reading a run on another. Changing the scale in one must not leave
// the other quietly showing the old one.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    const next = read()
    if (next === current) return
    current = next
    for (const listener of listeners) listener()
  })
}

/** The current scale, and a setter. Re-renders every reader on a change. */
export function useTempUnit(): [TempUnit, (unit: TempUnit) => void] {
  const unit = useSyncExternalStore(subscribe, getTempUnit, () => DEFAULT)
  const set = useCallback((next: TempUnit) => setTempUnit(next), [])
  return [unit, set]
}
