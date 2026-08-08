import {
  LiveIcon,
  PipeMark,
  RunsIcon,
  SettingsIcon,
} from '@/components/primitives/icons'
import { SidebarNavItem } from '@/components/shell/SidebarNavItem'
import { useDemoMode } from '@/lib/demoMode'

const NAV_ITEMS = [
  { to: '/live', label: 'Live', icon: LiveIcon },
  { to: '/runs', label: 'Runs', icon: RunsIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

/**
 * The left rail.
 *
 * Deliberately narrow. Every pixel it takes is a pixel off the video, and the
 * video is the thing the operator is actually doing the job through.
 */
export function SidebarNav() {
  const { enabled: demo } = useDemoMode()

  return (
    <nav className="flex w-[76px] shrink-0 flex-col border-r border-ink-800 bg-ink-950">
      <div className="flex h-14 items-center justify-center border-b border-ink-800">
        <PipeMark size={22} className="text-ink-200" />
      </div>

      <div className="flex flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem key={item.to} {...item} />
        ))}
      </div>

      {/* The one visible difference demo mode makes to the console. It has to
          be here, because a screen showing recorded footage that looks exactly
          like a screen showing a live camera is the one way this feature could
          mislead somebody. */}
      {demo && (
        <div className="mt-auto flex justify-center pb-3">
          <span
            title="Demo day mode — the feed is recorded footage. Press D twice to leave."
            className="flex size-8 items-center justify-center rounded-sm border border-state-recording-signal/25 bg-state-recording-signal/15 text-[15px] font-bold text-state-recording-signal"
          >
            D
          </span>
        </div>
      )}
    </nav>
  )
}
