import { useEffect } from 'react'

import { stepDemoSource, toggleDemoMode } from '@/lib/demoMode'

/**
 * D twice to enter or leave demo mode; the arrow keys to switch footage.
 *
 * A chord rather than a single key, for the same reason the simulator uses T
 * twice: D on its own already opens the defect panel, and demo mode must not be
 * one mistyped letter away on a real job.
 *
 * The arrows only bind while demo mode is on. They belong to the map and the
 * robot the rest of the time.
 */

const DOUBLE_TAP_MS = 500

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function useDemoShortcuts(enabled: boolean): void {
  useEffect(() => {
    let lastD = 0

    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return

      if (event.code === 'KeyD') {
        const now = Date.now()
        if (now - lastD < DOUBLE_TAP_MS) {
          lastD = 0
          toggleDemoMode()
        } else {
          lastD = now
        }
        return
      }

      if (!enabled) return
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        stepDemoSource(1)
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault()
        stepDemoSource(-1)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
