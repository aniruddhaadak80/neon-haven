// Build public/models from the fetched Kenney packs.
//
// What this does:
//   1. Copies a curated set of GLB models into public/models/<group>/<name>.glb
//      (clean, space-free URLs — the extracted pack folders are "GLB format").
//   2. Rewrites each GLB's external texture URI to a relative ../tex/<...>.png
//      path (relative so the models work under any base path, e.g. GH Pages)
//      and copies each texture once into public/models/tex/.
//   3. Prints what it built so the game's manifest can be kept in sync.
//
// Source packs live in public/assets (created by `npm run assets:fetch`).
// Run: node scripts/prepare-models.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ASSETS = join(ROOT, 'public/assets')
const OUT = join(ROOT, 'public/models')
const TEX = join(OUT, 'tex')

const PACKS = {
  cars: 'car-kit',
  roads: 'city-kit-roads',
  commercial: 'city-kit-commercial',
  suburban: 'city-kit-suburban',
  industrial: 'city-kit-industrial',
  blaster: 'blaster-kit',
  characters: 'blocky-rarity',
  nature: 'nature-kit',
  urban: 'retro-urban-kit',
  prototype: 'prototype-kit',
}
PACKS.characters = 'blocky-characters'

const seq = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String.fromCharCode(97 + i)}`)

const MODELS = {
  cars: [
    'taxi', 'sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury',
    'truck', 'truck-flat', 'van', 'delivery', 'ambulance', 'police', 'firetruck',
    'garbage-truck', 'tractor', 'tractor-police', 'race', 'race-future', 'box',
  ],
  roads: [
    'road-straight', 'road-straight-half', 'road-bend', 'road-bend-square',
    'road-crossroad', 'road-crossroad-line', 'road-crossing', 'road-intersection',
    'road-intersection-line', 'road-intersection-path', 'road-roundabout',
    'road-side', 'road-side-entry', 'road-side-exit', 'road-slant', 'road-slant-flat',
    'road-bridge', 'tile-low', 'tile-high', 'tile-slant', 'tile-slantHigh',
    'road-driveway-single', 'road-curve', 'road-curve-intersection', 'road-split',
    'construction-barrier', 'traffic-light', 'traffic-light-object-vertical',
    'light-square', 'light-curved', 'light-square-double', 'light-curved-double',
    'dumpster', 'electricity-pole', 'electricity-pole-single', 'road-sign-street',
    'road-sign-stop', 'road-sign-empty', 'sign-highway', 'construction-cone',
  ],
  commercial: [...seq('building', 14), ...seq('building-skyscraper', 5), 'detail-awning', ...seq('low-detail-building', 14)],
  suburban: seq('building-type', 20),
  industrial: seq('building', 12),
  blaster: ['blaster-a', 'blaster-d', 'blaster-g', 'blaster-i', 'blaster-k', 'blaster-p', 'bullet-foam'],
  characters: seq('character', 18),
  nature: [
    'tree_default', 'tree_default_dark', 'tree_tall', 'tree_tall_dark', 'tree_thin',
    'tree_pineTallA', 'tree_pineSmallA', 'tree_palm', 'tree_palmTall', 'tree_oak',
    'tree_blocks', 'tree_plateau', 'plant_bushLarge', 'plant_bushSmall', 'rock_largeA', 'rock_smallA',
  ],
  urban: ['detail-dumpster-closed', 'detail-bench', 'detail-bricks-type-a', 'detail-barrier-type-a', 'detail-light-double'],
  prototype: ['crate', 'crate-color', 'column', 'door-garage', 'indicator-round-a', 'coin'],
}

/** Find the directory that actually holds a group's GLB files. */
function findModelDir(pack) {
  for (const sub of ['Models/GLB format', 'Models/GLTF format', 'Models']) {
    const p = join(ASSETS, pack, sub)
    if (existsSync(p) && statSync(p).isDirectory()) {
      if (readdirSync(p).some((f) => f.endsWith('.glb') || f.endsWith('.gltf'))) return p
    }
  }
  throw new Error(`no model dir for pack ${pack} — did you run npm run assets:fetch?`)
}

/** Split a .glb into { header, json, bin } and rewrite texture URIs. */
function rewriteGlb(srcPath, group, texDirOut) {
  const buf = readFileSync(srcPath)
  const magic = buf.toString('utf8', 0, 4)
  if (magic !== 'glTF') throw new Error(`${srcPath} is not a binary glTF`)
  const jsonLen = buf.readUInt32LE(12)
  const jsonStart = 20
  const jsonEnd = jsonStart + jsonLen
  const gltf = JSON.parse(buf.toString('utf8', jsonStart, jsonEnd))

  for (const image of gltf.images ?? []) {
    const uri = image.uri
    if (!uri || uri.startsWith('data:')) continue
    const src = uri.startsWith('/') ? join(ROOT, uri.slice(1)) : join(dirname(srcPath), decodeURIComponent(uri))
    if (!existsSync(src)) throw new Error(`missing texture for ${srcPath}: ${src}`)
    const texName = `${group}-${basename(src)}`
    const dest = join(texDirOut, texName)
    writeFileSync(dest, readFileSync(src))
    image.uri = `../tex/${texName}`
  }

  const jsonOut = Buffer.from(JSON.stringify(gltf), 'utf8')
  const padding = (4 - (jsonOut.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonOut, Buffer.alloc(padding, 0x20)]) // GLB pads JSON with spaces
  const bin = buf.subarray(jsonEnd)
  const header = Buffer.alloc(12)
  const total = 12 + 8 + jsonChunk.length + bin.length
  header.write('glTF', 0, 'latin1')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.write('JSON', 4, 'latin1')
  return Buffer.concat([header, jsonHeader, jsonChunk, bin])
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
mkdirSync(TEX, { recursive: true })

let count = 0
let bytes = 0
const report = []
for (const [group, names] of Object.entries(MODELS)) {
  const pack = PACKS[group]
  const dir = findModelDir(pack)
  const outDir = join(OUT, group)
  mkdirSync(outDir, { recursive: true })
  const built = []
  for (const name of names) {
    const src = join(dir, `${name}.glb`)
    if (!existsSync(src)) {
      console.warn(`  ! missing ${group}/${name}.glb — skipped`)
      continue
    }
    const out = join(outDir, `${name}.glb`)
    const glb = rewriteGlb(src, group, TEX)
    writeFileSync(out, glb)
    bytes += glb.length
    count++
    built.push(name)
  }
  report.push(`${group.padEnd(12)} ${String(built.length).padStart(3)} models`)
}

console.log(`prepared ${count} models (${(bytes / 1024 / 1024).toFixed(1)} MB) into public/models`)
for (const line of report) console.log('  ' + line)
