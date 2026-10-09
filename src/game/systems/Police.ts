import * as THREE from 'three'
import { POLICE, WORLD } from '../config'
import { VehicleEntity } from '../entities/Vehicle'
import { getVehicleModel, POLICE_MODEL } from '../assets/AssetLibrary'
import { makeRng, randRange } from '../utils'
import type { CityData } from '../world/City'

const rng = makeRng(WORLD.SEED + 777)

/** Police cars chase the player, ram them, and shoot at higher wanted levels. */
export class Police {
  cars: VehicleEntity[] = []
  private scene: THREE.Scene
  private city: CityData
  private modelReady = false
  private flashTimer = 0
  private lightBar: THREE.Mesh | null = null

  constructor(scene: THREE.Scene, city: CityData) {
    this.scene = scene
    this.city = city
    getVehicleModel(POLICE_MODEL).then(() => { this.modelReady = true })
  }

  /** How many police cars should be active at this wanted level. */
  targetCount(wanted: number): number {
    return POLICE.PER_LEVEL[Math.min(wanted, POLICE.PER_LEVEL.length - 1)] ?? 0
  }

  spawn(playerPos: THREE.Vector3) {
    if (!this.modelReady) return
    // Spawn on a street near the player.
    const ang = randRange(rng, 0, Math.PI * 2)
    const dist = randRange(rng, 24, 40)
    const x = playerPos.x + Math.cos(ang) * dist
    const z = playerPos.z + Math.sin(ang) * dist
    getVehicleModel(POLICE_MODEL).then((vm) => {
      const heading = Math.atan2(playerPos.x - x, playerPos.z - z)
      const car = new VehicleEntity(POLICE_MODEL, vm, x, z, heading)
      car.police = true
      car.siren = true
      // Flashing light bar.
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, 0.24),
        new THREE.MeshBasicMaterial({ color: 0xff2222 }),
      )
      bar.position.set(0, 1.15, 0)
      bar.name = 'lightbar'
      car.group.add(bar)
      this.scene.add(car.group)
      this.cars.push(car)
    })
  }

  /**
   * @returns damage to the player this frame (from police gunfire).
   */
  update(dt: number, wanted: number, playerPos: THREE.Vector3, playerVehicle: VehicleEntity | null, playerDead: boolean): number {
    const target = this.targetCount(wanted)

    // Spawn/despawn to match wanted level.
    while (this.cars.length < target) this.spawn(playerPos)
    while (this.cars.length > target) {
      const c = this.cars.pop()!
      c.dispose()
    }

    // Flash light bars.
    this.flashTimer += dt * 6
    const flash = Math.sin(this.flashTimer) > 0
    let damage = 0

    for (const car of this.cars) {
      const lightbar = car.group.getObjectByName('lightbar') as THREE.Mesh | null
      if (lightbar) {
        const mat = lightbar.material as THREE.MeshBasicMaterial
        mat.color.setHex(flash ? 0xff2222 : 0x2266ff)
      }

      const dx = playerPos.x - car.pos.x
      const dz = playerPos.z - car.pos.z
      const dist = Math.hypot(dx, dz)
      const desiredHeading = Math.atan2(dx, dz)
      let headingDiff = desiredHeading - car.heading
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2

      // Steer toward player; slow down when very close to ram.
      const steer = Math.max(-1, Math.min(1, headingDiff * 1.8))
      let throttle = 1
      if (dist < 3) throttle = 0.2
      else if (Math.abs(headingDiff) > 1.2) throttle = 0.4

      car.update(dt, throttle, steer, false)

      // Despawn if very far.
      if (dist > 130) {
        car.dispose()
        this.cars.splice(this.cars.indexOf(car), 1)
        continue
      }

      // Shoot at player.
      if (wanted >= POLICE.SHOOT_LEVEL && !playerDead && dist < POLICE.SHOOT_RANGE && Math.abs(headingDiff) < 0.5) {
        if (rng() < dt * 1.2) {
          damage += POLICE.SHOOT_DAMAGE * dt
        }
      }
    }

    return damage
  }

  clear() {
    for (const c of this.cars) c.dispose()
    this.cars = []
  }
}
