import { GRENADE } from '../config'

export interface GrenadeState {
  id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  fuse: number
  bounces: number
}

export interface BlastSite {
  id: number
  x: number
  y: number
  z: number
}

let nextId = 1

/**
 * Pure projectile sim: gravity arc, ground bounces, fuse countdown.
 * Rendering and damage are the caller's job.
 */
export class GrenadeSystem {
  list: GrenadeState[] = []

  /**
   * @param pitch launch angle (rad, 0 = flat, positive = up)
   * @returns grenade id, or null when at capacity
   */
  spawn(x: number, y: number, z: number, dirX: number, dirZ: number, pitch: number): number | null {
    if (this.list.length >= GRENADE.MAX) return null
    const len = Math.hypot(dirX, dirZ) || 1
    const cosP = Math.cos(pitch)
    const g: GrenadeState = {
      id: nextId++,
      x,
      y,
      z,
      vx: (dirX / len) * GRENADE.FORCE * cosP,
      vy: GRENADE.FORCE * Math.sin(pitch) + 3,
      vz: (dirZ / len) * GRENADE.FORCE * cosP,
      fuse: GRENADE.FUSE,
      bounces: 0,
    }
    this.list.push(g)
    return g.id
  }

  /** Integrate all grenades; returns the sites of any that detonated. */
  update(dt: number): BlastSite[] {
    const blasts: BlastSite[] = []
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i]!
      g.vy -= GRENADE.GRAVITY * dt
      g.x += g.vx * dt
      g.y += g.vy * dt
      g.z += g.vz * dt

      if (g.y <= 0) {
        g.y = 0
        if (Math.abs(g.vy) > 1.5) {
          g.vy = -g.vy * GRENADE.BOUNCE
          g.vx *= 0.65
          g.vz *= 0.65
          g.bounces++
        } else {
          g.vy = 0
          g.vx *= 0.85
          g.vz *= 0.85
        }
      }

      g.fuse -= dt
      if (g.fuse <= 0) {
        blasts.push({ id: g.id, x: g.x, y: g.y, z: g.z })
        this.list.splice(i, 1)
      }
    }
    return blasts
  }

  /** Drop everything without exploding (death, reset). */
  clear() {
    this.list = []
  }
}

/** Linear blast falloff: 1 at the epicenter, 0 at/beyond the edge. */
export function blastFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0
  if (distance <= 0) return 1
  return 1 - distance / radius
}
