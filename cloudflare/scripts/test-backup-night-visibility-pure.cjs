'use strict'
// A failed backup night must be visible (R3-1).
//   1. an attempts-exhausted visit is a FAILURE in the cron record (failures, error, no okAt), not an OK visit;
//   2. the bell shows an admin-only "Nightly backup missing" item when the backup step's last good visit is older than
//      getPlanLimits(env).scheduledBackupStaleHours, on Paid only, from the cron record the settings query already reads
//      (no extra statement, nothing from the record leaks into the response);
// Run (from cloudflare/): node scripts/test-backup-night-visibility-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const HOUR = 3600 * 1000
const Z = (iso) => Date.parse(iso)

// ---- plain loader (no D1) for the lane modules -----------------------------------------------------------
function resolveTs(base) {
  for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return base
}
function makeLoader() {
  const cache = new Map()
  const stub = { getDb: () => ({ prepare: () => { throw new Error('no D1 in this part') } }) }
  const dbKey = path.normalize(path.join(SRC, 'lib/db.ts'))
  function load(file) {
    const key = path.normalize(file)
    if (key === dbKey) return stub
    if (cache.has(key)) return cache.get(key)
    const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
    const mod = { exports: {} }
    cache.set(key, mod.exports)
    const req = Module.createRequire(key)
    new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
    cache.set(key, mod.exports)
    return mod.exports
  }
  return (rel) => load(path.join(SRC, rel))
}
const real = makeLoader()
const rot = real('lib/cronRotation.ts')
const sched = real('lib/backupSchedule.ts')
const backupMod = real('lib/backup.ts')
// The tier is cached per process by resolvePlanTier, so read the tables directly; the bell's Free case runs in a child process.
const limitsOf = (tier) => real('lib/planTier.ts').PLAN_LIMITS_BY_TIER[tier]
const FREE_CHILD = process.env.NIGHT_VISIBILITY_FREE_CHILD === '1'
const memStore = (initial) => {
  let state = initial ?? null
  return {
    get state() { return state },
    load: async () => { if (state === 'throw') throw new Error('settings read failed'); return state },
    save: async (s, expected) => {
      if (state === 'throw') throw new Error('settings write failed')
      const stored = state ? state.version : null
      if (stored !== expected) return false
      state = JSON.parse(JSON.stringify(s))
      return true
    },
  }
}

let passed = 0
const ok = (name) => { passed += 1; console.log(`PASS ${name}`) }

async function main() {
  // ---- 1. attempts-exhausted is a failure --------------------------------------------------------------
  {
    const limits = limitsOf('paid')
    const env = { PLAN_TIER: 'paid', ASSETS: { async list() { return { objects: [], truncated: false } }, async delete() {}, async head() { return null }, async get() { return null } } }
    const now = Z('2026-11-12T15:17:00Z') // 22:17 local
    const result = await backupMod.maybeRunScheduledBackup(env, now, async () => { throw new Error('must not take a backup') }, limits.scheduledBackupMaxAttemptsPerDay)
    assert.equal(result.reason, 'attempts-exhausted')
    assert.equal(result.failed, true, 'the exhausted visit says it failed')
    const store = memStore(null)
    const step = { id: 'backup', run: async () => result, attemptWindow: (ms) => sched.scheduledBackupNightOf(ms, limits.scheduledBackupAfterHourLocal) }
    const tick = await rot.runRotationTick([step], store, now)
    assert.equal(tick.ok, false, 'the lane reports the visit as not ok')
    const rec = store.state.steps.backup
    assert.equal(rec.failures, 1)
    assert.ok(/attempts-exhausted/.test(rec.error))
    assert.equal(rec.okAt, null, 'a failed night never stamps okAt')
    const health = rot.evaluateCronHealth(store.state, ['backup'], now + HOUR)
    assert.equal(health.steps[0].status, 'failing', 'cron-health shows it')
    // Control: a normal skip still counts as OK.
    const store2 = memStore(null)
    const t2 = await rot.runRotationTick([{ id: 'backup', run: async () => ({ skipped: true, reason: 'recent-backup-exists' }) }], store2, now)
    assert.equal(t2.ok, true)
    assert.ok(store2.state.steps.backup.okAt)
    ok('attempts-exhausted counts as a failure; a plain skip stays OK')
  }

  // ---- the bell ----------------------------------------------------------------------------------------
  const raw = openDb(loadAll())
  const ledger = []
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        all: async (params) => { ledger.push(sql); return stmt.all(params) ?? [] },
        get: async (params) => { ledger.push(sql); return stmt.get(params) ?? null },
        run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (items) => raw.batch(items),
    exec: (sql) => raw.exec(sql),
  }
  let currentUser = null
  const overrides = {
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  }
  const modules = new Map()
  function load(rel) {
    if (modules.has(rel)) return modules.get(rel).exports
    const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path.join(SRC, rel) }).outputText
    const mod = { exports: {} }
    modules.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  const cacheStore = new Map()
  globalThis.caches = { default: { async match(request) { const hit = cacheStore.get(request.url); return hit ? hit.clone() : undefined }, async put(request, response) { cacheStore.set(request.url, response) } } }
  const kv = new Map()
  const mkEnv = (tier) => ({ DB: raw, PLAN_TIER: process.env.TEST_PLAN_TIER === 'free' ? 'free' : tier, CACHE: { async get(k) { return kv.has(k) ? kv.get(k) : null }, async put(k, v) { kv.set(k, String(v)) }, async delete(k) { kv.delete(k) } } })
  const pending = []
  const executionCtx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})) }, passThroughOnException() {} }
  const app = load('routes/notifications.ts').default
  async function bell(user, tier = 'paid') {
    currentUser = user
    ledger.length = 0
    const res = await app.request('http://local/summary?fresh=1', { method: 'GET' }, mkEnv(tier), executionCtx)
    await Promise.all(pending.splice(0))
    return { status: res.status, json: await res.json(), statements: ledger.length }
  }
  const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }
  const BACKUP_STAFF = { id: 2, username: 'bk', name: 'Bk', role_code: 'staff', permissions: JSON.stringify({ backup: true }) }
  const setState = (backup) => {
    raw.db.prepare("DELETE FROM settings WHERE key = 'cron_heavy_state'").run()
    if (backup) raw.db.prepare("INSERT INTO settings (key, value) VALUES ('cron_heavy_state', ?)").run(JSON.stringify({ cursor: 0, resumeStreak: 0, steps: { backup }, updatedAt: new Date().toISOString(), lastSlot: 1, version: 3 }))
  }
  const ago = (h) => new Date(Date.now() - h * HOUR).toISOString()
  const item = (res) => (res.json.sections.find((s) => s.id === 'system')?.items || []).find((i) => i.id === 'system-backup-missing')
  const rec = (okAt, startedAt = ago(1)) => ({ startedAt, finishedAt: startedAt, okAt, error: null, failures: 0, killed: 0, runs: 3 })
  const staleHours = limitsOf('paid').scheduledBackupStaleHours
  assert.ok(Number.isFinite(staleHours) && staleHours > 24, 'the threshold is a plan limit above one day')
  assert.equal(limitsOf('free').scheduledBackupStaleHours, staleHours)

  if (FREE_CHILD) {
    setState(rec(ago(staleHours + 8)))
    const onFree = await bell(ADMIN, 'free')
    assert.equal(onFree.status, 200)
    assert.equal(item(onFree), undefined, 'Free: no item')
    return
  }
  setState(null)
  const base = await bell(ADMIN)
  assert.equal(base.status, 200)
  assert.equal(item(base), undefined, 'no cron record yet: nothing to say')
  ok('bell: no record, no item')

  setState(rec(ago(staleHours + 8)))
  const stale = await bell(ADMIN)
  const it = item(stale)
  assert.ok(it, 'a last good visit older than the limit shows the item')
  assert.equal(it.tone, 'danger')
  assert.equal(it.pageId, 'backup')
  assert.equal(it.kind, 'system_backup_missing')
  assert.equal(it.metaParams.hours, staleHours + 8)
  assert.equal(it.labelKey, 'notification_backup_missing')
  assert.equal(it.metaKey, 'notification_backup_missing_meta')
  setState(null)
  const warm = await bell(ADMIN)
  assert.equal(stale.statements, warm.statements, 'no extra D1 statement for the item (same warm caches, with and without the record)')
  setState(rec(ago(staleHours + 8)))
  ok('bell: stale record shows a danger item at no extra statement')

  setState(rec(ago(staleHours - 4)))
  assert.equal(item(await bell(ADMIN)), undefined, 'inside the window: quiet')
  setState(rec(null, ago(staleHours + 2)))
  assert.ok(item(await bell(ADMIN)), 'never finished one and the first try is old: shown')
  setState(rec(null, ago(2)))
  assert.equal(item(await bell(ADMIN)), undefined, 'a fresh deploy that has not had its first night: quiet')
  ok('bell: threshold edges')

  setState(rec(ago(staleHours + 8)))
  assert.equal(item(await bell(BACKUP_STAFF)), undefined, 'admin only')
  const child = require('node:child_process').spawnSync(process.execPath, [__filename], { env: { ...process.env, NIGHT_VISIBILITY_FREE_CHILD: '1', TEST_PLAN_TIER: 'free' }, encoding: 'utf8' })
  assert.equal(child.status, 0, 'never on Free, where no scheduled backup exists: ' + child.stdout + child.stderr)
  raw.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('notifications_system_enabled', '0')").run()
  assert.equal(item(await bell(ADMIN)), undefined, 'the System alerts switch mutes it')
  raw.db.prepare("DELETE FROM settings WHERE key = 'notifications_system_enabled'").run()
  ok('bell: admin only, Paid only, mutable')

  const leak = await bell(ADMIN)
  assert.ok(!JSON.stringify(leak.json.preferences).includes('cron'), 'the cron record is not part of the response')
  assert.ok(!('backupMissing' in leak.json.preferences) && !('cronHeavyState' in leak.json.preferences))
  ok('bell: nothing from the cron record leaks into preferences')

  console.log(`ALL ${passed} CHECK GROUPS PASSED`)
}
main().catch((e) => { console.error(e); process.exit(1) })
