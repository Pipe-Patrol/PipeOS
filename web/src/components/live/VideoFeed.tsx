import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { clampZoom } from '@/components/live/ZoomControl'
import type { RobotClient } from '@/robot/client'

interface VideoFeedProps {
  client: RobotClient
  /** 1 = fit. Above that, a digital zoom anchored on the pointer. */
  zoom: number
  /** Pinch or scroll on the frame nudges the zoom. */
  onZoom: (zoom: number) => void
  /** Dimmed and labelled when the link is down — a stale frame must look stale. */
  stale: boolean
}

const RETRY_DELAY_MS = 3000

/**
 * A mouse notch is one big delta, a trackpad pinch is a stream of small ones, so
 * they cannot share a response curve. The notch gets a fixed step; the pinch is
 * multiplicative, which is what makes it track the fingers instead of racing
 * away at high zoom.
 */
const WHEEL_STEP = 0.2
const PINCH_SENSITIVITY = 0.01

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
 * ZOOM GESTURES ARE BOUND BY HAND, NOT AS AN onWheel PROP. React registers wheel
 * listeners passively, so preventDefault() inside a React handler is silently
 * ignored — and a trackpad pinch reaches the page as a wheel event with ctrlKey
 * set, which is exactly what the browser's own page zoom listens for. Without a
 * non-passive listener the two fire together, so the same two fingers sometimes
 * zoomed the video and sometimes zoomed the whole console. `passive: false` is
 * what lets us claim the gesture and stop the browser acting on it. Safari does
 * not send wheel for pinch at all — it sends its own gesture events — so those
 * are bound alongside.
 *
 * The stale treatment matters more than it looks. A dropped MJPEG stream leaves
 * the last frame painted, and a frozen frame is indistinguishable from a live
 * one showing a stationary robot. So it is dimmed almost to black — far enough
 * that it cannot be mistaken for a picture, which is the whole point. It is not
 * labelled: the words go to the notice bar above the status bar with every
 * other fault, and a caption in the middle of the glass would be the one
 * exception to that rule.
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
  // The listeners below are registered once and never re-bound, so they read the
  // live zoom through this rather than closing over a stale one. Re-registering
  // per zoom change would drop events in the middle of a pinch.
  const liveRef = useRef({ zoom, onZoom })
  useEffect(() => {
    liveRef.current = { zoom, onZoom }
  })

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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const anchorOn = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      anchorRef.current = { x: clientX - rect.left, y: clientY - rect.top }
    }

    const onWheel = (event: WheelEvent) => {
      // Claim the gesture before anything else can: unprevented, a ctrl+wheel
      // zooms the whole console and a plain wheel scrolls the page behind it.
      event.preventDefault()
      anchorOn(event.clientX, event.clientY)
      const { zoom, onZoom } = liveRef.current
      const next = clampZoom(
        event.ctrlKey
          ? zoom * (1 - event.deltaY * PINCH_SENSITIVITY)
          : zoom - Math.sign(event.deltaY) * WHEEL_STEP,
      )
      // Advance the ref now rather than waiting for the render to sync it. A
      // pinch fires faster than React re-renders, so several events land in one
      // frame; reading the prop each time would make them all compute the same
      // step from the same stale zoom and the gesture would barely move.
      liveRef.current = { zoom: next, onZoom }
      onZoom(next)
    }

    // Safari's pinch. `scale` is cumulative for the whole gesture, so it is
    // applied against the zoom the gesture started from rather than the current
    // one — compounding it per event would run away.
    let gestureBase = 1
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureBase = liveRef.current.zoom
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const { scale } = event as Event & { scale?: number }
      if (typeof scale !== 'number') return
      liveRef.current.onZoom(clampZoom(gestureBase * scale))
    }
    const onGestureEnd = (event: Event) => event.preventDefault()

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart, { passive: false })
    el.addEventListener('gesturechange', onGestureChange, { passive: false })
    el.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [])

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
            stale ? 'opacity-[0.12]' : 'opacity-100'
          }`}
        />
      )}

      {failed && <p className="label text-[11px] tracking-[0.14em]">no camera feed</p>}
    </div>
  )
}
