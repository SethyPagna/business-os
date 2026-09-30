// READS-CUT (10): four Paid-sized constants ignored the plan tier and ran at
// their Paid value on a Free deployment: the CSV materialize window
// (importEngine.ts, whose own comment says it was held at 100 for Workers Free),
// the stock-action classify window and dispatch read (importEngine.ts), and the
// audit-log retention delete batch (audit.ts scheduled sweep and the manual
// clear route in compat.ts). They now read getPlanLimits(env). Paid keeps
// today's number exactly; Free gets the smaller one.
//
// Run: node scripts/test-plan-tier-sizing-pure.cjs
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { countingDb } = require('./harness/counting_d1.cjs')

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
function loadModule(rel, requireShim) {
  const out = ts.transpileModule(src(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(rel),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', out)(module.exports, requireShim, module)
  return module.exports
}
const noImports = (id) => { throw new Error(`unexpected import ${id}`) }

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// Each load is a fresh module instance: resolvePlanTier caches per isolate.
const planTierFor = (tier) => {
  const mod = loadModule('lib/planTier.ts', noImports)
  return { mod, env: { PLAN_TIER: tier } }
}

async function main() {
  await check('Paid keeps the four current numbers; Free is smaller and positive', async () => {
    const { mod } = planTierFor('paid')
    const paid = mod.PLAN_LIMITS_BY_TIER.paid
    const free = mod.PLAN_LIMITS_BY_TIER.free
    assert.deepStrictEqual(
      [paid.materializeRowsPerChunk, paid.stockActionClassifyWindow, paid.stockActionDispatchRead, paid.auditLogRetentionBatch],
      [600, 480, 400, 5000],
      'Paid values are the constants that were hard-coded',
    )
    assert.strictEqual(free.materializeRowsPerChunk, 100, "importEngine's own comment: held at 100 for the Free 10 ms CPU limit")
    for (const key of ['materializeRowsPerChunk', 'stockActionClassifyWindow', 'stockActionDispatchRead', 'auditLogRetentionBatch']) {
      assert.ok(Number.isInteger(free[key]) && free[key] > 0 && free[key] < paid[key], `${key}: free ${free[key]} < paid ${paid[key]}`)
    }
    assert.strictEqual(free.auditLogRetentionBatch, free.ephemeralDeleteBatch, 'the sibling retention sweep already uses 1000 on Free')
  })

  await check('the importEngine constants are gone and their readers ask the tier', async () => {
    const engine = src('lib/importEngine.ts')
    assert.ok(!/^const MATERIALIZE_ROWS_PER_CHUNK\b/m.test(engine), 'no module-level materialize constant')
    assert.ok(!/^const STOCK_ACTION_CLASSIFY_WINDOW\b/m.test(engine), 'no module-level classify constant')
    assert.ok(!/^const STOCK_ACTION_DISPATCH_READ\b/m.test(engine), 'no module-level dispatch constant')
    assert.ok(/getPlanLimits\(env\)\.materializeRowsPerChunk/.test(engine))
    assert.ok(/limits\.stockActionClassifyWindow/.test(engine))
    assert.ok(/LIMIT \$\{limits\.stockActionDispatchRead\}/.test(engine))
    assert.ok(!/STOCK_ACTION_CLASSIFY_WINDOW|STOCK_ACTION_DISPATCH_READ|MATERIALIZE_ROWS_PER_CHUNK/.test(engine.replace(/\/\/[^\n]*/g, '')), 'no stale references outside comments')
  })

  async function retentionRun(tier, oldRows) {
    const { mod: planTier, env } = planTierFor(tier)
    const raw = openDb(loadAll())
    raw.db.exec('BEGIN')
    const insert = raw.db.prepare(`INSERT INTO audit_logs(action, entity, details, created_at) VALUES ('update', 'sale', '{}', '2020-01-01 00:00:00')`)
    for (let i = 0; i < oldRows; i++) insert.run()
    raw.db.exec('COMMIT')
    const counted = countingDb(raw)
    const audit = loadModule('lib/audit.ts', (id) => {
      if (id === './db') return { getDb: () => counted.db }
      if (id === './actorSnapshot') return { ACTOR_USERNAME_SQL: '', resolveActorUsername: () => null }
      return require(id)
    })
    const result = await audit.maybeRunScheduledAuditLogRetention(env, planTier.getPlanLimits(env).auditLogRetentionBatch)
    const deleteStatements = counted.stats.log.filter((sql) => /^DELETE FROM audit_logs/.test(sql)).length
    const left = raw.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE created_at = '2020-01-01 00:00:00'`).get().n
    return { result, deleteStatements, left, statements: counted.stats.statements, builder: audit.buildAuditLogRetentionDeleteSql }
  }

  await check('scheduled audit retention: Paid deletes in one 5000 batch, Free in 1000-row batches, same end state', async () => {
    const paid = await retentionRun('paid', 2500)
    const free = await retentionRun('free', 2500)
    assert.strictEqual(paid.left, 0)
    assert.strictEqual(free.left, 0, 'Free still clears the whole backlog')
    assert.strictEqual(paid.result.deleted, 2500)
    assert.strictEqual(free.result.deleted, 2500)
    assert.strictEqual(paid.deleteStatements, 1, 'Paid: unchanged single statement')
    assert.strictEqual(free.deleteStatements, 3, 'Free: 1000 + 1000 + 500')
    console.log(`  2500 expired rows: Paid ${paid.deleteStatements} delete statement(s), Free ${free.deleteStatements} bounded statements (each statement touches <=1000 rows instead of 5000)`)
  })

  await check('the batch size is the builder argument; the default is the old 5000', async () => {
    const run = await retentionRun('paid', 0)
    assert.match(run.builder(), /LIMIT 5000\s*\)/)
    assert.match(run.builder(1000), /LIMIT 1000\s*\)/)
    assert.throws(() => run.builder(0), /positive integer/)
    assert.throws(() => run.builder(Number.NaN), /positive integer/)
    assert.throws(() => run.builder('5000; DROP TABLE audit_logs'), /positive integer/)
  })

  await check('the manual clear route (compat.ts) sizes its batch and its loop from the same tier value', async () => {
    const compat = src('routes/compat.ts')
    assert.ok(/const auditBatch = getPlanLimits\(c\.env\)\.auditLogRetentionBatch/.test(compat))
    assert.ok(/prepare\(buildAuditLogRetentionDeleteSql\(auditBatch\)\)/.test(compat))
    assert.ok(/if \(n < auditBatch\) break/.test(compat))
    assert.ok(!/n < 5000/.test(compat), 'no hard-coded loop bound left in the route')
    const audit = src('lib/audit.ts')
    assert.ok(/buildAuditLogRetentionDeleteSql\(batchSize\)/.test(audit) && /if \(n < batchSize\) break/.test(audit))
    assert.ok(!/planTier/.test(audit.replace(/\/\/[^\n]*/g, '')), 'audit.ts takes the size as a parameter, so standalone harnesses need no planTier shim')
    const index = src('index.ts')
    assert.ok(/maybeRunScheduledAuditLogRetention\(env, getPlanLimits\(env\)\.auditLogRetentionBatch\)/.test(index), 'the cron passes the tier value')
    assert.ok(!/n < 5000/.test(audit), 'no hard-coded loop bound left in the scheduled sweep')
  })

  console.log(`test-plan-tier-sizing-pure: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
