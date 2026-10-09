import * as THREE from 'three'
import { TRAFFIC, WORLD } from '../config'
import { VehicleEntity } from '../entities/Vehicle'
import { getVehicleModel, TRAFFIC_MODELS } from '../assets/AssetLibrary'
import { makeRng, pick, randRange } from '../utils'
import type { CityData } from '../world/City'

const rng = makeRng(WORLD.SEED + 555)

/**
 * AI traffic: cars drive intersection-to-intersection along streets,
 * turning randomly at each junction. They brake for cars ahead.
 */
export class Traffic {
  cars: VehicleEntity[] = []
  private city: CityData
  private scene: THREE.Scene
  private models: string[] = []

  constructor(scene: THREE.Scene, city: CityData) {
    this.scene = scene
    this.city = city
  }

  async init() {
    // Pre-load a few traffic models.
    const keys = [...TRAFFIC_MODELS]
    for (const k of keys.slice(0, 8)) {
      await getVehicleModel(k)
      this.models.push(k)
    }
  }

  private randomIntersectionNear(pos: THREE.Vector3, minD: number, maxD: number): { x: number; z: number; i: number; j: number } {
    for (let attempt = 0; attempt < 20; attempt++) {
      const i = Math.floor(randRange(rng, 1, this.city.streetsX.length - 1))
      const j = Math.floor(randRange(rng, 1, this.city.streetsZ.length - 1))
      const x = this.city.streetsX[i]!
      const z = this.city.streetsZ[j]!
      const d = Math.hypot(x - pos.x, z - pos.z)
      if (d >= minD && d <= maxD) return { x, z, i, j }
    }
    const i = Math.floor(this.city.streetsX.length / 2)
    const j = Math.floor(this.city.streetsZ.length / 2)
    return { x: this.city.streetsX[i]!, z: this.city.streetsZ[j]!, i, j }
  }

  spawn(playerPos: THREE.Vector3) {
    if (this.cars.length >= TRAFFIC.COUNT) return
    const inter = this.randomIntersectionNear(playerPos, 20, TRAFFIC.SPAWN_DIST)
    const model = pick(rng, this.models)
    getVehicleModel(model).then((vm) => {
      if (this.cars.length >= TRAFFIC.COUNT) return
      // Pick a random direction to an adjacent intersection.
      const dirs = [
        { di: 1, dj: 0 }, { di: -1, dj: 0 }, { di: 0, dj: 1 }, { di: 0, dj: -1 },
      ].filter((d) => {
        const ni = inter.i + d.di
        const nj = inter.j + d.dj
        return ni >= 0 && nj >= 0 && ni < this.city.streetsX.length && nj < this.city.streetsZ.length
      })
      const dir = pick(rng, dirs)
      const ni = inter.i + dir.di
      const nj = inter.j + dir.dj
      const tx = this.city.streetsX[ni]!
      const tz = this.city.streetsZ[nj]!
      const heading = Math.atan2(tx - inter.x, tz - inter.z)
      // Right-hand traffic: offset perpendicular to travel direction.
      const lane = TRAFFIC.LANE_OFFSET
      let sx = inter.x
      let sz = inter.z
      if (dir.di === 1) sz = inter.z - lane       // +x: right side is -z
      else if (dir.di === -1) sz = inter.z + lane // -x: right side is +z
      else if (dir.dj === 1) sx = inter.x + lane  // +z: right side is +x
      else sx = inter.x - lane                    // -z: right side is -x
      const car = new VehicleEntity(model, vm, sx, sz, heading)
      car.ai = {
        axis: dir.di !== 0 ? 'x' : 'z',
        dir: (dir.di + dir.dj) as 1 | -1,
        lane: 0.55,
      }
      // Store the lane center so the car stays in its lane.
      car.ai.lane = dir.di !== 0 ? sz : sx
      // Roll out at cruising speed — Vehicle.update derives motion from vel.
      car.vel.set(Math.sin(heading) * TRAFFIC.SPEED * 0.5, 0, Math.cos(heading) * TRAFFIC.SPEED * 0.5)
      car.speed = TRAFFIC.SPEED * 0.5
      this.scene.add(car.group)
      this.cars.push(car)
    })
  }

  update(dt: number, playerPos: THREE.Vector3, playerVehicle: VehicleEntity | null) {
    // Maintain population.
    if (this.cars.length < TRAFFIC.COUNT && rng() < dt * 2) {
      this.spawn(playerPos)
    }

    for (let idx = this.cars.length - 1; idx >= 0; idx--) {
      const car = this.cars[idx]!
      const distToPlayer = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z)

      // Despawn far cars.
      if (distToPlayer > TRAFFIC.DESPAWN_DIST) {
        car.dispose()
        this.cars.splice(idx, 1)
        continue
      }

      // Only simulate near cars.
      if (distToPlayer > TRAFFIC.SPAWN_DIST + 20) continue

      // Waypoint: drive toward the next intersection along current axis.
      const ai = car.ai!
      const spacing = WORLD.SPACING
      let targetX: number
      let targetZ: number
      if (ai.axis === 'x') {
        const k = Math.round((car.pos.x - this.city.origin) / spacing)
        const nextK = k + ai.dir
        targetX = this.city.origin + nextK * spacing
        targetZ = ai.lane
      } else {
        const k = Math.round((car.pos.z - this.city.origin) / spacing)
        const nextK = k + ai.dir
        targetZ = this.city.origin + nextK * spacing
        targetX = ai.lane
      }

      const dx = targetX - car.pos.x
      const dz = targetZ - car.pos.z
      const distToTarget = Math.hypot(dx, dz)

      // Reached the intersection: pick a new direction.
      if (distToTarget < 1.2) {
        const r = rng()
        if (r >= 0.45) {
          // turn: swap axis
          ai.axis = ai.axis === 'x' ? 'z' : 'x'
          ai.dir = rng() < 0.5 ? 1 : -1
        }
        // Snap to the intersection and recompute the lane centre for the new heading.
        const snapI = Math.round((car.pos.x - this.city.origin) / spacing)
        const snapJ = Math.round((car.pos.z - this.city.origin) / spacing)
        const snapX = this.city.origin + snapI * spacing
        const snapZ = this.city.origin + snapJ * spacing
        const lane = TRAFFIC.LANE_OFFSET
        if (ai.axis === 'x') {
          // Driving along x: lane centre is a fixed z.
          car.pos.x = snapX
          car.pos.z = snapZ + (ai.dir === 1 ? -lane : lane)
          ai.lane = car.pos.z
        } else {
          // Driving along z: lane centre is a fixed x.
          car.pos.z = snapZ
          car.pos.x = snapX + (ai.dir === 1 ? lane : -lane)
          ai.lane = car.pos.x
        }
        continue
      }

      // Steer toward target.
      const desiredHeading = Math.atan2(dx, dz)
      let headingDiff = desiredHeading - car.heading
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2
      const steer = Math.max(-1, Math.min(1, headingDiff * 2))

      // Brake if a car is ahead.
      let throttle = 0.6
      const ahead = this.carAhead(car, playerVehicle)
      if (ahead < TRAFFIC.BRAKE_DIST) {
        throttle = ahead < TRAFFIC.BRAKE_DIST * 0.5 ? -0.5 : 0
      }

      car.update(dt, throttle, steer, false)
    }
  }

  private carAhead(car: VehicleEntity, playerVehicle: VehicleEntity | null): number {
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    let minDist = Infinity
    const check = (ox: number, oz: number) => {
      const dx = ox - car.pos.x
      const dz = oz - car.pos.z
      const along = dx * fx + dz * fz
      if (along > 0 && along < minDist) {
        const perp = Math.abs(dx * fz - dz * fx)
        if (perp < 1.2) minDist = along
      }
    }
    for (const other of this.cars) {
      if (other !== car) check(other.pos.x, other.pos.z)
    }
    if (playerVehicle) check(playerVehicle.pos.x, playerVehicle.pos.z)
    return minDist
  }

  clear() {
    for (const c of this.cars) c.dispose()
    this.cars = []
  }
}
