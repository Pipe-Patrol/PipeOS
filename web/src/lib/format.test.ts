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
    'celsius',
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

describe('metresWithError', () => {
  it('carries the uncertainty', () => {
    expect(format.metresWithError(12.44, 1.13)).toBe('12.4 ±1.1 m')
  })

  it('drops an uncertainty too small to matter', () => {
    expect(format.metresWithError(12.4, 0.01)).toBe('12.4 m')
  })

  it('is blank when the value is missing, whatever the error says', () => {
    expect(format.metresWithError(null, 1.1)).toBe(format.BLANK)
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

describe('speed', () => {
  it('reports cm/s, which is the scale this robot moves at', () => {
    expect(format.speed(0.203)).toBe('20 cm/s')
    expect(format.speed(-0.1)).toBe('-10 cm/s')
  })
})
