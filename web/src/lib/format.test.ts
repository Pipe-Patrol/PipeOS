import { describe, expect, it } from 'vitest'

import * as format from '@/lib/format'

/**
 * The rule these tests exist to protect: a missing reading is never a zero.
 *
 * One careless `?? 0` anywhere in this file turns "no sensor fitted" into
 * "0.0 m" on screen, and a crew standing over an open manhole would believe it.
 */
describe('missing values', () => {
  const formatters = [
    'metres',
    'speed',
    'degrees',
    'temperature',
    'percent',
    'milliseconds',
    'acceleration',
    'duration',
    'bytes',
    'timestamp',
    'relativeTime',
  ] as const

  it.each(formatters)('%s renders null as a blank, not a zero', (name) => {
    const fn = format[name] as (value: unknown) => string
    expect(fn(null)).toBe(format.BLANK)
    expect(fn(undefined)).toBe(format.BLANK)
  })

  it.each(formatters)('%s renders NaN as a blank', (name) => {
    const fn = format[name] as (value: unknown) => string
    expect(fn(Number.NaN)).toBe(format.BLANK)
  })

  it('distinguishes a real zero from a missing one', () => {
    expect(format.metres(0)).toBe('0.0 m')
    expect(format.metres(null)).toBe(format.BLANK)
  })
})

describe('degrees', () => {
  it('has no signed zero, which reads as a fault in a column of readings', () => {
    expect(format.degrees(-0.4)).toBe('0°')
    expect(format.degrees(0)).toBe('0°')
  })

  it('keeps the sign on a reading that has one', () => {
    expect(format.degrees(-12.4)).toBe('-12°')
    expect(format.degrees(92)).toBe('92°')
  })
})

describe('duration', () => {
  it('reads as a clock', () => {
    expect(format.duration(0)).toBe('0:00')
    expect(format.duration(9)).toBe('0:09')
    expect(format.duration(247)).toBe('4:07')
  })

  it('grows an hours field only when needed', () => {
    expect(format.duration(3847)).toBe('1:04:07')
  })

  it('rejects a negative, which is a bug upstream not a time', () => {
    expect(format.duration(-5)).toBe(format.BLANK)
  })
})

describe('bytes', () => {
  it('scales to a readable unit', () => {
    expect(format.bytes(512)).toBe('512 B')
    expect(format.bytes(2048)).toBe('2.0 KB')
    expect(format.bytes(5 * 1024 ** 3)).toBe('5.0 GB')
  })
})

describe('temperature', () => {
  it('shows the value it was given when the scale is Celsius', () => {
    expect(format.temperature(21.4)).toBe('21°C')
    expect(format.temperature(21.4, 'C')).toBe('21°C')
  })

  it('converts to Fahrenheit for display', () => {
    expect(format.temperature(0, 'F')).toBe('32°F')
    expect(format.temperature(100, 'F')).toBe('212°F')
    expect(format.temperature(21.4, 'F')).toBe('71°F')
  })

  it('converts below freezing, where dropping the sign would be a lie', () => {
    expect(format.temperature(-40, 'F')).toBe('-40°F')
    expect(format.temperature(-12.3, 'C')).toBe('-12°C')
  })

  it('always names the scale, so no reading is ambiguous', () => {
    expect(format.temperature(20, 'C')).toContain('C')
    expect(format.temperature(20, 'F')).toContain('F')
  })

  it('stays blank in either scale when there is no reading', () => {
    expect(format.temperature(null, 'F')).toBe(format.BLANK)
    expect(format.temperature(Number.NaN, 'F')).toBe(format.BLANK)
  })
})

describe('speed', () => {
  it('reports cm/s, which is the scale this robot moves at', () => {
    expect(format.speed(0.203)).toBe('20 cm/s')
    expect(format.speed(-0.1)).toBe('-10 cm/s')
  })
})
