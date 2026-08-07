import { ShortcutList } from '@/components/live/ShortcutList'

/**
 * The `?` list, over the video.
 *
 * Reachable only by key. There is no button for it in the tool palette — the
 * palette is for things that act on the robot, and a help sheet is not one of
 * them. The same list sits in Settings for anyone who has not learnt `?` yet.
 */
export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink-1000/70 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        className="panel w-[min(560px,90vw)] rounded-lg p-5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="display mb-4 text-[15px]">Shortcuts</h2>
        <ShortcutList />
      </div>
    </div>
  )
}
