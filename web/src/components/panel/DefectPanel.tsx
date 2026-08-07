import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { Button } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { Popover } from '@/components/primitives/Popover'
import { ClockIcon } from '@/components/primitives/icons'
import { DEFECT_GROUPS, DEFECT_TYPES, defectLabel } from '@/constants/defects'
import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import type { RobotClient } from '@/robot/client'
import type { ClimateReading, DefectRegion, Motion, Run } from '@/robot/types'

interface DefectPanelProps {
  client: RobotClient
  run: Run | null
  motion: Motion
  /** Stamped onto the defect alongside the chainage. */
  climate: ClimateReading
  /** Drawn on the live feed, not in here. Null until the operator marks one. */
  region: DefectRegion | null
  /**
   * When the region was marked. Doubles as the cache-buster for the still, so
   * the preview freezes on one frame — the one the defect is filed against.
   */
  regionMarkedAt: number
  onRegionChange: (region: DefectRegion | null) => void
  /** Hands the feed over to the drawing overlay. */
  onDrawRegion: () => void
  /** True while the operator is drawing on the feed rather than in here. */
  drawing: boolean
  onSaved: () => void
  onClose: () => void
}

/** Clock face 1..12 from where the box sits on the circular pipe view. */
function clockFromRegion(region: DefectRegion): number {
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  let angle = Math.atan2(cx - 0.5, -(cy - 0.5)) // 0 at 12 o'clock, clockwise
  if (angle < 0) angle += Math.PI * 2
  const hour = Math.round((angle / (Math.PI * 2)) * 12) % 12
  return hour === 0 ? 12 : hour
}

/**
 * Logging what the operator just saw.
 *
 * The chainage is stamped server-side at the moment the request lands — never
 * typed. The clock position is not typed either: it is read off the box the
 * operator draws, so the picture and the pipe-wall position can never disagree.
 * That box travels with the defect as its region.
 *
 * The box is drawn on the live feed rather than in here. Asking someone to find
 * a hairline crack a second time, in a thumbnail, is asking them to mark the
 * wrong thing; the preview below is a record of what they marked, not the
 * instrument for marking it.
 */
export function DefectPanel({
  client,
  run,
  motion,
  climate,
  region,
  regionMarkedAt,
  onRegionChange,
  onDrawRegion,
  drawing,
  onSaved,
  onClose,
}: DefectPanelProps) {
  const [code, setCode] = useState(DEFECT_TYPES[0].code)
  const [severity, setSeverity] = useState(3)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [unit] = useTempUnit()

  // A live clock so "Time logged" reads as the moment it will be filed.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const clock = region ? clockFromRegion(region) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!run || saving) return
    setSaving(true)
    setError(null)
    try {
      await client.request(`/api/runs/${run.id}/defects`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          severity,
          clock_position: clock,
          note: note.trim(),
          with_snapshot: true,
          region,
        }),
      })
      setNote('')
      onRegionChange(null)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!run) {
    return (
      <Popover title="Defects" onClose={onClose}>
        <EmptyState title="No run in progress" />
      </Popover>
    )
  }

  return (
    <Popover title="Log a defect" onClose={onClose} dismissible={!drawing}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="label">Observation</span>
          <div className="flex items-center gap-2">
            <select
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-panel border border-ink-800 bg-white/5 px-2 text-[13px] text-ink-100 focus:border-white/35 focus:outline-none"
            >
              {DEFECT_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {DEFECT_TYPES.filter((type) => type.group === group).map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="shrink-0 text-[16px] font-medium tnum text-ink-0">
              @ {format.metres(motion.chainage_m)}
            </span>
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="label">Severity</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((level) => {
              const selected = severity === level
              const danger = level >= 4
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setSeverity(level)}
                  aria-pressed={selected}
                  className={`h-8 flex-1 rounded-panel border text-[12px] transition-colors ${
                    selected
                      ? danger
                        ? 'border-state-fault-signal bg-state-fault-signal/25 text-state-fault-signal'
                        : 'border-white/40 bg-white/22 text-white'
                      : 'border-ink-800 text-ink-400 hover:bg-white/8'
                  }`}
                >
                  {level}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <span className="label">Location on frame</span>
          {region ? (
            <>
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-panel border border-ink-800 bg-black">
                <img
                  key={regionMarkedAt}
                  src={client.cameraUrl(regionMarkedAt)}
                  alt="The frame this defect is filed against"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
                <div
                  className="absolute border-2 border-state-fault-signal"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.w * 100}%`,
                    height: `${region.h * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onDrawRegion}
                  className="rounded-sm border border-ink-800 px-2 py-1 text-[11px] text-ink-400 hover:bg-white/10 hover:text-ink-100"
                >
                  Redraw box
                </button>
                <button
                  type="button"
                  onClick={() => onRegionChange(null)}
                  className="rounded-sm border border-ink-800 px-2 py-1 text-[11px] text-ink-400 hover:bg-white/10 hover:text-ink-100"
                >
                  Clear
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onDrawRegion}
              className="flex aspect-[4/3] w-full items-center justify-center rounded-panel border border-dashed border-ink-700 bg-white/2 text-[12px] text-ink-400 transition-colors hover:border-ink-500 hover:bg-white/6 hover:text-ink-100"
            >
              Click here to draw box
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label">Note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="resize-none rounded-panel border border-ink-800 bg-white/5 px-2 py-1.5 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
            placeholder="Optional"
          />
        </label>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-panel border border-ink-800 bg-white/2 p-3">
          <Info label="GPS coordinates" value={format.BLANK} />
          <Info
            label="Clock position"
            value={clock ? `${clock} o'clock` : format.BLANK}
            icon={<ClockIcon size={11} />}
          />
          <Info label="Distance from entry" value={format.metres(motion.chainage_m)} />
          <Info label="Time logged" value={new Date(now).toLocaleTimeString()} />
          <Info
            label="Temperature"
            value={format.temperature(climate.temperature_c, unit)}
          />
          <Info label="Humidity" value={format.percent(climate.humidity_pct)} />
        </div>

        {error && <p className="text-[12px] text-state-fault-signal">{error}</p>}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Log defect with snapshot'}
        </Button>
      </form>

      {run.defects.length > 0 && (
        <section className="mt-4 border-t border-ink-800 pt-3">
          <h3 className="label mb-2">This run — {run.defects.length}</h3>
          <ul className="flex flex-col gap-1">
            {[...run.defects].reverse().map((defect) => (
              <li
                key={defect.id}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 text-[12px]"
              >
                <span className="truncate text-ink-100">{defectLabel(defect.code)}</span>
                <span className="text-ink-500">S{defect.severity}</span>
                <span className="tnum text-ink-400">
                  {format.metres(defect.chainage_m)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Popover>
  )
}

function Info({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="label flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[12px] tnum text-ink-200">{value}</dd>
    </div>
  )
}
