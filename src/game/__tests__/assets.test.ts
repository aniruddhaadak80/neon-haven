import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WEAPONS, WEAPON_ORDER } from '../config'
import { TRAFFIC_MODELS, CHARACTER_KEYS, POLICE_MODEL } from '../assets/AssetLibrary'

const MODELS = join(process.cwd(), 'public', 'models')

/**
 * The game references models by name; if prepare-models ever drops one,
 * the game 404s at runtime. This pins the manifest to disk.
 */
describe('asset manifest', () => {
  it('every traffic + police car model exists', () => {
    for (const m of [...TRAFFIC_MODELS, POLICE_MODEL]) {
      expect(existsSync(join(MODELS, 'cars', `${m}.glb`)), `cars/${m}.glb`).toBe(true)
    }
  })

  it('every character model exists', () => {
    for (const c of CHARACTER_KEYS) {
      expect(existsSync(join(MODELS, 'characters', `${c}.glb`)), `characters/${c}.glb`).toBe(true)
    }
  })

  it('every weapon pickup model exists', () => {
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id]!
      if (def.pickupModel) {
        expect(existsSync(join(MODELS, 'blaster', `${def.pickupModel}.glb`)), `blaster/${def.pickupModel}.glb`).toBe(true)
      }
    }
  })

  it('every model group has its texture atlas', () => {
    for (const tex of ['cars-colormap.png', 'blaster-colormap.png']) {
      expect(existsSync(join(MODELS, 'tex', tex)), `tex/${tex}`).toBe(true)
    }
  })

  it('weapon table is internally consistent', () => {
    for (const id of WEAPON_ORDER) {
      const def = WEAPONS[id]!
      expect(def.id).toBe(id)
      expect(def.cooldown).toBeGreaterThan(0)
      expect(def.damage).toBeGreaterThan(0)
      expect(def.range).toBeGreaterThan(0)
    }
    // Pistol needs no pickup; everything else does.
    expect(WEAPONS.pistol!.pickupModel).toBeNull()
  })
})
