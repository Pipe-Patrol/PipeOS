/**
 * The observation list an operator picks from.
 *
 * PROVISIONAL. These are the common structural and service conditions in pipe
 * inspection, in plain language with short codes. They are deliberately NOT a
 * standards code set — PACP and MSCC coding carries grading rules and continuous
 * -defect handling that only make sense once a model is producing them, and a
 * half-implemented standard code is worse than an honest plain one because it
 * looks authoritative in an export.
 *
 * When the model lands, its label set replaces this and the codes recorded
 * before then stay readable, which is the other reason for plain words.
 */

export interface DefectType {
  code: string
  label: string
  group: 'Structural' | 'Service'
}

export const DEFECT_TYPES: DefectType[] = [
  { code: 'CR', label: 'Crack', group: 'Structural' },
  { code: 'FR', label: 'Fracture', group: 'Structural' },
  { code: 'BR', label: 'Broken pipe', group: 'Structural' },
  { code: 'HO', label: 'Hole', group: 'Structural' },
  { code: 'DEF', label: 'Deformation', group: 'Structural' },
  { code: 'JD', label: 'Joint displacement', group: 'Structural' },
  { code: 'SD', label: 'Surface damage', group: 'Structural' },

  { code: 'RO', label: 'Roots', group: 'Service' },
  { code: 'DE', label: 'Deposits', group: 'Service' },
  { code: 'EN', label: 'Encrustation', group: 'Service' },
  { code: 'IN', label: 'Infiltration', group: 'Service' },
  { code: 'OB', label: 'Obstacle', group: 'Service' },
]

export const DEFECT_GROUPS = ['Structural', 'Service'] as const

/** 1 = note it, 5 = act on it. Shown as words because a bare number is not shared. */
export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor',
  2: 'Slight',
  3: 'Moderate',
  4: 'Serious',
  5: 'Critical',
}

export function defectLabel(code: string): string {
  return DEFECT_TYPES.find((type) => type.code === code)?.label ?? code
}
