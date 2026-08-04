import type { Alert } from '@/robot/types'

/**
 * One line, most urgent wins — the priority is decided server-side in
 * telemetry.py so the banner, the log and any future annunciator cannot
 * disagree about what is wrong.
 *
 * One at a time is deliberate. An operator driving has attention for exactly
 * one message, and a stack of them is how the important one gets missed.
 */
export function AlertBanner({ alert }: { alert: Alert | null }) {
  if (!alert) return null

  const critical = alert.level === 'critical'
  return (
    <div
      role="status"
      className={`pointer-events-none rounded-panel border px-3 py-1.5 text-[12px] tracking-[0.08em] uppercase backdrop-blur-sm ${
        critical
          ? 'border-state-fault-signal/70 bg-state-fault-signal/20 text-state-fault-signal'
          : 'border-state-warning-signal/60 bg-state-warning-signal/15 text-state-warning-signal'
      }`}
    >
      {alert.message}
    </div>
  )
}
