// Daily scheduled backup (owner ruling 12 Nov 2026): once per Cambodia business
// date (UTC+7), at the first heavy-cron tick at or after the close hour; never
// before close; never twice on one date even if a cron delivery overlaps,
// repeats or loses its state; a failed or skipped night is retried and a missed
// date is caught up. Open shifts are not consulted at all.
//
// The heavy lane is driven for real (dispatchCron + runRotationTick + the real
// maybeRunScheduledBackup over an in-memory R2) with a fake clock across three
// Cambodia days, including the UTC midnight that falls at 07:00 local. A MUTANT
// of lib/backupSchedule.ts without its same-date gate is run through the same
// simulation and must be caught.
// Run (from cloudflare/): node scripts/test-backup-daily-schedule-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

const SRC = path.join(__dirname, '..', 'src')
const HOUR = 3600 * 1000
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n')

function resolveTs(base) {
  for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return base
}
// A loader with its own cache so a mutant of one file never leaks into the real run.
function makeLoader(sourceOverrides = {}) {
  const cache = new Map()
  const stub = { getDb: () => ({ prepare: () => { throw new Error('no D1 in this test') } }) }
  const dbKey = path.normalize(path.join(SRC, 'lib/db.ts'))
  function load(file) {
    const key = path.normalize(file)
    if (key === dbKey) return stub
    if (cache.has(key)) return cache.get(key)
    const source = sourceOverrides[key] ?? fs.readFileSync(key, 'utf8')
    const { outputText } = ts.transpileModule(source, {
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
  return (rel) => load(path.join(SRC, rel))
}

let passed = 0
const ok = () => { passed += 1 }

// ---- the pure gate ---------------------------------------------------------
const real = makeLoader()
const sched = real('lib/backupSchedule.ts')
const Z = (iso) => Date.parse(iso)
const AFTER = real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' }).scheduledBackupAfterHourLocal
assert.strictEqual(AFTER, 21, 'the close hour is the plan-limits value')
assert.strictEqual(real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'free' }).scheduledBackupAfterHourLocal, 21)

// Cambodia date and hour, not UTC.
assert.strictEqual(real('lib/businessDateWindow.ts').BUSINESS_UTC_OFFSET_MINUTES, 420, 'the schedule module copies the business offset: they must agree')
assert.strictEqual(sched.businessDateOf(Z('2026-11-12T16:59:00Z')), '2026-11-12')
assert.strictEqual(sched.businessDateOf(Z('2026-11-12T17:00:00Z')), '2026-11-13', 'UTC+7 midnight is 17:00Z')
assert.strictEqual(sched.businessHourOf(Z('2026-11-12T15:17:00Z')), 22)
ok()

const gate = (now, last) => sched.scheduledBackupGate(Z(now), last ? Z(last) : 0, AFTER)
assert.deepStrictEqual(gate('2026-11-12T10:17:00Z', null), { due: true, reason: 'first' })
// Same business date, before and after close: never again.
assert.strictEqual(gate('2026-11-12T08:17:00Z', '2026-11-11T15:17:00Z').due, false, '15:17 local, yesterday ran: not due')
assert.strictEqual(gate('2026-11-12T15:17:00Z', '2026-11-11T15:17:00Z').due, true, '22:17 local: due')
assert.strictEqual(gate('2026-11-12T15:17:00Z', '2026-11-12T14:30:00Z').reason, 'already-today', 'ran 21:30 local: not again at 22:17')
// UTC midnight (07:00 local) falls inside one business date: it must not re-arm the gate.
assert.strictEqual(gate('2026-11-13T00:17:00Z', '2026-11-12T15:17:00Z').due, false, '07:17 local on the 13th, ran 22:17 on the 12th')
// Local midnight (17:00Z) starts a new date but it is before close, so not due ...
assert.deepStrictEqual(gate('2026-11-12T18:17:00Z', '2026-11-12T15:17:00Z'), { due: false, reason: 'before-close' })
// ... unless a whole date went by with none (the 22:17 run failed): catch up at once.
assert.deepStrictEqual(gate('2026-11-12T18:17:00Z', '2026-11-11T15:17:00Z'), { due: true, reason: 'catch-up' })
// A clock that ran ahead never produces a second backup.
assert.strictEqual(gate('2026-11-12T08:00:00Z', '2026-11-13T15:00:00Z').due, false)
ok()

// Coverage: only a finalized FULL SCHEDULED backup counts (F2); manual and section backups never do, at any hour.
const item = (iso, source, finalized = true, scope) => ({ uploaded: iso, source, finalized, scope })
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T05:00:00Z', 'manual')], AFTER), 0, 'an afternoon manual backup covers nothing')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'manual')], AFTER), 0, 'a manual backup after close does not cover the date (it sits in the manual pool and is evicted)')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'manual', true, 'full')], AFTER), 0, 'nor does a full manual one')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'manual', true, 'section')], AFTER), 0, 'nor does a section backup')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'scheduled', true, 'section')], AFTER), 0, 'a section backup never counts, whoever stamped it')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'scheduled', true, 'full')], AFTER), Z('2026-11-12T15:00:00Z'))
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T05:00:00Z', 'scheduled')], AFTER), Z('2026-11-12T05:00:00Z'))
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'scheduled', false)], AFTER), 0, 'an unfinished backup covers nothing')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', null)], AFTER), 0, 'an unstamped legacy backup is not known to be a scheduled full one')
assert.strictEqual(sched.scheduledBackupCoverageMs([item('2026-11-12T15:00:00Z', 'scheduled')], AFTER), Z('2026-11-12T15:00:00Z'), 'a scheduled backup from before scope was stamped is full by construction')
ok()

// ---- the heavy lane over three Cambodia days -------------------------------
function fakeR2() {
  const objects = new Map()
  return {
    objects,
    async list({ prefix, cursor }) {
      void cursor
      const out = [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: 1, uploaded: v.uploaded, customMetadata: v.customMetadata }))
      return { objects: out, truncated: false }
    },
    // Only the lifecycle sidecars (state.json) have a body; everything else reads as absent, like a body-less test double.
    async get(key) { const v = objects.get(key); return v && v.body !== undefined ? { json: async () => JSON.parse(v.body) } : null },
    async head(key) { return objects.get(key) ? { key } : null },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k) },
  }
}

// `managed` makes the fake R2 behave like production: createCloudflareBackup returns as soon as the manifest is written
// ('copying'), and the queue ends the set LATER -- finalized, failed or partial -- between heavy ticks. managed(iso) answers
// { end: 'finalized' | 'failed' | 'partial', copyMs } for the set created at that instant.
async function simulate(load, { failFirstNightAt = null, loseStateAfterEachTick = false, managed = null, throwFrom = null } = {}) {
  const backupMod = load('lib/backup.ts')
  const rot = load('lib/cronRotation.ts')
  const dispatch = load('lib/cronDispatch.ts')
  const schedule = load('lib/backupSchedule.ts')
  const env = { PLAN_TIER: 'paid', ASSETS: fakeR2() }
  const limits = load('lib/planTier.ts').getPlanLimits(env)
  let clock = 0
  const realNow = Date.now
  Date.now = () => clock
  const created = []
  const attempted = []
  let failuresLeft = failFirstNightAt ? 1 : 0
  const create = async (e, source) => {
    attempted.push(clock)
    if (throwFrom !== null && clock >= throwFrom) throw new Error('simulated backup failure')
    if (failFirstNightAt && clock === failFirstNightAt && failuresLeft > 0) { failuresLeft -= 1; throw new Error('simulated backup failure') }
    created.push({ at: clock, source })
    const name = `business-os-cloudflare-${created.length}`
    if (!managed) {
      e.ASSETS.objects.set(`backups/cloudflare/${name}.json`, { uploaded: new Date(clock), customMetadata: { source, lifecycle: 'none' } })
      return { key: 'x', status: 'finalized' }
    }
    const outcome = managed(new Date(clock).toISOString())
    const status = outcome.end === 'partial' ? 'partial' : 'copying'
    e.ASSETS.objects.set(`backups/cloudflare/${name}.json`, { uploaded: new Date(clock), customMetadata: { source, lifecycle: 'sidecar-v1' } })
    const state = { format: 'business-os-cloudflare-backup-state', version: 1, backupName: name, status }
    e.ASSETS.objects.set(`backups/cloudflare/${name}/state.json`, { uploaded: new Date(clock), body: JSON.stringify(state) })
    if (status === 'copying') settling.push({ name, endsAt: clock + outcome.copyMs, end: outcome.end })
    return { key: 'x', status }
  }
  // The queue consumer finishing a set after create() returned.
  const settling = []
  const settle = (e) => {
    for (const set of [...settling]) {
      if (set.endsAt > clock) continue
      settling.splice(settling.indexOf(set), 1)
      const key = `backups/cloudflare/${set.name}/state.json`
      const state = JSON.parse(e.ASSETS.objects.get(key).body)
      state.status = set.end
      e.ASSETS.objects.set(key, { uploaded: new Date(clock), body: JSON.stringify(state) })
    }
  }
  const ran = []
  const table = {}
  const store = (key) => ({
    load: async () => (table[key] ? rot.parseRotationState(table[key]) : null),
    save: async (s, expected) => {
      const stored = table[key] ? rot.parseRotationState(table[key]).version : null
      if (stored !== expected) return false
      table[key] = JSON.stringify(s); return true
    },
  })
  const deps = () => ({
    drainTelegram: async () => {},
    rotationSteps: () => [],
    storeFor: store,
    heavySteps: () => [
      { id: 'backup', attemptWindow: (ms) => schedule.scheduledBackupNightOf(ms, limits.scheduledBackupAfterHourLocal), run: async () => { ran.push({ at: clock, step: 'backup' }); return backupMod.maybeRunScheduledBackup(env, clock, create) } },
      { id: 'image-audit', minIntervalMs: 5 * HOUR, run: async () => { ran.push({ at: clock, step: 'image-audit' }) } },
    ],
    heavySelect: (steps, state, now) => schedule.pickHeavyStepIndex(steps, state, now, limits.scheduledBackupAfterHourLocal, limits.scheduledBackupMaxAttemptsPerDay),
  })
  try {
    const tick = async (iso) => {
      clock = Z(iso)
      settle(env)
      await dispatch.dispatchCron(rot.CRON_HEAVY, clock, deps())
      if (loseStateAfterEachTick) delete table[rot.CRON_HEAVY_STATE_KEY]
    }
    // Steady state: the previous night's run already happened (11 Nov 22:17 local), through the lane itself.
    await tick('2026-11-11T15:17:00Z')
    assert.strictEqual(created.length, 1, 'the seed night')
    created.length = 0; ran.length = 0
    let afterTick = -1, afterDirect = -1
    // 12 Nov 00:17Z (07:17 local) through 14 Nov 17:17Z, every 3 h: the real heavy cron.
    for (let t = Z('2026-11-12T00:17:00Z'); t <= Z('2026-11-14T17:17:00Z'); t += 3 * HOUR) {
      await tick(new Date(t).toISOString())
      if (t === Z('2026-11-12T15:17:00Z') && !failFirstNightAt && !managed && throwFrom === null) {
        // Extra deliveries of the same night: a repeat of that firing, then direct retries well after close.
        await tick('2026-11-12T16:17:00Z') // 23:17 local, same 3 h slot
        afterTick = created.length
        clock = Z('2026-11-12T16:50:00Z'); await backupMod.maybeRunScheduledBackup(env, clock, create)
        clock = Z('2026-11-12T16:58:00Z'); await backupMod.maybeRunScheduledBackup(env, clock, create) // 23:58 local
        afterDirect = created.length
      }
    }
    return { created, attempted, ran, afterTick, afterDirect, table, rot, env }
  } finally {
    Date.now = realNow
  }
}

const dates = (created) => created.map((c) => sched.businessDateOf(c.at))
const localHour = (c) => sched.businessHourOf(c.at)

;(async () => {
  const run = await simulate(real)
  // 12 Nov, 13 Nov, 14 Nov each get exactly one, at the 22:17 local tick; none before close, none at 01:17 / 07:17.
  assert.deepStrictEqual(dates(run.created), ['2026-11-12', '2026-11-13', '2026-11-14'], 'one backup per Cambodia date')
  assert.deepStrictEqual(run.created.map(localHour), [22, 22, 22], 'each one on the first tick at or after the close hour')
  assert.deepStrictEqual(run.created.map((c) => new Date(c.at).toISOString()), ['2026-11-12T15:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'])
  assert.ok(run.created.every((c) => c.source === 'scheduled'))
  ok()
  // Nothing before close: every backup visit ran at local 22:xx, no earlier tick even visited the backup step.
  assert.ok(run.ran.filter((r) => r.step === 'backup').every((r) => sched.businessHourOf(r.at) >= AFTER), 'the backup step is only visited after close')
  assert.strictEqual(run.ran.filter((r) => r.step === 'backup').length, 3, 'exactly three visits: one per night')
  ok()
  // The repeat delivery and the two direct calls on the 12th took nothing beyond the one backup.
  assert.strictEqual(run.afterTick, 1, 'a repeat delivery on the same date takes nothing')
  assert.strictEqual(run.afterDirect, 1, 'direct retries at 23:50 and 23:58 local take nothing')
  ok()
  // The other heavy step still runs, on the ticks the backup does not use, held to its own interval.
  const audits = run.ran.filter((r) => r.step === 'image-audit').length
  assert.ok(audits >= 6, 'image audit still gets its turns')
  ok()
  // Cron state lost after every tick: R2 alone still keeps it to one per date.
  const lost = await simulate(real, { loseStateAfterEachTick: true })
  assert.deepStrictEqual(dates(lost.created), ['2026-11-12', '2026-11-13', '2026-11-14'], 'one per date even with no cron state at all')
  ok()
  // The 22:17 run fails: no OK visit is recorded, so the next tick (01:17 local) catches the missed date up, once.
  const failed = await simulate(real, { failFirstNightAt: Z('2026-11-12T15:17:00Z') })
  assert.deepStrictEqual(failed.created.map((c) => new Date(c.at).toISOString()), ['2026-11-12T18:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'], 'retried at the next tick, then back to the nightly slot')
  assert.strictEqual(sched.businessHourOf(failed.created[0].at), 1)
  ok()

  // F1: createCloudflareBackup returns at once and the asset copy ends LATER. A set that ends failed (an upload deleted mid-copy)
  // or partial must not count as that night's backup: the next heavy tick (same date) takes a new one. 'copying' that
  // finalizes later is done and is never repeated.
  {
    const at = (iso) => new Date(Z(iso)).toISOString()
    const seed = at('2026-11-11T15:17:00Z')
    const failedSet = at('2026-11-12T15:17:00Z')
    const outcomes = (map) => (iso) => map[iso] || { end: 'finalized', copyMs: 20 * 60 * 1000 }
    const iso = (t) => new Date(t).toISOString()
    // The 22:17 set ends failed 20 minutes later; the 01:17 retry finalizes.
    const asyncFail = await simulate(real, { managed: outcomes({ [failedSet]: { end: 'failed', copyMs: 20 * 60 * 1000 } }) })
    assert.deepStrictEqual(asyncFail.created.map((c) => iso(c.at)), ['2026-11-12T15:17:00.000Z', '2026-11-12T18:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'],
      'a set that ends failed asynchronously is retried on the next heavy tick, then back to the nightly slot')
    // A set that finalizes is done: no retry.
    const asyncOk = await simulate(real, { managed: outcomes({}) })
    assert.deepStrictEqual(asyncOk.created.map((c) => iso(c.at)), ['2026-11-12T15:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'], 'a finalized set is never repeated')
    // Created partial (no queue bound): also not done.
    const partial = await simulate(real, { managed: outcomes({ [failedSet]: { end: 'partial', copyMs: 0 } }) })
    assert.strictEqual(partial.created.length >= 4 && iso(partial.created[1].at), '2026-11-12T18:17:00.000Z', 'a partial set is retried too')
    // Still copying at the next tick (3 h later): the visit polls, takes nothing new, and the night completes once it finalizes.
    const slow = await simulate(real, { managed: outcomes({ [failedSet]: { end: 'finalized', copyMs: 4 * 60 * 60 * 1000 } }) })
    assert.deepStrictEqual(slow.created.map((c) => iso(c.at)), ['2026-11-12T15:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'], 'a copy still running is not duplicated')
    const polls = slow.ran.filter((r) => r.step === 'backup').map((r) => iso(r.at))
    assert.ok(polls.includes('2026-11-12T18:17:00.000Z') && polls.includes('2026-11-12T21:17:00.000Z'), 'the lane keeps polling the unfinished night')
    assert.ok(!polls.includes('2026-11-13T00:17:00.000Z'), 'once it finalized the night is done: the next tick runs the other step')
    assert.ok(seed)
    ok()
  }

  // F2 by behaviour: after close on the 12th an admin's reset/repair takes a section pre-backup (stamped manual); the night
  // run must still take the full backup. Same for a full manual one.
  {
    const backupMod = real('lib/backup.ts')
    for (const meta of [{ source: 'manual', scope: 'section' }, { source: 'manual', scope: 'full' }, { source: 'manual' }]) {
      const env = { PLAN_TIER: 'paid', ASSETS: fakeR2() }
      env.ASSETS.objects.set('backups/cloudflare/business-os-cloudflare-a.json', { uploaded: new Date('2026-11-11T15:17:00Z'), customMetadata: { source: 'scheduled', scope: 'full', lifecycle: 'none' } })
      env.ASSETS.objects.set('backups/cloudflare/business-os-cloudflare-b.json', { uploaded: new Date('2026-11-12T14:40:00Z'), customMetadata: { ...meta, lifecycle: 'none' } })
      let took = 0
      const result = await backupMod.maybeRunScheduledBackup(env, Z('2026-11-12T15:17:00Z'), async () => { took += 1; return { key: 'x', status: 'finalized' } })
      assert.strictEqual(took, 1, `a ${JSON.stringify(meta)} backup after close must not satisfy the night's backup`)
      assert.strictEqual(result.skipped, false)
    }
    const sectionSrc = read('lib/backup.ts')
    assert.ok(sectionSrc.includes("scope: includeAssets ? 'full' : 'section'"), 'every manifest is stamped full or section')
    ok()
  }

  // F4: a backup that keeps failing is bounded per business night by getPlanLimits(env).scheduledBackupMaxAttemptsPerDay, and the
  // image audit keeps getting its own ticks. (At the F4 review's head: 9 of 9 ticks a day re-ran the backup, the audit never.)
  {
    const MAX = real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' }).scheduledBackupMaxAttemptsPerDay
    assert.strictEqual(MAX, 2)
    assert.strictEqual(real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'free' }).scheduledBackupMaxAttemptsPerDay, 2)
    const nights = (times) => { const n = {}; for (const t of times) { const k = sched.scheduledBackupNightOf(t, AFTER); n[k] = (n[k] || 0) + 1 } return n }
    const iso = (t) => new Date(t).toISOString()
    // Every try throws (a D1 dump that cannot finish) from the 12th on.
    const thrown = await simulate(real, { throwFrom: Z('2026-11-12T00:00:00Z') })
    assert.deepStrictEqual(thrown.attempted.slice(1).map(iso), ['2026-11-12T15:17:00.000Z', '2026-11-12T18:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-13T18:17:00.000Z', '2026-11-14T15:17:00.000Z'],
      'two tries on the first night (22:17 and 01:17), none after, a fresh allowance next night')
    assert.ok(Object.values(nights(thrown.attempted.slice(1))).every((n) => n <= MAX), 'never more than the allowance per night')
    // Every set ends failed asynchronously.
    const asyncFailed = await simulate(real, { managed: (at) => (Z(at) >= Z('2026-11-12T00:00:00Z') ? { end: 'failed', copyMs: 20 * 60 * 1000 } : { end: 'finalized', copyMs: 1 }) })
    assert.deepStrictEqual(asyncFailed.created.map((c) => iso(c.at)), ['2026-11-12T15:17:00.000Z', '2026-11-12T18:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-13T18:17:00.000Z', '2026-11-14T15:17:00.000Z'],
      'failed sets are bounded the same way')
    // The audit is not starved: between the retry at 01:17 and the next close it runs, in both failure modes.
    for (const run of [thrown, asyncFailed]) {
      const audits = run.ran.filter((r) => r.step === 'image-audit').map((r) => r.at)
      assert.ok(audits.some((t) => t > Z('2026-11-12T18:17:00Z') && t < Z('2026-11-13T15:17:00Z')), 'the image audit runs after the night is given up')
      assert.ok(audits.length >= 5, 'the audit keeps its own cadence while backups fail: ' + audits.length)
    }
    // The pure lane decision: failures at the allowance in this very night hand the tick to the other step; next night does not.
    const steps = [{ id: 'backup' }, { id: 'image-audit' }]
    const rec = (startedAt, failures) => ({ steps: { backup: { startedAt, finishedAt: startedAt, okAt: null, error: 'x', failures, killed: 0, runs: failures, windowKey: sched.scheduledBackupNightOf(Z(startedAt), AFTER), windowFailures: failures } } })
    assert.strictEqual(sched.pickHeavyStepIndex(steps, rec('2026-11-12T18:17:00Z', 2), Z('2026-11-12T21:17:00Z'), AFTER, 2), 1, 'allowance spent: the other step')
    assert.strictEqual(sched.pickHeavyStepIndex(steps, rec('2026-11-12T18:17:00Z', 1), Z('2026-11-12T21:17:00Z'), AFTER, 2), 0, 'one try left: backup')
    assert.strictEqual(sched.pickHeavyStepIndex(steps, rec('2026-11-12T18:17:00Z', 2), Z('2026-11-13T15:17:00Z'), AFTER, 2), 0, 'next night: backup again')
    assert.ok(read('lib/planTier.ts').includes('scheduledBackupMaxAttemptsPerDay'), 'the allowance is a plan limit')
    assert.ok(read('index.ts').includes('attemptWindow: (nowMs) => scheduledBackupNightOf(nowMs, getPlanLimits(env).scheduledBackupAfterHourLocal)'), 'the real backup step counts failures per night')
    ok()
  }

  // Retention: 7 daily backups (owner 13 Nov 2026). The 8th removes the oldest SCHEDULED one only; manual backups keep their own
  // newest 2 and are never evicted by a daily run (nor do they evict dailies).
  {
    const backupMod = real('lib/backup.ts')
    const limits = real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' })
    assert.strictEqual(limits.scheduledBackupKeep, 7)
    assert.strictEqual(real('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'free' }).scheduledBackupKeep, 7)
    const env = { PLAN_TIER: 'paid', ASSETS: fakeR2() }
    const put = (n, iso, source) => env.ASSETS.objects.set(`backups/cloudflare/business-os-cloudflare-${n}.json`, { uploaded: new Date(iso), customMetadata: { source, lifecycle: 'none' } })
    put('m1', '2026-11-01T05:00:00Z', 'manual'); put('m2', '2026-11-02T05:00:00Z', 'manual'); put('m3', '2026-11-03T05:00:00Z', 'manual')
    const create = async (e, source) => { const at = new Date(clockNow); put(`s${at.toISOString()}`, at.toISOString(), source); return { key: 'x', status: 'finalized' } }
    let clockNow = 0
    const names = () => [...env.ASSETS.objects.keys()].map((k) => k.replace('backups/cloudflare/business-os-cloudflare-', '').replace('.json', ''))
    const scheduledNames = () => names().filter((n) => n.startsWith('s')).sort()
    for (let day = 0; day < 8; day += 1) {
      clockNow = Z('2026-11-05T15:17:00Z') + day * 24 * HOUR
      await backupMod.maybeRunScheduledBackup(env, clockNow, create)
      if (day === 6) assert.strictEqual(scheduledNames().length, 7, 'seven daily backups are all kept')
      if (day === 6) assert.ok(names().includes('s2026-11-05T15:17:00.000Z'), 'the oldest daily is still there on day 7')
    }
    assert.strictEqual(scheduledNames().length, 7, 'the 8th daily keeps seven')
    assert.ok(!names().includes('s2026-11-05T15:17:00.000Z'), 'the 8th daily removed the oldest scheduled backup')
    assert.ok(names().includes('s2026-11-06T15:17:00.000Z') && names().includes('s2026-11-12T15:17:00.000Z'))
    assert.deepStrictEqual(names().filter((n) => n.startsWith('m')).sort(), ['m2', 'm3'], 'manual backups keep their own newest 2, untouched by the daily runs')
    // A manual prune (what Back up now runs) leaves all seven dailies alone.
    await backupMod.pruneCloudflareBackups(env, 2)
    assert.strictEqual(scheduledNames().length, 7, 'a manual backup never evicts the daily week')
    ok()
  }

  // Source pins: the close hour comes from plan limits, the heavy lane selects by schedule, a copy in progress is retried.
  const backupSrc = read('lib/backup.ts')
  assert.ok(backupSrc.includes('getPlanLimits(env).scheduledBackupAfterHourLocal'), 'close hour from getPlanLimits')
  assert.ok(!/SCHEDULED_BACKUP_MIN_INTERVAL_MS|scheduledBackupIsRecent/.test(backupSrc), 'the 5.5 h interval gate is gone')
  assert.ok(!/\b(?:2[0-3]|1\d)\s*\)?\s*\*?\s*HOUR/.test(read('lib/backupSchedule.ts')), 'no literal close hour in the schedule module')
  const indexSrc = read('index.ts')
  assert.ok(indexSrc.includes('heavySelect: (steps, state, nowMs) => pickHeavyStepIndex(steps, state, nowMs, getPlanLimits(env).scheduledBackupAfterHourLocal, getPlanLimits(env).scheduledBackupMaxAttemptsPerDay)'))
  assert.ok(indexSrc.includes("step('backup', () => maybeRunScheduledBackup(env))") && !indexSrc.includes("throw new Error('backup already in progress"), 'an unfinished set is reported incomplete, not thrown')
  assert.ok(!/shift/i.test(read('lib/backupSchedule.ts').replace(/\/\/.*$/gm, '')), 'open shifts are never consulted by the schedule')
  assert.ok(read('routes/backups.ts').includes("cadence: 'daily-after-close'") && !read('routes/backups.ts').includes('intervalHours: 6'))
  ok()

  // ---- MUTANT: the same-date gate removed. The simulation must catch it. ----
  const key = path.normalize(path.join(SRC, 'lib/backupSchedule.ts'))
  const original = fs.readFileSync(key, 'utf8')
  const gateLine = /^\s*if \(covered >= today\) return \{ due: false, reason: 'already-today' \}\r?\n/m
  assert.ok(gateLine.test(original), 'the mutation target exists')
  const mutant = makeLoader({ [key]: original.replace(gateLine, '') })
  let caught = false
  try {
    const bad = await simulate(mutant)
    assert.deepStrictEqual(dates(bad.created), ['2026-11-12', '2026-11-13', '2026-11-14'])
    assert.strictEqual(bad.afterDirect, 1)
  } catch (error) {
    caught = error instanceof assert.AssertionError
  }
  assert.ok(caught, 'a schedule without its same-date gate must fail this simulation')
  ok()

  // A second mutant: the gate keyed on the UTC date instead of the Cambodia date.
  const utcMutant = makeLoader({ [key]: original.replace("new Date(ms + BUSINESS_UTC_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 10)", 'new Date(ms).toISOString().slice(0, 10)') })
  let caughtUtc = false
  try {
    const bad = await simulate(utcMutant)
    assert.deepStrictEqual(dates(bad.created), ['2026-11-12', '2026-11-13', '2026-11-14'])
    assert.deepStrictEqual(bad.created.map((c) => new Date(c.at).toISOString()), ['2026-11-12T15:17:00.000Z', '2026-11-13T15:17:00.000Z', '2026-11-14T15:17:00.000Z'])
    assert.strictEqual(sched.businessDateOf(Z('2026-11-12T17:00:00Z')), '2026-11-13')
    assert.strictEqual(utcMutant('lib/backupSchedule.ts').businessDateOf(Z('2026-11-12T17:00:00Z')), '2026-11-13')
  } catch (error) {
    caughtUtc = error instanceof assert.AssertionError
  }
  assert.ok(caughtUtc, 'a schedule keyed on the UTC date must fail too')
  ok()

  console.log(`test-backup-daily-schedule-pure: ${passed} groups passed`)
})().catch((error) => { console.error(error); process.exit(1) })
