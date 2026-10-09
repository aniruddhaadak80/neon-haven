import * as THREE from 'three'
import { MISSIONS, WORLD } from '../config'
import { makeRng, randRange, formatTime, formatDist } from '../utils'
import type { CityData } from '../world/City'
import type { VehicleEntity } from '../entities/Vehicle'
import type { Mission } from '../types'

const rng = makeRng(WORLD.SEED + 31337)
let nextMissionId = 1

/** Procedural missions: delivery, rampage, getaway, taxi. */
export class MissionSystem {
  current: Mission | null = null
  private city: CityData
  private marker: THREE.Group
  private beacon: THREE.Mesh
  private ring: THREE.Mesh
  /** Seconds until the next mission is offered. */
  cooldown = 6

  constructor(scene: THREE.Scene, city: CityData) {
    this.city = city
    this.marker = new THREE.Group()
    // Vertical light pillar.
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    )
    pillar.position.y = 15
    this.marker.add(pillar)
    // Rotating beacon.
    this.beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 }),
    )
    this.beacon.position.y = 2.5
    this.marker.add(this.beacon)
    // Ground ring.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.8, 24),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.05
    this.marker.add(this.ring)
    this.marker.visible = false
    scene.add(this.marker)
  }

  get markerPos(): THREE.Vector3 {
    return this.current ? this.current.marker : new THREE.Vector3()
  }

  private randomStreetPos(): THREE.Vector3 {
    for (let attempt = 0; attempt < 20; attempt++) {
      const i = Math.floor(randRange(rng, 1, this.city.streetsX.length - 1))
      const j = Math.floor(randRange(rng, 1, this.city.streetsZ.length - 1))
      return new THREE.Vector3(this.city.streetsX[i]!, 0, this.city.streetsZ[j]!)
    }
    return this.city.spawn.clone()
  }

  /** Offer a new mission if none is active. */
  maybeOffer(dt: number, playerPos: THREE.Vector3, wanted: number): Mission | null {
    if (this.current) return null
    this.cooldown -= dt
    if (this.cooldown > 0) return null
    this.cooldown = MISSIONS.OFFER_DELAY

    const kinds: Mission['kind'][] = ['delivery', 'rampage', 'getaway', 'taxi']
    const kind = kinds[Math.floor(rng() * kinds.length)]!
    const marker = this.randomStreetPos()
    const dist = marker.distanceTo(playerPos)
    const reward = Math.round(MISSIONS.REWARD_BASE + dist * MISSIONS.REWARD_PER_METER)
    const time = Math.max(MISSIONS.TIME_MIN, dist * MISSIONS.TIME_PER_METER)

    const mission: Mission = {
      id: nextMissionId++,
      kind,
      title: '',
      marker,
      timeLeft: time,
      timeTotal: time,
      targets: [],
      destroyed: 0,
      targetCount: 0,
      phase: 'pickup',
      reward,
      done: false,
    }

    if (kind === 'delivery') {
      mission.title = `Courier run — deliver the package`
      mission.targetCount = 1
    } else if (kind === 'rampage') {
      mission.title = `Rampage — wreck ${3 + Math.floor(rng() * 3)} cars`
      mission.targetCount = 3 + Math.floor(rng() * 3)
    } else if (kind === 'getaway') {
      mission.title = `Getaway — lose the heat and reach the garage`
      mission.targetCount = 1
    } else {
      mission.title = `Taxi — pick up the fare`
      mission.targetCount = 2
    }

    this.current = mission
    this.marker.visible = true
    this.marker.position.copy(marker)
    return mission
  }

  /** Mark a destroyed car if it's a rampage target. */
  notifyCarDestroyed(car: VehicleEntity) {
    if (!this.current || this.current.kind !== 'rampage') return
    if (this.current.targets.includes(car)) {
      this.current.destroyed++
    }
  }

  /** True if the position is at the current objective. */
  atObjective(pos: THREE.Vector3, radius = 3): boolean {
    if (!this.current) return false
    return pos.distanceTo(this.current.marker) < radius
  }

  /**
   * Update the mission. Returns 'done' | 'failed' | null.
   * @param pos player position
   * @param wanted current wanted level
   * @param dt seconds
   */
  update(dt: number, pos: THREE.Vector3, wanted: number): 'done' | 'failed' | null {
    const m = this.current
    if (!m) return null

    this.beacon.rotation.y += dt * 2
    this.beacon.position.y = 2.5 + Math.sin(performance.now() * 0.003) * 0.3
    const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.15
    this.ring.scale.setScalar(pulse)

    m.timeLeft -= dt
    if (m.timeLeft <= 0) {
      this.fail()
      return 'failed'
    }

    const atMarker = this.atObjective(pos)

    if (m.kind === 'delivery' && atMarker) {
      this.complete()
      return 'done'
    }
    if (m.kind === 'getaway' && atMarker && wanted === 0) {
      this.complete()
      return 'done'
    }
    if (m.kind === 'rampage' && m.destroyed >= m.targetCount) {
      this.complete()
      return 'done'
    }
    if (m.kind === 'taxi') {
      if (m.phase === 'pickup' && atMarker) {
        m.phase = 'dropoff'
        m.marker = this.randomStreetPos()
        this.marker.position.copy(m.marker)
        m.title = 'Taxi — drop off the fare'
        m.timeLeft = Math.max(m.timeLeft, m.timeTotal * 0.6)
      } else if (m.phase === 'dropoff' && atMarker) {
        this.complete()
        return 'done'
      }
    }
    return null
  }

  private complete() {
    if (!this.current) return
    this.current.done = true
    this.current = null
    this.marker.visible = false
  }

  private fail() {
    this.current = null
    this.marker.visible = false
  }

  /** HUD text for the current mission. */
  hudText(): { title: string; time: string; dist: string } | null {
    const m = this.current
    if (!m) return null
    let progress = ''
    if (m.kind === 'rampage') progress = ` (${m.destroyed}/${m.targetCount})`
    if (m.kind === 'taxi') progress = m.phase === 'pickup' ? ' — pick up' : ' — drop off'
    return {
      title: `${m.title}${progress}`,
      time: formatTime(m.timeLeft),
      dist: '',
    }
  }

  dispose() {
    this.marker.removeFromParent()
  }
}
