import { useMemo, type ReactNode } from 'react'

import type { TrailPoint } from '@/robot/useLiveTrail'
import type { Motion } from '@/robot/types'

interface PathMapProps {
  /** Either the run's stored path or the live trail — only x/y are read. */
  path: TrailPoint[]
  motion: Motion
  height?: number
  /** Fill the box: no border, no caption. Matches GeoTraceMap's `bare`. */
  bare?: boolean
  /** Controls floated over the drawing — the return-home button. */
  children?: ReactNode
}

const PADDING = 18

/**
 * Where the robot has been, and which way it is pointing — with no map behind
 * it, because nobody said where the run started.
 *
 * Every metre of this is dead reckoning: distance from a fused duty/flow
 * estimate, heading from a yaw that has no magnetometer behind it and drifts
 * the whole run. So there is no grid, no scale bar and no north arrow — every
 * one of those would imply a survey.
 *
 * It draws the same three marks as GeoTraceMap and the longitudinal strip: an H
 * where the run started, a bright line for where it has been, a pulsing blue
 * dot for where it is. Whether there are tiles under the track changes what the
 * track is worth; it must not change what it looks like.
 *
 * The cone is the robot's facing. It is the part an operator actually asks for
 * ("which way am I pointing now"), and unlike the absolute track it is only as
 * wrong as the yaw drift since the last straight section.
 */
export function PathMap({
  path,
  motion,
  height = 220,
  bare = false,
  children,
}: PathMapProps) {
  const points = useMemo(
    () => [...path, { x: motion.position.x, y: motion.position.y }],
    [path, motion.position.x, motion.position.y],
  )

  const view = useMemo(() => fit(points, height), [points, height])

  if (points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center bg-white/3 ${
          bare ? 'h-full w-full' : 'rounded-panel border border-ink-800'
        }`}
        style={bare ? undefined : { height }}
      >
        <p className="label">Start a run to begin</p>
      </div>
    )
  }

  const [head] = points.slice(-1)
  const headPixel = view.project(head.x, head.y)
  const start = view.project(points[0].x, points[0].y)
  const heading = motion.heading_deg

  const drawing = (
    <div className={bare ? 'relative h-full w-full' : 'relative'}>
      <svg
        viewBox={`0 0 ${view.width} ${height}`}
        width="100%"
        height={bare ? '100%' : height}
        preserveAspectRatio="xMidYMid meet"
        className={`bg-white/3 ${bare ? 'h-full w-full' : 'rounded-panel border border-ink-800'}`}
        role="img"
        aria-label="Path travelled, in the run's own frame"
      >
        {/* Colours go through `style` rather than through presentation
            attributes: `var()` is reliable in a CSS property value and is not
            in an SVG attribute, and a track that silently renders black on one
            browser is exactly the kind of failure nobody reports. */}
        <polyline
          points={points.map((p) => view.project(p.x, p.y).join(',')).join(' ')}
          style={{ fill: 'none', stroke: 'var(--color-track)' }}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Which way it is pointing. */}
        <g transform={`translate(${headPixel[0]} ${headPixel[1]}) rotate(${heading})`}>
          <path
            d="M0 0 L34 -13 A36 36 0 0 1 34 13 Z"
            style={{ fill: 'var(--color-position)' }}
            opacity={0.18}
          />
        </g>

        {/* Where the run started. The one point on here that is not an
            estimate, drawn as the same helipad badge the map and the strip use. */}
        <g transform={`translate(${start[0]} ${start[1]})`}>
          <circle
            r={9}
            style={{ fill: 'rgb(8 8 8 / 0.9)', stroke: 'var(--color-home)' }}
            strokeWidth={1.5}
          />
          <text
            y={4}
            textAnchor="middle"
            style={{ fill: 'var(--color-home)' }}
            fontSize={11}
            fontWeight={700}
          >
            H
          </text>
        </g>

        {/* Where it is now. Drawn in the viewBox rather than floated over the
            svg in HTML, because the drawing is letterboxed to preserve aspect
            and an HTML overlay would drift off the track whenever the box it
            is given is not the shape of the run. */}
        <g transform={`translate(${headPixel[0]} ${headPixel[1]})`}>
          <circle
            className="position-halo"
            r={5}
            style={{ fill: 'var(--color-position)' }}
          />
          <circle
            r={5}
            style={{ fill: 'var(--color-position)', stroke: 'rgb(0 0 0 / 0.85)' }}
            strokeWidth={1.5}
          />
        </g>
      </svg>

      {children}
    </div>
  )

  if (bare) return drawing

  return <figure className="m-0">{drawing}</figure>
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
