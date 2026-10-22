import { describe, it, expect } from 'vitest'
import { POLICE } from '../config'
import { policeShotDamage } from '../systems/police-fire'

/**
 * Total damage a single cruiser deals over `seconds`, at a given frame
 * rate. The random draw is a deterministic ramp so the shot count is
 * exact rather than statistical.
 */
function damageOver(seconds: number, fps: number): number {
  const dt = 1 / fps
  const frames = seconds * fps
  let i = 0
  const rng = () => (i++) / frames
  let damage = 0
  for (let f = 0; f < frames; f++) damage += policeShotDamage(dt, rng)
  return damage
}

describe('policeShotDamage', () => {
  it('does the same total damage at any frame rate', () => {
    const at30 = damageOver(10, 30)
    const at60 = damageOver(10, 60)
    const at144 = damageOver(10, 144)

    expect(at30).toBe(at60)
    expect(at144).toBe(at60)
  })

  it('deals one bullet per POLICE.SHOOT_COOLDOWN seconds', () => {
    // The ramp above fires on the first frame of every cooldown window, so
    // ten seconds of fire is the number of whole windows that fit in it.
    const windows = Math.ceil(10 / POLICE.SHOOT_COOLDOWN)
    expect(damageOver(10, 60)).toBe(windows * POLICE.SHOOT_DAMAGE)
    // ...and that is one bullet roughly every 0.9 s, not a handful a second.
    expect(damageOver(10, 60) / 10).toBeGreaterThan(POLICE.SHOOT_DAMAGE)
  })

  it('deals nothing when no frame has elapsed', () => {
    expect(policeShotDamage(0, () => 0)).toBe(0)
  })
})
