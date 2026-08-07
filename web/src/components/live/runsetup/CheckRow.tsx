import type { ReactNode } from 'react'
import {
  CheckCircle,
  CircleNotch,
  MinusCircle,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'

import { InfoHint } from '@/components/primitives/InfoHint'
import { phosphorWeight, type PhosphorIcon } from '@/components/primitives/iconStroke'
import type { Check, CheckStatus } from '@/components/live/runsetup/checks'

const ICON_SIZE = 16

const MARK: Record<
  CheckStatus,
  { icon: PhosphorIcon; tone: string; value: string; label: string }
> = {
  pass: {
    icon: CheckCircle,
    tone: 'text-state-recording-signal',
    value: 'text-ink-300',
    label: 'Pass',
  },
  warn: {
    icon: WarningCircle,
    tone: 'text-state-warning-signal',
    value: 'text-state-warning-signal',
    label: 'Warning',
  },
  fail: {
    icon: XCircle,
    tone: 'text-state-fault-signal',
    value: 'text-state-fault-signal',
    label: 'Failed',
  },
  absent: {
    icon: MinusCircle,
    tone: 'text-ink-600',
    value: 'text-ink-500',
    label: 'Not fitted',
  },
}

interface CheckRowProps {
  check: Check
  /** True while the sweep has not reached this row yet. */
  pending: boolean
  /** A control for rows that can be tested on demand, such as the motors. */
  action?: ReactNode
}

/**
 * One line of the preflight list: name on the left, one value on the right.
 *
 * The status mark carries a text label for screen readers rather than colour
 * alone, because a red dot and an amber dot are the same dot to a colourblind
 * operator, and this is the list that decides whether a robot goes in a pipe.
 */
export function CheckRow({ check, pending, action }: CheckRowProps) {
  const mark = MARK[check.status]
  const Icon = pending ? CircleNotch : mark.icon

  return (
    <li className="flex h-[30px] items-center gap-2.5">
      <span className={`shrink-0 ${pending ? 'text-ink-600' : mark.tone}`} aria-hidden>
        <Icon
          size={ICON_SIZE}
          weight={phosphorWeight(ICON_SIZE)}
          className={pending ? 'animate-spin' : undefined}
        />
      </span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">
        {check.label}
      </span>

      {check.note && <InfoHint label={`Why ${check.label.toLowerCase()} says this`}>{check.note}</InfoHint>}

      {action}

      <span
        className={`shrink-0 text-[12px] tnum ${pending ? 'text-ink-600' : mark.value}`}
      >
        {pending ? 'Checking' : check.value}
      </span>

      <span className="sr-only">{pending ? 'Checking' : mark.label}</span>
    </li>
  )
}
