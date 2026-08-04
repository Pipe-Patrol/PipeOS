import { useRobot } from '@/robot/RobotProvider'

/**
 * A lost link, as the topmost thing on screen.
 *
 * Above the status bar on purpose: when the robot stops answering, that fact
 * outranks everything the status bar is reporting, because everything the
 * status bar is reporting is now stale.
 */
export function ConnectionBanner() {
  const { link } = useRobot()
  if (link.state === 'connected' || link.state === 'connecting') return null

  const lost = link.state === 'down'
  return (
    <div
      role="alert"
      className={`flex h-9 shrink-0 items-center justify-center gap-3 text-[12px] font-semibold ${
        lost
          ? 'bg-state-fault-surface text-ink-0'
          : 'bg-state-warning-surface text-ink-0'
      }`}
    >
      {lost ? 'Link lost — reconnecting' : 'No telemetry'}
      <span className="font-medium opacity-70">Motors are stopped</span>
    </div>
  )
}
