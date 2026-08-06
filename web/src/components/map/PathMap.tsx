import { useMemo } from 'react'

import * as format from '@/lib/format'
import type { TrailPoint } from '@/robot/useLiveTrail'
import type { Motion } from '@/robot/types'

interface PathMapProps {
  /** Either the run's stored path or the live trail — only x/y are read. */
  path: TrailPoint[]
  motion: Motion
  height?: number
}

const PADDING = 14

/**
 * Where the robot has been, and which way it is pointing.
 *
 * Every metre of this is dead reckoning: distance from a fused duty/flow
 * estimate, heading from a yaw that has no magnetometer behind it and drifts
 * the whole run. So the track is drawn as a thin line with no grid, no scale
 * bar and no north arrow — every one of those would imply a survey.
 *
 * The cone is the robot's facing. It is the part an operator actually asks for
 * ("which way am I pointing now"), and unlike the absolute track it is only as
 * wrong as the yaw drift since the last straight section.
 */
export function PathMap({ path, motion, height = 220 }: PathMapProps) {
  const points = useMemo(
    () => [...path, { x: motion.position.x, y: motion.position.y }],
    [path, motion.position.x, motion.position.y],
  )

  const view = useMemo(() => fit(points, height), [points, height])

  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-panel border border-ink-800 bg-white/3"
        style={{ height }}
      >
        <p className="label">no track yet — start driving</p>
      </div>
    )
  }

  const [head] = points.slice(-1)
  const headPixel = view.project(head.x, head.y)
  const heading = motion.heading_deg

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${view.width} ${height}`}
        width="100%"
        height={height}
        className="rounded-panel border border-ink-800 bg-white/3"
        role="img"
        aria-label="Estimated path travelled"
      >
        <polyline
          points={points.map((p) => view.project(p.x, p.y).join(',')).join(' ')}
          fill="none"
          stroke="var(--color-ink-400)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Entry point: the one place the run is certain about. */}
        {(() => {
          const start = view.project(points[0].x, points[0].y)
          return (
            <circle cx={start[0]} cy={start[1]} r={3} fill="var(--color-ink-500)" />
          )
        })()}

        <g transform={`translate(${headPixel[0]} ${headPixel[1]}) rotate(${heading})`}>
          <path
            d="M0 0 L34 -13 A36 36 0 0 1 34 13 Z"
            fill="var(--color-state-recording-signal)"
            opacity={0.16}
          />
          <circle r={4} fill="var(--color-state-recording-signal)" />
        </g>
      </svg>

      <figcaption className="mt-2 flex items-baseline justify-between gap-3">
        <span className="label">estimated</span>
        <span className="text-[11px] text-ink-500">
          {format.metres(motion.chainage_m)} from start
        </span>
      </figcaption>
    </figure>
  )
}

/** Fit the track to the box, preserving aspect so a turn is not distorted. */
function fit(points: { x: number; y: number }[], height: number) {
  const width = 320
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width - PADDING * 2) / spanX, (height - PADDING * 2) / spanY)

  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  return {
    width,
    project(x: number, y: number): [number, number] {
      return [
        offsetX + (x - minX) * scale,
        // SVG y grows downward; the world's does not.
        height - (offsetY + (y - minY) * scale),
      ]
    },
  }
}
