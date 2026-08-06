import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'

import { project, projectPath, type Origin } from '@/components/map/geo'
import { pin, useLeaflet } from '@/components/map/useLeaflet'
import * as format from '@/lib/format'
import type { TrailPoint } from '@/robot/useLiveTrail'

interface GeoTraceMapProps {
  origin: Origin
  /** Either the run's stored path or the live trail — only x/y are read. */
  path: TrailPoint[]
  /** Live position, in the run's local frame. Omitted for a finished run. */
  head?: { x: number; y: number } | null
  height?: number
  interactive?: boolean
}

/**
 * The track, on the actual street it was driven under.
 *
 * Every metre of this is still dead reckoning — see PathMap, which draws the
 * same track with no map behind it. Putting it over tiles adds exactly one
 * thing: the operator's own claim about where the robot went in, and which way
 * it was pointing. It does not make the track a survey, and the line is drawn
 * thin and unadorned for the same reason it is there.
 *
 * The heading the whole thing hangs off has no magnetometer behind it, so a
 * turn the IMU drifted through rotates everything after it. That error is
 * cumulative and it is why there is no grid, no scale bar and no north arrow.
 */
export function GeoTraceMap({
  origin,
  path,
  head = null,
  height = 260,
  interactive = true,
}: GeoTraceMapProps) {
  const { containerRef, map, tiles } = useLeaflet({
    centre: [origin.lat, origin.lon],
    interactive,
  })

  // As [lat, lon] tuples: Leaflet's own LatLngLiteral spells it `lng`, and
  // converting once here beats spelling it both ways everywhere below.
  //
  // The stored track and the live head are kept apart on purpose. The track
  // only changes when the robot has moved a quarter of a metre (the server
  // samples it by distance); the head changes ten times a second. Merging them
  // would tie every layer on this map to the telemetry tick, and the live map
  // would spend the whole run tearing down and rebuilding a polyline.
  const track = useMemo<[number, number][]>(
    () => projectPath(origin, path).map(({ lat, lon }) => [lat, lon]),
    [origin, path],
  )
  const nose = useMemo<[number, number] | null>(() => {
    if (!head) return null
    const { lat, lon } = project(origin, head.x, head.y)
    return [lat, lon]
  }, [origin, head])

  const entryRef = useRef<L.CircleMarker | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const noseRef = useRef<L.CircleMarker | null>(null)

  // Where the operator said the robot went in. Drawn once, and drawn even
  // before there is any track: it is the one point on here that is not an
  // estimate.
  useEffect(() => {
    if (!map) return
    const marker = pin([origin.lat, origin.lon], '#ff4d4d').addTo(map)
    marker.bindTooltip('Entry', { direction: 'top' })
    entryRef.current = marker
    return () => {
      marker.remove()
      entryRef.current = null
    }
  }, [map, origin.lat, origin.lon])

  // The track, refitted when it grows. Only ever on new stored points, so the
  // view holds still while the robot crawls between two of them.
  useEffect(() => {
    if (!map) return
    if (track.length < 2) {
      lineRef.current?.remove()
      lineRef.current = null
      return
    }

    if (lineRef.current) {
      lineRef.current.setLatLngs(track)
    } else {
      lineRef.current = L.polyline(track, {
        color: '#ffffff',
        weight: 2,
        opacity: 0.85,
      }).addTo(map)
    }

    // Frame the whole run rather than sitting at the entry: the interesting
    // part of a track is usually the far end of it.
    map.fitBounds(L.latLngBounds(track).pad(0.25), { animate: false })
  }, [map, track])

  // The live head, moved rather than rebuilt.
  useEffect(() => {
    if (!map || !nose) {
      noseRef.current?.remove()
      noseRef.current = null
      return
    }
    if (noseRef.current) {
      noseRef.current.setLatLng(nose)
    } else {
      noseRef.current = pin(nose, '#4ade80').addTo(map)
    }
  }, [map, nose])

  // The map instance is torn down with the component, but the markers outlive
  // a `head` going null, so they need releasing by hand.
  useEffect(() => {
    return () => {
      lineRef.current?.remove()
      noseRef.current?.remove()
      lineRef.current = null
      noseRef.current = null
    }
  }, [])

  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-panel border border-ink-800">
        <div ref={containerRef} style={{ height }} className="w-full bg-ink-900" />

        {tiles === 'unavailable' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink-1000/80 px-2 py-1 text-[11px] text-ink-400">
            No map tiles — offline. The track is still drawn to scale.
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex items-baseline justify-between gap-3">
        <span className="label">estimated track · entry point placed by hand</span>
        <span className="text-[11px] text-ink-500">
          {format.metres(lengthOf(track))} of track
        </span>
      </figcaption>
    </figure>
  )
}

/** Ground distance along the drawn line, for the caption. */
function lengthOf(points: [number, number][]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += L.latLng(points[i - 1]).distanceTo(L.latLng(points[i]))
  }
  return total
}
