import * as THREE from 'three'

// A pooled point-sprite particle system for sparks, smoke, and explosions.
// One THREE.Points with per-particle position/color/size, updated on the CPU.

const MAX = 600

interface Particle {
  alive: boolean
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  life: number
  maxLife: number
  r: number; g: number; b: number
  size: number
  gravity: number
  drag: number
}

export class Particles {
  points: THREE.Points
  private particles: Particle[] = []
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private geo: THREE.BufferGeometry

  constructor() {
    this.positions = new Float32Array(MAX * 3)
    this.colors = new Float32Array(MAX * 3)
    this.sizes = new Float32Array(MAX)
    for (let i = 0; i < MAX; i++) {
      this.particles.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1, size: 1, gravity: 0, drag: 0 })
      this.positions[i * 3 + 1] = -1000
    }
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))

    const mat = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
    // Round soft sprite.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 32, 32)
    const tex = new THREE.CanvasTexture(canvas)
    mat.map = tex
    mat.alphaTest = 0.01

    this.points = new THREE.Points(this.geo, mat)
    this.points.frustumCulled = false
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, size: number, gravity: number, drag: number) {
    const p = this.particles.find((q) => !q.alive)
    if (!p) return
    p.alive = true
    p.x = x; p.y = y; p.z = z
    p.vx = vx; p.vy = vy; p.vz = vz
    p.life = life
    p.maxLife = life
    p.r = r; p.g = g; p.b = b
    p.size = size
    p.gravity = gravity
    p.drag = drag
  }

  burst(pos: THREE.Vector3, count: number, color: number, speed: number, life: number, size: number, gravity: number, upBias = 0.5) {
    const r = ((color >> 16) & 255) / 255
    const g = ((color >> 8) & 255) / 255
    const b = (color & 255) / 255
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.4 + Math.random() * 0.6)
      this.spawn(
        pos.x, pos.y, pos.z,
        Math.cos(a) * s, (Math.random() * upBias + 0.2) * s, Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.8), r, g, b, size * (0.7 + Math.random() * 0.6), gravity, 1.5,
      )
    }
  }

  sparks(pos: THREE.Vector3, count = 8) {
    this.burst(pos, count, 0xffcc55, 6, 0.4, 0.5, 12, 0.3)
  }

  smoke(pos: THREE.Vector3, count = 4) {
    this.burst(pos, count, 0x555566, 1.2, 1.4, 1.6, -1.5, 0.8)
  }

  explosion(pos: THREE.Vector3) {
    this.burst(pos, 40, 0xff6600, 10, 0.9, 2.2, 8, 0.9)
    this.burst(pos, 25, 0xffcc00, 14, 0.5, 1.4, 6, 1.0)
    this.burst(pos, 20, 0x333333, 4, 1.8, 2.4, -1, 0.7)
  }

  blood(pos: THREE.Vector3) {
    this.burst(pos, 10, 0xaa1122, 3, 0.5, 0.7, 10, 0.4)
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      const p = this.particles[i]!
      if (!p.alive) continue
      p.life -= dt
      if (p.life <= 0) {
        p.alive = false
        this.positions[i * 3 + 1] = -1000
        this.sizes[i] = 0
        continue
      }
      p.vy -= p.gravity * dt
      const drag = 1 - p.drag * dt
      p.vx *= drag
      p.vy *= drag
      p.vz *= drag
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3 }
      const t = p.life / p.maxLife
      this.positions[i * 3] = p.x
      this.positions[i * 3 + 1] = p.y
      this.positions[i * 3 + 2] = p.z
      this.colors[i * 3] = p.r * t
      this.colors[i * 3 + 1] = p.g * t
      this.colors[i * 3 + 2] = p.b * t
      this.sizes[i] = p.size * (0.5 + t * 0.5)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.color.needsUpdate = true
    this.geo.attributes.size.needsUpdate = true
  }

  dispose() {
    this.points.removeFromParent()
    this.geo.dispose()
  }
}
