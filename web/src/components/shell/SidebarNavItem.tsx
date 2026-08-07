import { NavLink } from 'react-router-dom'
import type { ReactElement } from 'react'

interface SidebarNavItemProps {
  to: string
  label: string
  icon: (props: { size?: number; className?: string }) => ReactElement
}

/**
 * One rail item: glyph over label.
 *
 * The label is there on purpose. An icon-only rail saves twenty pixels and
 * costs a moment of hesitation every time someone new sits down in the van,
 * which is the wrong trade for a tool used at 2 am.
 *
 * The active item is a filled block rather than an accent stripe — in a
 * greyscale palette a filled surface is the strongest available signal, and it
 * survives glare that a 2 px rule does not.
 */
export function SidebarNavItem({ to, label, icon: Icon }: SidebarNavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex h-[58px] w-full flex-col items-center justify-center gap-[5px] rounded-sm transition-colors duration-100 ${
          isActive
            ? 'bg-ink-800 text-ink-0'
            : 'text-ink-500 hover:bg-ink-900 hover:text-ink-200'
        }`
      }
    >
      <Icon size={21} />
      <span className="text-[10.5px] font-medium">{label}</span>
    </NavLink>
  )
}
