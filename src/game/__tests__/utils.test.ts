import { describe, it, expect } from 'vitest'
import {
  clamp, lerp, damp, angleLerp, angleDiff, dist2D,
  makeRng, randRange, pick, formatDist, formatTime,
} from '../utils'

describe('clamp', () => {
  it('clamps below, above, and passes through', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(4, 0, 10)).toBe(4)
  })
})

describe('lerp/damp', () => {
  it('lerps endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.5)).toBe(5)
  })

  it('damp converges monotonically and never overshoots', () => {
    let v = 0
    for (let i = 0; i < 100; i++) {
      const next = damp(v, 10, 5, 0.016)
      expect(next).toBeGreaterThanOrEqual(v)
      expect(next).toBeLessThanOrEqual(10)
      v = next
    }
    expect(v).toBeGreaterThan(9.9)
  })

  it('damp with dt=0 does not move', () => {
    expect(damp(3, 10, 5, 0)).toBe(3)
  })
})

describe('angles', () => {
  it('angleLerp takes the short way around 2π', () => {
    // 350° -> 10° should go +20°, not -340°.
    const a = (350 * Math.PI) / 180
    const b = (10 * Math.PI) / 180
    const mid = angleLerp(a, b, 0.5)
    // Equivalent to 0° (mod 2π).
    const norm = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    expect(norm).toBeCloseTo(0, 5)
  })

  it('angleDiff is signed and bounded', () => {
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 8)
    expect(angleDiff(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2, 8)
    const d = angleDiff(0, Math.PI * 1.5)
    expect(Math.abs(d)).toBeLessThanOrEqual(Math.PI)
  })
})

describe('dist2D', () => {
  it('measures 3-4-5', () => {
    expect(dist2D(0, 0, 3, 4)).toBe(5)
  })
})

describe('makeRng', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = makeRng(123)
    const b = makeRng(123)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    const c = makeRng(999)
    expect(c()).not.toBe(seqA[0])
  })

  it('stays in [0, 1)', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('randRange and pick stay in bounds', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 200; i++) {
      const v = randRange(rng, -5, 5)
      expect(v).toBeGreaterThanOrEqual(-5)
      expect(v).toBeLessThan(5)
      expect(pick(rng, ['a', 'b', 'c'] as const)).toMatch(/^[abc]$/)
    }
  })
})

describe('formatters', () => {
  it('formatDist switches to km', () => {
    expect(formatDist(10, 1.4)).toBe('14m')
    expect(formatDist(1000, 1.4)).toBe('1.4km')
  })

  it('formatTime pads seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(599)).toBe('9:59')
  })
})
