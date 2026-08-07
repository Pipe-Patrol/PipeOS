import { useEffect, useMemo, useRef, useState } from 'react'

import { MarkerCard } from '@/components/profile/MarkerCard'
import {
  profileDomain,
  profileMarkers,
  profileTicks,
  profileX,
  type ProfileDomain,
  type ProfileMarker,
} from '@/components/profile/scale'
import { defectLabel } from '@/constants/defects'
import * as format from '@/lib/format'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

interface ProfileStripProps {
  client: RobotClient
  run: Run | null
  /** Live chainage. The strip's own position mark, and the reach of the axis. */
  chainage_m: number
}

/**
 * The run so far, as one line of pipe.
 *
 * THIS IS THE MAP, FLATTENED. The map in the corner of the video and this strip
 * are the same run drawn two ways — one over the street, one along the pipe —
 * and they say so by drawing the same three marks: an H where the run went in,
 * a bright line for the ground already covered, a pulsing blue dot for where
 * the robot is. An operator glancing between them should never have to work out
 * which mark is which.
 *
 * Docked under the video rather than floating over it. Everything else on the
 * live screen floats — the map, the zoom, the palette — because the frame is
 * the only thing an operator can see with down a pipe. This one is the
 * exception: it is where the operator looks to decide whether they have already
 * surveyed this stretch, and covering pipe wall to say so would be a bad trade.
 *
 * It is ruled in metres now, rather than labelled only at its two ends. The
 * bare line meant the distance to anything in the middle of the run was
 * something you estimated by eye, on the one readout an inspection is actually
 * written in.
 *
 * Markers are drawn as markers — a body with a point on it, aimed at the
 * chainage they were filed at. Red and larger for a defect, grey and smaller
 * for a snapshot: hue alone would put every colour-blind operator, and anyone
 * reading this in a van in daylight, on the wrong side of a distinction that
 * matters.
 */

/**
 * The vertical layout, in pixels. Fixed, because the strip never reflows.
 *
 * The axis sits high in the strip rather than through the middle of it: the
 * numbers hang underneath, this is the last thing above the bottom of the
 * screen, and a ruling whose labels are clipped by the edge of the window is a
 * ruling nobody can read a distance off.
 */
const LAYOUT = {
  height: 62,
  /** The measuring bracket, when two markers are being compared. */
  bracketY: 7,
  /** Where a marker's point lands — the axis. */
  axisY: 30,
  /** How far the ruled ticks drop below it. */
  tickDrop: 5,
} as const

export function ProfileStrip({ client, run, chainage_m }: ProfileStripProps) {
  // Up to two. One shows its card; two show the distance between them, which is
  // the question a strip of markers is actually asked — "how far is that crack
  // from the joint I logged back there" — and which nothing else on the console
  // could answer without an operator subtracting two numbers by hand.
  const [selected, setSelected] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  // The furthest the robot has been this run, both ways. Held here because
  // nothing on the wire reports it, and because an axis that shrank when the
  // robot reversed would slide every marker out from under the operator's
  // finger. It is also what says which of the axis is surveyed and which is
  // still ahead, now that the axis runs on past the robot to a round number.
  const runId = run?.id ?? null
  const [reach, setReach] = useState({ runId, lo: chainage_m, hi: chainage_m })
  if (reach.runId !== runId) {
    setReach({ runId, lo: chainage_m, hi: chainage_m })
  } else if (chainage_m > reach.hi) {
    setReach({ ...reach, hi: chainage_m })
  } else if (chainage_m < reach.lo) {
    setReach({ ...reach, lo: chainage_m })
  }

  const { markers, unplaced } = profileMarkers(run)
  const domain = profileDomain(markers, chainage_m, reach.hi)
  const ticks = useMemo(() => profileTicks(domain), [domain])

  const chosen = useMemo(
    () =>
      selected
        .map((id) => markers.find((marker) => marker.id === id))
        .filter((marker): marker is ProfileMarker => marker != null),
    [selected, markers],
  )

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((other) => other !== id)
      // A third press starts a fresh comparison rather than silently dropping
      // one of the two already up — which of them it dropped would be a rule
      // the operator had to have learned.
      return current.length >= 2 ? [id] : [...current, id]
    })
  }

  useEffect(() => {
    if (selected.length === 0) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture phase, and it stops here: LiveRoute has its own window-level
      // Escape handler that closes the tool palette, and one Escape must close
      // one thing.
      event.stopPropagation()
      setSelected([])
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setSelected([])
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [selected.length])

  const percent = (value: number) => `${profileX(value, domain) * 100}%`

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 border-t border-ink-800 bg-ink-950 px-4"
      style={{ height: LAYOUT.height }}
    >
      <div className="relative h-full w-full">
        {/* The axis: what is still ahead, in the dark tone... */}
        <span
          aria-hidden
          className="absolute inset-x-0 h-px bg-ink-700"
          style={{ top: LAYOUT.axisY }}
        />

        {/* ...and what has already been surveyed, in the same colour the map
            draws the track in. The two are the same fact, so they are the same
            token — including the glow, which was once a hardcoded green and is
            exactly how the two views would have drifted apart. */}
        <span
          aria-hidden
          className="absolute h-[3px] rounded-full"
          style={{
            top: LAYOUT.axisY - 1,
            left: percent(Math.min(0, reach.lo)),
            right: `${100 - profileX(reach.hi, domain) * 100}%`,
            background: 'var(--color-track)',
            boxShadow:
              '0 0 7px color-mix(in srgb, var(--color-track) 55%, transparent)',
          }}
        />

        {/* The tick at zero is left unlabelled: the H badge stands on it, and
            "H" already says entry point more plainly than "0" does. Two marks
            fighting for the same 18 px said neither. */}
        {ticks.map((tick, index) => (
          <Tick
            key={tick}
            at={tick}
            left={percent(tick)}
            label={tick !== 0}
            // The end labels are pulled inwards. Centred on the last tick they
            // hang half outside the strip and get cut off by it.
            align={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
          />
        ))}

        {/* Where the run went in. The same badge the map puts on the street. */}
        <span
          aria-hidden
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: percent(0), top: LAYOUT.axisY }}
          title="Entry point"
        >
          <span className="home-badge">H</span>
        </span>

        {markers.map((marker) => (
          <MarkerPin
            key={marker.id}
            marker={marker}
            left={percent(marker.chainage_m)}
            selected={selected.includes(marker.id)}
            onClick={() => toggle(marker.id)}
          />
        ))}

        {/* Where the robot is now. Same mark as on the map, and above
            everything else on the strip because it is the only one that moves. */}
        <span
          aria-hidden
          className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
          style={{ left: percent(chainage_m), top: LAYOUT.axisY }}
        >
          <span className="position-dot" />
        </span>

        {chosen.length === 2 && (
          <Measurement a={chosen[0]} b={chosen[1]} domain={domain} />
        )}

        {chosen.length === 1 && run && (
          <MarkerPopover
            marker={chosen[0]}
            fraction={profileX(chosen[0].chainage_m, domain)}
            run={run}
            client={client}
          />
        )}
      </div>

      {/* Nothing places these on an axis of metres. Saying so keeps the strip
          from quietly under-reporting the run. */}
      {unplaced > 0 && (
        <span className="label absolute top-1 right-4 text-ink-600">
          +{unplaced} unplaced
        </span>
      )}
    </div>
  )
}

/**
 * One ruled mark and its number.
 *
 * The mark itself always sits exactly on its metre; only the number moves, and
 * only at the two ends, where a centred label would hang off the strip.
 */
function Tick({
  at,
  left,
  label,
  align,
}: {
  at: number
  left: string
  label: boolean
  align: 'start' | 'middle' | 'end'
}) {
  const shift =
    align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : '-translate-x-1/2 left-1/2'

  return (
    <span
      aria-hidden
      className="absolute -translate-x-1/2"
      style={{ left, top: LAYOUT.axisY }}
    >
      <span className="block w-px bg-ink-700" style={{ height: LAYOUT.tickDrop }} />
      {label && (
        <span
          // Sized and toned to be read rather than noticed: these are the
          // numbers a defect gets filed against, and at 9.5 px in ink-500 they
          // were closer to a texture than to a scale.
          className={`tnum absolute mt-1 text-[11px] leading-none font-medium whitespace-nowrap text-ink-300 ${shift}`}
          style={{ top: LAYOUT.tickDrop }}
        >
          {at}
        </span>
      )}
    </span>
  )
}

/**
 * A marker, drawn as one: a body with a point on it, aimed at the metre it was
 * filed against.
 *
 * It used to be a dot, which said where something was but not that it was a
 * thing you could press — and on an axis that also carries the robot, the
 * entry point and the ruling, one more dot was one more round mark to tell
 * apart. A shape with a point resolves both: it reads as a pin, and the tip
 * says exactly which metre without the shape above it having to be that narrow.
 */
function MarkerPin({
  marker,
  left,
  selected,
  onClick,
}: {
  marker: ProfileMarker
  left: string
  selected: boolean
  onClick: () => void
}) {
  const isDefect = marker.kind === 'defect'
  const width = isDefect ? 13 : 10
  const height = isDefect ? 17 : 13

  return (
    <button
      type="button"
      onClick={onClick}
      // A 20 px hit area around a 13 px pin. The pin is the drawing; the button
      // is what a finger in a van actually has to land on.
      className="absolute z-10 flex w-5 -translate-x-1/2 items-end justify-center"
      style={{ left, top: LAYOUT.axisY - height, height }}
      aria-label={markerLabel(marker)}
      aria-pressed={selected}
    >
      <svg
        width={width}
        height={height}
        viewBox="0 0 13 17"
        preserveAspectRatio="xMidYMax meet"
        className={`transition-transform ${selected ? 'scale-115' : ''}`}
        aria-hidden
      >
        {/* Rectangular body, tapering to a point on the axis. */}
        <path
          d="M1.2 1.2 H11.8 V10.4 L6.5 16.2 L1.2 10.4 Z"
          style={{
            fill: isDefect ? 'var(--color-state-fault-signal)' : 'var(--color-ink-400)',
            stroke: selected ? 'var(--color-ink-100)' : 'rgb(0 0 0 / 0.6)',
          }}
          strokeWidth={selected ? 1.6 : 1}
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/**
 * The distance between two markers, once both are pressed.
 *
 * Drawn as a measuring bracket rather than printed in a corner, because the
 * number means nothing without the two ends it was taken between — and with a
 * dozen markers on the strip, a bare "12.4 m" is a number the operator has to
 * work out the provenance of.
 */
function Measurement({
  a,
  b,
  domain,
}: {
  a: ProfileMarker
  b: ProfileMarker
  domain: ProfileDomain
}) {
  const from = Math.min(a.chainage_m, b.chainage_m)
  const to = Math.max(a.chainage_m, b.chainage_m)
  const left = profileX(from, domain)
  const right = profileX(to, domain)
  const mid = (left + right) / 2

  return (
    <>
      <span
        aria-hidden
        className="absolute z-20 border-t border-ink-300"
        style={{
          top: LAYOUT.bracketY,
          left: `${left * 100}%`,
          width: `${(right - left) * 100}%`,
        }}
      />
      {[left, right].map((edge, index) => (
        <span
          key={index}
          aria-hidden
          className="absolute z-20 w-px bg-ink-300"
          style={{
            top: LAYOUT.bracketY,
            left: `${edge * 100}%`,
            height: LAYOUT.axisY - LAYOUT.bracketY - 2,
          }}
        />
      ))}
      <span
        role="status"
        className="tnum absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-ink-950 px-1.5 text-[11px] font-medium text-ink-100"
        style={{ top: LAYOUT.bracketY, left: `${mid * 100}%` }}
      >
        {format.metres(to - from)}
      </span>
    </>
  )
}

interface MarkerPopoverProps {
  marker: ProfileMarker
  fraction: number
  run: Run
  client: RobotClient
}

/**
 * The card above a clicked marker.
 *
 * Not the Popover primitive: that one is fixed to the sidebar's edge, and this
 * has to sit above whichever pin was pressed. Edge clamping is three cases
 * rather than a measured position — a card 224 px wide only ever runs off the
 * screen near the ends of the track, and this needs no layout pass to know it.
 */
function MarkerPopover({ marker, fraction, run, client }: MarkerPopoverProps) {
  const near = fraction < 0.15
  const far = fraction > 0.85
  const anchor = near ? 'translate-x-0' : far ? '-translate-x-full' : '-translate-x-1/2'

  return (
    <div
      className={`panel absolute bottom-full z-40 mb-2 w-56 p-3 ${anchor}`}
      style={{ left: `${fraction * 100}%` }}
    >
      <MarkerCard marker={marker} run={run} client={client} />
    </div>
  )
}

function markerLabel(marker: ProfileMarker): string {
  const at = format.metres(marker.chainage_m)
  return marker.defect
    ? `Defect, ${defectLabel(marker.defect.code)}, at ${at}`
    : `Snapshot at ${at}`
}
