import { useEffect } from 'react'

/**
 * The whole footprint of temporary testing inside the app: a key listener.
 *
 * Everything it does lives in /temptest, loaded on demand. Delete that folder
 * and the import below fails; the shortcut becomes a silent no-op and nothing
 * else changes. This never ships to the Pi — it is gated to the Vite dev server
 * (import.meta.env.DEV and port 5173), and the production build drops it.
 *
 * `__TEMPTEST_URL__` is injected by web/vite.config.ts and points at the
 * dev-served simulator module.
 */
declare const __TEMPTEST_URL__: string

interface TempTestModule {
  activate: () => void
}

const ENABLED = import.meta.env.DEV && window.location.port === '5173'

/** Two T presses within this window count as the activation gesture. */
const DOUBLE_TAP_MS = 500

/** Don't hijack a T typed into a text field. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/**
 * Press **T twice in a row** to boot the in-browser simulated robot, then run
 * `onReady` (which connects the console and navigates to the live screen).
 */
export function useTempTest(onReady: () => void): void {
  useEffect(() => {
    if (!ENABLED) return

    let lastT = 0

    const onKey = async (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'KeyT') return
      if (isTyping(event.target)) return

      const now = Date.now()
      if (now - lastT >= DOUBLE_TAP_MS) {
        lastT = now
        return
      }
      lastT = 0

      console.info('[temptest] double-T — booting the simulated robot')
      try {
        const mod = (await import(/* @vite-ignore */ __TEMPTEST_URL__)) as TempTestModule
        mod.activate()
        onReady()
      } catch (error) {
        console.warn(
          '[temptest] not installed — the temptest/ folder is missing or was deleted',
          error,
        )
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onReady])
}
