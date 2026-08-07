import { SHORTCUT_GROUPS, SHORTCUTS } from '@/input/shortcuts'

/**
 * The shortcut table, rendered.
 *
 * Generated from the table rather than written out so a shortcut cannot exist
 * without being documented — the usual failure being a key that works and
 * appears nowhere.
 *
 * Split out from the `?` overlay because the same list is also the reference
 * copy in Settings, and two hand-kept copies of a key list is how one of them
 * ends up wrong.
 */
export function ShortcutList() {
  return (
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
  )
}
