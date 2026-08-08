import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'

import { Button } from '@/components/primitives/Button'
import type { OriginDraft } from '@/components/map/geo'
import { MAX_ZOOM, pin, useLeaflet } from '@/components/map/useLeaflet'

interface EntryPointPickerProps {
  value: OriginDraft | null
  onChange: (origin: OriginDraft | null) => void
}

/** Nowhere in particular. Only ever seen before a location is placed. */
const FALLBACK_CENTRE: [number, number] = [51.5072, -0.1276]

/**
 * Where the robot went in.
 *
 * There is no GPS on the robot, and there would be no signal for one down a
 * pipe, so this is the operator's own claim rather than a measurement. It is
 * still the most useful number on the run: every metre the odometer produces is
 * relative to this point, and without it a track is a squiggle with no address.
 *
 * Three ways in, because in a van at 7am any one of them can be the broken one:
 *
 *   this device    browser geolocation, asked for as soon as the panel opens
 *   the map        click it. Needs tiles, so needs a network
 *   the boxes      type the numbers off a site plan. Always works
 *
 * It opens at the tightest zoom the tiles go to. A robot works a length of pipe
 * between two manholes, so the useful question is which cover on this street,
 * not which street — and starting zoomed out means every operator pinches in
 * before they can answer it.
 *
 * The entry BEARING is not here. It comes from the north reference below, which
 * is the only thing that can produce one: nothing on the robot measures a
 * compass direction, so asking for the same fact in two places would let them
 * disagree.
 */
export function EntryPointPicker({ value, onChange }: EntryPointPickerProps) {
  const { containerRef, map, tiles } = useLeaflet({
    centre: value ? [value.lat, value.lon] : FALLBACK_CENTRE,
    zoom: MAX_ZOOM,
  })
  const markerRef = useRef<L.CircleMarker | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  const place = useCallback(
    (lat: number, lon: number) => {
      onChange({ lat, lon, bearing_deg: null })
    },
    [onChange],
  )

  useEffect(() => {
    if (!map) return
    const onClick = (event: L.LeafletMouseEvent) => {
      place(event.latlng.lat, event.latlng.lng)
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map, place])

  // Draw the placed point, and follow it when it moves.
  useEffect(() => {
    if (!map) return

    if (!value) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    const at: [number, number] = [value.lat, value.lon]
    if (markerRef.current) {
      markerRef.current.setLatLng(at)
    } else {
      markerRef.current = pin(at, '#ff4d4d').addTo(map)
    }
    // Pan rather than setView: a jump back to the same spot on every keystroke
    // in the latitude box would make the boxes unusable.
    if (!map.getBounds().contains(at)) map.panTo(at)
  }, [map, value])

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateError('This browser cannot look up your location.')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const { latitude, longitude } = position.coords
        place(latitude, longitude)
        map?.setView([latitude, longitude], MAX_ZOOM)
      },
      (error) => {
        setLocating(false)
        // The message matters: "denied" is a settings problem the operator can
        // fix, "unavailable" means go and type the numbers instead.
        setLocateError(
          error.code === error.PERMISSION_DENIED
            ? 'This browser would not share your location, so you will need to type the coordinates in below.'
            : 'Your location could not be found, so you will need to type the coordinates in below.',
        )
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }, [map, place])

  // Asked for once, as soon as the map exists. The robot is almost always at
  // the manhole the console is standing next to, so the first guess is nearly
  // always right and an operator who has to press a button for it is an
  // operator who files half their runs with no location at all.
  const asked = useRef(false)
  useEffect(() => {
    if (!map || asked.current || value) return
    asked.current = true
    locate()
  }, [map, value, locate])

  const setField = (field: 'lat' | 'lon', raw: string) => {
    const parsed = Number(raw)
    // A half-typed "-" or "51." is not a coordinate yet. Ignoring it leaves the
    // last good value in place rather than resetting the box under the cursor.
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    const base: OriginDraft = value ?? { lat: 0, lon: 0, bearing_deg: null }
    onChange({ ...base, [field]: parsed })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-100">Entry point</span>
        <span className="text-[11.5px] text-ink-500">
          {value ? 'Click the map to move the pin' : 'Optional, click the map to place a pin'}
        </span>
      </div>

      <div className="overflow-hidden rounded-panel border border-ink-800">
        <div className="relative">
          <div ref={containerRef} className="h-[180px] w-full bg-ink-900" />

          {tiles === 'unavailable' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink-1000/80 px-2 py-1 text-[11px] text-ink-400">
              The map could not load, but you can still type the coordinates below.
            </div>
          )}
        </div>

        {/* Docked to the map rather than floated under it: these two act on the
            map and nothing else, and a gap here read as a gap between sections. */}
        <div className="flex items-center gap-1 border-t border-ink-800 bg-ink-950/60 px-1.5 py-1">
          <Button
            type="button"
            variant="quiet"
            onClick={locate}
            disabled={locating}
            className="h-7 px-2 text-[12px]"
          >
            {locating ? 'Locating' : 'Use this device'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="quiet"
              onClick={() => onChange(null)}
              className="h-7 px-2 text-[12px]"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {locateError && <p className="text-[11.5px] text-ink-400">{locateError}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Latitude"
          value={value ? value.lat.toFixed(5) : ''}
          onChange={(raw) => setField('lat', raw)}
        />
        <Field
          label="Longitude"
          value={value ? value.lon.toFixed(5) : ''}
          onChange={(raw) => setField('lon', raw)}
        />
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (raw: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] text-ink-400">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-panel border border-ink-800 bg-white/5 px-2 text-[12px] tnum text-ink-100 placeholder:text-ink-500 focus:border-white/20 focus:outline-none"
      />
    </label>
  )
}
