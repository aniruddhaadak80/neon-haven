// Walk a Kenney GLB scene graph and print real bounding boxes (node translations applied).
// usage: node scripts/inspect-glb.mjs <pack> [--full]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../public/assets/', import.meta.url))
const pack = process.argv[2]
const full = process.argv.includes('--full')
const dir = join(root, pack, 'Models', 'GLB format')
const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()

const v = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function walk(node, gltf, offset) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const t = node.translation ?? [0, 0, 0]
  const o = v(offset, t)
  if (node.mesh !== undefined) {
    const mesh = gltf.meshes[node.mesh]
    for (const prim of mesh.primitives ?? []) {
      const acc = gltf.accessors[prim.attributes.POSITION]
      const nMin = v(acc.min, o)
      const nMax = v(acc.max, o)
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], nMin[i])
        max[i] = Math.max(max[i], nMax[i])
      }
    }
  }
  for (const child of node.children ?? []) {
    const r = walk(gltf.nodes[child], gltf, o)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], r.min[i])
      max[i] = Math.max(max[i], r.max[i])
    }
  }
  return { min, max }
}

for (const f of files) {
  const buf = readFileSync(join(dir, f))
  const jsonLen = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const sceneNode of gltf.scenes[gltf.scene ?? 0].nodes) {
    const r = walk(gltf.nodes[sceneNode], gltf, [0, 0, 0])
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], r.min[i]); max[i] = Math.max(max[i], r.max[i]) }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const nodes = (gltf.nodes ?? []).map((n) => n.name).filter(Boolean)
  const nodesLine = full && nodes.length ? `\n    nodes: ${nodes.join(', ')}` : ''
  console.log(
    `${f.replace('.glb', '').padEnd(34)} ${size.map((s) => s.toFixed(2)).join('x').padEnd(20)} ` +
    `y=[${min[1].toFixed(2)},${max[1].toFixed(2)}] z=[${min[2].toFixed(2)},${max[2].toFixed(2)}]${nodesLine}`
  )
}
