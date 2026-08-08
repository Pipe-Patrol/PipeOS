import { useEffect, useRef, useState } from 'react'

import type { RobotClient } from '@/robot/client'
import type { DemoSource } from '@/lib/demoMode'
import type { Detection } from '@/robot/types'

/**
 * Detections for the footage on screen, from the model on the robot.
 *
 * The live path samples the camera on the Pi and pushes results down with the
 * telemetry. Demo footage never reaches the Pi, so the loop runs the other way
 * round: grab what is on screen into a canvas, post the JPEG to /api/detect,
 * and draw what comes back.
 *
 * NOTHING IS INVENTED HERE. The frame genuinely goes to the model and the boxes
 * are its own output. If no model is installed the endpoint says so and this
 * returns nothing rather than filling in something plausible — a demo that drew
 * fake boxes would be a demo of nothing.
 *
 * One request in flight at a time, and the next only after the last came back,
 * so a slow model throttles itself instead of queueing up frames the robot has
 * already driven past.
 */

/** Never sample faster than this, however quick the model turns out to be. */
const MIN_INTERVAL_MS = 700

/** What the frame is scaled to before sending. Matches the camera's own width. */
const SEND_WIDTH = 640

export function useDemoDetections(
  client: RobotClient | null,
  source: DemoSource | null,
  mediaRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): Detection[] {
  const [detections, setDetections] = useState<Detection[]>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false

    // Cleared through the same path everything else here uses, rather than
    // synchronously in the effect body: the linter is right that a straight
    // setState here cascades, and a microtask is enough to avoid it.
    const clear = () => {
      if (!cancelled) setDetections([])
    }

    if (!enabled || !client || !source) {
      queueMicrotask(clear)
      return () => {
        cancelled = true
      }
    }

    let timer: number | undefined

    const canvas = (canvasRef.current ??= document.createElement('canvas'))

    const tick = async () => {
      if (cancelled) return
      const started = Date.now()

      try {
        const jpeg = await grab(mediaRef.current, canvas)
        if (jpeg && !cancelled) {
          const body = await client.request<{ detections: Detection[] }>(
            '/api/detect',
            { method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } },
          )
          if (!cancelled) setDetections(body.detections ?? [])
        }
      } catch {
        // No model installed, or it faulted. Draw nothing rather than stale
        // boxes over a frame they do not describe.
        clear()
      }

      if (cancelled) return
      timer = window.setTimeout(tick, Math.max(0, MIN_INTERVAL_MS - (Date.now() - started)))
    }

    void tick()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [client, source, mediaRef, enabled])

  return detections
}

/** The element as a JPEG, or null if it has not painted anything yet. */
async function grab(
  container: HTMLElement | null,
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  const media = container?.querySelector('video, img') as
    | HTMLVideoElement
    | HTMLImageElement
    | null
  if (!media) return null

  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
  const height =
    media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
  if (!width || !height) return null

  const scale = SEND_WIDTH / width
  canvas.width = SEND_WIDTH
  canvas.height = Math.round(height * scale)

  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(media, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82),
  )
}
