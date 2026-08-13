import { useState } from 'react'

import { GamepadGuide } from '@/components/live/GamepadGuide'
import { ShortcutList } from '@/components/live/ShortcutList'

/**
 * The `?` sheet, over the video. Two tabs: keys, and the pad.
 *
 * Reachable only by key. There is no button for it in the tool palette — the
 * palette is for things that act on the robot, and a help sheet is not one of
 * them. The same two lists sit in Settings for anyone who has not learnt `?`.
 *
 * The pad is a tab rather than a section further down the same sheet because an
 * operator is holding one or the other. Scrolling past twenty keyboard rows to
 * find out what circle does is the exact lookup this is meant to be quicker
 * than.
 */
type Tab = 'keys' | 'controller'

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('keys')

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink-1000/70 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        className="panel w-[min(560px,90vw)] rounded-lg p-5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          {/* Fixed, not switched with the tab: the tab already says which
              half you are looking at, and having both say "Controller" read as
              a bug. */}
          <h2 className="display text-[15px]">Shortcuts</h2>
          <div className="flex gap-1">
            <Tab active={tab === 'keys'} onClick={() => setTab('keys')}>
              Keyboard
            </Tab>
            <Tab active={tab === 'controller'} onClick={() => setTab('controller')}>
              Controller
            </Tab>
          </div>
        </div>

        {tab === 'keys' ? <ShortcutList /> : <GamepadGuide />}
      </div>
    </div>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'bg-white/12 text-ink-0'
          : 'text-ink-400 hover:bg-white/8 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  )
}
