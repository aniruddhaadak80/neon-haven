// Central tuning for NEON HAVEN. Everything gameplay-related lives here so the
// feel of the game can be adjusted without hunting through systems.

export const WORLD = {
  /** City is BLOCKS x BLOCKS blocks, separated by streets every SPACING tiles. */
  BLOCKS: 10,
  SPACING: 8,
  /** Road tiles are used at native scale; streets are 2 tiles wide. */
  ROAD_SCALE: 1.0,
  /** Kenney car kit is ~2.75 units long; scale to ~1.65 for our streets. */
  CAR_SCALE: 0.6,
  /** Blocky characters are ~1.8 units tall natively. */
  CHAR_SCALE: 0.55,
  /** Deterministic city layout. */
  SEED: 20261009,
  /** World units per meter (for HUD readouts). */
  UNITS_PER_METER: 1.4,
} as const

export const CAR = {
  ACCEL: 14,
  BRAKE: 22,
  REVERSE_ACCEL: 8,
  MAX_SPEED: 26,
  MAX_REVERSE: 8,
  DRAG: 0.6,
  ROLL_RESIST: 2.5,
  GRIP: 9,
  HANDBRAKE_GRIP: 1.6,
  STEER_RATE: 2.4,
  STEER_MAX: 0.62,
  STEER_SPEED_REF: 9,
  /** Collision radius multiplier on the car's half-width. */
  RADIUS: 0.62,
  HEALTH: 100,
  EXPLODE_AT: 0,
} as const

export const PLAYER = {
  WALK_SPEED: 3.4,
  SPRINT_SPEED: 6.2,
  ACCEL: 40,
  FRICTION: 12,
  JUMP_VEL: 5.2,
  GRAVITY: 14,
  HEIGHT: 1.55,
  RADIUS: 0.32,
  HEALTH: 100,
  ARMOR: 0,
  ENTER_CAR_DIST: 3.4,
  SHOOT_COOLDOWN: 0.22,
  SHOOT_RANGE: 60,
  SHOOT_DAMAGE: 34,
} as const

export const TRAFFIC = {
  COUNT: 16,
  SPEED: 7.5,
  SPAWN_DIST: 70,
  DESPAWN_DIST: 110,
  LANE_OFFSET: 0.55,
  BRAKE_DIST: 3.2,
} as const

export const PEDS = {
  COUNT: 22,
  WALK_SPEED: 1.4,
  FLEE_SPEED: 4.2,
  SPAWN_DIST: 60,
  DESPAWN_DIST: 95,
  FLEE_CAR_DIST: 4.5,
} as const

export const POLICE = {
  /** Max simultaneous police cars per wanted level. */
  PER_LEVEL: [0, 1, 2, 3, 4, 6],
  SPEED: 24,
  RAM_DAMAGE: 9,
  SHOOT_LEVEL: 3,
  SHOOT_COOLDOWN: 0.9,
  SHOOT_DAMAGE: 7,
  SHOOT_RANGE: 26,
  /** Distance at which the player is "seen". */
  SIGHT: 46,
  /** Seconds out of sight before heat starts dropping. */
  LOSE_SIGHT_TIME: 9,
  /** Seconds of no-sight needed to drop one star. */
  DROP_TIME: 14,
} as const

export const WANTED = {
  /** Crime points needed per star (cumulative). */
  THRESHOLDS: [0, 100, 260, 520, 900, 1500],
  HIT_PED: 120,
  HIT_CAR: 60,
  STEAL_CAR: 90,
  SHOOT: 40,
  DESTROY_CAR: 150,
  /** Points decay per second while not committing crimes. */
  DECAY: 6,
} as const

export const MISSIONS = {
  /** Seconds between auto-offered missions when idle. */
  OFFER_DELAY: 26,
  REWARD_BASE: 220,
  REWARD_PER_METER: 0.9,
  TIME_PER_METER: 0.055,
  TIME_MIN: 35,
} as const

export const DAYNIGHT = {
  /** Seconds for a full day cycle. */
  DAY_LENGTH: 360,
  START_HOUR: 20.0, // start at night — neon city
} as const

export const CAMERA = {
  FOOT_DIST: 4.6,
  FOOT_HEIGHT: 1.9,
  CAR_DIST: 7.2,
  CAR_HEIGHT: 2.6,
  FOV: 62,
  FOV_SPEED_KICK: 14,
  NEAR: 0.1,
  FAR: 420,
} as const

export const RENDER = {
  MAX_DPR: 1.6,
  FOG_NEAR: 60,
  FOG_FAR: 300,
} as const

export const AUDIO = {
  MASTER: 0.5,
  ENGINE: 0.35,
  SIREN: 0.3,
  RADIO: 0.22,
} as const

export const SAVE_KEY = 'neon-haven-save-v1'

/**
 * Sub-path the site is served from (GitHub Pages project sites live under
 * `/<repo>`). Empty for local dev and Vercel. Set via NEXT_PUBLIC_BASE_PATH.
 */
export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Prefix a public/ URL so models/textures resolve under a sub-path deploy. */
export function assetUrl(path: string): string {
  return `${ASSET_BASE}${path}`
}

export interface WeaponDef {
  id: string
  name: string
  /** Blaster model used for the floating pickup mesh. Null = fists/pistol (no pickup). */
  pickupModel: string | null
  cooldown: number
  damage: number
  range: number
  /** Gunshot pitch multiplier. */
  pitch: number
  /** Tracer/spark color. */
  tracer: number
  shake: number
}

/** Pistol is owned from the start; the rest are found as pickups in the city. */
export const WEAPONS: Record<string, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Pistol', pickupModel: null, cooldown: 0.22, damage: 34, range: 60, pitch: 1, tracer: 0xffcc55, shake: 0.15 },
  smg: { id: 'smg', name: 'SMG', pickupModel: 'blaster-a', cooldown: 0.11, damage: 16, range: 50, pitch: 1.5, tracer: 0x00e5ff, shake: 0.08 },
  rifle: { id: 'rifle', name: 'Rifle', pickupModel: 'blaster-g', cooldown: 0.35, damage: 65, range: 80, pitch: 0.7, tracer: 0xffea00, shake: 0.22 },
  heavy: { id: 'heavy', name: 'Heavy', pickupModel: 'blaster-p', cooldown: 0.7, damage: 120, range: 70, pitch: 0.45, tracer: 0xff2d95, shake: 0.35 },
}

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'heavy'] as const

export const PICKUPS = {
  /** Floating weapon pickups scattered through the city. */
  COUNT: 6,
  RESPAWN_TIME: 45,
  PICKUP_DIST: 1.8,
} as const
