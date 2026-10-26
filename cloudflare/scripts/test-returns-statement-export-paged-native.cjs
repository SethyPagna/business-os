'use strict'
// RETURNS-ENDPOINT / STATEMENT-EXPORTS (26 Oct 2026): GET /api/returns/export reads the COMPLETE Returns statement of a bounded period in cursor pages.
// The real Hono route over the fully migrated SQLite schema. Proves: an export over the list cap (1000) is complete, the order is stable (entry time, then
// id, both descending, ties included), each request is bounded for Free, the snapshot token refuses a page read after the data moved, and the
// permissions hold (returns:export, returns view, maintenance).
// MUTANT=<name> bundles ONE deliberate defect (the harness patches the source before it is loaded).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const FILE = 'routes/returns.ts'
const MUTANTS = {
  // The keyset forgets the id tiebreak: rows that share a second are skipped at a page edge.
  'cursor-without-id-tiebreak': [{ from: "(${RETURN_EXPORT_SORT_AT}, r.id) < (@cursorAt, @cursorId)", to: "(${RETURN_EXPORT_SORT_AT}) < (@cursorAt)" }],
  // The page seeks from the top of the period instead of the cursor: every page re-reads what the earlier pages served.
  'cursor-bound-ignored': [{ from: "cursor ? buildFilter('<= @cursorAt') : filter", to: 'filter' }],
  // The page ignores the Free bound.
  'free-bound-ignored': [{ from: 'getPlanLimits(c.env).d1QueriesPerInvocation < 200 ? RETURN_EXPORT_PAGE_MAX_FREE : RETURN_EXPORT_PAGE_MAX', to: 'RETURN_EXPORT_PAGE_MAX' }],
  // A page is served under a token that no longer matches.
  'stale-token-served': [{ from: 'if (presented && presented !== snapshotToken) {', to: 'if (false) {' }],
  // The export action is not checked.
  'export-permission-missing': [{ from: "if (getActionTier(user, 'returns', 'export') !== 'full')", to: 'if (false)' }],
  // The order loses its tiebreak.
  'order-without-id': [{ from: 'ORDER BY ${RETURN_EXPORT_SORT_AT} DESC, r.id DESC LIMIT @pageLimit', to: 'ORDER BY ${RETURN_EXPORT_SORT_AT} DESC LIMIT @pageLimit' }],
}
if (process.env.MUTANT && !MUTANTS[process.env.MUTANT]) throw new Error(`unknown MUTANT ${process.env.MUTANT}; known: ${Object.keys(MUTANTS).join(', ')}`)
const patches = process.env.MUTANT ? MUTANTS[process.env.MUTANT] : []

let currentUser
const overrides = {
  '../lib/db': { getDb: env => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
  '../lib/audit': { audit: async () => {}, changedFields: () => [] },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0, cachedJsonResponse: async (_r, _c, _k, _t, loader) => loader() },
  '../lib/telegram': new Proxy({}, { get: (_t, name) => name === '__esModule' ? false : async () => [] }),
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  let source = fs.readFileSync(sourcePath, 'utf8')
  if (rel === FILE) {
    for (const patch of patches) {
      assert.ok(source.includes(patch.from), `mutant anchor present: ${patch.from}`)
      source = source.replace(patch.from, patch.to)
    }
  }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const app = load(FILE).default
const plan = load('lib/planTier.ts')

const ADMIN = { id: 1, username: 'admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const exporter = { id: 2, username: 'exporter', role_code: 'employee', permissions: JSON.stringify({ returns: true, 'returns:export': true }) }
const staff = { id: 3, username: 'staff', role_code: 'employee', permissions: JSON.stringify({ returns: true, 'returns:export': false }) }
const noView = { id: 4, username: 'noview', role_code: 'employee', permissions: JSON.stringify({ returns: true, 'returns:export': true, 'returns:view': false }) }
const reviewTier = { id: 6, username: 'review', role_code: 'employee', permissions: JSON.stringify({ returns: 'review' }) }
const noReturns = { id: 5, username: 'noreturns', role_code: 'employee', permissions: JSON.stringify({ sales: true }) }

function newDb() {
  const db = openDb(loadAll())
  db.db.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
  return db
}
// Day 2026-09-20 (Cambodia) runs 2026-09-19 17:00:00 .. 2026-09-20 16:59:59 UTC.
const DAY = { startDate: '2026-09-20', endDate: '2026-09-20' }
function seed(db, count, { scope = 'customer', startId = 1, clusters = 40 } = {}) {
  const insert = db.db.prepare(`INSERT INTO returns(id,return_number,return_scope,status,return_type,reason,created_at,updated_at,customer_name)
    VALUES(@id,@number,@scope,'completed','refund',@reason,@at,@at,'Walk-in')`)
  db.db.exec('BEGIN')
  for (let i = 0; i < count; i++) {
    const id = startId + i
    // Many rows share a second (ties); both stored shapes of the timestamp are mixed on purpose.
    const second = Math.floor(i / clusters) % 60
    const minute = Math.floor(i / (clusters * 60)) % 60
    const stamp = `2026-09-20 0${i % 7 === 0 ? 3 : 4}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    const at = id % 5 === 0 ? stamp.replace(' ', 'T') + 'Z' : stamp
    insert.run({ id, number: `RET-${id}`, scope, reason: id % 3 === 0 ? 'cracked bottle' : 'wrong shade', at })
  }
  db.db.exec('COMMIT')
}
async function get(db, user, qs, env = {}) {
  currentUser = user
  plan.__resetPlanTierCacheForTests()
  const response = await app.request(`/export?${new URLSearchParams(qs)}`, { method: 'GET' }, { PLAN_TIER: 'free', ...env, DB: db }, { waitUntil() {} })
  const text = await response.text()
  let body; try { body = JSON.parse(text) } catch { body = { error: text } }
  return { status: response.status, body }
}
async function walk(db, user, qs, env) {
  const pages = []
  let cursor = null, token = null, total = null
  do {
    const r = await get(db, user, { ...DAY, ...qs, ...(cursor ? { cursor, total } : {}), ...(token ? { snapshotToken: token } : {}) }, env)
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300))
    pages.push(r.body); token = r.body.snapshotToken; total = r.body.total; cursor = r.body.nextCursor
  } while (cursor)
  return pages
}
const expectedOrder = (db, extra = '') => db.db.prepare(`SELECT id FROM returns WHERE ((created_at>='2026-09-19 17:00:00' AND created_at<'2026-09-20 17:00:00') OR (created_at>='2026-09-19T17:00:00' AND created_at<'2026-09-20T17:00:00'))
  AND COALESCE(return_scope,'customer')='customer' ${extra} ORDER BY created_at DESC, id DESC`).all().map(row => row.id)

const cases = [
  ['complete-over-the-list-cap-and-stable-order', async () => {
    const db = newDb(); seed(db, 1203)
    const list = await (async () => { currentUser = ADMIN; const r = await app.request(`/?${new URLSearchParams({ ...DAY, limit: '5000' })}`, { method: 'GET' }, { PLAN_TIER: 'free', DB: db }, { waitUntil() {} }); return r.json() })()
    assert.equal(list.length, 1000, 'the list stops at its cap -- the reason the export exists')
    const pages = await walk(db, exporter, { limit: '500' })
    const ids = pages.flatMap(page => page.rows.map(row => row.id))
    assert.equal(ids.length, 1203)
    assert.deepEqual(ids, expectedOrder(db), 'every row once, in entry-time-then-id descending order (ties included)')
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(pages.every(page => page.total === 1203 && page.rows.length <= 250), 'Free: at most 250 rows per request even though 500 was asked')
    assert.equal(pages.length, 5)
    assert.ok(pages.every(page => !('export_sort_at' in page.rows[0])), 'the internal sort key is not leaked')
    assert.equal(new Set(pages.map(page => page.snapshotToken)).size, 1)
    const again = (await walk(db, exporter, { limit: '500' })).flatMap(page => page.rows.map(row => row.id))
    assert.deepEqual(again, ids, 'the same statement reads in the same order every time')
    db.db.close()
  }],
  ['paid-plan-pages-are-larger', async () => {
    const db = newDb(); seed(db, 620)
    const pages = await walk(db, exporter, { limit: '500' }, { PLAN_TIER: 'paid' })
    assert.deepEqual(pages.map(page => page.rows.length), [500, 120])
    db.db.close()
  }],
  ['filters-match-the-list', async () => {
    const db = newDb(); seed(db, 300)
    seed(db, 30, { scope: 'supplier', startId: 1001 })
    const pages = await walk(db, exporter, { search: 'cracked' })
    const ids = pages.flatMap(page => page.rows.map(row => row.id))
    currentUser = ADMIN
    const list = await (await app.request(`/?${new URLSearchParams({ ...DAY, search: 'cracked' })}`, { method: 'GET' }, { PLAN_TIER: 'free', DB: db }, { waitUntil() {} })).json()
    // The list orders by the raw stored text, the export by the instant (mixed stored shapes differ); the SET of rows is the shared filter's.
    assert.deepEqual(ids.slice().sort((a, b) => a - b), list.map(row => row.id).sort((a, b) => a - b), 'one filter, two surfaces')
    assert.equal(ids.length, 100)
    const supplier = (await walk(db, exporter, { scope: 'supplier' })).flatMap(page => page.rows.map(row => row.id))
    assert.equal(supplier.length, 30)
    assert.ok(supplier.every(id => id > 1000))
    const selected = (await walk(db, exporter, { ids: '3,5,7,1001,99999' })).flatMap(page => page.rows.map(row => row.id))
    assert.deepEqual(selected, expectedOrder(db, 'AND id IN (3,5,7,1001,99999)'), 'ids narrow within scope and window')
    assert.deepEqual(selected.slice().sort((a, b) => a - b), [3, 5, 7])
    db.db.close()
  }],
  ['window-is-required-and-bounded', async () => {
    const db = newDb(); seed(db, 5)
    for (const qs of [{}, { startDate: '2026-09-20' }, { startDate: '2026-09-21', endDate: '2026-09-20' }, { startDate: '2025-01-01', endDate: '2026-09-20' }, { startDate: 'x', endDate: 'y' }]) {
      const r = await get(db, exporter, qs)
      assert.equal(r.status, 400, JSON.stringify(qs)); assert.equal(r.body.code, 'return_export_range_invalid')
    }
    assert.equal((await get(db, exporter, { ...DAY, cursor: '!!!' })).body.code, 'return_export_cursor_invalid')
    assert.equal((await get(db, exporter, { ...DAY, cursor: Buffer.from('["x",1]').toString('base64url') })).status, 400)
    for (const ids of ['0', 'a', '1,,2', '-1']) assert.equal((await get(db, exporter, { ...DAY, ids })).body.code, 'return_export_ids_invalid', ids)
    assert.equal((await get(db, exporter, { ...DAY, ids: Array.from({ length: 1001 }, (_, i) => i + 1).join(',') })).status, 400)
    db.db.close()
  }],
  ['over-the-statement-bound-is-refused-not-truncated', async () => {
    const db = newDb(); seed(db, 20001, { clusters: 400 })
    const r = await get(db, exporter, DAY)
    assert.equal(r.status, 400); assert.equal(r.body.code, 'return_export_too_large'); assert.equal(r.body.total, 20001)
    assert.equal(r.body.rows, undefined)
    db.db.close()
  }],
  ['snapshot-token-refuses-a-moved-statement', async () => {
    const db = newDb(); seed(db, 600)
    const first = await get(db, exporter, DAY)
    assert.equal(first.status, 200)
    const verify = await get(db, exporter, { ...DAY, snapshotToken: first.body.snapshotToken, verify: '1' })
    assert.equal(verify.status, 200); assert.deepEqual(verify.body.rows, []); assert.equal(verify.body.nextCursor, null); assert.equal(verify.body.snapshotToken, first.body.snapshotToken)
    for (const [label, change] of [
      ['a return is added', "INSERT INTO returns(id,return_number,return_scope,status,created_at,updated_at) VALUES(9001,'RET-9001','customer','completed','2026-09-20 05:00:00','2026-09-20 05:00:00')"],
      ['a return is cancelled', "UPDATE returns SET status='cancelled' WHERE id=7"],
      ['a line of a return changes', "INSERT INTO return_items(return_id,product_name,quantity) VALUES(8,'Late line',1)"],
      ['a return leaves the period', "UPDATE returns SET created_at='2026-09-25 05:00:00' WHERE id=9"],
    ]) {
      const copy = newDb(); seed(copy, 600)
      const a = await get(copy, exporter, DAY)
      copy.db.exec(change)
      // The first page under the old token is refused, and so is the final verify the client runs before it publishes a file.
      const again = await get(copy, exporter, { ...DAY, snapshotToken: a.body.snapshotToken })
      assert.equal(again.status, 409, label); assert.equal(again.body.code, 'return_statement_changed', label)
      const check = await get(copy, exporter, { ...DAY, snapshotToken: a.body.snapshotToken, verify: '1' })
      assert.equal(check.status, 409, `${label}: verify refuses too`)
      copy.db.close()
    }
    db.db.close()
  }],
  ['later-pages-are-shape-checked-and-echo-the-token', async () => {
    const db = newDb(); seed(db, 600)
    const first = await get(db, exporter, DAY)
    const next = await get(db, exporter, { ...DAY, cursor: first.body.nextCursor, snapshotToken: first.body.snapshotToken, total: first.body.total })
    assert.equal(next.status, 200); assert.equal(next.body.snapshotToken, first.body.snapshotToken); assert.equal(next.body.total, first.body.total)
    for (const bad of [{}, { snapshotToken: 'x', total: '600' }, { snapshotToken: first.body.snapshotToken }, { snapshotToken: first.body.snapshotToken, total: '-1' }, { snapshotToken: first.body.snapshotToken, total: '20001' }]) {
      const r = await get(db, exporter, { ...DAY, cursor: first.body.nextCursor, ...bad })
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.code, 'return_export_cursor_invalid')
    }
    db.db.close()
  }],
  ['pages-seek-the-created-at-index-and-read-about-a-page', async () => {
    // A long history OUTSIDE the period (3 years of other returns) plus the period itself: a page must read about its own size, not the history.
    const db = newDb(); seed(db, 1203)
    db.db.exec('BEGIN')
    const old = db.db.prepare("INSERT INTO returns(id,return_number,return_scope,status,return_type,reason,created_at,updated_at) VALUES(@id,@n,'customer','completed','refund','old',@at,@at)")
    for (let i = 0; i < 30000; i++) old.run({ id: 100000 + i, n: 'OLD-' + i, at: '2023-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0') + ' 05:' + String(i % 60).padStart(2, '0') + ':00' })
    // Decoys the exact window must reject but the index range still passes over: ISO-shaped rows early on the first day, space-shaped rows late on the last day.
    for (const [i, at] of ['2026-09-19T03:00:00Z', '2026-09-19T04:00:00Z', '2026-09-20 18:00:00', '2026-09-20 19:00:00'].entries()) {
      old.run({ id: 200000 + i, n: 'DECOY-' + i, at })
    }
    db.db.exec('COMMIT')
    let probes = 0
    db.db.function('probe', { varargs: true }, () => { probes++; return 1 })
    const seen = []
    const instrumented = new Proxy(db, { get(target, prop) {
      if (prop !== 'prepare') return Reflect.get(target, prop)
      return sql => {
        const isPage = /ORDER BY r\.created_at DESC, r\.id DESC LIMIT/.test(sql)
        const text = isPage ? sql.replace(/FROM returns r\s+LEFT JOIN sales replacement_sale[\s\S]*?WHERE /, match => match + 'probe(r.id)=1 AND ') : sql
        const stmt = target.prepare(text)
        const wrap = method => params => { seen.push({ sql: text, params, page: isPage }); return stmt[method](params) }
        return { all: wrap('all'), get: wrap('get'), run: params => stmt.run(params), bind: p => stmt.bind(p) }
      }
    } })
    for (const qs of [{}, { scope: 'all' }]) {
      probes = 0; seen.length = 0
      const perPage = []
      let cursor = null, token = null, total = null, ids = []
      do {
        const before = probes
        const r = await get(instrumented, exporter, { ...DAY, ...qs, ...(cursor ? { cursor, total, snapshotToken: token } : {}) })
        assert.equal(r.status, 200)
        perPage.push(probes - before); ids = ids.concat(r.body.rows.map(row => row.id))
        token = r.body.snapshotToken; total = r.body.total; cursor = r.body.nextCursor
      } while (cursor)
      assert.ok(ids.length >= 1203 && new Set(ids).size === ids.length, 'the statement is still complete')
      assert.ok(perPage.every(n => n <= 251 + 44), "rows read per page: " + perPage.join(",") + " (page size 250, plus rows sharing the cursor instant (40 in this fixture) and 4 decoys inside the index range) -- not the 31000-row history")
      for (const entry of seen.filter(entry => entry.page || /COUNT\(\*\) AS total/.test(entry.sql))) {
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + entry.sql).all(entry.params || {}).map(row => row.detail).join(' | ')
        assert.match(plan, /SEARCH r USING (COVERING )?INDEX idx_returns_(scope_)?created_pg/, 'the created_at index drives the read: ' + plan)
        assert.doesNotMatch(plan, /TEMP B-TREE/, 'no sort of the history: ' + plan)
        assert.doesNotMatch(plan, /SCAN r\b/, 'no table scan: ' + plan)
      }
    }
    db.db.close()
  }],
  ['permissions-are-enforced', async () => {
    const db = newDb(); seed(db, 10)
    assert.equal((await get(db, ADMIN, DAY)).status, 200)
    assert.equal((await get(db, exporter, DAY)).status, 200)
    for (const [label, user] of [['returns:export switched off', staff], ['returns view revoked', noView], ['Review Required tier (the editor blocks Review for the export action)', reviewTier], ['no returns permission', noReturns]]) {
      const r = await get(db, user, DAY)
      assert.equal(r.status, 403, label); assert.equal(r.body.rows, undefined, `${label}: no rows leak`)
    }
    seedStockFixture(db.db, () => db.db.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')"))
    const m = await get(db, exporter, DAY)
    assert.equal(m.status, 503); assert.equal(m.body.code, 'return_export_maintenance')
    db.db.close()
  }],
]

async function main() {
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length)
  if (selected) assert.ok(cases.some(([name]) => name === selected), `Unknown case: ${selected}`)
  let passed = 0
  for (const [name, run] of cases) {
    if (selected && selected !== name) continue
    await run(); passed++; console.log(`PASS ${name}`)
  }
  console.log(`PASS returns statement export paged: ${passed}/${selected ? 1 : cases.length} cases (real route, migrated SQLite${process.env.MUTANT ? `, MUTANT=${process.env.MUTANT}` : ''})`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
