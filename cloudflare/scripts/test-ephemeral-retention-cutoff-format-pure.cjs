// Retention cutoffs must match each column's stored timestamp shape.
// ai_response_logs.created_at is written with toISOString() ('...T..:..:...Z',
// routes/portal.ts) but older / defaulted rows use CURRENT_TIMESTAMP ('... ..'),
// so a single space-shaped cutoff kept ISO rows of the cutoff day ~1 day too long.
// Runs the real sweep (lib/ephemeralRetention.ts) on in-memory SQLite with every
// real migration; rows sit 1h either side of each TTL boundary.
// Run (from cloudflare/): node scripts/test-ephemeral-retention-cutoff-format-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')
const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
const rawDb = openDb(migrations)
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p) || [],
      run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => rawDb.batch(items),
}

const cache = new Map()
const overrides = new Map([[path.normalize(path.join(SRC, 'lib/db.ts')), { getDb: () => db }]])
function resolveTs(base) {
  for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return base
}
function load(file) {
  const key = path.normalize(file)
  if (overrides.has(key)) return overrides.get(key)
  if (cache.has(key)) return cache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key,
  })
  const mod = { exports: {} }
  cache.set(key, mod.exports)
  const req = Module.createRequire(key)
  new Function('exports', 'require', 'module', outputText)(mod.exports,
    (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
  cache.set(key, mod.exports)
  return mod.exports
}
const retention = load(path.join(SRC, 'lib/ephemeralRetention.ts'))

const NOW = Date.parse('2026-10-20T10:30:15.250Z')
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const space = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const iso = (ms) => new Date(ms).toISOString()
const at = (days, deltaMs) => NOW - days * DAY + deltaMs // deltaMs > 0: newer than the cutoff

const bucket = { async delete() {}, async put() {}, async get() { return null }, async list() { return { objects: [], truncated: false } } }
const env = { ASSETS: bucket }

const real = Date.now
Date.now = () => NOW
let passed = 0
async function run() {
  // ai_response_logs: both shapes, 1h inside and 1h outside 30d; plus a 1-minute-late row on the cutoff day.
  const ins = (stamp, tag) => rawDb.prepare('INSERT INTO ai_response_logs (surface, question_text, created_at) VALUES (?, ?, ?)').run(['portal', tag, stamp])
  ins(iso(at(30, HOUR)), 'iso-keep'); ins(iso(at(30, -HOUR)), 'iso-del')
  ins(space(at(30, HOUR)), 'space-keep'); ins(space(at(30, -HOUR)), 'space-del')
  ins(iso(at(30, 60_000)), 'iso-1min-keep'); ins(iso(at(30, -60_000)), 'iso-1min-del')
  ins(space(at(30, 60_000)), 'space-1min-keep'); ins(space(at(30, -60_000)), 'space-1min-del')
  ins(iso(at(31, 0)), 'iso-day-before-del'); ins(iso(at(29, 0)), 'iso-day-after-keep')
  ins(space(at(31, 0)), 'space-day-before-del'); ins(space(at(29, 0)), 'space-day-after-keep')

  // Space-shaped columns, 1h either side of each TTL.
  const one = (sql, ...a) => rawDb.prepare(sql).run(a)
  for (const [tag, d] of [['keep', HOUR], ['del', -HOUR]]) {
    one('INSERT INTO rate_limit_events (bucket, client_key, created_at) VALUES (?, ?, ?)', 'b', `rl-${tag}`, space(at(1, d)))
    one("INSERT INTO trusted_devices (user_id, device_id, status, revoked_at) VALUES (1, ?, 'rejected', ?)", `td-${tag}`, space(at(30, d)))
    one("INSERT INTO action_history (scope, label, undo_payload, redo_payload, created_at) VALUES ('global', ?, '{}', '{}', ?)", `ah-${tag}`, space(at(180, d)))
    one("INSERT INTO login_lockouts (username, failed_count, locked_until, updated_at) VALUES (?, 1, NULL, ?)", `ll-${tag}`, space(at(1, d)))
    one("INSERT INTO portal_auth_lockouts (scope, key, failed_count, locked_until, updated_at) VALUES ('s', ?, 1, NULL, ?)", `pl-${tag}`, space(at(1, d)))
    one("INSERT INTO customer_share_submissions (customer_name, screenshots_json, status, reviewed_at, created_at) VALUES (?, '[\"x\"]', 'approved', ?, ?)", `rv-${tag}`, space(at(90, d)), space(at(200, 0)))
    one("INSERT INTO customer_share_submissions (customer_name, screenshots_json, status, reviewed_at, created_at) VALUES (?, '[]', 'pending', NULL, ?)", `un-${tag}`, space(at(180, d)))
  }

  const result = await retention.maybeRunScheduledEphemeralRetention(env)
  assert.strictEqual(result.skipped, false)
  const left = (sql) => rawDb.prepare(sql).all().map((r) => Object.values(r)[0]).sort()
  const same = (actual, expected, label) => { assert.deepStrictEqual(actual, expected.sort(), label); passed += 1 }

  same(left('SELECT question_text FROM ai_response_logs'),
    ['iso-keep', 'space-keep', 'iso-1min-keep', 'space-1min-keep', 'iso-day-after-keep', 'space-day-after-keep'], 'ai_response_logs: both shapes deleted at 30d+, kept at 30d-')
  same(left("SELECT client_key FROM rate_limit_events WHERE bucket='b'"), ['rl-keep'], 'rate_limit_events')
  same(left('SELECT device_id FROM trusted_devices'), ['td-keep'], 'trusted_devices')
  same(left("SELECT label FROM action_history WHERE label LIKE 'ah-%'"), ['ah-keep'], 'action_history')
  same(left('SELECT username FROM login_lockouts'), ['ll-keep'], 'login_lockouts')
  same(left('SELECT key FROM portal_auth_lockouts'), ['pl-keep'], 'portal_auth_lockouts')
  same(left("SELECT customer_name FROM customer_share_submissions WHERE customer_name LIKE 'un-%'"), ['un-keep'], 'unreviewed submissions')
  same(left("SELECT customer_name FROM customer_share_submissions WHERE customer_name LIKE 'rv-%' AND screenshots_json <> '[]'"), ['rv-keep'], 'reviewed submission images')
  console.log(`ALL ${passed} CHECKS PASSED`)
}
run().then(() => { Date.now = real }, (e) => { Date.now = real; console.error(e); process.exit(1) })
