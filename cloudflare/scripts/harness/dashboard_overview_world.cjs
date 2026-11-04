'use strict'
// Shared world of the Dashboard stock overview tests (test-dashboard-stock-overview-pure.cjs, test-dashboard-overview-5m-pure.cjs):
// the real lib modules loaded by hand over the real migration chain in memory SQLite (harness/d1compat.cjs), a seeded catalogue,
// a fake clock and a fake Workers Cache API. `switchOn` is the stored state of read switch dash_overview_5m.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')

const SRC = path.join(__dirname, '../../src')
function load(rel, overrides = {}) {
  const filename = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name === './productStockGuard') return load('lib/productStockGuard.ts')
    if (name.startsWith('.')) throw new Error(`${rel}: unexpected dependency ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

// A D1Compat-shaped wrapper that records every statement.
function counting(db) {
  const log = []
  return {
    log,
    prepare(sql) {
      log.push(sql)
      const stmt = db.prepare(sql)
      return {
        all: async (params) => stmt.all(params),
        get: async (params) => stmt.get(params) ?? null,
        run: async (params) => { const r = stmt.run(params); return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) } },
      }
    },
    batch: (items) => db.batch(items),
  }
}

function modules(cdb, { planTier = load('lib/planTier.ts'), failCompute = null, switchOn = false } = {}) {
  const dbStub = { getDb: () => cdb }
  const familyPagination = load('lib/familyPagination.ts', { './db': dbStub })
  const lowStockSettings = load('lib/lowStockSettings.ts', { './db': dbStub })
  const familyStockStats = load('lib/familyStockStats.ts', { './familyPagination': familyPagination, './lowStockSettings': lowStockSettings })
  // 6.0.1048: the key carries the data epoch (lib/readSwitches.ts) and the deployment id (lib/cacheKey.ts); the real key module over a fixed epoch.
  // dash_overview_5m is the one switch the overview consults; `switchOn` is its stored state (a boolean, or a function a test flips).
  const readSwitches = { readDataEpoch: async () => 'e'.repeat(32), readSwitch: async (_env, name) => name === 'dash_overview_5m' && (typeof switchOn === 'function' ? switchOn() : switchOn) }
  const cacheKey = load('lib/cacheKey.ts', { './readSwitches': readSwitches })
  const cache = load('lib/cache.ts', { './db': dbStub, './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) }, './cacheKey': cacheKey })
  const overview = load('lib/dashboardStockOverview.ts', {
    './db': dbStub,
    './cache': cache,
    './cacheKey': cacheKey,
    './readSwitches': readSwitches,
    './businessDateWindow': load('lib/businessDateWindow.ts'),
    './familyStockStats': failCompute ? { ...familyStockStats, getFamilyStockOverview: failCompute } : familyStockStats,
    './lowStockSettings': lowStockSettings,
    './planTier': planTier,
  })
  return { familyStockStats, cache, overview, lowStockSettings }
}

// Deterministic PRNG so a failure reproduces.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function fixtureWrite(db, write) {
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  db.exec('BEGIN IMMEDIATE')
  let result
  try {
    const epoch=db.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get()
    if(epoch)db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    result=write()
    db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    db.exec('COMMIT')
  } catch(error) { db.exec('ROLLBACK');throw error }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  return result
}

function seedCatalog(db, seed) {
  return fixtureWrite(db,()=>{
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const names = Array.from({ length: 36 }, (_, i) => `Family ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}`)
  let id = 1
  const ins = db.prepare(`INSERT INTO products (id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold,
    cost_price_usd, cost_price_khr, is_active, is_group, parent_id) VALUES (@id, @name, @category, 'pcs', @qty, @low, @out, @usd, @khr, @active, @isGroup, @parent)`)
  const headers = new Map()
  for (const name of names.slice(0, 8)) {
    // Group headers (is_group=1, parent_id=0); the last two have no members.
    ins.run({ id, name, category: 'Hdr', qty: pick([0, 0, 5]), low: null, out: null, usd: 0, khr: 0, active: 1, isGroup: 1, parent: 0 })
    headers.set(name, id++)
  }
  for (let i = 0; i < 160; i++) {
    const name = pick(names.slice(0, 34)) // names 34/35 never get members
    const parent = headers.has(name) && !['Family G', 'Family H'].includes(name) && r() < 0.6 ? headers.get(name) : null
    const row = {
      id: id++, name, category: pick(['A', 'B', null]),
      qty: pick([-2, -1, 0, 0, 0, 1, 2, 3, 3, 5, 8, 9, 10, 11, 25]),
      low: pick([null, null, 3, 5, 10, 12]), out: pick([null, 0, 0, 1, 2]),
      usd: Math.round(r() * 1000) / 100, khr: Math.round(r() * 40000), active: r() < 0.93 ? 1 : 0, isGroup: 0, parent,
    }
    if (!row.active) row.qty = 0
    ins.run(row)
  }
  })
}

const LOW_CONFIGS = [
  { enabled: true, mode: 'product', threshold: 10 },
  { enabled: true, mode: 'global', threshold: 4 },
  { enabled: false, mode: 'product', threshold: 10 },
]

function cacheWorld(migrations, { tier = 'paid', switchOn = false } = {}) {
  const db = openDb(migrations)
  seedCatalog(db, 11)
  const cdb = counting(db)
  const kv = new Map()
  const env = { PLAN_TIER: tier, CACHE: { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v) }, delete: async (k) => { kv.delete(k) } } }
  const store = new Map()
  const maxAge = new Map()
  const cacheApi = {
    match: async (req) => store.has(req.url) ? new Response(store.get(req.url)) : undefined,
    put: async (req, res) => { store.set(req.url, await res.text()); maxAge.set(req.url, Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1])) },
  }
  let clock = Date.UTC(2026, 9, 5, 3, 0, 0)
  const waits = []
  const ctx = { requestUrl: 'https://admin.example.test/api/dashboard/startup?startDate=2026-10-05', waitUntil: (p) => waits.push(p), now: () => clock, cache: cacheApi }
  const isolate = (opts) => modules(cdb, { planTier: load('lib/planTier.ts'), switchOn, ...opts })
  return { db, cdb, env, kv, store, maxAge, ctx, waits, isolate, tick: (ms) => { clock += ms }, setClock: (ms) => { clock = ms } }
}
const heavy = (cdb) => cdb.log.filter((sql) => /family_agg AS|COALESCE\(expiry_alert_days, 30\)/.test(sql)).length

module.exports = { SRC, load, counting, modules, rng, fixtureWrite, seedCatalog, LOW_CONFIGS, cacheWorld, heavy }
