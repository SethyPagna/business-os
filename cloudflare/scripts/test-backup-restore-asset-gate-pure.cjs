// S-uploads2a fix 4 (2026-09-27): a backup restore writes a backed-up asset
// back under uploads/ only when the Worker's own upload gate accepts its
// bytes, and stores it with the type detected from them. Everything else is
// never written under uploads/: it is copied unchanged to
// quarantine/<time>/<its key> and listed in the report (withheldAssets).
//
// restoreCloudflareBackup (lib/backup.ts) runs for real, with the real
// uploadSecurity.ts, r2.ts, backupRestoreStream.ts, planTier.ts and
// customTableName.ts, against node:sqlite for D1 and an in-memory R2 that
// keeps bytes, stored metadata and every request. The expected outcome of
// each file comes from the fixture catalogue (what the upload gate must say
// about it), never from the code under test. Checked:
//
//   1. Every fixture of the upload classifier tests -- the refuter's probes,
//      the polyglot bypasses in every carrier, C2PA manifests, ISO brands,
//      HEIC/BMP/TIFF and other media, documents, pages, text, archives,
//      programs -- backed up under a stored type of text/html: images and
//      videos come back byte for byte with their detected type; the rest is
//      never written under uploads/ and sits in quarantine/ byte for byte
//      with its stored metadata, listed with the reason.
//   2. The report keeps every field it had, with the same meaning.
//   3. A copy larger than RESTORE_ASSET_SCAN_MAX_BYTES is judged by its first
//      bytes and streamed, never read whole: a video comes back, a document
//      and an image too large to check go to quarantine, and a copy replaced
//      between the check and the copy is not written.
//   4. The document names the folder and the keys: nothing is read outside
//      backups/cloudflare/<name>/assets/ and nothing is written outside
//      uploads/ and quarantine/.
//   5. Missing copies stay missingAssets; failed writes are reported; a live
//      file under a withheld key is left alone; the backup's copies are
//      never changed and nothing is deleted.
//   6. End to end: createCloudflareBackup, lose the files, restore.
//
// S-uploads3 (2026-09-27): parity with the owner-run purge. The expected
// outcome of each file is now the PURGE's verdict on it
// (ops/scripts/purge-non-media-uploads.mjs classifyObject -- not the code
// under test): what the purge keeps comes back under uploads/, images and
// videos of the upload allowlist with their detected type and every other
// media format it keeps (HEIC, BMP, TIFF, camera raw, MP4 brands off the
// allowlist such as Canon `CAEP` and `mp21`, audio...) with a plain media
// type for its format, never one a browser renders as a document; images
// with web-page code, empty files and everything the purge would move or
// review are withheld. Before this, HEIC/BMP/CAEP/mp21 were withheld as
// not-media although the purge keeps them and /uploads/* serves them.
//
// To see it fail on an older tree, point it at an older backup.ts:
//   git show 1e2c945c:cloudflare/src/lib/backup.ts > /tmp/backup.ts
//   BACKUP_TS=/tmp/backup.ts node test-backup-restore-asset-gate-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const F = require('./harness/upload_fixtures.cjs')
const { pathToFileURL } = require('node:url')
const PURGE_SOURCE = path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')

const SRC = path.join(__dirname, '..', 'src', 'lib')
const BACKUP_TS = process.env.BACKUP_TS || path.join(SRC, 'backup.ts')

// ------------------------------------------------------------ loading
const loadedModules = new Map()
function loadModule(file, deps = {}) {
  file = path.resolve(file)
  if (loadedModules.has(file)) return loadedModules.get(file).exports
  const loaded = { exports: {} }
  const outputText = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  loadedModules.set(file, loaded)
  const load = (id) => {
    if (Object.prototype.hasOwnProperty.call(deps, id)) return deps[id]
    if (id === 'hono/http-exception') return require(id)
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(file), id)
      return loadModule(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    throw new Error(`${path.basename(file)} imports ${id}, which this test does not provide`)
  }
  try { new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(loaded.exports, load, loaded, file, path.dirname(file)) }
  catch (error) { loadedModules.delete(file); throw error }
  return loaded.exports
}
const backup = loadModule(BACKUP_TS, {
  './r2': loadModule(path.join(SRC, 'r2.ts')),
  './planTier': loadModule(path.join(SRC, 'planTier.ts')),
  './backupRestoreStream': loadModule(path.join(SRC, 'backupRestoreStream.ts')),
  './customTableName': loadModule(path.join(SRC, 'customTableName.ts')),
  './uploadSecurity': loadModule(path.join(SRC, 'uploadSecurity.ts')),
})
// Absent before this fix; the documented 32 MB is used then.
const SCAN_MAX = Number(backup.RESTORE_ASSET_SCAN_MAX_BYTES) || 32 * 1024 * 1024

// ------------------------------------------------------------- checks
const failures = []
let checks = 0
function expect(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}
async function scenario(name, fn) {
  try {
    await fn((label, check) => expect(`${name} -- ${label}`, check))
  } catch (error) {
    checks += 1
    failures.push(`${name}: crashed: ${String(error && error.stack).split('\n').slice(0, 3).join(' | ')}`)
  }
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex')

async function readAll(stream) {
  const reader = stream.getReader()
  const chunks = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value))
  }
  return F.bytes(...chunks)
}

async function toBytes(value) {
  if (value === null || value === undefined) return new Uint8Array(0)
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'utf8'))
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  if (typeof value.getReader === 'function') {
    // A body from get() has a known length, as in the Workers runtime; R2
    // refuses the put when the stream delivers a different number of bytes.
    const bytes = await readAll(value)
    if (typeof value.expectedLength === 'number' && bytes.length !== value.expectedLength) {
      throw new Error(`R2 put: stream delivered ${bytes.length} of ${value.expectedLength} bytes`)
    }
    return bytes
  }
  throw new Error(`R2 put: unsupported body ${Object.prototype.toString.call(value)}`)
}

// --------------------------------------------------------- in-memory R2
// Keys are literal. Bodies are streams of 16 KB chunks that are produced only
// when read, so a request records how many bytes were actually taken.
const CHUNK = 16 * 1024
function makeWorld() {
  const objects = new Map()
  const requests = []
  const hooks = { beforeGet: null, failPut: null, cutAt: null }
  let versions = 0
  const store = (key, bytes, { httpMetadata, customMetadata } = {}) => {
    objects.set(key, {
      bytes, etag: md5(bytes), version: `v${++versions}`, uploaded: new Date(),
      httpMetadata: { ...(httpMetadata || {}) }, customMetadata: { ...(customMetadata || {}) },
    })
  }
  const describe = (key, object) => ({
    key, etag: object.etag, httpEtag: `"${object.etag}"`, version: object.version, size: object.bytes.length, uploaded: object.uploaded,
    httpMetadata: { ...object.httpMetadata }, customMetadata: { ...object.customMetadata },
  })
  // hooks.cutAt(request): a byte count after which the body ends early
  // (`close`) or fails (`error`), as a dropped connection would.
  const streamOf = (bytes, request) => {
    let offset = 0
    const cut = hooks.cutAt ? hooks.cutAt(request) : null
    const stream = new ReadableStream({
      pull(controller) {
        if (cut && offset >= cut.at) {
          if (cut.mode === 'error') controller.error(new Error('connection reset (test fault)'))
          else controller.close()
          return
        }
        if (offset >= bytes.length) { controller.close(); return }
        const chunk = bytes.slice(offset, offset + CHUNK)
        offset += chunk.length
        request.bytesRead += chunk.length
        controller.enqueue(chunk)
      },
      cancel() { request.cancelled = true },
    }, { highWaterMark: 0 })
    stream.expectedLength = bytes.length
    return stream
  }
  const bucket = {
    async get(key, options) {
      const request = { op: 'get', key, onlyIf: options && options.onlyIf ? { ...options.onlyIf } : null, range: options && options.range ? { ...options.range } : null, bytesRead: 0, cancelled: false }
      requests.push(request)
      if (hooks.beforeGet) await hooks.beforeGet(request)
      const object = objects.get(key)
      if (!object) return null
      const metadata = describe(key, object)
      if (request.onlyIf && request.onlyIf.etagMatches !== undefined && request.onlyIf.etagMatches !== object.etag) {
        request.preconditionFailed = true
        return metadata
      }
      let bytes = object.bytes
      if (request.range) {
        const offset = Number(request.range.offset || 0)
        const length = request.range.length === undefined ? bytes.length - offset : Number(request.range.length)
        bytes = bytes.subarray(offset, offset + length)
      }
      const body = streamOf(bytes, request)
      return {
        ...metadata,
        body,
        text: async () => Buffer.from(await readAll(body)).toString('utf8'),
        json: async () => JSON.parse(Buffer.from(await readAll(body)).toString('utf8')),
        arrayBuffer: async () => { const all = await readAll(body); return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) },
      }
    },
    async head(key) {
      requests.push({ op: 'head', key })
      const object = objects.get(key)
      return object ? describe(key, object) : null
    },
    async put(key, value, options = {}) {
      const bytes = await toBytes(value)
      requests.push({ op: 'put', key, size: bytes.length, sha: sha(bytes), httpMetadata: { ...((options && options.httpMetadata) || {}) }, customMetadata: { ...((options && options.customMetadata) || {}) } })
      if (hooks.failPut && hooks.failPut(key)) throw new Error(`R2 put failed (test fault): ${key}`)
      store(key, bytes, options || {})
      return describe(key, objects.get(key))
    },
    async delete(keys) {
      for (const key of [].concat(keys)) { requests.push({ op: 'delete', key }); objects.delete(key) }
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      requests.push({ op: 'list', prefix })
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = cursor ? keys.indexOf(cursor) + 1 : 0
      const page = keys.slice(start, start + limit)
      const truncated = start + limit < keys.length
      return { objects: page.map((key) => describe(key, objects.get(key))), truncated, cursor: truncated ? page[page.length - 1] : undefined, delimitedPrefixes: [] }
    },
    async createMultipartUpload(key, options = {}) {
      const parts = new Map()
      return {
        key,
        uploadId: `upload-${key}`,
        async uploadPart(partNumber, value) { parts.set(partNumber, await toBytes(value)); return { partNumber, etag: `part-${partNumber}` } },
        async complete(uploaded) {
          const bytes = F.bytes(...uploaded.map((part) => part.partNumber).sort((a, b) => a - b).map((number) => parts.get(number)))
          requests.push({ op: 'put', key, size: bytes.length, sha: sha(bytes), httpMetadata: { ...(options.httpMetadata || {}) }, customMetadata: { ...(options.customMetadata || {}) }, multipart: true })
          store(key, bytes, options)
          return describe(key, objects.get(key))
        },
        async abort() { parts.clear() },
      }
    },
  }
  const kv = new Map()
  const CACHE = {
    async get(key) { return kv.has(key) ? kv.get(key) : null },
    async put(key, value) { kv.set(key, value) },
    async delete(key) { kv.delete(key) },
  }
  const db = makeDb()
  return { objects, requests, hooks, store, db, kv, env: { DB: db.DB, ASSETS: bucket, CACHE } }
}

// ------------------------------------------------------ D1 on node:sqlite
function makeDb() {
  const sql = new DatabaseSync(':memory:')
  const writes = { run: 0, batch: 0 }
  sql.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
  sql.exec("INSERT INTO settings (key, value) VALUES ('business_name', 'Live name')")
  const statement = (text, params = []) => ({
    text,
    params,
    bind: (...values) => statement(text, values),
    async first() { return sql.prepare(text).get(...params) ?? null },
    async all() { return { results: sql.prepare(text).all(...params) } },
    async run() { writes.run += 1; const result = sql.prepare(text).run(...params); return { success: true, meta: { changes: result.changes } } },
  })
  return {
    sql,
    writes,
    DB: {
      prepare: (text) => statement(text),
      async batch(items) {
        writes.batch += 1
        sql.exec('BEGIN')
        try {
          const out = items.map((item) => {
            if (/^SELECT\b/i.test(item.text.trim())) return { success: true, results: sql.prepare(item.text).all(...item.params) }
            const result = sql.prepare(item.text).run(...item.params)
            return { success: true, meta: { changes: result.changes } }
          })
          sql.exec('COMMIT')
          return out
        } catch (error) {
          sql.exec('ROLLBACK')
          throw error
        }
      },
    },
  }
}

// ------------------------------------------------------------ backups
const STORED_TYPE = 'text/html; charset=utf-8'
const storedMetadataOf = (key) => ({ httpMetadata: { contentType: STORED_TYPE, cacheControl: 'no-store' }, customMetadata: { original: key } })
const assetsFolderOf = (name) => `backups/cloudflare/${name}/assets/`

// A backup as createCloudflareBackup writes it: the document, and a copy of
// each file in the backup's assets/ folder -- here stored as text/html, the
// type an old upload could carry. `lifecycle` adds the state.json sidecar.
function seedBackup(world, { name, entries, copied, assetsPrefix, lifecycle }) {
  const prefix = assetsPrefix === undefined ? assetsFolderOf(name) : assetsPrefix
  for (const entry of entries) {
    if (entry.noCopy) continue
    world.store(`${prefix}${entry.key.replace(/^uploads\//, '')}`, entry.bytes, storedMetadataOf(entry.key))
  }
  const copiedKeys = copied || entries.map((entry) => entry.key)
  const assets = entries.map((entry) => ({ key: entry.key, size: entry.bytes.length, uploaded: null }))
  const key = `backups/cloudflare/${name}.json`
  const document = {
    format: 'business-os-cloudflare-backup', formatVersion: 1, createdAt: '2026-09-20T00:00:00.000Z', source: 'manual', runtime: 'cloudflare-workers',
    tables: { settings: { columns: ['key', 'value'], rows: [{ key: 'business_name', value: 'Backed-up name' }] } },
    r2: { bucket: 'business-os-assets', assets, assetsPrefix: prefix, copiedKeys, assetCopyProgress: { nextIndex: assets.length, complete: true } },
    summary: { tableCount: 1, rowCount: 1, assetCount: assets.length, assetsBackedUp: copiedKeys.length, assetsSkipped: 0 },
  }
  world.store(key, F.enc(JSON.stringify(document)), { httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { format: 'business-os-cloudflare-backup' } })
  if (lifecycle) {
    world.store(`backups/cloudflare/${name}/state.json`, F.enc(JSON.stringify({
      format: 'business-os-cloudflare-backup-state', version: 1, backupName: name, manifestKey: key,
      createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', source: 'manual', status: 'finalized',
      assetsPrefix: prefix, assets, copiedKeys: lifecycle.copiedKeys, pendingKeys: [], failedKeys: [], attempts: {},
    })))
  }
  return key
}

// What the purge keeps comes back; everything else is withheld. `mime`: the
// exact stored type; `other`: another media format, stored with one of
// OTHER_MEDIA_STORED_TYPES (or its PINNED_OTHER_TYPES entry).
let purge = null
function verdictOf(key, bytes) {
  const verdict = purge.classifyObject({ key, size: bytes.length, bytes, complete: true })
  if (verdict.action === 'keep') {
    const allowed = purge.detectUploadFormat(bytes)
    return allowed ? { mime: allowed.mime } : { other: verdict.format }
  }
  if (verdict.group === 'image-with-code') return { reason: 'image-with-code' }
  return bytes.length === 0 ? { reason: 'empty' } : { reason: 'not-media' }
}
const OTHER_MEDIA_STORED_TYPES = ['image/heic', 'image/bmp', 'image/tiff', 'video/mp4', 'video/quicktime', 'video/x-msvideo', 'audio/mp4', 'audio/mpeg', 'application/octet-stream']
// The owner's cases, pinned to their exact stored type.
const PINNED_OTHER_TYPES = { 'HEIC/HEIF': 'image/heic', BMP: 'image/bmp', 'MP4 family (brand caep)': 'video/mp4', 'MP4 family (brand mp21)': 'video/mp4' }

function fixtureSet() {
  const out = []
  const keys = new Set()
  const add = (name, key, bytes, expected) => {
    assert.ok(!keys.has(key), `duplicate fixture key ${key}`)
    keys.add(key)
    out.push({ name, key, bytes, expected })
  }
  for (const entry of F.catalogue()) {
    const key = entry.key.startsWith('uploads/') ? entry.key : `uploads/${entry.key.replace(/\//g, '-')}`
    add(entry.name, key, entry.bytes, verdictOf(key, entry.bytes))
  }
  F.BYPASSES.forEach(([payload, bytes], p) => F.bypassCarriers(bytes).forEach(([carrier, carried], c) => {
    add(`bypass ${payload} in ${carrier}`, `uploads/bypass-${p}-${c}`, carried, verdictOf(`uploads/bypass-${p}-${c}`, carried))
  }))
  F.c2paCarriers().forEach(([carrier, make], c) => F.C2PA_ICONS.forEach(([icon, svg, refused], i) => {
    const carried = make(svg)
    add(`C2PA ${icon} in ${carrier}`, `uploads/c2pa-${c}-${i}`, carried, verdictOf(`uploads/c2pa-${c}-${i}`, carried))
  }))
  F.brandCases().forEach(([name, bytes], b) => add(`ISO/QuickTime ${name}`, `uploads/brand-${b}.bin`, bytes, verdictOf(`uploads/brand-${b}.bin`, bytes)))
  // MP4 brands off the upload allowlist: Canon cameras, MPEG-21.
  const caep = F.bytes(F.ftyp('CAEP', 'CAEP', 'mp42'), F.MOOV, F.MDAT)
  const mp21 = F.bytes(F.ftyp('mp21', 'mp21'), F.MOOV, F.MDAT)
  add('Canon MP4 (brand CAEP)', 'uploads/MVI_0001.MP4', caep, verdictOf('uploads/MVI_0001.MP4', caep))
  add('MPEG-21 MP4 (brand mp21)', 'uploads/clip21.mp4', mp21, verdictOf('uploads/clip21.mp4', mp21))
  add('HEIC with no extension', 'uploads/IMG_0004', F.heic(), verdictOf('uploads/IMG_0004', F.heic()))
  // Literal keys with spaces, '#', '%', '+', '?' and Khmer.
  add('JPEG under a Khmer name', 'uploads/រូបថត #1 100%+?.jpg', F.jpeg(), { mime: 'image/jpeg' })
  add('PDF under a Khmer name', 'uploads/ឯកសារ #2 100%+?.pdf', F.pdf(), { reason: 'not-media' })
  return out
}

const QUARANTINE_FOLDER = /^quarantine\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\/$/
// The quarantine folder of one restore, from what it wrote.
function quarantineFolderOf(puts) {
  const put = puts.find((request) => request.key.startsWith('quarantine/'))
  const match = put && /^quarantine\/[^/]+\//.exec(put.key)
  return match ? match[0] : 'quarantine/(none written)/'
}
const snapshot = (world, prefix) => [...world.objects.entries()].filter(([key]) => key.startsWith(prefix))
  .map(([key, object]) => [key, sha(object.bytes), JSON.stringify(object.httpMetadata), JSON.stringify(object.customMetadata)]).sort()
const withheldOf = (result) => new Map(((result && result.withheldAssets) || []).map((entry) => [entry.key, entry]))

async function main() {
  purge = await import(pathToFileURL(PURGE_SOURCE).href)
  await lifecycleRestoreContract()
  // --------------------------------------------------- 1. every fixture
  await scenario('every fixture', async (expect) => {
    const world = makeWorld()
    const entries = fixtureSet()
    const key = seedBackup(world, { name: 'business-os-cloudflare-fixtures', entries })
    const backupBefore = snapshot(world, 'backups/')
    const started = world.requests.length
    const result = await backup.restoreCloudflareBackup(world.env, key)
    const requests = world.requests.slice(started)
    const puts = requests.filter((request) => request.op === 'put')
    const folder = quarantineFolderOf(puts)
    const withheld = withheldOf(result)
    const media = entries.filter((entry) => entry.expected.mime || entry.expected.other)
    const refused = entries.filter((entry) => !(entry.expected.mime || entry.expected.other))
    const others = media.filter((entry) => entry.expected.other)
    expect(`the fixtures cover both outcomes (${media.length} media, ${others.length} of them other formats, ${refused.length} not)`, () => assert.ok(media.length >= 40 && others.length >= 20 && refused.length >= 150))
    for (const format of Object.keys(PINNED_OTHER_TYPES)) {
      expect(`the owner's case ${format} is among the fixtures`, () => assert.ok(others.some((entry) => entry.expected.other === format)))
    }
    const expectedType = (entry) => entry.expected.mime || PINNED_OTHER_TYPES[entry.expected.other] || null

    for (const entry of media) {
      const live = world.objects.get(entry.key)
      expect(`${entry.name}: written back byte for byte`, () => { assert.ok(live, 'not written'); assert.equal(sha(live.bytes), sha(entry.bytes)) })
      if (expectedType(entry)) {
        expect(`${entry.name}: stored as ${expectedType(entry)}, not the backed-up ${STORED_TYPE}`, () => assert.deepEqual(live && live.httpMetadata, { contentType: expectedType(entry) }))
      } else {
        expect(`${entry.name} (${entry.expected.other}): stored with a plain media type, not the backed-up ${STORED_TYPE}`, () => {
          assert.ok(live && OTHER_MEDIA_STORED_TYPES.includes(live.httpMetadata.contentType), JSON.stringify(live && live.httpMetadata))
          assert.deepEqual(Object.keys(live.httpMetadata), ['contentType'])
        })
      }
      expect(`${entry.name}: not quarantined or listed`, () => {
        assert.ok(!puts.some((request) => request.key.startsWith('quarantine/') && request.key.endsWith(entry.key)))
        assert.ok(!withheld.has(entry.key))
      })
    }
    for (const entry of refused) {
      expect(`${entry.name}: never written under uploads/`, () => {
        assert.equal(puts.filter((request) => request.key === entry.key).length, 0)
        assert.equal(world.objects.has(entry.key), false)
      })
      const quarantined = world.objects.get(`${folder}${entry.key}`)
      expect(`${entry.name}: in quarantine byte for byte, stored metadata kept`, () => {
        assert.ok(quarantined, 'no quarantine copy')
        assert.equal(sha(quarantined.bytes), sha(entry.bytes))
        assert.deepEqual({ httpMetadata: quarantined.httpMetadata, customMetadata: quarantined.customMetadata }, storedMetadataOf(entry.key))
      })
      expect(`${entry.name}: listed as ${entry.expected.reason}`, () => assert.deepEqual(withheld.get(entry.key), { key: entry.key, reason: entry.expected.reason, keptAt: `${folder}${entry.key}` }))
    }

    expect('one quarantine folder, named quarantine/<time>/ like the purge\'s', () => {
      assert.match(folder, QUARANTINE_FOLDER)
      for (const request of puts) if (request.key.startsWith('quarantine/')) assert.ok(request.key.startsWith(folder), request.key)
    })
    expect('nothing written outside uploads/ and that folder', () => {
      for (const request of puts) assert.ok(request.key.startsWith('uploads/') || request.key.startsWith(folder), request.key)
    })
    expect('every uploads/ write is a fixture that passes the upload gate', () => {
      const allowed = new Map(media.map((entry) => [entry.key, expectedType(entry)]))
      for (const request of puts.filter((put) => put.key.startsWith('uploads/'))) {
        assert.ok(allowed.has(request.key), `${request.key} written`)
        if (allowed.get(request.key)) assert.equal(request.httpMetadata.contentType, allowed.get(request.key), request.key)
        else assert.ok(OTHER_MEDIA_STORED_TYPES.includes(request.httpMetadata.contentType), request.key)
      }
    })
    expect('nothing is deleted and the backup\'s copies are unchanged', () => {
      assert.equal(requests.filter((request) => request.op === 'delete').length, 0)
      assert.deepEqual(snapshot(world, 'backups/'), backupBefore)
    })
    expect('restoredAssets counts what was written back', () => assert.equal(result.restoredAssets, media.length))
    expect('withheldAssets lists exactly the files not written back', () => assert.deepEqual([...withheld.keys()].sort(), refused.map((entry) => entry.key).sort()))
    expect('assetsNotRestored is still listed minus restored', () => assert.equal(result.assetsNotRestored, entries.length - media.length))
    expect('missingAssets stays empty (undefined)', () => assert.equal(result.missingAssets, undefined))
    expect('the report keeps every field it had', () => {
      for (const field of ['key', 'restoredAt', 'summary', 'tables', 'statements', 'restoredAssets', 'assetsNotRestored', 'missingAssets', 'schemaMigration', 'schemaMismatch', 'tablesNotInBackup']) assert.ok(field in result, field)
      assert.equal(result.key, key)
      assert.equal(result.tables, 1)
      assert.equal(result.summary.assetCount, entries.length)
    })
    expect('the rows were restored', () => assert.equal(world.db.sql.prepare("SELECT value FROM settings WHERE key = 'business_name'").get().value, 'Backed-up name'))
    expect('the report survives JSON (it is stored as the job result)', () => {
      const again = JSON.parse(JSON.stringify(result))
      assert.deepEqual(again.withheldAssets, result.withheldAssets)
      assert.equal(again.restoredAssets, result.restoredAssets)
    })
  })

  // ------------------------------------------ 2. the lifecycle sidecar
  await scenario('state.json lists the copies', async (expect) => {
    const world = makeWorld()
    const entries = [
      { key: 'uploads/a.jpg', bytes: F.jpeg() },
      { key: 'uploads/b.pdf', bytes: F.pdf() },
      { key: 'uploads/c.png', bytes: F.png() },
      { key: 'uploads/d.html', bytes: F.html() },
    ]
    const key = seedBackup(world, { name: 'business-os-cloudflare-sidecar', entries, lifecycle: { copiedKeys: ['uploads/a.jpg', 'uploads/b.pdf'] } })
    const result = await backup.restoreCloudflareBackup(world.env, key)
    const folder = quarantineFolderOf(world.requests.filter((request) => request.op === 'put'))
    expect('the sidecar\'s copies are handled: the photo back, the PDF quarantined', () => {
      assert.equal(sha(world.objects.get('uploads/a.jpg').bytes), sha(entries[0].bytes))
      assert.equal(world.objects.get('uploads/a.jpg').httpMetadata.contentType, 'image/jpeg')
      assert.equal(world.objects.has('uploads/b.pdf'), false)
      assert.ok(world.objects.has(`${folder}uploads/b.pdf`))
    })
    expect('keys the sidecar does not list are not touched', () => {
      assert.equal(world.objects.has('uploads/c.png'), false)
      assert.equal(world.objects.has('uploads/d.html'), false)
      assert.ok(!world.requests.some((request) => request.key && /\/(c\.png|d\.html)$/.test(request.key) && request.op !== 'put' && request.key.includes('/assets/')))
    })
    expect('the report', () => {
      assert.equal(result.restoredAssets, 1)
      assert.equal(result.assetsNotRestored, 3)
      assert.deepEqual(result.withheldAssets, [{ key: 'uploads/b.pdf', reason: 'not-media', keptAt: `${folder}uploads/b.pdf` }])
    })
  })

  // -------------------------------- 5. missing copies and failed writes
  await scenario('missing copies and failed writes', async (expect) => {
    const world = makeWorld()
    const entries = [
      { key: 'uploads/gone.jpg', bytes: F.jpeg(), noCopy: true },
      { key: 'uploads/ok.png', bytes: F.png() },
      { key: 'uploads/write-fails.jpg', bytes: F.jpeg() },
      { key: 'uploads/quarantine-fails.pdf', bytes: F.pdf() },
      { key: 'uploads/doc.pdf', bytes: F.pdf() },
    ]
    const key = seedBackup(world, { name: 'business-os-cloudflare-faults', entries })
    world.hooks.failPut = (target) => target === 'uploads/write-fails.jpg' || (target.startsWith('quarantine/') && target.endsWith('uploads/quarantine-fails.pdf'))
    const result = await backup.restoreCloudflareBackup(world.env, key)
    const folder = quarantineFolderOf(world.requests.filter((request) => request.op === 'put' && request.key.endsWith('uploads/doc.pdf')))
    expect('a copy that is gone, and a photo whose write failed, are missingAssets', () => assert.deepEqual([...(result.missingAssets || [])].sort(), ['uploads/gone.jpg', 'uploads/write-fails.jpg']))
    expect('the others are unaffected', () => {
      assert.equal(result.restoredAssets, 1)
      assert.equal(world.objects.get('uploads/ok.png').httpMetadata.contentType, 'image/png')
    })
    expect('a document whose quarantine copy failed is listed as kept in the backup', () => {
      const withheld = withheldOf(result)
      assert.deepEqual(withheld.get('uploads/quarantine-fails.pdf'), { key: 'uploads/quarantine-fails.pdf', reason: 'not-media', keptAt: `${assetsFolderOf('business-os-cloudflare-faults')}quarantine-fails.pdf` })
      assert.deepEqual(withheld.get('uploads/doc.pdf'), { key: 'uploads/doc.pdf', reason: 'not-media', keptAt: `${folder}uploads/doc.pdf` })
      assert.equal(sha(world.objects.get(`${assetsFolderOf('business-os-cloudflare-faults')}quarantine-fails.pdf`).bytes), sha(entries[3].bytes))
    })
    expect('no document reaches uploads/', () => {
      assert.equal(world.objects.has('uploads/quarantine-fails.pdf'), false)
      assert.equal(world.objects.has('uploads/doc.pdf'), false)
    })
  })

  await scenario('live files under the backed-up keys', async (expect) => {
    const world = makeWorld()
    const oldPhoto = F.jpeg()
    const editedPhoto = F.jpeg({ rng: F.mulberry32(77) })
    const oldPdf = F.pdf()
    const livePdf = F.bytes(F.pdf(), '% edited\n')
    const polyglot = F.catalogue().find((entry) => entry.key === 'uploads/poly.jpg').bytes
    const entries = [
      { key: 'uploads/photo.jpg', bytes: oldPhoto },
      { key: 'uploads/price-list.pdf', bytes: oldPdf },
      { key: 'uploads/poly.jpg', bytes: polyglot },
    ]
    world.store('uploads/photo.jpg', editedPhoto, { httpMetadata: { contentType: 'image/jpeg' } })
    world.store('uploads/price-list.pdf', livePdf, { httpMetadata: { contentType: 'application/pdf' } })
    world.store('uploads/poly.jpg', polyglot, { httpMetadata: { contentType: 'image/jpeg' } })
    const liveBefore = snapshot(world, 'uploads/')
    const key = seedBackup(world, { name: 'business-os-cloudflare-live', entries })
    const started = world.requests.length
    await backup.restoreCloudflareBackup(world.env, key)
    const touched = world.requests.slice(started).filter((request) => request.op === 'put' || request.op === 'delete').map((request) => request.key)
    expect('a photo is put back as it was in the backup (the restore rolls back)', () => {
      assert.equal(sha(world.objects.get('uploads/photo.jpg').bytes), sha(oldPhoto))
      assert.equal(world.objects.get('uploads/photo.jpg').httpMetadata.contentType, 'image/jpeg')
    })
    expect('the live files under withheld keys are left exactly as they were', () => {
      assert.ok(!touched.includes('uploads/price-list.pdf'))
      assert.ok(!touched.includes('uploads/poly.jpg'))
      const now = snapshot(world, 'uploads/')
      for (const liveKey of ['uploads/price-list.pdf', 'uploads/poly.jpg']) {
        assert.deepEqual(now.find(([k]) => k === liveKey), liveBefore.find(([k]) => k === liveKey), liveKey)
      }
    })
  })

  // ------------------------------------------------- 3. large copies
  const large = (head, fill = 0) => {
    const out = new Uint8Array(SCAN_MAX + 3 * CHUNK + 5)
    if (fill) out.fill(fill)
    out.set(head, 0)
    return out
  }
  const largeVideo = () => {
    const head = F.bytes(F.ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), F.MOOV)
    const out = large(head)
    out.set(F.bytes(F.u32be(out.length - head.length), 'mdat'), head.length)
    return out
  }
  await scenario(`copies over ${SCAN_MAX} bytes`, async (expect) => {
    const world = makeWorld()
    const entries = [
      { key: 'uploads/long.mp4', bytes: largeVideo() },
      { key: 'uploads/huge.pdf', bytes: large(F.enc('%PDF-1.7\n'), 0x20) },
      { key: 'uploads/huge.jpg', bytes: large(F.jpeg().subarray(0, 600)) },
    ]
    const key = seedBackup(world, { name: 'business-os-cloudflare-large', entries })
    const started = world.requests.length
    const result = await backup.restoreCloudflareBackup(world.env, key)
    const requests = world.requests.slice(started)
    const folder = quarantineFolderOf(requests.filter((request) => request.op === 'put'))
    const copyOf = (entry) => `${assetsFolderOf('business-os-cloudflare-large')}${entry.key.replace(/^uploads\//, '')}`
    for (const entry of entries) {
      const gets = requests.filter((request) => request.op === 'get' && request.key === copyOf(entry))
      expect(`${entry.key}: judged by its first bytes, not read whole`, () => {
        assert.ok(gets.length >= 1)
        assert.equal(gets[0].onlyIf, null)
        assert.ok(gets[0].bytesRead <= 256 * 1024, `read ${gets[0].bytesRead} bytes`)
        assert.equal(gets[0].cancelled, true)
      })
      expect(`${entry.key}: copied from a read pinned to the etag it was judged by`, () => {
        const copy = world.objects.get(copyOf(entry))
        assert.equal(gets.length, 2)
        assert.deepEqual(gets[1].onlyIf, { etagMatches: copy.etag })
      })
    }
    expect('the video comes back byte for byte as video/mp4', () => {
      const live = world.objects.get('uploads/long.mp4')
      assert.ok(live)
      assert.equal(sha(live.bytes), sha(entries[0].bytes))
      assert.deepEqual(live.httpMetadata, { contentType: 'video/mp4' })
    })
    expect('the document and the image too large to check are quarantined, never under uploads/', () => {
      for (const [entry, reason] of [[entries[1], 'not-media'], [entries[2], 'too-large-to-check']]) {
        assert.equal(world.objects.has(entry.key), false, entry.key)
        assert.ok(!requests.some((request) => request.op === 'put' && request.key === entry.key), entry.key)
        const quarantined = world.objects.get(`${folder}${entry.key}`)
        assert.ok(quarantined, entry.key)
        assert.equal(sha(quarantined.bytes), sha(entry.bytes))
        assert.deepEqual(withheldOf(result).get(entry.key), { key: entry.key, reason, keptAt: `${folder}${entry.key}` })
      }
    })
    expect('the report', () => {
      assert.equal(result.restoredAssets, 1)
      assert.equal(result.missingAssets, undefined)
    })
  })

  await scenario('a large copy replaced between the check and the copy', async (expect) => {
    const world = makeWorld()
    const video = largeVideo()
    const entries = [{ key: 'uploads/long.mp4', bytes: video }]
    const key = seedBackup(world, { name: 'business-os-cloudflare-swap', entries })
    const copyKey = `${assetsFolderOf('business-os-cloudflare-swap')}long.mp4`
    const page = large(F.html(), 0x20)
    let swapped = false
    world.hooks.beforeGet = (request) => {
      // Once the copy has been judged (its first read cancelled), it is
      // replaced by a web page before the next read.
      const first = world.requests.find((earlier) => earlier.op === 'get' && earlier.key === copyKey)
      if (!swapped && request.key === copyKey && first && first !== request && first.cancelled) {
        swapped = true
        world.store(copyKey, page, storedMetadataOf('uploads/long.mp4'))
      }
    }
    const result = await backup.restoreCloudflareBackup(world.env, key)
    expect('the copy was replaced during the restore', () => assert.equal(swapped, true))
    expect('the web page is never written under uploads/', () => {
      assert.ok(!world.requests.some((request) => request.op === 'put' && request.key === 'uploads/long.mp4'))
      assert.equal(world.objects.has('uploads/long.mp4'), false)
    })
    expect('the file is reported missing, not restored', () => {
      assert.deepEqual(result.missingAssets, ['uploads/long.mp4'])
      assert.equal(result.restoredAssets, 0)
    })
  })

  await scenario('a read that ends early or fails part way', async (expect) => {
    const world = makeWorld()
    const livePhoto = F.jpeg({ rng: F.mulberry32(5) })
    const entries = [
      { key: 'uploads/cut.jpg', bytes: F.bytes(F.jpeg(), new Uint8Array(3 * CHUNK)) },
      { key: 'uploads/reset.png', bytes: F.bytes(F.png(), new Uint8Array(3 * CHUNK)) },
      { key: 'uploads/live.jpg', bytes: F.bytes(F.jpeg({ rng: F.mulberry32(6) }), new Uint8Array(3 * CHUNK)) },
      { key: 'uploads/long.mp4', bytes: largeVideo() },
      { key: 'uploads/huge.pdf', bytes: large(F.enc('%PDF-1.7\n'), 0x20) },
      { key: 'uploads/fine.png', bytes: F.png() },
    ]
    world.store('uploads/live.jpg', livePhoto, { httpMetadata: { contentType: 'image/jpeg' } })
    const key = seedBackup(world, { name: 'business-os-cloudflare-cut', entries })
    const copyOf = (name) => `${assetsFolderOf('business-os-cloudflare-cut')}${name}`
    const seen = new Map()
    world.hooks.cutAt = (request) => {
      if (request.op !== 'get') return null
      const n = (seen.get(request.key) || 0) + 1
      seen.set(request.key, n)
      if (request.key === copyOf('cut.jpg')) return { at: CHUNK, mode: 'close' }
      if (request.key === copyOf('reset.png')) return { at: 2 * CHUNK, mode: 'error' }
      if (request.key === copyOf('live.jpg')) return { at: CHUNK, mode: 'error' }
      // The large ones are judged intact; the streamed copy then breaks.
      if (request.key === copyOf('long.mp4') && n === 2) return { at: 5 * CHUNK, mode: 'close' }
      if (request.key === copyOf('huge.pdf') && n === 2) return { at: 5 * CHUNK, mode: 'error' }
      return null
    }
    const result = await backup.restoreCloudflareBackup(world.env, key)
    expect('no partial file is written anywhere', () => {
      for (const entry of entries.slice(0, 5)) {
        if (entry.key === 'uploads/live.jpg') continue
        assert.equal(world.objects.has(entry.key), false, entry.key)
      }
      const quarantined = [...world.objects.keys()].filter((k) => k.startsWith('quarantine/'))
      assert.deepEqual(quarantined, [])
    })
    expect('a live file is left as it was when its copy cannot be read', () => {
      assert.equal(sha(world.objects.get('uploads/live.jpg').bytes), sha(livePhoto))
    })
    expect('media that could not be read or written is missingAssets', () => {
      assert.deepEqual([...(result.missingAssets || [])].sort(), ['uploads/cut.jpg', 'uploads/live.jpg', 'uploads/long.mp4', 'uploads/reset.png'])
    })
    expect('a document whose quarantine copy broke is listed as still in the backup, intact', () => {
      assert.deepEqual(withheldOf(result).get('uploads/huge.pdf'), { key: 'uploads/huge.pdf', reason: 'not-media', keptAt: copyOf('huge.pdf') })
      assert.equal(sha(world.objects.get(copyOf('huge.pdf')).bytes), sha(entries[4].bytes))
    })
    expect('the rest is restored', () => {
      assert.equal(result.restoredAssets, 1)
      assert.equal(world.objects.get('uploads/fine.png').httpMetadata.contentType, 'image/png')
    })
  })

  // ----------------------------------- 4. folder and keys from the document
  await scenario('a document naming a folder outside the backups', async (expect) => {
    const world = makeWorld()
    const screenshot = F.png()
    world.store('private/portal-submissions/shot.png', screenshot, { httpMetadata: { contentType: 'image/png' } })
    world.store('backups/cloudflare/business-os-cloudflare-other.json', F.enc('{"format":"business-os-cloudflare-backup","tables":{"users":{"rows":[{"password_hash":"x"}]}}}'))
    world.store('quarantine/2026-01-01T00-00-00-000Z/old.pdf', F.pdf())
    // A private screenshot into public uploads/, another backup's whole
    // database, and a quarantined file back out of quarantine.
    const cases = [
      ['private/portal-submissions/', 'uploads/shot.png'],
      ['backups/cloudflare/', 'uploads/business-os-cloudflare-other.json'],
      ['quarantine/2026-01-01T00-00-00-000Z/', 'uploads/old.pdf'],
    ]
    for (const [index, [assetsPrefix, copiedKey]] of cases.entries()) {
      const name = `business-os-cloudflare-crafted-${index}`
      const key = seedBackup(world, { name, entries: [], copied: [copiedKey], assetsPrefix })
      const started = world.requests.length
      const result = await backup.restoreCloudflareBackup(world.env, key)
      const requests = world.requests.slice(started)
      const label = `folder ${assetsPrefix}`
      expect(`${label}: nothing read outside the backup documents`, () => {
        for (const request of requests.filter((r) => r.op === 'get')) assert.ok(request.key === key || request.key === `backups/cloudflare/${name}/state.json`, request.key)
      })
      expect(`${label}: nothing written`, () => assert.deepEqual(requests.filter((r) => r.op === 'put' || r.op === 'delete').map((r) => r.key), []))
      expect(`${label}: reported`, () => {
        assert.deepEqual(result.withheldAssets, [{ key: copiedKey, reason: 'outside-backup-folder', keptAt: null }])
        assert.equal(result.restoredAssets, 0)
      })
    }
    expect('the private screenshot is still private; no database or quarantined file under uploads/', () => {
      assert.equal(world.objects.has('uploads/shot.png'), false)
      assert.equal(world.objects.has('uploads/business-os-cloudflare-other.json'), false)
      assert.equal(world.objects.has('uploads/old.pdf'), false)
      assert.equal(sha(world.objects.get('private/portal-submissions/shot.png').bytes), sha(screenshot))
    })
  })

  await scenario('a document listing keys outside uploads/', async (expect) => {
    const world = makeWorld()
    const name = 'business-os-cloudflare-keys'
    const folder = assetsFolderOf(name)
    const privateShot = F.png()
    world.store('private/portal-submissions/shot.png', privateShot, { httpMetadata: { contentType: 'image/png' } })
    const crafted = ['private/portal-submissions/shot.png', 'backups/cloudflare/business-os-cloudflare-keys.json', 'quarantine/2026-01-01T00-00-00-000Z/uploads/x.pdf', 'uploads/', 'imports/job/incoming/a.csv']
    for (const target of crafted) world.store(`${folder}${target}`, F.png(), storedMetadataOf(target))
    const photo = F.jpeg()
    const key = seedBackup(world, { name, entries: [{ key: 'uploads/real.jpg', bytes: photo }], copied: [...crafted, 42, null, 'uploads/real.jpg'] })
    const documentBefore = sha(world.objects.get(key).bytes)
    const started = world.requests.length
    const result = await backup.restoreCloudflareBackup(world.env, key)
    const requests = world.requests.slice(started)
    expect('only the uploads/ key is read and written', () => {
      assert.deepEqual(requests.filter((r) => r.op === 'put' || r.op === 'delete').map((r) => r.key), ['uploads/real.jpg'])
      for (const request of requests.filter((r) => r.op === 'get' && r.key.startsWith(folder))) assert.equal(request.key, `${folder}real.jpg`)
    })
    expect('nothing outside uploads/ was overwritten', () => {
      assert.equal(sha(world.objects.get('private/portal-submissions/shot.png').bytes), sha(privateShot))
      assert.equal(sha(world.objects.get(key).bytes), documentBefore)
      assert.equal(world.objects.has('quarantine/2026-01-01T00-00-00-000Z/uploads/x.pdf'), false)
      assert.equal(world.objects.has('imports/job/incoming/a.csv'), false)
    })
    expect('each is reported, the real photo restored', () => {
      assert.deepEqual(result.withheldAssets, [...crafted, '42', 'null'].map((listed) => ({ key: listed, reason: 'outside-uploads', keptAt: null })))
      assert.equal(result.restoredAssets, 1)
      assert.equal(sha(world.objects.get('uploads/real.jpg').bytes), sha(photo))
    })
  })

  // ---------------------------------------------------- 6. end to end
  await scenario('backup, lose the files, restore', async (expect) => {
    const world = makeWorld()
    const polyglot = F.catalogue().find((entry) => entry.key === 'uploads/poly.png').bytes
    const live = [
      ['uploads/a.jpg', F.jpeg(), 'image/jpeg', 'image/jpeg'],
      ['uploads/b.png', F.png(), 'text/html', 'image/png'],
      ['uploads/c.mp4', F.catalogue().find((entry) => entry.key === 'uploads/clip.mp4').bytes, 'video/mp4', 'video/mp4'],
      ['uploads/d.pdf', F.pdf(), 'application/pdf', null],
      ['uploads/e.html', F.html(), 'text/html', null],
      ['uploads/f.png', polyglot, 'image/png', null],
    ]
    for (const [liveKey, bytes, contentType] of live) world.store(liveKey, bytes, { httpMetadata: { contentType } })
    const created = await backup.createCloudflareBackup(world.env, 'manual')
    expect('the backup copied every file', () => assert.equal(created.summary.assetsBackedUp, live.length))
    for (const [liveKey] of live) world.objects.delete(liveKey)
    const started = world.requests.length
    const result = await backup.restoreCloudflareBackup(world.env, created.key)
    const folder = quarantineFolderOf(world.requests.slice(started).filter((request) => request.op === 'put'))
    for (const [liveKey, bytes, , restoredType] of live) {
      if (restoredType) {
        expect(`${liveKey}: back as ${restoredType}`, () => {
          assert.equal(sha(world.objects.get(liveKey).bytes), sha(bytes))
          assert.deepEqual(world.objects.get(liveKey).httpMetadata, { contentType: restoredType })
        })
      } else {
        expect(`${liveKey}: quarantined, not back under uploads/`, () => {
          assert.equal(world.objects.has(liveKey), false)
          assert.equal(sha(world.objects.get(`${folder}${liveKey}`).bytes), sha(bytes))
        })
      }
    }
    expect('the report', () => {
      assert.equal(result.restoredAssets, 3)
      assert.equal(result.assetsNotRestored, 3)
      assert.deepEqual(result.withheldAssets.map((entry) => [entry.key, entry.reason]), [['uploads/d.pdf', 'not-media'], ['uploads/e.html', 'not-media'], ['uploads/f.png', 'image-with-code']])
    })
  })

  // S-uploads3: a copy too large to read whole is judged by its first bytes,
  // as the purge judges a large file; text that only starts like media is
  // withheld, as the purge lists it for review.
  expect('judgeRestoredAsset: large other media is written back, crafted text is not', () => {
    assert.equal(typeof backup.judgeRestoredAsset, 'function', 'not exported')
    const heicHead = F.heic().subarray(0, 64)
    assert.deepEqual(backup.judgeRestoredAsset(heicHead, false, SCAN_MAX + 1), { contentType: 'image/heic' })
    const caepHead = F.bytes(F.ftyp('CAEP', 'CAEP', 'mp42'), F.MOOV).subarray(0, 64)
    assert.deepEqual(backup.judgeRestoredAsset(caepHead, false, SCAN_MAX + 1), { contentType: 'video/mp4' })
    const bigFree = F.bytes(F.u32be(SCAN_MAX), 'free', new Uint8Array(4000))
    assert.deepEqual(backup.judgeRestoredAsset(bigFree, false, SCAN_MAX + 1), { contentType: 'video/quicktime' })
    const csv = F.enc('G' + 'x'.repeat(187) + 'G' + 'y'.repeat(187) + 'G' + 'z'.repeat(187) + '\n')
    assert.deepEqual(backup.judgeRestoredAsset(csv, true, csv.length), { reason: 'not-media' })
    const notes = F.bytes([0, 0, 0, 8], 'free', 'hello text after a tiny header')
    assert.deepEqual(backup.judgeRestoredAsset(notes, true, notes.length), { reason: 'not-media' })
    assert.deepEqual(backup.judgeRestoredAsset(F.jpeg().subarray(0, 600), false, SCAN_MAX + 1), { reason: 'too-large-to-check' })
  })

  // An older tree has none of this: say so rather than crash.
  expect('backup.ts exports RESTORE_ASSET_SCAN_MAX_BYTES (32 MB)', () => assert.equal(backup.RESTORE_ASSET_SCAN_MAX_BYTES, 32 * 1024 * 1024))

  if (failures.length) {
    console.error(`FAIL ${failures.length} of ${checks} checks (${BACKUP_TS})`)
    const perScenario = new Map()
    for (const failure of failures) {
      const name = failure.split(' -- ')[0].split(': ')[0]
      perScenario.set(name, (perScenario.get(name) || 0) + 1)
    }
    for (const [name, count] of perScenario) console.error(`  ${count} in "${name}"`)
    for (const failure of failures.slice(0, 80)) console.error(`  - ${failure}`)
    if (failures.length > 80) console.error(`  ... ${failures.length - 80} more`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: a restore writes back under uploads/ what the purge keeps -- allowlisted images and videos with their detected type, other media (HEIC, BMP, CAEP/mp21 MP4...) with a plain media type; everything else goes byte for byte to quarantine/<time>/ and is listed in withheldAssets; large copies are streamed and pinned; the document cannot aim it outside backups/ and uploads/`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

async function lifecycleRestoreContract() {
  const { HTTPException } = require('hono/http-exception')
  const lifecycleFile = path.join(SRC, 'stockLifecycle.ts')
  assert.strictEqual(loadModule(lifecycleFile), loadModule(lifecycleFile))
  assert.equal(typeof loadModule(path.join(SRC, 'db.ts')).getDb, 'function')
  const state = world => {
    const sql = world.db.sql
    const typed = value => value === null ? ['null'] : typeof value === 'bigint' ? ['integer', value.toString()] : value instanceof Uint8Array ? ['blob', Buffer.from(value).toString('hex')] : [typeof value, value]
    const tables = sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => {
      const statement = sql.prepare(`SELECT * FROM "${row.name.replaceAll('"', '""')}"`)
      statement.setReadBigInts(true)
      return [row.name, row.sql, statement.all().map(values => JSON.stringify(Object.entries(values).map(([key, value]) => [key, typed(value)]))).sort()]
    })
    return JSON.stringify([tables, snapshot(world, ''), [...world.kv].sort()])
  }
  for (const table of ['stock_disposition_sources', 'stock_funding_dependencies']) {
    const world = makeWorld()
    world.db.sql.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO products VALUES(100,'Live product');
      CREATE TABLE ${table}(movement_id INTEGER,batch_id INTEGER,product_id INTEGER,branch_id INTEGER,supplier_id INTEGER);
      INSERT INTO ${table} VALUES(701,501,100,1,77);
      CREATE TABLE durable_marker(id INTEGER PRIMARY KEY,payload BLOB,amount INTEGER,label TEXT);
      INSERT INTO durable_marker VALUES(1,X'0001ff00',9007199254740993,'ខ្មែរ');`)
    const key = seedBackup(world, { name: `linked-${table}`, entries: [] })
    const document = JSON.parse(Buffer.from(world.objects.get(key).bytes).toString('utf8'))
    document.tables.products = { columns: ['id', 'name'], rows: [{ id: 100, name: 'Backed-up product' }] }
    document.summary.tableCount = 2
    document.summary.rowCount = 2
    world.store(key, F.enc(JSON.stringify(document)), { httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { format: 'business-os-cloudflare-backup' } })
    const before = state(world)
    const progress = []
    await assert.rejects(backup.restoreCloudflareBackup(world.env, key, async value => { progress.push(value) }), error => error instanceof HTTPException && error.status === 409 && error.code === 'stock_lifecycle_dependency')
    assert.equal(state(world), before)
    assert.deepEqual(world.db.writes, { run: 0, batch: 0 })
    assert.deepEqual(progress, [])
    assert.deepEqual(world.requests.filter(request => request.op === 'put' || request.op === 'delete'), [])
    world.db.sql.exec(`DELETE FROM ${table}`)
    const restored = await backup.restoreCloudflareBackup(world.env, key)
    assert.equal(restored.summary.rowCount, 2)
    assert.equal(world.db.sql.prepare('SELECT name FROM products WHERE id=100').get().name, 'Backed-up product')
    assert.equal(world.db.sql.prepare("SELECT value FROM settings WHERE key='business_name'").get().value, 'Backed-up name')
    world.db.sql.close()
  }
  for (let attempt = 0; attempt < 2; attempt += 1) assert.throws(() => loadModule(path.join(SRC, 'absent-asset-fixture.ts')), /ENOENT/)
  console.log('PASS actual restore refuses linked stock before DB/R2/KV/progress effects, then restores an empty-ledger positive')
}
