import { useSyncExternalStore } from 'react'

/**
 * Everything the operator can change about their own console.
 *
 * ONE STORE, NOT ONE PER SETTING. The temperature unit got its own module, and
 * the moment there were a dozen preferences that pattern would have been a
 * dozen near-identical files with a dozen chances to spell a localStorage key
 * differently. This is the same external-store shape, once, with the settings
 * as data.
 *
 * ON THE DEVICE, NOT THE ROBOT. Two crews sharing a robot must not be able to
 * change each other's screen, and a console opened on a laptop that has never
 * seen this robot should still come up the way that laptop was left. Nothing
 * here is ever sent to the Pi, and nothing here changes what is recorded — a
 * hidden panel is a hidden panel, not a sensor that stopped being read.
 */

export interface Preferences {
  // ---- What is on the driving screen ----
  showMap: boolean
  showProfile: boolean
  showTelemetry: boolean
  showZoom: boolean
  showDirection: boolean
  showBudget: boolean

  // ---- The model ----
  /** Detections below this are not drawn at all. 0..1. */
  detectionThreshold: number
  showDetections: boolean
  showDetectionLabels: boolean
  showDetectionConfidence: boolean
  /** Classes the operator has switched off, by model label. */
  mutedClasses: string[]

  // ---- Auto flagging ----
  /** Auto mode will not file anything it is less sure of than this. 0..1. */
  autoFlagThreshold: number
  /** The same class is not filed twice inside this many metres. */
  autoFlagCooldownM: number
  autoFlagOnSpikes: boolean

  // ---- Visual odometry ----
  /** Draw the features the distance estimate is actually tracking. */
  showFlowPoints: boolean

  // ---- Air spikes ----
  spikeTemperatureC: number
  spikeHumidityPct: number
  spikeWarnings: boolean

  // ---- Recording ----
  /** Persistent boxes reappear this far either side of where they were filed. */
  markerRangeM: number
  showMarkers: boolean
}

export const DEFAULTS: Preferences = {
  showMap: true,
  showProfile: true,
  showTelemetry: true,
  showZoom: true,
  showDirection: true,
  showBudget: true,

  detectionThreshold: 0.35,
  showDetections: true,
  showDetectionLabels: true,
  showDetectionConfidence: true,
  mutedClasses: [],

  autoFlagThreshold: 0.55,
  autoFlagCooldownM: 1.5,
  autoFlagOnSpikes: true,

  showFlowPoints: false,

  spikeTemperatureC: 2.5,
  spikeHumidityPct: 8,
  spikeWarnings: true,

  markerRangeM: 1.2,
  showMarkers: true,
}

const KEY = 'pipepatrol.preferences'

const listeners = new Set<() => void>()
let current: Preferences = read()

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULTS
    // Merged over the defaults rather than used as-is, so a console updated
    // with new settings in it does not come up with them undefined.
    return { ...DEFAULTS, ...(parsed as Partial<Preferences>) }
  } catch {
    return DEFAULTS
  }
}

function commit(next: Preferences): void {
  current = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private browsing. The change holds for this tab, which beats refusing it.
  }
  for (const listener of listeners) listener()
}

export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  if (current[key] === value) return
  commit({ ...current, [key]: value })
}

/** Put everything back to how it ships. */
export function resetPreferences(): void {
  commit({ ...DEFAULTS })
}

export function toggleMutedClass(name: string): void {
  const muted = current.mutedClasses.includes(name)
    ? current.mutedClasses.filter((entry) => entry !== name)
    : [...current.mutedClasses, name]
  commit({ ...current, mutedClasses: muted })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Preferences {
  return current
}

export function getPreferences(): Preferences {
  return current
}

/** Re-renders the caller whenever any preference changes. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS)
}

// A supervisor on one tab and an operator on another is a real case here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    current = read()
    for (const listener of listeners) listener()
  })
}
