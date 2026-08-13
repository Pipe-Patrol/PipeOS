import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { DefectBox } from '@/components/overlay/DefectBox'
import { Button } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { Popover } from '@/components/primitives/Popover'
import { ClockIcon } from '@/components/primitives/icons'
import { formatLatLon, project } from '@/components/map/geo'
import {
  DEFECT_GROUPS,
  DEFECT_TYPES,
  defectClassName,
  defectLabel,
} from '@/constants/defects'
import * as format from '@/lib/format'
import { clockFromRegion } from '@/lib/region'
import { useTempUnit } from '@/lib/units'
import type { RobotClient } from '@/robot/client'
import type { ClimateReading, DefectRegion, Motion, Run } from '@/robot/types'

/**
 * What the panel opens already holding, when something else decided first.
 *
 * A box the model drew or an air spike both know what the defect is before the
 * operator says so, and re-entering it by hand would be answering a question
 * that has already been answered.
 */
export interface DefectPrefill {
  code?: string
  note?: string
}

interface DefectPanelProps {
  client: RobotClient
  run: Run | null
  motion: Motion
  /** Stamped onto the defect alongside the chainage. */
  climate: ClimateReading
  /** True while the air is doing something sudden, so the reading reads red. */
  spiking: boolean
  /** Set when something else already decided what this defect is. */
  prefill: DefectPrefill | null
  onPrefillUsed: () => void
  /** Drawn on the live feed, not in here. Null until the operator marks one. */
  region: DefectRegion | null
  /**
   * When the region was marked. Doubles as the cache-buster for the still, so
   * the preview freezes on one frame — the one the defect is filed against.
   */
  regionMarkedAt: number
  onRegionChange: (region: DefectRegion | null) => void
  /**
   * Hands the feed over to the drawing overlay, telling it which class is
   * selected so the box being dragged is already the colour it will be saved in.
   */
  onDrawRegion: (className: string, label: string) => void
  /** True while the operator is drawing on the feed rather than in here. */
  drawing: boolean
  onSaved: () => void
  onClose: () => void
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
  spiking,
  prefill,
  onPrefillUsed,
  region,
  regionMarkedAt,
  onRegionChange,
  onDrawRegion,
  drawing,
  onSaved,
  onClose,
}: DefectPanelProps) {
  // Same shape as the note below: null means "nothing chosen here yet", so a
  // prefilled class shows through until the operator picks one themselves.
  const [code, setCode] = useState<string | null>(null)
  const [severity, setSeverity] = useState(3)
  // Null until the operator types, so a note offered by a spike prompt can show
  // through underneath without an effect having to copy it in — and the moment
  // they type, what they wrote wins for good.
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [unit] = useTempUnit()

  // A live clock so "Time logged" reads as the moment it will be filed.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])


  const noteValue = note ?? prefill?.note ?? ''
  const codeValue = code ?? prefill?.code ?? DEFECT_TYPES[0].code
  const clock = region ? clockFromRegion(region) : null
  const className = defectClassName(codeValue)
  const draw = () => onDrawRegion(className, defectLabel(codeValue))

  /**
   * Where this is, on the earth.
   *
   * There is no GPS on the robot and there could not be one down a pipe, so
   * this is computed rather than received: the operator placed the entry point
   * and said which way the robot faced, and the odometer says how far along
   * that heading it has crawled. Projecting one through the other is the only
   * coordinate this system can produce, and it is the one that goes in a
   * report. Without an origin there is nothing to project from and it stays a
   * blank rather than inventing a position.
   */
  const gps = run?.origin
    ? project(run.origin, motion.position.x, motion.position.y)
    : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!run || saving) return
    setSaving(true)
    setError(null)
    try {
      await client.request(`/api/runs/${run.id}/defects`, {
        method: 'POST',
        body: JSON.stringify({
          code: codeValue,
          severity,
          clock_position: clock,
          note: noteValue.trim(),
          with_snapshot: true,
          region,
        }),
      })
      setNote(null)
      setCode(null)
      onPrefillUsed()
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
              value={codeValue}
              onChange={(event) => setCode(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-panel border border-ink-800 bg-white/5 px-2 text-[13px] text-ink-100 focus:border-white/20 focus:outline-none"
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
                        ? 'border-state-fault-signal/35 bg-state-fault-signal/25 text-state-fault-signal'
                        : 'border-white/30 bg-white/22 text-white'
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
                {/* A still, not the stream. Pointing this at /api/camera left
                    a live feed sitting under the box: the picture drifted on
                    as the robot crawled while the box stayed put, so the
                    preview showed the box over the wrong pipe. */}
                <img
                  key={regionMarkedAt}
                  src={client.stillUrl(regionMarkedAt)}
                  alt="The frame this defect is filed against"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
                <DefectBox rect={region} label={className} />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={draw}
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
              onClick={draw}
              className="flex aspect-[4/3] w-full items-center justify-center rounded-panel border border-dashed border-ink-700 bg-white/2 text-[12px] text-ink-400 transition-colors hover:border-ink-500 hover:bg-white/6 hover:text-ink-100"
            >
              Click here to draw box
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label">Note</span>
          <textarea
            value={noteValue}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="resize-none rounded-panel border border-ink-800 bg-white/5 px-2 py-1.5 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/20 focus:outline-none"
            placeholder="Optional"
          />
        </label>

        {/* Rows, not a grid of cards. Everything here is stamped automatically
            and read at a glance rather than filled in, so it earns one line
            each — the panel is competing with the video for height. */}
        <dl className="flex flex-col rounded-panel border border-ink-800 bg-white/2 px-2.5 py-1.5">
          <Row label="Distance" value={format.metres(motion.chainage_m)} />
          <Row label="GPS" value={formatLatLon(gps)} />
          <Row
            label="Clock"
            value={clock ? `${clock} o'clock` : format.BLANK}
            icon={<ClockIcon size={10} />}
          />
          <Row
            label="Air"
            value={`${format.temperature(climate.temperature_c, unit)}  ·  ${format.percent(
              climate.humidity_pct,
            )}`}
            // Red while the air is doing something sudden, matching the
            // readout on the video and the line in the notice bar.
            alarm={spiking}
          />
          <Row label="Logged" value={new Date(now).toLocaleTimeString()} />
        </dl>

        {error && <p className="text-[12px] text-state-fault-signal">{error}</p>}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Log defect with snapshot'}
        </Button>
      </form>

    </Popover>
  )
}

function Row({
  label,
  value,
  icon,
  alarm = false,
}: {
  label: string
  value: string
  icon?: ReactNode
  alarm?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="label flex shrink-0 items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd
        className={`truncate text-[12px] tnum ${
          alarm ? 'font-semibold text-state-fault-signal' : 'text-ink-200'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
