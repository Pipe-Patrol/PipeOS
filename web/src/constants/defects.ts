import { DETECTION_CLASSES } from '@/constants/detection-classes'

/**
 * The observation list an operator picks from.
 *
 * This used to be a provisional set of plain-language conditions, written
 * before there was a model and deliberately not a standards code set. The model
 * has landed, so its label set replaces it — that was always the plan, and it
 * buys the thing the old list could not have: a defect an operator logs by hand
 * and a defect the model finds are the same seven things, said the same way,
 * drawn in the same colour, and countable together in a report.
 *
 * `OTHER` is the escape hatch. The model knows seven conditions and a pipe
 * contains more than seven things; without a way to file the eighth, an
 * operator either drops the observation or files it as the nearest wrong one,
 * and the second is worse than an honest "other" in an export.
 *
 * Short codes are still here because they are what fits in a table column.
 */

export interface DefectType {
  code: string
  label: string
  group: 'Structural' | 'Service' | 'Other'
  /**
   * The model class this is, or null for an observation the model has no
   * opinion about. Drives the box colour, so hand-logged and detected defects
   * of the same kind are drawn identically.
   */
  className: string | null
}

/** Which of the model's classes are damage to the pipe, versus what is in it. */
const STRUCTURAL = new Set(['crack', 'joint offset'])

const CODES: Record<string, string> = {
  crack: 'CR',
  deposition: 'DE',
  incrustation: 'EN',
  'joint offset': 'JD',
  obstruction: 'OB',
  'root intrusion': 'RO',
  'utility intrusion': 'UT',
}

export const OTHER_CODE = 'OT'

export const DEFECT_TYPES: DefectType[] = [
  ...DETECTION_CLASSES.map((type) => ({
    code: CODES[type.name] ?? type.name.slice(0, 2).toUpperCase(),
    label: type.label,
    group: (STRUCTURAL.has(type.name) ? 'Structural' : 'Service') as DefectType['group'],
    className: type.name,
  })),
  { code: OTHER_CODE, label: 'Other', group: 'Other', className: null },
]

export const DEFECT_GROUPS = ['Structural', 'Service', 'Other'] as const

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

/**
 * The model class a logged code stands for, for colouring its box.
 *
 * Falls back to the code itself so a defect recorded under the old vocabulary
 * still resolves to something rather than throwing; it will simply draw in the
 * unknown-class grey.
 */
export function defectClassName(code: string): string {
  return DEFECT_TYPES.find((type) => type.code === code)?.className ?? code
}
