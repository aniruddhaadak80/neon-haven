import { WANTED, POLICE } from '../config'

/** Tracks crime points and derives the 0-5 wanted level. */
export class WantedSystem {
  points = 0
  level = 0
  /** Seconds since the player was last seen by police. */
  outOfSight = 0
  /** True while any police car is close enough to see the player. */
  seen = false
  /** Flash the HUD stars when the level changes. */
  justChanged = false

  reset() {
    this.points = 0
    this.level = 0
    this.outOfSight = 0
    this.seen = false
    this.justChanged = false
  }

  addCrime(points: number) {
    this.points += points
    this.recompute()
  }

  private recompute() {
    let level = 0
    for (let i = 0; i < WANTED.THRESHOLDS.length; i++) {
      if (this.points >= WANTED.THRESHOLDS[i]!) level = i
    }
    if (level !== this.level) {
      this.level = level
      this.justChanged = true
    }
  }

  /**
   * @param dt seconds
   * @param policeNear true if any police car is within sight range
   */
  update(dt: number, policeNear: boolean) {
    this.justChanged = false
    this.seen = policeNear

    if (this.level === 0) {
      this.points = Math.max(0, this.points - WANTED.DECAY * dt)
      return
    }

    if (policeNear) {
      this.outOfSight = 0
    } else {
      this.outOfSight += dt
      // Drop one star after enough time out of sight.
      if (this.outOfSight > POLICE.DROP_TIME) {
        this.outOfSight = 0
        const prevLevel = this.level
        this.points = WANTED.THRESHOLDS[Math.max(0, this.level - 1)]! - 1
        this.recompute()
        if (this.level < prevLevel) this.justChanged = true
      }
    }

    // Slow passive decay.
    this.points = Math.max(0, this.points - WANTED.DECAY * dt * 0.3)
    this.recompute()
  }
}
