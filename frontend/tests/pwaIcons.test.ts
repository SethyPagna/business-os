// The icon files each installed app wears: pixels, bytes and names.
//
// Owner, 28 Sep 2026: the staff app keeps its blue BO art byte for byte; the
// shop's icons are the L mark cut from the owner's logo, never the words; an
// Android launcher's circle or squircle must show the whole mark with no inner
// frame. Wiring (which file each page and manifest names) is brandIcons.test.ts.
//
// Run: node tests/pwaIcons.test.ts

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

type Role = 'any' | 'maskable' | 'apple' | 'favicon' | 'retired'
type LedgerEntry = { sha256: string; brand: 'staff' | 'shop'; role: Role; bytesOf?: string }
type Ledger = { immutable: Record<string, LedgerEntry>; mutable: Record<string, string> }
type Manifest = { icons: Array<{ src: string; purpose: string }> }
type Image = { side: number; channels: 3 | 4; pixels: Buffer }
type Pixel = [number, number, number, number]

// Every launcher mask keeps the circle of radius 0.40 x side (W3C maskable
// safe zone); a maskable icon is flat field outside it.
const SAFE_ZONE_RADIUS = 0.40
const FIELD_TOLERANCE = 24
const MIN_MARK_REACH = 0.30
const MAX_SHOP_MARK_REACH = 0.48
const OWNER_LOGO_MARK = { width: 750, height: 782 }
const MARK_ASPECT_TOLERANCE = 0.03
const FAVICON_SIZES = [16, 32, 48]
const CONVENTIONAL_PATHS = ['apple-touch-icon.png', 'favicon.ico', 'icon.png']
const STAFF_ART_AT_C3784A2EB: Record<string, string> = {
  'icon-192.png': '3d690206db3a8c15534d8405dc22bbde2639641b0c3306495113c257be00554f',
  'icon-512.png': '205c18a3cc49ed461e5c74abd96c69ec23b8d5ee1a4936496e71b13d7b971769',
  'admin-favicon-v1.ico': '35bafc890a3c0df3d51e48fe9c27a6e3c30efd477e26aee6fcd85a7a59e3ac2e',
  'admin-apple-touch-icon-v1.png': 'c06bbd6e47b10795334e42330407ee4a615440a019b3c6bfa7d4cbf3a963593b',
}

const publicPath = (file: string): string => fileURLToPath(new URL(`../public/${file.replace(/^\//, '')}`, import.meta.url))
const exists = (file: string): boolean => fs.existsSync(publicPath(file))
const readPublic = (file: string): Buffer => fs.readFileSync(publicPath(file))
const sha256 = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex')
const readJson = <T>(relPath: string): T => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')) as T

const ledger = readJson<Ledger>('./fixtures/pwa-icon-ledger.json')
const staffManifest = readJson<Manifest>('../public/manifest.json')
const shopManifest = readJson<Manifest>('../public/portal-manifest.json')
const currentIcons = (brand: 'staff' | 'shop' | null, roles: Role[]): string[] =>
  Object.entries(ledger.immutable)
    .filter(([, entry]) => (brand === null || entry.brand === brand) && roles.includes(entry.role))
    .map(([file]) => file)
const manifestIcons = (manifest: Manifest, purpose: string): string[] =>
  manifest.icons.filter((icon) => icon.purpose.split(/\s+/).includes(purpose)).map((icon) => icon.src.replace(/^\//, ''))

const PNG_SIGNATURE = '89504e470d0a1a0a'

function decodePng(bytes: Buffer): Image {
  assert.equal(bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE, 'not a PNG')
  let offset = 8
  let side = 0
  let height = 0
  let colorType = -1
  let bitDepth = 0
  let interlace = 0
  const data: Buffer[] = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      side = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  assert.equal(side, height, 'icons are square')
  assert.ok(bitDepth === 8 && interlace === 0 && (colorType === 2 || colorType === 6), `8-bit RGB or RGBA, not interlaced (got ${bitDepth}/${colorType}/${interlace})`)
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = side * channels
  const pixels = Buffer.alloc(side * stride)
  for (let y = 0; y < side; y += 1) {
    const filter = raw[y * (stride + 1)]
    assert.ok(filter <= 4, `row ${y}: unknown PNG filter ${filter}`)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      const paeth = (): number => {
        const estimate = left + up - upLeft
        const toLeft = Math.abs(estimate - left)
        const toUp = Math.abs(estimate - up)
        const toUpLeft = Math.abs(estimate - upLeft)
        return toLeft <= toUp && toLeft <= toUpLeft ? left : (toUp <= toUpLeft ? up : upLeft)
      }
      const predictor = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter]
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255
    }
  }
  return { side, channels, pixels }
}

function pixelAt(image: Image, x: number, y: number): Pixel {
  const offset = (y * image.side + x) * image.channels
  const alpha = image.channels === 4 ? image.pixels[offset + 3] : 255
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], alpha]
}

// The field is the flat ground the mark sits on; the middle of the top edge is
// field in every icon shape (square, rounded tile, circle-safe maskable).
function markShape(image: Image) {
  const field = pixelAt(image, Math.floor(image.side / 2), 0)
  const centre = image.side / 2
  const markRows = new Set<number>()
  let left = image.side
  let right = -1
  let reach = 0
  let outsideSafeZone = 0
  for (let y = 0; y < image.side; y += 1) {
    for (let x = 0; x < image.side; x += 1) {
      const [red, green, blue, alpha] = pixelAt(image, x, y)
      if (alpha < 128) continue
      if (Math.abs(red - field[0]) + Math.abs(green - field[1]) + Math.abs(blue - field[2]) <= FIELD_TOLERANCE) continue
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      if (distance > SAFE_ZONE_RADIUS * image.side) outsideSafeZone += 1
      reach = Math.max(reach, distance)
      left = Math.min(left, x)
      right = Math.max(right, x)
      markRows.add(y)
    }
  }
  const rows = [...markRows].sort((a, b) => a - b)
  const height = rows.length === 0 ? 0 : rows[rows.length - 1] - rows[0] + 1
  return {
    reach: reach / image.side,
    outsideSafeZone,
    aspect: (right - left + 1) / height,
    emptyRows: height - rows.length,
  }
}

function icoEntries(bytes: Buffer): { size: number; payload: Buffer }[] {
  assert.equal(bytes.readUInt16LE(2), 1, 'an ICO file')
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16
    const offset = bytes.readUInt32LE(entry + 12)
    return { size: bytes[entry] || 256, payload: bytes.subarray(offset, offset + bytes.readUInt32LE(entry + 8)) }
  })
}

const unique = (files: string[]): string[] => [...new Set(files)].sort()

test('every maskable icon fills the launcher shape: the whole mark inside the safe circle, flat field outside it', () => {
  const maskables = unique([...manifestIcons(staffManifest, 'maskable'), ...manifestIcons(shopManifest, 'maskable'), ...currentIcons(null, ['maskable'])])
  assert.ok(maskables.length >= 4, 'both apps list maskable icons')
  const faults: string[] = []
  for (const file of maskables) {
    if (!exists(file)) { faults.push(`${file}: missing`); continue }
    const image = decodePng(readPublic(file))
    if (image.channels === 4) faults.push(`${file}: has an alpha channel, so a launcher shows its own backdrop through it`)
    const shape = markShape(image)
    if (shape.outsideSafeZone > 0) faults.push(`${file}: ${shape.outsideSafeZone} pixels beyond ${SAFE_ZONE_RADIUS} x side are not the field (a frame or mark a launcher mask cuts)`)
    if (shape.reach < MIN_MARK_REACH) faults.push(`${file}: the mark reaches only ${shape.reach.toFixed(3)} x side`)
  }
  assert.deepEqual(faults, [])
})

test('the shop icons show the owner\'s L mark alone on a flat field, never the words or the poster', () => {
  const shopIcons = unique([
    ...manifestIcons(shopManifest, 'any'),
    ...manifestIcons(shopManifest, 'maskable'),
    ...currentIcons('shop', ['any', 'maskable', 'apple']).filter((file) => file.endsWith('.png')),
  ])
  const markAspect = OWNER_LOGO_MARK.width / OWNER_LOGO_MARK.height
  const faults: string[] = []
  for (const file of shopIcons) {
    if (!exists(file)) { faults.push(`${file}: missing`); continue }
    const shape = markShape(decodePng(readPublic(file)))
    if (Math.abs(shape.aspect / markAspect - 1) > MARK_ASPECT_TOLERANCE) faults.push(`${file}: mark box aspect ${shape.aspect.toFixed(3)}, the L mark is ${markAspect.toFixed(3)}`)
    if (shape.emptyRows > 0) faults.push(`${file}: ${shape.emptyRows} empty rows split the mark into bands, as a line of words under it does`)
    if (shape.reach < MIN_MARK_REACH || shape.reach > MAX_SHOP_MARK_REACH) faults.push(`${file}: the mark reaches ${shape.reach.toFixed(3)} x side, outside ${MIN_MARK_REACH}..${MAX_SHOP_MARK_REACH}`)
  }
  assert.deepEqual(faults, [])
})

test('the ledger names every icon in frontend/public, and new art gets a new file name', () => {
  const onDisk = fs.readdirSync(fileURLToPath(new URL('../public/', import.meta.url))).filter((file) => /\.(png|ico)$/i.test(file)).sort()
  const listed = new Set([...Object.keys(ledger.immutable), ...Object.keys(ledger.mutable)])
  assert.deepEqual(onDisk.filter((file) => !listed.has(file)), [], 'an icon file with no ledger entry')
  assert.deepEqual([...listed].filter((file) => !exists(file)).sort(), [], 'a ledger entry with no file')
  const changed = Object.entries(ledger.immutable).filter(([file, entry]) => exists(file) && sha256(readPublic(file)) !== entry.sha256).map(([file]) => file)
  assert.deepEqual(changed, [], 'new art needs a new file name: installed apps and caches keep the old bytes under an old name')
  assert.deepEqual(Object.keys(ledger.mutable).sort(), CONVENTIONAL_PATHS, 'only the conventional probe paths may change bytes')
})

test('the conventional paths browsers probe on their own carry the shop art', () => {
  const faults: string[] = []
  for (const [conventional, twin] of Object.entries(ledger.mutable)) {
    if (ledger.immutable[twin]?.brand !== 'shop' || ledger.immutable[twin]?.role === 'retired') faults.push(`${conventional}: twin ${twin} is not current shop art`)
    else if (!exists(conventional) || !exists(twin)) faults.push(`${conventional} or ${twin}: missing`)
    else if (!readPublic(conventional).equals(readPublic(twin))) faults.push(`${conventional}: bytes differ from ${twin}`)
  }
  assert.deepEqual(faults, [])
})

test('every favicon holds 16, 32 and 48 px PNG images', () => {
  const icos = unique([...currentIcons(null, ['favicon']), ...Object.keys(ledger.mutable).filter((file) => file.endsWith('.ico'))])
  assert.ok(icos.length >= 3, 'the staff favicon, the shop favicon and favicon.ico')
  for (const file of icos) {
    assert.ok(exists(file), `${file}: missing`)
    const entries = icoEntries(readPublic(file))
    assert.deepEqual(entries.map((entry) => entry.size).sort((a, b) => a - b), FAVICON_SIZES, file)
    for (const { size, payload } of entries) assert.equal(decodePng(payload).side, size, `${file}: the ${size} px entry is a ${size} px PNG`)
  }
})

test('the staff app keeps its BO art byte for byte (owner, 28 Sep 2026)', () => {
  const actual = Object.fromEntries(Object.keys(STAFF_ART_AT_C3784A2EB).map((file) => [file, exists(file) ? sha256(readPublic(file)) : 'missing']))
  assert.deepEqual(actual, STAFF_ART_AT_C3784A2EB)
})
