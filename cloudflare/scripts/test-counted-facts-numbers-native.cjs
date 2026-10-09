const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const h = require('./test-counted-quantity-exact-native.cjs')
const { fixture } = require('./test-stock-session-atomic.cjs')
const counted = h.loadStockSession('lib/countedDamagedStock.ts')
const stock = h.loadStockSession('lib/stockTransaction.ts')

function compat(raw) {
  const prepared = text => {
    const statement = raw.prepare(text)
    statement.setAllowUnknownNamedParameters?.(true)
    return statement
  }
  const args = params => Array.isArray(params) ? params : [params || {}]
  return {
    prepare: text => ({
      get: async params => prepared(text).get(...args(params)),
      all: async params => prepared(text).all(...args(params)),
      run: async params => prepared(text).run(...args(params)),
    }),
    batchOnce: async statements => {
      raw.exec('BEGIN IMMEDIATE')
      try {
        const out = statements.map(({ sql, params }) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)
          ? prepared(sql).all(...args(params)) : prepared(sql).run(...args(params)))
        raw.exec('COMMIT')
        return out
      } catch (error) { raw.exec('ROLLBACK'); throw error }
    },
  }
}
function capture(raw, branch = '1') {
  return raw.prepare('SELECT ' + counted.countedStockFactsSql('1', branch, "'[1]'") + ' AS facts').get().facts
}
const fields = [
  ['products', 'is_active', facts => facts.product[1]],
  ['branches', 'is_active', facts => facts.branch[1]],
  ['product_batches', 'is_active', facts => facts.receipts[0][2]],
  ['product_batches', 'batch_number', facts => facts.receipts[0][8]],
  ['products', 'stock_quantity', facts => facts.product[2]],
  ['products', 'cost_price_usd', facts => facts.product[3]],
  ['products', 'cost_price_khr', facts => facts.product[4]],
  ['branch_stock', 'quantity', facts => facts.branches[0][1]],
  ['branch_batch_stock', 'quantity', facts => facts.receipts[0][3]],
  ['product_batches', 'unit_cost_usd', facts => facts.receipts[0][4]],
  ['product_batches', 'received_quantity', facts => facts.receipts[0][10]],
  ['damaged_stock_lots', 'quantity', facts => facts.tags[0][2]],
  ['damaged_stock_lots', 'quantity_remaining', facts => facts.tags[0][3]],
  ['damaged_stock_lots', 'unit_cost_usd', facts => facts.tags[0][8]],
]
async function native(engine) {
  const f = fixture(sql => {
    h.seed(.30000000000000004, false)(sql)
    sql.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity)VALUES(1,1,'precision-receipt',1,1.0000000000000002,.30000000000000004);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,1,.30000000000000004)")
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counted-facts-numbers-'))
  let raw = f.sql
  if (engine === 'node') {
    const file = path.join(dir, 'synthetic.sqlite')
    fs.writeFileSync(file, f.sql.serialize())
    raw = new DatabaseSync(file)
  }
  const db = compat(raw), commit = rows => stock.executeStockTransaction(db, rows, 'once')
  try {
    await commit([{ sql: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,1,.09999999999999999,.09999999999999999,'damaged','remove',1.0000000000000002)" }])
    let controls = 0
    for (const [table, column, value] of fields) {
      const rawValue = raw.prepare('SELECT ' + column + ' AS value FROM ' + table).get().value
      assert.equal(value(JSON.parse(capture(raw))), rawValue, engine + ' ' + table + '.' + column + ' native numeric capture')
      controls++
    }
    for (const value of [.30000000000000004, 1.0000000000000002, .09999999999999999, Number.MIN_VALUE, Number.MAX_VALUE, 1e-100, 1e100, 2, null, 'legacy-cost-text']) {
      await commit([{ sql: 'UPDATE product_batches SET unit_cost_usd=@value WHERE id=1', params: { value } }])
      assert.equal(JSON.parse(capture(raw)).receipts[0][4], raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=1').get().unit_cost_usd)
      controls++
    }
    await commit([{ sql: "UPDATE product_batches SET batch_number='legacy-batch-text' WHERE id=1" }])
    assert.equal(JSON.parse(capture(raw)).receipts[0][8], 'legacy-batch-text')
    await commit([{ sql: 'UPDATE product_batches SET unit_cost_usd=1.0000000000000002 WHERE id=1' }])
    const initial = capture(raw), plan = new counted.CountedStockPlan(initial, 1)
    assert.throws(() => counted.planExactCountedOrdinaryChange(plan, 1, .1, 'consume'), error => error.code === 'invalid_decimal')
    const statements = new counted.CountedStockPlan(initial, 1).takeInitialGuard()
    const original = raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
    await commit([{ sql: 'UPDATE product_batches SET unit_cost_usd=1 WHERE id=1' }])
    assert.notEqual(capture(raw), initial, 'adjacent-double cost rival must change the captured source')
    await assert.rejects(commit(statements), counted.isCountedStockConflict)
    assert.equal(raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, original)
    assert.equal(raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=1').get().unit_cost_usd, 1)
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key IN ('stock_transaction_permit','maintenance')").get().n, 0)
    await assert.rejects(commit([{ sql: 'UPDATE products SET is_active=1.0000000000000002 WHERE id=1' }]), /product_has_stock/)
    assert.equal(raw.prepare('SELECT is_active FROM products WHERE id=1').get().is_active, 1)
    for (const [table, column] of fields.filter(([, column]) => column !== 'is_active')) {
      await commit([{ sql: 'UPDATE ' + table + ' SET ' + column + '=@value', params: { value: 1.0000000000000002 } }])
      const observed = capture(raw)
      await commit([{ sql: 'UPDATE ' + table + ' SET ' + column + '=1' }])
      assert.notEqual(capture(raw), observed, engine + ' all numeric source CAS: ' + table + '.' + column)
      controls++
    }
    await commit([
      { sql: 'UPDATE damaged_stock_lots SET quantity=0,quantity_remaining=0 WHERE id=1' },
      { sql: 'UPDATE branch_batch_stock SET quantity=.1 WHERE batch_id=1' },
      { sql: 'UPDATE branch_stock SET quantity=.1 WHERE product_id=1' },
      { sql: 'UPDATE products SET stock_quantity=.1 WHERE id=1' },
      { sql: 'UPDATE product_batches SET unit_cost_usd=2,received_quantity=.1 WHERE id=1' },
    ])
    const valid = new counted.CountedStockPlan(capture(raw), 1)
    await commit(counted.planExactCountedOrdinaryChange(valid, 1, .2, 'receive'))
    assert.equal(raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, .3)
    assert.equal(raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity, .3)
    assert.equal(raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1').get().quantity, .3)
    assert.equal(raw.prepare('SELECT received_quantity FROM product_batches WHERE id=1').get().received_quantity, .1)
    await commit([{ sql: "INSERT INTO branches(id,name,is_active)VALUES(2,'Empty',1)" }])
    assert.equal(JSON.parse(capture(raw, '2')).receipts[0][3], null)
    console.log(JSON.stringify({ engine, version: raw.prepare('SELECT sqlite_version() version').get().version, captureControls: controls, staleSource: 'refused', ordinaryGuardStatements: statements.length }))
  } finally {
    if (raw !== f.sql) raw.close()
    f.sql.close()
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
    fs.rmdirSync(dir)
  }
}
async function routes(engine = 'better') {
  const make = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const legacy of [false, true]) {
    const initial = legacy ? .30000000000000004 : .1
    const f = await h.world(make, tier, 'zero', sql => {
      h.seed(initial, true)(sql)
      sql.prepare('UPDATE product_batches SET received_quantity=? WHERE id=1').run(initial)
    })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counted-facts-route-'))
    let raw = f.sql, attempts = 0
    if (engine === 'node') {
      const file = path.join(dir, 'synthetic.sqlite')
      fs.writeFileSync(file, f.sql.serialize())
      raw = new DatabaseSync(file)
      const statement = (text, params = []) => ({ text, params,
        bind: (...values) => statement(text, values),
        first: async () => { attempts++; return raw.prepare(text).get(...params) || null },
        all: async () => { attempts++; return { results: raw.prepare(text).all(...params) } },
        run: async () => { attempts++; const result = raw.prepare(text).run(...params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
      })
      f.env.DB = { prepare: text => statement(text), batch: async rows => {
        attempts += rows.length
        raw.exec('BEGIN IMMEDIATE')
        try {
          const out = rows.map(row => {
            const value = raw.prepare(row.text)
            if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(row.text)) return { results: value.all(...row.params) }
            const result = value.run(...row.params)
            return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
          })
          raw.exec('COMMIT')
          return out
        } catch (error) { raw.exec('ROLLBACK'); throw error }
      } }
      f.state = () => ({
        physical: raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,
        cache: raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,
        lots: raw.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all(),
        tags: raw.prepare('SELECT id,batch_id,quantity_remaining FROM damaged_stock_lots ORDER BY id').all(),
        movements: raw.prepare('SELECT * FROM inventory_movements ORDER BY id').all(),
        operations: raw.prepare('SELECT * FROM stock_lot_adjustment_operations ORDER BY id').all(),
        history: raw.prepare('SELECT * FROM action_history ORDER BY id').all(),
      })
    }
    try {
      const before = f.state()
      const result = await f.call('/inventory/adjust', { productId: 1, branchId: 1, batchId: 1, type: 'add', quantity: legacy ? .1 : .2,
        attribution: 'correction', reason: 'Lossless counted source', client_request_id: 'facts-numbers-' + legacy })
      if (legacy) {
        assert.equal(result.status, 400)
        assert.equal(result.json.code, 'invalid_decimal')
        assert.deepEqual(f.state(), before, 'unsupported result must refuse before stock writes')
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.json))
        assert.equal(f.state().physical, .3)
        assert.equal(f.state().cache, .3)
        assert.equal(f.state().lots[0].quantity, .3)
        assert.equal(raw.prepare('SELECT received_quantity FROM product_batches WHERE id=1').get().received_quantity, .1)
      }
      if (engine === 'node') {
        assert.ok(attempts <= (tier === 'free' ? 50 : 1000), 'separate raw node D1 counter includes all waited request tails')
        assert.ok(attempts > 0)
        console.log(JSON.stringify({ engine, tier, legacy, status: result.status, actualD1Attempts: attempts }))
      }
    } finally {
      if (raw !== f.sql) raw.close()
      f.sql.close()
      for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
      fs.rmdirSync(dir)
    }
  }
}
async function main() {
  if (!process.argv.includes('--routes-only')) for (const engine of ['node', 'better']) await native(engine)
  if (!process.argv.includes('--capture-only')) for (const engine of ['node', 'better']) await routes(engine)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { native, routes }
