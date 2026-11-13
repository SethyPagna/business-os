'use strict'
// R3-2: when the heavy lane's cron record cannot be read, the backup step (whose per-night allowance lives in that record) must
// not run. Before, a throwing store.load skipped the selector and the slot/clock position could land on the backup with an empty
// record: killed nights then took 3-4 full D1 reads. Control cases keep the normal paths intact.
// Run (from cloudflare/): node scripts/test-backup-state-unreadable-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
const Z = (iso) => Date.parse(iso)
function resolveTs(base) {
  for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  return base
}
const cache = new Map()
const dbKey = path.normalize(path.join(SRC, 'lib/db.ts'))
function load(file) {
  const key = path.normalize(file)
  if (key === dbKey) return { getDb: () => { throw new Error('no D1 here') } }
  if (cache.has(key)) return cache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
  const mod = { exports: {} }
  cache.set(key, mod.exports)
  const req = Module.createRequire(key)
  new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
  cache.set(key, mod.exports)
  return mod.exports
}
const rot = load(path.join(SRC, 'lib/cronRotation.ts'))
const sched = load(path.join(SRC, 'lib/backupSchedule.ts'))
const limits = load(path.join(SRC, 'lib/planTier.ts')).PLAN_LIMITS_BY_TIER.paid

const memStore = (initial) => {
  let state = initial ?? null
  return {
    get state() { return state },
    load: async () => { if (state === 'throw') throw new Error('settings read failed'); return state },
    save: async (s, expected) => {
      if (state === 'throw') throw new Error('settings write failed')
      if ((state ? state.version : null) !== expected) return false
      state = JSON.parse(JSON.stringify(s))
      return true
    },
  }
}
const ran = []
// The same wiring as index.ts's cronHeavySteps: the backup requires its state.
const mkSteps = () => [
  { id: 'backup', requiresState: true, run: async () => { ran.push('backup') } },
  { id: 'image-audit', run: async () => { ran.push('image-audit') } },
]
const select = (s, st, ms) => sched.pickHeavyStepIndex(s, st, ms, limits.scheduledBackupAfterHourLocal, limits.scheduledBackupMaxAttemptsPerDay, limits.scheduledBackupCopyPollGapMinutes * 60 * 1000)
const now = Z('2026-11-12T15:17:00Z') // 22:17 local, the due hour

async function main() {
  let passed = 0
  // Control: a readable record at the due hour picks the backup.
  ran.length = 0
  await rot.runRotationTick(mkSteps(), memStore(rot.emptyRotationState()), now, { select })
  assert.deepEqual(ran, ['backup'], 'control: readable state, gate due, the backup runs')
  passed += 1

  // A never-written row (the real store answers null) is the first ever visit: it may run, and the claim is saved first.
  const first = memStore(null)
  ran.length = 0
  await rot.runRotationTick(mkSteps(), first, now, { select })
  assert.deepEqual(ran, ['backup'])
  assert.ok(first.state.steps.backup.startedAt, 'the claim is written before the work, so a kill is counted on the next visit')
  passed += 1

  // The load throws: whatever position the slot or the clock names, the backup does not run; the other step keeps the lane moving.
  for (const slot of [0, 1, 2, 3, 4, 5]) {
    ran.length = 0
    const r = await rot.runRotationTick(mkSteps(), memStore('throw'), now, { select, slot })
    assert.ok(!ran.includes('backup'), `load failed, slot ${slot}: no backup`)
    assert.deepEqual(ran, ['image-audit'], `load failed, slot ${slot}: the lane still runs the other step`)
    assert.equal(r.stepId, 'image-audit')
  }
  for (let i = 0; i < 8; i += 1) {
    ran.length = 0
    await rot.runRotationTick(mkSteps(), memStore('throw'), now + i * rot.CRON_ROTATION_TICK_MS)
    assert.ok(!ran.includes('backup'), `load failed, clock position ${i}, no selector: no backup`)
  }
  passed += 1

  // Nothing else to run: the visit is skipped with a reason, not run.
  ran.length = 0
  const alone = await rot.runRotationTick([mkSteps()[0]], memStore('throw'), now, { select })
  assert.deepEqual(ran, [])
  assert.equal(alone.skipped, 'state-unreadable')
  assert.equal(alone.stepId, null)
  passed += 1

  // A step that does not require its state still rotates by the clock when the load fails (existing behaviour).
  ran.length = 0
  await rot.runRotationTick([{ id: 'a', run: async () => { ran.push('a') } }, { id: 'b', run: async () => { ran.push('b') } }], memStore('throw'), now)
  assert.equal(ran.length, 1)
  passed += 1

  // The production step list carries the flag.
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(/onClaim: \(info\) => \{ priorFailuresTonight = info\.windowFailures \},\n\s+requiresState: true,/.test(indexSrc), "index.ts: the backup step requires its state")
  passed += 1

  console.log(`ALL ${passed} CHECK GROUPS PASSED`)
}
main().catch((e) => { console.error(e); process.exit(1) })
