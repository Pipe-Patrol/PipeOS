import { GamepadGuide } from '@/components/live/GamepadGuide'

/**
 * The pad diagram, alone.
 *
 * What pressing the right stick opens. Deliberately NOT the shortcut sheet
 * with the Controller tab selected: an operator who has just pressed a button
 * on the pad is holding the pad, and putting a keyboard list one tab away from
 * what they asked for is offering them the one thing they cannot use.
 *
 * No tabs, no heading, no keyboard rows. Press anything to close.
 */
export function GamepadGuideOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink-1000/70 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        className="panel w-[min(560px,90vw)] rounded-lg p-5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <GamepadGuide />
      </div>
    </div>
  )
}
