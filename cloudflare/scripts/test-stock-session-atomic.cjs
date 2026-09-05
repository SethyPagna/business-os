// Real SQLite regressions for POST /api/inventory/sessions' commit kernel.
// These fixtures began red against the legacy receive path: batch metadata
// survived a later stock failure, and a lost acknowledgement doubled stock.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')

function loadStockSession(entry = 'lib/stockSession.ts') {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (normalized === 'routes/inventory.ts' && name === '../lib/auth') return {
        requireAuth: async (c, next) => { c.set('user', { ...user, permissions: JSON.stringify({ inventory: true, products: true }) }); await next() },
      }
      if (normalized === 'routes/inventory.ts' && name.startsWith('../') && !['../lib/stockSession', '../lib/permissions'].includes(name)) return {}
      if (name === './cache') return { bumpVersion: async () => {} }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name.startsWith('./')) return load(`lib/${name.slice(2)}.ts`)
      if (name.startsWith('../')) return load(`${name.slice(3)}.ts`)
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load(entry)
}

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.pragma('foreign_keys = ON')
  sql.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(1, 'Serum', 'SER-1', 2, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
  `)
  let failAfterMetadata = false
  let loseNextAcknowledgement = false
  let beforeNextBatch = null
  let beforeRevisionRead = null
  const wrap = (text, params = []) => ({
    text, params,
    async first() { return sql.prepare(text).get(...params) || null },
    async all() { return { results: sql.prepare(text).all(...params) } },
    async run() {
      const result = sql.prepare(text).run(...params)
      return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    },
  })
  const runBatch = (statements) => sql.transaction(() => statements.map((statement) => {
    if (failAfterMetadata && /INSERT INTO branch_batch_stock/i.test(statement.text)) {
      failAfterMetadata = false
      throw new Error('injected failure after batch metadata')
    }
    const result = sql.prepare(statement.text).run(...statement.params)
    return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
  }))()
  const envDb = {
    prepare(text) {
      if (beforeRevisionRead && /^SELECT entity_type,entity_key,revision FROM stock_session_revisions/.test(text)) {
        const mutate = beforeRevisionRead
        beforeRevisionRead = null
        mutate(sql)
      }
      const bare = wrap(text)
      return {
        bind(...params) { return wrap(text, params) },
        first: () => bare.first(),
        all: () => bare.all(),
        run: () => bare.run(),
      }
    },
    async batch(statements) {
      if (beforeNextBatch) {
        const mutate = beforeNextBatch
        beforeNextBatch = null
        mutate(sql)
      }
      const result = runBatch(statements)
      if (loseNextAcknowledgement) {
        loseNextAcknowledgement = false
        throw new Error('D1_ERROR: network reset after commit')
      }
      return result
    },
  }
  return {
    sql, env: { DB: envDb },
    failReceiptAfterMetadata() { failAfterMetadata = true },
    loseNextCommitAcknowledgement() { loseNextAcknowledgement = true },
    beforeCommit(mutate) { beforeNextBatch = mutate },
    beforeRevisionCapture(mutate) { beforeRevisionRead = mutate },
  }
}

const user = {
  id: 7, username: 'stock-user', name: 'Stock User', organization_id: null,
  role_id: null, permissions: JSON.stringify({ inventory: true, products: true }), is_active: 1,
}

function receiveRequest(requestId = 'stock-request-001', quantity = 5) {
  return {
    client_request_id: requestId, mode: 'stock_in',
    defaults: { branch_id: 1, received_date: '2026-09-05' },
    items: [{ line_id: 'line-001', kind: 'receive', product_id: 1, quantity, unit_cost_usd: 2 }],
  }
}

function receiptState(sql) {
  return {
    product: sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get(),
    branch: sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get(),
    batches: sql.prepare('SELECT id, received_quantity, received_cost_usd FROM product_batches ORDER BY id').all(),
    lots: sql.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY id').all(),
    operations: sql.prepare('SELECT COUNT(*) count FROM stock_session_operations').get().count,
    members: sql.prepare('SELECT COUNT(*) count FROM stock_session_members').get().count,
    movements: sql.prepare("SELECT COUNT(*) count FROM inventory_movements WHERE movement_type='stock_in'").get().count,
    audits: sql.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='stock_session_create'").get().count,
    history: sql.prepare("SELECT COUNT(*) count FROM action_history WHERE entity='stock_session'").get().count,
    snapshots: sql.prepare("SELECT COUNT(*) count FROM undo_snapshots WHERE kind='stock.session'").get().count,
  }
}

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}

async function main() {
  const { commitStockSession, StockSessionError } = loadStockSession()

  await check('explicit batch return identity excludes a competing received-date lot', async () => {
    const f = fixture()
    const { receiveBatchStock } = loadStockSession('lib/productBatches.ts')
    const { getDb } = loadStockSession('lib/db.ts')
    const db = getDb(f.env)
    const common = { productId: 1, branchId: 1, quantity: 1 }
    const first = await receiveBatchStock(db, { ...common, receivedDate: '2026-09-05' })
    const second = await receiveBatchStock(db, { ...common, receivedDate: '2026-09-06' })
    const result = await receiveBatchStock(db, { ...common, quantity: 4, batchId: second.batchId, receivedDate: '2026-09-05' })
    assert.deepEqual(result, { ...second, created: false })
    assert.deepEqual(f.sql.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all(), [
      { batch_id: first.batchId, quantity: 1 }, { batch_id: second.batchId, quantity: 5 },
    ])
  })

  for (const [label, mutation] of [
    ['rename', "UPDATE products SET name='Concurrent name' WHERE id=1"],
    ['stock ABA', 'UPDATE branch_stock SET quantity=1 WHERE product_id=1; UPDATE branch_stock SET quantity=0 WHERE product_id=1'],
    ['product ABA', "UPDATE products SET name='Temporary' WHERE id=1; UPDATE products SET name='Serum' WHERE id=1"],
  ]) {
    await check(`${label} between snapshot and revision capture rejects without durable session rows`, async () => {
      const f = fixture()
      f.beforeRevisionCapture((sql) => sql.exec(mutation))
      await assert.rejects(() => commitStockSession(f.env, user, receiveRequest()),
        (error) => error instanceof StockSessionError && error.code === 'stale_state')
      const state = receiptState(f.sql)
      assert.equal(state.product.stock_quantity, 0)
      for (const key of ['operations', 'members', 'movements', 'audits', 'history', 'snapshots']) assert.equal(state[key], 0, key)
    })
  }

  await check('actual POST sessions rejects coerced numeric JSON shapes with no writes', async () => {
    const app = loadStockSession('routes/inventory.ts').default
    for (const value of [true, false, '1', [1], {}, null]) {
      const f = fixture()
      const before = receiptState(f.sql)
      const response = await app.request('/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receiveRequest('stock-invalid-type', value)),
      }, f.env, { waitUntil() {} })
      assert.equal(response.status, 400, JSON.stringify(value))
      assert.deepEqual(receiptState(f.sql), before)
    }
    for (const field of ['product_id', 'branch_id', 'batch_id', 'supplier_id', 'unit_cost_usd']) {
      const f = fixture()
      const request = receiveRequest('stock-invalid-field')
      request.items[0][field] = true
      const response = await app.request('/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      }, f.env, { waitUntil() {} })
      assert.equal(response.status, 400, field)
      assert.equal(receiptState(f.sql).operations, 0, field)
    }
    const f = fixture()
    const response = await app.request('/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receiveRequest('stock-valid-type', 1)),
    }, f.env, { waitUntil(promise) { promise.catch(() => {}) } })
    assert.equal(response.status, 200, await response.text())
    assert.equal(receiptState(f.sql).product.stock_quantity, 1)
  })

  await check('metadata failure rolls back the entire stock session', async () => {
    const f = fixture()
    const before = receiptState(f.sql)
    f.failReceiptAfterMetadata()
    await assert.rejects(() => commitStockSession(f.env, user, receiveRequest()), /injected failure after batch metadata/)
    assert.deepEqual(receiptState(f.sql), before)
  })

  await check('lost commit acknowledgement replays one durable receipt without doubling', async () => {
    const f = fixture()
    f.loseNextCommitAcknowledgement()
    const first = await commitStockSession(f.env, user, receiveRequest())
    assert.equal(first.replayed, true)
    const second = await commitStockSession(f.env, user, receiveRequest())
    assert.equal(second.replayed, true)
    assert.equal(second.operationId, first.operationId)
    assert.deepEqual(receiptState(f.sql), {
      product: { stock_quantity: 5 }, branch: { quantity: 5 },
      batches: [{ id: 1, received_quantity: 5, received_cost_usd: 10 }],
      lots: [{ batch_id: 1, branch_id: 1, quantity: 5 }],
      operations: 1, members: 1, movements: 1, audits: 1, history: 1, snapshots: 1,
    })
  })

  await check('same actor and request id with changed canonical payload conflicts', async () => {
    const f = fixture()
    await commitStockSession(f.env, user, receiveRequest('stock-request-002', 5))
    await assert.rejects(
      () => commitStockSession(f.env, user, receiveRequest('stock-request-002', 6)),
      (error) => error instanceof StockSessionError && error.statusCode === 409 && error.code === 'idempotency_conflict',
    )
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 5)
  })

  await check('later receipts accumulate money and quantity without replacing first attribution', async () => {
    const f = fixture()
    const first = receiveRequest('stock-request-first', 5)
    first.items[0].supplier_name = 'Supplier A'
    first.items[0].payment_status = 'paid'
    await commitStockSession(f.env, user, first)
    const second = receiveRequest('stock-request-later', 5)
    second.items[0].supplier_name = 'Supplier B'
    second.items[0].unit_cost_usd = 3
    second.items[0].payment_status = 'credit'
    second.items[0].credit_due_date = '2026-09-30'
    await commitStockSession(f.env, user, second)
    assert.deepEqual(f.sql.prepare(`SELECT supplier_name,unit_cost_usd,payment_status,credit_due_date,received_quantity,received_cost_usd
      FROM product_batches`).get(), {
      supplier_name: 'Supplier A', unit_cost_usd: 2, payment_status: 'paid', credit_due_date: null,
      received_quantity: 10, received_cost_usd: 25,
    })
  })

  await check('revision guard rejects an ABA stock race with the same visible quantity', async () => {
    const f = fixture()
    f.beforeCommit((sql) => {
      sql.prepare('UPDATE branch_stock SET quantity=1 WHERE product_id=1 AND branch_id=1').run()
      sql.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=1').run()
    })
    await assert.rejects(
      () => commitStockSession(f.env, user, receiveRequest('stock-request-aba')),
      (error) => error instanceof StockSessionError && error.statusCode === 409 && error.code === 'stale_state',
    )
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM stock_session_operations').get().count, 0)
  })

  await check('create_receive commits every durable row together', async () => {
    const f = fixture()
    const receipt = await commitStockSession(f.env, user, {
      client_request_id: 'stock-request-003', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Counter supplier' },
      items: [{ line_id: 'line-new', kind: 'create_receive', quantity: 3,
        product: { name: 'New Cream', barcode: 'CREAM-1', cost_price_usd: 4, selling_price_usd: 7, stock_quantity: 3, branch_id: 1, tag_label: 'New' } }],
    })
    assert.equal(receipt.replayed, false)
    assert.equal(receipt.createdCount, 1)
    assert.equal(receipt.items[0].createdProduct, true)
    const created = f.sql.prepare("SELECT id,stock_quantity,cost_price_usd,purchase_price_usd FROM products WHERE name='New Cream'").get()
    assert.deepEqual(created, { id: 2, stock_quantity: 3, cost_price_usd: 4, purchase_price_usd: 0 })
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1').get().quantity, 3)
    assert.equal(f.sql.prepare('SELECT received_quantity FROM product_batches WHERE variant_product_id=2').get().received_quantity, 3)
    assert.equal(f.sql.prepare('SELECT COUNT(*) count FROM stock_session_operations').get().count, 1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='stock_session_create'").get().count, 1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM action_history WHERE entity='stock_session'").get().count, 1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) count FROM undo_snapshots WHERE kind='stock.session'").get().count, 1)
  })

  await check('the 25-line maximum stays one atomic receipt and 26 lines reject', async () => {
    const f = fixture()
    const items = Array.from({ length: 25 }, (_unused, index) => ({
      line_id: `line-${String(index + 1).padStart(2, '0')}`, kind: 'receive', product_id: 1, quantity: 1,
    }))
    const receipt = await commitStockSession(f.env, user, {
      client_request_id: 'stock-request-025', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', unit_cost_usd: 2 }, items,
    })
    assert.equal(receipt.memberCount, 25)
    assert.equal(receipt.totalQuantity, 25)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 25)
    await assert.rejects(() => commitStockSession(f.env, user, {
      client_request_id: 'stock-request-026', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-06' },
      items: [...items, { line_id: 'line-26', kind: 'receive', product_id: 1, quantity: 1 }],
    }), (error) => error instanceof StockSessionError && error.code === 'line_limit')
  })

  if (failures.length) throw new Error(`${failures.length} stock-session atomic regression(s) failed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
