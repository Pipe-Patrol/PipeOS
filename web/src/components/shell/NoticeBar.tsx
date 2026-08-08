import { useEffect } from 'react'

import { clearNotice, raiseNotice, useNotices } from '@/lib/notices'
import { useRobot } from '@/robot/RobotProvider'

/**
 * The one place anything wrong is ever shown.
 *
 * Above the status bar, full width, and the topmost thing on screen. Two
 * conditions feed it that do not come from a `raiseNotice` call — the link and
 * the robot's own alert line — and they are pushed into the same channel here
 * rather than rendered separately, so there is exactly one bar to look at and
 * one priority order to reason about.
 *
 * One line at a time. An operator driving has attention for exactly one
 * message, and a stack is how the important one gets missed; the rest are
 * counted rather than listed.
 */
export function NoticeBar() {
  const { link, telemetry } = useRobot()
  const notices = useNotices()

  const alert = telemetry?.alert ?? null

  useEffect(() => {
    if (link.state === 'down') {
      raiseNotice('link', 'fault', 'Link lost — reconnecting. Motors are stopped.')
    } else if (link.state === 'stale') {
      raiseNotice('link', 'warning', 'No telemetry. Motors are stopped.')
    } else {
      clearNotice('link')
    }
  }, [link.state])

  useEffect(() => {
    if (!alert) {
      clearNotice('robot')
      return
    }
    raiseNotice('robot', alert.level === 'critical' ? 'fault' : 'warning', alert.message)
  }, [alert])

  const top = notices[0]
  if (!top) return null

  const fault = top.level === 'fault'
  return (
    <div
      role="alert"
      className={`flex h-9 shrink-0 items-center justify-center gap-3 px-4 text-[12px] font-semibold text-ink-0 ${
        fault ? 'bg-state-fault-surface' : 'bg-state-warning-surface'
      }`}
    >
      <span className="truncate">{top.message}</span>

      {top.action && (
        <button
          type="button"
          onClick={top.action.run}
          className="shrink-0 rounded-sm border border-white/25 bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-ink-0 transition-colors hover:bg-white/25"
        >
          {top.action.label}
        </button>
      )}

      {notices.length > 1 && (
        <span className="shrink-0 font-medium opacity-70">
          +{notices.length - 1} more
        </span>
      )}
    </div>
  )
}
