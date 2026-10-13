import { describe, it, expect, beforeEach } from 'vitest'
import { WantedSystem } from '../systems/Wanted'
import { WANTED, POLICE } from '../config'

describe('WantedSystem', () => {
  let w: WantedSystem
  beforeEach(() => {
    w = new WantedSystem()
  })

  it('starts clean', () => {
    expect(w.level).toBe(0)
    expect(w.points).toBe(0)
    expect(w.seen).toBe(false)
  })

  it('crosses star thresholds cumulatively', () => {
    w.addCrime(WANTED.THRESHOLDS[1]! - 1)
    expect(w.level).toBe(0)
    w.addCrime(1)
    expect(w.level).toBe(1)
    expect(w.justChanged).toBe(true)
    w.addCrime(WANTED.THRESHOLDS[3]!)
    expect(w.level).toBeGreaterThanOrEqual(3)
  })

  it('decays points at level 0', () => {
    w.addCrime(50)
    w.update(10, false)
    expect(w.points).toBeLessThan(50)
    expect(w.level).toBe(0)
  })

  it('drops one star after DROP_TIME out of sight', () => {
    w.addCrime(WANTED.THRESHOLDS[2]! + 10)
    expect(w.level).toBe(2)
    w.update(POLICE.DROP_TIME + 1, false)
    expect(w.level).toBe(1)
    expect(w.justChanged).toBe(true)
  })

  it('holds heat while police are near', () => {
    w.addCrime(WANTED.THRESHOLDS[2]! + 50)
    w.update(5, true)
    expect(w.level).toBe(2)
    expect(w.outOfSight).toBe(0)
  })

  it('coolDown scrubs points and recomputes level', () => {
    w.addCrime(WANTED.THRESHOLDS[2]!)
    expect(w.level).toBe(2)
    w.coolDown(WANTED.BRIBE_RELIEF)
    expect(w.level).toBeLessThan(2)
    w.coolDown(99999)
    expect(w.points).toBe(0)
    expect(w.level).toBe(0)
  })

  it('reset clears everything', () => {
    w.addCrime(9999)
    w.update(1, true)
    w.reset()
    expect(w.level).toBe(0)
    expect(w.points).toBe(0)
    expect(w.outOfSight).toBe(0)
    expect(w.seen).toBe(false)
  })

  it('justChanged is only true on the frame of change', () => {
    w.addCrime(WANTED.THRESHOLDS[1]! + 50)
    expect(w.justChanged).toBe(true)
    w.update(0.016, true) // no change this frame
    expect(w.justChanged).toBe(false)
  })
})
