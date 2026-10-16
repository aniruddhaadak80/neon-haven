import { describe, it, expect } from 'vitest'
import { FocusMeter } from '../systems/Focus'
import { FOCUS } from '../config'

describe('FocusMeter', () => {
  it('starts full and inactive', () => {
    const f = new FocusMeter()
    expect(f.value).toBe(FOCUS.MAX)
    expect(f.active).toBe(false)
  })

  it('activates and drains while held', () => {
    const f = new FocusMeter()
    expect(f.tick(0.1, true)).toBe(true)
    expect(f.active).toBe(true)
    expect(f.value).toBeLessThan(FOCUS.MAX)
    expect(f.value).toBeCloseTo(FOCUS.MAX - FOCUS.DRAIN * 0.1, 5)
  })

  it('does not start below MIN_START', () => {
    const f = new FocusMeter()
    f.value = FOCUS.MIN_START - 1
    expect(f.tick(0.1, true)).toBe(false)
    expect(f.active).toBe(false)
    // But regenerates back up instead of stalling.
    f.tick(1, false)
    expect(f.value).toBeGreaterThan(FOCUS.MIN_START - 1)
  })

  it('an active session keeps draining past MIN_START down to empty', () => {
    const f = new FocusMeter()
    f.tick(0.1, true)
    f.value = FOCUS.MIN_START - 1 // dipped below the start gate mid-session
    expect(f.tick(0.1, true)).toBe(true)
    // Grind to exhaustion.
    let guard = 0
    while (f.value > 0 && guard++ < 10000) f.tick(0.05, true)
    expect(f.value).toBe(0)
    expect(f.active).toBe(false)
    // Cannot restart empty.
    expect(f.tick(0.1, true)).toBe(false)
  })

  it('regenerates when idle and caps at MAX', () => {
    const f = new FocusMeter()
    f.value = 40
    for (let i = 0; i < 1000; i++) f.tick(0.016, false)
    expect(f.value).toBe(FOCUS.MAX)
    expect(f.active).toBe(false)
  })

  it('releasing the key turns slow-mo off immediately', () => {
    const f = new FocusMeter()
    expect(f.tick(0.1, true)).toBe(true)
    expect(f.tick(0.1, false)).toBe(false)
    expect(f.active).toBe(false)
  })

  it('reset refills the meter', () => {
    const f = new FocusMeter()
    f.tick(1, true)
    f.reset()
    expect(f.value).toBe(FOCUS.MAX)
    expect(f.active).toBe(false)
  })
})
