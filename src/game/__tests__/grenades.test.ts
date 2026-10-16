import { describe, it, expect, beforeEach } from 'vitest'
import { GrenadeSystem, blastFalloff } from '../systems/Grenades'
import { GRENADE } from '../config'

describe('GrenadeSystem', () => {
  let g: GrenadeSystem
  beforeEach(() => { g = new GrenadeSystem() })

  it('spawns with an id and full fuse', () => {
    const id = g.spawn(0, 1, 0, 1, 0, 0)
    expect(id).not.toBeNull()
    expect(g.list).toHaveLength(1)
    expect(g.list[0]!.fuse).toBeCloseTo(GRENADE.FUSE, 5)
    expect(g.list[0]!.id).toBe(id)
  })

  it('flies forward and arcs under gravity', () => {
    g.spawn(0, 2, 0, 0, 1, 0.4)
    const start = { ...g.list[0]! }
    // After a few frames it should still be moving +z and rising/falling.
    for (let i = 0; i < 12; i++) g.update(1 / 60)
    const now = g.list[0]!
    expect(now.z).toBeGreaterThan(start.z)
    expect(now.x).toBeCloseTo(0, 5)
    expect(now.fuse).toBeLessThan(start.fuse)
  })

  it('normalizes the throw direction (diagonal throws are not faster)', () => {
    const a = new GrenadeSystem()
    a.spawn(0, 2, 0, 1, 0, 0)
    const b = new GrenadeSystem()
    b.spawn(0, 2, 0, 1, 1, 0)
    const speedA = Math.hypot(a.list[0]!.vx, a.list[0]!.vz)
    const speedB = Math.hypot(b.list[0]!.vx, b.list[0]!.vz)
    expect(speedB).toBeCloseTo(speedA, 5)
  })

  it('bounces off the ground and loses energy', () => {
    g.spawn(0, 0.5, 0, 1, 0, 0)
    let bounced = false
    let peakAfterBounce = 0
    for (let i = 0; i < 600 && g.list.length; i++) {
      g.update(1 / 60)
      const grenade = g.list[0]
      if (!grenade) break
      if (grenade.bounces > 0) {
        bounced = true
        peakAfterBounce = Math.max(peakAfterBounce, grenade.y)
      }
    }
    expect(bounced).toBe(true)
    expect(peakAfterBounce).toBeGreaterThan(0)
    expect(peakAfterBounce).toBeLessThan(2) // bounce keeps only a fraction of energy
  })

  it('detonates when the fuse runs out', () => {
    g.spawn(0, 1, 0, 1, 0, 0)
    let blasts: unknown[] = []
    for (let i = 0; i < 600 && g.list.length; i++) {
      blasts = g.update(0.1)
      if (blasts.length) break
    }
    expect(blasts).toHaveLength(1)
    expect(g.list).toHaveLength(0)
    const site = blasts[0] as { x: number; y: number; z: number }
    expect(Number.isFinite(site.x)).toBe(true)
    expect(site.y).toBeGreaterThanOrEqual(0)
  })

  it('caps live grenades at MAX', () => {
    for (let i = 0; i < GRENADE.MAX + 5; i++) {
      const id = g.spawn(i, 1, 0, 1, 0, 0)
      if (i < GRENADE.MAX) expect(id).not.toBeNull()
      else expect(id).toBeNull()
    }
    expect(g.list).toHaveLength(GRENADE.MAX)
  })

  it('clear() drops everything without blasting', () => {
    g.spawn(0, 1, 0, 1, 0, 0)
    g.clear()
    expect(g.list).toHaveLength(0)
    expect(g.update(10)).toHaveLength(0)
  })

  it('a resting grenade still detonates on the fuse', () => {
    g.spawn(0, 0, 0, 1, 0, -1) // thrown into the dirt
    let blasts: unknown[] = []
    for (let i = 0; i < 200; i++) {
      blasts = g.update(0.1)
      if (blasts.length) break
    }
    expect(blasts).toHaveLength(1)
    expect(g.list[0]).toBeUndefined()
  })
})

describe('blastFalloff', () => {
  it('is 1 at the center, 0 at/beyond the edge, linear between', () => {
    expect(blastFalloff(0, 5)).toBe(1)
    expect(blastFalloff(5, 5)).toBe(0)
    expect(blastFalloff(9, 5)).toBe(0)
    expect(blastFalloff(-1, 5)).toBe(1)
    expect(blastFalloff(2.5, 5)).toBeCloseTo(0.5, 5)
  })
})
