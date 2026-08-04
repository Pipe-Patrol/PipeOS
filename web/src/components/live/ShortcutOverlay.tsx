import { SHORTCUT_GROUPS, SHORTCUTS } from '@/input/shortcuts'

/**
 * The `?` list, generated from the shortcut table.
 *
 * Generated rather than written out so a shortcut cannot exist without being
 * documented — the usual failure being a key that works and appears nowhere.
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

        <div className="grid gap-5 sm:grid-cols-3">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3 className="label mb-2">{group}</h3>
              <dl className="flex flex-col gap-1.5">
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
                  (shortcut) => (
                    <div
                      key={`${shortcut.keys}-${shortcut.action}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <dt className="rounded-sm border border-ink-800 px-1.5 py-0.5 text-[11px] text-ink-100">
                        {shortcut.keys}
                      </dt>
                      <dd className="text-right text-[12px] text-ink-400">
                        {shortcut.action}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
