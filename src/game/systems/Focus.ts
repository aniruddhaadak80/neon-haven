import { FOCUS } from '../config'

/**
 * Bullet-time meter. `tick` is called once per frame with real (unscaled)
 * dt; it returns whether the world should run at FOCUS.TIMESCALE this frame.
 */
export class FocusMeter {
  value: number = FOCUS.MAX
  active = false

  /** @returns true when bullet time applies this frame. */
  tick(dt: number, want: boolean): boolean {
    const canStart = this.active || this.value >= FOCUS.MIN_START
    if (want && canStart && this.value > 0) {
      this.active = true
      this.value = Math.max(0, this.value - FOCUS.DRAIN * dt)
      if (this.value <= 0) this.active = false
      return this.active
    }
    this.active = false
    this.value = Math.min(FOCUS.MAX, this.value + FOCUS.REGEN * dt)
    return false
  }

  reset() {
    this.value = FOCUS.MAX
    this.active = false
  }
}
