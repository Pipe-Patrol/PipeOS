import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Page } from '@/components/shell/Page'
import { EmptyState } from '@/components/primitives/EmptyState'
import * as format from '@/lib/format'
import { useRobot } from '@/robot/RobotProvider'
import type { RunSummary } from '@/robot/types'

/**
 * Every run the robot is holding.
 *
 * Fixed columns, uniform row heights, no dot separators — this is a table an
 * operator scans, and alignment is what makes it scannable.
 *
 * Interrupted runs are called out rather than hidden. A run that was never
 * ended usually means a power cut mid-inspection, and the video and defects up
 * to that moment are still there.
 */
/**
 * The column widths, shared by the header and every row so they cannot drift.
 *
 * The name is the only fluid column; everything else is sized to its content
 * and fixed. Date and ID get the width their longest value actually needs, and
 * the four figures get one width between them so the numbers line up as a
 * block — which is the point of a table of numbers.
 */
const COLUMNS =
  'grid grid-cols-[minmax(140px,1fr)_150px_100px_repeat(4,84px)] gap-x-5'

export function RunsRoute() {
  const { client } = useRobot()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      const body = await client.request<{ runs: RunSummary[] }>('/api/runs')
      setRuns(body.runs)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not load runs')
    }
  }, [client])

  useEffect(() => {
    // Fetch on mount — see the note in robot/useRun.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!client) return <Navigate to="/connect" replace />

  return (
    <Page title="Runs">
      {error && <p className="text-[12px] text-state-fault-signal">{error}</p>}

      {runs === null ? (
        <p className="text-[12px] text-ink-500">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        <div className="panel overflow-hidden">
          <div className={`${COLUMNS} border-b border-ink-800 px-4 py-2`}>
            <span className="label">Run</span>
            <span className="label">Date</span>
            <span className="label">ID</span>
            <span className="label text-right">Distance</span>
            <span className="label text-right">Duration</span>
            <span className="label text-right">Defects</span>
            <span className="label text-right">Captures</span>
          </div>

          <ul className="divide-y divide-ink-800">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  to={`/runs/${run.id}`}
                  className={`${COLUMNS} h-12 items-center px-4 hover:bg-white/5`}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13px] text-ink-100">{run.name}</span>
                    {run.interrupted && (
                      <span className="shrink-0 text-[11px] text-state-warning-signal">
                        interrupted
                      </span>
                    )}
                  </span>

                  <span className="tnum truncate text-[12px] text-ink-400">
                    {format.timestamp(run.started_at)}
                  </span>

                  <span className="tnum truncate text-[11px] text-ink-500">
                    {run.id}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {format.metres(run.distance_m)}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {format.duration(run.duration_s)}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {run.defect_count}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {run.snapshot_count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Page>
  )
}
