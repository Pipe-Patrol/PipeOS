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

  // DualSense naming. The indices are the Gamepad API's standard mapping, which
  // an Xbox pad shares — cross sits where A does — so an F310 works too, read
  // positionally. The full layout is the Controller tab of this sheet.
  //
  // L2 and R2 are deliberately unmapped: the two controls a hand finds by
  // accident.
  { keys: 'Stick / D-pad ↑↓', action: 'Drive', group: 'Gamepad' },
  { keys: 'Cross ✕', action: 'Take a snapshot', group: 'Gamepad' },
  { keys: 'Circle ○', action: 'Flag what the model is surest about', group: 'Gamepad' },
  { keys: 'Square □', action: 'Lights', group: 'Gamepad' },
  { keys: 'Triangle △', action: 'Start or stop recording', group: 'Gamepad' },
  { keys: 'L1 / R1', action: 'Zoom out · in', group: 'Gamepad' },
  { keys: 'D-pad ← →', action: 'Camera brightness', group: 'Gamepad' },
  { keys: 'Create', action: 'Reset zoom and brightness', group: 'Gamepad' },
  { keys: 'Options (hold)', action: 'Return home · held, not tapped', group: 'Gamepad' },

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
