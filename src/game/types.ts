import * as THREE from 'three'

/** A drivable car instance in the world. */
export interface Vehicle {
  id: number
  model: string
  group: THREE.Group
  body: THREE.Mesh
  wheels: THREE.Mesh[]
  /** World position of the car centre. */
  pos: THREE.Vector3
  /** Yaw in radians. */
  heading: number
  /** Signed forward speed (units/s). */
  speed: number
  /** Lateral velocity for drift. */
  latVel: number
  steer: number
  health: number
  dead: boolean
  /** True while the player is driving this car. */
  driven: boolean
  /** AI state for traffic cars. */
  ai: { axis: 'x' | 'z'; dir: 1 | -1; lane: number } | null
  /** Police cars flash their light bar. */
  police: boolean
  siren: boolean
  /** Visual: body roll/pitch. */
  roll: number
  pitch: number
  /** Headlight spotlights (player + nearby police only). */
  headlights: THREE.SpotLight | null
  blob: THREE.Mesh
}

export interface Ped {
  id: number
  group: THREE.Group
  mixer: THREE.AnimationMixer
  pos: THREE.Vector3
  heading: number
  speed: number
  state: 'walk' | 'flee' | 'dead'
  target: THREE.Vector3
  fleeTimer: number
  anim: string
  deadTimer: number
}

export interface Bullet {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  fromPlayer: boolean
  mesh: THREE.Mesh
}

export interface Mission {
  id: number
  kind: 'delivery' | 'rampage' | 'getaway' | 'taxi'
  title: string
  /** Objective marker position. */
  marker: THREE.Vector3
  timeLeft: number
  timeTotal: number
  /** Rampage: cars to destroy. */
  targets: Vehicle[]
  destroyed: number
  targetCount: number
  /** Taxi: pickup then dropoff. */
  phase: 'pickup' | 'dropoff'
  reward: number
  done: boolean
}

export interface SaveData {
  money: number
  xp: number
  level: number
  stats: {
    distance: number
    crimes: number
    jobs: number
    carsDestroyed: number
    pedsHit: number
  }
  bestWanted: number
}

export type GamePhase = 'menu' | 'loading' | 'playing' | 'paused' | 'dead'
