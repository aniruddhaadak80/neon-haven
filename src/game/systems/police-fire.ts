import { POLICE } from '../config'

/**
 * Damage a cruiser deals on one frame.
 *
 * A cruiser fires one bullet every `POLICE.SHOOT_COOLDOWN` seconds and
 * each bullet does `POLICE.SHOOT_DAMAGE` damage. The damage is per shot,
 * never scaled by the frame time: the shot count is a rate, so scaling
 * the damage by `dt` would make the total damage per second depend on
 * the frame rate.
 */
export function policeShotDamage(dt: number, rng: () => number): number {
  return rng() < dt / POLICE.SHOOT_COOLDOWN ? POLICE.SHOOT_DAMAGE : 0
}
