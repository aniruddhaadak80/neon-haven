import { DRIFT } from '../config'

export interface DriftBank {
  score: number
  seconds: number
}

/**
 * Pure drift-combo scorer. Feed it once per frame while driving; when the
 * drift ends (slip or speed drops below threshold) it returns a banked
 * payout, or null if the combo was too small to count.
 */
export class DriftScorer {
  /** Current combo points (float, grows while drifting). */
  combo = 0
  /** Seconds spent in the current drift. */
  seconds = 0
  /** True while a drift is in progress. */
  active = false
  /** Best single banked combo ever. */
  best = 0
  /** Lifetime banked points. */
  total = 0

  /**
   * @param dt seconds since last frame
   * @param slipping whether the car is sliding laterally right now
   * @param speedKmh absolute speed in km/h
   * @returns a banked payout when a drift ends, otherwise null
   */
  update(dt: number, slipping: boolean, speedKmh: number): DriftBank | null {
    if (slipping && Math.abs(speedKmh) >= DRIFT.MIN_SPEED) {
      if (!this.active) {
        this.active = true
        this.seconds = 0
        this.combo = 0
      }
      this.seconds += dt
      this.combo += DRIFT.PER_SEC * dt
      return null
    }
    if (!this.active) return null
    // Drift ended → bank it.
    this.active = false
    const bank: DriftBank = { score: Math.floor(this.combo), seconds: this.seconds }
    this.combo = 0
    this.seconds = 0
    if (bank.score < DRIFT.MIN_SCORE) return null
    this.best = Math.max(this.best, bank.score)
    this.total += bank.score
    return bank
  }

  /** Combo to display right now (0 when nothing to show). */
  get display(): number {
    if (!this.active) return 0
    return Math.floor(this.combo)
  }

  /** Force-bank the current drift (exiting a car, death, pause). */
  end(): DriftBank | null {
    if (!this.active) return null
    // Reuse the normal banking path by marking the drift as over.
    return this.update(0, false, 0)
  }
}
