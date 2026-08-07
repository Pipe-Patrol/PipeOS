import { useEffect, useRef, type ReactNode } from 'react'

import { CloseIcon } from '@/components/primitives/icons'

interface PopoverProps {
  title: string
  onClose: () => void
  /**
   * False while the panel has handed the screen to something else — drawing a
   * defect box, say, where every pointer-down lands on the video and would
   * otherwise read as "clicked away", closing the panel and discarding a
   * half-filled form. Defaults to the usual click-away behaviour.
   */
  dismissible?: boolean
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
export function Popover({
  title,
  onClose,
  dismissible = true,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!dismissible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      // The rail is chrome, not "away". It runs its own toggle on click, and
      // closing here first would make a second press on the open tool read as a
      // fresh open — the panel would never shut.
      if (target instanceof Element && target.closest('[data-panel-rail]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose, dismissible])

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
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="overflow-y-auto p-3">{children}</div>
    </div>
  )
}
