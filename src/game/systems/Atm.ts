import { ATM } from '../config'
import { randRange } from '../utils'

export interface AtmSpot {
  x: number
  z: number
  /** Game-clock time when this ATM can be robbed again. */
  readyAt: number
}

/**
 * ATM robbery registry: proximity lookup, per-spot cooldowns, payout roll.
 * Pure logic — the caller owns rendering and consequences (heat, toasts).
 */
export class AtmSystem {
  spots: AtmSpot[]

  constructor(spots: ReadonlyArray<{ x: number; z: number }>) {
    this.spots = spots.map((s) => ({ x: s.x, z: s.z, readyAt: 0 }))
  }

  /** Index of the closest spot within `range`, or -1. */
  nearest(x: number, z: number, range: number): number {
    let best = -1
    let bestD = range
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i]!
      const d = Math.hypot(s.x - x, s.z - z)
      if (d <= bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  isReady(index: number, now: number): boolean {
    const s = this.spots[index]
    if (!s) return false
    return now >= s.readyAt
  }

  /**
   * Rob an ATM. Returns the cash on success, or null when it's cooling down
   * or the index is invalid. `rng` is injectable for deterministic tests.
   */
  rob(index: number, now: number, rng: () => number): number | null {
    if (!this.isReady(index, now)) return null
    const s = this.spots[index]!
    const cash = Math.round(randRange(rng, ATM.MIN_CASH, ATM.MAX_CASH))
    s.readyAt = now + ATM.COOLDOWN
    return cash
  }

  readyCount(now: number): number {
    let n = 0
    for (let i = 0; i < this.spots.length; i++) if (this.isReady(i, now)) n++
    return n
  }
}
