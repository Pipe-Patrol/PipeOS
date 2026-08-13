import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { GeoTraceMap } from '@/components/map/GeoTraceMap'
import { PathMap } from '@/components/map/PathMap'
import { DefectBox } from '@/components/overlay/DefectBox'
import { EmptyState } from '@/components/primitives/EmptyState'
import { readError } from '@/lib/errors'
import { ExportMenu } from '@/components/rundetail/ExportMenu'
import { PreviewRow } from '@/components/rundetail/PreviewRow'
import { RunProfile } from '@/components/rundetail/RunProfile'
import {
  selectDefect,
  selectRecording,
  selectSnapshot,
  snapshotFor,
  type Selection,
} from '@/components/rundetail/selection'
import { Card, Strip } from '@/components/rundetail/Strip'
import { Page } from '@/components/shell/Page'
import { defectClassName, defectLabel, SEVERITY_LABELS } from '@/constants/defects'
import { detectionColor } from '@/lib/detectionColors'
import * as format from '@/lib/format'
import { useRobot } from '@/robot/RobotProvider'
import { useRun } from '@/robot/useRun'

/**
 * One run, after the fact.
 *
 * SEVEN ROWS, IN THE ORDER THE QUESTIONS GET ASKED. What is this run, how big
 * was it, where is everything, what am I looking at, and then the three
 * inventories. The map is the exception: it spans the first two rows rather
 * than taking one of its own, because "where was this" is context for the
 * heading rather than a section of its own — and it is unframed, with no
 * caption, because a map with a figure caption under it is a picture in a
 * document rather than a place.
 *
 * ONE SELECTION DRIVES THE WHOLE PAGE. The longitudinal view and all three
 * strips select into the same state, and the preview is the single place
 * anything is shown at size. Clicking the same defect in two places cannot
 * produce two different views of it.
 *
 * Every distance here is an estimate, and the page says so once rather than
 * appending a margin to each number. The stored uncertainty still travels with
 * the run and still has its own column in the CSV export.
 */
export function RunDetailRoute() {
  const { runId } = useParams<{ runId: string }>()
  const { client } = useRobot()
  const { run, loading, error, refresh } = useRun(client, runId ?? null)
  const [deleting, setDeleting] = useState(false)

  /**
   * Delete video, and nothing else.
   *
   * Footage is almost all of what a run weighs, and almost never the part
   * anybody is asked for -- the defects, the stills and the path stay, so this
   * frees the card without costing the inspection record. That asymmetry is why
   * it is confirmed rather than undoable: there is no undo on an SD card, and
   * an accidental press should cost a sentence, not a survey.
   */
  const deleteRecording = async (recordingId: string, number: number) => {
    if (!client || !runId) return
    if (!window.confirm(`Delete clip ${number}? The video file is removed for good.`)) {
      return
    }
    setDeleting(true)
    try {
      await client.request(`/api/runs/${runId}/recordings/${recordingId}`, {
        method: 'DELETE',
      })
      setSelection(null)
      await refresh()
    } catch (caught) {
      window.alert(readError(caught, 'could not delete the clip'))
    } finally {
      setDeleting(false)
    }
  }

  const deleteRecordings = async () => {
    if (!client || !runId || !run) return
    const count = run.recordings.length
    if (
      !window.confirm(
        `Delete all ${count} clip${count === 1 ? '' : 's'} from this run? ` +
          'The video files are removed for good. Defects and captures are kept.',
      )
    ) {
      return
    }
    setDeleting(true)
    try {
      await client.request(`/api/runs/${runId}/recordings`, { method: 'DELETE' })
      setSelection(null)
      await refresh()
    } catch (caught) {
      window.alert(readError(caught, 'could not delete the video'))
    } finally {
      setDeleting(false)
    }
  }
  const [selection, setSelection] = useState<Selection | null>(null)

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
    <Page title={run.name} actions={<ExportMenu client={client} run={run} />}>
      {/* Rows 1 and 2 share a grid with the map, which occupies the right of
          both. Constrained rather than fluid: past about 320 px it stops adding
          anything a small map did not already say. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className="panel px-4 py-3">
            <h2 className="display text-[13px] text-ink-0">{run.name}</h2>
            <p className="tnum mt-1 text-[11.5px] text-ink-500">
              {format.timestamp(run.started_at)} · ID {run.id}
            </p>
            {run.interrupted && (
              <p className="mt-2 inline-block rounded-sm border border-state-warning-signal/20 bg-state-warning-signal/10 px-2 py-0.5 text-[11.5px] text-state-warning-signal">
                Interrupted — ended by a power cut rather than by the operator
              </p>
            )}
          </section>

          {/* One line. Six numbers stacked as cards was a row of empty space
              around six short strings. */}
          <section className="panel flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
            <Stat label="Distance" value={format.metres(run.distance_m)} />
            <Stat label="Duration" value={format.duration(run.duration_s)} />
            <Stat label="Defects" value={String(run.defects.length)} />
            <Stat label="Captures" value={String(run.snapshots.length)} />
            <Stat label="Recordings" value={String(run.recordings.length)} />
            <Stat label="Uncertainty" value={format.metres(run.uncertainty_m)} />
          </section>
        </div>

        {/* Unframed: no border, no caption, no "estimated track" line under it.
            The panel is the map's own frame. */}
        <div className="panel h-[188px] overflow-hidden lg:h-auto lg:min-h-[188px]">
          {run.origin ? (
            <GeoTraceMap origin={run.origin} path={run.path} bare />
          ) : (
            <PathMap path={run.path} motion={NO_MOTION} bare />
          )}
        </div>
      </div>

      <RunProfile run={run} selected={selection} onSelect={setSelection} />

      {selection && (
        <PreviewRow
          client={client}
          run={run}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}

      <Strip
        title="Defects"
        count={run.defects.length}
        empty="No defects logged on this run"
      >
        {run.defects.map((defect) => {
          const snapshot = snapshotFor(run, defect)
          return (
            <Card
              key={defect.id}
              selected={selection?.id === defect.id}
              onClick={() =>
                setSelection(selection?.id === defect.id ? null : selectDefect(defect))
              }
              label={defectLabel(defect.code)}
              caption={`${format.metres(defect.chainage_m)} · ${
                SEVERITY_LABELS[defect.severity] ?? defect.severity
              }`}
            >
              {snapshot ? (
                <>
                  <img
                    src={client.mediaUrl(`${base}/snapshots/${snapshot.file}`)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {defect.region && (
                    <DefectBox
                      rect={defect.region}
                      label={defectClassName(defect.code)}
                      showLabel={false}
                    />
                  )}
                </>
              ) : (
                <span
                  className="absolute inset-x-0 bottom-0 h-1"
                  style={{ background: detectionColor(defectClassName(defect.code)) }}
                />
              )}
            </Card>
          )
        })}
      </Strip>

      <Strip
        title="Recordings"
        count={run.recordings.length}
        empty="Nothing was recorded on this run"
        action={
          <button
            type="button"
            disabled={deleting}
            onClick={() => void deleteRecordings()}
            className="rounded-sm px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-white/8 hover:text-state-fault-signal disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete all video'}
          </button>
        }
      >
        {run.recordings.map((recording, index) => (
          <Card
            key={recording.id}
            selected={selection?.id === recording.id}
            onClick={() =>
              setSelection(
                selection?.id === recording.id ? null : selectRecording(recording),
              )
            }
            onDelete={() => void deleteRecording(recording.id, index + 1)}
            deleteLabel={`Delete clip ${index + 1}`}
            label={`Clip ${index + 1}`}
            caption={`${format.duration(recording.duration_s)} · ${format.metres(
              recording.chainage_start_m,
            )}`}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[11px] tracking-[0.08em] text-ink-500 uppercase">
              {recording.frames} frames
            </span>
          </Card>
        ))}
      </Strip>

      <Strip
        title="Captures"
        count={run.snapshots.length}
        empty="Nothing was captured on this run"
      >
        {run.snapshots.map((snapshot) => (
          <Card
            key={snapshot.id}
            selected={selection?.id === snapshot.id}
            onClick={() =>
              setSelection(
                selection?.id === snapshot.id ? null : selectSnapshot(snapshot),
              )
            }
            label={format.metres(snapshot.chainage_m)}
            caption={format.timestamp(snapshot.at)}
          >
            <img
              src={client.mediaUrl(`${base}/snapshots/${snapshot.file}`)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </Card>
        ))}
      </Strip>
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[11px] text-ink-400">{label}</span>
      <span className="tnum text-[14px] font-semibold text-ink-100">{value}</span>
    </span>
  )
}

/** PathMap wants a live motion object; a finished run has no robot on it. */
const NO_MOTION = {
  quality: 'estimated',
  distance_travelled_m: 0,
  chainage_m: 0,
  speed_m_s: 0,
  uncertainty_m: 0,
  heading_deg: 0,
  position: { x: 0, y: 0 },
  source: 'stopped',
  blind: false,
  slipping: false,
  calibrated: false,
} as const
