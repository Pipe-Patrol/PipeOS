import type { Defect, Recording, Run, Snapshot } from '@/robot/types'

/**
 * The one thing the run page is currently showing in its preview.
 *
 * Everything on the page selects into this shape — a marker on the
 * longitudinal view, a row in the defects table, a card in either strip — so
 * there is one preview rather than three, and clicking the same defect in two
 * places cannot show two different things.
 */

export type Selection =
  | { kind: 'defect'; id: string; defect: Defect }
  | { kind: 'snapshot'; id: string; snapshot: Snapshot }
  | { kind: 'recording'; id: string; recording: Recording }

export function selectDefect(defect: Defect): Selection {
  return { kind: 'defect', id: defect.id, defect }
}

export function selectSnapshot(snapshot: Snapshot): Selection {
  return { kind: 'snapshot', id: snapshot.id, snapshot }
}

export function selectRecording(recording: Recording): Selection {
  return { kind: 'recording', id: recording.id, recording }
}

/** Where the selected thing sits in the pipe, for the preview's stats column. */
export function chainageOf(selection: Selection): number | null {
  switch (selection.kind) {
    case 'defect':
      return selection.defect.chainage_m
    case 'snapshot':
      return selection.snapshot.chainage_m
    case 'recording':
      return selection.recording.chainage_start_m
  }
}

/** The snapshot a defect was filed against, if it kept one. */
export function snapshotFor(run: Run, defect: Defect): Snapshot | null {
  if (!defect.snapshot_id) return null
  return run.snapshots.find((snapshot) => snapshot.id === defect.snapshot_id) ?? null
}
