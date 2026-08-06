import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'

import { Button } from '@/components/primitives/Button'
import {
  compassPoint,
  normaliseBearing,
  type OriginDraft,
} from '@/components/map/geo'
import { pin, useLeaflet } from '@/components/map/useLeaflet'

interface EntryPointPickerProps {
  value: OriginDraft | null
  onChange: (origin: OriginDraft | null) => void
  /**
   * The robot's own compass bearing right now, or null if north has not been
   * set in Settings. Offered as the entry bearing, since the robot is normally
   * sitting at the manhole pointing the way it is about to go.
   */
  heading: number | null
}

/** Nowhere in particular. Only ever seen before a location is placed. */
const FALLBACK_CENTRE: [number, number] = [51.5072, -0.1276]

/**
 * Where the robot went in, and which way it was pointing.
 *
 * There is no GPS on the robot, and there would be no signal for one down a
 * pipe, so this is the operator's own claim rather than a measurement. It is
 * still the most useful number on the run: every metre the odometer produces is
 * relative to this point, and without it a track is a squiggle with no address.
 *
 * Three ways in, because in a van at 7am any one of them can be the broken one:
 *
 *   the map        click it. Needs tiles, so needs a network
 *   this device    browser geolocation. Needs permission and a fix
 *   the boxes      type the numbers off a site plan. Always works
 *
 * The bearing is separate because nothing can measure it: the IMU has no
 * magnetometer (see hardware/imu.py), so unless the operator says which way the
 * robot faced, the track is drawn as though it entered heading north.
 */
export function EntryPointPicker({
  value,
  onChange,
  heading,
}: EntryPointPickerProps) {
  const { containerRef, map, tiles } = useLeaflet({
    centre: value ? [value.lat, value.lon] : FALLBACK_CENTRE,
  })
  const markerRef = useRef<L.CircleMarker | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  // Held in a ref so the click handler is bound once and still sees the current
  // bearing. Rebinding it on every keystroke in the bearing box would drop
  // clicks in the window between removing the old listener and adding the new.
  const bearingRef = useRef<number | null>(value?.bearing_deg ?? null)
  useEffect(() => {
    bearingRef.current = value?.bearing_deg ?? null
  })

  const place = useCallback(
    (lat: number, lon: number) => {
      onChange({ lat, lon, bearing_deg: bearingRef.current })
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

  const useThisDevice = () => {
    if (!navigator.geolocation) {
      setLocateError('This browser has no location service')
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const { latitude, longitude } = position.coords
        place(latitude, longitude)
        map?.setView([latitude, longitude], map.getZoom())
      },
      (error) => {
        setLocating(false)
        // The message matters: "denied" is a settings problem the operator can
        // fix, "unavailable" means go and type the numbers instead.
        setLocateError(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission refused — type the coordinates instead'
            : 'No location fix — type the coordinates instead',
        )
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const setField = (field: 'lat' | 'lon' | 'bearing_deg', raw: string) => {
    const parsed = Number(raw)
    // A half-typed "-" or "51." is not a coordinate yet. Ignoring it leaves the
    // last good value in place rather than resetting the box under the cursor.
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    const base: OriginDraft = value ?? { lat: 0, lon: 0, bearing_deg: null }
    onChange({
      ...base,
      [field]: field === 'bearing_deg' ? normaliseBearing(parsed) : parsed,
    })
  }

  // What the run will actually be filed with: what was typed, else what the
  // robot knows, else north. Shown so the compass label under the box is never
  // describing a different number from the one that gets used.
  const effectiveBearing = value?.bearing_deg ?? heading ?? 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Entry point</span>
        <span className="text-[11px] text-ink-500">
          {value ? 'Click the map to move it' : 'Optional — click the map'}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-panel border border-ink-800">
        <div ref={containerRef} className="h-[180px] w-full bg-ink-900" />

        {tiles === 'unavailable' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink-1000/80 px-2 py-1 text-[11px] text-ink-400">
            No map tiles — offline. Clicking and the boxes below still work.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="quiet" onClick={useThisDevice} disabled={locating}>
          {locating ? 'Locating…' : 'Use this device'}
        </Button>
        {value && (
          <Button type="button" variant="quiet" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>

      {locateError && <p className="text-[11px] text-ink-400">{locateError}</p>}

      <p className="text-[11px] text-ink-500">
        {heading === null
          ? 'No north reference — the track is drawn as though the robot entered heading north. Set north in Settings to fill this in from the robot.'
          : `Robot is reading ${Math.round(heading)}° ${compassPoint(heading)}. Leave the box empty to use that.`}
      </p>

      <div className="grid grid-cols-3 gap-2">
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
        <Field
          label={`Facing ${compassPoint(effectiveBearing)}`}
          value={value?.bearing_deg != null ? String(Math.round(value.bearing_deg)) : ''}
          onChange={(raw) => setField('bearing_deg', raw)}
          placeholder={heading === null ? '0' : String(Math.round(heading))}
        />
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (raw: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-panel border border-ink-800 bg-white/5 px-2 text-[12px] tnum text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
      />
    </label>
  )
}
