import { useSyncExternalStore } from 'react'

/**
 * Demo day: the robot, running against footage instead of a sewer.
 *
 * On demo day the robot sits on a table in a room with no pipe in it, so the
 * camera sees a ceiling and the model finds nothing. That makes every
 * interesting thing about this console — the detections, the boxes, the
 * flagging — impossible to show, on the one day it has to be shown.
 *
 * So the feed is swapped for footage the operator supplies, and everything
 * downstream carries on as normal: the model runs against those frames, the
 * boxes land on them, and a judge can be handed the keyboard.
 *
 * IT IS NOT A FAKE. Nothing here invents a detection. The frames genuinely go
 * to the model on the robot and what comes back is what it found. The only
 * thing being substituted is where the pictures come from.
 *
 * NOT PERSISTED. Media lives in this tab as object URLs and is gone on reload,
 * which is correct — a console that came back up in demo mode after a reload,
 * on a real job, would be showing an operator somebody else's pipe.
 */

export type DemoKind = 'image' | 'video'

export interface DemoSource {
  id: string
  name: string
  kind: DemoKind
  /** An object URL. Revoked when the source is removed. */
  url: string
}

interface DemoState {
  enabled: boolean
  sources: DemoSource[]
  /** Which source is on the feed. Null when there are none. */
  activeId: string | null
  /**
   * How much video plays per metre the robot drives. The whole point of the
   * video engine — see DemoFeed — is that the footage advances because the
   * robot moved, not because time passed.
   */
  secondsPerMetre: number
}

const INITIAL: DemoState = {
  enabled: false,
  sources: [],
  activeId: null,
  secondsPerMetre: 2,
}

const listeners = new Set<() => void>()
let state: DemoState = INITIAL

function commit(next: DemoState): void {
  state = next
  for (const listener of listeners) listener()
}

export function setDemoMode(enabled: boolean): void {
  if (state.enabled === enabled) return
  commit({ ...state, enabled })
}

export function toggleDemoMode(): void {
  setDemoMode(!state.enabled)
}

export function addDemoSources(files: FileList | File[]): void {
  const added: DemoSource[] = []
  for (const file of Array.from(files)) {
    const kind: DemoKind = file.type.startsWith('video') ? 'video' : 'image'
    added.push({
      id: `${Date.now().toString(36)}-${added.length}`,
      name: file.name,
      kind,
      url: URL.createObjectURL(file),
    })
  }
  if (added.length === 0) return
  commit({
    ...state,
    sources: [...state.sources, ...added],
    activeId: state.activeId ?? added[0].id,
  })
}

export function removeDemoSource(id: string): void {
  const source = state.sources.find((entry) => entry.id === id)
  if (!source) return
  URL.revokeObjectURL(source.url)
  const sources = state.sources.filter((entry) => entry.id !== id)
  commit({
    ...state,
    sources,
    activeId: state.activeId === id ? (sources[0]?.id ?? null) : state.activeId,
  })
}

export function selectDemoSource(id: string): void {
  if (state.activeId === id) return
  commit({ ...state, activeId: id })
}

/** Next and previous, so a judge can flick through without aiming at a list. */
export function stepDemoSource(delta: number): void {
  if (state.sources.length === 0) return
  const index = state.sources.findIndex((entry) => entry.id === state.activeId)
  const next = (index + delta + state.sources.length) % state.sources.length
  selectDemoSource(state.sources[next].id)
}

export function setSecondsPerMetre(value: number): void {
  if (state.secondsPerMetre === value) return
  commit({ ...state, secondsPerMetre: value })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): DemoState {
  return state
}

export function useDemoMode(): DemoState {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL)
}

export function activeDemoSource(): DemoSource | null {
  return state.sources.find((entry) => entry.id === state.activeId) ?? null
}
