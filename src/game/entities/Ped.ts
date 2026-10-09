import * as THREE from 'three'
import { PEDS, WORLD } from '../config'
import { getCharacter, CHARACTER_KEYS } from '../assets/AssetLibrary'
import { angleDamp, makeRng, randRange } from '../utils'
import type { CharacterRig } from '../assets/AssetLibrary'
import type { Ped } from '../types'
import type { CityData } from '../world/City'
import { isBlocked } from '../world/City'

let nextId = 1
const rng = makeRng(WORLD.SEED + 999)

export class PedEntity implements Ped {
  id = nextId++
  group: THREE.Group
  mixer: THREE.AnimationMixer
  pos: THREE.Vector3
  heading = 0
  speed = 0
  state: 'walk' | 'flee' | 'dead' = 'walk'
  target = new THREE.Vector3()
  fleeTimer = 0
  anim = 'walk'
  deadTimer = 0
  private rig: CharacterRig
  private action: THREE.AnimationAction | null = null
  private repathTimer = 0

  constructor(rig: CharacterRig, x: number, z: number) {
    this.rig = rig
    this.group = rig.group
    this.mixer = rig.mixer
    this.pos = new THREE.Vector3(x, 0, z)
    this.group.scale.setScalar(WORLD.CHAR_SCALE * randRange(rng, 0.92, 1.05))
    this.pickTarget()
    this.group.position.copy(this.pos)
  }

  private pickTarget(city?: CityData) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const nx = this.pos.x + randRange(rng, -14, 14)
      const nz = this.pos.z + randRange(rng, -14, 14)
      if (city && isBlocked(city, nx, nz)) continue
      this.target.set(nx, 0, nz)
      return
    }
    this.target.copy(this.pos)
  }

  update(dt: number, city: CityData, danger: { x: number; z: number; radius: number } | null) {
    if (this.state === 'dead') {
      this.deadTimer += dt
      this.mixer.update(dt)
      return
    }

    // Flee if danger is close.
    if (danger) {
      const d = Math.hypot(this.pos.x - danger.x, this.pos.z - danger.z)
      if (d < danger.radius) {
        this.state = 'flee'
        this.fleeTimer = 2.5
        // Run away from danger.
        const ax = this.pos.x - danger.x
        const az = this.pos.z - danger.z
        const len = Math.hypot(ax, az) || 1
        this.target.set(this.pos.x + (ax / len) * 12, 0, this.pos.z + (az / len) * 12)
      }
    }

    if (this.state === 'flee') {
      this.fleeTimer -= dt
      if (this.fleeTimer <= 0) this.state = 'walk'
    }

    const dx = this.target.x - this.pos.x
    const dz = this.target.z - this.pos.z
    const dist = Math.hypot(dx, dz)

    if (dist < 0.6) {
      this.repathTimer -= dt
      if (this.repathTimer <= 0) {
        this.pickTarget(city)
        this.repathTimer = randRange(rng, 2, 6)
      }
      this.speed = 0
    } else {
      const maxSpeed = this.state === 'flee' ? PEDS.FLEE_SPEED : PEDS.WALK_SPEED
      this.speed = maxSpeed
      const targetHeading = Math.atan2(dx, dz)
      this.heading = angleDamp(this.heading, targetHeading, 8, dt)
      this.pos.x += Math.sin(this.heading) * this.speed * dt
      this.pos.z += Math.cos(this.heading) * this.speed * dt
      // Keep out of buildings.
      if (isBlocked(city, this.pos.x, this.pos.z)) {
        this.pos.x -= Math.sin(this.heading) * this.speed * dt * 2
        this.pos.z -= Math.cos(this.heading) * this.speed * dt * 2
        this.pickTarget(city)
      }
    }

    this.group.position.copy(this.pos)
    this.group.rotation.y = this.heading

    // Animation.
    const name = this.speed > 0.1 ? (this.state === 'flee' ? 'sprint' : 'walk') : 'idle'
    if (this.anim !== name) {
      this.anim = name
      const clip = this.rig.clips.get(name)
      if (clip) {
        const next = this.mixer.clipAction(clip)
        next.reset().setEffectiveWeight(1)
        if (this.action) next.crossFadeFrom(this.action, 0.15, false)
        next.play()
        this.action = next
      }
    }
    this.mixer.update(dt)
  }

  kill() {
    if (this.state === 'dead') return
    this.state = 'dead'
    this.deadTimer = 0
    this.speed = 0
    const clip = this.rig.clips.get('die')
    if (clip) {
      const next = this.mixer.clipAction(clip)
      next.reset().setEffectiveWeight(1)
      if (this.action) next.crossFadeFrom(this.action, 0.1, false)
      next.play()
      this.action = next
    }
    // Tip over.
    this.group.rotation.x = -Math.PI / 2
    this.group.position.y = 0.2
  }

  dispose() {
    this.group.removeFromParent()
  }
}

export async function createPed(x: number, z: number): Promise<PedEntity> {
  const key = CHARACTER_KEYS[Math.floor(rng() * CHARACTER_KEYS.length)]!
  const rig = await getCharacter(key)
  return new PedEntity(rig, x, z)
}
