import { useSyncExternalStore } from 'react'

import {
  DETECTION_CLASSES,
  UNKNOWN_CLASS_COLOR,
  detectionClassOf,
} from '@/constants/detection-classes'

/**
 * Per-class box colours, overridable by the operator.
 *
 * On the device rather than the robot, for the same reason the temperature unit
 * is: two crews sharing a robot should not be able to change each other's
 * screen, and a colour is a property of the person reading it. The defaults in
 * constants/detection-classes are what everyone gets until they say otherwise;
 * this only ever stores the differences.
 */

const KEY = 'pipepatrol.detectionColors'

const listeners = new Set<() => void>()
let overrides: Record<string, string> = read()

function read(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    // Only keep entries that name a class we still have and look like a hex
    // colour, so a stale or hand-edited value cannot put an invalid colour into
    // a style attribute.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([name, value]) =>
          typeof value === 'string' &&
          /^#[0-9a-f]{6}$/i.test(value) &&
          DETECTION_CLASSES.some((type) => type.name === name),
      ),
    ) as Record<string, string>
  } catch {
    return {}
  }
}

function write(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(overrides))
  } catch {
    // Private browsing. The choice holds for this tab, which beats refusing it.
  }
  for (const listener of listeners) listener()
}

/** Override one class. Passing null puts it back to the shipped colour. */
export function setDetectionColor(name: string, color: string | null): void {
  if (color === null) {
    if (!(name in overrides)) return
    const { [name]: _removed, ...rest } = overrides
    overrides = rest
  } else {
    if (overrides[name] === color) return
    overrides = { ...overrides, [name]: color }
  }
  write()
}

export function resetDetectionColors(): void {
  if (Object.keys(overrides).length === 0) return
  overrides = {}
  write()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getOverrides(): Record<string, string> {
  return overrides
}

/**
 * The colour a detection with this label is drawn in.
 *
 * Not a hook: the box components need it inside a map, and the overlay redraws
 * on every telemetry frame anyway.
 */
export function detectionColor(label: string): string {
  const type = detectionClassOf(label)
  if (!type) return UNKNOWN_CLASS_COLOR
  return overrides[type.name] ?? type.color
}

/** Re-renders the caller when any colour changes. */
export function useDetectionColors(): Record<string, string> {
  return useSyncExternalStore(subscribe, getOverrides, getOverrides)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    overrides = read()
    for (const listener of listeners) listener()
  })
}
