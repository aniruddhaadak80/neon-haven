import * as THREE from 'three'
import { DAYNIGHT, RENDER, CAMERA } from '../config'
import { lerp, clamp } from '../utils'

// Day/night cycle: sun position, sky gradient, fog, and night emissives.

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  varying vec3 vWorldPos;
  void main() {
    vec3 dir = normalize(vWorldPos);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky = mix(bottomColor, topColor, pow(h, 0.8));
    float sun = pow(max(dot(dir, sunDir), 0.0), 64.0);
    sky += sunColor * sun * 0.6;
    gl_FragColor = vec4(sky, 1.0);
  }
`

// Sky palettes keyed by hour (0-24). [top, bottom, sun, sunIntensity, ambient, fog]
interface Palette { top: THREE.Color; bottom: THREE.Color; sun: THREE.Color; sunI: number; amb: number; fog: THREE.Color }

function palette(hour: number): Palette {
  // Keyframes: hour -> colors
  const keys: [number, number, number, number, number, number, number, number, number][] = [
    // hour, topR, topG, topB, botR, botG, botB, sunI, amb
    [0, 0.02, 0.02, 0.06, 0.05, 0.03, 0.1, 0.05, 0.25],
    [5, 0.05, 0.04, 0.12, 0.3, 0.12, 0.2, 0.1, 0.3],
    [7, 0.35, 0.45, 0.65, 0.9, 0.6, 0.45, 0.7, 0.5],
    [12, 0.3, 0.55, 0.85, 0.65, 0.8, 0.95, 1.0, 0.65],
    [17, 0.35, 0.5, 0.8, 0.85, 0.6, 0.5, 0.8, 0.55],
    [19.5, 0.15, 0.1, 0.3, 0.7, 0.25, 0.35, 0.3, 0.4],
    [21, 0.03, 0.03, 0.08, 0.15, 0.06, 0.18, 0.08, 0.3],
    [24, 0.02, 0.02, 0.06, 0.05, 0.03, 0.1, 0.05, 0.25],
  ]
  let a = keys[0]!
  let b = keys[keys.length - 1]!
  for (let i = 0; i < keys.length - 1; i++) {
    if (hour >= keys[i]![0] && hour <= keys[i + 1]![0]) {
      a = keys[i]!
      b = keys[i + 1]!
      break
    }
  }
  const t = (hour - a[0]) / Math.max(b[0] - a[0], 0.001)
  const c = (i: number) => lerp(a[i]!, b[i]!, t)
  return {
    top: new THREE.Color(c(1), c(2), c(3)),
    bottom: new THREE.Color(c(4), c(5), c(6)),
    sun: new THREE.Color(1, 0.95, 0.85),
    sunI: c(7),
    amb: c(8),
    fog: new THREE.Color(c(4), c(5), c(6)).lerp(new THREE.Color(c(1), c(2), c(3)), 0.4),
  }
}

export class DayNight {
  hour: number = DAYNIGHT.START_HOUR
  sun: THREE.DirectionalLight
  ambient: THREE.AmbientLight
  hemi: THREE.HemisphereLight
  sky: THREE.Mesh
  private skyMat: THREE.ShaderMaterial
  private fog: THREE.Fog
  /** 0 = full day, 1 = full night. */
  nightFactor = 0
  private neonMats: THREE.MeshBasicMaterial[] = []

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 1)
    this.sun.position.set(50, 80, 30)
    scene.add(this.sun)

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(this.ambient)

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x334, 0.4)
    scene.add(this.hemi)

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        topColor: { value: new THREE.Color() },
        bottomColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(CAMERA.FAR * 0.9, 24, 16), this.skyMat)
    this.sky.frustumCulled = false
    scene.add(this.sky)

    this.fog = new THREE.Fog(0x000000, RENDER.FOG_NEAR, RENDER.FOG_FAR)
    scene.fog = this.fog
  }

  registerNeon(mats: THREE.MeshBasicMaterial[]) {
    this.neonMats.push(...mats)
  }

  update(dt: number, cameraPos: THREE.Vector3) {
    this.hour = (this.hour + (dt / DAYNIGHT.DAY_LENGTH) * 24) % 24
    const p = palette(this.hour)

    // Sun angle: rises at 6, sets at 19.
    const dayT = (this.hour - 6) / 13 // 0 at 6h, 1 at 19h
    const sunAngle = dayT * Math.PI // 0..PI across the sky
    const isDay = this.hour > 5.5 && this.hour < 19.5
    const sunDir = new THREE.Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0.3).normalize()

    this.nightFactor = isDay ? clamp(1 - Math.sin(sunAngle) * 1.6, 0, 1) : 1

    this.sun.position.copy(cameraPos).addScaledVector(sunDir, 120)
    this.sun.target.position.copy(cameraPos)
    this.sun.target.updateMatrixWorld()
    this.sun.intensity = p.sunI * 1.6
    this.sun.color.copy(p.sun)

    this.ambient.intensity = p.amb * 0.55
    this.hemi.intensity = 0.25 + p.amb * 0.35

    this.skyMat.uniforms.topColor.value.copy(p.top)
    this.skyMat.uniforms.bottomColor.value.copy(p.bottom)
    this.skyMat.uniforms.sunDir.value.copy(sunDir)
    this.skyMat.uniforms.sunColor.value.copy(p.sun).multiplyScalar(isDay ? 1 : 0.15)
    this.sky.position.copy(cameraPos)

    this.fog.color.copy(p.fog)
    this.fog.near = lerp(RENDER.FOG_NEAR, RENDER.FOG_FAR * 0.55, this.nightFactor)
    this.fog.far = lerp(RENDER.FOG_FAR, RENDER.FOG_FAR * 0.7, this.nightFactor)

    // Neon signs glow at night.
    const glow = 0.25 + this.nightFactor * 0.75
    for (const m of this.neonMats) {
      m.color.copy(m.userData.baseColor as THREE.Color).multiplyScalar(glow)
    }
  }

  get isNight(): boolean {
    return this.nightFactor > 0.5
  }
}
