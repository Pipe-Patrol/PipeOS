import { useEffect, useRef, useState } from 'react'

/**
 * Returns true briefly whenever `value` changes.
 *
 * Drives the readout's flash to full white. The question it answers is one an
 * operator actually asks in a dark van: is this number live, or has the feed
 * frozen with the last value still on screen? A frozen MJPEG frame and a live
 * one look identical; a readout that stopped flashing does not.
 */
export function useFlashOnChange(value: unknown, durationMs = 420): boolean {
  const [flashing, setFlashing] = useState(false)
  const previous = useRef(value)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setFlashing(true)
    const timer = setTimeout(() => setFlashing(false), durationMs)
    return () => clearTimeout(timer)
  }, [value, durationMs])

  return flashing
}
