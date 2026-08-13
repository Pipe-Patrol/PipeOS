import { useSyncExternalStore } from 'react'

/**
 * Every error in the console, in one place.
 *
 * The rule this exists to enforce: nothing that has gone wrong is ever drawn in
 * the middle of the screen. An operator driving is looking at pipe wall, and a
 * message over the pipe wall is both in the way and easy to miss once it has
 * been dismissed once. So faults go to one bar above the status bar and nowhere
 * else, and this is the channel that feeds it.
 *
 * Notices are keyed rather than queued. A source raises the same key each time
 * it fails, so a condition that keeps failing stays one line instead of
 * stacking, and clearing is idempotent — the caller does not have to know
 * whether it had raised anything.
 */

export type NoticeLevel = 'warning' | 'fault'

export interface NoticeAction {
  label: string
  run: () => void
}

export interface Notice {
  key: string
  level: NoticeLevel
  message: string
  /**
   * One button on the bar. For the notices that are also a prompt — an air
   * spike worth flagging, say — so the operator can act on it without hunting
   * for the panel that does the thing the bar just told them about.
   */
  action?: NoticeAction
}

const listeners = new Set<() => void>()

// Insertion-ordered, so two notices of the same level break the tie by which
// went wrong first — the earlier one is usually the cause of the later one.
const notices = new Map<string, Notice>()
let snapshot: Notice[] = []

function publish(): void {
  // A fresh array each change, and the same array between them:
  // useSyncExternalStore compares snapshots by identity.
  snapshot = [...notices.values()].sort(
    (a, b) => rank(b.level) - rank(a.level),
  )
  for (const listener of listeners) listener()
}

function rank(level: NoticeLevel): number {
  return level === 'fault' ? 1 : 0
}

export function raiseNotice(
  key: string,
  level: NoticeLevel,
  message: string,
  action?: NoticeAction,
): void {
  const existing = notices.get(key)
  // The action is compared by label alone. Its callback is a fresh closure on
  // every render, so comparing identity would republish on every frame.
  if (
    existing &&
    existing.level === level &&
    existing.message === message &&
    existing.action?.label === action?.label
  ) {
    // Still take the newer callback: the old one closes over stale state.
    if (action) existing.action = action
    return
  }
  notices.set(key, { key, level, message, action })
  publish()
}

export function clearNotice(key: string): void {
  if (!notices.delete(key)) return
  publish()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Notice[] {
  return snapshot
}

/** Everything currently wrong, worst first. */
export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The worst level in play, for the status bar to colour itself with. */
export function worstLevel(list: Notice[]): NoticeLevel | null {
  return list[0]?.level ?? null
}
