import {
  LiveIcon,
  PipeMark,
  RunsIcon,
  SettingsIcon,
} from '@/components/primitives/icons'
import { SidebarNavItem } from '@/components/shell/SidebarNavItem'

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
  return (
    <nav className="flex w-[76px] shrink-0 flex-col border-r border-ink-800 bg-ink-950">
      <div className="flex h-14 items-center justify-center border-b border-ink-800">
        <PipeMark className="size-[22px] text-ink-200" />
      </div>

      <div className="flex flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
          <SidebarNavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  )
}
