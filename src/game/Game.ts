import * as THREE from 'three'
import { WORLD, PLAYER, CAR, PEDS, POLICE, RENDER, CAMERA, SAVE_KEY, WANTED, WEAPONS, WEAPON_ORDER, PICKUPS, MELEE, STREAK, NITRO, PAYNSPRAY, DRIFT, ACHIEVEMENTS, type AchievementId } from './config'
import { Input } from './input'
import { buildCity, resolveCollision, isBlocked, type CityData } from './world/City'
import { Player, createPlayer } from './entities/Player'
import { VehicleEntity } from './entities/Vehicle'
import { PedEntity, createPed } from './entities/Ped'
import { DayNight } from './systems/DayNight'
import { GameAudio } from './systems/Audio'
import { Particles } from './systems/Particles'
import { Traffic } from './systems/Traffic'
import { Police } from './systems/Police'
import { WantedSystem } from './systems/Wanted'
import { MissionSystem } from './systems/Missions'
import { DriftScorer } from './systems/Drift'
import { Achievements } from './systems/Achievements'
import { hud } from './systems/HudStore'
import { getVehicleModel, TRAFFIC_MODELS, CHARACTER_KEYS, getStaticGeometry, getTexture } from './assets/AssetLibrary'
import { clamp, damp, dist2D, formatDist } from './utils'
import type { SaveData } from './types'

interface Shard {
  group: THREE.Group
  pos: THREE.Vector3
  active: boolean
  respawn: number
  phase: number
  kind: 'armor' | 'health' | 'bribe'
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private input: Input
  private city: CityData | null = null
  private player!: Player
  private vehicles: VehicleEntity[] = []
  private peds: PedEntity[] = []
  private traffic!: Traffic
  private police!: Police
  private wanted = new WantedSystem()
  private missions!: MissionSystem
  private dayNight: DayNight
  private audio = new GameAudio()
  private particles: Particles
  private raf = 0
  private lastTime = 0
  private disposed = false

  // Camera state
  private camYaw = 0
  private camPitch = 0.25
  private camPos = new THREE.Vector3()
  private camTarget = new THREE.Vector3()
  private camShake = 0

  private save: SaveData
  private startTime = 0
  private stats = { distance: 0, crimes: 0, jobs: 0, carsDestroyed: 0, pedsHit: 0 }
  private bestWanted = 0
  private minimapCanvas: HTMLCanvasElement | null = null
  private bigMapCanvas: HTMLCanvasElement | null = null
  private minimapTimer = 0
  /** Owned weapon ids. Pistol is always owned. */
  private ownedWeapons: string[] = ['pistol']
  private weapon = 'pistol'
  private pickups: { group: THREE.Group; ring: THREE.Mesh; pos: THREE.Vector3; weapon: string; active: boolean; respawn: number; phase: number }[] = []
  private armorPickups: Shard[] = []
  private healthPickups: Shard[] = []
  private bribePickups: Shard[] = []
  /** Kill-streak state for XP bonuses. */
  private streak = 0
  private streakTimer = 0
  private meleeTimer = 0
  /** Drift-combo scorer + achievement unlocks. */
  private drift = new DriftScorer()
  private achievements = new Achievements()
  /** Pay'n'Spray garage marker + enter-edge tracking. */
  private garage: THREE.Group | null = null
  private garageInside = false

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_DPR))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR)
    this.input = new Input(canvas)
    this.particles = new Particles()
    this.scene.add(this.particles.points)
    this.dayNight = new DayNight(this.scene)

    this.save = this.loadSave()
    this.stats = { ...this.save.stats }
    this.bestWanted = this.save.bestWanted
    this.achievements = new Achievements(this.save.achievements)

    this.input.onPause = () => {
      if (hud.state.phase === 'playing') this.pause()
      else if (hud.state.phase === 'paused') this.resume()
    }
    this.input.onMap = (down) => {
      hud.set({ mapOpen: down })
    }
    this.input.onStats = (down) => {
      hud.set({ statsOpen: down })
    }

    window.addEventListener('resize', this.onResize)
  }

  // --- Save / load ---
  private loadSave(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw) return JSON.parse(raw) as SaveData
    } catch { /* ignore */ }
    return {
      money: 0, xp: 0, level: 1,
      stats: { distance: 0, crimes: 0, jobs: 0, carsDestroyed: 0, pedsHit: 0 },
      bestWanted: 0,
      achievements: [],
    }
  }

  private persist() {
    this.save = {
      money: this.save.money,
      xp: this.save.xp,
      level: this.save.level,
      stats: { ...this.stats },
      bestWanted: this.bestWanted,
      achievements: this.achievements.ids,
    }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)) } catch { /* ignore */ }
  }

  // --- Lifecycle ---
  private starting = false
  async start() {
    // Guard against double-clicks / StrictMode re-entry.
    if (this.starting || hud.state.phase === 'playing') return
    this.starting = true
    hud.set({ phase: 'loading', loadFrac: 0, loadLabel: 'waking up' })
    try {
      await this.load()
    } catch (err) {
      this.starting = false
      hud.set({ phase: 'menu' })
      hud.toast(`Failed to start: ${err instanceof Error ? err.message : String(err)}`, 'bad')
      throw err
    }
    hud.set({ phase: 'playing' })
    this.audio.start()
    this.startTime = performance.now()
    this.lastTime = performance.now()
    this.input.requestLock()
    this.loop()
  }

  private async load() {
    // City
    this.city = await buildCity((frac, label) => hud.set({ loadFrac: frac * 0.7, loadLabel: label }))
    this.scene.add(this.city.group)
    this.dayNight.registerNeon(this.city.neon)
    this.traffic = new Traffic(this.scene, this.city)
    this.police = new Police(this.scene, this.city)
    this.missions = new MissionSystem(this.scene, this.city)
    await this.traffic.init()

    // Player
    hud.set({ loadFrac: 0.72, loadLabel: 'spawning player' })
    this.player = await createPlayer()
    this.player.pos.copy(this.city.spawn)
    this.scene.add(this.player.group)

    // Preload player character + a few peds
    hud.set({ loadFrac: 0.78, loadLabel: 'loading citizens' })
    for (const k of CHARACTER_KEYS.slice(0, 6)) {
      const { getCharacter } = await import('./assets/AssetLibrary')
      await getCharacter(k)
    }

    // Peds
    hud.set({ loadFrac: 0.85, loadLabel: 'raising pedestrians' })
    for (let i = 0; i < PEDS.COUNT; i++) {
      const pos = this.randomSidewalkPos(this.city.spawn, 10, PEDS.SPAWN_DIST)
      const ped = await createPed(pos.x, pos.z)
      this.peds.push(ped)
      this.scene.add(ped.group)
    }

    // A few parked cars
    hud.set({ loadFrac: 0.92, loadLabel: 'parking cars' })
    for (let i = 0; i < 6; i++) {
      const model = TRAFFIC_MODELS[i % TRAFFIC_MODELS.length]!
      const vm = await getVehicleModel(model)
      const pos = this.randomSidewalkPos(this.city.spawn, 8, 40)
      const car = new VehicleEntity(model, vm, pos.x, pos.z, Math.random() * Math.PI * 2)
      this.vehicles.push(car)
      this.scene.add(car.group)
    }

    // Weapon pickups scattered through the city
    hud.set({ loadFrac: 0.96, loadLabel: 'hiding weapons' })
    await this.spawnPickups()
    this.spawnArmor()
    this.buildGarage()

    // Snap the camera to the spawn so the first frame isn't a cross-map swoop.
    this.camPos.set(this.city.spawn.x, CAMERA.FOOT_HEIGHT + 1, this.city.spawn.z - CAMERA.FOOT_DIST)
    this.camTarget.copy(this.city.spawn).add(new THREE.Vector3(0, 1.4, 0))

    hud.set({ loadFrac: 1, loadLabel: 'done' })
  }

  private async spawnPickups() {
    const defs = Object.values(WEAPONS).filter((w) => w.pickupModel)
    // 2 of each pickup weapon, spread across the map
    const queue: string[] = []
    for (const d of defs) queue.push(d.id, d.id)
    const blasterTex = getTexture('blaster')
    for (let i = 0; i < PICKUPS.COUNT && i < queue.length * 3; i++) {
      const weapon = queue[i % queue.length]!
      const def = WEAPONS[weapon]!
      const geo = await getStaticGeometry('blaster', def.pickupModel!)
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: blasterTex }))
      mesh.scale.setScalar(1.4)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.65, 24),
        new THREE.MeshBasicMaterial({ color: def.tracer, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.05
      const group = new THREE.Group()
      mesh.position.y = 0.8
      // Blasters point along +z natively; lay flat for display
      mesh.rotation.x = -Math.PI / 2 + 0.4
      group.add(mesh, ring)
      const pos = this.randomSidewalkPos(this.city!.spawn, 12, 70)
      group.position.copy(pos)
      this.scene.add(group)
      this.pickups.push({ group, ring, pos, weapon, active: true, respawn: 0, phase: Math.random() * Math.PI * 2 })
    }
  }

  private randomSidewalkPos(center: THREE.Vector3, minD: number, maxD: number): THREE.Vector3 {
    const city = this.city!
    // Prefer street tiles: they are never blocked, so spawns are always valid.
    for (let attempt = 0; attempt < 40; attempt++) {
      const i = Math.floor(Math.random() * city.size)
      const j = Math.floor(Math.random() * city.size)
      const x = city.origin + i + 0.5
      const z = city.origin + j + 0.5
      if (isBlocked(city, x, z)) continue
      const d = Math.hypot(x - center.x, z - center.z)
      if (d >= minD && d <= maxD) return new THREE.Vector3(x, 0, z)
    }
    // Fall back to a random street intersection.
    const sx = city.streetsX[Math.floor(Math.random() * city.streetsX.length)]!
    const sz = city.streetsZ[Math.floor(Math.random() * city.streetsZ.length)]!
    return new THREE.Vector3(sx, 0, sz)
  }

  pause() {
    hud.set({ phase: 'paused' })
    this.input.exitLock()
    this.audio.stopEngine()
    this.audio.setSiren(false)
  }

  resume() {
    hud.set({ phase: 'playing' })
    this.input.requestLock()
    if (this.player.isDriving) this.audio.startEngine()
  }

  // --- Main loop ---
  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    dt = Math.min(dt, 0.05)

    if (hud.state.phase === 'playing') {
      this.update(dt)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number) {
    const input = this.input.state

    // --- Look ---
    if (input.locked) {
      this.camYaw -= input.lookX * 0.0022
      this.camPitch = clamp(this.camPitch + input.lookY * 0.0022, -0.5, 1.1)
    }

    // --- Player ---
    if (this.player.isDriving) {
      this.updateDriving(dt)
    } else {
      this.updateOnFoot(dt)
    }

    // --- Drift combo (banks when the drift ends or you leave the car) ---
    this.updateDrift(dt)

    // --- Weapon switching (1-4) ---
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (this.input.consume(`weapon${i + 1}`)) {
        const id = WEAPON_ORDER[i]!
        if (this.ownedWeapons.includes(id)) {
          this.weapon = id
          hud.toast(`${WEAPONS[id]!.name} equipped`, 'info')
        } else {
          hud.toast(`Find the ${WEAPONS[id]!.name} pickup first`, 'info')
        }
      }
    }

    // --- Radio (R toggle, T next station) ---
    if (this.input.consume('radio')) this.toggleRadio()
    if (this.input.consume('station')) {
      this.nextRadioStation()
      hud.toast(`Radio ${this.audio.radioStation + 1}`, 'info')
    }

    // --- Pickups ---
    this.updatePickups(dt)

    // --- Pay'n'Spray garage ---
    this.updateGarage(dt)

    // --- Undercover: stolen cop car scrubs heat faster ---
    if (this.player.vehicle?.police && this.wanted.level > 0) {
      this.wanted.coolDown(WANTED.UNDERCOVER_DECAY * dt)
    }

    // --- Camera ---
    this.updateCamera(dt)

    // --- World systems ---
    this.traffic.update(dt, this.player.pos, this.player.vehicle)
    const policeDamage = this.police.update(dt, this.wanted.level, this.player.pos, this.player.vehicle, this.player.dead)
    if (policeDamage > 0 && !this.player.dead) {
      if (this.player.isDriving && this.player.vehicle) {
        // Gunfire chews up the getaway car first.
        const destroyed = this.player.vehicle.damageBy(policeDamage)
        if (destroyed) this.onCarDestroyed(this.player.vehicle)
      } else {
        this.damagePlayer(policeDamage)
      }
    }
    // Cars (traffic + police) hitting the on-foot player.
    this.updatePlayerRunover(dt)
    this.updatePeds(dt)
    this.updateVehicleCollisions()
    this.updateBullets()
    const missionResult = this.missions.update(dt, this.player.pos, this.wanted.level)
    if (missionResult === 'done') this.completeMission()
    else if (missionResult === 'failed') this.failMission()
    else if (!this.missions.current) {
      const offered = this.missions.maybeOffer(dt, this.player.pos, this.wanted.level)
      if (offered) {
        hud.toast(`New job: ${offered.title} — $${offered.reward}`, 'info')
        if (offered.kind === 'hit') {
          // The mark gets a real pedestrian wandering near the marker.
          createPed(offered.marker.x + 2, offered.marker.z + 2).then((target) => {
            if (this.disposed) return
            // Still the same mission? Otherwise discard the extra.
            if (this.missions.current !== offered) {
              target.dispose()
              return
            }
            this.peds.push(target)
            this.scene.add(target.group)
            this.missions.setTarget(target, target.id)
            hud.toast('The target is marked — check the map', 'bad')
          })
        }
      }
    }
    this.dayNight.update(dt, this.camPos)
    this.particles.update(dt)

    // --- Wanted ---
    const policeNear = this.police.cars.some(
      (c) => dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < POLICE.SIGHT,
    )
    this.wanted.update(dt, policeNear)
    if (this.wanted.level > this.bestWanted) {
      this.bestWanted = this.wanted.level
      if (this.bestWanted >= 5) this.award('five_star')
    }

    // --- Audio ---
    if (this.player.isDriving && this.player.vehicle) {
      this.audio.updateEngine(Math.abs(this.player.vehicle.speed) / CAR.MAX_SPEED, 0.5)
    } else {
      this.audio.updateEngine(0, 0)
    }
    // Sirens wail while any cop car is hunting you.
    this.audio.setSiren(this.police.cars.length > 0 && this.wanted.level > 0)
    this.audio.updateSiren(performance.now() / 1000)

    // Headlights at night: player car + nearby cruisers + nearby traffic.
    const night = this.dayNight.isNight
    if (this.player.vehicle) this.player.vehicle.setHeadlights(night)
    for (const v of this.vehicles) {
      if (v !== this.player.vehicle && v.headlights) v.setHeadlights(false)
    }
    for (const c of this.police.cars) {
      const near = dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < 60
      c.setHeadlights(night && near)
    }
    for (const c of this.traffic.cars) {
      const near = dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < 45
      c.setHeadlights(night && near)
    }

    // --- HUD ---
    this.updateHud(dt)
    this.input.endFrame()

    // --- Streak decay ---
    this.streakTimer = Math.max(0, this.streakTimer - dt)
    if (this.streakTimer <= 0) this.streak = 0
    this.meleeTimer = Math.max(0, this.meleeTimer - dt)

    // --- Minimap + fullscreen map (throttled) ---
    this.minimapTimer -= dt
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1
      this.drawMinimap()
      if (hud.state.mapOpen) this.drawBigMap()
    }

    // --- Persist occasionally ---
    if (Math.floor(performance.now() / 1000) % 30 === 0) this.persist()
  }

  // --- On foot ---
  private updateOnFoot(dt: number) {
    const input = this.input.state
    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + (input.touch.active ? -input.touch.y : 0)
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.touch.active ? input.touch.x : 0)
    this.player.updateOnFoot(dt, { f, s, sprint: input.sprint, jump: this.input.consume('jump') }, this.camYaw)

    // Building collision
    const [nx, nz] = resolveCollision(this.city!, this.player.pos.x, this.player.pos.z, PLAYER.RADIUS)
    this.player.pos.x = nx
    this.player.pos.z = nz

    // World bounds
    const b = this.city!.bounds
    this.player.pos.x = clamp(this.player.pos.x, -b, b)
    this.player.pos.z = clamp(this.player.pos.z, -b, b)

    // Enter vehicle (keyboard F, or touch USE button via the 'interact' edge)
    if (this.input.consume('interact')) {
      this.tryEnterVehicle()
    }

    // Shoot
    if ((input.shoot || input.touch.fire) && this.player.shootTimer <= 0) {
      this.player.shootTimer = WEAPONS[this.weapon]!.cooldown
      this.shootFromPlayer()
    }
    this.player.shootTimer = Math.max(0, this.player.shootTimer - dt)

    // Melee (E key / touch PUNCH)
    if (this.input.consume('melee') && this.meleeTimer <= 0) {
      this.meleeTimer = MELEE.COOLDOWN
      this.meleeAttack()
    }
  }

  /** Punch/kick arc in front of the player. Quiet, personal, no gunshot heat. */
  private meleeAttack() {
    this.player.playOverride('attack-melee-right', 0.45)
    this.audio.impact(0.35)
    this.camShake = Math.min(1, this.camShake + 0.08)
    const fx = Math.sin(this.player.heading)
    const fz = Math.cos(this.player.heading)
    let hitSomething = false

    for (const ped of this.peds) {
      if (ped.state === 'dead') continue
      const dx = ped.pos.x - this.player.pos.x
      const dz = ped.pos.z - this.player.pos.z
      const d = Math.hypot(dx, dz)
      if (d > MELEE.RANGE) continue
      const dot = (dx * fx + dz * fz) / (d || 1)
      if (dot < Math.cos(MELEE.ARC)) continue
      hitSomething = true
      hud.set({ hitmarker: performance.now() })
      this.killPed(ped, ped.pos.clone().setY(1))
    }

    for (const car of [...this.vehicles, ...this.traffic.cars, ...this.police.cars]) {
      if (car.dead) continue
      const dx = car.pos.x - this.player.pos.x
      const dz = car.pos.z - this.player.pos.z
      const d = Math.hypot(dx, dz)
      if (d > MELEE.RANGE + 0.6) continue
      const dot = (dx * fx + dz * fz) / (d || 1)
      if (dot < Math.cos(MELEE.ARC)) continue
      hitSomething = true
      hud.set({ hitmarker: performance.now() })
      this.particles.sparks(car.pos.clone().setY(0.6), 5)
      const destroyed = car.damageBy(MELEE.CAR_DAMAGE)
      if (destroyed) {
        this.onCarDestroyed(car, true)
        this.wanted.addCrime(WANTED.DESTROY_CAR)
        this.stats.crimes++
      }
    }

    if (!hitSomething) {
      // Whiff: tiny puff of dust so the swing reads.
      const tip = this.player.pos.clone().add(new THREE.Vector3(fx * 1.2, 0.9, fz * 1.2))
      this.particles.burst(tip, 3, 0x888899, 1.5, 0.3, 0.7, 2, 0.4)
    }
  }

  private tryEnterVehicle() {
    let best: VehicleEntity | null = null
    let bestD: number = PLAYER.ENTER_CAR_DIST
    // Any car is fair game: parked, traffic, even police.
    const candidates = [...this.vehicles, ...this.traffic.cars, ...this.police.cars]
    for (const v of candidates) {
      if (v.dead || v.driven) continue
      const d = dist2D(v.pos.x, v.pos.z, this.player.pos.x, this.player.pos.z)
      if (d < bestD) { bestD = d; best = v }
    }
    if (best) {
      // Carjacked out of traffic: pull it out of the AI fleets.
      this.removeFromFleets(best)
      if (!this.vehicles.includes(best)) this.vehicles.push(best)
      this.player.enterVehicle(best)
      this.audio.startEngine()
      this.wanted.addCrime(WANTED.STEAL_CAR)
      this.stats.crimes++
      hud.toast(best.police ? 'You stole a cop car!' : `Driving ${best.model}`, best.police ? 'bad' : 'info')
    }
  }

  private removeFromFleets(v: VehicleEntity) {
    const t = this.traffic.cars.indexOf(v)
    if (t >= 0) this.traffic.cars.splice(t, 1)
    const p = this.police.cars.indexOf(v)
    if (p >= 0) this.police.cars.splice(p, 1)
  }

  // --- Driving ---
  private updateDriving(dt: number) {
    const v = this.player.vehicle!
    const input = this.input.state

    // Wreck destroyed under you → bail out with burns.
    if (v.dead) {
      this.player.exitVehicle()
      this.audio.stopEngine()
      this.audio.explosion()
      this.particles.explosion(v.pos.clone().setY(0.6))
      this.damagePlayer(25)
      hud.toast('Your ride blew up!', 'bad')
      return
    }

    const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + (input.touch.active ? -input.touch.y : 0)
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0) + (input.touch.active ? -input.touch.x : 0)
    const handbrake = input.handbrake || input.touch.brake

    // Nitro: Shift (or touch NITRO) while moving forward burns the meter.
    const wantBoost = (input.sprint || input.touch.nitro) && throttle > 0 && v.nitro > 0
    if (wantBoost) {
      v.nitro = Math.max(0, v.nitro - NITRO.DRAIN * dt)
      const back = new THREE.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading))
      const flames = v.pos.clone().addScaledVector(back, -v.halfL).setY(0.5)
      this.particles.burst(flames, 3, 0x33ccff, 4, 0.25, 1.1, -2, 0.2)
      this.camShake = Math.min(1, this.camShake + dt * 1.2)
    } else {
      v.nitro = Math.min(NITRO.MAX, v.nitro + NITRO.REGEN * dt)
    }

    v.update(dt, clamp(throttle * (wantBoost ? NITRO.MULT : 1), -1, NITRO.MULT), clamp(steer, -1, 1), handbrake, wantBoost ? NITRO.MULT : 1)

    // Building collision
    const [nx, nz] = resolveCollision(this.city!, v.pos.x, v.pos.z, Math.max(v.halfW, v.halfL) * 0.7)
    if (Math.abs(nx - v.pos.x) > 0.001 || Math.abs(nz - v.pos.z) > 0.001) {
      // Crashed into a building.
      const impact = Math.hypot(v.vel.x, v.vel.z)
      if (impact > 4) {
        v.damageBy(impact * 1.2)
        this.audio.impact(impact / 10)
        this.camShake = Math.min(1, impact / 15)
        this.particles.sparks(v.pos.clone().setY(0.5), 6)
      }
      v.pos.x = nx
      v.pos.z = nz
      v.vel.multiplyScalar(0.4)
    }

    // World bounds
    const b = this.city!.bounds
    v.pos.x = clamp(v.pos.x, -b, b)
    v.pos.z = clamp(v.pos.z, -b, b)

    // Run over peds
    for (const ped of this.peds) {
      if (ped.state === 'dead') continue
      if (dist2D(ped.pos.x, ped.pos.z, v.pos.x, v.pos.z) < Math.max(v.halfW, v.halfL) + 0.3) {
        if (Math.abs(v.speed) > 2) {
          hud.set({ hitmarker: performance.now() })
          this.killPed(ped, ped.pos.clone().setY(0.8))
        }
      }
    }

    // Distance stat
    this.stats.distance += Math.abs(v.speed) * dt

    // Exit vehicle (keyboard F, or touch USE button via the 'interact' edge)
    if (this.input.consume('interact')) {
      this.player.exitVehicle()
      this.audio.stopEngine()
    }

    // Drive-by shooting
    if ((input.shoot || input.touch.fire) && this.player.shootTimer <= 0) {
      this.player.shootTimer = WEAPONS[this.weapon]!.cooldown
      this.shootFromPlayer()
    }
    this.player.shootTimer = Math.max(0, this.player.shootTimer - dt)
  }

  // --- Camera ---
  private updateCamera(dt: number) {
    const targetPos = this.player.isDriving && this.player.vehicle
      ? this.player.vehicle.pos
      : this.player.pos

    if (this.player.isDriving && this.player.vehicle) {
      // Chase cam
      const v = this.player.vehicle
      const back = new THREE.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading)).multiplyScalar(-CAMERA.CAR_DIST)
      const desired = targetPos.clone().add(back).add(new THREE.Vector3(0, CAMERA.CAR_HEIGHT, 0))
      this.camPos.x = damp(this.camPos.x, desired.x, 6, dt)
      this.camPos.y = damp(this.camPos.y, desired.y, 6, dt)
      this.camPos.z = damp(this.camPos.z, desired.z, 6, dt)
      this.camTarget.lerp(targetPos.clone().add(new THREE.Vector3(0, 1.2, 0)), 1 - Math.exp(-10 * dt))
      this.camYaw = v.heading
      // FOV kick
      const targetFov = CAMERA.FOV + Math.abs(v.speed) / CAR.MAX_SPEED * CAMERA.FOV_SPEED_KICK
      this.camera.fov = damp(this.camera.fov, targetFov, 4, dt)
    } else {
      // Orbit cam
      const sin = Math.sin(this.camYaw)
      const cos = Math.cos(this.camYaw)
      const desired = new THREE.Vector3(
        targetPos.x - sin * CAMERA.FOOT_DIST * Math.cos(this.camPitch),
        targetPos.y + CAMERA.FOOT_HEIGHT + Math.sin(this.camPitch) * CAMERA.FOOT_DIST,
        targetPos.z - cos * CAMERA.FOOT_DIST * Math.cos(this.camPitch),
      )
      this.camPos.x = damp(this.camPos.x, desired.x, 14, dt)
      this.camPos.y = damp(this.camPos.y, desired.y, 14, dt)
      this.camPos.z = damp(this.camPos.z, desired.z, 14, dt)
      this.camTarget.lerp(targetPos.clone().add(new THREE.Vector3(0, 1.4, 0)), 1 - Math.exp(-12 * dt))
      this.camera.fov = damp(this.camera.fov, CAMERA.FOV, 4, dt)
    }

    // Camera shake
    this.camShake = damp(this.camShake, 0, 6, dt)
    const shake = this.camShake * 0.15
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake,
    ))
    this.camera.lookAt(this.camTarget)
  }

  // --- Player damage + death ---
  private damagePlayer(amount: number) {
    if (this.player.dead) return
    hud.set({ damageFlash: Math.min(1, hud.state.damageFlash + 0.45) })
    const died = this.player.damageBy(amount)
    if (died) this.onPlayerDeath()
  }

  /** Fast AI cars plough into the on-foot player. */
  private updatePlayerRunover(dt: number) {
    if (this.player.dead || this.player.isDriving) return
    for (const car of [...this.traffic.cars, ...this.police.cars]) {
      if (car.dead) continue
      const r = Math.max(car.halfW, car.halfL) * 0.8 + PLAYER.RADIUS
      if (dist2D(car.pos.x, car.pos.z, this.player.pos.x, this.player.pos.z) < r) {
        const speed = Math.hypot(car.vel.x, car.vel.z)
        if (speed > 3) {
          this.damagePlayer(speed * 2.2 * dt * 60 * 0.08)
          // Shove the player out of the way.
          const dx = this.player.pos.x - car.pos.x
          const dz = this.player.pos.z - car.pos.z
          const d = Math.hypot(dx, dz) || 1
          this.player.pos.x += (dx / d) * speed * dt * 0.6
          this.player.pos.z += (dz / d) * speed * dt * 0.6
          this.audio.impact(Math.min(1, speed / 12))
        }
      }
    }
  }

  private onPlayerDeath() {
    this.audio.stopEngine()
    this.audio.setSiren(false)
    this.audio.explosion()
    this.particles.explosion(this.player.pos.clone().setY(0.8))
    if (this.player.vehicle) {
      this.player.vehicle.driven = false
      this.player.vehicle = null
    }
    this.wanted.reset()
    this.police.clear()
    this.missions.abandon()
    hud.set({ phase: 'dead' })
    this.input.exitLock()
    this.persist()
  }

  /** Called from the death screen. Hospital respawn: lose 10% cash, heat cleared. */
  respawn() {
    const fee = Math.floor(this.save.money * 0.1)
    this.save.money -= fee
    this.player.respawn(this.city!.spawn)
    this.camPos.copy(this.city!.spawn)
    hud.set({ phase: 'playing', damageFlash: 0 })
    hud.toast(fee > 0 ? `Hospital bill: -$${fee}` : 'Patched up and back out', 'info')
    this.input.requestLock()
    this.persist()
  }
  // --- Peds ---
  private updatePeds(dt: number) {
    const playerVehicle = this.player.vehicle
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i]!
      // Danger: nearby fast car or recent gunfire
      let danger: { x: number; z: number; radius: number } | null = null
      if (playerVehicle && Math.abs(playerVehicle.speed) > 3) {
        const d = dist2D(ped.pos.x, ped.pos.z, playerVehicle.pos.x, playerVehicle.pos.z)
        if (d < PEDS.FLEE_CAR_DIST) danger = { x: playerVehicle.pos.x, z: playerVehicle.pos.z, radius: PEDS.FLEE_CAR_DIST }
      }
      ped.update(dt, this.city!, danger)

      // Despawn far peds (never a living assassination target mid-mission)
      const d = dist2D(ped.pos.x, ped.pos.z, this.player.pos.x, this.player.pos.z)
      const keep = this.missions.isTarget(ped.id) && ped.state !== 'dead'
      if (!keep && (d > PEDS.DESPAWN_DIST || (ped.state === 'dead' && ped.deadTimer > 20))) {
        ped.dispose()
        this.peds.splice(i, 1)
        continue
      }
    }
    // Maintain population
    if (this.peds.length < PEDS.COUNT && Math.random() < dt * 1.5) {
      const pos = this.randomSidewalkPos(this.player.pos, 20, PEDS.SPAWN_DIST)
      createPed(pos.x, pos.z).then((ped) => {
        if (this.disposed) return
        this.peds.push(ped)
        this.scene.add(ped.group)
      })
    }
  }

  // --- Vehicle-vehicle collisions ---
  private updateVehicleCollisions() {
    const all = [...this.vehicles, ...this.traffic.cars, ...this.police.cars]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!
        const b = all[j]!
        const ra = Math.max(a.halfW, a.halfL) * CAR.RADIUS
        const rb = Math.max(b.halfW, b.halfL) * CAR.RADIUS
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const d = Math.hypot(dx, dz)
        const minD = ra + rb
        if (d < minD && d > 0.001) {
          const nx = dx / d
          const nz = dz / d
          const overlap = (minD - d) / 2
          a.pos.x -= nx * overlap
          a.pos.z -= nz * overlap
          b.pos.x += nx * overlap
          b.pos.z += nz * overlap
          // Damage based on closing speed
          const relVx = b.vel.x - a.vel.x
          const relVz = b.vel.z - a.vel.z
          const closing = Math.hypot(relVx, relVz)
          if (closing > 3) {
            const dmg = closing * 1.5
            const aDestroyed = a.damageBy(dmg)
            const bDestroyed = b.damageBy(dmg)
            this.audio.impact(closing / 12)
            this.particles.sparks(a.pos.clone().lerp(b.pos, 0.5).setY(0.5), 8)
            this.camShake = Math.min(1, this.camShake + closing / 20)
            if (aDestroyed) this.onCarDestroyed(a, a.driven || b.driven)
            if (bDestroyed) this.onCarDestroyed(b, a.driven || b.driven)
            // Crime if the player caused it
            if ((a.driven || b.driven) && closing > 5) {
              this.wanted.addCrime(WANTED.HIT_CAR)
              this.stats.crimes++
            }
          }
          // Exchange some velocity
          const relN = relVx * nx + relVz * nz
          if (relN < 0) {
            const imp = -relN * 0.5
            a.vel.x -= nx * imp
            a.vel.z -= nz * imp
            b.vel.x += nx * imp
            b.vel.z += nz * imp
          }
        }
      }
    }
  }

  private onCarDestroyed(car: VehicleEntity, byPlayer = false) {
    this.stats.carsDestroyed++
    if (this.stats.carsDestroyed >= 10) this.award('wreck_10')
    this.missions.notifyCarDestroyed()
    this.audio.explosion()
    this.particles.explosion(car.pos.clone().setY(0.5))
    this.camShake = Math.min(1, this.camShake + 0.4)
    if (byPlayer) this.registerKill()
    // Remove wrecked cars after a while
    setTimeout(() => {
      if (this.disposed) return
      const idx = this.vehicles.indexOf(car)
      if (idx >= 0) {
        car.dispose()
        this.vehicles.splice(idx, 1)
      }
      const tIdx = this.traffic.cars.indexOf(car)
      if (tIdx >= 0) {
        car.dispose()
        this.traffic.cars.splice(tIdx, 1)
      }
    }, 8000)
  }

  /** Shared ped-kill bookkeeping: stats, heat, streak, feedback. */
  private killPed(ped: PedEntity, point: THREE.Vector3) {
    if (ped.state === 'dead') return
    ped.kill()
    this.stats.pedsHit++
    this.wanted.addCrime(WANTED.HIT_PED)
    this.stats.crimes++
    this.particles.blood(point)
    this.registerKill()
    hud.toast('Pedestrian down', 'bad')
  }

  /** Kill-streak XP: kills within STREAK.WINDOW of each other chain a multiplier. */
  private registerKill() {
    this.award('first_blood')
    this.streak = this.streakTimer > 0 ? this.streak + 1 : 1
    this.streakTimer = STREAK.WINDOW
    if (this.streak >= 5) this.award('streak_5')
    if (this.streak >= 2) {
      const bonus = this.streak * STREAK.XP_PER_LEVEL
      this.gainXp(bonus)
      hud.toast(`Kill x${this.streak}! +${bonus} XP`, 'bad')
    }
  }

  /** Unlock an achievement (one-time toast + save). */
  private award(id: AchievementId) {
    if (!this.achievements.unlock(id)) return
    hud.toast(`🏆 Achievement: ${ACHIEVEMENTS[id].name}`, 'good')
    this.persist()
  }

  /** Drift-combo scoring: feed slip/speed each frame, bank payouts on end. */
  private updateDrift(dt: number) {
    const v = this.player.isDriving ? this.player.vehicle : null
    const slipping = v !== null && Math.abs(v.latVel) >= DRIFT.MIN_SLIP
    const speed = v !== null ? Math.abs(v.speedKmh) : 0
    const bank = this.drift.update(dt, slipping, speed)
    if (!bank) return
    const cash = bank.score * DRIFT.CASH_PER
    this.addMoney(cash)
    hud.toast(`Drift ${bank.seconds.toFixed(1)}s — +$${cash}`, 'good')
    if (bank.score >= 500) this.award('drift_king')
  }

  // --- Weapon pickups ---
  private updatePickups(dt: number) {
    const now = performance.now() / 1000
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawn -= dt
        if (p.respawn <= 0) {
          p.active = true
          p.group.visible = true
        }
        continue
      }
      // Float + spin
      p.group.rotation.y += dt * 1.5
      p.group.position.y = Math.sin(now * 2 + p.phase) * 0.12
      const s = 1 + Math.sin(now * 3 + p.phase) * 0.08
      p.ring.scale.setScalar(s)

      // Collect on foot
      if (!this.player.isDriving && !this.player.dead) {
        if (dist2D(p.pos.x, p.pos.z, this.player.pos.x, this.player.pos.z) < PICKUPS.PICKUP_DIST) {
          p.active = false
          p.respawn = PICKUPS.RESPAWN_TIME
          p.group.visible = false
          if (!this.ownedWeapons.includes(p.weapon)) {
            this.ownedWeapons.push(p.weapon)
          }
          this.weapon = p.weapon
          const def = WEAPONS[p.weapon]!
          hud.toast(`${def.name} picked up — press ${WEAPON_ORDER.indexOf(p.weapon as (typeof WEAPON_ORDER)[number]) + 1} to switch`, 'good')
          this.particles.burst(this.player.pos.clone().setY(1), 14, def.tracer, 4, 0.6, 1, 4, 0.8)
        }
      }
    }

    // Armor + health + bribe shards
    for (const a of [...this.armorPickups, ...this.healthPickups, ...this.bribePickups]) {
      if (!a.active) {
        a.respawn -= dt
        if (a.respawn <= 0) {
          a.active = true
          a.group.visible = true
        }
        continue
      }
      a.group.rotation.y += dt * 2
      a.group.position.y = Math.sin(now * 2.4 + a.phase) * 0.12
      if (!this.player.isDriving && !this.player.dead) {
        if (dist2D(a.pos.x, a.pos.z, this.player.pos.x, this.player.pos.z) < PICKUPS.PICKUP_DIST) {
          a.active = false
          a.respawn = PICKUPS.RESPAWN_TIME
          a.group.visible = false
          if (a.kind === 'armor') {
            this.player.armor = Math.min(100, this.player.armor + PICKUPS.ARMOR_AMOUNT)
            hud.toast(`+${PICKUPS.ARMOR_AMOUNT} armor`, 'good')
            this.particles.burst(this.player.pos.clone().setY(1), 12, 0x3b82f6, 3, 0.5, 1, 3, 0.8)
          } else if (a.kind === 'health') {
            this.player.health = Math.min(PLAYER.HEALTH, this.player.health + PICKUPS.HEALTH_AMOUNT)
            hud.toast(`+${PICKUPS.HEALTH_AMOUNT} health`, 'good')
            this.particles.burst(this.player.pos.clone().setY(1), 12, 0x4ade80, 3, 0.5, 1, 3, 0.8)
          } else {
            this.wanted.coolDown(WANTED.BRIBE_RELIEF)
            hud.toast('Bribe delivered — heat dropped', 'good')
            this.particles.burst(this.player.pos.clone().setY(1), 12, 0xffd700, 3, 0.5, 1, 3, 0.8)
          }
        }
      }
    }
  }

  /** Pay'n'Spray: amber wrench beacon. Drive in for repair + clean record. */
  private buildGarage() {
    const g = new THREE.Group()
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 24, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    )
    pillar.position.y = 12
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 }),
    )
    beacon.position.y = 2.6
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    g.add(pillar, beacon, ring)
    g.position.copy(this.city!.paynspray)
    this.scene.add(g)
    this.garage = g
  }

  /** Service the driven car when it enters the garage radius. */
  private updateGarage(dt: number) {
    if (this.garage) {
      const t = performance.now() / 1000
      const beacon = this.garage.children[1]
      if (beacon) {
        beacon.rotation.y += dt * 1.8
        beacon.position.y = 2.6 + Math.sin(t * 2) * 0.25
      }
    }
    if (!this.garage || !this.player.isDriving || !this.player.vehicle) {
      this.garageInside = false
      return
    }
    const v = this.player.vehicle
    const inside = dist2D(v.pos.x, v.pos.z, this.city!.paynspray.x, this.city!.paynspray.z) < PAYNSPRAY.RADIUS
    if (inside && !this.garageInside) {
      this.garageInside = true
      const needsWork = v.health < CAR.HEALTH || this.wanted.level > 0
      if (!needsWork) {
        hud.toast("Pay'n'Spray: ride's already clean", 'info')
        return
      }
      if (this.save.money < PAYNSPRAY.COST) {
        hud.toast(`Pay'n'Spray needs $${PAYNSPRAY.COST}`, 'bad')
        return
      }
      this.save.money -= PAYNSPRAY.COST
      v.repair()
      this.wanted.reset()
      this.police.clear()
      this.particles.burst(v.pos.clone().setY(1), 20, 0xffaa00, 4, 0.7, 1.2, 3, 0.8)
      hud.toast(`Pay'n'Spray: repaired + record wiped (-$${PAYNSPRAY.COST})`, 'good')
      this.persist()
    } else if (!inside) {
      this.garageInside = false
    }
  }

  /** Blue armor shards (+50), red health packs (+50), gold bribes (-heat). */
  private spawnArmor() {
    this.spawnShards(this.armorPickups, 'armor', 0x3b82f6, PICKUPS.ARMOR_COUNT)
    this.spawnShards(this.healthPickups, 'health', 0xef4444, PICKUPS.HEALTH_COUNT)
    this.spawnShards(this.bribePickups, 'bribe', 0xffd700, PICKUPS.BRIBE_COUNT)
  }

  private spawnShards(
    list: Shard[],
    kind: 'armor' | 'health' | 'bribe',
    color: number,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.35),
        new THREE.MeshBasicMaterial({ color }),
      )
      core.position.y = 0.9
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.58, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.05
      const group = new THREE.Group()
      group.add(core, ring)
      const pos = this.randomSidewalkPos(this.city!.spawn, 10, 60)
      group.position.copy(pos)
      this.scene.add(group)
      list.push({ group, pos, active: true, respawn: 0, phase: Math.random() * Math.PI * 2, kind })
    }
  }
  private shootFromPlayer() {
    const def = WEAPONS[this.weapon]!
    this.audio.gunshot(def.pitch)
    this.wanted.addCrime(WANTED.SHOOT)
    this.stats.crimes++
    this.camShake = Math.min(1, this.camShake + def.shake)

    // Raycast from camera through crosshair
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    ray.far = def.range

    // Muzzle flash + tracer spark at the player
    const origin = this.player.pos.clone().setY(1.3)
    this.particles.burst(origin, 3, def.tracer, 2, 0.15, 0.8, 0, 0.5)

    const targets: THREE.Object3D[] = []
    for (const p of this.peds) targets.push(p.group)
    for (const v of this.vehicles) {
      if (v !== this.player.vehicle) targets.push(v.group)
    }
    for (const v of this.traffic.cars) targets.push(v.group)
    for (const v of this.police.cars) targets.push(v.group)

    const hits = ray.intersectObjects(targets, true)
    if (hits.length > 0) {
      const hit = hits[0]!
      this.particles.burst(hit.point, 6, def.tracer, 5, 0.4, 0.8, 10, 0.4)
      // Find what was hit
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        const ped = this.peds.find((p) => p.group === obj)
        if (ped) {
          hud.set({ hitmarker: performance.now() })
          this.killPed(ped, hit.point)
          return
        }
        const car = [...this.vehicles, ...this.traffic.cars, ...this.police.cars].find((v) => v.group === obj)
        if (car) {
          hud.set({ hitmarker: performance.now() })
          const destroyed = car.damageBy(def.damage)
          if (destroyed) {
            this.onCarDestroyed(car, true)
            this.wanted.addCrime(WANTED.DESTROY_CAR)
            this.stats.crimes++
          }
          return
        }
        obj = obj.parent
      }
    }
  }

  private bullets: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; mesh: THREE.Mesh }[] = []

  private updateBullets() {
    // Tracer bullets are instant (raycast), so this is a no-op placeholder
    // kept for future projectile weapons.
  }

  // --- HUD ---
  private updateHud(dt: number) {
    const mission = this.missions.current ? this.missions.hudText() : null
    const dist = mission && this.missions.current
      ? formatDist(this.missions.current.marker.distanceTo(this.player.pos), WORLD.UNITS_PER_METER)
      : ''
    hud.set({
      money: this.save.money,
      xp: this.save.xp,
      level: this.save.level,
      health: this.player.health,
      armor: this.player.armor,
      wanted: this.wanted.level,
      wantedFlash: this.wanted.justChanged,
      speedKmh: this.player.isDriving && this.player.vehicle ? this.player.vehicle.speedKmh : this.player.speed * 6,
      inCar: this.player.isDriving,
      carHealth: this.player.vehicle ? Math.max(0, Math.round((this.player.vehicle.health / CAR.HEALTH) * 100)) : null,
      nitro: this.player.vehicle ? Math.round(this.player.vehicle.nitro) : null,
      drift: this.drift.display,
      mission: mission ? { ...mission, dist } : null,
      radioOn: this.audio.radioOn,
      radioStation: this.audio.radioStation,
      weapon: this.weapon,
      weapons: [...this.ownedWeapons],
      save: this.save,
    })
    hud.set({ damageFlash: damp(hud.state.damageFlash, 0, 5, dt) })
  }

  // --- Actions from UI ---
  addMoney(amount: number) {
    this.save.money += amount
    if (this.save.money >= 10000) this.award('rich')
    this.gainXp(Math.round(amount * 0.5))
    this.persist()
  }

  gainXp(n: number) {
    if (n <= 0) return
    this.save.xp += n
    const newLevel = Math.floor(this.save.xp / 500) + 1
    if (newLevel > this.save.level) {
      this.save.level = newLevel
      hud.toast(`Level up! Now level ${newLevel}`, 'good')
      if (newLevel >= 5) this.award('level_5')
    }
  }

  completeMission() {
    const m = this.missions.current
    if (!m) return
    this.addMoney(m.reward)
    this.stats.jobs++
    if (this.stats.jobs >= 10) this.award('jobs_10')
    hud.toast(`Mission complete! +$${m.reward}`, 'good')
    this.persist()
  }

  failMission() {
    hud.toast('Mission failed', 'bad')
  }

  toggleRadio() {
    if (this.audio.radioOn) {
      this.audio.setRadio(false)
    } else {
      this.audio.setRadio(true, this.audio.radioStation)
    }
  }

  nextRadioStation() {
    this.audio.radioStation = (this.audio.radioStation + 1) % 3
    if (this.audio.radioOn) this.audio.setRadio(true, this.audio.radioStation)
  }

  /** Touch UI grabs the input through here. */
  getInput(): Input {
    return this.input
  }

  setMinimapCanvas(canvas: HTMLCanvasElement | null) {
    this.minimapCanvas = canvas
  }

  setBigMapCanvas(canvas: HTMLCanvasElement | null) {
    this.bigMapCanvas = canvas
  }

  private drawMinimap() {
    if (this.minimapCanvas) this.drawMap(this.minimapCanvas, false)
  }

  private drawBigMap() {
    if (this.bigMapCanvas) this.drawMap(this.bigMapCanvas, true)
  }

  /** Shared 2D city renderer: small `big=false` for the HUD corner, large for the M overlay. */
  private drawMap(canvas: HTMLCanvasElement, big: boolean) {
    const city = this.city
    if (!city) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const S = canvas.width
    const u = S / 200 // scale unit: minimap is 200px
    const scale = S / (city.size * 1.15)
    const toMap = (x: number, z: number): [number, number] => [
      (x - city.origin) * scale + S / 2,
      (z - city.origin) * scale + S / 2,
    ]

    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = 'rgba(8, 8, 16, 0.92)'
    ctx.fillRect(0, 0, S, S)

    // Streets
    ctx.strokeStyle = 'rgba(120, 130, 160, 0.5)'
    ctx.lineWidth = Math.max(1, 2 * u)
    for (const x of city.streetsX) {
      const [mx] = toMap(x, 0)
      ctx.beginPath()
      ctx.moveTo(mx, 0)
      ctx.lineTo(mx, S)
      ctx.stroke()
    }
    for (const z of city.streetsZ) {
      const [, mz] = toMap(0, z)
      ctx.beginPath()
      ctx.moveTo(0, mz)
      ctx.lineTo(S, mz)
      ctx.stroke()
    }

    // Weapon pickups
    for (const p of this.pickups) {
      if (!p.active) continue
      const [mx, mz] = toMap(p.pos.x, p.pos.z)
      ctx.fillStyle = '#ffea00'
      ctx.fillRect(mx - 2 * u, mz - 2 * u, 4 * u, 4 * u)
    }

    // Armor + health shards
    for (const a of this.armorPickups) {
      if (!a.active) continue
      const [mx, mz] = toMap(a.pos.x, a.pos.z)
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(mx - 2 * u, mz - 2 * u, 4 * u, 4 * u)
    }
    for (const h of this.healthPickups) {
      if (!h.active) continue
      const [mx, mz] = toMap(h.pos.x, h.pos.z)
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(mx - 2 * u, mz - 2 * u, 4 * u, 4 * u)
    }
    for (const b of this.bribePickups) {
      if (!b.active) continue
      const [mx, mz] = toMap(b.pos.x, b.pos.z)
      ctx.fillStyle = '#ffd700'
      ctx.fillRect(mx - 2 * u, mz - 2 * u, 4 * u, 4 * u)
    }

    // Pay'n'Spray garage
    {
      const [mx, mz] = toMap(city.paynspray.x, city.paynspray.z)
      ctx.fillStyle = '#ffaa00'
      const s = 3.5 * u
      ctx.save()
      ctx.translate(mx, mz)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-s / 2, -s / 2, s, s)
      ctx.restore()
    }

    // Mission marker
    const m = this.missions.current
    if (m) {
      const [mx, mz] = toMap(m.marker.x, m.marker.z)
      ctx.fillStyle = '#00ff88'
      ctx.beginPath()
      ctx.arc(mx, mz, 5 * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)'
      ctx.lineWidth = 2 * u
      ctx.beginPath()
      ctx.arc(mx, mz, (9 + Math.sin(performance.now() * 0.006) * 3) * u, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Traffic
    ctx.fillStyle = 'rgba(255, 200, 80, 0.7)'
    for (const c of this.traffic.cars) {
      const [mx, mz] = toMap(c.pos.x, c.pos.z)
      ctx.fillRect(mx - 1.5 * u, mz - 1.5 * u, 3 * u, 3 * u)
    }

    // Police
    ctx.fillStyle = '#ff4444'
    for (const c of this.police.cars) {
      const [mx, mz] = toMap(c.pos.x, c.pos.z)
      ctx.beginPath()
      ctx.arc(mx, mz, 3 * u, 0, Math.PI * 2)
      ctx.fill()
    }

    // Player
    const [px, pz] = toMap(this.player.pos.x, this.player.pos.z)
    ctx.save()
    ctx.translate(px, pz)
    ctx.rotate(Math.atan2(Math.sin(this.player.heading), Math.cos(this.player.heading)) * -1 + Math.PI)
    ctx.fillStyle = '#00e5ff'
    ctx.beginPath()
    ctx.moveTo(0, -6 * u)
    ctx.lineTo(4 * u, 5 * u)
    ctx.lineTo(-4 * u, 5 * u)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    if (big) {
      // Legend
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = `${13 * u}px sans-serif`
      ctx.fillText('▲ you   ● police   ■ traffic   ■ weapon   ■ armor   ■ health   ■ bribe   ◆ garage   ● mission', 12 * u, S - 12 * u)
    }

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.input.dispose()
    this.audio.dispose()
    this.persist()
    this.renderer.dispose()
  }
}
