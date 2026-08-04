import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { clampZoom } from '@/components/live/ZoomControl'
import type { RobotClient } from '@/robot/client'

interface VideoFeedProps {
  client: RobotClient
  /** 1 = fit. Above that, a centred digital zoom. */
  zoom: number
  /** Scroll on the frame nudges the zoom. */
  onZoom: (zoom: number) => void
  /** Dimmed and labelled when the link is down — a stale frame must look stale. */
  stale: boolean
}

const RETRY_DELAY_MS = 3000

interface Offset {
  x: number
  y: number
}

/**
 * Keep the frame covering the viewport. At scale s the image spans s× the box,
 * so the pan is bounded to [box·(1−s), 0] on each axis — no black edges, and at
 * 1× the only legal offset is zero, which resets the pan when zoomed all the way
 * out.
 */
function clampOffset(offset: Offset, scale: number, width: number, height: number): Offset {
  return {
    x: Math.min(0, Math.max(width * (1 - scale), offset.x)),
    y: Math.min(0, Math.max(height * (1 - scale), offset.y)),
  }
}

/**
 * The MJPEG feed, full bleed.
 *
 * `object-fit: cover` rather than contain: letterboxing wastes the screen an
 * operator is reading pipe wall off. Zoom is a CSS transform on the same
 * element — the Pi has no spare cycles to crop and re-encode, and at 640x480
 * the browser's scaler is as good as anything we would do server-side.
 *
 * Zoom is anchored: the wheel keeps the point under the cursor fixed, the corner
 * control keeps the centre fixed, and once magnified the frame can be dragged to
 * look around. The transform origin is the top-left so the pan maths is a plain
 * translate rather than a percentage-origin puzzle.
 *
 * The stale treatment matters more than it looks. A dropped MJPEG stream leaves
 * the last frame painted, and a frozen frame is indistinguishable from a live
 * one showing a stationary robot. Dimming it, and saying so, is the only signal
 * there is.
 */
export function VideoFeed({ client, zoom, onZoom, stale }: VideoFeedProps) {
  const [nonce, setNonce] = useState(() => Date.now())
  const [failed, setFailed] = useState(false)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })

  const containerRef = useRef<HTMLDivElement>(null)
  // Where the next zoom change should stay fixed, in container coordinates.
  // Null means the centre — which is what a corner-button zoom wants.
  const anchorRef = useRef<Offset | null>(null)
  const prevZoomRef = useRef(zoom)
  // Active drag: pointer start plus the offset it started from.
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  // Retry forever: the camera can come back without a page reload, and an
  // operator should not have to know that.
  useEffect(() => {
    if (!failed) return
    const timer = setTimeout(() => {
      setFailed(false)
      setNonce(Date.now())
    }, RETRY_DELAY_MS)
    return () => clearTimeout(timer)
  }, [failed])

  // Re-anchor the pan whenever the zoom changes, so the fixed point (cursor for
  // the wheel, centre otherwise) stays put and the offset stays in bounds.
  useLayoutEffect(() => {
    const el = containerRef.current
    const from = prevZoomRef.current
    prevZoomRef.current = zoom
    if (!el || zoom === from) return

    const { width, height } = el.getBoundingClientRect()
    const anchor = anchorRef.current ?? { x: width / 2, y: height / 2 }
    anchorRef.current = null
    const ratio = zoom / from
    setOffset((current) =>
      clampOffset(
        {
          x: anchor.x - ratio * (anchor.x - current.x),
          y: anchor.y - ratio * (anchor.y - current.y),
        },
        zoom,
        width,
        height,
      ),
    )
  }, [zoom])

  const zoomable = zoom > 1

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 flex touch-none items-center justify-center overflow-hidden bg-black select-none ${
        zoomable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      onWheel={(event) => {
        const el = containerRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          anchorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        }
        onZoom(clampZoom(zoom - Math.sign(event.deltaY) * 0.2))
      }}
      onPointerDown={(event) => {
        if (!zoomable || event.button !== 0) return
        dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        const el = containerRef.current
        if (!drag || !el) return
        const { width, height } = el.getBoundingClientRect()
        setOffset(
          clampOffset(
            {
              x: drag.ox + (event.clientX - drag.x),
              y: drag.oy + (event.clientY - drag.y),
            },
            zoom,
            width,
            height,
          ),
        )
      }}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
    >
      {!failed && (
        <img
          key={nonce}
          src={client.cameraUrl(nonce)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          className={`h-full w-full object-cover transition-opacity duration-200 ${
            stale ? 'opacity-40' : 'opacity-100'
          }`}
        />
      )}

      {failed && <p className="label text-[11px] tracking-[0.14em]">no camera feed</p>}

      {stale && !failed && (
        <p className="absolute rounded-panel border border-state-fault-signal/60 bg-ink-1000/70 px-3 py-1.5 text-[12px] tracking-[0.1em] text-state-fault-signal uppercase">
          Link lost — frame is not live
        </p>
      )}
    </div>
  )
}
