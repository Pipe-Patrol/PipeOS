import { useEffect, useRef, useState } from 'react'

import { MarkerCard } from '@/components/profile/MarkerCard'
import {
  profileDomain,
  profileMarkers,
  profileX,
  type ProfileMarker,
} from '@/components/profile/scale'
import { defectLabel } from '@/constants/defects'
import * as format from '@/lib/format'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

interface ProfileStripProps {
  client: RobotClient
  run: Run | null
  /** Live chainage. The strip's own bar, and the reach of the axis. */
  chainage_m: number
}

/**
 * The run so far, as one line of pipe.
 *
 * Docked under the video rather than floating over it. Everything else on the
 * live screen floats — the map, the zoom, the palette — because the frame is
 * the only thing an operator can see with down a pipe. This one is the
 * exception: it is 28 px, it is where the operator looks to decide whether they
 * have already surveyed this stretch, and covering pipe wall to say so would be
 * a bad trade.
 *
 * Markers are red for a defect and grey for a snapshot, and the red one is also
 * larger. Hue alone would put every colour-blind operator, and anyone reading
 * this in a van in daylight, on the wrong side of a distinction that matters.
 */
export function ProfileStrip({ client, run, chainage_m }: ProfileStripProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // The furthest the robot has been this run. Held here because nothing on the
  // wire reports it, and because an axis that shrank when the robot reversed
  // would slide every marker out from under the operator's finger.
  const runId = run?.id ?? null
  const [reach, setReach] = useState({ runId, max: chainage_m })
  if (reach.runId !== runId) {
    setReach({ runId, max: chainage_m })
  } else if (chainage_m > reach.max) {
    setReach({ runId, max: chainage_m })
  }

  const { markers, unplaced } = profileMarkers(run)
  const domain = profileDomain(markers, chainage_m, reach.max)
  const selected = markers.find((marker) => marker.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture phase, and it stops here: LiveRoute has its own window-level
      // Escape handler that closes the tool palette, and one Escape must close
      // one thing.
      event.stopPropagation()
      setSelectedId(null)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setSelectedId(null)
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [selectedId])

  return (
    <div
      ref={rootRef}
      className="relative flex h-7 shrink-0 items-center gap-3 border-t border-ink-800 bg-ink-950 px-3"
    >
      <span className="label tnum shrink-0">{format.metres(domain.min)}</span>

      <div className="relative h-full flex-1">
        {/* Single tone. The domain's far end IS the furthest chainage reached,
            so there is no unsurveyed stretch on this axis to draw differently. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700"
        />

        {markers.map((marker) => {
          const isDefect = marker.kind === 'defect'
          return (
            <button
              key={marker.id}
              type="button"
              onClick={() =>
                setSelectedId((current) => (current === marker.id ? null : marker.id))
              }
              // 16 px of hit area around a 5 px dot. The dot is the drawing; the
              // button is what a finger in a van actually has to land on.
              className="absolute top-0 bottom-0 z-10 flex w-4 -translate-x-1/2 items-center justify-center"
              style={{ left: `${profileX(marker.chainage_m, domain) * 100}%` }}
              aria-label={markerLabel(marker)}
              aria-pressed={selectedId === marker.id}
            >
              <span
                className={`block rounded-full ring-offset-0 transition-transform ${
                  isDefect
                    ? 'size-[5px] bg-state-fault-signal'
                    : 'size-[3.5px] bg-ink-400'
                } ${selectedId === marker.id ? 'scale-150 ring-1 ring-ink-100' : ''}`}
              />
            </button>
          )
        })}

        {/* Where the robot is now. Brightest thing on the strip, because it is
            the only mark that moves. */}
        <span
          aria-hidden
          className="absolute top-1/2 z-20 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-100"
          style={{ left: `${profileX(chainage_m, domain) * 100}%` }}
        />

        {selected && (
          <MarkerPopover
            marker={selected}
            fraction={profileX(selected.chainage_m, domain)}
            run={run!}
            client={client}
          />
        )}
      </div>

      <span className="label tnum shrink-0">{format.metres(domain.max)}</span>

      {/* Nothing places these on an axis of metres. Saying so costs 60 px and
          keeps the strip from quietly under-reporting the run. */}
      {unplaced > 0 && (
        <span className="label shrink-0 text-ink-600">+{unplaced} unplaced</span>
      )}
    </div>
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
 * has to sit above whichever dot was pressed. Edge clamping is three cases
 * rather than a measured position — a card 224 px wide only ever runs off the
 * screen near the ends of the track, and this needs no layout pass to know it.
 */
function MarkerPopover({ marker, fraction, run, client }: MarkerPopoverProps) {
  const near = fraction < 0.15
  const far = fraction > 0.85
  const anchor = near ? 'translate-x-0' : far ? '-translate-x-full' : '-translate-x-1/2'

  return (
    <div
      className={`panel absolute bottom-full z-30 mb-2 w-56 p-3 ${anchor}`}
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
