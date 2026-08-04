/**
 * Every keyboard shortcut, declared once.
 *
 * The overlay that `?` opens is generated from this list, so a shortcut cannot
 * exist without being documented — the usual failure being a key that works and
 * is written down nowhere.
 */

export interface Shortcut {
  keys: string
  action: string
  /** Grouped in the overlay. Driving first, because that is what is urgent. */
  group: 'Driving' | 'Capture' | 'View'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'W / ↑', action: 'Drive forward', group: 'Driving' },
  { keys: 'S / ↓', action: 'Drive back', group: 'Driving' },

  { keys: 'C', action: 'Take a snapshot', group: 'Capture' },
  { keys: 'Gamepad A', action: 'Take a snapshot', group: 'Capture' },
  { keys: 'D', action: 'Log a defect', group: 'Capture' },
  { keys: 'R', action: 'Start or stop recording', group: 'Capture' },

  { keys: 'L', action: 'Lights', group: 'View' },
  { keys: 'M', action: 'Map', group: 'View' },
  { keys: 'G', action: 'Camera roll', group: 'View' },
  { keys: 'Scroll', action: 'Zoom the image', group: 'View' },
  { keys: '?', action: 'This list', group: 'View' },
  { keys: 'Esc', action: 'Close whatever is open', group: 'View' },
]

export const SHORTCUT_GROUPS = ['Driving', 'Capture', 'View'] as const
