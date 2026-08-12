import { useEffect } from 'react'

import type { RobotClient } from '@/robot/client'

/**
 * D twice opens the demo day panel, in a second window, on the robot.
 *
 * This file is the entire footprint of demo day inside the console. There is no
 * demo mode here: nothing is switched, nothing is drawn differently, and no
 * component below this one knows the feature exists. The panel takes over the
 * robot's camera from its own window (see demoday/README.md), so the console
 * carries on showing the live feed and measuring off it, unaware that the
 * pictures are coming from a file.
 *
 * That is deliberate and is the whole design: a judge is handed a console with
 * no demo mode in it, because there is no demo mode in it.
 *
 * If demoday/ has been deleted from the robot, /demo-panel is a 404 and the
 * gesture opens a window saying so. Nothing else changes.
 *
 * A chord rather than a single key, for the same reason the simulator uses T
 * twice: D on its own opens the defect panel, and this must not be one mistyped
 * letter away on a real job.
 */

const DOUBLE_TAP_MS = 500

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function useDemoDay(client: RobotClient | null): void {
  useEffect(() => {
    if (!client) return
    let lastD = 0
    let panel: Window | null = null

    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return
      if (event.code !== 'KeyD') return

      const now = Date.now()
      if (now - lastD >= DOUBLE_TAP_MS) {
        lastD = now
        return
      }
      lastD = 0

      // Focused rather than reopened if it is already up: a second window on
      // top of the first would be two pumps fighting over the camera.
      if (panel && !panel.closed) {
        panel.focus()
        return
      }
      panel = window.open(
        `${client.httpBase}/demo-panel`,
        'pipeos-demoday',
        'width=1100,height=720',
      )
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client])
}
