import { useEffect } from 'react'

import { clearNotice, raiseNotice, type NoticeLevel } from '@/lib/notices'

/**
 * Every message the notice bar can show, on a key.
 *
 * Press **T then E** to step through them one at a time; past the end it
 * clears. The bar is the one place a fault is ever shown, which makes it the
 * one thing in the console that is hard to see on purpose — most of these need
 * a real broken robot to trigger. Being able to read all of them in ten seconds
 * is what keeps a truncated string or an unreadable colour from shipping.
 *
 * Same gate as the temptest simulator: the Vite dev server only, and dropped
 * from the production build entirely.
 */

const ENABLED = import.meta.env.DEV && window.location.port === '5173'

/** E within this window of a T counts as the gesture. */
const CHORD_MS = 800

const KEY = 'errortest'

interface SampleNotice {
  level: NoticeLevel
  message: string
}

/**
 * Written out rather than generated from the raisers, because the point is to
 * see the real strings — a message assembled at the call site out of a template
 * and a caught error is exactly the one that overflows the bar.
 */
const SAMPLES: SampleNotice[] = [
  { level: 'fault', message: 'Link lost — reconnecting. Motors are stopped.' },
  { level: 'warning', message: 'No telemetry. Motors are stopped.' },
  { level: 'warning', message: 'Obstruction ahead — 0.4 m' },
  { level: 'fault', message: 'Obstruction — contact in 1.2 s' },
  { level: 'warning', message: 'Drive stalled — motors commanded but not moving' },
  { level: 'warning', message: 'Air temperature rising fast — 31.4 °C' },
  { level: 'warning', message: 'Humidity rising fast — 94%' },
  { level: 'fault', message: 'CPU temperature critical — 84 °C' },
  { level: 'warning', message: 'Storage almost full — 380 MB left' },
  { level: 'fault', message: 'Camera stopped — no frames for 5 s' },
  { level: 'fault', message: 'Recording failed — disk write error' },
  { level: 'fault', message: 'could not start the run: a run is already open' },
  { level: 'fault', message: 'could not finish the run: robot did not answer' },
  {
    level: 'fault',
    message: 'Run finished, but it did not shut down: permission denied',
  },
  { level: 'warning', message: 'Battery low — returning home' },
  { level: 'fault', message: 'Battery critical — 9.9 V cutoff reached' },
]

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function useErrorTest(): void {
  useEffect(() => {
    if (!ENABLED) return

    let lastT = 0
    let index = 0

    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target)) return

      if (event.code === 'KeyT') {
        lastT = Date.now()
        return
      }
      if (event.code !== 'KeyE' || Date.now() - lastT > CHORD_MS) return
      lastT = 0

      if (index >= SAMPLES.length) {
        index = 0
        clearNotice(KEY)
        console.info('[errortest] end of the list — bar cleared')
        return
      }

      const sample = SAMPLES[index]
      console.info(`[errortest] ${index + 1}/${SAMPLES.length}`, sample.message)
      raiseNotice(KEY, sample.level, sample.message)
      index += 1
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearNotice(KEY)
    }
  }, [])
}
