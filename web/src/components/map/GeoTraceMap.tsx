import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import L from 'leaflet'

import { project, projectPath, type Origin } from '@/components/map/geo'
import {
  DEFAULT_ZOOM,
  homeMarker,
  mapColour,
  positionMarker,
  useLeaflet,
} from '@/components/map/useLeaflet'
import { RecentreIcon } from '@/components/primitives/icons'
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
  /** See useLeaflet: the driving screen drags and zooms but keeps its keys. */
  keyboard?: boolean
  /**
   * Fill the box: no border, no rounding, no caption. This is how it is drawn
   * on the driving screen, where the map IS the panel rather than a picture
   * inside one, and every pixel of chrome is a pixel of street not shown.
   */
  bare?: boolean
  /**
   * Makes the H the return-home button. Only the driving screen passes this;
   * everywhere else the entry point is a mark and nothing more.
   */
  home?: {
    returning: boolean
    label: string
    onToggle: () => void
  }
  /** Anything else floated over the map. */
  children?: ReactNode
}

/**
 * The track, on the actual street it was driven under.
 *
 * Every metre of this is dead reckoning — see PathMap, which draws the same
 * track with no map behind it. Putting it over tiles adds exactly one thing:
 * the operator's own claim about where the robot went in, and which way it was
 * pointing. It does not make the track a survey.
 *
 * THREE MARKS, AND THE LONGITUDINAL STRIP DRAWS THE SAME THREE. An H at the
 * entry, a bright line for where the robot has been, a pulsing blue dot for
 * where it is. The strip under the video is this same run flattened onto one
 * axis, and an operator glancing between the two must not have to translate.
 *
 * The heading the whole thing hangs off has no magnetometer behind it, so a
 * turn the IMU drifted through rotates everything after it. That error is
 * cumulative, and it is why there is still no grid and no scale bar.
 */
export function GeoTraceMap({
  origin,
  path,
  head = null,
  height = 260,
  interactive = true,
  keyboard = interactive,
  bare = false,
  home,
  children,
}: GeoTraceMapProps) {
  const { containerRef, map, tiles } = useLeaflet({
    centre: [origin.lat, origin.lon],
    interactive,
    keyboard,
  })

  /**
   * Who is driving the view.
   *
   *   fit     the default: frame the whole run, entry point included, and
   *           refit as it grows
   *   manual  the operator has dragged or zoomed. Nothing moves the view again
   *           until they ask — a view that snapped back to the whole run every
   *           time the robot logged a path point is one nobody can hold still
   *           long enough to read a street name off
   *   follow  what recentre leaves behind: the robot stays in the middle at
   *           whatever zoom the operator chose
   */
  const [view, setView] = useState<'fit' | 'manual' | 'follow'>('fit')

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

  const lineRef = useRef<L.Polyline | null>(null)
  const noseRef = useRef<L.Marker | null>(null)

  /**
   * Put the robot in the middle of the frame.
   *
   * It used to just clear the manual flag and let the refit effect run, which
   * did something quite different: fitBounds frames the whole run, so on a long
   * one the robot ended up wherever in the box it happened to be — often at the
   * very edge — and on a short one the view jumped out to a scale nobody asked
   * for. Recentre means centre, so this pans to the robot and leaves the zoom
   * exactly where the operator had set it.
   *
   * It leaves the map in `follow` rather than back in `fit`, so the robot stays
   * in the middle from then on instead of the view springing out to the whole
   * run on the next path point.
   */
  const recentre = useCallback(() => {
    if (map) {
      const target = nose ?? (track.length > 0 ? track[track.length - 1] : null)
      if (target) map.setView(target, map.getZoom(), { animate: false })
    }
    setView('follow')
  }, [map, nose, track])

  // What counts as "the operator moved it" is read off the DOM rather than off
  // Leaflet's own move events, because Leaflet fires those for our own
  // fitBounds too — the map would declare itself manually driven the first time
  // it framed the track, before anyone had touched it.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !interactive) return

    const touched = () => setView('manual')
    container.addEventListener('pointerdown', touched)
    container.addEventListener('wheel', touched, { passive: true })
    return () => {
      container.removeEventListener('pointerdown', touched)
      container.removeEventListener('wheel', touched)
    }
  }, [containerRef, interactive])

  // Where the operator said the robot went in. Drawn once, and drawn even
  // before there is any track: it is the one point on here that is not an
  // estimate, and the one an operator looks for to answer "how do I get out".
  // The click handler is read through a ref so that engaging a return does not
  // tear the marker down and rebuild it — Leaflet would drop the click that
  // caused it, and the button would need pressing twice.
  const homeRef = useRef(home)
  useEffect(() => {
    homeRef.current = home
  })

  // Pulled out of the dependency array: `home` is a new object every render, so
  // only the three values that actually change the badge's markup are watched.
  const homeInteractive = home !== undefined
  const homeReturning = home?.returning ?? false
  const homeLabel = home?.label

  useEffect(() => {
    if (!map) return
    const marker = homeMarker([origin.lat, origin.lon], {
      onClick: homeInteractive ? () => homeRef.current?.onToggle() : undefined,
      returning: homeReturning,
      title: homeLabel,
    }).addTo(map)
    return () => {
      marker.remove()
    }
  }, [map, origin.lat, origin.lon, homeInteractive, homeReturning, homeLabel])

  // The track, refitted when it grows. Only ever on new stored points, so the
  // view holds still while the robot crawls between two of them.
  useEffect(() => {
    if (!map) return
    if (track.length < 2) {
      lineRef.current?.remove()
      lineRef.current = null
      return
    }

    const colour = mapColour('--color-track', '#2563eb')
    if (lineRef.current) {
      lineRef.current.setLatLngs(track)
    } else {
      lineRef.current = L.polyline(track, {
        color: colour,
        weight: 3,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(map)
    }

    // Framed around the entry point as well as the track, not just the track.
    // The way out is the thing an operator is deciding about, and a view that
    // scrolled the H off the top the moment the run got long would be hiding
    // the one mark this map exists to show.
    //
    // The zoom is capped rather than left to fitBounds: a run a few metres old
    // is a bounds a few metres across, which Leaflet answers by zooming past
    // where OpenStreetMap has tiles — a blank grey square where the street
    // should be.
    if (view !== 'fit') return
    map.fitBounds(
      L.latLngBounds([[origin.lat, origin.lon], ...track]).pad(0.3),
      { animate: false, maxZoom: DEFAULT_ZOOM },
    )
  }, [map, track, origin.lat, origin.lon, view])

  // The live head, moved rather than rebuilt. It updates ten times a second, so
  // it must not touch the view — except to follow the robot off the edge, which
  // is a pan rather than a refit so the scale holds still underneath it.
  useEffect(() => {
    if (!map || !nose) {
      noseRef.current?.remove()
      noseRef.current = null
      return
    }
    if (noseRef.current) {
      noseRef.current.setLatLng(nose)
    } else {
      noseRef.current = positionMarker(nose).addTo(map)
    }

    // `follow` holds the robot in the middle — that is what recentre promised,
    // and letting it drift to the edge until it fell off would be a slower
    // version of not centring at all. `fit` only chases it off the edge, so the
    // scale holds still underneath. `manual` never moves the view.
    if (view === 'follow') {
      map.panTo(nose, { animate: false })
    } else if (view === 'fit' && !map.getBounds().contains(nose)) {
      map.panTo(nose, { animate: false })
    }
  }, [map, nose, view])

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

  const canvas = (
    <div className={bare ? 'relative h-full w-full' : 'relative'}>
      <div
        ref={containerRef}
        style={bare ? undefined : { height }}
        className={`bg-ink-900 ${bare ? 'h-full w-full' : 'w-full'}`}
      />

      {/* Only once there is something to undo. A permanent recentre button
          would be a control that does nothing for the whole of most runs. */}
      {view === 'manual' && (
        <button
          type="button"
          onClick={recentre}
          className="panel absolute top-2 right-2 z-[800] flex size-7 items-center justify-center rounded-panel text-ink-200 transition-colors hover:bg-white/10 hover:text-ink-0"
          title="Put the robot back in the middle"
          aria-label="Recentre on the robot"
        >
          <RecentreIcon size={15} />
        </button>
      )}

      {/* z-800 because Leaflet's own panes run to 700 in this same stacking
          context, and without it the tile layer covers the notice. */}
      {tiles === 'unavailable' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[800] bg-ink-1000/80 px-2 py-1 text-[11px] text-ink-400">
          No map tiles — offline. The track is still drawn to scale.
        </div>
      )}

      {children}
    </div>
  )

  // Bare is the whole component on the driving screen: it fills whatever box it
  // is given and says nothing underneath it.
  if (bare) return canvas

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-panel border border-ink-800">{canvas}</div>

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
