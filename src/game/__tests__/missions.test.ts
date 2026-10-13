import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { MissionSystem } from '../systems/Missions'
import type { CityData } from '../world/City'
import type { Ped, Mission } from '../types'

/** Minimal street grid — no rendering, just coordinates. */
function stubCity(): CityData {
  const line = (n: number) => Array.from({ length: n }, (_, i) => -40 + i * 10)
  return {
    group: new THREE.Group(),
    colliders: new Uint8Array(0),
    size: 0,
    origin: 0,
    streetsX: line(9),
    streetsZ: line(9),
    spawn: new THREE.Vector3(0, 0, 0),
    missionSpots: [],
    paynspray: new THREE.Vector3(),
    neon: [],
    bounds: 100,
  }
}

function fakePed(id: number, x = 0, z = 0): Ped {
  return {
    id,
    group: new THREE.Group(),
    mixer: null as unknown as THREE.AnimationMixer,
    pos: new THREE.Vector3(x, 0, z),
    heading: 0,
    speed: 0,
    state: 'walk',
    target: new THREE.Vector3(),
    fleeTimer: 0,
    anim: 'walk',
    deadTimer: 0,
  }
}

describe('MissionSystem', () => {
  let scene: THREE.Scene
  let ms: MissionSystem
  const player = new THREE.Vector3(0, 0, 0)

  beforeEach(() => {
    scene = new THREE.Scene()
    ms = new MissionSystem(scene, stubCity())
  })

  /** Fast-forward the offer cooldown and return a mission of any kind. */
  function offer(wanted = 0): Mission {
    const m = ms.maybeOffer(999, player, wanted)
    if (!m) throw new Error('expected a mission offer')
    return m
  }

  it('offers nothing while one is active or cooling down', () => {
    const fresh = new MissionSystem(scene, stubCity())
    expect(fresh.maybeOffer(0.01, player, 0)).toBeNull()
    const m = offer()
    expect(m).not.toBeNull()
    expect(ms.maybeOffer(999, player, 0)).toBeNull()
  })

  it('delivery completes at the marker', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'delivery' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    expect(m.kind).toBe('delivery')
    player.copy(m.marker)
    expect(ms.update(0.016, player, 0)).toBe('done')
    expect(ms.current).toBeNull()
  })

  it('fails on timeout', () => {
    const m = offer()
    m.timeLeft = 0.01
    expect(ms.update(0.1, player, 0)).toBe('failed')
    expect(ms.current).toBeNull()
  })

  it('rampage completes after enough wrecks', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'rampage' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    expect(m.kind).toBe('rampage')
    for (let i = 0; i < m.targetCount; i++) ms.notifyCarDestroyed()
    expect(ms.update(0.016, player, 0)).toBe('done')
  })

  it('race advances through checkpoints in order', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'race' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    expect(m.waypoints.length).toBeGreaterThanOrEqual(4)
    for (const cp of [...m.waypoints]) {
      player.copy(cp)
      const res = ms.update(0.016, player, 0)
      if (m.waypoints.length === 0 || ms.current === null) {
        expect(res).toBe('done')
        break
      }
      expect(res).toBeNull()
    }
    expect(ms.current).toBeNull()
  })

  it('stash collects every package in any order', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'stash' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    expect(m.waypoints).toHaveLength(5)
    for (const w of [...m.waypoints].reverse()) {
      player.copy(w)
      ms.update(0.016, player, 0)
    }
    expect(ms.current).toBeNull()
  })

  it('taxi goes pickup then dropoff', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'taxi' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    player.copy(m.marker)
    expect(ms.update(0.016, player, 0)).toBeNull()
    expect(ms.current!.phase).toBe('dropoff')
    player.copy(ms.current!.marker)
    expect(ms.update(0.016, player, 0)).toBe('done')
  })

  it('getaway needs zero heat at the marker', () => {
    // Getaways are only offered while wanted.
    let m = offer(3)
    let guard = 0
    while (m.kind !== 'getaway' && guard++ < 60) {
      ms.abandon()
      m = offer(3)
    }
    expect(m.kind).toBe('getaway')
    player.copy(m.marker)
    expect(ms.update(0.016, player, 3)).toBeNull()
    expect(ms.update(0.016, player, 0)).toBe('done')
  })

  it('getaway is never offered at zero heat', () => {
    for (let i = 0; i < 10; i++) {
      const m = offer(0)
      expect(m.kind).not.toBe('getaway')
      ms.abandon()
    }
  })

  it('hit fails safely without a target, completes on target death', () => {
    let m = offer()
    let guard = 0
    while (m.kind !== 'hit' && guard++ < 60) {
      ms.abandon()
      m = offer()
    }
    // No target spawned -> graceful fail, never stuck.
    expect(ms.update(0.016, player, 0)).toBe('failed')

    // Offer again until hit, then attach a target.
    guard = 0
    do {
      m = offer()
      if (m.kind !== 'hit') ms.abandon()
      guard++
    } while (m.kind !== 'hit' && guard < 60)
    expect(m.kind).toBe('hit')
    const target = fakePed(4242, 5, 5)
    ms.setTarget(target, target.id)
    expect(ms.isTarget(4242)).toBe(true)
    expect(ms.isTarget(1)).toBe(false)
    ms.update(0.016, player, 0)
    // Marker stalks the target.
    expect(ms.current!.marker.x).toBe(5)
    target.state = 'dead'
    expect(ms.update(0.016, player, 0)).toBe('done')
  })

  it('abandon clears markers, targets, and current', () => {
    offer()
    ms.abandon()
    expect(ms.current).toBeNull()
    expect(ms.isTarget(999)).toBe(false)
  })
})
