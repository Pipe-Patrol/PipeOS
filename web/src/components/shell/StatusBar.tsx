import { BatteryIcon } from '@/components/primitives/BatteryIcon'
import { SignalBars, strengthFromQuality } from '@/components/primitives/SignalBars'
import { StatusBarCell } from '@/components/shell/StatusBarCell'
import { RUN_STATE_PRESENTATION, runStateOf } from '@/constants/run-state'
import * as format from '@/lib/format'
import { useRobot } from '@/robot/RobotProvider'

const LABEL = 'text-[10px] leading-[12px] font-medium text-ink-400'
const VALUE = 'tnum text-[14px] leading-[16px] font-semibold'

/**
 * The one line that is always on screen.
 *
 * The bar's own background carries the run state, which means the single
 * largest coloured surface in the interface is also the most important thing to
 * know. It stays a neutral grey while nothing is wrong, so when it does go
 * amber or red it is unmissable rather than one more coloured element among
 * many.
 */
export function StatusBar() {
  const { telemetry, link, health } = useRobot()

  const presentation = RUN_STATE_PRESENTATION[runStateOf(telemetry)]
  const runName = telemetry?.run.name ?? null

  return (
    <header
      className={`flex h-12 shrink-0 items-stretch justify-between transition-colors duration-300 ${presentation.surface}`}
    >
      <div className="flex min-w-0 items-center gap-3 pl-5">
        <span
          className={`size-2 shrink-0 rounded-full ${presentation.dot} ${
            presentation.pulse ? 'animate-dot-pulse' : ''
          }`}
        />
        <span className="text-[13px] font-semibold text-ink-0">
          {presentation.label}
        </span>

        <span className="h-4 w-px bg-ink-0/20" />

        <span className="truncate text-[13px] font-medium text-ink-100">
          {runName ?? 'No run started'}
        </span>

        {health?.hostname && (
          <>
            <span className="h-4 w-px bg-ink-0/20" />
            <span className="truncate text-[12px] text-ink-300">{health.hostname}</span>
          </>
        )}
      </div>

      <div className="flex items-stretch">
        <StatusBarCell first>
          <div className={LABEL}>Battery</div>
          <div className="flex items-center gap-2">
            {/* No voltage sensor is wired, so this is a blank by design. */}
            <BatteryIcon percent={null} className="h-[12px] w-[24px]" />
            <span className={`${VALUE} text-ink-500`}>{format.BLANK}</span>
          </div>
        </StatusBarCell>

        <StatusBarCell>
          <div className={LABEL}>Link</div>
          <div className="flex items-center gap-2">
            <SignalBars
              strength={strengthFromQuality(telemetry?.host.wifi?.quality_pct)}
              state={link.state}
            />
            <span className="tnum text-[12px] font-medium text-ink-300">
              {link.latencyMs === null ? format.BLANK : `${link.latencyMs} ms`}
            </span>
          </div>
        </StatusBarCell>

        <StatusBarCell>
          <div className={LABEL}>CPU temp</div>
          <div className={`${VALUE} text-ink-100`}>
            {format.celsius(telemetry?.host.cpu_temp_c ?? null)}
          </div>
        </StatusBarCell>

        <StatusBarCell>
          <div className={LABEL}>Free</div>
          <div className={`${VALUE} text-ink-100`}>
            <Bytes value={telemetry?.host.storage?.free_bytes ?? null} />
          </div>
        </StatusBarCell>

        <StatusBarCell>
          <div className={LABEL}>Elapsed</div>
          <div className={`${VALUE} text-ink-0`}>
            {/* Both ends of this subtraction come from the robot's clock, so a
                laptop whose clock is off does not skew the run timer. */}
            {telemetry?.run.active
              ? format.duration(telemetry.at - (telemetry.run.started_at ?? telemetry.at))
              : format.BLANK}
          </div>
        </StatusBarCell>
      </div>
    </header>
  )
}

/** A byte size with the unit set smaller than the number. */
function Bytes({ value }: { value: number | null | undefined }) {
  const text = format.bytes(value)
  const split = text.lastIndexOf(' ')
  if (split === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, split)}
      <span className="ml-0.5 text-[9px] font-medium text-ink-400">
        {text.slice(split + 1)}
      </span>
    </>
  )
}
