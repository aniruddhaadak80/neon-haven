import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

/** A stand-in for the Kenney car model: VehicleEntity only needs a group
 *  with a body mesh and the three dimensions it scales from. */
function fakeVehicleModel() {
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }))
  body.name = 'body'
  group.add(body)
  return { group, halfW: 1, halfL: 2, wheelRadius: 0.3, body, wheels: [], steerWheels: [] }
}

vi.mock('../assets/AssetLibrary', () => ({
  POLICE_MODEL: 'police',
  getVehicleModel: vi.fn(async () => fakeVehicleModel()),
}))

import { Police } from '../systems/Police'

const CITY = {
  origin: 0,
  spawn: new THREE.Vector3(),
  streetsX: [-40, -30, -20, -10, 0, 10, 20, 30, 40],
  streetsZ: [-40, -30, -20, -10, 0, 10, 20, 30, 40],
}

const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * Wraps spawn() with a call counter that throws once the budget is blown, so
 * a runaway spawn loop fails the test instead of hanging the worker.
 */
function guardSpawns(police: Police, budget = 10): { calls: number } {
  const counter = { calls: 0 }
  const original = police.spawn.bind(police)
  vi.spyOn(police, 'spawn').mockImplementation((...args: unknown[]) => {
    counter.calls += 1
    if (counter.calls > budget) throw new Error('spawn() was called in a loop')
    return (original as (...a: unknown[]) => void)(...args)
  })
  return counter
}

describe('Police.update', () => {
  it('reconciles the cruiser count once per frame instead of spinning', async () => {
    const police = new Police(new THREE.Scene(), CITY as never)
    // Let the police model promise settle so modelReady flips to true.
    await tick()

    const counter = guardSpawns(police)

    expect(() => police.update(0.016, 1, new THREE.Vector3(), null, false)).not.toThrow()
    expect(counter.calls).toBeLessThanOrEqual(2)
  })

  it('adds the cruiser the wanted level calls for', async () => {
    const police = new Police(new THREE.Scene(), CITY as never)
    await tick()
    guardSpawns(police)

    police.update(0.016, 1, new THREE.Vector3(), null, false)
    await tick()

    expect(police.cars.length).toBe(1)
  })

  it('does not re-spawn a cruiser while its model is still loading', async () => {
    const police = new Police(new THREE.Scene(), CITY as never)
    await tick()
    const counter = guardSpawns(police)

    // Three frames in a row: the model promise has not settled yet.
    police.update(0.016, 2, new THREE.Vector3(), null, false)
    police.update(0.016, 2, new THREE.Vector3(), null, false)
    police.update(0.016, 2, new THREE.Vector3(), null, false)

    expect(counter.calls).toBe(2)
  })
})
