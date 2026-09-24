// Tests for snapshot-d1-readonly.mjs. Pure node, no network, no wrangler.
// Run with: node ops/scripts/latest-data/snapshot-d1-readonly.test.mjs
//
// Imports the REAL guard / redaction / main() from the tool module (main()
// is guarded behind an import.meta.url check, so importing does not run it).
// Every remote-shaped call is served by a local fake runner; the default
// wrangler runner is never reached from this file.
//
// The migrated schema is rebuilt locally by applying every
// cloudflare/migrations/*.sql file to an in-memory node:sqlite database
// (Node >= 22.5), which is also the fake "production" the end-to-end run
// reads from.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOL_PATH = path.join(__dirname, 'snapshot-d1-readonly.mjs')
const SOURCE = fs.readFileSync(TOOL_PATH, 'utf8')

const exitCodeBeforeImport = process.exitCode
const tool = await import('./snapshot-d1-readonly.mjs')
const {
  REPO_ROOT, DATABASE_NAME, SQL, assertSelect, createD1, assertOutsideRepo, protectedRoots,
  PII_COLUMNS, SECRET_COLUMNS, REVIEWED_NOT_PII, classifyKey, createRedactor, parseArgs, main,
} = tool

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

let failures = 0
let passes = 0
function check(name, fn) {
  try {
    fn()
    passes += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    failures += 1
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-d1-test-'))
const quietLog = () => {
  const lines = []
  const push = (...a) => lines.push(a.join(' '))
  return { log: push, warn: push, error: push, lines }
}

// --- Local "production": every migration applied to an in-memory SQLite ---
function migratedDb() {
  const db = new DatabaseSync(':memory:')
  const dir = path.join(REPO_ROOT, 'cloudflare', 'migrations')
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return db
}
const SOURCE_DB = migratedDb()
const TABLES = SOURCE_DB.prepare(SQL.listTables()).all()
const SCHEMA = Object.fromEntries(
  TABLES.map((t) => [t.name, SOURCE_DB.prepare(`PRAGMA table_info("${t.name}")`).all().map((c) => c.name)]),
)

// ===========================================================================
// Module wiring
// ===========================================================================
check('importing the tool does not run main() (import.meta.url guard)', () => {
  assert.equal(process.exitCode, exitCodeBeforeImport)
  assert.match(SOURCE, /import\.meta\.url === pathToFileURL\(/)
})
check('DATABASE_NAME matches cloudflare/wrangler.toml DB binding database_name', () => {
  const toml = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare', 'wrangler.toml'), 'utf8')
  const m = toml.match(/binding\s*=\s*"DB"\s*\n\s*database_name\s*=\s*"([^"]+)"/)
  assert.ok(m, 'DB binding block not found in wrangler.toml')
  assert.equal(m[1], DATABASE_NAME)
})

// ===========================================================================
// Guard 1: SELECT-only
// ===========================================================================
check('accepts the probe and sqlite_master SELECTs the tool issues', () => {
  assertSelect(SQL.probe())
  assertSelect(SQL.listTables())
})
check(`accepts the tool's real COUNT/page SELECTs for all ${TABLES.length} migrated tables`, () => {
  assert.ok(TABLES.length > 100)
  for (const { name } of TABLES) {
    assertSelect(SQL.count(name))
    assertSelect(SQL.page(name, 'rowid', 0))
    assertSelect(SQL.page(name, null, 3000))
  }
})
check('accepts lowercase, leading whitespace and one trailing semicolon', () => {
  assertSelect('select count(*) as c from products')
  assertSelect('\n  SELECT name FROM sqlite_master')
  assertSelect('SELECT 1;')
})
const REFUSED = [
  'INSERT INTO products (id) VALUES (1)',
  "UPDATE products SET name = 'x'",
  'DELETE FROM products',
  'DROP TABLE products',
  'ALTER TABLE products ADD COLUMN x TEXT',
  'CREATE TABLE evil (id INTEGER)',
  "REPLACE INTO settings (key, value) VALUES ('a', 'b')",
  'PRAGMA table_info(products)',
  'PRAGMA foreign_keys = OFF',
  'VACUUM',
  'REINDEX',
  "ATTACH DATABASE 'x.db' AS x",
  'DETACH DATABASE x',
  'WITH x AS (SELECT 1) DELETE FROM products',
  'SELECT 1; DROP TABLE products;',
  'SELECT 1; SELECT 2',
  'SELECT 1;DELETE FROM products',
  'SELECT * FROM products; PRAGMA writable_schema = 1',
  "SELECT 1 WHERE 1 IN (SELECT 1) ; UPDATE users SET password = 'x'",
  'SELECT * FROM products WHERE 0 UNION SELECT 1 FROM (DELETE FROM products)',
  "SELECT load_extension('evil')",
  '/* comment */ DELETE FROM products',
  '-- SELECT 1',
  '',
  '   ',
]
for (const sql of REFUSED) {
  check(`refuses ${JSON.stringify(sql).slice(0, 70)}`, () => {
    assert.throws(() => assertSelect(sql), /Refused/)
  })
}
check('createD1: refused SQL never reaches the runner; accepted SQL does, once', () => {
  const seen = []
  const d1 = createD1((sql) => {
    seen.push(sql)
    return [{ ok: 1 }]
  })
  for (const sql of REFUSED) assert.throws(() => d1(sql), /Refused/)
  assert.deepEqual(seen, [])
  assert.equal(d1.requestCount, 0)
  assert.deepEqual(d1(SQL.probe()), [{ ok: 1 }])
  assert.deepEqual(seen, [SQL.probe()])
  assert.equal(d1.requestCount, 1)
})
check('source: the only --remote/execute spawn is the runner, reachable only via createD1', () => {
  assert.equal(SOURCE.match(/'--remote'/g)?.length, 1)
  assert.equal(SOURCE.match(/'execute'/g)?.length, 1)
  const runnerRefs = SOURCE.match(/wranglerRemoteRunner\b/g)?.length
  // definition + its own retry + createD1 default
  assert.equal(runnerRefs, 3)
  assert.match(SOURCE, /export function createD1\(runner = wranglerRemoteRunner\)/)
  assert.match(SOURCE, /const safe = assertSelect\(sql\)\s*\n\s*d1\.requestCount \+= 1\s*\n\s*return runner\(safe\)/)
})
check('source: every d1(...) call site passes an SQL.* builder', () => {
  const code = SOURCE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const calls = [...code.matchAll(/\bd1\(([^)]*)/g)].map((m) => m[1].trim())
  assert.ok(calls.length >= 4, `expected several d1() calls, got ${calls.length}`)
  for (const arg of calls) assert.match(arg, /^SQL\.\w+\(/, `d1 call with non-builder argument: ${arg}`)
})

// ===========================================================================
// Guard 2: output outside the repository
// ===========================================================================
check('assertOutsideRepo rejects the repo root and paths under it', () => {
  for (const p of [
    REPO_ROOT,
    path.join(REPO_ROOT, 'ops'),
    path.join(REPO_ROOT, 'ops', 'scripts', 'latest-data', 'd1-snapshot-20260924'),
    path.join(REPO_ROOT, 'does', 'not', 'exist', 'yet'),
    path.join(REPO_ROOT, 'cloudflare', '..', 'frontend', 'snap'),
    path.relative(process.cwd(), path.join(REPO_ROOT, 'tmp-snap')) || '.',
  ]) {
    assert.throws(() => assertOutsideRepo(p), /inside the repository/, p)
  }
})
check('assertOutsideRepo rejects a symlink outside the repo that points into it', () => {
  const link = path.join(TMP_ROOT, 'link-into-repo')
  fs.symlinkSync(REPO_ROOT, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => assertOutsideRepo(path.join(link, 'snap')), /inside the repository/)
})
check('assertOutsideRepo accepts a path outside the repo and rejects empty', () => {
  const ok = path.join(TMP_ROOT, 'd1-snapshot-ok')
  assert.equal(assertOutsideRepo(ok), path.resolve(ok))
  assert.throws(() => assertOutsideRepo(''), /Refused/)
})
check('assertOutsideRepo also protects the main checkout from a linked worktree', () => {
  const fakeMain = path.join(TMP_ROOT, 'main-checkout')
  const fakeWt = path.join(fakeMain, '.claude', 'worktrees', 'agent-x')
  fs.mkdirSync(path.join(fakeMain, '.git', 'worktrees', 'agent-x'), { recursive: true })
  fs.mkdirSync(fakeWt, { recursive: true })
  fs.writeFileSync(path.join(fakeWt, '.git'), `gitdir: ${path.join(fakeMain, '.git', 'worktrees', 'agent-x')}\n`)
  assert.deepEqual(protectedRoots(fakeWt).map((p) => path.resolve(p)), [path.resolve(fakeWt), path.resolve(fakeMain)])
  assert.throws(() => assertOutsideRepo(path.join(fakeMain, 'snap'), fakeWt), /inside the repository/)
  assert.throws(() => assertOutsideRepo(path.join(fakeWt, 'snap'), fakeWt), /inside the repository/)
  assertOutsideRepo(path.join(TMP_ROOT, 'elsewhere'), fakeWt)
})
check('main() refuses an in-repo output dir before any remote call or mkdir', () => {
  const target = path.join(REPO_ROOT, 'ops', 'scripts', 'latest-data', `d1-snapshot-should-not-exist-${process.pid}`)
  let calls = 0
  const log = quietLog()
  try {
    let code
    try {
      code = main([target], { runner: () => { calls += 1; return [] }, wranglerVersion: 'test', log })
    } catch (err) {
      code = `threw: ${err.message}`
    }
    assert.equal(calls, 0, 'a remote-shaped call happened before the refusal')
    assert.equal(fs.existsSync(target), false, 'output dir was created inside the repo')
    assert.equal(code, 2)
    assert.ok(log.lines.some((l) => /inside the repository/.test(l)))
  } finally {
    // Only ever this uniquely named path, and only if a broken build created it.
    fs.rmSync(target, { recursive: true, force: true })
  }
})
check('parseArgs: flags, usage and unknown options', () => {
  assert.deepEqual(parseArgs(['--include-pii', '/x']), { includePii: true, outDir: '/x', help: false })
  assert.deepEqual(parseArgs(['/x']), { includePii: false, outDir: '/x', help: false })
  assert.throws(() => parseArgs(['--include-pi', '/x']), /Unknown option/)
  assert.throws(() => parseArgs(['/x', '/y']), /extra argument/)
  assert.equal(main([], { log: quietLog() }), 1)
})

// ===========================================================================
// Guard 3: redaction
// ===========================================================================
// Columns the brief names explicitly; the map must keep covering them.
const REQUIRED_PII = {
  customers: ['phone', 'email', 'address', 'name'],
  delivery_contacts: ['phone', 'address', 'name'],
  suppliers: ['phone', 'email', 'address', 'contact_person'],
  users: ['phone', 'email', 'google_email'],
  portal_accounts: ['phone', 'email'],
  verification_codes: ['target', 'requester_ip'],
  user_sessions: ['last_ip', 'device_name'],
  portal_sessions: ['last_ip'],
  trusted_devices: ['first_ip', 'last_ip', 'device_name'],
  login_lockouts: ['username'],
  sales: ['customer_name', 'customer_phone', 'customer_address', 'cashier_name', 'delivery_contact_phone'],
  returns: ['customer_name', 'cashier_name'],
  sale_record_events: ['actor_username'],
  sale_incident_recovery_receipts: ['actor_name'],
}
const REQUIRED_SECRET = {
  users: ['password', 'otp_secret'],
  portal_accounts: ['password_hash'],
  verification_codes: ['code_hash'],
  user_sessions: ['token_hash'],
  portal_sessions: ['token_hash'],
  portal_password_resets: ['token_hash'],
}
check('column map covers every column the brief names', () => {
  for (const [t, cols] of Object.entries(REQUIRED_PII)) for (const c of cols) assert.ok(PII_COLUMNS[t]?.includes(c), `${t}.${c} not in PII_COLUMNS`)
  for (const [t, cols] of Object.entries(REQUIRED_SECRET)) for (const c of cols) assert.ok(SECRET_COLUMNS[t]?.includes(c), `${t}.${c} not in SECRET_COLUMNS`)
})
// Mapped columns the name-based classifier cannot infer (free text, lockout
// keys, bare names). Pinned so removing one is a deliberate, reviewed change.
const MAPPED_BEYOND_CLASSIFIER = [
  'contact_duplicate_dismissals.cluster_value', 'customer_share_submissions.note',
  'customers.company', 'customers.name', 'customers.notes', 'delivery_contacts.name', 'delivery_contacts.notes',
  'legacy_deleted_sale_items.deleted_by', 'portal_accounts.name', 'portal_auth_lockouts.key',
  'rate_limit_events.client_key', 'returns.notes', 'sales.notes', 'suppliers.notes', 'users.name',
  'verification_codes.target',
]
check('mapped columns beyond the classifier are exactly the reviewed set', () => {
  const actual = []
  for (const [t, cols] of Object.entries(PII_COLUMNS)) for (const c of cols) if (!classifyKey(c)) actual.push(`${t}.${c}`)
  assert.deepEqual(actual.sort(), [...MAPPED_BEYOND_CLASSIFIER].sort())
})
check('column map is complete for the migrated schema (classifier sweep) and has no stale entries', () => {
  const unmapped = []
  for (const [t, cols] of Object.entries(SCHEMA)) {
    if (t.includes('_fts')) continue
    for (const c of cols) {
      if (!classifyKey(c)) continue
      if (PII_COLUMNS[t]?.includes(c) || SECRET_COLUMNS[t]?.includes(c) || REVIEWED_NOT_PII[`${t}.${c}`]) continue
      unmapped.push(`${t}.${c}`)
    }
  }
  assert.deepEqual(unmapped, [], `person/secret-looking columns missing from the map: ${unmapped.join(', ')}`)
  for (const map of [PII_COLUMNS, SECRET_COLUMNS]) {
    for (const [t, cols] of Object.entries(map)) for (const c of cols) assert.ok(SCHEMA[t]?.includes(c), `mapped ${t}.${c} is not in the migrated schema`)
  }
})

function sampleRow(table, cols) {
  const row = { id: 7 }
  for (const c of cols) row[c] = `real-${table}-${c}`
  return row
}
check('default mode masks EVERY mapped PII column and drops EVERY secret column', () => {
  const r = createRedactor({ salt: 'unit-salt' })
  assert.equal(r.mode, 'redacted')
  const tables = new Set([...Object.keys(PII_COLUMNS), ...Object.keys(SECRET_COLUMNS)])
  for (const t of tables) {
    const row = sampleRow(t, [...(PII_COLUMNS[t] || []), ...(SECRET_COLUMNS[t] || [])])
    const out = r.redactRow(t, row, { ordinal: 1 })
    assert.equal(out.id, 7, `${t}.id must be untouched`)
    for (const c of PII_COLUMNS[t] || []) {
      assert.match(String(out[c]), /^pii_[0-9a-f]{20}$/, `${t}.${c} not masked: ${out[c]}`)
    }
    for (const c of SECRET_COLUMNS[t] || []) assert.equal(out[c], '[dropped]#1', `${t}.${c} not dropped`)
    assert.ok(!JSON.stringify(out).includes('real-'), `${t}: a real value survived: ${JSON.stringify(out)}`)
  }
})
check('masking is stable within a run, so joins across tables still line up', () => {
  const r = createRedactor({ salt: 'unit-salt' })
  const customer = r.redactRow('customers', { id: 1, name: 'Sok Dara', phone: '012345678' })
  const sale = r.redactRow('sales', { id: 9, customer_id: 1, customer_name: 'Sok Dara', customer_phone: '012345678', cashier_name: 'Chan Vuthy' })
  const user = r.redactRow('users', { id: 3, username: 'vuthy', name: 'Chan Vuthy' })
  const event = r.redactRow('sale_record_events', { id: 'e1', actor_username: 'vuthy' })
  assert.equal(sale.customer_name, customer.name)
  assert.equal(sale.customer_phone, customer.phone)
  assert.equal(sale.cashier_name, user.name)
  assert.equal(event.actor_username, user.username)
  assert.notEqual(customer.name, customer.phone)
  assert.equal(sale.customer_id, 1)
})
check('masking uses the per-run salt: another salt gives other tokens; default salts are random', () => {
  const a = createRedactor({ salt: 'salt-a' }).mask('Sok Dara')
  const b = createRedactor({ salt: 'salt-b' }).mask('Sok Dara')
  assert.notEqual(a, b)
  assert.notEqual(createRedactor().mask('Sok Dara'), createRedactor().mask('Sok Dara'))
})
check('null and empty values stay null/empty (presence is not invented)', () => {
  const out = createRedactor({ salt: 's' }).redactRow('customers', { id: 1, name: 'x', phone: null, email: '' })
  assert.equal(out.phone, null)
  assert.equal(out.email, '')
  const sec = createRedactor({ salt: 's' }).redactRow('users', { id: 1, otp_secret: null, password: 'h' }, { ordinal: 4 })
  assert.equal(sec.otp_secret, null)
  assert.equal(sec.password, '[dropped]#4')
})
check('--include-pii keeps names/phones but STILL drops every secret column', () => {
  const r = createRedactor({ includePii: true, salt: 's' })
  assert.equal(r.mode, 'included')
  for (const t of new Set([...Object.keys(PII_COLUMNS), ...Object.keys(SECRET_COLUMNS)])) {
    const row = sampleRow(t, [...(PII_COLUMNS[t] || []), ...(SECRET_COLUMNS[t] || [])])
    const out = r.redactRow(t, row, { ordinal: 2 })
    for (const c of PII_COLUMNS[t] || []) assert.equal(out[c], row[c], `${t}.${c} should be kept`)
    for (const c of SECRET_COLUMNS[t] || []) assert.equal(out[c], '[dropped]#2', `${t}.${c} must be dropped even with --include-pii`)
  }
})
check('secret settings rows are dropped in both modes; ordinary settings are untouched', () => {
  for (const includePii of [false, true]) {
    const r = createRedactor({ includePii, salt: 's' })
    assert.equal(r.redactRow('settings', { key: 'drive_sync_refresh_token', value: '1//tok' }, { ordinal: 1 }).value, '[dropped]#1')
    assert.equal(r.redactRow('settings', { key: 'drive_sync_access_token', value: 'ya29' }, { ordinal: 2 }).value, '[dropped]#2')
    assert.equal(r.redactRow('settings', { key: 'exchange_rate', value: '4100' }).value, '4100')
  }
  assert.match(createRedactor({ salt: 's' }).redactRow('settings', { key: 'pos_address_presets_v1', value: '["St 271"]' }).value, /^pii_/)
})
check('JSON payload columns: person keys masked, secret keys dropped, product JSON byte-identical', () => {
  const r = createRedactor({ salt: 's' })
  const customerJson = JSON.stringify({ id: 1, name: 'Sok Dara', phone: '012345678', notes: 'gate 3', password_hash: 'abc', nested: { customer_phone: '099' }, phones: ['011', '012'] })
  const out = JSON.parse(r.redactRow('audit_logs', { id: 1, new_value: customerJson }).new_value)
  assert.equal(out.id, 1)
  assert.equal(out.name, r.mask('Sok Dara'))
  assert.equal(out.phone, r.mask('012345678'))
  assert.equal(out.notes, r.mask('gate 3'))
  assert.equal(out.password_hash, '[dropped]')
  assert.equal(out.nested.customer_phone, r.mask('099'))
  assert.deepEqual(out.phones, [r.mask('011'), r.mask('012')])
  const productJson = '{"name":"Soap 100g","barcode":"8850001","price_usd": 1.50}'
  assert.equal(r.redactRow('audit_logs', { id: 2, new_value: productJson }).new_value, productJson)
  const kept = JSON.parse(createRedactor({ includePii: true, salt: 's' }).redactRow('undo_snapshots', { id: 3, payload_json: customerJson }).payload_json)
  assert.equal(kept.name, 'Sok Dara')
  assert.equal(kept.password_hash, '[dropped]')
})
check('fallback: an unmapped (production-only) table still gets name-classified redaction', () => {
  const r = createRedactor({ salt: 's' })
  const out = r.redactRow('latest_data_source_links', { id: 1, customer_phone: '012', otp_secret: 'x', run_id: 'r1' }, { ordinal: 1 })
  assert.equal(out.customer_phone, r.mask('012'))
  assert.equal(out.otp_secret, '[dropped]#1')
  assert.equal(out.run_id, 'r1')
  assert.ok(r.stats.fallback['latest_data_source_links.customer_phone'])
})

// ===========================================================================
// End to end: real main() against the local migrated DB via a fake runner
// ===========================================================================
function seed(db) {
  db.exec('PRAGMA foreign_keys = OFF')
  const run = (sql, ...args) => db.prepare(sql).run(...args)
  run("INSERT INTO customers (id, name, phone, email, address) VALUES (1, 'Sok Dara', '012345678', 'dara@example.com', 'St 271 Phnom Penh')")
  run("INSERT INTO customers (id, name, phone) VALUES (2, 'Keo Mealea', '098765432')")
  run("INSERT INTO users (id, username, name, password, otp_secret, phone, email) VALUES (5, 'vuthy', 'Chan Vuthy', 'pbkdf2$secret-hash', 'JBSWY3DPEHPK3PXP', '077111222', 'vuthy@example.com')")
  run("INSERT INTO user_sessions (id, user_id, token_hash, device_name, last_ip, expires_at) VALUES (11, 5, 'tokhash-aaaa', 'Vuthy iPhone', '203.0.113.9', '2026-12-31T00:00:00Z')")
  run("INSERT INTO settings (key, value) VALUES ('drive_sync_refresh_token', '1//refresh-secret'), ('exchange_rate', '4100')")
  run("INSERT INTO audit_logs (id, user_name, action, entity, new_value) VALUES (1, 'Chan Vuthy', 'update', 'customer', ?)",
    JSON.stringify({ name: 'Sok Dara', phone: '012345678' }))
}
function fakeProduction() {
  const db = migratedDb()
  seed(db)
  const seen = []
  const runner = (sql) => {
    seen.push(sql)
    return db.prepare(sql).all().map((r) => ({ ...r }))
  }
  return { db, runner, seen }
}
const REAL_VALUES = ['Sok Dara', '012345678', 'dara@example.com', 'St 271 Phnom Penh', 'Chan Vuthy', 'vuthy@example.com', '203.0.113.9', 'Vuthy iPhone']
const SECRET_VALUES = ['pbkdf2$secret-hash', 'JBSWY3DPEHPK3PXP', 'tokhash-aaaa', '1//refresh-secret']
function allOutputBytes(dir) {
  return fs.readdirSync(dir).map((n) => fs.readFileSync(path.join(dir, n)))
}
function containsAnywhere(buffers, needle) {
  return buffers.some((b) => b.indexOf(Buffer.from(needle, 'utf8')) !== -1)
}

check('end-to-end default run: jsonl AND snapshot.sqlite are redacted, salt never written, manifest pii=redacted', () => {
  const { runner, seen } = fakeProduction()
  const outDir = path.join(TMP_ROOT, 'd1-snapshot-redacted')
  const salt = Buffer.from('e2e-salt-must-not-leak-0123456789abcdef')
  const code = main([outDir], { runner, wranglerVersion: 'test', salt, log: quietLog() })
  assert.equal(code, 0)
  for (const sql of seen) assertSelect(sql)
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.pii, 'redacted')
  const bytes = allOutputBytes(outDir)
  for (const v of [...REAL_VALUES, ...SECRET_VALUES]) assert.ok(!containsAnywhere(bytes, v), `output leaked ${v}`)
  for (const enc of [salt.toString('utf8'), salt.toString('hex'), salt.toString('base64')]) assert.ok(!containsAnywhere(bytes, enc), 'salt leaked')
  const snap = new DatabaseSync(path.join(outDir, 'snapshot.sqlite'), { readOnly: true })
  const cust = snap.prepare('SELECT name, phone FROM customers WHERE id = 1').get()
  assert.equal(cust.name, createRedactor({ salt }).mask('Sok Dara'), 'sqlite value equals the same-salt token')
  assert.equal(cust.phone, createRedactor({ salt }).mask('012345678'))
  assert.equal(snap.prepare('SELECT user_name FROM audit_logs WHERE id = 1').get().user_name, snap.prepare('SELECT name FROM users WHERE id = 5').get().name)
  assert.equal(snap.prepare('SELECT password FROM users WHERE id = 5').get().password, '[dropped]#1')
  assert.equal(snap.prepare("SELECT value FROM settings WHERE key = 'exchange_rate'").get().value, '4100')
  snap.close()
  assert.ok(fs.readFileSync(path.join(outDir, 'SHA256SUMS'), 'utf8').includes('snapshot.sqlite'))
})
check('end-to-end --include-pii run: names kept, secrets still absent, manifest pii=included, loud warning', () => {
  const { runner } = fakeProduction()
  const outDir = path.join(TMP_ROOT, 'd1-snapshot-included')
  const log = quietLog()
  const code = main(['--include-pii', outDir], { runner, wranglerVersion: 'test', log })
  assert.equal(code, 0)
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).pii, 'included')
  assert.ok(log.lines.some((l) => /--include-pii: REAL customer/.test(l)), 'missing loud warning')
  const bytes = allOutputBytes(outDir)
  assert.ok(containsAnywhere(bytes, 'Sok Dara'))
  for (const v of SECRET_VALUES) assert.ok(!containsAnywhere(bytes, v), `include-pii output leaked secret ${v}`)
})

// snapshot.sqlite is made read-only by the tool; make it writable so cleanup works on Windows too.
for (const dir of ['d1-snapshot-redacted', 'd1-snapshot-included']) {
  const f = path.join(TMP_ROOT, dir, 'snapshot.sqlite')
  if (fs.existsSync(f)) fs.chmodSync(f, 0o644)
}
fs.rmSync(TMP_ROOT, { recursive: true, force: true })
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED, ${passes} passed`)
  process.exit(1)
}
console.log(`\nAll ${passes} snapshot-d1-readonly tests passed.`)
