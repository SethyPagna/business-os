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
function makeStore(box, inv) {
  return {
    async load() { return box.text ? rot.parseRotationState(box.text) : null },
    async save(state) {
      if (inv.dead) return // process is gone: later writes never happen
      inv.spend(BOOKKEEPING / 2)
      box.text = JSON.stringify(state)
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
    { load: async () => null, save: async (s) => { cursorBox.text = JSON.stringify(s) } }, 0)
  assert.strictEqual(seen, 1, 'cursor already advanced while the step runs')
  const broken = await rot.runRotationTick([{ id: 'a', run: async () => ({ more: false }) }],
    { load: async () => { throw new Error('d1 down') }, save: async () => { throw new Error('d1 down') } }, 0)
  assert.strictEqual(broken.ok, true)
  const ran = []
  for (let i = 0; i < 4; i += 1) {
    await rot.runRotationTick([{ id: 'a', run: async () => { ran.push('a') } }, { id: 'b', run: async () => { ran.push('b') } }],
      { load: async () => { throw new Error('x') }, save: async () => {} }, i * rot.CRON_ROTATION_TICK_MS)
  }
  assert.ok(ran.includes('a') && ran.includes('b'), 'unreadable cursor still rotates by clock')
  ok()

  // 5. resume: a step with work left is re-run at most MAX_RESUME_STREAK times in a row, then rotation continues
  const order = []
  const rbox = { text: null }
  const rstore = { load: async () => (rbox.text ? rot.parseRotationState(rbox.text) : null), save: async (s) => { rbox.text = JSON.stringify(s) } }
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

  console.log(`ALL ${passed} CHECK GROUPS PASSED`)
}
main().catch((e) => { console.error(e); process.exit(1) })
