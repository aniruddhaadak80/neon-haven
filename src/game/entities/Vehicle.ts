import * as THREE from 'three'
import { CAR, WORLD } from '../config'
import type { VehicleModel } from '../assets/AssetLibrary'
import { clamp, damp } from '../utils'
import type { Vehicle } from '../types'

let nextId = 1

export class VehicleEntity implements Vehicle {
  id = nextId++
  model: string
  group: THREE.Group
  body: THREE.Mesh
  wheels: THREE.Mesh[]
  pos: THREE.Vector3
  heading: number
  speed = 0
  latVel = 0
  steer = 0
  health = CAR.HEALTH
  dead = false
  driven = false
  ai: { axis: 'x' | 'z'; dir: 1 | -1; lane: number } | null = null
  police = false
  siren = false
  roll = 0
  pitch = 0
  headlights: THREE.SpotLight | null = null
  blob: THREE.Mesh
  vel = new THREE.Vector3()
  halfW: number
  halfL: number
  wheelRadius: number
  steerWheels: THREE.Mesh[]
  /** Visual damage 0..1. */
  damage = 0
  private smokeTimer = 0

  constructor(model: string, vm: VehicleModel, x: number, z: number, heading: number) {
    this.model = model
    this.group = vm.group.clone(true)
    this.pos = new THREE.Vector3(x, 0, z)
    this.heading = heading
    this.halfW = vm.halfW * WORLD.CAR_SCALE
    this.halfL = vm.halfL * WORLD.CAR_SCALE
    this.wheelRadius = vm.wheelRadius * WORLD.CAR_SCALE

    // Clone() shares geometry; pull out body + wheels for animation.
    this.body = this.group.getObjectByName('body') as THREE.Mesh
    this.wheels = []
    this.steerWheels = []
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name.startsWith('wheel')) {
        this.wheels.push(o)
        if (/front/.test(o.name)) this.steerWheels.push(o)
      }
    })
    if (!this.body) {
      // Fallback: first mesh is the body.
      this.body = this.group.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh
    }

    // Blob shadow.
    const blobGeo = new THREE.CircleGeometry(Math.max(this.halfW, this.halfL) * 1.15, 20)
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false })
    this.blob = new THREE.Mesh(blobGeo, blobMat)
    this.blob.rotation.x = -Math.PI / 2
    this.blob.position.y = 0.02
    this.group.add(this.blob)

    this.syncTransform()
  }

  get speedKmh(): number {
    return Math.abs(this.speed) * 6
  }

  /** Forward unit vector in world space. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading))
  }

  /**
   * Arcade bicycle physics.
   * @param throttle -1..1 (reverse..forward)
   * @param steerInput -1..1 (left..right)
   * @param handbrake bool
   */
  update(dt: number, throttle: number, steerInput: number, handbrake: boolean) {
    if (this.dead) {
      this.speed = damp(this.speed, 0, 4, dt)
      this.latVel = damp(this.latVel, 0, 6, dt)
      this.integrate(dt)
      return
    }

    const fwdX = Math.sin(this.heading)
    const fwdZ = Math.cos(this.heading)
    const rightX = Math.cos(this.heading)
    const rightZ = -Math.sin(this.heading)

    // Decompose velocity into forward + lateral.
    let fSpeed = this.vel.x * fwdX + this.vel.z * fwdZ
    let lSpeed = this.vel.x * rightX + this.vel.z * rightZ

    // Engine / brake.
    if (throttle > 0) {
      fSpeed += CAR.ACCEL * throttle * dt
    } else if (throttle < 0) {
      if (fSpeed > 0.5) fSpeed += CAR.BRAKE * throttle * dt // brake
      else fSpeed += CAR.REVERSE_ACCEL * throttle * dt // reverse
    }
    // Drag + rolling resistance.
    fSpeed -= fSpeed * CAR.DRAG * dt
    const rr = Math.sign(fSpeed) * CAR.ROLL_RESIST * dt
    fSpeed = Math.abs(fSpeed) > Math.abs(rr) ? fSpeed - rr : 0
    fSpeed = clamp(fSpeed, -CAR.MAX_REVERSE, CAR.MAX_SPEED)

    // Lateral grip (handbrake = drift).
    const grip = handbrake ? CAR.HANDBRAKE_GRIP : CAR.GRIP
    lSpeed -= lSpeed * grip * dt

    // Steering: yaw rate scales with speed, flips in reverse.
    const speedFactor = clamp(fSpeed / CAR.STEER_SPEED_REF, -1, 1)
    this.steer = damp(this.steer, steerInput, 10, dt)
    const steerAngle = this.steer * CAR.STEER_MAX * speedFactor
    this.heading += steerAngle * CAR.STEER_RATE * dt * (fSpeed >= 0 ? 1 : -1)

    // Recompose velocity in the new heading frame.
    const nFwdX = Math.sin(this.heading)
    const nFwdZ = Math.cos(this.heading)
    const nRightX = Math.cos(this.heading)
    const nRightZ = -Math.sin(this.heading)
    this.vel.set(nFwdX * fSpeed + nRightX * lSpeed, 0, nFwdZ * fSpeed + nRightZ * lSpeed)
    this.speed = fSpeed
    this.latVel = lSpeed

    this.integrate(dt)
    this.updateVisuals(dt, throttle)
  }

  private integrate(dt: number) {
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    this.syncTransform()
  }

  private syncTransform() {
    this.group.position.copy(this.pos)
    this.group.rotation.y = this.heading
  }

  private updateVisuals(dt: number, throttle: number) {
    // Wheel spin + steer.
    const spin = (this.speed / Math.max(this.wheelRadius, 0.05)) * dt
    for (const w of this.wheels) {
      w.rotation.x += spin
    }
    for (const w of this.steerWheels) {
      w.rotation.y = this.steer * 0.45
    }
    // Body roll/pitch.
    const targetRoll = -this.steer * clamp(this.speed / CAR.MAX_SPEED, -1, 1) * 0.06
    const targetPitch = -throttle * 0.03 - clamp(this.latVel * 0.01, -0.04, 0.04)
    this.roll = damp(this.roll, targetRoll, 8, dt)
    this.pitch = damp(this.pitch, targetPitch, 8, dt)
    this.group.rotation.z = this.roll
    this.group.rotation.x = this.pitch

    // Damage smoke.
    if (this.damage > 0.4 && !this.dead) {
      this.smokeTimer -= dt
    }
  }

  /** Apply damage; returns true if this hit destroyed the car. */
  damageBy(amount: number): boolean {
    if (this.dead) return false
    this.health -= amount
    this.damage = clamp(1 - this.health / CAR.HEALTH, 0, 1)
    if (this.health <= 0) {
      this.dead = true
      // Char the body.
      const mat = this.body.material as THREE.MeshLambertMaterial
      mat.color.setScalar(0.08)
      return true
    }
    return false
  }

  setHeadlights(on: boolean) {
    if (on && !this.headlights) {
      const l = new THREE.SpotLight(0xfff2cc, 60, 26, 0.5, 0.5, 1.2)
      l.position.set(0, 0.7, this.halfL * 0.8)
      const target = new THREE.Object3D()
      target.position.set(0, 0, this.halfL + 6)
      this.group.add(target)
      l.target = target
      this.group.add(l)
      this.headlights = l
    } else if (!on && this.headlights) {
      this.group.remove(this.headlights)
      this.headlights.target?.removeFromParent()
      this.headlights = null
    }
  }

  dispose() {
    this.group.removeFromParent()
  }
}
