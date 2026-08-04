import { useEffect, useRef, useState, type PointerEvent } from 'react'

import type { DefectRegion } from '@/robot/types'

/** The camera's own aspect. 640x480, and 180° of rotation does not change it. */
const FRAME_W = 4
const FRAME_H = 3

/** Below this in either axis it was a stray click, not a box. */
const MIN_SIDE = 0.02

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Where the frame actually sits inside a full-bleed box.
 *
 * The feed is `object-fit: cover`, so it is scaled up until it covers the box
 * and the overflow is cropped off one axis. Treating the box's own corners as
 * the frame's corners — which is what simply reading a percentage off the
 * container does — would stretch every drawn box away from what the operator
 * pointed at, by exactly the amount that got cropped.
 */
function coveredFrame(width: number, height: number) {
  const scale = Math.max(width / FRAME_W, height / FRAME_H)
  const w = FRAME_W * scale
  const h = FRAME_H * scale
  return { left: (width - w) / 2, top: (height - h) / 2, w, h }
}

interface RegionDrawerProps {
  onCommit: (region: DefectRegion) => void
  onCancel: () => void
}

/**
 * Draw a defect box on the live feed itself.
 *
 * The box used to be dragged over a thumbnail inside the panel, which asked the
 * operator to find a crack again in a picture the size of a stamp. Here they
 * point at it on the glass they already spotted it on, and the panel's preview
 * becomes a record of what they marked rather than the instrument for marking.
 *
 * Coordinates leave here normalised to the frame, not to this element, so the
 * region means the same thing to the panel preview, to the saved defect, and to
 * anything later drawn over a recording.
 */
export function RegionDrawer({ onCommit, onCancel }: RegionDrawerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<DefectRegion | null>(null)
  /**
   * The same box, kept in step synchronously.
   *
   * `pointerup` cannot read it from state: a quick drag delivers the last
   * `pointermove` and the `pointerup` inside one frame, so React has not
   * re-rendered and the handler's closure still holds the box as it was a
   * render ago — usually null, which silently throws the drawing away. Rare
   * enough to look like the box "sometimes not working", which is worse than
   * failing every time.
   */
  const boxRef = useRef<DefectRegion | null>(null)

  const track = (next: DefectRegion | null) => {
    boxRef.current = next
    setBox(next)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const pointAt = (event: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const frame = coveredFrame(rect.width, rect.height)
    return {
      x: clamp01((event.clientX - rect.left - frame.left) / frame.w),
      y: clamp01((event.clientY - rect.top - frame.top) / frame.h),
    }
  }

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30 cursor-crosshair touch-none overflow-hidden select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const p = pointAt(event)
        startRef.current = p
        track({ x: p.x, y: p.y, w: 0, h: 0 })
      }}
      onPointerMove={(event) => {
        const start = startRef.current
        if (!start) return
        const p = pointAt(event)
        track({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.abs(p.x - start.x),
          h: Math.abs(p.y - start.y),
        })
      }}
      onPointerUp={() => {
        startRef.current = null
        const drawn = boxRef.current
        // A box too small to see is almost certainly a misclick, so stay in
        // drawing mode rather than committing a region nobody meant to draw.
        if (drawn && drawn.w >= MIN_SIDE && drawn.h >= MIN_SIDE) onCommit(drawn)
        else track(null)
      }}
      onPointerCancel={() => {
        startRef.current = null
        track(null)
      }}
    >
      {/* Dimmed so it is obvious the feed is in a mode, not just being watched. */}
      <div className="pointer-events-none absolute inset-0 bg-ink-1000/35" />

      <p className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 rounded-panel border border-ink-700 bg-ink-1000/85 px-3 py-1.5 text-[12px] tracking-[0.1em] text-ink-100 uppercase">
        Drag a box around the defect · Esc to cancel
      </p>

      {/* The box is in frame coordinates, so it is positioned against a stand-in
          for the frame rather than against this element. `aspect-[4/3]` with
          both minimums at 100% reproduces object-cover geometry exactly — same
          scale, same centring, same overflow — in CSS, so nothing has to
          measure anything to paint the box back in the right place. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative aspect-[4/3] min-h-full min-w-full">
          {box && (
            <div
              className="absolute border-2 border-state-fault-signal"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
