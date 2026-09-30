#!/usr/bin/env node
// Renders the versioned PWA icons in frontend/public from the tracked brand art
// in frontend/icon logo images.
//
// Usage:  node ops/scripts/assets/generate-app-icons.mjs [--check] [--out-dir=<dir>]
//   --check           render in memory and fail if any output differs from disk
//   --out-dir=<dir>   write (or check) there instead of frontend/public
//
// The staff app keeps its BO art byte-for-byte (owner, 28 Sep 2026):
// icon-192.png, icon-512.png, admin-favicon-v1.ico and admin-apple-touch-icon-v1.png
// are not rendered here, because Business-os.png no longer reproduces them.

import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sharp = require(path.join(REPO, 'cloudflare', 'node_modules', 'sharp'))

const SOURCE_DIR = process.env.BUSINESS_OS_BRAND_ASSET_DIR || path.join(REPO, 'frontend', 'icon logo images')
const PUBLIC_DIR = path.join(REPO, 'frontend', 'public')
const OUT_DIR_FLAG = '--out-dir='

// Farthest mark pixel from the centre as a fraction of the side; a maskable
// mark stays inside the 0.40 safe circle every launcher mask keeps.
const MASKABLE_MARK_REACH = 0.38
const ROUNDED_MARK_REACH = 0.46
const APPLE_MARK_REACH = 0.40
const FAVICON_MARK_REACH = 0.47
const ALPHA_FLOOR = 0.05
const MIN_MARK_COMPONENT_PIXELS = 64
const CORNER_RADIUS_RATIO = 0.23
const FAVICON_SIZES = [16, 32, 48]

// Icons stay lossless (owner, 23 Aug 2026).
const LOSSLESS_PNG = { compressionLevel: 9, adaptiveFiltering: true, palette: false }

export const BRANDS = {
  staff: {
    source: 'Business-os.png',
    // The BO glyph, inside the tile.
    box: { left: 180, top: 300, width: 931, height: 621 },
    key: (red, green, blue) => Math.max(red, green, blue),
    keyRange: [80, 150],
    field: '#031448',
  },
  shop: {
    source: 'leang-cosmetics-logo-2026-09-28.webp',
    // The mark only: above the words, inside the frame line.
    box: { left: 240, top: 90, width: 861, height: 833 },
    key: (red, green) => red - green,
    keyRange: [70, 120],
    // Median of the logo's field in a ring around the mark.
    field: '#fee6ec',
  },
}

export const OUTPUTS = [
  { file: 'icon-192-maskable-v2.png', brand: 'staff', kind: 'maskable', size: 192 },
  { file: 'icon-512-maskable-v2.png', brand: 'staff', kind: 'maskable', size: 512 },
  { file: 'leang-cosmetics-icon-192-v2.png', brand: 'shop', kind: 'rounded', size: 192 },
  { file: 'leang-cosmetics-icon-512-v2.png', brand: 'shop', kind: 'rounded', size: 512 },
  { file: 'leang-cosmetics-icon-192-maskable-v2.png', brand: 'shop', kind: 'maskable', size: 192 },
  { file: 'leang-cosmetics-icon-512-maskable-v2.png', brand: 'shop', kind: 'maskable', size: 512 },
  { file: 'leang-cosmetics-apple-touch-icon-v2.png', brand: 'shop', kind: 'flat', size: 180 },
  { file: 'leang-cosmetics-favicon-v2.ico', brand: 'shop', kind: 'favicon' },
]

export const CONVENTIONAL_ALIASES = {
  'favicon.ico': 'leang-cosmetics-favicon-v2.ico',
  'apple-touch-icon.png': 'leang-cosmetics-apple-touch-icon-v2.png',
  'icon.png': 'leang-cosmetics-icon-512-v2.png',
}

const MARK_REACH_BY_KIND = { maskable: MASKABLE_MARK_REACH, rounded: ROUNDED_MARK_REACH, flat: APPLE_MARK_REACH, favicon: FAVICON_MARK_REACH }

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)))

function keyAlpha(keyValue, [low, high]) {
  const alpha = Math.max(0, Math.min(1, (keyValue - low) / (high - low)))
  return alpha > ALPHA_FLOOR ? alpha : 0
}

// What the key finds touching the box edge (the staff tile's edge glow, the shop
// poster's light streaks) or no bigger than a speck is background, not mark.
function keepMarkComponents(alpha, width, height) {
  const visited = new Uint8Array(width * height)
  const stack = []
  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || alpha[start] === 0) continue
    const component = []
    let touchesEdge = false
    visited[start] = 1
    stack.push(start)
    while (stack.length > 0) {
      const index = stack.pop()
      component.push(index)
      const x = index % width
      const y = (index - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const neighbour = ny * width + nx
          if (visited[neighbour] || alpha[neighbour] === 0) continue
          visited[neighbour] = 1
          stack.push(neighbour)
        }
      }
    }
    if (touchesEdge || component.length < MIN_MARK_COMPONENT_PIXELS) for (const index of component) alpha[index] = 0
  }
}

async function liftMark(brandName) {
  const { source, box, key, keyRange, field } = BRANDS[brandName]
  const pixels = await sharp(path.join(SOURCE_DIR, source)).removeAlpha().extract(box).raw().toBuffer()
  const { width, height } = box
  const fieldRgb = hexToRgb(field)

  const alpha = new Float64Array(width * height)
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 3
    alpha[index] = keyAlpha(key(pixels[offset], pixels[offset + 1], pixels[offset + 2]), keyRange)
  }
  keepMarkComponents(alpha, width, height)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) continue
    const x = index % width
    const y = (index - x) / width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error(`${source}: the key found no mark inside its box`)

  const bounds = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  // Equal width and height parity lets placedMark centre the crop on a whole
  // pixel; the padding row is transparent.
  const cropWidth = bounds.width
  const cropHeight = bounds.height + ((bounds.width - bounds.height) % 2 === 0 ? 0 : 1)
  const rgba = Buffer.alloc(cropWidth * cropHeight * 4)
  let reach = 0
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const index = (y + minY) * width + (x + minX)
      const a = alpha[index]
      if (a === 0) continue
      reach = Math.max(reach, Math.hypot(Math.abs(x + 0.5 - cropWidth / 2) + 0.5, Math.abs(y + 0.5 - cropHeight / 2) + 0.5))
      const target = (y * cropWidth + x) * 4
      // Un-blended against the field it lands on, so every kept pixel
      // composites back to its source colour.
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[target + channel] = clampByte((pixels[index * 3 + channel] - (1 - a) * fieldRgb[channel]) / a)
      }
      rgba[target + 3] = clampByte(a * 255)
    }
  }
  return { rgba, width: cropWidth, height: cropHeight, reach, bounds }
}

const liftedMarks = new Map()
function liftedMark(brandName) {
  if (!liftedMarks.has(brandName)) liftedMarks.set(brandName, liftMark(brandName))
  return liftedMarks.get(brandName)
}

// One square canvas centred on the mark, sized so its farthest pixel sits at
// markReach x side, then one resize: no rounded offsets move the mark.
async function placedMark(brandName, size, markReach) {
  const mark = await liftedMark(brandName)
  let side = Math.ceil(mark.reach / markReach)
  if ((side - mark.width) % 2 !== 0) side += 1
  const left = (side - mark.width) / 2
  const top = (side - mark.height) / 2
  // Two passes because sharp always extends after it resizes.
  const canvas = await sharp(mark.rgba, { raw: { width: mark.width, height: mark.height, channels: 4 } })
    .extend({ left, top, right: left, bottom: top, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer()
  return sharp(canvas, { raw: { width: side, height: side, channels: 4 } })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer()
}

async function markOnField(brandName, size, markReach) {
  return sharp({ create: { width: size, height: size, channels: 4, background: BRANDS[brandName].field } })
    .composite([{ input: await placedMark(brandName, size, markReach) }])
    .png()
    .toBuffer()
}

function roundedRectMask(size) {
  const radius = Math.round(size * CORNER_RADIUS_RATIO)
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`,
  )
}

export async function renderIconPng(brandName, kind, size) {
  const composed = await markOnField(brandName, size, MARK_REACH_BY_KIND[kind])
  if (kind === 'maskable' || kind === 'flat') {
    // A separate pass, not a chained removeAlpha(): sharp does not apply
    // operations in call order, and composite() must see the alpha channel.
    return sharp(composed).removeAlpha().png(LOSSLESS_PNG).toBuffer()
  }
  return sharp(composed).composite([{ input: roundedRectMask(size), blend: 'dest-in' }]).png(LOSSLESS_PNG).toBuffer()
}

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size, 0)
    entry.writeUInt8(size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

export async function renderIcon({ brand, kind, size }) {
  if (kind !== 'favicon') return renderIconPng(brand, kind, size)
  const images = []
  for (const faviconSize of FAVICON_SIZES) images.push({ size: faviconSize, data: await renderIconPng(brand, kind, faviconSize) })
  return buildIco(images)
}

export async function markMeasurements(brandName) {
  const { bounds, reach } = await liftedMark(brandName)
  return { bounds, reach }
}

async function renderAll() {
  const rendered = new Map()
  for (const output of OUTPUTS) rendered.set(output.file, await renderIcon(output))
  for (const [alias, twin] of Object.entries(CONVENTIONAL_ALIASES)) rendered.set(alias, rendered.get(twin))
  return rendered
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const outDirArgument = process.argv.find((argument) => argument.startsWith(OUT_DIR_FLAG))
  const outDir = outDirArgument ? path.resolve(outDirArgument.slice(OUT_DIR_FLAG.length)) : PUBLIC_DIR
  if (!checkOnly) await fs.mkdir(outDir, { recursive: true })

  let differing = 0
  for (const [file, data] of await renderAll()) {
    const target = path.join(outDir, file)
    const existing = await fs.readFile(target).catch(() => null)
    if (existing && existing.equals(data)) {
      console.log(`  unchanged  ${file}`)
      continue
    }
    differing += 1
    if (checkOnly) {
      console.log(`  ${existing ? 'DIFFERS' : 'MISSING'}    ${file}`)
      continue
    }
    await fs.writeFile(target, data)
    console.log(`  wrote      ${file}  (${data.length} B)`)
  }

  if (checkOnly && differing > 0) {
    console.error(`\n${differing} icon(s) differ from their source art in ${outDir}. Run: node ops/scripts/assets/generate-app-icons.mjs`)
    process.exit(1)
  }
  console.log(checkOnly ? `\nAll icons in ${outDir} match their source art.` : `\nDone -- ${differing} file(s) written to ${outDir}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
