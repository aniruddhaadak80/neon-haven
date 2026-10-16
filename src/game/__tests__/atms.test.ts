import { describe, it, expect } from 'vitest'
import { AtmSystem } from '../systems/Atm'
import { ATM } from '../config'
import { makeRng } from '../utils'

const SPOTS = [
  { x: 0, z: 0 },
  { x: 50, z: 50 },
  { x: -30, z: 20 },
]

describe('AtmSystem', () => {
  it('finds the nearest spot within range', () => {
    const a = new AtmSystem(SPOTS)
    expect(a.nearest(1, 1, ATM.RANGE)).toBe(0)
    expect(a.nearest(51, 49, ATM.RANGE)).toBe(1)
    expect(a.nearest(-29, 21, ATM.RANGE)).toBe(2)
  })

  it('returns -1 when nothing is in range', () => {
    const a = new AtmSystem(SPOTS)
    expect(a.nearest(25, 0, ATM.RANGE)).toBe(-1)
    expect(a.nearest(1000, 1000, ATM.RANGE)).toBe(-1)
  })

  it('pays within the configured bounds', () => {
    const a = new AtmSystem(SPOTS)
    const rng = makeRng(7)
    for (let i = 0; i < 200; i++) {
      // Bypass cooldown between rolls so we measure the payout, not the gate.
      const cash = a.rob(0, 0, rng)
      if (cash !== null) {
        expect(cash).toBeGreaterThanOrEqual(ATM.MIN_CASH)
        expect(cash).toBeLessThanOrEqual(ATM.MAX_CASH)
        expect(Number.isInteger(cash)).toBe(true)
      }
      a.spots[0]!.readyAt = 0 // reset cooldown for the next sample
    }
  })

  it('locks a spot after a robbery until the cooldown passes', () => {
    const a = new AtmSystem(SPOTS)
    const now = 1000
    expect(a.rob(1, now, Math.random)).not.toBeNull()
    expect(a.isReady(1, now + 1)).toBe(false)
    expect(a.rob(1, now + 1, Math.random)).toBeNull()
    expect(a.isReady(1, now + ATM.COOLDOWN)).toBe(true)
    expect(a.rob(1, now + ATM.COOLDOWN, Math.random)).not.toBeNull()
  })

  it('rejects invalid indices everywhere', () => {
    const a = new AtmSystem(SPOTS)
    expect(a.isReady(-1, 0)).toBe(false)
    expect(a.isReady(99, 0)).toBe(false)
    expect(a.rob(-1, 0, Math.random)).toBeNull()
    expect(a.rob(99, 0, Math.random)).toBeNull()
    expect(a.nearest(0, 0, 0.1)).toBe(0) // exact hit still counts
  })

  it('counts ready spots', () => {
    const a = new AtmSystem(SPOTS)
    expect(a.readyCount(0)).toBe(3)
    a.rob(0, 0, Math.random)
    a.rob(2, 0, Math.random)
    expect(a.readyCount(0)).toBe(1)
    expect(a.readyCount(ATM.COOLDOWN + 1)).toBe(3)
  })

  it('starts with every spot ready', () => {
    const a = new AtmSystem(SPOTS)
    expect(a.spots.every((s) => s.readyAt === 0)).toBe(true)
  })
})
