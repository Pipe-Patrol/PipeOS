/**
 * Every shortcut, keyboard and gamepad, declared once.
 *
 * The overlay that `?` opens is generated from this list, so a shortcut cannot
 * exist without being documented — the usual failure being a key that works and
 * is written down nowhere.
 *
 * The pad is documented in its own group rather than beside the equivalent key.
 * An operator is holding one or the other, not both, and interleaving them made
 * a list you had to filter in your head while driving.
 */

export interface Shortcut {
  keys: string
  action: string
  /** Grouped in the overlay. Driving first, because that is what is urgent. */
  group: 'Driving' | 'Capture' | 'View' | 'Gamepad' | 'Demo day'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'W / ↑', action: 'Drive forward', group: 'Driving' },
  { keys: 'S / ↓', action: 'Drive back', group: 'Driving' },
  { keys: 'Shift', action: 'Lock the throttle · Shift again to release', group: 'Driving' },

  { keys: 'C', action: 'Take a snapshot', group: 'Capture' },
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

  // Logitech F310 in XInput mode. The triggers are deliberately unmapped: they
  // are the two controls a thumb finds by accident.
  { keys: 'Stick / D-pad ↑↓', action: 'Drive', group: 'Gamepad' },
  { keys: 'A', action: 'Take a snapshot', group: 'Gamepad' },
  { keys: 'B', action: 'Flag what the model is surest about', group: 'Gamepad' },
  { keys: 'X', action: 'Lights', group: 'Gamepad' },
  { keys: 'Y', action: 'Start or stop recording', group: 'Gamepad' },
  { keys: 'LB / RB', action: 'Zoom out · in', group: 'Gamepad' },
  { keys: 'D-pad ← →', action: 'Camera brightness', group: 'Gamepad' },
  { keys: 'Back', action: 'Reset zoom and brightness', group: 'Gamepad' },
  { keys: 'Start (hold)', action: 'Return home · held, not tapped', group: 'Gamepad' },

  { keys: 'D D', action: 'Demo day mode on or off', group: 'Demo day' },
  { keys: '← →', action: 'Switch footage, in demo day mode', group: 'Demo day' },
]

export const SHORTCUT_GROUPS = [
  'Driving',
  'Capture',
  'View',
  'Gamepad',
  'Demo day',
] as const
