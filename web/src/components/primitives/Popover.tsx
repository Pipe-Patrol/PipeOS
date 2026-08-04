import { useEffect, useRef, type ReactNode } from 'react'

interface PopoverProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * A panel hung off the sidebar.
 *
 * Every panel is one width so they read as one system — no panel is more or less
 * important than another by size alone. Fixed rather than absolute so it escapes
 * the sidebar's narrow column, and deliberately not a modal: it does not trap
 * focus and it does not cover the video.
 */
export function Popover({ title, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="panel fixed top-1/2 right-[84px] z-30 flex max-h-[calc(100dvh_-_2rem)] w-72 -translate-y-1/2 flex-col overflow-hidden"
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="display text-[13px]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 text-ink-500 hover:bg-white/10 hover:text-ink-100"
          aria-label="Close"
        >
          <svg
            viewBox="0 0 24 24"
            width={14}
            height={14}
            stroke="currentColor"
            fill="none"
            strokeWidth={2}
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="overflow-y-auto p-3">{children}</div>
    </div>
  )
}
