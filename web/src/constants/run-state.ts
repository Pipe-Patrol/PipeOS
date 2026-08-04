import type { Telemetry } from '@/robot/types'

/**
 * What the run is doing, in the operator's terms.
 *
 * Derived in one place so the status bar, the sidebar dot and anything added
 * later can never disagree about what state the robot is in.
 */
export type RunState = 'idle' | 'active' | 'recording' | 'warning' | 'fault'

export interface RunStatePresentation {
  label: string
  /** Fills the status bar. Must carry white text at >= 4.5:1. */
  surface: string
  dot: string
  pulse: boolean
}

export const RUN_STATE_PRESENTATION: Record<RunState, RunStatePresentation> = {
  idle: {
    label: 'Idle',
    surface: 'bg-state-idle-surface',
    dot: 'bg-state-idle-signal',
    pulse: false,
  },
  active: {
    // A run is in progress but video is not being written. Grey bar so it does
    // not read as recording; a steady green dot so it does not read as idle.
    label: 'Run',
    surface: 'bg-state-idle-surface',
    dot: 'bg-state-recording-signal',
    pulse: false,
  },
  recording: {
    label: 'Recording',
    surface: 'bg-state-recording-surface',
    dot: 'bg-state-recording-signal',
    pulse: true,
  },
  warning: {
    label: 'Warning',
    surface: 'bg-state-warning-surface',
    dot: 'bg-state-warning-signal',
    pulse: true,
  },
  fault: {
    label: 'Fault',
    surface: 'bg-state-fault-surface',
    dot: 'bg-state-fault-signal',
    pulse: true,
  },
}

/** A fault outranks a run in progress: the worse thing is the thing to show. */
export function runStateOf(telemetry: Telemetry | null): RunState {
  if (!telemetry) return 'idle'
  if (telemetry.alert?.level === 'critical') return 'fault'
  if (telemetry.alert?.level === 'warning') return 'warning'
  if (telemetry.recording.active) return 'recording'
  if (telemetry.run.active) return 'active'
  return 'idle'
}
