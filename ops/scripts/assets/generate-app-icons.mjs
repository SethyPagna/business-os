#!/usr/bin/env node
// Regenerates every app/PWA icon in frontend/public from the two brand
// source logos.
//
// Two brands, deliberately kept apart -- see frontend/public's own icons:
//   Business OS      -> the ADMIN app (admin.leangcosmetics.dpdns.org).
//                       Served by index.html + the static manifest.json.
//   Leang Cosmetics  -> the PUBLIC storefront (leangcosmetics.dpdns.org).
//                       PublicCatalogPage.tsx swaps the favicon and builds a
//                       runtime manifest from these, falling back to
//                       leang-cosmetics-icon-512.png when the merchant has
//                       not uploaded their own logo in the portal editor.
//
// Why this is a script and not a one-off: both source logos are 1254x1254
// PNGs with the artwork drawn as a rounded square on an opaque BLACK
// background and no alpha channel. Shipping them as-is puts black corners on
// every favicon and home-screen icon. This trims that surround, cuts the
// rounded corners to real transparency, and emits the size set the manifest
// and index.html actually reference -- reproducibly, so re-running after a
// logo tweak cannot drift from what is checked in.
//
// App icons are deliberately EXEMPT from the 40KB media budget
// (tests/assetCompression.test.ts's ICON_BUDGET_EXEMPTIONS) because they are
// fetched once per install and then stared at as a static image, so these are
// written at full quality rather than squeezed.
//
// Usage:  node ops/scripts/assets/generate-app-icons.mjs [--check]
//   --check  re-render into memory and diff against what is on disk, failing
//            instead of writing. Use in CI to catch a hand-edited icon that
//            no longer matches its source logo.

import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// sharp lives in the Worker project's node_modules (it is a build/ops tool
// here, not a frontend runtime dependency -- the frontend never bundles it).
const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sharp = require(path.join(REPO, 'cloudflare', 'node_modules', 'sharp'))

const PUBLIC_DIR = path.join(REPO, 'frontend', 'public')
const CHECK_ONLY = process.argv.includes('--check')

// Corner radius as a fraction of the icon width. Measured off both source
// logos (~24% and ~26%); 23% sits just inside both so the mask never leaves a
// sliver of the original black corner behind.
const CORNER_RADIUS_RATIO = 0.23

// A maskable icon is cropped by the OS to whatever shape the launcher uses,
// so its artwork has to sit inside the middle ~80% ("safe zone") with the rest
// bleeding to a flat background. 0.78 keeps a little margin beyond the spec's
// minimum.
const MASKABLE_ARTWORK_SCALE = 0.78

const BRANDS = {
  businessOs: {
    source: 'Business-os.png',
    // Sampled just inside the rounded rect on the source art, so a maskable
    // icon's bleed matches the logo's own edge instead of guessing a colour.
    maskableBackground: '#031448',
  },
  leangCosmetics: {
    source: 'Leang Cosmetics_1.png',
    maskableBackground: '#fde2e8',
  },
}

// Every file this script owns. Anything referenced by index.html or
// manifest.json must appear here, otherwise it silently keeps whatever stale
// art it had.
const OUTPUTS = [
  // --- admin app (Business OS) ---
  { file: 'icon-192.png', brand: 'businessOs', size: 192, kind: 'rounded' },
  { file: 'icon-512.png', brand: 'businessOs', size: 512, kind: 'rounded' },
  // icon.png is the generic fallback some crawlers/OSes probe for.
  { file: 'icon.png', brand: 'businessOs', size: 512, kind: 'rounded' },
  // iOS ignores transparency on apple-touch-icon and composites it onto
  // black, so this one is rendered FLAT on the brand background instead of
  // with cut corners. iOS applies its own squircle mask on top.
  { file: 'apple-touch-icon.png', brand: 'businessOs', size: 180, kind: 'flat' },
  { file: 'icon-192-maskable.png', brand: 'businessOs', size: 192, kind: 'maskable' },
  { file: 'icon-512-maskable.png', brand: 'businessOs', size: 512, kind: 'maskable' },

  // --- public storefront (Leang Cosmetics) ---
  { file: 'leang-cosmetics-icon-192.png', brand: 'leangCosmetics', size: 192, kind: 'rounded' },
  { file: 'leang-cosmetics-icon-512.png', brand: 'leangCosmetics', size: 512, kind: 'rounded' },
]

// Sizes packed into favicon.ico. 16/32 are what browsers actually draw in a
// tab and bookmark bar; 48 covers Windows shortcuts.
const FAVICON_SIZES = [16, 32, 48]

function resolveSource(fileName) {
  // Brand logos live outside the repo (they are large originals, and the repo
  // only carries the derived icons). Overridable so this can run in CI
  // against a checked-out asset directory.
  const dir = process.env.BUSINESS_OS_BRAND_ASSET_DIR || path.join(REPO, '..')
  return path.join(dir, fileName)
}

// The artwork is drawn on opaque black with no alpha. Find the real bounds of
// the non-black pixels rather than trusting sharp's trim(), which keys off a
// single corner pixel and gets confused by the soft glow on the Leang logo
// bleeding into the edges.
async function findArtworkBounds(sourcePath) {
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  // Sum of RGB. Deliberately loose: the drop shadow around the rounded rect
  // fades to near-black, and including it would leave a grey halo.
  const THRESHOLD = 90
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels
      if (data[i] + data[i + 1] + data[i + 2] > THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error(`${path.basename(sourcePath)}: found no non-black pixels`)
  // Force a square crop centred on the artwork -- the two source logos are
  // square to within a few pixels, and a non-square extract would make the
  // rounded-corner mask asymmetric.
  const side = Math.max(maxX - minX + 1, maxY - minY + 1)
  const cx = Math.round((minX + maxX) / 2)
  const cy = Math.round((minY + maxY) / 2)
  const left = Math.max(0, Math.min(width - side, cx - Math.round(side / 2)))
  const top = Math.max(0, Math.min(height - side, cy - Math.round(side / 2)))
  return { left, top, width: Math.min(side, width - left), height: Math.min(side, height - top) }
}

function roundedRectMask(size) {
  const r = Math.round(size * CORNER_RADIUS_RATIO)
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#ffffff"/>`
    + `</svg>`
  return Buffer.from(svg)
}

async function squareArtwork(sourcePath, size) {
  const bounds = await findArtworkBounds(sourcePath)
  return sharp(sourcePath)
    .extract(bounds)
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .png()
    .toBuffer()
}

async function render({ brand, size, kind }) {
  const { source, maskableBackground } = BRANDS[brand]
  const sourcePath = resolveSource(source)

  if (kind === 'maskable') {
    const inner = Math.round(size * MASKABLE_ARTWORK_SCALE)
    const art = await squareArtwork(sourcePath, inner)
    // Composite the cut-corner artwork onto a full-bleed brand background so
    // the launcher's mask only ever crops flat colour.
    const masked = await sharp(art)
      .composite([{ input: roundedRectMask(inner), blend: 'dest-in' }])
      .png()
      .toBuffer()
    const offset = Math.round((size - inner) / 2)
    return sharp({
      create: { width: size, height: size, channels: 4, background: maskableBackground },
    })
      .composite([{ input: masked, left: offset, top: offset }])
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
  }

  const art = await squareArtwork(sourcePath, size)

  if (kind === 'flat') {
    // No transparency: flatten onto the brand background (iOS composites
    // apple-touch-icon onto black otherwise).
    return sharp(art)
      .flatten({ background: maskableBackground })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
  }

  // 'rounded': cut the corners to real transparency.
  return sharp(art)
    .composite([{ input: roundedRectMask(size), blend: 'dest-in' }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

// Minimal ICO container. sharp cannot write .ico, and the format is simple: a
// 6-byte header, one 16-byte directory entry per image, then the payloads.
// PNG payloads inside ICO are supported by every browser in this app's
// support range (Vista+ / all evergreen browsers).
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type 1 = icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = []
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette count
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

async function main() {
  const rendered = new Map()

  for (const output of OUTPUTS) {
    rendered.set(output.file, await render(output))
  }

  // favicon.ico -> the ADMIN brand, matching index.html's
  // /favicon.ico?v=business-os. The public storefront replaces the favicon at
  // runtime from portal settings, so it needs no .ico of its own.
  const faviconImages = []
  for (const size of FAVICON_SIZES) {
    faviconImages.push({ size, data: await render({ brand: 'businessOs', size, kind: 'rounded' }) })
  }
  rendered.set('favicon.ico', buildIco(faviconImages))

  let changed = 0
  for (const [file, data] of rendered) {
    const target = path.join(PUBLIC_DIR, file)
    const existing = await fs.readFile(target).catch(() => null)
    if (existing && existing.equals(data)) {
      console.log(`  unchanged  ${file}`)
      continue
    }
    changed += 1
    if (CHECK_ONLY) {
      console.log(`  DIFFERS    ${file}`)
      continue
    }
    await fs.writeFile(target, data)
    console.log(`  wrote      ${file}  (${(data.length / 1024).toFixed(1)} KB)`)
  }

  if (CHECK_ONLY && changed > 0) {
    console.error(`\n${changed} icon(s) differ from their source logos. Run: node ops/scripts/assets/generate-app-icons.mjs`)
    process.exit(1)
  }
  console.log(CHECK_ONLY ? '\nAll icons match their source logos.' : `\nDone -- ${changed} file(s) updated.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
