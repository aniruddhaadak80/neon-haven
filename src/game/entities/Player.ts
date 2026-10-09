import * as THREE from 'three'
import { PLAYER, WORLD } from '../config'
import { getCharacter, CHARACTER_KEYS } from '../assets/AssetLibrary'
import { clamp, damp, angleDamp } from '../utils'
import type { CharacterRig } from '../assets/AssetLibrary'
import type { VehicleEntity } from './Vehicle'

export class Player {
  rig: CharacterRig
  group: THREE.Group
  pos: THREE.Vector3
  heading = 0
  vel = new THREE.Vector3()
  health: number = PLAYER.HEALTH
  armor: number = PLAYER.ARMOR
  dead = false
  /** Vehicle the player is driving, or null when on foot. */
  vehicle: VehicleEntity | null = null
  /** Vertical velocity for jumping. */
  vy = 0
  grounded = true
  /** Camera yaw (set by the game each frame). */
  camYaw = 0
  /** Muzzle flash timer. */
  shootTimer = 0
  private action: THREE.AnimationAction | null = null
  private actionName = ''
  private bobPhase = 0

  constructor(rig: CharacterRig) {
    this.rig = rig
    this.group = rig.group
    this.pos = new THREE.Vector3()
    this.play('idle')
  }

  get isDriving(): boolean {
    return this.vehicle !== null
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z)
  }

  play(name: string, fade = 0.15) {
    if (this.actionName === name) return
    const clip = this.rig.clips.get(name)
    if (!clip) return
    const next = this.rig.mixer.clipAction(clip)
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1)
    if (this.action) {
      next.crossFadeFrom(this.action, fade, false)
    }
    next.play()
    this.action = next
    this.actionName = name
  }

  /** On-foot update. input: {forward,back,left,right,sprint,jump} */
  updateOnFoot(dt: number, input: { f: number; s: number; sprint: boolean; jump: boolean }, camYaw: number) {
    if (this.dead) {
      this.play('die', 0.1)
      this.rig.mixer.update(dt)
      return
    }
    this.camYaw = camYaw

    // Camera-relative movement.
    const sin = Math.sin(camYaw)
    const cos = Math.cos(camYaw)
    // forward = (sin, cos) in xz; right = (cos, -sin)
    let mx = 0
    let mz = 0
    if (input.f !== 0) {
      mx += sin * input.f
      mz += cos * input.f
    }
    if (input.s !== 0) {
      mx += cos * input.s
      mz += -sin * input.s
    }
    const len = Math.hypot(mx, mz)
    const maxSpeed = input.sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED
    if (len > 0.001) {
      mx /= len
      mz /= len
      this.vel.x = damp(this.vel.x, mx * maxSpeed, PLAYER.ACCEL / maxSpeed, dt)
      this.vel.z = damp(this.vel.z, mz * maxSpeed, PLAYER.ACCEL / maxSpeed, dt)
    } else {
      this.vel.x = damp(this.vel.x, 0, PLAYER.FRICTION / maxSpeed, dt)
      this.vel.z = damp(this.vel.z, 0, PLAYER.FRICTION / maxSpeed, dt)
    }

    // Jump / gravity.
    if (input.jump && this.grounded) {
      this.vy = PLAYER.JUMP_VEL
      this.grounded = false
    }
    if (!this.grounded) {
      this.vy -= PLAYER.GRAVITY * dt
      this.pos.y += this.vy * dt
      if (this.pos.y <= 0) {
        this.pos.y = 0
        this.vy = 0
        this.grounded = true
      }
    }

    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt

    // Face movement direction.
    const spd = this.speed
    if (spd > 0.4) {
      const targetHeading = Math.atan2(this.vel.x, this.vel.z)
      this.heading = angleDamp(this.heading, targetHeading, 12, dt)
    }

    // Animation.
    if (this.shootTimer > 0) {
      this.play('holding-right-shoot', 0.05)
      this.shootTimer -= dt
    } else if (!this.grounded) {
      this.play('idle', 0.1)
    } else if (spd > PLAYER.SPRINT_SPEED * 0.7) {
      this.play('sprint', 0.12)
    } else if (spd > 0.4) {
      this.play('walk', 0.12)
    } else {
      this.play('idle', 0.2)
    }

    // Walk bob.
    this.bobPhase += spd * dt * 2.2
    this.group.position.set(this.pos.x, this.pos.y + Math.abs(Math.sin(this.bobPhase)) * 0.04, this.pos.z)
    this.group.rotation.y = this.heading
    this.rig.mixer.update(dt)
  }

  /** While driving, the player rides the vehicle. */
  updateDriving(dt: number) {
    if (!this.vehicle) return
    this.pos.copy(this.vehicle.pos)
    this.heading = this.vehicle.heading
    this.group.position.copy(this.vehicle.pos)
    this.group.rotation.y = this.vehicle.heading
    this.play('drive', 0.2)
    this.rig.mixer.update(dt)
  }

  enterVehicle(v: VehicleEntity) {
    this.vehicle = v
    v.driven = true
    this.pos.copy(v.pos)
  }

  exitVehicle() {
    if (!this.vehicle) return
    // Step out to the left side.
    const v = this.vehicle
    const rightX = Math.cos(v.heading)
    const rightZ = -Math.sin(v.heading)
    this.pos.set(v.pos.x - rightX * (v.halfW + 0.5), 0, v.pos.z - rightZ * (v.halfW + 0.5))
    this.vel.set(0, 0, 0)
    v.driven = false
    this.vehicle = null
    this.play('idle')
  }

  damageBy(amount: number): boolean {
    if (this.dead) return false
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.6)
      this.armor -= absorbed
      amount -= absorbed
    }
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.dead = true
      return true
    }
    return false
  }

  respawn(pos: THREE.Vector3) {
    this.pos.copy(pos)
    this.vel.set(0, 0, 0)
    this.health = PLAYER.HEALTH
    this.armor = 0
    this.dead = false
    this.vy = 0
    this.grounded = true
    if (this.vehicle) {
      this.vehicle.driven = false
      this.vehicle = null
    }
    this.play('idle')
  }
}

export async function createPlayer(): Promise<Player> {
  const key = CHARACTER_KEYS[0]!
  const rig = await getCharacter(key)
  // Give the player a distinct look: dark jacket via a tinted clone.
  rig.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mat = m.material as THREE.MeshLambertMaterial
      if (mat && mat.color) {
        mat.color.multiplyScalar(0.55)
      }
    }
  })
  rig.group.scale.setScalar(WORLD.CHAR_SCALE)
  return new Player(rig)
}
