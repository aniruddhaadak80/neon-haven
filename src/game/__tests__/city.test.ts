import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { isBlocked, resolveCollision, type CityData } from '../world/City'

/** 5x5 grid, origin -2.5, single blocked cell at tile (1,1). */
function stubCity(): CityData {
  const size = 5
  const colliders = new Uint8Array(size * size)
  colliders[1 * size + 1] = 1
  return {
    group: new THREE.Group(),
    colliders,
    size,
    origin: -2.5,
    streetsX: [],
    streetsZ: [],
    spawn: new THREE.Vector3(),
    missionSpots: [],
    paynspray: new THREE.Vector3(),
    neon: [],
    bounds: 99,
  }
}

describe('isBlocked', () => {
  it('flags the blocked tile and out-of-bounds', () => {
    const city = stubCity()
    // Tile (1,1) spans x,z in [-1.5,-0.5].
    expect(isBlocked(city, -1, -1)).toBe(true)
    expect(isBlocked(city, 0, 0)).toBe(false)
    expect(isBlocked(city, 99, 99)).toBe(true)
    expect(isBlocked(city, -99, 0)).toBe(true)
  })
})

describe('resolveCollision', () => {
  it('leaves open ground untouched', () => {
    const city = stubCity()
    expect(resolveCollision(city, 1.5, 1.5, 0.3)).toEqual([1.5, 1.5])
  })

  it('pushes a circle out of a blocked cell', () => {
    const city = stubCity()
    const [x, z] = resolveCollision(city, -1.2, -1, 0.4)
    // Must no longer overlap tile (1,1) which spans [-1.5,-0.5]^2.
    const insideX = x > -1.5 - 0.4 && x < -0.5 + 0.4
    const insideZ = z > -1.5 - 0.4 && z < -0.5 + 0.4
    expect(insideX && insideZ).toBe(false)
  })

  it('ejects a centre buried exactly inside a cell', () => {
    const city = stubCity()
    const [x, z] = resolveCollision(city, -1, -1, 0.3)
    expect(isBlocked(city, x, z)).toBe(false)
  })

  it('is stable when called twice', () => {
    const city = stubCity()
    const once = resolveCollision(city, -1.2, -1.1, 0.4)
    const twice = resolveCollision(city, once[0], once[1], 0.4)
    expect(twice[0]).toBeCloseTo(once[0], 8)
    expect(twice[1]).toBeCloseTo(once[1], 8)
  })
})
