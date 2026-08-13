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
  group: 'Driving' | 'Capture' | 'View' | 'Demo day'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'W / ↑', action: 'Drive forward', group: 'Driving' },
  { keys: 'S / ↓', action: 'Drive back', group: 'Driving' },
  { keys: 'Shift', action: 'Lock the throttle · Shift again to release', group: 'Driving' },

  { keys: 'C', action: 'Take a snapshot', group: 'Capture' },
  { keys: 'Gamepad A', action: 'Take a snapshot', group: 'Capture' },
  { keys: 'D', action: 'Log a defect', group: 'Capture' },
  { keys: 'R', action: 'Start or stop recording', group: 'Capture' },
  { keys: 'A', action: 'Auto flagging on or off', group: 'Capture' },
  { keys: 'Enter', action: 'Flag what the model is surest about', group: 'Capture' },
  { keys: 'Click a box', action: 'Flag that detection', group: 'Capture' },

  { keys: 'L', action: 'Lights', group: 'View' },
  { keys: 'M', action: 'Map', group: 'View' },
  { keys: 'G', action: 'Camera roll', group: 'View' },
  { keys: 'Scroll', action: 'Zoom the image', group: 'View' },
  { keys: '?', action: 'This list', group: 'View' },
  { keys: 'Esc', action: 'Close whatever is open', group: 'View' },

  { keys: 'D D', action: 'Demo day mode on or off', group: 'Demo day' },
  { keys: '← →', action: 'Switch footage, in demo day mode', group: 'Demo day' },
]

export const SHORTCUT_GROUPS = ['Driving', 'Capture', 'View', 'Demo day'] as const
