import { describe, it, expect } from 'vitest'
import { DriftScorer } from '../systems/Drift'
import { DRIFT } from '../config'

describe('DriftScorer', () => {
  it('does not score below the speed threshold', () => {
    const d = new DriftScorer()
    expect(d.update(0.5, true, DRIFT.MIN_SPEED - 1)).toBeNull()
    expect(d.active).toBe(false)
    expect(d.combo).toBe(0)
  })

  it('does not score without lateral slip', () => {
    const d = new DriftScorer()
    expect(d.update(0.5, false, 120)).toBeNull()
    expect(d.active).toBe(false)
  })

  it('accumulates combo while slipping at speed, then banks on end', () => {
    const d = new DriftScorer()
    for (let i = 0; i < 60; i++) {
      expect(d.update(1 / 60, true, 80)).toBeNull()
    }
    expect(d.active).toBe(true)
    expect(d.display).toBeGreaterThan(0)
    // One more frame with slip gone → bank.
    const bank = d.update(1 / 60, false, 80)
    expect(bank).not.toBeNull()
    expect(bank!.score).toBeGreaterThanOrEqual(Math.floor(60 * DRIFT.PER_SEC / 60))
    expect(bank!.seconds).toBeCloseTo(1, 1)
    expect(d.active).toBe(false)
    expect(d.combo).toBe(0)
    expect(d.display).toBe(0)
    expect(d.best).toBe(bank!.score)
    expect(d.total).toBe(bank!.score)
  })

  it('drops combos below the minimum payout', () => {
    const d = new DriftScorer()
    // ~0.2s of drift → under MIN_SCORE.
    d.update(0.2, true, 80)
    expect(d.update(0, false, 0)).toBeNull()
    expect(d.best).toBe(0)
    expect(d.total).toBe(0)
  })

  it('banks via end() without a trailing frame', () => {
    const d = new DriftScorer()
    for (let i = 0; i < 300; i++) d.update(1 / 60, true, 90)
    const bank = d.end()
    expect(bank).not.toBeNull()
    expect(d.active).toBe(false)
    expect(d.end()).toBeNull()
  })

  it('speed sign never matters', () => {
    const d = new DriftScorer()
    expect(d.update(1, true, -80)).toBeNull()
    expect(d.active).toBe(true)
  })

  it('restarting a drift resets combo, not history', () => {
    const d = new DriftScorer()
    for (let i = 0; i < 600; i++) d.update(1 / 60, true, 80)
    const first = d.end()
    expect(first).not.toBeNull()
    d.update(1 / 60, true, 80)
    expect(d.combo).toBeLessThan(DRIFT.PER_SEC / 30)
    expect(d.total).toBeGreaterThanOrEqual(first!.score)
  })
})
