import { describe, it, expect } from 'vitest'
import { planRoadblock } from '../systems/Roadblock'

const STREETS_X = [-40, -30, -20, -10, 0, 10, 20, 30, 40]
const STREETS_Z = [-40, -30, -20, -10, 0, 10, 20, 30, 40]

describe('planRoadblock', () => {
  it('snaps a northbound run onto the nearest N-S street (axis x)', () => {
    // Heading 0 = +Z direction. Cross-axis (x) must land on a streetsX line.
    const plan = planRoadblock(-7, 0, 0, STREETS_X, STREETS_Z, 55)
    expect(plan).not.toBeNull()
    expect(plan!.axis).toBe('x')
    expect(STREETS_X).toContain(plan!.x)
    expect(plan!.z).toBeCloseTo(55, 5) // straight ahead
  })

  it('snaps an eastbound run onto the nearest E-W street (axis z)', () => {
    // Heading π/2 = +X direction.
    const plan = planRoadblock(0, 3, Math.PI / 2, STREETS_X, STREETS_Z, 40)
    expect(plan).not.toBeNull()
    expect(plan!.axis).toBe('z')
    expect(STREETS_Z).toContain(plan!.z)
    expect(plan!.x).toBeCloseTo(40, 5)
  })

  it('picks the closest street line, not just any', () => {
    const plan = planRoadblock(26, 0, 0, STREETS_X, STREETS_Z, 50)
    // Ahead: z=50, nearest x-line to 26 is 30 (20 is farther).
    expect(plan!.x).toBe(30)
  })

  it('handles diagonal headings by dominant axis', () => {
    const diag = planRoadblock(0, 0, Math.PI / 4, STREETS_X, STREETS_Z, 30)
    expect(diag).not.toBeNull()
    expect(['x', 'z']).toContain(diag!.axis)
    // Only the cross-axis coordinate is snapped onto a street line.
    if (diag!.axis === 'x') {
      expect(STREETS_X).toContain(diag!.x)
    } else {
      expect(STREETS_Z).toContain(diag!.z)
    }
  })

  it('returns null on non-positive lookahead or empty street lists', () => {
    expect(planRoadblock(0, 0, 0, STREETS_X, STREETS_Z, 0)).toBeNull()
    expect(planRoadblock(0, 0, 0, STREETS_X, STREETS_Z, -10)).toBeNull()
    expect(planRoadblock(0, 0, 0, [], STREETS_Z, 50)).toBeNull()
    expect(planRoadblock(0, 0, Math.PI / 2, STREETS_X, [], 50)).toBeNull()
  })

  it('places the trap ahead of the player, not behind', () => {
    const plan = planRoadblock(0, 0, 0, STREETS_X, STREETS_Z, 55)!
    expect(plan.z).toBeGreaterThan(0)
    const back = planRoadblock(0, 0, Math.PI, STREETS_X, STREETS_Z, 55)!
    expect(back.z).toBeLessThan(0)
  })

  it('is deterministic', () => {
    const a = planRoadblock(3, -2, 1.2, STREETS_X, STREETS_Z, 45)
    const b = planRoadblock(3, -2, 1.2, STREETS_X, STREETS_Z, 45)
    expect(a).toEqual(b)
  })
})
