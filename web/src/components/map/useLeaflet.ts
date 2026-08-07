import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * A Leaflet map in a div, with the one thing this application has to care about
 * that a normal web app does not: THE TILES MAY NEVER ARRIVE.
 *
 * The console is served off the Pi over its own network. In a van at the side
 * of a road there may be no route to the internet at all, and OpenStreetMap's
 * tiles come from the internet. That is not a failure to handle politely — it
 * is the normal condition of the job — so `tiles` reports what happened and
 * every caller stays usable without them. Clicking, dragging, coordinates and
 * the drawn track all work on a blank background.
 *
 * Leaflet is bundled from npm rather than loaded from a CDN for the same
 * reason the fonts are: a console that goes blank without a network is not a
 * console you can take down a manhole.
 */

export type TileState = 'loading' | 'ready' | 'unavailable'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '© OpenStreetMap'
/** Close enough to see a manhole cover, far enough to recognise the street. */
export const DEFAULT_ZOOM = 18

/** As tight as OpenStreetMap's tiles go. The entry point picker opens here. */
export const MAX_ZOOM = 19

interface Options {
  centre: [number, number]
  zoom?: number
  /** False for a display-only map: no dragging, no zooming, no keyboard. */
  interactive?: boolean
}

export function useLeaflet({ centre, zoom = DEFAULT_ZOOM, interactive = true }: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const [tiles, setTiles] = useState<TileState>('loading')

  // Held in a ref so a moving centre does not tear the map down and rebuild it.
  // The map owns its own view once it exists; callers pan it deliberately.
  const initial = useRef({ centre, zoom })

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    const instance = L.map(container, {
      center: initial.current.centre,
      zoom: initial.current.zoom,
      attributionControl: true,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      touchZoom: interactive,
    })

    const layer = L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: MAX_ZOOM,
      // Blank rather than a broken-image glyph repeated across the viewport.
      errorTileUrl:
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    })
    layer.on('load', () => setTiles('ready'))
    layer.on('tileerror', () => setTiles('unavailable'))
    layer.addTo(instance)

    mapRef.current = instance
    setMap(instance)

    // Leaflet measures the container on creation. Inside a form that was just
    // opened it can still be zero-height at that moment, which leaves a map
    // showing one grey tile until something else forces a resize.
    const observer = new ResizeObserver(() => instance.invalidateSize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      instance.remove()
      mapRef.current = null
      setMap(null)
    }
  }, [interactive])

  return { containerRef, map, tiles }
}

/**
 * A dot on the map, without Leaflet's default marker.
 *
 * The stock icon is a PNG resolved relative to the CSS, which bundlers rewrite
 * and which would be a second thing to fail with no network. A vector circle
 * has no assets behind it at all.
 */
export function pin(latlng: L.LatLngExpression, colour: string): L.CircleMarker {
  return L.circleMarker(latlng, {
    radius: 6,
    color: colour,
    weight: 2,
    fillColor: colour,
    fillOpacity: 0.85,
  })
}
