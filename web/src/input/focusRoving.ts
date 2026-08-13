/**
 * Moving focus with the shoulder buttons, and pressing what is focused.
 *
 * WHY THIS EXISTS. Every control on the driving screen that is not driving —
 * the defect form, its class dropdown, the run setup panel — is a thing you
 * reach for with a pointer. An operator standing over an open manhole holding a
 * controller has neither a pointer nor a spare hand for a keyboard, and until
 * now that meant putting the pad down to file a defect, which is the moment the
 * defect is in front of the camera.
 *
 * L1 and R1 walk focus; circle presses. Nothing here invents a selection model:
 * it moves the browser's own focus, so the ring an operator sees is the same
 * `:focus-visible` ring the keyboard produces, and every control stays operable
 * by all three inputs without knowing which one is driving it.
 *
 * SCOPED TO THE TOPMOST PANEL. With a dialog open, tabbing into the video
 * behind it would be a way to press buttons an operator cannot see. The scope
 * is the innermost open dialog when there is one, and the document when there
 * is not.
 */

/**
 * What counts as reachable.
 *
 * Deliberately narrower than the browser's own tab order: no `[tabindex]` on
 * arbitrary containers, because the layout uses those for scroll regions and
 * landing focus on one looks to the operator like the focus ring vanished.
 */
const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[role="button"]:not([aria-disabled="true"])',
].join(',')

/** The dialog that owns the screen, or the document. */
function scope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]')
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : document
}

function candidates(): HTMLElement[] {
  return [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.tabIndex !== -1 &&
      // offsetParent is null for anything display:none or inside it. Cheaper
      // than getComputedStyle per element, and this runs on a button press.
      (element.offsetParent !== null || element === document.activeElement),
  )
}

/**
 * Move focus by one, wrapping.
 *
 * Wrapping rather than stopping at the ends because there is no way to see you
 * have reached one: with a pointer the list is visible, with the pad it is a
 * button that has quietly stopped responding.
 */
export function moveFocus(step: 1 | -1): void {
  const items = candidates()
  if (items.length === 0) return

  const active = document.activeElement as HTMLElement | null
  const index = active ? items.indexOf(active) : -1
  const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : index + step

  items[(next + items.length) % items.length]?.focus()
}

/**
 * Press whatever is focused. Returns false when there was nothing to press.
 *
 * The caller uses that to decide what circle meant: with a panel open it is a
 * click, and on the bare driving screen it falls back to flagging a detection.
 */
export function activateFocused(): boolean {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return false
  if (!scope().contains(active)) return false

  // A select cannot be opened programmatically — no browser exposes that — so
  // the shoulder buttons step its value instead. Reported as handled either
  // way, so circle never falls through to flagging while a dropdown has focus.
  if (active instanceof HTMLSelectElement) return true

  active.click()
  return true
}

/**
 * Step a focused dropdown's value, so L1/R1 change the selection rather than
 * skipping past the control.
 *
 * Returns false when focus is not on a select, which is the caller's signal to
 * move focus instead.
 */
export function stepSelect(step: 1 | -1): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLSelectElement)) return false

  const count = active.options.length
  if (count === 0) return true

  active.selectedIndex = (active.selectedIndex + step + count) % count
  // Assigning selectedIndex fires nothing, and React's onChange is a delegated
  // 'change' listener — so without this the value moves on screen and the
  // component holding it never hears.
  active.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

/** True when a panel is open, so circle should click rather than flag. */
export function panelHasFocus(): boolean {
  return scope() !== document
}
