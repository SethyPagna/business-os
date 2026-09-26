// S-uploads2a fix 2 (2026-09-26): ops/scripts/purge-non-media-uploads.mjs
// no longer deletes. --move copies each PURGE file to quarantine/<time>/,
// checks the copy (SHA-256 and size), records it and every database row it
// will change in manifest.json, changes the rows in guarded batches, and
// only then removes the original; --restore <manifest> puts it all back.
//
// Drives the real script's run() against a mocked Cloudflare API: an
// in-memory R2 bucket (literal keys, like R2) holding the whole fixture
// catalogue (harness/upload_fixtures.cjs) plus a few extras, and D1 as
// node:sqlite with the real schema of the tables involved (from every
// migration, triggers included). "Identical" below means every row of
// file_assets, import_job_files and import_jobs, and every object's key,
// SHA-256, content type and content encoding; stock_session_revisions is
// left out (the Library triggers bump it, and it only ever grows).
// The mock enforces, on every request of every scenario:
//   - an original is deleted only while an identical copy is in quarantine;
//   - a quarantine copy is deleted only while an identical original is in
//     place (so no hard delete, and restore never loses a file);
//   - a file is never written over a different one outside quarantine/;
//   - object keys arrive with literal slashes (per-segment encoding).
// Scenarios: a full move then restore (4 at a time, large files one by
// one), restore run twice, a dry run, an unconfirmed move, a crash at each
// step (emulated: the API stops answering and the local files go back to
// what was on disk at that instant), a refused copy, a copy that reads
// back different, a database guard that refuses (a row linked after the
// snapshot), a non-atomic database failure half way, a database that
// answers success but changes nothing, a failed delete, an import that
// starts running, files that change or vanish after the listing, a size
// cap, restore meeting a different file, a missing copy or a row changed
// since, restore failing or dying part way and run again, tampered
// manifests, the command line, and the token never leaving the
// Authorization header.
//
// Every failure is listed before the exit code is set. To run it against
// another copy of the script: PURGE_SCRIPT=/tmp/purge.mjs node <this file>
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')
const F = require('./harness/upload_fixtures.cjs')

const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')
// A made-up token: it must reach the Authorization header and nothing else.
const TOKEN = ['tok', 'Sentinel', 'x7Qp2Lm9Wv4Rt8Zb3Nc6Hd1Kf5Gs0Yj'].join('_')
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const DATABASE = '01234567-89ab-cdef-0123-456789abcdef'
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, BUSINESS_OS_D1_DATABASE_ID: DATABASE }
const CLOCK = Date.parse('2026-09-26T12:00:00.000Z')

const failures = []
let checks = 0
const firstLine = (error) => String((error && error.message) || error).split('\n')[0]
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${firstLine(error)}`) }
}

// ------------------------------------------------------------- fixtures
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex')
const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html', '.zip': 'application/zip', '.json': 'application/json', '.txt': 'text/plain',
}
const typeOf = (key) => TYPES[(/\.[^./]+$/.exec(key) || [''])[0].toLowerCase()] || 'application/octet-stream'
const PURGE_GROUPS = new Set(['documents', 'web-pages', 'text', 'archives', 'programs'])
const KHMER_PDF = 'uploads/Khmer ឯកសារ #1 100%+?.pdf'
const OBJECTS = [
  ...F.catalogue().map((entry) => ({ key: entry.key, bytes: entry.bytes, purge: PURGE_GROUPS.has(entry.group) })),
  { key: KHMER_PDF, bytes: F.pdf(), purge: true },
  { key: 'imports/retry-job/incoming/data.csv', bytes: F.enc('sku,qty\nA1,3\n'), purge: true },
  { key: 'uploads/page-gz.html', bytes: F.html(), contentEncoding: 'gzip', purge: false },
  { key: 'private/portal-submissions/shot.png', bytes: F.png(), purge: false },
  { key: 'backups/cloudflare/state.json', bytes: F.enc('{"a":1}'), purge: false },
  { key: 'quarantine/2020-01-01T00-00-00-000Z/uploads/old.pdf', bytes: F.pdf(), purge: false },
]
const PURGE_KEYS = OBJECTS.filter((object) => object.purge).map((object) => object.key).sort()

// The real schema, from every migration applied in order: the tables the
// purge touches with their indexes and triggers, and every table those
// triggers use (the Library triggers bump stock_session_revisions unless
// system_flags says a restore is running). Built once, replayed for each
// scenario.
const SCHEMA = (() => {
  const db = new DatabaseSync(':memory:')
  for (const sql of loadAll()) db.exec(sql)
  const entries = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
  db.close()
  const tables = entries.filter((entry) => entry.type === 'table').map((entry) => entry.name)
  const needed = new Set(['file_assets', 'import_job_files', 'import_jobs'])
  for (let grew = true; grew;) {
    grew = false
    for (const entry of entries) {
      if (entry.type !== 'trigger' || !needed.has(entry.tbl_name)) continue
      for (const table of tables) {
        if (!needed.has(table) && new RegExp(`\\b${table}\\b`).test(entry.sql)) { needed.add(table); grew = true }
      }
    }
  }
  return entries.filter((entry) => needed.has(entry.tbl_name)).map((entry) => `${entry.sql};`).join('\n')
})()
const ASSET_COLUMNS = 'id, original_name, stored_name, public_path, mime_type, media_type, byte_size, width, height, source, created_by_id, created_by_name, created_at, updated_at, original_byte_size, optimized_byte_size, optimization_status, optimization_note, duration_seconds'
const asset = (id, name, extra = {}) => ({
  id, original_name: `original ${name}`, stored_name: name, public_path: `/uploads/${encodeURIComponent(name)}`, mime_type: typeOf(name), media_type: 'document',
  byte_size: 100 + id, width: null, height: null, source: 'upload', created_by_id: 2, created_by_name: 'Owner', created_at: '2026-09-01 10:00:00',
  updated_at: `2026-09-0${1 + (id % 8)} 11:00:00`, original_byte_size: null, optimized_byte_size: null, optimization_status: 'not_optimized',
  optimization_note: null, duration_seconds: null, ...extra,
})
const ASSETS = [
  asset(1, 'invoice.pdf'), asset(2, 'photo.jfif', { media_type: 'image', width: 16, height: 16 }), asset(3, 'r.pdf'),
  asset(4, 'stock.xlsx'), asset(5, 'blob.dat'), asset(6, 'evil.html', { media_type: 'image' }), asset(7, 'Khmer ឯកសារ #1 100%+?.pdf'),
  asset(8, 'scan.pdf', { media_type: 'video', duration_seconds: 2.5 }), asset(9, 'invoice.jpg', { created_by_id: 3, optimization_note: 'kept "as is"', width: 0 }),
  asset(10, 'page.html'),
]
const REMOVED_ASSETS = [1, 3, 4, 7, 9, 10]
const IMPORT_COLUMNS = 'id, job_id, kind, original_name, stored_path, relative_path, mime_type, byte_size, status, error_message, created_at, updated_at, file_asset_id'
const importRow = (id, job, kind, storedPath, status, fileAssetId) => ({
  id, job_id: job, kind, original_name: storedPath.split('/').pop(), stored_path: storedPath, relative_path: null, mime_type: typeOf(storedPath),
  byte_size: 10 + id, status, error_message: null, created_at: '2026-09-02 09:00:00', updated_at: `2026-09-03 09:${String(id).padStart(2, '0')}:00`, file_asset_id: fileAssetId,
})
const IMPORT_ROWS = [
  importRow(10, 'done-job', 'csv', 'imports/done-job/incoming/items.csv', 'stored', null),
  importRow(11, 'done-job', 'xlsx', 'uploads/stock.xlsx', 'imported', 4),
  importRow(12, 'live-job', 'csv', 'imports/live-job/incoming/items.csv', 'stored', null),
  importRow(13, 'done-job', 'image', 'imports/done-job/incoming/p.jpg', 'stored', null),
  importRow(14, 'retry-job', 'csv', 'imports/retry-job/incoming/data.csv', 'stored', null),
  importRow(15, 'done-job', 'html', 'uploads/page.html', 'imported', 10),
  importRow(16, 'done-job', 'html', 'uploads/page.html', 'imported', 10),
  importRow(17, 'done-job', 'zip', 'imports/done-job/incoming/images.zip', 'stored', null),
  importRow(18, 'done-job', 'csv', 'uploads/stock-km.csv', 'stored', null),
]
const LINKED_IMPORTS = [11, 15, 16]
const PURGED_IMPORTS = [10, 14, 17, 18]

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  db.exec("INSERT INTO import_jobs (id, type, status) VALUES ('done-job', 'products', 'completed'), ('live-job', 'products', 'running'), ('retry-job', 'products', 'failed')")
  const insert = (table, columns, rows) => {
    const names = columns.split(', ')
    const statement = db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${names.map(() => '?').join(', ')})`)
    for (const row of rows) statement.run(...names.map((name) => row[name]))
  }
  insert('file_assets', ASSET_COLUMNS, ASSETS)
  insert('import_job_files', IMPORT_COLUMNS, IMPORT_ROWS)
  return db
}

// ----------------------------------------------------------- the mock API
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const NOT_FOUND = { success: false, errors: [{ code: 10007, message: 'The specified key does not exist.' }] }
const QUARANTINE = /^quarantine\/[^/]+\/(.+)$/

const worlds = []
function makeWorld(homeDir, options = {}) {
  const world = {
    homeDir, db: freshDb(), store: new Map(), requests: [], faults: [], violations: [], dead: false, crashFiles: null,
    atomic: options.atomic !== false, pageSize: options.pageSize || 7, listMetadata: options.listMetadata !== false,
    getHeaderType: options.getHeaderType || 'octet', deleteMissing: options.deleteMissing || '404', statementHook: null,
  }
  for (const object of OBJECTS) world.store.set(object.key, { bytes: object.bytes, contentType: typeOf(object.key), contentEncoding: object.contentEncoding || '' })
  world.fetch = (url, init) => handle(world, url, init)
  worlds.push(world)
  world.crash = () => { world.dead = true; world.crashFiles = snapshotFiles(world.homeDir) }
  return world
}

// Matches the nth request that satisfies `predicate`.
function nth(n, predicate) {
  let seen = 0
  return (request) => predicate(request) && ++seen === n
}
const isQuarantinePut = (request) => request.kind === 'object' && request.method === 'PUT' && request.key.startsWith('quarantine/')
const isOriginalDelete = (request) => request.kind === 'object' && request.method === 'DELETE' && !request.key.startsWith('quarantine/')
const isRowChange = (request) => request.kind === 'd1' && /-- changes/.test(request.sql || '')

async function handle(world, url, init = {}) {
  if (world.dead) throw new Error('simulated: the process is gone')
  const method = String(init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers || {})
  const parsed = new URL(url)
  const bodyText = typeof init.body === 'string' ? init.body : null
  const bodyBytes = init.body instanceof Uint8Array ? init.body : null
  world.requests.push({ method, url, body: bodyText, bytes: bodyBytes ? Buffer.from(bodyBytes) : null, headers: [...headers.entries()].filter(([name]) => name !== 'authorization') })
  if (headers.get('authorization') !== `Bearer ${TOKEN}`) return reply(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })
  const account = `/client/v4/accounts/${ACCOUNT}`
  const objects = `${account}/r2/buckets/business-os-assets/objects`
  let request
  if (parsed.origin !== 'https://api.cloudflare.com') return reply(400, { success: false, errors: [{ code: 1, message: 'wrong host' }] })
  if (parsed.pathname === objects && method === 'GET') request = { kind: 'list', method }
  else if (parsed.pathname.startsWith(`${objects}/`)) {
    const raw = parsed.pathname.slice(objects.length + 1)
    if (/%2f/i.test(raw)) {
      world.violations.push(`a key sent with an encoded slash: ${raw}`)
      return reply(400, { success: false, errors: [{ code: 10020, message: 'encoded slash in the key' }] })
    }
    request = { kind: 'object', method, key: raw.split('/').map(decodeURIComponent).join('/') }
  } else if (parsed.pathname === `${account}/d1/database/${DATABASE}/query` && method === 'POST') {
    request = { kind: 'd1', method, ...JSON.parse(bodyText) }
  } else return reply(404, { success: false, errors: [{ code: 7003, message: 'no such route' }] })
  let crashAfter = false
  for (const fault of world.faults) {
    if (fault.done || !fault.match(request)) continue
    fault.done = true
    if (fault.action === 'crash') { world.crash(); throw new Error('simulated: the process died') }
    if (fault.action === 'crash-after') crashAfter = true
    if (fault.action === 'error') return reply(500, { success: false, errors: [{ code: 10001, message: 'simulated failure' }] })
    if (fault.action === 'swallow') return reply(200, { success: true, errors: [], messages: [], result: [] })
    if (fault.action === 'corrupt') request.corrupt = true
    if (fault.action === 'hook') fault.hook(world, request)
  }
  const response = serve(world, request, headers, bodyBytes, parsed)
  if (crashAfter) { world.crash(); throw new Error('simulated: the process died after the request') }
  return response
}

function serve(world, request, headers, bodyBytes, parsed) {
  if (request.kind === 'd1') return d1(world, request)
  if (request.kind === 'list') {
    const prefix = parsed.searchParams.get('prefix') || ''
    const perPage = Math.min(Number(parsed.searchParams.get('per_page')) || 1000, world.pageSize)
    const start = Number(parsed.searchParams.get('cursor') || 0)
    const keys = [...world.store.keys()].filter((key) => key.startsWith(prefix)).sort()
    const next = start + perPage < keys.length ? String(start + perPage) : ''
    const result = keys.slice(start, start + perPage).map((key) => {
      const object = world.store.get(key)
      return { key, size: object.bytes.length, etag: md5(object.bytes), last_modified: '2026-09-01T00:00:00.000Z', ...(world.listMetadata ? { http_metadata: { contentType: object.contentType } } : {}) }
    })
    return reply(200, { success: true, result, result_info: { cursor: next, is_truncated: Boolean(next), per_page: perPage } })
  }
  const { key, method } = request
  const object = world.store.get(key)
  if (method === 'GET') {
    if (!object) return reply(404, NOT_FOUND)
    let data = object.bytes
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') || '')
    if (range) data = data.subarray(Number(range[1]), Number(range[2]) + 1)
    if (request.corrupt) { data = Uint8Array.from(data); data[data.length >> 1] ^= 0xff }
    const out = { etag: `"${md5(object.bytes)}"`, 'content-type': world.getHeaderType === 'stored' ? object.contentType : 'application/octet-stream' }
    if (object.contentEncoding) out['content-encoding'] = object.contentEncoding
    return new Response(data, { status: range ? 206 : 200, headers: out })
  }
  if (method === 'PUT') {
    if (!key.startsWith('quarantine/') && object && sha(object.bytes) !== sha(bodyBytes)) world.violations.push(`a different file was written over ${key}`)
    world.store.set(key, { bytes: Uint8Array.from(bodyBytes), contentType: headers.get('content-type') || '', contentEncoding: headers.get('content-encoding') || '' })
    return reply(200, { success: true, result: { key, size: bodyBytes.length } })
  }
  if (method === 'DELETE') {
    if (object) {
      const quarantined = QUARANTINE.exec(key)
      if (quarantined) {
        const original = world.store.get(quarantined[1])
        if (!original || sha(original.bytes) !== sha(object.bytes)) world.violations.push(`the quarantine copy ${key} was deleted while its original is not in place`)
      } else {
        const copies = [...world.store.entries()].filter(([name, copy]) => QUARANTINE.exec(name)?.[1] === key && sha(copy.bytes) === sha(object.bytes))
        if (!copies.length) world.violations.push(`the original ${key} was deleted with no identical copy in quarantine`)
      }
    }
    const existed = world.store.delete(key)
    if (!existed && world.deleteMissing === '404') return reply(404, NOT_FOUND)
    return reply(200, { success: true, result: {} })
  }
  return reply(405, { success: false, errors: [{ code: 1, message: 'method' }] })
}

function d1(world, { sql, params = [] }) {
  const run = (statement, values) => {
    if (world.statementHook) world.statementHook(statement)
    const prepared = world.db.prepare(statement)
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(statement)) return { results: prepared.all(...values).map((row) => ({ ...row })), success: true, meta: {} }
    const info = prepared.run(...values)
    return { results: [], success: true, meta: { changes: Number(info.changes) } }
  }
  try {
    let result
    if (params.length) result = [run(sql, params)]
    else {
      const statements = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n').split(/;\s*(?:\n|$)/).map((part) => part.trim()).filter(Boolean)
      if (world.atomic && statements.length > 1) {
        world.db.exec('BEGIN')
        try { result = statements.map((statement) => run(statement, [])); world.db.exec('COMMIT') } catch (error) { world.db.exec('ROLLBACK'); throw error }
      } else result = statements.map((statement) => run(statement, []))
    }
    return reply(200, { success: true, errors: [], messages: [], result })
  } catch (error) {
    return reply(400, { success: false, errors: [{ code: 7500, message: String(error.message) }], result: null })
  }
}

// ------------------------------------------------------------ utilities
function walk(dir, visit) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (fs.statSync(file).isDirectory()) walk(file, visit)
    else visit(file)
  }
}
function snapshotFiles(dir) {
  const files = new Map()
  walk(dir, (file) => files.set(file, fs.readFileSync(file)))
  return files
}
// A crash: what was on disk at that instant is all that survives.
function revertFiles(dir, snapshot) {
  walk(dir, (file) => { if (!snapshot.has(file)) fs.rmSync(file) })
  for (const [file, content] of snapshot) fs.writeFileSync(file, content)
}
const bucketState = (store) => [...store.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, object]) => [key, sha(object.bytes), object.contentType, object.contentEncoding])
const dbState = (db) => Object.fromEntries(['file_assets', 'import_job_files', 'import_jobs'].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => ({ ...row }))]))
const stateOf = (world) => ({ bucket: bucketState(world.store), rows: dbState(world.db) })
const findManifest = (home) => {
  let found = null
  walk(home, (file) => { if (path.basename(file) === 'manifest.json') found = file })
  return found
}

let script = null
const allOutput = []

async function invoke(world, argv, { answer = 'MOVE', concurrency = 1, moveMaxBytes, largeFileBytes, tokenFromEnv = false } = {}) {
  const out = []
  let tick = 0
  const prompts = {
    hidden: async () => TOKEN,
    visible: async (question) => { out.push(`? ${question}`); return typeof answer === 'function' ? answer(world, question) : answer },
  }
  const code = await script.run({
    argv, env: tokenFromEnv ? { ...ENV, CLOUDFLARE_API_TOKEN: TOKEN } : { ...ENV }, fetchImpl: world.fetch, prompts,
    out: { log: (line) => out.push(String(line)), error: (line) => out.push(String(line)) },
    homeDir: world.homeDir, now: () => new Date(CLOCK + 1000 * tick++), concurrency, ...(moveMaxBytes ? { moveMaxBytes } : {}), ...(largeFileBytes ? { largeFileBytes } : {}),
  })
  allOutput.push(...out)
  if (world.crashFiles) {
    revertFiles(world.homeDir, world.crashFiles)
    world.crashFiles = null
    world.dead = false
  }
  world.faults = []
  world.statementHook = null
  return { code, out, text: out.join('\n') }
}

const homes = []
async function scenario(name, options, body) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-quarantine-'))
  homes.push(home)
  const expect = (label, fn) => check(`${name}: ${label}`, fn)
  let world = null
  try {
    world = makeWorld(home, options)
    await body(world, expect)
  } catch (error) {
    checks += 1
    failures.push(`${name}: ${firstLine(error)}`)
  }
  expect('no safety invariant was broken', () => assert.deepEqual(world && world.violations, []))
}

// Restores from the manifest and requires the starting state back.
async function restoreAndCompare(world, expect, before, { rows = before.rows, code = 0, run = {} } = {}) {
  const manifestPath = findManifest(world.homeDir)
  expect('a manifest.json exists', () => assert.ok(manifestPath))
  if (!manifestPath) return null
  const restored = await invoke(world, ['--restore', manifestPath], { answer: 'RESTORE', ...run })
  expect(`restore exits ${code}`, () => assert.equal(restored.code, code, restored.text))
  expect('restore gives identical objects', () => assert.deepEqual(bucketState(world.store), before.bucket))
  expect('restore gives identical rows', () => assert.deepEqual(dbState(world.db), rows))
  return restored
}

const moveNotes = (world) => JSON.parse(fs.readFileSync(findManifest(world.homeDir), 'utf8'))

async function main() {
  try {
    // A plain copy: a module namespace cannot take the stand-in run() below.
    script = { ...(await import(pathToFileURL(PURGE_SOURCE).href)) }
  } catch (error) {
    failures.push(`load the purge script: ${firstLine(error)}`)
    script = {}
  }
  check('the script exports run()', () => assert.equal(typeof script.run, 'function'))
  if (typeof script.run !== 'function') script.run = async () => { throw new Error('the script has no run()') }
  check('the replayed schema has the Library triggers and the tables they use', () => {
    const db = freshDb()
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')").all().map((row) => row.name)
    db.close()
    for (const name of ['file_assets', 'import_job_files', 'import_jobs', 'stock_session_revisions', 'system_flags', 'stock_revision_file_assets_delete']) assert.ok(names.includes(name), name)
  })

  await scenario('dry run', {}, async (world, expect) => {
    const before = stateOf(world)
    const result = await invoke(world, [], { tokenFromEnv: true })
    expect('exits 0', () => assert.equal(result.code, 0, result.text))
    expect('changes nothing', () => assert.deepEqual(stateOf(world), before))
    expect('writes listing.json and no manifest', () => {
      let listing = null
      walk(world.homeDir, (file) => { if (path.basename(file) === 'listing.json') listing = file })
      assert.ok(listing, 'no listing.json')
      assert.equal(findManifest(world.homeDir), null)
    })
    expect('says what --move does', () => assert.match(result.text, /PURGE -- moved to quarantine\/ with --move/))
    expect('makes no write request', () => assert.deepEqual(world.requests.filter((request) => request.method === 'PUT' || request.method === 'DELETE'), []))
  })

  await scenario('move not confirmed', {}, async (world, expect) => {
    const before = stateOf(world)
    const result = await invoke(world, ['--move'], { answer: 'move' })
    expect('exits 0 and says nothing changed', () => { assert.equal(result.code, 0); assert.match(result.text, /Not confirmed\. Nothing was changed\./) })
    expect('the question says MOVE and quarantine', () => assert.match(result.text, /Type MOVE to move 34 files .* to quarantine\/2026-09-26T12-00-/))
    expect('changes nothing', () => assert.deepEqual(stateOf(world), before))
    expect('no manifest', () => assert.equal(findManifest(world.homeDir), null))
  })

  // Four at a time; files over 200 bytes one by one, as files over 32 MB are.
  const PARALLEL = { concurrency: 4, largeFileBytes: 200 }
  await scenario('move then restore, 4 at a time', {}, async (world, expect) => {
    const before = stateOf(world)
    const byKey = new Map(before.bucket.map(([key, hash, type, encoding]) => [key, { hash, type, encoding }]))
    const moved = await invoke(world, ['--move'], PARALLEL)
    expect('move exits 0', () => assert.equal(moved.code, 0, moved.text))
    expect('large files were copied one at a time, after the small ones', () => {
      const objectsPath = '/r2/buckets/business-os-assets/objects/'
      const firstChange = world.requests.findIndex((request) => (request.body || '').includes('-- changes'))
      const spans = new Map()
      let lastSmall = -1
      world.requests.slice(0, firstChange).forEach((request, index) => {
        const pathname = new URL(request.url).pathname
        if (!pathname.includes(objectsPath) || request.headers.some(([name]) => name === 'range')) return
        const key = pathname.split(objectsPath)[1].split('/').map(decodeURIComponent).join('/')
        const original = (QUARANTINE.exec(key) || [])[1] || key
        const object = OBJECTS.find((candidate) => candidate.key === original)
        if (!object) return
        if (object.bytes.length <= PARALLEL.largeFileBytes) { lastSmall = index; return }
        const span = spans.get(original) || [index, index]
        span[1] = index
        spans.set(original, span)
      })
      const ordered = [...spans.values()].sort((a, b) => a[0] - b[0])
      assert.ok(ordered.length >= 5, `only ${ordered.length} large files`)
      assert.ok(ordered[0][0] > lastSmall, 'a large file was copied among the small ones')
      for (let index = 1; index < ordered.length; index += 1) assert.ok(ordered[index][0] > ordered[index - 1][1], 'two large files were copied at the same time')
    })
    const manifest = moveNotes(world)
    expect('every PURGE file is in quarantine byte for byte, with its content type; its original is gone', () => {
      for (const key of PURGE_KEYS) {
        assert.ok(!world.store.has(key), `${key} still in place`)
        const copy = world.store.get(`quarantine/${manifest.stamp}/${key}`)
        assert.ok(copy, `${key} not in quarantine`)
        assert.equal(sha(copy.bytes), byKey.get(key).hash, key)
        assert.equal(copy.contentType, byKey.get(key).type, key)
      }
    })
    expect('every other file is untouched and was not copied', () => {
      for (const [key, { hash }] of byKey) {
        if (PURGE_KEYS.includes(key)) continue
        assert.equal(sha(world.store.get(key).bytes), hash, key)
        assert.ok(!world.store.has(`quarantine/${manifest.stamp}/${key}`), `${key} was copied`)
      }
    })
    expect('manifest: key, quarantine key, size, SHA-256 and content type of each moved file', () => {
      assert.deepEqual(manifest.moves.map((move) => move.key).sort(), PURGE_KEYS)
      for (const move of manifest.moves) {
        assert.equal(move.state, 'moved')
        assert.equal(move.quarantineKey, `quarantine/${manifest.stamp}/${move.key}`)
        assert.equal(move.sha256, byKey.get(move.key).hash)
        assert.equal(move.size, OBJECTS.find((object) => object.key === move.key).bytes.length)
        assert.equal(move.contentType, byKey.get(move.key).type)
      }
    })
    expect('manifest: every changed row with all its old values', () => {
      assert.deepEqual(manifest.rows.file_assets, before.rows.file_assets.filter((row) => REMOVED_ASSETS.includes(row.id)))
      assert.deepEqual(manifest.rows.import_job_files, before.rows.import_job_files.filter((row) => [...LINKED_IMPORTS, ...PURGED_IMPORTS].includes(row.id)))
    })
    expect('rows after the move', () => {
      const rows = dbState(world.db)
      assert.deepEqual(rows.file_assets.map((row) => row.id), [2, 5, 6, 8])
      for (const row of rows.import_job_files) {
        if (LINKED_IMPORTS.includes(row.id)) assert.deepEqual([row.status, row.file_asset_id], ['purged', null], `row ${row.id}`)
        else if (PURGED_IMPORTS.includes(row.id)) assert.equal(row.status, 'purged', `row ${row.id}`)
        else assert.deepEqual(row, before.rows.import_job_files.find((old) => old.id === row.id))
      }
    })
    expect('the older quarantine folder is untouched', () => assert.ok(world.store.has('quarantine/2020-01-01T00-00-00-000Z/uploads/old.pdf')))
    expect('prints how to restore', () => assert.match(moved.text, /--restore ".*manifest\.json"/))
    await restoreAndCompare(world, expect, before, { run: PARALLEL })
    const again = await invoke(world, ['--restore', path.dirname(findManifest(world.homeDir))], { answer: 'RESTORE', ...PARALLEL })
    expect('a second restore (given the folder) changes nothing', () => {
      assert.equal(again.code, 0, again.text)
      assert.match(again.text, /Files put back: 0; already in place: 34;/)
      assert.deepEqual(stateOf(world), before)
    })
  })

  // Crashes: the API stops answering and the local files are reverted to
  // what was on disk at that instant. --restore must then undo everything.
  const crashes = [
    ['crash on the third quarantine copy', {}, { match: nth(3, isQuarantinePut), action: 'crash' }, (world, expect) => {
      expect('no original was touched', () => { for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key) })
      expect('the copies made before the crash are not in the manifest', () => assert.equal(moveNotes(world).moves.length, 0))
    }],
    ['crash on the first database change', {}, { match: isRowChange, action: 'crash' }, (world, expect, before) => {
      expect('rows untouched, originals in place', () => {
        assert.deepEqual(dbState(world.db), before.rows)
        for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key)
      })
      expect('the old rows were on disk before the change', () => assert.equal(moveNotes(world).rows.file_assets.length, REMOVED_ASSETS.length))
    }],
    ['crash right after the first database change', {}, { match: isRowChange, action: 'crash-after' }, (world, expect) => {
      expect('rows changed, originals still in place', () => {
        assert.deepEqual(dbState(world.db).file_assets.map((row) => row.id), [2, 5, 6, 8])
        for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key)
      })
    }],
    ['crash on the second original delete', { listMetadata: false, getHeaderType: 'stored', deleteMissing: 'ok' }, { match: nth(2, isOriginalDelete), action: 'crash' }, (world, expect) => {
      expect('one original was removed', () => assert.equal(PURGE_KEYS.filter((key) => !world.store.has(key)).length, 1))
    }],
    ['crash after the last original delete', {}, { match: nth(PURGE_KEYS.length, isOriginalDelete), action: 'crash-after' }, (world, expect) => {
      expect('every original was removed', () => assert.equal(PURGE_KEYS.filter((key) => world.store.has(key)).length, 0))
      expect('the manifest on disk never said "done"', () => assert.notEqual(moveNotes(world).phase, 'done'))
    }],
  ]
  for (const [name, options, fault, inspect] of crashes) {
    await scenario(name, options, async (world, expect) => {
      const before = stateOf(world)
      world.faults.push(fault)
      const moved = await invoke(world, ['--move'])
      expect('the run fails', () => assert.equal(moved.code, 1, moved.text))
      inspect(world, expect, before)
      await restoreAndCompare(world, expect, before)
    })
  }

  await scenario('a quarantine copy is refused', {}, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({ match: (request) => isQuarantinePut(request) && request.key.endsWith('/uploads/letter.rtf'), action: 'error' })
    const moved = await invoke(world, ['--move'])
    expect('exits 1, says it stayed', () => { assert.equal(moved.code, 1); assert.match(moved.text, /1 files could not be copied exactly; they stay where they are/) })
    expect('that file stays, the rest moved', () => {
      assert.ok(world.store.has('uploads/letter.rtf'))
      assert.equal(PURGE_KEYS.filter((key) => world.store.has(key)).length, 1)
      assert.equal(moveNotes(world).moves.find((move) => move.key === 'uploads/letter.rtf').state, 'copy-failed')
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('a quarantine copy reads back different', {}, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({ match: (request) => request.kind === 'object' && request.method === 'GET' && /^quarantine\/2026[^/]+\/uploads\/stock\.xlsx$/.test(request.key), action: 'corrupt' })
    const moved = await invoke(world, ['--move'])
    expect('exits 1', () => assert.equal(moved.code, 1, moved.text))
    expect('the file stays, with its Library row and import link, and no copy is left', () => {
      assert.ok(world.store.has('uploads/stock.xlsx'))
      const stamp = moveNotes(world).stamp
      assert.ok(!world.store.has(`quarantine/${stamp}/uploads/stock.xlsx`))
      const rows = dbState(world.db)
      assert.ok(rows.file_assets.some((row) => row.id === 4))
      assert.deepEqual(rows.import_job_files.find((row) => row.id === 11), before.rows.import_job_files.find((row) => row.id === 11))
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('the database guard refuses a row linked after the snapshot', {}, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({
      match: isRowChange, action: 'hook',
      hook: (target) => target.db.exec("INSERT INTO import_job_files (id, job_id, kind, stored_path, status, file_asset_id, created_at, updated_at) VALUES (99, 'done-job', 'pdf', 'uploads/invoice.pdf', 'stored', 1, '2026-09-26 12:00:00', '2026-09-26 12:00:00')"),
    })
    const moved = await invoke(world, ['--move'])
    expect('exits 1, removes no original', () => {
      assert.equal(moved.code, 1, moved.text)
      assert.match(moved.text, /the database refused a change .*\. No original file was removed\./)
      assert.deepEqual([moveNotes(world).database.state, moveNotes(world).database.batches[0].state], ['failed', 'failed'])
      for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key)
    })
    const withNewRow = dbState(world.db)
    expect('no row changed; the new link is intact', () => {
      assert.deepEqual(withNewRow.file_assets, before.rows.file_assets)
      assert.equal(withNewRow.import_job_files.find((row) => row.id === 99).file_asset_id, 1)
    })
    await restoreAndCompare(world, expect, before, { rows: withNewRow })
  })

  await scenario('a non-atomic database batch fails half way', { atomic: false }, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({ match: isRowChange, action: 'hook', hook: (target) => { target.statementHook = (statement) => { if (statement.startsWith('DELETE FROM file_assets')) throw new Error('simulated: D1 stopped mid-batch') } } })
    const moved = await invoke(world, ['--move'])
    expect('exits 1', () => assert.equal(moved.code, 1, moved.text))
    expect('the links were cleared, the Library rows not removed, the originals kept', () => {
      const rows = dbState(world.db)
      assert.equal(rows.file_assets.length, before.rows.file_assets.length)
      assert.equal(rows.import_job_files.find((row) => row.id === 11).file_asset_id, null)
      for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key)
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('the database answers success but changes nothing', {}, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({ match: isRowChange, action: 'swallow' })
    const moved = await invoke(world, ['--move'])
    expect('the read-back catches it: exits 1, removes no original', () => {
      assert.equal(moved.code, 1, moved.text)
      assert.match(moved.text, /the database does not show the expected changes \(6 Library rows still there, 4 of 7 import rows purged\)/)
      for (const key of PURGE_KEYS) assert.ok(world.store.has(key), key)
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('an original cannot be deleted', {}, async (world, expect) => {
    const before = stateOf(world)
    world.faults.push({ match: (request) => isOriginalDelete(request) && request.key === 'uploads/app.js', action: 'error' })
    const moved = await invoke(world, ['--move'])
    expect('exits 1; that original stays, marked delete-failed', () => {
      assert.equal(moved.code, 1, moved.text)
      assert.ok(world.store.has('uploads/app.js'))
      assert.equal(moveNotes(world).moves.find((move) => move.key === 'uploads/app.js').state, 'delete-failed')
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('an import starts running before the move', {}, async (world, expect) => {
    const before = stateOf(world)
    const answer = (target) => { target.db.exec("UPDATE import_jobs SET status = 'queued' WHERE id = 'retry-job'"); return 'MOVE' }
    const moved = await invoke(world, ['--move'], { answer })
    const running = dbState(world.db)
    expect('its file and row stay', () => {
      assert.equal(moved.code, 0, moved.text)
      assert.ok(world.store.has('imports/retry-job/incoming/data.csv'))
      assert.deepEqual(running.import_job_files.find((row) => row.id === 14), before.rows.import_job_files.find((row) => row.id === 14))
      assert.deepEqual(moveNotes(world).skipped, [{ key: 'imports/retry-job/incoming/data.csv', reason: 'its import is running again' }])
    })
    await restoreAndCompare(world, expect, before, { rows: { ...before.rows, import_jobs: running.import_jobs } })
  })

  await scenario('files change after the listing', {}, async (world, expect) => {
    const before = stateOf(world)
    const photo = F.png()
    let atPrompt = null
    const answer = (target) => {
      // The same size as the text it replaces, so only the whole-file check can tell.
      assert.equal(photo.length, target.store.get('uploads/note.txt').bytes.length)
      target.store.set('uploads/note.txt', { bytes: photo, contentType: 'image/png', contentEncoding: '' })
      target.store.set('uploads/stock.txt', { bytes: F.enc('sku,qty\nlonger now\n'), contentType: 'text/plain', contentEncoding: '' })
      target.store.delete('uploads/fr.csv')
      atPrompt = stateOf(target)
      return 'MOVE'
    }
    // Between the database change and the removal of the originals.
    world.faults.push({ match: isRowChange, action: 'hook', hook: (target) => target.store.set('uploads/stock.csv', { bytes: F.enc('sku,qty\nB2,4\n'), contentType: 'text/csv', contentEncoding: '' }) })
    const moved = await invoke(world, ['--move'], { answer })
    const notes = moveNotes(world)
    expect('each changed file is left where it is, with the reason', () => {
      assert.equal(moved.code, 0, moved.text)
      assert.deepEqual(notes.skipped.map((skip) => [skip.key, skip.reason]).sort(), [
        ['uploads/fr.csv', 'it is no longer there'],
        ['uploads/note.txt', 'the whole file checks as misleading-name'],
        ['uploads/stock.txt', 'its size changed since the listing'],
      ])
      const kept = notes.moves.find((move) => move.key === 'uploads/stock.csv')
      assert.deepEqual([kept.state, kept.note], ['original-kept', 'the original changed after it was copied'])
      assert.equal(sha(world.store.get('uploads/note.txt').bytes), sha(photo))
      assert.ok(world.store.has('uploads/stock.txt') && world.store.has('uploads/stock.csv'))
      assert.equal(PURGE_KEYS.filter((key) => world.store.has(key)).length, 3)
    })
    const restored = await invoke(world, ['--restore', findManifest(world.homeDir)], { answer: 'RESTORE' })
    expect('restore exits 1 and names the one it could not put back', () => {
      assert.equal(restored.code, 1, restored.text)
      assert.match(restored.text, /conflicts: 1;/)
      assert.match(restored.text, /conflict: uploads\/stock\.csv/)
    })
    expect('restore gives back everything else; the newer stock.csv stays, the older one stays in quarantine', () => {
      const older = `quarantine/${notes.stamp}/uploads/stock.csv`
      const expected = atPrompt.bucket.filter(([key]) => key !== 'uploads/stock.csv')
      const actual = bucketState(world.store).filter(([key]) => key !== 'uploads/stock.csv' && key !== older)
      assert.deepEqual(actual, expected)
      assert.equal(sha(world.store.get('uploads/stock.csv').bytes), sha(F.enc('sku,qty\nB2,4\n')))
      assert.equal(sha(world.store.get(older).bytes), sha(OBJECTS.find((object) => object.key === 'uploads/stock.csv').bytes))
      assert.deepEqual(dbState(world.db), before.rows)
    })
  })

  await scenario('files over the size cap stay', {}, async (world, expect) => {
    const before = stateOf(world)
    const moved = await invoke(world, ['--move'], { moveMaxBytes: 100 })
    expect('exits 0; only small files moved', () => {
      assert.equal(moved.code, 0, moved.text)
      for (const key of PURGE_KEYS) {
        const size = OBJECTS.find((object) => object.key === key).bytes.length
        assert.equal(world.store.has(key), size > 100, key)
      }
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('restore meets a different file, a missing copy and a row changed since', {}, async (world, expect) => {
    const before = stateOf(world)
    await invoke(world, ['--move'])
    const stamp = moveNotes(world).stamp
    const replacement = F.enc('a new invoice')
    world.store.set('uploads/invoice.pdf', { bytes: replacement, contentType: 'application/pdf', contentEncoding: '' })
    world.store.delete(`quarantine/${stamp}/uploads/data.json`)
    // Something else (the app) changed a purged import row after the move.
    world.db.exec("UPDATE import_job_files SET status = 'linked_existing', updated_at = '2026-09-26 13:00:00' WHERE id = 17")
    const changedRow = { ...world.db.prepare('SELECT * FROM import_job_files WHERE id = 17').get() }
    const restored = await invoke(world, ['--restore', findManifest(world.homeDir)], { answer: 'RESTORE' })
    expect('exits 1 and names all three', () => {
      assert.equal(restored.code, 1, restored.text)
      assert.match(restored.text, /conflict: uploads\/invoice\.pdf/)
      assert.match(restored.text, /missing: uploads\/data\.json/)
      assert.match(restored.text, /Import rows back as they were: 6 of 7\./)
    })
    expect('the new file is kept, its quarantine copy too; the changed row is left; everything else is back', () => {
      assert.equal(sha(world.store.get('uploads/invoice.pdf').bytes), sha(replacement))
      assert.ok(world.store.has(`quarantine/${stamp}/uploads/invoice.pdf`))
      const expected = before.bucket.filter(([key]) => key !== 'uploads/invoice.pdf' && key !== 'uploads/data.json')
      const actual = bucketState(world.store).filter(([key]) => key !== 'uploads/invoice.pdf' && !key.startsWith(`quarantine/${stamp}/`))
      assert.deepEqual(actual, expected)
      const rows = before.rows.import_job_files.map((row) => (row.id === 17 ? changedRow : row))
      assert.deepEqual(dbState(world.db), { ...before.rows, import_job_files: rows })
    })
  })

  await scenario('restore fails part way, dies part way, and is run again', {}, async (world, expect) => {
    const before = stateOf(world)
    await invoke(world, ['--move'])
    const manifestPath = findManifest(world.homeDir)
    const stamp = moveNotes(world).stamp
    const isRestorePut = (request) => request.kind === 'object' && request.method === 'PUT' && !request.key.startsWith('quarantine/')
    const readsOf = (key) => (request) => request.kind === 'object' && request.method === 'GET' && request.key === key
    world.faults.push({ match: (request) => isRestorePut(request) && request.key === 'uploads/invoice.pdf', action: 'error' })
    // The first read of page.html finds nothing; the second is the check after writing it.
    world.faults.push({ match: nth(2, readsOf('uploads/page.html')), action: 'corrupt' })
    const first = await invoke(world, ['--restore', manifestPath], { answer: 'RESTORE' })
    expect('a restore that cannot write or check a file exits 1 and keeps its quarantine copy', () => {
      assert.equal(first.code, 1, first.text)
      assert.match(first.text, /failed: 2\./)
      assert.match(first.text, /failed: uploads\/page\.html -- the restored file did not read back identical, so it was removed again/)
      assert.ok(!world.store.has('uploads/page.html'))
      for (const key of ['uploads/invoice.pdf', 'uploads/page.html']) assert.ok(world.store.has(`quarantine/${stamp}/${key}`), key)
    })
    world.faults.push({ match: nth(1, isRestorePut), action: 'crash-after' })
    const second = await invoke(world, ['--restore', manifestPath], { answer: 'RESTORE' })
    expect('a restore that dies after writing a file exits 1', () => assert.equal(second.code, 1, second.text))
    await restoreAndCompare(world, expect, before)
  })

  await scenario('restore dies while putting rows back, and is run again', {}, async (world, expect) => {
    const before = stateOf(world)
    await invoke(world, ['--move'])
    world.faults.push({ match: nth(2, (request) => request.kind === 'd1' && /^INSERT INTO file_assets/.test(request.sql)), action: 'crash-after' })
    const first = await invoke(world, ['--restore', findManifest(world.homeDir)], { answer: 'RESTORE' })
    expect('it exits 1 with two of the six Library rows back', () => {
      assert.equal(first.code, 1, first.text)
      assert.equal(world.db.prepare('SELECT COUNT(*) AS n FROM file_assets').get().n, 4 + 2)
    })
    await restoreAndCompare(world, expect, before)
  })

  await scenario('tampered or wrong manifests are refused before any request', {}, async (world, expect) => {
    await invoke(world, ['--move'])
    const manifestPath = findManifest(world.homeDir)
    const good = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const variants = [
      ['a quarantine key pointing elsewhere', (m) => { m.moves[0].quarantineKey = 'uploads/evil.pdf' }, /quarantine name/],
      ['a key outside the purged folders', (m) => { m.moves[0].key = 'backups/cloudflare/state.json' }, /outside uploads\//],
      ['a column that is not a plain name', (m) => { m.rows.file_assets[0]['id) VALUES (1); DROP TABLE file_assets; --'] = 1 }, /column named/],
      ['another bucket', (m) => { m.bucket = 'other' }, /bucket other/],
      ['a dry-run listing', (m) => { m.mode = 'dry-run' }, /dry run/],
      ['a missing hash', (m) => { delete m.moves[0].sha256 }, /no SHA-256/],
      // S-uploads3 (R-uploads2): rows that belong to no move in the manifest.
      ['an added Library row id 999 for /uploads/evil.html', (m) => {
        m.rows.file_assets.push({ ...m.rows.file_assets[0], id: 999, stored_name: 'evil.html', public_path: '/uploads/evil.html', mime_type: 'text/html' })
      }, /Library row \(id 999\) matches no moved file/],
      ['a recorded Library row repointed at a kept file', (m) => { m.rows.file_assets[0].public_path = '/uploads/photo.jfif' }, /Library row \(id \d+\) has a public path to a file that was not moved/],
      ['a recorded Library row moved out of /uploads/', (m) => { m.rows.file_assets[0].public_path = '/api/files/1' }, /public path outside \/uploads\//],
      ['a Library row whose type is markup, not a media type', (m) => { m.rows.file_assets[0].mime_type = 'text/html; <script>' }, /not a media type/],
      ['an added import row', (m) => { m.rows.import_job_files.push({ ...m.rows.import_job_files[0], id: 999, stored_path: 'uploads/photo.jfif', file_asset_id: 2 }) }, /import row \(id 999\) matches no moved file/],
    ]
    for (const [label, edit, message] of variants) {
      const copy = JSON.parse(JSON.stringify(good))
      edit(copy)
      const file = path.join(world.homeDir, 'tampered.json')
      fs.writeFileSync(file, JSON.stringify(copy))
      const requestsBefore = world.requests.length
      const result = await invoke(world, ['--restore', file], { answer: 'RESTORE' })
      expect(`${label}: refused`, () => {
        assert.equal(result.code, 1)
        assert.match(result.text, message)
        assert.equal(world.requests.length, requestsBefore, 'it made a request')
      })
    }
    const missing = await invoke(world, ['--restore', path.join(world.homeDir, 'nope.json')], { answer: 'RESTORE' })
    expect('a missing file: refused', () => { assert.equal(missing.code, 1); assert.match(missing.text, /could not read/) })
    const unconfirmed = await invoke(world, ['--restore', manifestPath], { answer: 'restore' })
    expect('restore not confirmed changes nothing', () => { assert.equal(unconfirmed.code, 0); assert.match(unconfirmed.text, /Not confirmed/) })
  })

  await scenario('command line', {}, async (world, expect) => {
    const help = await invoke(world, ['--help'])
    expect('--help explains MOVE, RESTORE, quarantine and that there is no --delete', () => {
      assert.equal(help.code, 0)
      for (const text of ['--move', 'type MOVE', '--restore', 'type RESTORE', 'quarantine/<time>/', 'There is no --delete', 'never printed and never written']) assert.ok(help.text.includes(text), text)
    })
    const removed = await invoke(world, ['--delete'])
    expect('--delete is refused with the reason, before any request', () => {
      assert.equal(removed.code, 1)
      assert.match(removed.text, /There is no --delete any more/)
    })
    const unknown = await invoke(world, ['--purge-all'])
    expect('an unknown option is refused', () => { assert.equal(unknown.code, 1); assert.match(unknown.text, /Unknown option: --purge-all/) })
    const both = await invoke(world, ['--move', '--restore', 'x'])
    expect('--move with --restore is refused', () => { assert.equal(both.code, 1); assert.match(both.text, /either --move or --restore/) })
    expect('none of these made a request', () => assert.equal(world.requests.length, 0))
  })

  check('the header documents the owner\'s hard delete, and the script never does one', () => {
    const source = fs.readFileSync(PURGE_SOURCE, 'utf8')
    assert.match(source, /Deleting the quarantine for good/)
    assert.match(source, /Object lifecycle rules/)
  })
  check('quarantine keys never land under a served or purged folder', () => {
    for (const key of PURGE_KEYS) {
      const quarantined = script.quarantineKeyFor('2026-09-26T12-00-00-000Z', key)
      assert.ok(quarantined.startsWith('quarantine/2026-09-26T12-00-00-000Z/'), quarantined)
    }
    assert.ok(!script.PREFIXES.some((prefix) => 'quarantine/'.startsWith(prefix)))
  })
  check('the token never left the Authorization header', () => {
    const leaks = allOutput.filter((line) => line.includes(TOKEN))
    for (const world of worlds) for (const request of world.requests) if (JSON.stringify(request).includes(TOKEN)) leaks.push(`${request.method} ${request.url}`)
    assert.ok(worlds.reduce((sum, world) => sum + world.requests.length, 0) > 1000, 'the mocked API saw almost no traffic')
    for (const home of homes) walk(home, (file) => { if (fs.readFileSync(file).includes(TOKEN)) leaks.push(file) })
    assert.deepEqual(leaks, [])
  })

  for (const home of homes) fs.rmSync(home, { recursive: true, force: true })
  if (failures.length) {
    for (const failure of failures.slice(0, 60)) console.error(`FAIL ${failure}`)
    if (failures.length > 60) console.error(`...and ${failures.length - 60} more`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: --move copies, verifies, records and only then removes; every crash, refusal and partial failure is undone by --restore to identical files and rows; no hard delete; tampered manifests refused; the token stays in the Authorization header`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
