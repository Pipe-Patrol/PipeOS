import { useLayoutEffect, type RefObject } from 'react'

/**
 * How tall the camera feed is, published as a CSS variable.
 *
 * The rule this enforces: no panel is ever taller than the video. A panel that
 * overruns the feed is covering the status bar or the longitudinal strip — the
 * two things that stay on screen precisely because they must never be covered —
 * and it does it only at small window sizes, which is where nobody looks until
 * a demo. Capping every panel against a measurement of the feed makes that
 * impossible rather than merely unlikely.
 *
 * A CSS variable rather than a prop or a context because the panels are `fixed`
 * and hung off the sidebar; they are not children of the feed and cannot ask it
 * anything. The measurement goes on the document element, so any panel anywhere
 * can cap itself with `max-h-[var(--feed-h)]` and none of them need wiring.
 */

const VAR = '--feed-h'

/** Never cap a panel below this — a 40 px scroll box helps nobody. */
const FLOOR_PX = 160

export function useFeedBounds(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!el) return

    const observer = new ResizeObserver(([entry]) => {
      const height = Math.max(FLOOR_PX, Math.round(entry.contentRect.height))
      root.style.setProperty(VAR, `${height}px`)
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      // Leaving a stale height behind would cap panels on the runs screen
      // against a feed that is no longer on the page.
      root.style.removeProperty(VAR)
    }
  }, [ref])
}
