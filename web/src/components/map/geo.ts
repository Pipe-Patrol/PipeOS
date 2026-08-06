/**
 * Turning the robot's local track into somewhere on the earth.
 *
 * The odometer works in metres from wherever the run started, on axes that mean
 * nothing outside the run: +x is whichever way the robot happened to be facing
 * when it went in, +y is ninety degrees to its left. Two things are needed to
 * put that on a map, and neither can be measured by the robot:
 *
 *   where it went in    the operator places it — there is no GPS on board, and
 *                       there would be no signal for one down a pipe
 *   which way it faced  the operator says — the IMU runs on the game rotation
 *                       vector with no magnetometer, so its yaw is relative to
 *                       power-on and has no idea where north is
 *
 * Both live on the run as its `origin`. Without one, a track can still be drawn
 * in its own frame (PathMap) but not placed on a map, and this module is not
 * used at all.
 *
 * The projection is a flat-earth approximation around the origin. Over the
 * hundred-odd metres of a sewer run the error is millimetres, which is orders
 * of magnitude below the dead reckoning it is drawing.
 */

/** Metres per degree of latitude. Near enough constant everywhere. */
const M_PER_DEG_LAT = 111_320

export interface Origin {
  lat: number
  lon: number
  /** Compass bearing the robot faced going in, degrees, 0 = north. */
  bearing_deg: number
}

/**
 * An origin as the operator is still filling it in.
 *
 * The bearing is nullable here and not on the stored `Origin`, because "I have
 * not said" is a real answer at this stage and a meaningful one: the robot
 * fills it in from its own heading if a north reference has been set, and falls
 * back to north if not. By the time it is on a run it is always a number.
 */
export interface OriginDraft {
  lat: number
  lon: number
  bearing_deg: number | null
}

export interface LatLon {
  lat: number
  lon: number
}

/**
 * A local (x, y) in metres, as lat/lon.
 *
 * x runs along the robot's entry heading, y ninety degrees to its left —
 * matching estimation/odometry.py, where the position advances by
 * `x += step·cos(heading)` and `y += step·sin(heading)`.
 */
export function project(origin: Origin, x: number, y: number): LatLon {
  const bearing = toRadians(origin.bearing_deg)
  const sin = Math.sin(bearing)
  const cos = Math.cos(bearing)

  // Rotate the robot's frame onto the compass. Forward goes along the bearing;
  // left of forward is the bearing minus ninety degrees.
  const north = x * cos + y * sin
  const east = x * sin - y * cos

  // Longitude degrees shrink towards the poles; latitude degrees do not.
  const metresPerDegLon = M_PER_DEG_LAT * Math.cos(toRadians(origin.lat))

  return {
    lat: origin.lat + north / M_PER_DEG_LAT,
    // Guard the pole, where a metre east is an unbounded number of degrees.
    // Nothing is inspected there, but a NaN on screen is worth one line.
    lon:
      Math.abs(metresPerDegLon) < 1e-6
        ? origin.lon
        : origin.lon + east / metresPerDegLon,
  }
}

/** The whole track, in order. Points with no usable coordinates are dropped. */
export function projectPath(
  origin: Origin,
  points: { x: number; y: number }[],
): LatLon[] {
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => project(origin, p.x, p.y))
}

/** Degrees, formatted the way a coordinate is normally written down. */
export function formatLatLon(value: LatLon | null): string {
  if (!value) return '—'
  return `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}`
}

/** Compass bearing as a point of the compass, for a label beside the number. */
export function compassPoint(bearingDeg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round((normaliseBearing(bearingDeg) % 360) / 45) % 8
  return points[index]
}

/** Any angle into 0..360, so the server's `lt=360` bound is never tripped. */
export function normaliseBearing(bearingDeg: number): number {
  if (!Number.isFinite(bearingDeg)) return 0
  return ((bearingDeg % 360) + 360) % 360
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}
