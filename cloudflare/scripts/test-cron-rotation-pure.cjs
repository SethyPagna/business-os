// Rotating cron: every background step completes under Free's 10 ms CPU
// budget, a killed or failing step cannot starve the rest, Telegram keeps a
// dedicated frequent trigger, and the real ephemeral sweep resumes in bounded
// slices. Includes the CONTROL: the old single-invocation design, run through
// the same CPU meter, starves the steps at the back of the chain.
// Run (from cloudflare/): node scripts/test-cron-rotation-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'))
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
const rot = load(path.join(SRC, 'lib/cronRotation.ts'))
const ids = load(path.join(SRC, 'lib/cronStepIds.ts')).ROTATION_STEP_IDS
const retention = load(path.join(SRC, 'lib/ephemeralRetention.ts'))

let passed = 0
const ok = () => { passed += 1 }

// ---- simulation ------------------------------------------------------------
const BUDGET = 10 // ms of CPU per invocation (Workers Free)
const BOOKKEEPING = 1 // two settings writes + one read per rotation tick
// Cost per step: each fits alone; together they are three times the budget.
const COST = {
  'backup': 4, 'drive-sync': 2, 'audit-log-retention': 3, 'reap-stalled-imports': 2, 'import-retention': 3,
  'import-incoming-sweep': 2, 'orphan-staging-cleanup': 2, 'ephemeral-retention:rate_limit': 2, 'ephemeral-retention:auth': 3,
  'ephemeral-retention:logs': 2, 'ephemeral-retention:history': 3, 'ephemeral-retention:submissions': 2, 'image-audit': 3,
}
assert.deepStrictEqual(Object.keys(COST), [...ids], 'simulation covers exactly the shipped step ids')
const TOTAL = Object.values(COST).reduce((a, b) => a + b, 0)
assert.ok(TOTAL > 3 * BUDGET, 'all steps together are far over one invocation budget')
assert.ok(Math.max(...Object.values(COST)) + BOOKKEEPING <= BUDGET, 'each step fits one invocation on its own')
ok()

class Killed extends Error {}
function makeInvocation() {
  const inv = { used: 0, dead: false, spend(ms) { inv.used += ms; if (inv.used > BUDGET) { inv.dead = true; throw new Killed('CPU limit') } } }
  return inv
}
// Store over a plain object; once the isolate is killed, nothing more persists.
// Same contract as the settings store: write only over the version loaded.
function casSave(box, state, expected) {
  const stored = box.text ? rot.parseRotationState(box.text).version : null
  if (stored !== expected) return false
  box.text = JSON.stringify(state)
  return true
}
function makeStore(box, inv) {
  return {
    async load() { return box.text ? rot.parseRotationState(box.text) : null },
    async save(state, expected) {
      if (inv.dead) return true // process is gone: later writes never happen
      inv.spend(BOOKKEEPING / 2)
      return casSave(box, state, expected)
    },
  }
}
const stepsFor = (inv, done = {}, behave = {}) => ids.map((id) => ({
  id,
  async run() {
    if (behave[id] === 'throw') throw new Error('boom')
    inv.spend(behave[id] === 'huge' ? 99 : COST[id])
    done[id] = (done[id] || 0) + 1
    return { skipped: false }
  },
}))

async function newDesign(invocations, behave = {}) {
  const box = { text: null }
  const done = {}
  let t = Date.parse('2026-10-26T00:00:00Z')
  for (let i = 0; i < invocations; i += 1) {
    const inv = makeInvocation()
    await rot.runRotationTick(stepsFor(inv, done, behave), makeStore(box, inv), t)
    t += rot.CRON_ROTATION_TICK_MS
  }
  return { box, done, t }
}
// The OLD handler: every step in ONE invocation, in order, each in its own try.
async function oldDesign(invocations) {
  const done = {}
  for (let i = 0; i < invocations; i += 1) {
    const inv = makeInvocation()
    for (const step of stepsFor(inv, done)) {
      try { await step.run() } catch (e) { if (e instanceof Killed) break } // killed isolate: nothing after runs
    }
  }
  return done
}

function stepsSrcOf(index) { return index.slice(index.indexOf('export function cronRotationSteps'), index.indexOf('export default {')) }

async function main() {
  // 1. all steps complete over N invocations, none starved
  const N = ids.length * 3
  const { box, done, t } = await newDesign(N)
  for (const id of ids) assert.ok(done[id] >= 3, `${id} ran each cycle (${done[id]})`)
  const health = rot.evaluateCronHealth(rot.parseRotationState(box.text), ids, t)
  assert.deepStrictEqual(health.problems, [], 'no problems after full cycles')
  assert.strictEqual(health.healthy, true)
  ok()

  // 2. CONTROL: the old single-invocation design starves the back of the chain, however many ticks
  const oldDone = await oldDesign(200)
  const starved = ids.filter((id) => !oldDone[id])
  assert.ok(starved.length >= 5, `old design starves steps: ${starved.join(', ')}`)
  assert.ok(starved.includes('image-audit') && starved.includes('ephemeral-retention:history'), 'retention and image audit starve')
  assert.ok(!starved.includes('backup'), 'control sanity: the first steps do run')
  ok()

  // 3. cursor survives a throwing step and a step that is killed every visit
  const thrown = await newDesign(N, { 'audit-log-retention': 'throw' })
  for (const id of ids) if (id !== 'audit-log-retention') assert.ok(thrown.done[id] >= 3, `${id} not starved by a throwing step`)
  const killedRun = await newDesign(N, { 'import-retention': 'huge' })
  for (const id of ids) if (id !== 'import-retention') assert.ok(killedRun.done[id] >= 3, `${id} not starved by a killed step`)
  assert.ok(!killedRun.done['import-retention'], 'the killed step never completes')
  const killedHealth = rot.evaluateCronHealth(rot.parseRotationState(killedRun.box.text), ids, killedRun.t)
  const row = killedHealth.steps.find((r) => r.id === 'import-retention')
  assert.strictEqual(row.status, 'killed'); assert.ok(row.killed >= 2)
  assert.deepStrictEqual(killedHealth.problems, ['import-retention'])
  assert.strictEqual(killedHealth.healthy, false)
  const thrownHealth = rot.evaluateCronHealth(rot.parseRotationState(thrown.box.text), ids, thrown.t)
  assert.strictEqual(thrownHealth.steps.find((r) => r.id === 'audit-log-retention').status, 'failing')
  ok()

  // 4. cursor mechanics: advances before the step, store failures never throw
  const cursorBox = { text: null }
  let seen
  await rot.runRotationTick([{ id: 'a', run: async () => { seen = JSON.parse(cursorBox.text).cursor } }, { id: 'b', run: async () => {} }],
    { load: async () => null, save: async (s, e) => casSave(cursorBox, s, e) }, 0)
  assert.strictEqual(seen, 1, 'cursor already advanced while the step runs')
  const broken = await rot.runRotationTick([{ id: 'a', run: async () => ({ more: false }) }],
    { load: async () => { throw new Error('d1 down') }, save: async () => { throw new Error('d1 down') } }, 0)
  assert.strictEqual(broken.ok, true)
  const ran = []
  for (let i = 0; i < 4; i += 1) {
    await rot.runRotationTick([{ id: 'a', run: async () => { ran.push('a') } }, { id: 'b', run: async () => { ran.push('b') } }],
      { load: async () => { throw new Error('x') }, save: async () => true }, i * rot.CRON_ROTATION_TICK_MS)
  }
  assert.ok(ran.includes('a') && ran.includes('b'), 'unreadable cursor still rotates by clock')
  ok()

  // 5. resume: a step with work left is re-run at most MAX_RESUME_STREAK times in a row, then rotation continues
  const order = []
  const rbox = { text: null }
  const rstore = { load: async () => (rbox.text ? rot.parseRotationState(rbox.text) : null), save: async (s, e) => casSave(rbox, s, e) }
  const rsteps = [{ id: 'big', run: async () => { order.push('big'); return { more: true } } }, { id: 'next', run: async () => { order.push('next') } }]
  for (let i = 0; i < 6; i += 1) await rot.runRotationTick(rsteps, rstore, i * 1000)
  assert.deepStrictEqual(order.slice(0, 4), ['big', 'big', 'big', 'next'], 'resumes twice, then moves on')
  ok()

  // 6. health: stale and starved when nothing has run for several cycles
  const later = rot.evaluateCronHealth(rot.parseRotationState(box.text), ids, t + 10 * ids.length * rot.CRON_ROTATION_TICK_MS)
  assert.strictEqual(later.stale, true); assert.strictEqual(later.healthy, false)
  assert.ok(later.steps.every((r) => r.status === 'starved'))
  assert.strictEqual(rot.evaluateCronHealth(rot.emptyRotationState(), ids, t).healthy, false, 'no state at all is unhealthy')
  ok()

  // 6b. P3-4: overlapping ticks. Two ticks read the same state; only one may
  // claim the step, and the loser must not rewind the cursor or run the job.
  const obox = { text: null }
  const ostore = { load: async () => (obox.text ? rot.parseRotationState(obox.text) : null), save: async (s, e) => casSave(obox, s, e) }
  const ranOverlap = []
  const osteps = ['a', 'b', 'c'].map((id) => ({ id, run: async () => { ranOverlap.push(id) } }))
  await rot.runRotationTick(osteps, ostore, 0) // a; cursor -> 1
  let release
  const gate = new Promise((r) => { release = r })
  const slowLoad = { load: async () => { const st = await ostore.load(); await gate; return st }, save: ostore.save }
  const loser = rot.runRotationTick(osteps, slowLoad, 1000) // loaded cursor 1, then waits
  const winner = await rot.runRotationTick(osteps, ostore, 1000) // takes b
  release()
  const lost = await loser
  assert.strictEqual(winner.stepId, 'b'); assert.strictEqual(lost.skipped, 'lost-race')
  assert.deepStrictEqual(ranOverlap, ['a', 'b'], 'the step both ticks wanted ran once')
  assert.strictEqual(rot.parseRotationState(obox.text).cursor, 2, 'cursor was not rewound by the late tick')
  ok()

  // 6c. P3-2: a gated step is skipped inside its interval, runs after it, and rotation still advances
  const gbox = { text: null }
  const gstore = { load: async () => (gbox.text ? rot.parseRotationState(gbox.text) : null), save: async (s, e) => casSave(gbox, s, e) }
  let gated = 0
  const gsteps = [{ id: 'g', minIntervalMs: 5 * 3600 * 1000, run: async () => { gated += 1 } }, { id: 'n', run: async () => {} }]
  const at = Date.parse('2026-10-26T00:00:00Z')
  for (let i = 0; i < 8; i += 1) await rot.runRotationTick(gsteps, gstore, at + i * 15 * 60 * 1000) // 2 h of 15-minute ticks
  assert.strictEqual(gated, 1, 'inside 5 h the gated step ran once')
  const skipped = await rot.runRotationTick(gsteps, gstore, at + 16 * 15 * 60 * 1000)
  assert.strictEqual(skipped.skipped, 'recent')
  for (let i = 0; i < 4; i += 1) await rot.runRotationTick(gsteps, gstore, at + (21 + i) * 15 * 60 * 1000 + 5 * 3600 * 1000)
  assert.ok(gated >= 2, 'after the interval it runs again')
  const ungated = stepsSrcOf(read('src/index.ts'))
  for (const id of ['reap-stalled-imports', 'import-incoming-sweep', 'orphan-staging-cleanup', 'image-audit']) {
    const line = ungated.split('\n').find((l) => l.includes(`step('${id}'`))
    assert.ok(line && line.includes('UNGATED_STEP_MIN_INTERVAL_MS'), id + ' keeps a min interval')
  }
  ok()

  // 7. Telegram timing preserved: dedicated, frequent trigger; rotation excludes it
  const everyMin = (expr) => Number((/^\*\/(\d+) \* \* \* \*$/.exec(expr) || [])[1])
  assert.ok(everyMin(rot.CRON_TELEGRAM) > 0 && everyMin(rot.CRON_TELEGRAM) <= 5, 'telegram backstop within 5 minutes (was 6 hours)')
  assert.ok(everyMin(rot.CRON_ROTATION) > 0 && everyMin(rot.CRON_ROTATION) * ids.length <= 4 * 60, 'every step revisited within 4h')
  for (const file of ['wrangler.toml', 'wrangler.free.toml']) {
    const m = /^\s*crons\s*=\s*\[(.*)\]/m.exec(read(file))
    assert.ok(m, `${file} has crons`)
    const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    assert.deepStrictEqual(list, [...rot.CRON_SCHEDULES], `${file} crons match CRON_SCHEDULES`)
    assert.ok(list.length <= 5, 'Free allows 5 cron triggers per account')
  }
  const index = read('src/index.ts')
  const scheduled = index.slice(index.indexOf('async scheduled('))
  assert.ok(/controller\?\.cron === CRON_TELEGRAM[\s\S]*?drainDueTelegramShiftOverviews\(env, Date\.now\(\), \{ limit: 10, sweepStale: true \}\)[\s\S]*?return\n\s*\}\s*\n\s*await runRotationTick/.test(scheduled),
    'telegram tick drains and returns; every other tick runs ONE rotation step')
  const stepsSrc = index.slice(index.indexOf('export function cronRotationSteps'), index.indexOf('export default {'))
  assert.ok(!/telegram/i.test(stepsSrc), 'telegram is not part of the rotation')
  assert.strictEqual((scheduled.match(/runRotationTick\(/g) || []).length, 1)
  assert.ok(!/await runStep\(/.test(scheduled), 'no sequential runStep chain left')
  // The shipped step ids are the ids the health route reports on, in order.
  const shipped = [...stepsSrc.matchAll(/step\('([a-z-]+)'/g)].map((x) => x[1])
  const withGroups = shipped.flatMap((id) => (id === 'image-audit' ? [...retention.EPHEMERAL_RETENTION_GROUPS.map((g) => `ephemeral-retention:${g}`), id] : [id]))
  assert.deepStrictEqual(withGroups, [...ids], 'cronStepIds matches cronRotationSteps()')
  ok()

  // 8. nothing the owner keeps is touched by the scheduler files
  for (const file of ['src/lib/cronRotation.ts', 'src/lib/cronRotationStore.ts']) {
    assert.ok(!/DELETE\s+FROM/i.test(read(file)), `${file} deletes nothing`)
  }
  for (const file of ['src/lib/ephemeralRetention.ts', 'src/lib/audit.ts']) {
    assert.ok(!/DELETE\s+FROM\s+(expenses|expense_|reverts?\b|action_reverts)/i.test(read(file)), `${file} never deletes expenses or reverts`)
  }
  ok()

  // 9. real sweep: bounded slices, progress, resume, nothing recent deleted
  const env = { ASSETS: { async delete() {}, async put() {}, async get() { return null }, async list() { return { objects: [], truncated: false } } }, PLAN_TIER: 'free' }
  const NOW = Date.parse('2026-10-20T10:30:15.250Z')
  const real = Date.now
  Date.now = () => NOW
  try {
    const old = new Date(NOW - 3 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    const fresh = new Date(NOW - 60000).toISOString().slice(0, 19).replace('T', ' ')
    const ins = rawDb.prepare('INSERT INTO rate_limit_events (bucket, client_key, created_at) VALUES (?, ?, ?)')
    for (let i = 0; i < 3500; i += 1) ins.run(['cron', `old-${i}`, old])
    ins.run(['cron', 'fresh', fresh])
    const count = () => rawDb.prepare("SELECT COUNT(*) AS n FROM rate_limit_events WHERE bucket='cron'").get().n
    const stamp = (g) => rawDb.prepare('SELECT value FROM settings WHERE key = ?').get([`ephemeral_retention_last_run:${g}`])
    const first = await retention.maybeRunScheduledEphemeralRetention(env, 'rate_limit')
    assert.strictEqual(first.skipped, false); assert.strictEqual(first.more, true)
    assert.strictEqual(count(), 3501 - 3000, 'one visit deletes at most 3 batches of 1000')
    assert.ok(!stamp('rate_limit'), 'not stamped while work remains')
    const second = await retention.maybeRunScheduledEphemeralRetention(env, 'rate_limit')
    assert.ok(!second.more); assert.strictEqual(count(), 1, 'only the fresh row survives')
    assert.ok(stamp('rate_limit'), 'stamped once done')
    const third = await retention.maybeRunScheduledEphemeralRetention(env, 'rate_limit')
    assert.strictEqual(third.skipped, true)
    // other slices have their own stamp and are not blocked by it
    const auth = await retention.maybeRunScheduledEphemeralRetention(env, 'auth')
    assert.strictEqual(auth.skipped, false)
    assert.ok(!('rate_limit_events' in auth.deleted), 'a slice touches only its own tables')
  } finally { Date.now = real }
  ok()

  // 9b. P3-1: audit-log retention takes at most 3 batches of 5000 per visit,
  // is NOT stamped while rows remain, and is stamped once it has drained.
  const auditMod = load(path.join(SRC, 'lib/audit.ts'))
  const insAudit = rawDb.prepare("INSERT INTO audit_logs (action, entity, created_at) VALUES ('zz_cron_test', 'zz_cron_test', '2020-01-01 00:00:00')")
  rawDb.exec('BEGIN')
  for (let i = 0; i < 16000; i += 1) insAudit.run([])
  rawDb.exec('COMMIT')
  const auditLeft = () => rawDb.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'zz_cron_test'").get().n
  const auditStamp = () => rawDb.prepare("SELECT value FROM settings WHERE key = 'audit_log_retention_last_run'").get()
  const a1 = await auditMod.maybeRunScheduledAuditLogRetention({})
  assert.strictEqual(a1.more, true); assert.strictEqual(auditLeft(), 1000, 'one visit deletes at most 3 x 5000')
  assert.ok(!auditStamp(), 'not stamped while rows remain')
  const a2 = await auditMod.maybeRunScheduledAuditLogRetention({})
  assert.ok(!a2.more); assert.strictEqual(auditLeft(), 0)
  assert.ok(auditStamp(), 'stamped once drained')
  ok()

  // 9c. P3-1: in a scheduled slice the auth tables share the visit, one
  // bounded statement each (only a single-table slice gets the full bound).
  const farFuture = '2000-01-01 00:00:00'
  const insSess = rawDb.prepare("INSERT INTO user_sessions (user_id, token_hash, expires_at, revoked_at) VALUES (1, ?, ?, ?)")
  rawDb.exec('BEGIN')
  for (let i = 0; i < 2500; i += 1) insSess.run([`h${i}`, farFuture, farFuture])
  rawDb.exec('COMMIT')
  const sessLeft = () => rawDb.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n
  const sliceEnv = { ASSETS: { async delete() {} }, PLAN_TIER: 'free' }
  rawDb.prepare("DELETE FROM settings WHERE key = 'ephemeral_retention_last_run:auth'").run([])
  const authRun = await retention.maybeRunScheduledEphemeralRetention(sliceEnv, 'auth')
  assert.strictEqual(sessLeft(), 1500, 'auth slice: ONE batch of 1000 for a table')
  assert.strictEqual(authRun.more, true)
  ok()

  // 9d. P3-4: the settings store really is compare-and-set (real SQL).
  const storeMod = load(path.join(SRC, 'lib/cronRotationStore.ts'))
  const real9 = storeMod.settingsRotationStore({})
  const st = (version, cursor) => ({ ...rot.emptyRotationState(), version, cursor })
  rawDb.prepare("DELETE FROM settings WHERE key = 'cron_rotation_state'").run([])
  assert.strictEqual(await real9.save(st(0, 1), null), true, 'first write inserts')
  assert.strictEqual(await real9.save(st(0, 2), null), false, 'a second first-writer loses')
  assert.strictEqual(await real9.save(st(1, 2), 0), true, 'matching version wins')
  assert.strictEqual(await real9.save(st(1, 0), 0), false, 'a stale version cannot rewind')
  assert.strictEqual((await real9.load()).cursor, 2)
  rawDb.prepare("UPDATE settings SET value = '' WHERE key = 'cron_rotation_state'").run([])
  assert.strictEqual((await real9.load()).version, 0, 'a blank row reads as version 0, not as no row')
  assert.strictEqual(await real9.save(st(1, 5), 0), true, 'and can be written over')
  ok()

  console.log(`ALL ${passed} CHECK GROUPS PASSED`)
}
main().catch((e) => { console.error(e); process.exit(1) })
