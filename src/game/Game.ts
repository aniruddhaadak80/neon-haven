import * as THREE from 'three'
import { WORLD, PLAYER, CAR, PEDS, POLICE, RENDER, CAMERA, SAVE_KEY, WANTED } from './config'
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
import { hud } from './systems/HudStore'
import { getVehicleModel, TRAFFIC_MODELS, CHARACTER_KEYS } from './assets/AssetLibrary'
import { clamp, damp, damp as dampN, dist2D, formatDist } from './utils'
import type { Vehicle, SaveData } from './types'

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
  private minimapTimer = 0

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

    this.input.onPause = () => {
      if (hud.state.phase === 'playing') this.pause()
      else if (hud.state.phase === 'paused') this.resume()
    }
    this.input.onMap = (down) => {
      hud.set({ mapOpen: down })
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
    }
  }

  private persist() {
    this.save = {
      money: this.save.money,
      xp: this.save.xp,
      level: this.save.level,
      stats: { ...this.stats },
      bestWanted: this.bestWanted,
    }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)) } catch { /* ignore */ }
  }

  // --- Lifecycle ---
  async start() {
    hud.set({ phase: 'loading', loadFrac: 0, loadLabel: 'waking up' })
    await this.load()
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

    hud.set({ loadFrac: 1, loadLabel: 'done' })
  }

  private randomSidewalkPos(center: THREE.Vector3, minD: number, maxD: number): THREE.Vector3 {
    const city = this.city!
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = Math.random() * Math.PI * 2
      const d = minD + Math.random() * (maxD - minD)
      const x = center.x + Math.cos(ang) * d
      const z = center.z + Math.sin(ang) * d
      if (!isBlocked(city, x, z)) return new THREE.Vector3(x, 0, z)
    }
    return center.clone()
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
    const city = this.city!
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

    // --- Camera ---
    this.updateCamera(dt)

    // --- World systems ---
    this.traffic.update(dt, this.player.pos, this.player.vehicle)
    this.police.update(dt, this.wanted.level, this.player.pos, this.player.vehicle, this.player.dead)
    this.updatePeds(dt)
    this.updateVehicleCollisions(dt)
    this.updateBullets(dt)
    const missionResult = this.missions.update(dt, this.player.pos, this.wanted.level)
    if (missionResult === 'done') this.completeMission()
    else if (missionResult === 'failed') this.failMission()
    this.dayNight.update(dt, this.camPos)
    this.particles.update(dt)

    // --- Wanted ---
    const policeNear = this.police.cars.some(
      (c) => dist2D(c.pos.x, c.pos.z, this.player.pos.x, this.player.pos.z) < POLICE.SIGHT,
    )
    this.wanted.update(dt, policeNear)
    if (this.wanted.level > this.bestWanted) {
      this.bestWanted = this.wanted.level
    }

    // --- Audio ---
    if (this.player.isDriving && this.player.vehicle) {
      this.audio.updateEngine(Math.abs(this.player.vehicle.speed) / CAR.MAX_SPEED, 0.5)
      this.audio.setSiren(false)
    } else {
      this.audio.updateEngine(0, 0)
    }
    this.audio.updateSiren(performance.now() / 1000)

    // --- HUD ---
    this.updateHud(dt)
    this.input.endFrame()

    // --- Minimap (throttled) ---
    this.minimapTimer -= dt
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1
      this.drawMinimap()
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

    // Enter vehicle
    if (this.input.consume('interact') || (input.touch.active && input.touch.action)) {
      this.tryEnterVehicle()
    }

    // Shoot
    if ((input.shoot || (input.touch.active && input.touch.fire)) && this.player.shootTimer <= 0) {
      this.player.shootTimer = PLAYER.SHOOT_COOLDOWN
      this.shootFromPlayer()
    }
    this.player.shootTimer = Math.max(0, this.player.shootTimer - dt)
  }

  private tryEnterVehicle() {
    let best: VehicleEntity | null = null
    let bestD: number = PLAYER.ENTER_CAR_DIST
    for (const v of this.vehicles) {
      if (v.dead) continue
      const d = dist2D(v.pos.x, v.pos.z, this.player.pos.x, this.player.pos.z)
      if (d < bestD) { bestD = d; best = v }
    }
    if (best) {
      this.player.enterVehicle(best)
      this.audio.startEngine()
      hud.toast(`Driving ${best.model}`, 'info')
    }
  }

  // --- Driving ---
  private updateDriving(dt: number) {
    const v = this.player.vehicle!
    const input = this.input.state

    const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0) + (input.touch.active ? -input.touch.y : 0)
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0) + (input.touch.active ? -input.touch.x : 0)
    const handbrake = input.handbrake || (input.touch.active && input.touch.brake)

    v.update(dt, clamp(throttle, -1, 1), clamp(steer, -1, 1), handbrake)

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
          ped.kill()
          this.stats.pedsHit++
          this.wanted.addCrime(WANTED.HIT_PED)
          this.stats.crimes++
          this.particles.blood(ped.pos.clone().setY(0.8))
          hud.toast('Pedestrian down', 'bad')
        }
      }
    }

    // Distance stat
    this.stats.distance += Math.abs(v.speed) * dt

    // Exit vehicle
    if (this.input.consume('interact') || (input.touch.active && input.touch.action)) {
      this.player.exitVehicle()
      this.audio.stopEngine()
    }

    // Drive-by shooting
    if ((input.shoot || (input.touch.active && input.touch.fire)) && this.player.shootTimer <= 0) {
      this.player.shootTimer = PLAYER.SHOOT_COOLDOWN
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

      // Despawn far peds
      const d = dist2D(ped.pos.x, ped.pos.z, this.player.pos.x, this.player.pos.z)
      if (d > PEDS.DESPAWN_DIST || (ped.state === 'dead' && ped.deadTimer > 20)) {
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
  private updateVehicleCollisions(dt: number) {
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
            if (aDestroyed) this.onCarDestroyed(a)
            if (bDestroyed) this.onCarDestroyed(b)
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

  private onCarDestroyed(car: VehicleEntity) {
    this.stats.carsDestroyed++
    this.audio.explosion()
    this.particles.explosion(car.pos.clone().setY(0.5))
    this.camShake = Math.min(1, this.camShake + 0.4)
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

  // --- Shooting ---
  private shootFromPlayer() {
    this.audio.gunshot()
    this.wanted.addCrime(WANTED.SHOOT)
    this.stats.crimes++
    this.camShake = Math.min(1, this.camShake + 0.15)

    // Raycast from camera through crosshair
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    ray.far = PLAYER.SHOOT_RANGE

    const targets: THREE.Object3D[] = []
    for (const p of this.peds) targets.push(p.group)
    for (const v of this.vehicles) targets.push(v.group)
    for (const v of this.traffic.cars) targets.push(v.group)

    const hits = ray.intersectObjects(targets, true)
    if (hits.length > 0) {
      const hit = hits[0]!
      this.particles.sparks(hit.point, 6)
      // Find what was hit
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        const ped = this.peds.find((p) => p.group === obj)
        if (ped) {
          if (ped.state !== 'dead') {
            ped.kill()
            this.stats.pedsHit++
            this.wanted.addCrime(WANTED.HIT_PED)
            this.particles.blood(hit.point)
            hud.toast('Pedestrian down', 'bad')
          }
          return
        }
        const car = [...this.vehicles, ...this.traffic.cars, ...this.police.cars].find((v) => v.group === obj)
        if (car) {
          const destroyed = car.damageBy(PLAYER.SHOOT_DAMAGE)
          if (destroyed) {
            this.onCarDestroyed(car)
            this.wanted.addCrime(WANTED.DESTROY_CAR)
          }
          return
        }
        obj = obj.parent
      }
    }
  }

  private bullets: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; mesh: THREE.Mesh }[] = []

  private updateBullets(dt: number) {
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
      mission: mission ? { ...mission, dist } : null,
      radioOn: this.audio.radioOn,
      radioStation: this.audio.radioStation,
      save: this.save,
    })
    hud.set({ damageFlash: damp(hud.state.damageFlash, 0, 5, dt) })
  }

  // --- Actions from UI ---
  addMoney(amount: number) {
    this.save.money += amount
    this.save.xp += Math.round(amount * 0.5)
    const newLevel = Math.floor(this.save.xp / 500) + 1
    if (newLevel > this.save.level) {
      this.save.level = newLevel
      hud.toast(`Level up! Now level ${newLevel}`, 'good')
    }
    this.persist()
  }

  completeMission() {
    const m = this.missions.current
    if (!m) return
    this.addMoney(m.reward)
    this.stats.jobs++
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

  setMinimapCanvas(canvas: HTMLCanvasElement | null) {
    this.minimapCanvas = canvas
  }

  private drawMinimap() {
    const canvas = this.minimapCanvas
    const city = this.city
    if (!canvas || !city) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const S = canvas.width
    const scale = S / (city.size * 1.15)
    const toMap = (x: number, z: number): [number, number] => [
      (x - city.origin) * scale + S / 2,
      (z - city.origin) * scale + S / 2,
    ]

    ctx.clearRect(0, 0, S, S)
    ctx.fillStyle = 'rgba(8, 8, 16, 0.9)'
    ctx.fillRect(0, 0, S, S)

    // Streets
    ctx.strokeStyle = 'rgba(120, 130, 160, 0.5)'
    ctx.lineWidth = 2
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

    // Mission marker
    const m = this.missions.current
    if (m) {
      const [mx, mz] = toMap(m.marker.x, m.marker.z)
      ctx.fillStyle = '#00ff88'
      ctx.beginPath()
      ctx.arc(mx, mz, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.4)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(mx, mz, 9 + Math.sin(performance.now() * 0.006) * 3, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Traffic
    ctx.fillStyle = 'rgba(255, 200, 80, 0.7)'
    for (const c of this.traffic.cars) {
      const [mx, mz] = toMap(c.pos.x, c.pos.z)
      ctx.fillRect(mx - 1.5, mz - 1.5, 3, 3)
    }

    // Police
    ctx.fillStyle = '#ff4444'
    for (const c of this.police.cars) {
      const [mx, mz] = toMap(c.pos.x, c.pos.z)
      ctx.beginPath()
      ctx.arc(mx, mz, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Player
    const [px, pz] = toMap(this.player.pos.x, this.player.pos.z)
    ctx.save()
    ctx.translate(px, pz)
    ctx.rotate(Math.atan2(Math.sin(this.player.heading), Math.cos(this.player.heading)) * -1 + Math.PI)
    ctx.fillStyle = '#00e5ff'
    ctx.beginPath()
    ctx.moveTo(0, -6)
    ctx.lineTo(4, 5)
    ctx.lineTo(-4, 5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

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
