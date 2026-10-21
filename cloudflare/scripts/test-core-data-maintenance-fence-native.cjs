const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', `${name}.ts`), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(withProductStockGuard(request => {
    assert.ok(Object.hasOwn(dependencies, request), `unexpected import ${request}`)
    return dependencies[request]
  }), module, module.exports)
  return module.exports
}
const dbModule = load('db', { './importMaintenanceFence': {} })
function world({ through } = {}) {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const sql of loadAll({ through })) raw.exec(sql)
  const control = { afterDiscovery: null, stockAttempts: 0 }
  function prepared(sql, values = []) {
    const args = () => /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
    return {
      bind: (...next) => prepared(sql, next),
      all: async () => {
        const results = raw.prepare(sql).all(...args())
        if (/^\s*SELECT id FROM branches WHERE is_active = 1/.test(sql) && control.afterDiscovery) {
          const hook = control.afterDiscovery; control.afterDiscovery = null; hook(raw)
        }
        return { results }
      },
      run: async () => {
        if (/INSERT INTO branch_stock/i.test(sql)) control.stockAttempts++
        const result = raw.prepare(sql).run(...args())
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
  }
  const core = load('coreDataInvariants', {
    './stockTransaction': load('stockTransaction'), './db': dbModule, './customTableName': load('customTableName'), './sqlBinding': load('sqlBinding'),
    './passwordHash': { hashPassword: async () => 'synthetic-test-hash' },
    './passwordPolicy': load('passwordPolicy'),
    './roleDefaults': load('roleDefaults'),
  })
  return { raw, control, core, env: { DB: { prepare: prepared, async batch(statements) {
    raw.exec('BEGIN IMMEDIATE')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  } }, BUSINESS_OS_ADMIN_PASSWORD: 'synthetic-test-password' } }
}
async function seeded() {
  const w = world({ through: 241 })
  await w.core.ensureCoreDataInvariants(w.env)
  w.raw.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(100,'Missing active',1,7),(101,'Inactive',0,9),(102,'Covered',1,2); INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 102,id,2 FROM branches WHERE is_default=1")
  // Seed the historical removed-stock anomaly before installing its write guard.
  for (const sql of loadAll().slice(loadAll({ through: 241 }).length)) w.raw.exec(sql)
  w.control.stockAttempts = 0
  return w
}
const stock = w => w.raw.prepare('SELECT * FROM branch_stock ORDER BY product_id,branch_id').all()
let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`) }
}
async function main() {
  for (const mode of ['held', 'acquired-after-discovery']) {
    for (const flag of ['{"mode":"restore","token":"held"}', '{"mode":"branch-cutover","token":"held"}', '{corrupt']) {
      await check(`${mode} ${flag} preserves the preexisting no-op or raced typed-refusal boundary`, async () => {
        const w = await seeded()
        try {
          const before = stock(w)
          const hold = raw => seedStockFixture(raw, () => raw.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(flag))
          if (mode === 'held') hold(w.raw)
          else w.control.afterDiscovery = hold
          if (mode === 'held') {
            const result = await w.core.ensureCoreDataInvariantsOnce(w.env)
            assert.ok(result.organizationId)
            assert.ok(result.adminUserId)
            assert.equal(result.adminUserCreated, false)
          } else {
            await assert.rejects(w.core.ensureCoreDataInvariantsOnce(w.env), error => error.code === 'stock_schema_unavailable')
          }
          assert.equal(w.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
          assert.deepEqual(stock(w), before)
          assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, flag)
          assert.equal(w.control.stockAttempts, 0)
          w.raw.exec("DELETE FROM system_flags WHERE key='maintenance'")
          await w.core.ensureCoreDataInvariants(w.env)
          assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=100').get().quantity, 7)
          assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=101').get().n, 0)
          assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=102').get().quantity, 2)
        } finally { w.raw.close() }
      })
    }
  }
  for (const retireSource of [true, false]) {
    await check(`completed maintenance invalidates captured branch selection retired=${retireSource}`, async () => {
      const w = await seeded()
      try {
        const before = stock(w)
        w.control.afterDiscovery = raw => {
          seedStockFixture(raw, () => {
            raw.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{}')")
            raw.exec(`UPDATE branches SET is_default=0,is_active=${retireSource ? 0 : 1} WHERE name='Shop'; UPDATE branches SET name='LC Store',is_default=1 WHERE name='Warehouse'`)
            raw.exec("DELETE FROM system_flags WHERE key='maintenance'")
          })
        }
        await w.core.ensureCoreDataInvariants(w.env)
        assert.deepEqual(stock(w), before)
        assert.equal(w.control.stockAttempts, 1)
        assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=100').get().n, 0)
        await w.core.ensureCoreDataInvariants(w.env)
        const destination = w.raw.prepare('SELECT b.name,b.is_active,s.quantity FROM branch_stock s JOIN branches b ON b.id=s.branch_id WHERE s.product_id=100').get()
        assert.deepEqual({ ...destination }, { name: 'LC Store', is_active: 1, quantity: 7 })
      } finally { w.raw.close() }
    })
  }
  await check('fresh setup and repeated direct reseed keep baseline branch and stock behavior without maintenance', async () => {
    const w = world()
    try {
      seedStockFixture(w.raw, () => w.raw.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(100,'Fresh active',1,4)"))
      assert.throws(() => w.raw.exec("INSERT INTO products(name) VALUES('unadmitted probe')"), /stock_transaction_required/)
      const result = await w.core.ensureCoreDataInvariants(w.env)
      assert.equal(result.adminUserCreated, true)
      assert.deepEqual(w.raw.prepare('SELECT name,is_default FROM branches ORDER BY id').all().map(row => [row.name, row.is_default]), [['Shop', 1], ['Warehouse', 0]])
      assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=100').get().quantity, 4)
      const before = stock(w)
      await w.core.ensureCoreDataInvariants(w.env)
      assert.deepEqual(stock(w), before)
      assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1)
    } finally { w.raw.close() }
  })
  assert.equal(failures, 0, 'startup maintenance fence regressions')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
