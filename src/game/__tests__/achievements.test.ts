import { describe, it, expect } from 'vitest'
import { Achievements } from '../systems/Achievements'
import { ACHIEVEMENTS, type AchievementId } from '../config'

const ALL_IDS = Object.keys(ACHIEVEMENTS) as AchievementId[]

describe('Achievements', () => {
  it('starts empty', () => {
    const a = new Achievements()
    expect(a.count).toBe(0)
    expect(a.ids).toEqual([])
  })

  it('unlocks exactly once', () => {
    const a = new Achievements()
    expect(a.unlock('first_blood')).toBe(true)
    expect(a.unlock('first_blood')).toBe(false)
    expect(a.has('first_blood')).toBe(true)
    expect(a.count).toBe(1)
  })

  it('restores from a saved list', () => {
    const a = new Achievements(['first_blood', 'rich'])
    expect(a.has('first_blood')).toBe(true)
    expect(a.has('rich')).toBe(true)
    expect(a.has('streak_5')).toBe(false)
    expect(a.count).toBe(2)
    expect(a.unlock('first_blood')).toBe(false)
  })

  it('ignores unknown ids from a corrupted save', () => {
    const a = new Achievements(['bogus_id', 'first_blood'])
    expect(a.count).toBe(1)
    expect(a.ids).toEqual(['first_blood'])
  })

  it('tolerates a missing/undefined save field (pre-achievement saves)', () => {
    expect(new Achievements(undefined).count).toBe(0)
    expect(new Achievements(null).count).toBe(0)
  })

  it('ids round-trips through the constructor', () => {
    const a = new Achievements()
    for (const id of ALL_IDS) a.unlock(id)
    expect(a.count).toBe(Achievements.total)
    expect(a.ids).toEqual([...ALL_IDS].sort())
    const b = new Achievements(a.ids)
    expect(b.count).toBe(Achievements.total)
  })

  it('every defined id has a name and description', () => {
    for (const id of ALL_IDS) {
      expect(ACHIEVEMENTS[id].name.length).toBeGreaterThan(0)
      expect(ACHIEVEMENTS[id].desc.length).toBeGreaterThan(0)
    }
    expect(Achievements.total).toBe(8)
  })
})
