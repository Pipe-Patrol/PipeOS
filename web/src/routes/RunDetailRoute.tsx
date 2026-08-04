import { Navigate, useParams } from 'react-router-dom'

import { PathMap } from '@/components/map/PathMap'
import { Page } from '@/components/shell/Page'
import { Button } from '@/components/primitives/Button'
import { EmptyState } from '@/components/primitives/EmptyState'
import { defectLabel, SEVERITY_LABELS } from '@/constants/defects'
import * as format from '@/lib/format'
import { useRobot } from '@/robot/RobotProvider'
import { useRun } from '@/robot/useRun'
import type { Motion } from '@/robot/types'

/**
 * One run, after the fact.
 *
 * Every distance here carries its uncertainty. That is the difference between a
 * record someone can act on and a number that merely looks precise — and it is
 * the reason the CSV export puts the two in adjacent columns.
 */
export function RunDetailRoute() {
  const { runId } = useParams<{ runId: string }>()
  const { client } = useRobot()
  const { run, loading, error } = useRun(client, runId ?? null)

  if (!client) return <Navigate to="/connect" replace />

  if (loading && !run) {
    return (
      <Page title="Run">
        <p className="text-[12px] text-ink-500">Loading…</p>
      </Page>
    )
  }

  if (error || !run) {
    return (
      <Page title="Run">
        <EmptyState title="Could not load that run" />
      </Page>
    )
  }

  const base = `/api/runs/${run.id}`

  return (
    <Page
      title={run.name}
      actions={
        <div className="flex gap-2">
          {/* Only offered when there is something to convert. A download that
              404s is worse than a button that is not there. */}
          {run.recording && (
            <a href={client.mediaUrl(`${base}/video.mov`)} download>
              <Button variant="quiet">VIDEO</Button>
            </a>
          )}
          {(['json', 'csv', 'zip'] as const).map((fmt) => (
            <a key={fmt} href={client.mediaUrl(`${base}/export.${fmt}`)} download>
              <Button variant="quiet">{fmt.toUpperCase()}</Button>
            </a>
          ))}
        </div>
      }
    >
      <p className="tnum -mt-1 text-[11px] text-ink-500">
        ID {run.id} · ~/PipeOS/server/data/runs/{run.id}
      </p>

      {run.interrupted && (
        <p className="rounded-panel border border-state-warning-signal/50 bg-state-warning-signal/10 px-3 py-2 text-[12px] text-state-warning-signal">
          Interrupted
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-[1fr_320px]">
        <dl className="panel grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-4">
          <Stat
            label="Distance"
            value={format.metresWithError(run.distance_m, run.uncertainty_m)}
          />
          <Stat label="Duration" value={format.duration(run.duration_s)} />
          <Stat label="Defects" value={String(run.defects.length)} />
          <Stat label="Snapshots" value={String(run.snapshots.length)} />
          <Stat label="Started" value={format.timestamp(run.started_at)} />
          <Stat
            label="Video"
            value={
              run.recording
                ? `${run.recording.frames} frames · ${format.bytes(run.recording.bytes)}`
                : 'not recorded'
            }
          />
        </dl>

        <div className="panel p-4">
          <PathMap
            path={run.path}
            motion={motionFromRun(run.path, run.uncertainty_m)}
            height={180}
          />
        </div>
      </section>

      <section>
        <h2 className="label mb-2">Defects</h2>
        {run.defects.length === 0 ? (
          <EmptyState title="No defects logged on this run" />
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[minmax(100px,1fr)_90px_70px_110px_1fr] gap-x-4 border-b border-ink-800 px-4 py-2">
              <span className="label">Observation</span>
              <span className="label">Severity</span>
              <span className="label">Clock</span>
              <span className="label text-right">Chainage</span>
              <span className="label">Note</span>
            </div>
            <ul className="divide-y divide-ink-800">
              {run.defects.map((defect) => (
                <li
                  key={defect.id}
                  className="grid h-12 grid-cols-[minmax(100px,1fr)_90px_70px_110px_1fr] items-center gap-x-4 px-4"
                >
                  <span className="truncate text-[13px]">
                    {defectLabel(defect.code)}
                  </span>
                  <span className="text-[12px] text-ink-400">
                    {SEVERITY_LABELS[defect.severity] ?? defect.severity}
                  </span>
                  <span className="text-[12px] tnum text-ink-400">
                    {defect.clock_position ?? format.BLANK}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {format.metresWithError(
                      defect.chainage_m,
                      defect.chainage_uncertainty_m,
                    )}
                  </span>
                  <span className="truncate text-[12px] text-ink-500">
                    {defect.note || format.BLANK}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2 className="label mb-2">Snapshots</h2>
        {run.snapshots.length === 0 ? (
          <EmptyState title="Nothing captured on this run" />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {run.snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <a
                  href={client.mediaUrl(`${base}/snapshots/${snapshot.file}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={client.mediaUrl(`${base}/snapshots/${snapshot.file}`)}
                    alt={`Snapshot at ${format.metres(snapshot.chainage_m)}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-sm border border-ink-800 object-cover"
                  />
                </a>
                <span className="label mt-1 block text-center">
                  {format.metres(snapshot.chainage_m)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[14px] tnum">{value}</dd>
    </div>
  )
}

/** The map wants live motion; a finished run has only its last path point. */
function motionFromRun(
  path: { x: number; y: number; heading_deg: number; chainage_m: number }[],
  uncertainty: number,
): Motion {
  const last = path.at(-1)
  return {
    quality: 'estimated',
    distance_travelled_m: 0,
    chainage_m: last?.chainage_m ?? 0,
    speed_m_s: 0,
    uncertainty_m: uncertainty,
    heading_deg: last?.heading_deg ?? 0,
    position: { x: last?.x ?? 0, y: last?.y ?? 0 },
    source: 'stopped',
    slipping: false,
    calibrated: false,
    accel_m_s2: null,
  }
}
