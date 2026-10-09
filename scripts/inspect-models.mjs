// Print real bounding boxes for prepared models (full node transform walk incl. scale).
// usage: node scripts/inspect-models.mjs [group]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const models = fileURLToPath(new URL('../public/models/', import.meta.url))
const only = process.argv[2]
const groups = only ? [only] : readdirSync(models).filter((g) => statSync(join(models, g)).isDirectory())

const mul = (a, b) => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0], a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0], a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][2], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2]],
  [a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0], a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][2], a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2]],
]

function nodeMatrix(node) {
  const m = node.matrix ?? null
  if (m) return m
  const T = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  if (node.translation) { T[0][2] = node.translation[0]; T[1][2] = node.translation[1]; T[2][2] = node.translation[2] }
  if (node.scale) { T[0][0] = node.scale[0]; T[1][1] = node.scale[1]; T[2][2] = node.scale[2] }
  return T
}

function walk(node, gltf, parent) {
  const local = nodeMatrix(node)
  const world = mul(parent, local)
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  if (node.mesh !== undefined) {
    for (const prim of gltf.meshes[node.mesh].primitives ?? []) {
      const acc = gltf.accessors[prim.attributes.POSITION]
      for (const p of [acc.min, acc.max]) {
        const q = [
          world[0][0] * p[0] + world[0][1] * p[1] + world[0][2] * p[2],
          world[1][0] * p[0] + world[1][1] * p[1] + world[1][2] * p[2],
          world[2][0] * p[0] + world[2][1] * p[1] + world[2][2] * p[2],
        ]
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], q[i]); max[i] = Math.max(max[i], q[i]) }
      }
    }
  }
  for (const c of node.children ?? []) {
    const r = walk(gltf.nodes[c], gltf, world)
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], r.min[i]); max[i] = Math.max(max[i], r.max[i]) }
  }
  return { min, max }
}

for (const group of groups) {
  const dir = join(models, group)
  const names = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()
  console.log(`\n=== ${group} ===`)
  for (const f of names) {
    const b = readFileSync(join(dir, f))
    const n = b.readUInt32LE(12)
    const g = JSON.parse(b.toString('utf8', 20, 20 + n))
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const s of g.scenes[g.scene ?? 0].nodes) {
      const r = walk(g.nodes[s], g, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], r.min[i]); max[i] = Math.max(max[i], r.max[i]) }
    }
    const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    console.log(
      `${f.replace('.glb', '').padEnd(28)} ${s.map((v) => v.toFixed(2)).join(' x ').padEnd(22)} ` +
      `y[${min[1].toFixed(2)}, ${max[1].toFixed(2)}]`.padEnd(20)
    )
  }
}
