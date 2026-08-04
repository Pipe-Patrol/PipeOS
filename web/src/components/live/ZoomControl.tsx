export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
export const ZOOM_STEP = 0.5

/** Clamp to range and snap to a tenth, so float drift never shows as 2.30000×. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10))
}

interface ZoomControlProps {
  zoom: number
  onZoom: (zoom: number) => void
}

/**
 * Digital zoom, controlled on the frame itself rather than from a panel.
 *
 * It sits on the video because that is where the operator is looking, and it
 * mirrors the map in the opposite corner. Scroll-to-zoom lives on the feed; this
 * is the visible, touch-reachable version of the same control.
 */
export function ZoomControl({ zoom, onZoom }: ZoomControlProps) {
  return (
    <div className="panel flex flex-col items-center gap-0.5 p-1">
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}
        className="flex size-10 items-center justify-center rounded-panel text-[19px] leading-none text-ink-300 transition-colors hover:bg-white/10 hover:text-ink-100 disabled:opacity-35"
      >
        +
      </button>
      <span className="tnum py-0.5 text-[11px] font-semibold text-ink-100">
        {zoom.toFixed(1)}×
      </span>
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}
        className="flex size-10 items-center justify-center rounded-panel text-[19px] leading-none text-ink-300 transition-colors hover:bg-white/10 hover:text-ink-100 disabled:opacity-35"
      >
        −
      </button>
    </div>
  )
}
