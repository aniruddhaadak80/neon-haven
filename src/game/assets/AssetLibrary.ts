import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORLD } from '../config'

const loader = new GLTFLoader()
const gltfCache = new Map<string, THREE.Group>()
const texCache = new Map<string, THREE.Texture>()
const staticCache = new Map<string, THREE.BufferGeometry>()
const charCache = new Map<string, { template: THREE.Group; clips: Map<string, THREE.AnimationClip> }>()

/** Load a GLB once and cache the parsed scene. */
export function loadGLTF(url: string): Promise<THREE.Group> {
  const hit = gltfCache.get(url)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene
        // Kenney characters/props ship unlit; convert to Lambert so they respond
        // to the day/night lighting instead of glowing flat at night.
        root.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mesh.material = mats.map((m) => {
              const basic = m as THREE.MeshBasicMaterial
              if (basic.isMeshBasicMaterial) {
                const lam = new THREE.MeshLambertMaterial({
                  map: basic.map ?? null,
                  color: basic.color.clone(),
                  transparent: basic.transparent,
                  opacity: basic.opacity,
                  side: basic.side,
                })
                return lam
              }
              return m
            })
          }
        })
        gltfCache.set(url, root)
        resolve(root)
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    )
  })
}

/** Cached texture for a model group (atlas). */
export function getTexture(group: string): THREE.Texture {
  const hit = texCache.get(group)
  if (hit) return hit
  const tex = new THREE.TextureLoader().load(`/models/tex/${group}-colormap.png`)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  texCache.set(group, tex)
  return tex
}

export interface VehicleModel {
  group: THREE.Group
  body: THREE.Mesh
  wheels: THREE.Mesh[]
  /** Half-extents of the body for collision. */
  halfW: number
  halfL: number
  wheelRadius: number
  /** Named wheel roles for steering. */
  steerWheels: THREE.Mesh[]
}

const WHEEL_RE = /wheel/i

/** Build a drivable vehicle model from a Kenney car GLB. */
export async function getVehicleModel(key: string): Promise<VehicleModel> {
  const root = await loadGLTF(`/models/cars/${key}.glb`)
  root.updateMatrixWorld(true)

  const group = new THREE.Group()
  const wheelNodes: THREE.Object3D[] = []
  const bodyGeos: THREE.BufferGeometry[] = []

  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (WHEEL_RE.test(o.name)) {
      wheelNodes.push(o)
    } else {
      const g = mesh.geometry.clone()
      g.applyMatrix4(mesh.matrixWorld)
      normalizeGeo(g)
      bodyGeos.push(g)
    }
  })

  const bodyGeo = bodyGeos.length > 1 ? mergeGeometries(bodyGeos, false) : bodyGeos[0]
  const body = new THREE.Mesh(bodyGeo!, new THREE.MeshLambertMaterial({ map: getTexture('cars') }))
  body.name = 'body'
  group.add(body)

  // Wheels: keep separate so they can spin + steer.
  const wheels: THREE.Mesh[] = []
  const steerWheels: THREE.Mesh[] = []
  for (const node of wheelNodes) {
    const mesh = node as THREE.Mesh
    const w = new THREE.Mesh(mesh.geometry, new THREE.MeshLambertMaterial({ map: getTexture('cars') }))
    w.position.setFromMatrixPosition(node.matrixWorld)
    w.rotation.order = 'YXZ'
    w.name = node.name
    group.add(w)
    wheels.push(w)
    if (/front/i.test(node.name)) steerWheels.push(w)
  }

  // Measure the body for collision + wheel radius.
  const box = new THREE.Box3().setFromObject(body)
  const size = box.getSize(new THREE.Vector3())
  const wheelRadius = wheels.length > 0 ? measureWheelRadius(wheels[0]) : 0.25

  group.scale.setScalar(WORLD.CAR_SCALE)
  return { group, body, wheels, halfW: size.x / 2, halfL: size.z / 2, wheelRadius, steerWheels }
}

function measureWheelRadius(wheel: THREE.Mesh): number {
  const box = new THREE.Box3().setFromObject(wheel)
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.z) / 2
}

/** Strip attributes that would break mergeGeometries across meshes. */
function normalizeGeo(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') {
      g.deleteAttribute(name)
    }
  }
  if (!g.attributes.uv) {
    const count = g.attributes.position.count
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  }
  return g
}

/** Merged static geometry for a city prop (roads, buildings, trees). */
export async function getStaticGeometry(group: string, name: string): Promise<THREE.BufferGeometry> {
  const cacheKey = `${group}/${name}`
  const hit = staticCache.get(cacheKey)
  if (hit) return hit

  const root = await loadGLTF(`/models/${group}/${name}.glb`)
  root.updateMatrixWorld(true)
  const geos: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    normalizeGeo(g)
    geos.push(g)
  })
  const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0]
  if (!merged) throw new Error(`empty geometry ${cacheKey}`)
  staticCache.set(cacheKey, merged)
  return merged
}

export interface CharacterRig {
  group: THREE.Group
  mixer: THREE.AnimationMixer
  clips: Map<string, THREE.AnimationClip>
}

/** Clone a blocky character with its animation set. */
export async function getCharacter(key: string): Promise<CharacterRig> {
  const hit = charCache.get(key)
  if (hit) {
    const group = hit.template.clone(true)
    const mixer = new THREE.AnimationMixer(group)
    const clips = new Map<string, THREE.AnimationClip>()
    for (const [name, clip] of hit.clips) clips.set(name, clip)
    return { group, mixer, clips }
  }
  const gltf = await new Promise<{ scene: THREE.Group; clips: THREE.AnimationClip[] }>((resolve, reject) => {
    loader.load(
      `/models/characters/${key}.glb`,
      (g) => resolve({ scene: g.scene, clips: g.animations }),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    )
  })
  const template = gltf.scene
  const clips = new Map<string, THREE.AnimationClip>()
  for (const c of gltf.clips) clips.set(c.name, c)
  charCache.set(key, { template, clips })

  const group = template.clone(true)
  const mixer = new THREE.AnimationMixer(group)
  return { group, mixer, clips }
}

/** All character keys available for peds. */
export const CHARACTER_KEYS = Array.from({ length: 18 }, (_, i) => `character-${String.fromCharCode(97 + i)}`)

/** Traffic car models (civilian). */
export const TRAFFIC_MODELS = [
  'sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury',
  'taxi', 'van', 'truck', 'delivery', 'ambulance', 'garbage-truck', 'firetruck',
] as const

export const POLICE_MODEL = 'police'
