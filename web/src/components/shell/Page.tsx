import type { ReactNode } from 'react'

/** A scrollable content pane with a title row. Sits inside AppShell. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="h-full overflow-y-auto rounded-lg bg-white/2">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <header className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-4">
          <h1 className="display truncate text-[19px]">{title}</h1>
          {actions}
        </header>
        <div className="flex flex-col gap-6">{children}</div>
      </div>
    </div>
  )
}
