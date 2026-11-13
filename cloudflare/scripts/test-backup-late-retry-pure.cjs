'use strict'
// R3-3: a poll from the PREVIOUS night must not push the next night's first try (22:17) to 01:17. The other half of R3-3 (a late first
// try at 16:17/19:17 losing its retry) is accepted: waiving the gap there starves the image audit for 12 h behind a stuck copy.
// Run (from cloudflare/): node scripts/test-backup-late-retry-pure.cjs
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
function load(file) {
  const key = path.normalize(file)
  if (cache.has(key)) return cache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
  const mod = { exports: {} }
  cache.set(key, mod.exports)
  const req = Module.createRequire(key)
  new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
  cache.set(key, mod.exports)
  return mod.exports
}
const sched = load(path.join(SRC, 'lib/backupSchedule.ts'))
const rot = load(path.join(SRC, 'lib/cronRotation.ts'))
const limits = load(path.join(SRC, 'lib/planTier.ts')).PLAN_LIMITS_BY_TIER.paid
const gapMs = limits.scheduledBackupCopyPollGapMinutes * 60 * 1000
const steps = [{ id: 'backup', run: async () => {} }, { id: 'image-audit', run: async () => {} }]
// Local times are UTC+7: 22:17 local = 15:17Z.
const pick = (nowIso, pollIso, okIso = null) => {
  const state = rot.emptyRotationState()
  state.steps.backup = { startedAt: pollIso, finishedAt: pollIso, okAt: okIso, error: null, failures: 0, killed: 0, runs: 1, pollAt: pollIso }
  return sched.pickHeavyStepIndex(steps, state, Z(nowIso), limits.scheduledBackupAfterHourLocal, limits.scheduledBackupMaxAttemptsPerDay, gapMs)
}
const BACKUP = 0
const AUDIT = 1

// A poll at 19:17 local (12:17Z) belongs to the previous night: the next tick, 22:17, is a new night and its first try is not delayed.
assert.equal(pick('2026-11-12T15:17:00Z', '2026-11-12T12:17:00Z', '2026-11-11T09:00:00Z'), BACKUP, '19:17 poll, 22:17 look: tonight is a new night, no gap')

// Accepted (documented, not fixed): a 16:17 poll still spaces the 19:17 look, so the audit keeps its tick behind a stuck copy.
assert.equal(pick('2026-11-12T12:17:00Z', '2026-11-12T09:17:00Z', '2026-11-11T09:00:00Z'), AUDIT)
// Controls: inside one night the gap still spaces the polls (a copy that never finishes polls about every other tick).
assert.equal(pick('2026-11-12T18:17:00Z', '2026-11-12T15:17:00Z', '2026-11-11T09:00:00Z'), AUDIT, '22:17 poll, 01:17 look: the audit gets the tick')
assert.equal(pick('2026-11-12T21:17:00Z', '2026-11-12T15:17:00Z', '2026-11-11T09:00:00Z'), BACKUP, '22:17 poll, 04:17 look: after the gap, poll again')
assert.equal(pick('2026-11-12T21:17:00Z', '2026-11-12T18:17:00Z', '2026-11-11T09:00:00Z'), AUDIT, '01:17 poll, 04:17 look: spaced')
console.log('ALL 1 CHECK GROUPS PASSED')
