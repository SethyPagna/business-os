// The restore's deletion plan must never outgrow what one restore transaction holds, and when a plan does outgrow it the
// restore must chunk it in order and fail loudly, not refuse every full restore.
//
// Why: RC3 composed two lanes that each added a backed-up table (stock_crossing_alerts is cleared on restore, and
// product_conflict_marks joined BACKUP_TABLES). Each lane passed on its own base at exactly 100 statements; together they made
// 101, and every full restore threw "Restore deletion plan exceeds the atomic statement limit". The old budget check in
// test-backup-tables-completeness-pure counted BACKUP_TABLES + 1 + overhead and missed the stock_crossing_alerts DELETE, so it
// read 100 and passed. This test counts the statements the real restore submits.
//
// Run: node scripts/test-backup-restore-delete-plan-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

function fixturePrefix(name, boundary, expose) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
  const end = source.indexOf(boundary)
  assert.ok(end > 0, `fixture boundary: ${name}`)
  return new Function('require', '__dirname', source.slice(0, end) + '\nreturn ' + expose)(require, __dirname)
}
const bulk = fixturePrefix('test-sale-bulk-status-pure.cjs', 'async function run() {', '{fixture,seed,request,replay,sales}')
const { backup, makeFakeR2, makeFakeKV, maintenance, restoreOwned } = fixturePrefix('test-backup-pure.cjs', 'let passed = 0', '{backup:backupModuleObj.exports,makeFakeR2,makeFakeKV,maintenance,restoreOwned}')
const backupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'backup.ts'), 'utf8')
const txSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'stockTransaction.ts'), 'utf8')
const overhead = Number((txSource.match(/return businessStatements \+ (\d+)/) || [])[1])
assert.ok(Number.isInteger(overhead), 'stockTransactionStatementCount overhead not found')

// A D1 stand-in over SQLite that records the size of every batch and runs each as one transaction.
function binding(sql, batches) {
  function statement(text, params = []) {
    return {
      text, params, bind: (...values) => statement(text, values),
      async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
      async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
      async run() { const r = sqliteD1Call(sql.prepare(text), 'run', params); return { success: true, meta: { changes: r.changes } } },
    }
  }
  return { prepare: text => statement(text), async batch(items) {
    batches.push(items.map(item => item.text))
    return sql.transaction(() => items.map(s => {
      if (/^SELECT\b/i.test(s.text.trim())) return { success: true, results: sqliteD1Call(sql.prepare(s.text), 'all', s.params) }
      const r = sqliteD1Call(sql.prepare(s.text), 'run', s.params)
      return { success: true, meta: { changes: r.changes } }
    }))()
  } }
}

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}`); throw error }
}

async function main() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network forbidden in restore plan fixture') }
  const f = bulk.fixture()
  const batches = []
  f.env.DB = binding(f.sql, batches)
  f.env.ASSETS = makeFakeR2()
  f.env.CACHE = makeFakeKV()
  try {
    bulk.seed(f, 1)

    await check('constants: the limit is derived from the overhead and stays at the size production already submits', () => {
      assert.equal(backup.RESTORE_DELETE_STATEMENTS_PER_TRANSACTION + overhead, backup.RESTORE_TRANSACTION_MAX_STATEMENTS)
      assert.ok(backup.RESTORE_TRANSACTION_MAX_STATEMENTS <= 300, 'do not exceed the 300 statements the import engine submits per db.batch() without new evidence')
      const importChunk = Number((fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts'), 'utf8').match(/D1_IMPORT_BATCH_CHUNK_SIZE: number = (\d+)|const D1_IMPORT_BATCH_CHUNK_SIZE = (\d+)/) || []).slice(1).find(Boolean))
      assert.equal(importChunk, 300, 'the precedent this limit cites moved; re-justify RESTORE_TRANSACTION_MAX_STATEMENTS')
    })

    await check('a full restore submits ONE deletion transaction, and the model of its size matches what it really submits', async () => {
      const created = await backup.createCloudflareBackup(f.env, 'manual')
      assert.equal(Object.keys(JSON.parse(f.env.ASSETS._store.get(created.key).body).tables).length, backup.BACKUP_TABLES.length)
      f.sql.prepare("INSERT INTO stock_crossing_alerts(alert_key,product_id,branch_id,tier,sale_id,quantity_before,quantity_after,created_at) VALUES ('k',1,1,'low',1,12,9,'2026-10-25T01:00:00.000Z')").run()
      batches.length = 0
      await restoreOwned(f.env, created.key)
      const deleteBatches = batches.filter(batch => batch.some(text => /^DELETE FROM "?settings"?$/i.test(text.trim())))
      assert.equal(deleteBatches.length, 1, 'the whole plan fits one transaction: restore stays atomic while it can')
      // One DELETE per backed-up table, the products update, the stock_crossing_alerts clear, plus the permit and release.
      const expected = backup.BACKUP_TABLES.length + 1 + 1 + overhead
      assert.equal(deleteBatches[0].length, expected, 'the restore plan changed shape; update the model here and the completeness budget')
      assert.ok(deleteBatches[0].some(text => /DELETE FROM "?stock_crossing_alerts"?/i.test(text)), 'the crossing-log clear is part of the plan')
      assert.ok(expected <= backup.RESTORE_TRANSACTION_MAX_STATEMENTS, `a full restore needs ${expected} statements against ${backup.RESTORE_TRANSACTION_MAX_STATEMENTS}`)
      console.log(`  full restore deletion plan: ${expected}/${backup.RESTORE_TRANSACTION_MAX_STATEMENTS} statements, ${backup.RESTORE_TRANSACTION_MAX_STATEMENTS - expected} statements of headroom before it would chunk`)
    })

    await check('the restore runs its deletes through the chunking helper and no longer refuses a long plan', () => {
      assert.ok(backupSource.includes('runRestoreDeletePlan(env.DB, deletes,'), 'restoreCloudflareBackup must submit its deletes through runRestoreDeletePlan')
      assert.ok(!backupSource.includes('exceeds the atomic statement limit'), 'a long deletion plan is chunked, not refused')
    })

    // A parent/child chain with a real foreign key, so an out-of-order or half-applied plan is visible.
    const chain = ['plan_t1', 'plan_t2', 'plan_t3', 'plan_t4', 'plan_t5', 'plan_t6', 'plan_t7']
    function buildChain() {
      dropChain()
      for (const [i, name] of chain.entries()) {
        f.sql.exec(`CREATE TABLE ${name} (id INTEGER PRIMARY KEY${i ? `, parent_id INTEGER NOT NULL REFERENCES ${chain[i - 1]}(id)` : ''})`)
        f.sql.prepare(`INSERT INTO ${name}(id${i ? ', parent_id' : ''}) VALUES (1${i ? ', 1' : ''})`).run()
      }
    }
    const dropChain = () => { for (const name of [...chain].reverse()) f.sql.exec(`DROP TABLE IF EXISTS ${name}`) }
    const planFor = () => [...chain].reverse().map(name => f.env.DB.prepare(`DELETE FROM ${name}`))
    const counts = () => chain.map(name => f.sql.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n)
    const authorize = async (token, key) => maintenance.restoreStockAuthority(f.env, token, key)

    await check('splitRestoreDeletePlan keeps order, never exceeds the size, and a plan that fits is one part', () => {
      const plan = Array.from({ length: 10 }, (_, i) => i)
      assert.deepEqual(backup.splitRestoreDeletePlan(plan, 4), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]])
      assert.deepEqual(backup.splitRestoreDeletePlan(plan, 10), [plan])
      assert.deepEqual(backup.splitRestoreDeletePlan(plan, 400), [plan])
      assert.deepEqual(backup.splitRestoreDeletePlan([], 4), [])
      assert.deepEqual(backup.splitRestoreDeletePlan(plan, 3).flat(), plan, 'the parts concatenate back to the plan in order')
      assert.throws(() => backup.splitRestoreDeletePlan(plan, 0))
    })

    const owner = await maintenance.beginMaintenance(f.env, { backupKey: 'plan-fixture.json', startedBy: 'delete plan fixture' })
    try {
      await check('a plan longer than one transaction runs as ordered consecutive transactions and clears every table without a foreign-key break', async () => {
        buildChain()
        batches.length = 0
        const submitted = await backup.runRestoreDeletePlan(f.env.DB, planFor(), () => authorize(owner.token, 'plan-fixture.json'), 3)
        assert.deepEqual(counts(), [0, 0, 0, 0, 0, 0, 0])
        assert.deepEqual(f.sql.pragma('foreign_key_check'), [])
        const mine = batches.filter(batch => batch.some(text => /plan_t/.test(text)))
        assert.deepEqual(mine.map(batch => batch.length - overhead), [3, 3, 1], 'seven deletes at three per transaction')
        assert.ok(mine.every(batch => batch.length <= 3 + overhead))
        assert.equal(submitted, 7 + 3 * overhead, 'the returned count includes each transaction\'s own overhead')
        assert.deepEqual(mine.flat().filter(text => /^DELETE FROM plan_t/.test(text)).map(text => text.slice(-1)), ['7', '6', '5', '4', '3', '2', '1'], 'children are deleted before parents across the part boundaries')
        dropChain()
      })

      await check('a plan that fits stays one all-or-nothing transaction: a failure inside it changes no rows', async () => {
        buildChain()
        batches.length = 0
        const plan = planFor()
        plan.splice(4, 0, f.env.DB.prepare('DELETE FROM plan_missing_table'))
        await assert.rejects(() => backup.runRestoreDeletePlan(f.env.DB, plan, () => authorize(owner.token, 'plan-fixture.json'), 300), /plan_missing_table/)
        assert.deepEqual(counts(), [1, 1, 1, 1, 1, 1, 1], 'nothing half-deleted')
        assert.equal(batches.filter(batch => batch.some(text => /plan_t/.test(text))).length, 1)
        dropChain()
      })

      await check('a failure in a first part leaves the database untouched and surfaces the original error', async () => {
        buildChain()
        const plan = planFor()
        plan.splice(1, 0, f.env.DB.prepare('DELETE FROM plan_missing_table'))
        await assert.rejects(() => backup.runRestoreDeletePlan(f.env.DB, plan, () => authorize(owner.token, 'plan-fixture.json'), 3),
          error => /plan_missing_table/.test(error.message) && !/partly cleared/.test(error.message))
        assert.deepEqual(counts(), [1, 1, 1, 1, 1, 1, 1])
        dropChain()
      })

      await check('a failure after an earlier part committed is reported as a partly cleared database, never as success', async () => {
        buildChain()
        const plan = planFor()
        plan.splice(5, 0, f.env.DB.prepare('DELETE FROM plan_missing_table'))
        await assert.rejects(() => backup.runRestoreDeletePlan(f.env.DB, plan, () => authorize(owner.token, 'plan-fixture.json'), 3),
          error => /part 2 of 3/.test(error.message) && /partly cleared/.test(error.message) && /re-run the restore/.test(error.message) && /plan_missing_table/.test(error.message))
        assert.deepEqual(counts(), [1, 1, 1, 1, 0, 0, 0], 'the first part committed (children gone); the failing part rolled back whole')
        assert.deepEqual(f.sql.pragma('foreign_key_check'), [], 'parents were never deleted ahead of their children')
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0, 'no permit is left behind')
        dropChain()
      })
    } finally {
      await maintenance.endMaintenance(f.env, owner.token)
    }
  } finally { f.sql.close(); globalThis.fetch = originalFetch }
  console.log(`\n${passed} check(s) passed.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
