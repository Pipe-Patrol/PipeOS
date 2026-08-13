import { useEffect, useState } from 'react'

/** Frame supplied by the demo day panel in test mode, or null. Dev only. */
export function useTempTestFrame(): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onFrame = (event: Event) => setUrl((event as CustomEvent<string>).detail)
    window.addEventListener('temptest-frame', onFrame)
    return () => window.removeEventListener('temptest-frame', onFrame)
  }, [])

  return url
}
