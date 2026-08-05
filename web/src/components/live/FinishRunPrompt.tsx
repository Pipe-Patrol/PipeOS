import { Button } from '@/components/primitives/Button'
import * as format from '@/lib/format'
import type { Motion, Run, RunStatus } from '@/robot/types'

interface FinishRunPromptProps {
  run: Run | null
  status: RunStatus
  motion: Motion
  /** `telemetry.at`. The robot's clock, which is the one `started_at` is on. */
  now: number
  busy: boolean
  error: string | null
  /**
   * The run is already closed and only the shutdown failed. The dialog stops
   * offering to finish something that is finished, and becomes a retry.
   */
  runClosed: boolean
  onConfirm: () => void
  /** Finish, then power the Pi off — the end of the day, in one press. */
  onConfirmAndShutdown: () => void
  onCancel: () => void
}

/**
 * The gate in front of closing a run.
 *
 * Worth a confirmation because it does not come back: the server only reopens
 * runs it considers *interrupted*, and a run finished here is finished
 * deliberately. So the dialog shows what is about to be sealed — an operator
 * who meant to keep driving should see a number that surprises them.
 *
 * Distance comes from live telemetry rather than the run record, because
 * `distance_m` is not written until the moment this button does it.
 */
export function FinishRunPrompt({
  run,
  status,
  motion,
  now,
  busy,
  error,
  runClosed,
  onConfirm,
  onConfirmAndShutdown,
  onCancel,
}: FinishRunPromptProps) {
  // Both timestamps come from the robot, so a browser whose clock is minutes
  // off does not get to invent an elapsed time for the report.
  const elapsed = status.started_at ? now - status.started_at : null
  const defects = run?.defects.length ?? status.defect_count ?? 0
  const snapshots = run?.snapshots.length ?? status.snapshot_count ?? 0

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-1000/75 backdrop-blur-sm">
      <div className="panel w-[min(440px,92vw)] rounded-lg p-5">
        <h2 className="display text-[15px] text-ink-100">
          {runClosed ? 'Run finished, still running' : 'Finish this run?'}
        </h2>
        <p className="mt-2 text-[12px] text-ink-400">
          {runClosed
            ? 'The run is closed and saved. The robot is still powered on — do not flip the switch.'
            : `${status.name || 'The run in progress'} closes. The recording will be stopped and saved. No further changes can be made.`}
        </p>

        {/* Hidden once the run is closed: these read from live telemetry, which
            has already reset, and a summary of zeroes over a finished run is
            worse than no summary at all. */}
        {!runClosed && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat
              label="Distance"
              value={format.metresWithError(
                motion.distance_travelled_m,
                motion.uncertainty_m,
              )}
            />
            <Stat label="Elapsed" value={format.duration(elapsed)} />
            <Stat label="Defects" value={String(defects)} />
            <Stat label="Snapshots" value={String(snapshots)} />
          </dl>
        )}

        {error && <p className="mt-3 text-[12px] text-state-fault-signal">{error}</p>}

        {/* Packing up is one press, but it is the separate press. Finishing a
            run between two pipes is the common case and must not cost the
            operator a wait for the Pi to boot again. */}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            {runClosed ? 'Close' : 'Keep driving'}
          </Button>
          <Button variant="danger" onClick={onConfirmAndShutdown} disabled={busy}>
            {runClosed ? 'Try shutting down again' : 'Finish & shut down'}
          </Button>
          {!runClosed && (
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? 'Finishing…' : 'Finish run'}
            </Button>
          )}
        </div>

        {!runClosed && (
          <p className="mt-3 text-right text-[11px] text-ink-600">
            Shutting down powers the Pi off safely.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-[13px] tnum">{value}</dd>
    </div>
  )
}
