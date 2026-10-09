import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORLD } from '../config'
import { getStaticGeometry, getTexture } from '../assets/AssetLibrary'
import { makeRng, randRange, pick } from '../utils'

export interface CityData {
  group: THREE.Group
  /** N*N grid, 1 = blocked (building). */
  colliders: Uint8Array
  size: number
  origin: number
  streetsX: number[]
  streetsZ: number[]
  spawn: THREE.Vector3
  missionSpots: THREE.Vector3[]
  /** Emissive neon sign materials (DayNight controls their glow). */
  neon: THREE.MeshBasicMaterial[]
  bounds: number
}

type District = 'downtown' | 'urban' | 'suburban' | 'industrial' | 'park'

const { BLOCKS, SPACING, ROAD_SCALE, SEED } = WORLD
const N = BLOCKS * SPACING + 1
const HALF = N / 2

/** Convert grid tile → world coordinate. */
function tileToWorld(t: number): number {
  return t - HALF
}

/** Collects geometries and merges them into one mesh at the end. */
class GeoBatch {
  private geos: THREE.BufferGeometry[] = []
  constructor(private material: THREE.Material) {}

  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4) {
    const g = geo.clone()
    g.applyMatrix4(matrix)
    this.geos.push(g)
  }

  build(name: string): THREE.Mesh | null {
    if (this.geos.length === 0) return null
    const merged = this.geos.length > 1 ? mergeGeometries(this.geos, false) : this.geos[0]
    if (!merged) return null
    const mesh = new THREE.Mesh(merged, this.material)
    mesh.name = name
    mesh.matrixAutoUpdate = false
    return mesh
  }
}

function mat4(x: number, z: number, rotY = 0, scale = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  m.makeRotationY(rotY)
  m.scale(new THREE.Vector3(scale, scale, scale))
  m.setPosition(x, 0, z)
  return m
}

export async function buildCity(onProgress?: (frac: number, label: string) => void): Promise<CityData> {
  const rng = makeRng(SEED)
  const group = new THREE.Group()
  group.name = 'city'

  const roadMat = new THREE.MeshLambertMaterial({ map: getTexture('roads') })
  const bldMat = new THREE.MeshLambertMaterial({ map: getTexture('commercial') })
  const subMat = new THREE.MeshLambertMaterial({ map: getTexture('suburban') })
  const indMat = new THREE.MeshLambertMaterial({ map: getTexture('industrial') })
  const natMat = new THREE.MeshLambertMaterial({ map: getTexture('nature') })
  const urbanMat = new THREE.MeshLambertMaterial({ map: getTexture('urban') })
  const protoMat = new THREE.MeshLambertMaterial({ map: getTexture('prototype') })

  const roads = new GeoBatch(roadMat)
  const commercial = new GeoBatch(bldMat)
  const suburban = new GeoBatch(subMat)
  const industrial = new GeoBatch(indMat)
  const nature = new GeoBatch(natMat)
  const urban = new GeoBatch(urbanMat)
  const proto = new GeoBatch(protoMat)
  // Street furniture (lights, signs, poles, barriers) is *road-kit* geometry,
  // so it belongs in the road batch — its UVs index the road atlas.
  const streetProps = roads

  const colliders = new Uint8Array(N * N)
  const block = (i: number, j: number, r: number) => {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii >= 0 && jj >= 0 && ii < N && jj < N) colliders[jj * N + ii] = 1
      }
    }
  }

  const streetsX: number[] = []
  const streetsZ: number[] = []
  for (let k = 0; k <= BLOCKS; k++) {
    streetsX.push(tileToWorld(k * SPACING))
    streetsZ.push(tileToWorld(k * SPACING))
  }

  // --- Roads ---
  onProgress?.(0.05, 'laying roads')
  const roadStraight = await getStaticGeometry('roads', 'road-straight')
  const roadCross = await getStaticGeometry('roads', 'road-crossroad')

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const onI = i % SPACING < 2
      const onJ = j % SPACING < 2
      if (!onI && !onJ) continue
      const x = tileToWorld(i)
      const z = tileToWorld(j)
      const geo = onI && onJ ? roadCross : roadStraight
      roads.add(geo, mat4(x, z, 0, ROAD_SCALE))
    }
  }

  // --- Districts ---
  const center = BLOCKS / 2
  const districtAt = (bi: number, bj: number): District => {
    const d = Math.max(Math.abs(bi - center + 0.5), Math.abs(bj - center + 0.5))
    const r = rng()
    if (d < 1.6) return 'downtown'
    if (d < 3.2) return r < 0.75 ? 'urban' : 'downtown'
    if (d < 4.6) return r < 0.5 ? 'urban' : r < 0.6 ? 'suburban' : 'industrial'
    return r < 0.45 ? 'suburban' : r < 0.7 ? 'industrial' : r < 0.85 ? 'park' : 'urban'
  }

  // --- Buildings per block ---
  onProgress?.(0.2, 'raising buildings')
  const skyscrapers = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e']
  const commercialB = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n']
  const suburbanB = Array.from({ length: 20 }, (_, i) => `building-type-${String.fromCharCode(97 + i)}`)
  const industrialB = Array.from({ length: 12 }, (_, i) => `building-${String.fromCharCode(97 + i)}`)
  const trees = ['tree_default', 'tree_tall', 'tree_thin', 'tree_pineTallA', 'tree_pineSmallA', 'tree_palm', 'tree_oak', 'tree_blocks']
  const bushes = ['plant_bushLarge', 'plant_bushSmall']

  const neon: THREE.MeshBasicMaterial[] = []
  const neonSigns: THREE.Mesh[] = []
  const neonGeo = new THREE.BoxGeometry(0.5, 2.2, 0.08)
  const neonColors = [0xff2d95, 0x00e5ff, 0xffea00, 0x7c4dff, 0x00ff85, 0xff6d00]

  // Pre-load all building geometries we might use.
  const geoCache = new Map<string, THREE.BufferGeometry>()
  const loadGeo = async (g: string, n: string) => {
    const k = `${g}/${n}`
    if (!geoCache.has(k)) geoCache.set(k, await getStaticGeometry(g, n))
    return geoCache.get(k)!
  }

  let placed = 0
  for (let bj = 0; bj < BLOCKS; bj++) {
    for (let bi = 0; bi < BLOCKS; bi++) {
      const district = districtAt(bi, bj)
      // Buildable area: 1 tile setback from streets.
      const i0 = bi * SPACING + 2
      const i1 = (bi + 1) * SPACING - 2
      const j0 = bj * SPACING + 2
      const j1 = (bj + 1) * SPACING - 2

      if (district === 'park') {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            if (rng() < 0.55) {
              nature.add(await loadGeo('nature', pick(rng, trees)), mat4(tileToWorld(i) + randRange(rng, -0.3, 0.3), tileToWorld(j) + randRange(rng, -0.3, 0.3), randRange(rng, 0, Math.PI * 2), randRange(rng, 0.8, 1.5)))
            } else if (rng() < 0.3) {
              nature.add(await loadGeo('nature', pick(rng, bushes)), mat4(tileToWorld(i), tileToWorld(j), 0, randRange(rng, 0.7, 1.2)))
            }
          }
        }
        continue
      }

      if (district === 'downtown') {
        // 2x2 skyscrapers with a plaza between.
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const i = i0 + di * 2
            const j = j0 + dj * 2
            if (i > i1 || j > j1) continue
            const model = pick(rng, skyscrapers)
            const h = randRange(rng, 1.4, 2.6)
            commercial.add(await loadGeo('commercial', model), mat4(tileToWorld(i), tileToWorld(j), 0, h))
            block(i, j, 0)
            placed++
            // Neon strip on the face.
            if (rng() < 0.7) {
              const mat = new THREE.MeshBasicMaterial({ color: pick(rng, neonColors) })
              mat.userData.baseColor = mat.color.clone()
              const sign = new THREE.Mesh(neonGeo, mat)
              sign.position.set(tileToWorld(i) + randRange(rng, -0.4, 0.4), randRange(rng, 1.2, 2.2) * h, tileToWorld(j) + 0.75)
              neon.push(mat)
              neonSigns.push(sign)
            }
          }
        }
        continue
      }

      if (district === 'urban') {
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            if (rng() < 0.25) continue
            const model = pick(rng, commercialB)
            const h = randRange(rng, 0.9, 1.9)
            commercial.add(await loadGeo('commercial', model), mat4(tileToWorld(i), tileToWorld(j), 0, h))
            block(i, j, 0)
            placed++
            if (rng() < 0.3) {
              const mat = new THREE.MeshBasicMaterial({ color: pick(rng, neonColors) })
              mat.userData.baseColor = mat.color.clone()
              const sign = new THREE.Mesh(neonGeo, mat)
              sign.position.set(tileToWorld(i), randRange(rng, 0.8, 1.6) * h, tileToWorld(j) + 0.6)
              neon.push(mat)
              neonSigns.push(sign)
            }
          }
        }
        continue
      }

      if (district === 'suburban') {
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const i = i0 + di * 2
            const j = j0 + dj * 2
            if (i > i1 || j > j1) continue
            suburban.add(await loadGeo('suburban', pick(rng, suburbanB)), mat4(tileToWorld(i), tileToWorld(j), 0, randRange(rng, 0.9, 1.3)))
            block(i, j, 0)
            placed++
            if (rng() < 0.6) {
              nature.add(await loadGeo('nature', pick(rng, trees)), mat4(tileToWorld(i) + randRange(rng, 0.8, 1.4), tileToWorld(j) + randRange(rng, 0.8, 1.4), 0, randRange(rng, 0.7, 1.1)))
            }
          }
        }
        continue
      }

      // industrial
      const n = 1 + Math.floor(rng() * 2)
      for (let k = 0; k < n; k++) {
        const i = i0 + Math.floor(randRange(rng, 0, 3))
        const j = j0 + Math.floor(randRange(rng, 0, 3))
        if (i > i1 || j > j1) continue
        industrial.add(await loadGeo('industrial', pick(rng, industrialB)), mat4(tileToWorld(i), tileToWorld(j), 0, randRange(rng, 1.0, 1.6)))
        block(i, j, 0)
        placed++
      }
      // crates + barrels
      for (let k = 0; k < 4; k++) {
        if (rng() < 0.5) {
          proto.add(await loadGeo('prototype', 'crate'), mat4(tileToWorld(i0) + randRange(rng, 0, 4), tileToWorld(j0) + randRange(rng, 0, 4), randRange(rng, 0, 3), randRange(rng, 0.8, 1.4)))
        }
      }
    }
  }

  // --- Street dressing ---
  onProgress?.(0.55, 'dressing streets')
  const lightSquare = await getStaticGeometry('roads', 'light-square')
  const trafficLight = await getStaticGeometry('roads', 'traffic-light')
  const signStreet = await getStaticGeometry('roads', 'road-sign-street')
  const dumpster = await getStaticGeometry('roads', 'dumpster')
  const pole = await getStaticGeometry('roads', 'electricity-pole')
  const bench = await getStaticGeometry('urban', 'detail-bench')
  const barrier = await getStaticGeometry('roads', 'construction-barrier')

  for (let k = 0; k <= BLOCKS; k++) {
    for (let m = 0; m <= BLOCKS; m++) {
      const i = k * SPACING
      const j = m * SPACING
      const x = tileToWorld(i)
      const z = tileToWorld(j)
      // Street lights on two corners of every intersection.
      streetProps.add(lightSquare, mat4(x + 0.8, z + 0.8, 0, 1.4))
      streetProps.add(lightSquare, mat4(x - 0.8, z - 0.8, 0, 1.4))
      if ((k + m) % 2 === 0) {
        streetProps.add(trafficLight, mat4(x + 0.9, z - 0.9, Math.PI / 2, 1.2))
      }
      if ((k + m) % 3 === 0) {
        streetProps.add(signStreet, mat4(x - 0.9, z + 0.9, Math.PI, 1.2))
      }
      if ((k * 7 + m * 13) % 5 === 0) {
        streetProps.add(dumpster, mat4(x + 1.1, z + 0.4, randRange(rng, 0, 3), 1.2))
      }
      if ((k * 3 + m * 11) % 7 === 0) {
        urban.add(bench, mat4(x - 1.1, z - 0.4, Math.PI / 2, 1.2))
      }
    }
  }

  // Power poles along some streets.
  for (let k = 0; k <= BLOCKS; k++) {
    for (let t = 0; t < N; t += 4) {
      if (rng() < 0.4) {
        streetProps.add(pole, mat4(tileToWorld(k * SPACING) + 1.2, tileToWorld(t), 0, 1.3))
      }
    }
  }

  // A few construction barriers for flavour.
  for (let k = 0; k < 14; k++) {
    const i = Math.floor(randRange(rng, 1, N - 1))
    const j = Math.floor(randRange(rng, 1, N - 1))
    if (i % SPACING === 0 || j % SPACING === 0) {
      streetProps.add(barrier, mat4(tileToWorld(i) + 0.6, tileToWorld(j) + 0.6, randRange(rng, 0, 3), 1.2))
    }
  }

  // --- Ground plane ---
  onProgress?.(0.7, 'pouring asphalt')
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(N + 40, N + 40),
    new THREE.MeshLambertMaterial({ color: 0x1a1d24 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.03
  ground.name = 'ground'
  group.add(ground)

  // --- Merge batches ---
  onProgress?.(0.8, 'merging city')
  const batches: [GeoBatch, string][] = [
    [roads, 'roads'], [commercial, 'commercial'], [suburban, 'suburban'],
    [industrial, 'industrial'], [nature, 'nature'], [urban, 'urban'], [proto, 'props'],
  ]
  for (const [batch, name] of batches) {
    const mesh = batch.build(name)
    if (mesh) group.add(mesh)
  }
  for (const sign of neonSigns) group.add(sign)

  // --- Spawn + mission spots ---
  const spawn = new THREE.Vector3(tileToWorld(3 * SPACING), 0, tileToWorld(3 * SPACING))
  const missionSpots: THREE.Vector3[] = []
  for (let k = 0; k < 12; k++) {
    const i = Math.floor(randRange(rng, 2, N - 2))
    const j = Math.floor(randRange(rng, 2, N - 2))
    if (i % SPACING === 0 || j % SPACING === 0) {
      missionSpots.push(new THREE.Vector3(tileToWorld(i), 0, tileToWorld(j)))
    }
  }

  onProgress?.(1, 'done')
  return {
    group,
    colliders,
    size: N,
    origin: -HALF,
    streetsX,
    streetsZ,
    spawn,
    missionSpots,
    neon,
    bounds: HALF + 2,
  }
}

/** Is a world position inside a building? */
export function isBlocked(city: CityData, x: number, z: number): boolean {
  const i = Math.floor(x - city.origin)
  const j = Math.floor(z - city.origin)
  if (i < 0 || j < 0 || i >= city.size || j >= city.size) return true
  return city.colliders[j * city.size + i] === 1
}

/** Push a circle (x,z,r) out of blocked cells. Returns corrected [x, z]. */
export function resolveCollision(city: CityData, x: number, z: number, r: number): [number, number] {
  const i0 = Math.floor(x - city.origin)
  const j0 = Math.floor(z - city.origin)
  const ri = Math.ceil(r)
  let px = x
  let pz = z
  for (let dj = -ri; dj <= ri; dj++) {
    for (let di = -ri; di <= ri; di++) {
      const i = i0 + di
      const j = j0 + dj
      if (i < 0 || j < 0 || i >= city.size || j >= city.size) continue
      if (city.colliders[j * city.size + i] !== 1) continue
      // Cell AABB in world space.
      const cx = city.origin + i
      const cz = city.origin + j
      const minX = cx - 0.5
      const maxX = cx + 0.5
      const minZ = cz - 0.5
      const maxZ = cz + 0.5
      // Closest point on AABB to circle centre.
      const nx = Math.max(minX, Math.min(px, maxX))
      const nz = Math.max(minZ, Math.min(pz, maxZ))
      const dx = px - nx
      const dz = pz - nz
      const d2 = dx * dx + dz * dz
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        const push = (r - d) / d
        px += dx * push
        pz += dz * push
      } else if (d2 <= 1e-6) {
        // Centre inside the cell: push out along the smallest axis.
        const left = px - minX
        const right = maxX - px
        const top = pz - minZ
        const bottom = maxZ - pz
        const m = Math.min(left, right, top, bottom)
        if (m === left) px = minX - r
        else if (m === right) px = maxX + r
        else if (m === top) pz = minZ - r
        else pz = maxZ + r
      }
    }
  }
  return [px, pz]
}
