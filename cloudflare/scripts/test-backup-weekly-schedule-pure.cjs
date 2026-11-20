'use strict'
// The weekly backup cadence and its bell, Worker side (Free: mode 'runner-weekly').
//   a. Free, marker 199 h old: the bell fires; 197 h: quiet. The bell counts from the marker's own time, never from okAt.
//   b. A marker with backupOk:false, malformed, missing fields, or finishedAt in the future stamps nothing (no markerAt, no okAt).
//   c. Paid 'worker-daily' stays as it was: it takes its backup, never reads the marker, and its cron record gains no field.
//   d. The Free heavy visit makes exactly 1 R2 get (the marker) and 0 D1 statements.
//   e. Every new string exists in en and km, and the Khmer is Khmer.
//   f. No Worker R2 delete can reach backups/weekly/: every delete is scoped to a prefix that does not overlap it, and the sites are listed.
//   g. THE TRAP: Free, no marker, 70 heavy visits over 9 days, each stamping okAt -> the bell still fires at 198 h (cronRotation stamps
//      okAt for every visit that is not incomplete; a bell that read okAt would never fire).
// WKBELL_SRC and WKBELL_LANG point the test at patched copies of src/ and the lang folder (the mutant runs).
// Run (from cloudflare/): node scripts/test-backup-weekly-schedule-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = process.env.WKBELL_SRC || path.join(__dirname, '..', 'src')
const LANG = process.env.WKBELL_LANG || path.join(__dirname, '..', '..', 'frontend', 'src', 'lang')
const HOUR = 3600 * 1000
const MARKER_KEY = 'backups/weekly/latest.json'

let passed = 0
const ok = (name) => { passed += 1; console.log(`PASS ${name}`) }

const raw = openDb(loadAll())
const ledger = []
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      all: async (params) => { ledger.push(sql); return stmt.all(params) ?? [] },
      get: async (params) => { ledger.push(sql); return stmt.get(params) ?? null },
      run: async (params) => { ledger.push(sql); const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => { ledger.push('batch'); return raw.batch(items) },
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
const rot = load('lib/cronRotation.ts')
const sched = load('lib/backupSchedule.ts')
const backupMod = load('lib/backup.ts')
const tierMod = load('lib/planTier.ts')
const limitsOf = (tier) => tierMod.PLAN_LIMITS_BY_TIER[tier]
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

const memStore = (initial) => {
  let state = initial ?? null
  return {
    get state() { return state },
    load: async () => state,
    save: async (s, expected) => {
      const stored = state ? state.version : null
      if (stored !== expected) return false
      state = JSON.parse(JSON.stringify(s))
      return true
    },
  }
}

const goodMarker = (finishedAt) => ({ format: 'business-os-weekly-backup/1', runId: '4411-1', commit: 'abc1234', startedAt: finishedAt, finishedAt, backupOk: true, healthOk: true, anchorOk: true, files: 12, encryptedBytes: 1000, manifestSha256: 'a'.repeat(64) })

// An R2 double that records every call. Honours prefixes in list so a delete scoped to the wrong prefix is visible.
function makeAssets({ marker, objects = [] } = {}) {
  const calls = { get: [], list: [], delete: [], head: [], put: [] }
  const body = marker === undefined ? null : (typeof marker === 'string' ? marker : JSON.stringify(marker))
  return {
    calls,
    async get(key) {
      calls.get.push(key)
      if (key === MARKER_KEY && body !== null) return { text: async () => body, key }
      return null
    },
    async put(key) { calls.put.push(key) },
    async head(key) { calls.head.push(key); return null },
    async delete(keys) { for (const k of [].concat(keys)) calls.delete.push(k) },
    async list(opts = {}) {
      calls.list.push(opts.prefix || '')
      const hits = objects.filter((o) => o.key.startsWith(opts.prefix || ''))
      return { objects: hits.map((o) => ({ key: o.key, uploaded: new Date(o.uploaded), size: 1 })), truncated: false }
    },
  }
}
// env.DB as the code under test sees it: every statement it prepares is counted (backup.ts reaches D1 through env.DB as well as getDb).
const countedDb = { prepare(sql) { ledger.push(sql); return raw.prepare(sql) }, batch(items) { ledger.push('batch'); return raw.batch(items) }, exec: (sql) => raw.exec(sql) }
const mkEnv = (tier, assets) => ({ DB: countedDb, PLAN_TIER: tier, ASSETS: assets ?? makeAssets() })
const useTier = (tier) => { tierMod.__resetPlanTierCacheForTests(); return tier }

async function main() {
  const now = Date.parse('2026-11-22T15:17:00Z') // a Sunday, 22:17 Cambodia
  const iso = (ms) => new Date(ms).toISOString()
  const free = limitsOf('free')
  const paid = limitsOf('paid')

  // ---- the plan fields -------------------------------------------------------------------------------
  assert.equal(free.scheduledBackupMode, 'runner-weekly')
  assert.equal(paid.scheduledBackupMode, 'worker-daily')
  assert.equal(free.scheduledBackupEnabled, free.scheduledBackupMode === 'worker-daily')
  assert.equal(paid.scheduledBackupEnabled, paid.scheduledBackupMode === 'worker-daily')
  assert.equal(free.weeklyBackupStaleHours, 198)
  assert.equal(paid.weeklyBackupStaleHours, 198)
  assert.ok(free.weeklyBackupStaleHours >= 24 * (7 + 1) - 2, 'seven days plus the daily rule slack')
  for (const rel of ['lib/backupSchedule.ts', 'lib/backup.ts', 'routes/notifications.ts', 'routes/compat.ts']) {
    assert.ok(!/\b198\b/.test(read(rel)), `${rel} takes the threshold from getPlanLimits(env), no literal`)
  }
  ok('plan fields: mode and 198 h from getPlanLimits, no literal at a call site')

  // ---- the marker parser -----------------------------------------------------------------------------
  assert.equal(sched.weeklyBackupMarkerAt(goodMarker(iso(now - 5 * HOUR)), now), iso(now - 5 * HOUR))
  assert.equal(sched.weeklyBackupMarkerAt(goodMarker(iso(now + 30 * 60 * 1000)), now), iso(now + 30 * 60 * 1000), 'within the 1 h clock skew')
  ok('marker parser accepts a good marker')

  // ---- (b) a bad marker stamps nothing ----------------------------------------------------------------
  useTier('free')
  const badMarkers = {
    'backupOk false': { ...goodMarker(iso(now - 3 * HOUR)), backupOk: false },
    'backupOk missing': (() => { const m = goodMarker(iso(now - 3 * HOUR)); delete m.backupOk; return m })(),
    'malformed JSON': '{"format": "business-os-weekly-backup/1", "finishedAt": ',
    'not an object': '"latest"',
    'finishedAt in the future': goodMarker(iso(now + 2 * HOUR)),
    'finishedAt not a date': { ...goodMarker(iso(now - 3 * HOUR)), finishedAt: 'last sunday' },
    'wrong format': { ...goodMarker(iso(now - 3 * HOUR)), format: 'something-else' },
    'runId shape': { ...goodMarker(iso(now - 3 * HOUR)), runId: '../../etc' },
    'manifestSha256 shape': { ...goodMarker(iso(now - 3 * HOUR)), manifestSha256: 'zz' },
    'no marker object': undefined,
  }
  for (const [name, marker] of Object.entries(badMarkers)) {
    const env = mkEnv('free', makeAssets({ marker }))
    const result = await backupMod.maybeRunScheduledBackup(env, now, async () => { throw new Error('Free must never create a backup') })
    assert.equal(result.incomplete, true, `${name}: an unfinished visit`)
    assert.equal(result.markerAt, undefined, `${name}: no marker time`)
    const store = memStore(null)
    await rot.runRotationTick([{ id: 'backup', run: async () => result, trackSince: true }], store, now)
    const rec = store.state.steps.backup
    assert.equal(rec.markerAt, undefined, `${name}: markerAt not stamped`)
    assert.equal(rec.okAt, null, `${name}: okAt not stamped`)
  }
  {
    const env = mkEnv('free', makeAssets({ marker: goodMarker(iso(now - 3 * HOUR)) }))
    const result = await backupMod.maybeRunScheduledBackup(env, now, async () => { throw new Error('no create') })
    assert.equal(result.markerAt, iso(now - 3 * HOUR))
    assert.equal(result.incomplete, undefined)
    const store = memStore(null)
    await rot.runRotationTick([{ id: 'backup', run: async () => result, trackSince: true }], store, now)
    assert.equal(store.state.steps.backup.markerAt, iso(now - 3 * HOUR), 'the marker time, not the visit time')
    assert.ok(store.state.steps.backup.okAt, 'a good visit is OK')
  }
  ok('(b) bad markers stamp nothing; a good one stamps the marker time')

  // ---- (d) exactly one R2 get, zero D1 statements --------------------------------------------------------
  for (const marker of [goodMarker(iso(now - 3 * HOUR)), undefined, badMarkers['backupOk false']]) {
    const assets = makeAssets({ marker })
    ledger.length = 0
    await backupMod.maybeRunScheduledBackup(mkEnv('free', assets), now, async () => { throw new Error('no create') })
    assert.deepEqual(assets.calls.get, [MARKER_KEY], 'exactly one get, and it is the marker')
    assert.equal(ledger.length, 0, `no D1 statement: ${ledger.join(' | ')}`)
    assert.deepEqual(assets.calls.put, [], 'the Worker never writes under the weekly prefix')
    assert.ok(!assets.calls.delete.some((k) => k.startsWith('backups/weekly/')))
  }
  ok('(d) the Free heavy visit: 1 R2 get, 0 D1 statements, no put')

  // ---- (c) Paid is unchanged -------------------------------------------------------------------------------
  useTier('paid')
  {
    const assets = makeAssets()
    let created = 0
    const create = async () => { created += 1; return { status: 'finalized', name: 'sched-1' } }
    const result = await backupMod.maybeRunScheduledBackup(mkEnv('paid', assets), now, create)
    assert.equal(created, 1, 'Paid takes its nightly backup')
    assert.equal(result.skipped, false)
    assert.ok(!assets.calls.get.includes(MARKER_KEY), 'Paid never reads the weekly marker')
    const store = memStore(null)
    const step = { id: 'backup', run: async () => result, attemptWindow: (ms) => sched.scheduledBackupNightOf(ms, paid.scheduledBackupAfterHourLocal) }
    await rot.runRotationTick([step], store, now)
    const rec = store.state.steps.backup
    assert.ok(!('markerAt' in rec) && !('firstStartedAt' in rec), 'a Paid cron record gains no field: ' + Object.keys(rec))
    assert.ok(rec.okAt)
    const idx = read('index.ts')
    assert.match(idx, /scheduledBackupMode === 'runner-weekly' \? \{ trackSince: true \} : \{\}/, 'trackSince only in weekly mode')
  }
  {
    // the Paid bell still reads okAt with scheduledBackupStaleHours and says "Nightly"
    const base = { cursor: 0, resumeStreak: 0, updatedAt: null, lastSlot: null, version: 1 }
    const rec = (o) => ({ ...base, steps: { backup: { startedAt: iso(now - HOUR), finishedAt: iso(now - HOUR), okAt: null, error: null, failures: 0, killed: 0, runs: 3, ...o } } })
    assert.ok(sched.scheduledBackupMissing(rec({ okAt: iso(now - 38 * HOUR) }), now, paid.scheduledBackupStaleHours))
    assert.equal(sched.scheduledBackupMissing(rec({ okAt: iso(now - 26 * HOUR) }), now, paid.scheduledBackupStaleHours), null)
  }
  ok('(c) Paid worker-daily behaviour and its cron record are unchanged')

  // ---- the bell, through the real route -------------------------------------------------------------------
  const kv = new Map()
  const cacheStore = new Map()
  globalThis.caches = { default: { async match(request) { const hit = cacheStore.get(request.url); return hit ? hit.clone() : undefined }, async put(request, response) { cacheStore.set(request.url, response) } } }
  const bellEnv = (tier) => ({ DB: countedDb, PLAN_TIER: tier, ASSETS: makeAssets(), CACHE: { async get(k) { return kv.has(k) ? kv.get(k) : null }, async put(k, v) { kv.set(k, String(v)) }, async delete(k) { kv.delete(k) } } })
  const pending = []
  const executionCtx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})) }, passThroughOnException() {} }
  const app = load('routes/notifications.ts').default
  async function bell(user, tier) {
    useTier(tier)
    currentUser = user
    ledger.length = 0
    const res = await app.request('http://local/summary?fresh=1', { method: 'GET' }, bellEnv(tier), executionCtx)
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
  const rec = (o) => ({ startedAt: ago(1), finishedAt: ago(1), okAt: ago(1), error: null, failures: 0, killed: 0, runs: 70, ...o })
  const stale = free.weeklyBackupStaleHours

  // (a)
  setState(null)
  const baseline = await bell(ADMIN, 'free')
  assert.equal(baseline.status, 200)
  assert.equal(item(baseline), undefined, 'no record: nothing to say')
  setState(rec({ markerAt: ago(stale + 1), firstStartedAt: ago(500) }))
  const late = await bell(ADMIN, 'free')
  const it = item(late)
  assert.ok(it, 'Free, marker 199 h old (okAt 1 h old): the bell fires')
  assert.equal(it.tone, 'danger')
  assert.equal(it.pageId, 'backup')
  assert.equal(it.kind, 'system_backup_missing')
  assert.equal(it.labelKey, 'notification_backup_weekly_missing')
  assert.equal(it.label, 'Weekly backup missing')
  assert.equal(it.metaKey, 'notification_backup_missing_meta')
  assert.equal(it.metaParams.hours, stale + 1)
  setState(rec({ markerAt: ago(stale - 1), firstStartedAt: ago(500) }))
  assert.equal(item(await bell(ADMIN, 'free')), undefined, 'Free, marker 197 h old: quiet')
  setState(rec({ markerAt: ago(stale - 1), firstStartedAt: ago(500) }))
  const quiet = await bell(ADMIN, 'free')
  setState(rec({ markerAt: ago(stale + 1), firstStartedAt: ago(500) }))
  const loud = await bell(ADMIN, 'free')
  assert.equal(loud.statements, quiet.statements, 'the bell item costs no extra D1 statement')
  assert.equal(item(await bell(BACKUP_STAFF, 'free')), undefined, 'admin only')
  const paidAfter = (() => { setState(rec({ okAt: ago(38) })); return bell(ADMIN, 'paid') })()
  const paidItem = item(await paidAfter)
  assert.equal(paidItem.labelKey, 'notification_backup_missing', 'Paid keeps the nightly label')
  assert.equal(paidItem.label, 'Nightly backup missing')
  ok('(a) Free bell: 199 h fires, 197 h quiet, from the marker time; Paid keeps the nightly bell')

  // ---- (g) the trap ---------------------------------------------------------------------------------------
  // Free, no marker, a visit every 3 h for 9 days (70 visits), each stamping okAt. The bell must still fire once 198 h have passed.
  useTier('free')
  const t0 = Date.parse('2026-11-12T15:17:00Z')
  const simulate = async (makeRun) => {
    const store = memStore(null)
    let tickNow = t0
    for (let visit = 0; visit < 70; visit += 1) {
      const step = { id: 'backup', run: makeRun(tickNow), trackSince: true, attemptWindow: (ms) => sched.scheduledBackupNightOf(ms, free.scheduledBackupAfterHourLocal) }
      await rot.runRotationTick([step], store, tickNow)
      tickNow += 3 * HOUR
    }
    return { state: store.state, last: tickNow - 3 * HOUR }
  }
  // today's Free shape: a skipped visit that is not incomplete, so runRotationTick stamps okAt every time
  const old = await simulate(() => async () => ({ skipped: true, reason: 'scheduled-backup-unavailable-free' }))
  assert.equal(old.state.steps.backup.runs, 70)
  assert.ok(Date.parse(old.state.steps.backup.okAt) >= old.last - HOUR, 'okAt was refreshed by the last visit')
  assert.equal(sched.scheduledBackupMissing(old.state, old.last + HOUR, stale), null, 'CONTROL: a bell that trusts okAt never fires')
  assert.ok(sched.weeklyBackupMissing(old.state, t0 + (stale + 1) * HOUR, stale), 'the weekly bell fires at 199 h')
  assert.equal(sched.weeklyBackupMissing(old.state, t0 + (stale - 1) * HOUR, stale), null, 'and not at 197 h')
  // the real Free visit with no marker in R2
  const real = await simulate((nowMs) => () => backupMod.maybeRunScheduledBackup(mkEnv('free', makeAssets()), nowMs, async () => { throw new Error('no create') }))
  assert.ok(sched.weeklyBackupMissing(real.state, t0 + (stale + 1) * HOUR, stale), 'real visits, no marker: fires at 199 h')
  assert.equal(sched.weeklyBackupMissing(real.state, t0 + (stale - 1) * HOUR, stale), null, 'real visits, no marker: quiet at 197 h')
  // through the route: okAt is fresh, firstStartedAt is what counts
  setState(rec({ okAt: ago(1), startedAt: ago(1), firstStartedAt: ago(stale + 1) }))
  assert.ok(item(await bell(ADMIN, 'free')), 'route: fresh okAt, 199 h of watching, no marker -> fires')
  setState(rec({ okAt: ago(1), startedAt: ago(1), firstStartedAt: ago(stale - 1) }))
  assert.equal(item(await bell(ADMIN, 'free')), undefined, 'route: 197 h of watching -> quiet')
  setState(rec({ okAt: ago(1), startedAt: ago(1) }))
  assert.equal(item(await bell(ADMIN, 'free')), undefined, 'a record with no firstStartedAt (a fresh deploy) says nothing')
  ok('(g) the trap: 70 okAt-stamped visits over 9 days, the bell still fires at 198 h')

  // a missing marker polls instead of starving the image audit
  {
    const result = await backupMod.maybeRunScheduledBackup(mkEnv('free', makeAssets()), now, async () => { throw new Error('no create') })
    assert.equal(result.pollOnly, true)
    const steps = [{ id: 'backup' }, { id: 'image-audit' }]
    const state = { cursor: 0, resumeStreak: 0, updatedAt: null, lastSlot: null, version: 1, steps: { backup: { startedAt: iso(now - HOUR), finishedAt: iso(now - HOUR), okAt: null, error: null, failures: 0, killed: 0, runs: 1, pollAt: iso(now - HOUR) } } }
    assert.equal(sched.pickHeavyStepIndex(steps, state, now, 21, 2, free.scheduledBackupCopyPollGapMinutes * 60000), 1, 'one hour after a marker poll the audit gets the tick')
  }
  ok('a missing marker is a poll: the image audit keeps its ticks')

  // ---- (e) strings --------------------------------------------------------------------------------------
  const en = JSON.parse(fs.readFileSync(path.join(LANG, 'en.json'), 'utf8'))
  const km = JSON.parse(fs.readFileSync(path.join(LANG, 'km.json'), 'utf8'))
  const KEYS = ['notification_backup_weekly_missing', 'plan_tier_hint_free_weekly', 'backup_weekly_label', 'backup_weekly_last', 'backup_weekly_none', 'backup_weekly_restore']
  for (const key of KEYS) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.json is missing ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km.json is missing ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `${key} is not Khmer in km.json`)
    assert.notEqual(km[key], en[key], `${key} is untranslated`)
  }
  assert.equal(en.notification_backup_weekly_missing, 'Weekly backup missing')
  ok('(e) the six new keys exist in en and km')

  // ---- (f) no Worker R2 delete reaches backups/weekly/ ----------------------------------------------------
  const prefixes = [backupMod.CLOUDFLARE_BACKUP_PREFIX, backupMod.BACKUP_ASSET_POOL_PREFIX, backupMod.DRIVE_STAGED_BACKUP_PREFIX, 'uploads/', 'system/doctor-']
  for (const p of prefixes) {
    assert.ok(!p.startsWith(sched.WEEKLY_BACKUP_PREFIX) && !sched.WEEKLY_BACKUP_PREFIX.startsWith(p), `delete prefix ${p} overlaps ${sched.WEEKLY_BACKUP_PREFIX}`)
  }
  useTier('free')
  {
    const old7 = Date.now() - 40 * 24 * HOUR
    const objects = [
      { key: 'backups/weekly/latest.json', uploaded: old7 },
      { key: 'backups/weekly/2026-11-15-4411/c0.enc.json', uploaded: old7 },
      { key: 'backups/weekly/2026-11-15-4411/manifest.enc.json', uploaded: old7 },
      { key: 'backups/cloudflare/old-1.json', uploaded: old7 },
      { key: 'backups/cloudflare/orphan-folder/assets/a.png', uploaded: old7 },
      { key: 'backups/asset-pool/x', uploaded: old7 },
    ]
    const assets = makeAssets({ objects })
    const env = mkEnv('free', assets)
    await backupMod.pruneCloudflareBackups(env, 0, 0).catch(() => undefined)
    await backupMod.maybeRunScheduledBackup(env, now, async () => { throw new Error('no create') })
    assert.ok(assets.calls.delete.length > 0, 'CONTROL: the double does delete old Worker backups')
    assert.deepEqual(assets.calls.delete.filter((k) => k.startsWith('backups/weekly/')), [], 'no delete touched backups/weekly/')
    assert.ok(assets.calls.list.every((p) => !'backups/weekly/'.startsWith(p) || p === ''), 'no list prefix is a parent of backups/weekly/: ' + assets.calls.list.join(','))
  }
  const sites = {}
  const walk = (dir) => { for (const name of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, name.name); if (name.isDirectory()) walk(full); else if (name.name.endsWith('.ts')) { const n = (fs.readFileSync(full, 'utf8').match(/ASSETS\.delete\(/g) || []).length; if (n) sites[path.relative(SRC, full).replace(/\\/g, '/')] = n } } }
  walk(SRC)
  assert.deepEqual(sites, { 'lib/backup.ts': 4, 'lib/driveSyncQueue.ts': 1, 'lib/googleDrive.ts': 4, 'lib/imageVariantStore.ts': 1, 'routes/compat.ts': 1, 'routes/files.ts': 1, 'routes/importJobs.ts': 1, 'routes/portal.ts': 1 },
    'a new R2 delete site must be audited against backups/weekly/ and added here')
  ok('(f) every Worker R2 delete is prefix-scoped away from backups/weekly/, and the sites are pinned')

  console.log(`ALL ${passed} CHECK GROUPS PASSED`)
}
main().catch((e) => { console.error(e); process.exit(1) })
