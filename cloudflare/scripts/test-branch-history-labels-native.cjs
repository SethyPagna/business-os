const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const actor = { id: 7, name: 'Operator', username: 'operator', organization_id: null, role_id: null, is_active: 1,
  permissions: JSON.stringify({ branches: true, inventory: true, products: true, product_cost_edit: true, product_cost_view: true }) }
function load(entry, overrides = {}) {
  const cache = new Map()
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      const name = id.split('/').at(-1)
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name === 'cache') return { bumpVersion: async () => {} }
      if (name === 'broadcastHub') return { broadcast: async () => {} }
      return id.startsWith('.') ? read(path.resolve(path.dirname(file), `${id}.ts`)) : require(id)
    }, mod, mod.exports)
    return mod.exports
  }
  return read(path.join(root, 'src', entry))
}
function fixture(beforeLabelMigration = null, omitLabelMigration = false) {
  const sql = new DatabaseSync(':memory:')
  sql.limits.exprDepth = 100
  sql.limits.variableNumber = 100
  sql.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) {
    if (file === '0226_branch_history_labels.sql' && omitLabelMigration) continue
    if (file === '0226_branch_history_labels.sql' && beforeLabelMigration) beforeLabelMigration(sql)
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.exec('PRAGMA foreign_keys=ON')
  if (!beforeLabelMigration) sql.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Warehouse',0,1);
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(1,'Serum','SER-1',2,0,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0);
  `)
  let beforeBatch = null, failSql = null
  const statement = (text, values = []) => {
    const prepared = sql.prepare(text)
    const args = Array.isArray(values) ? values : [values]
    return {
      text, values,
      async first() { return prepared.get(...args) || null },
      async all() { return { results: prepared.all(...args) } },
      async run() { const result = prepared.run(...args); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
    }
  }
  const DB = {
    prepare(text) { return { bind: (...values) => statement(text, values), ...statement(text) } },
    async batch(statements) {
      if (beforeBatch) { const run = beforeBatch; beforeBatch = null; run(sql) }
      sql.exec('BEGIN')
      try {
        const results = []
        for (const item of statements) {
          if (failSql && failSql.test(item.text)) { failSql = null; throw new Error('injected atomic failure') }
          results.push(await item.run())
        }
        sql.exec('COMMIT')
        return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, env: { DB }, beforeBatch(fn) { beforeBatch = fn }, failSql(pattern) { failSql = pattern } }
}
const session = load('lib/stockSession.ts')
const transfer = load('lib/transferOperation.ts')
const { getDb } = load('lib/db.ts')
const query = load('lib/stockInSessionsQuery.ts')
function receive(key = 'history-receive-001') {
  return { client_request_id: key, mode: 'stock_in', defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Supplier' },
    items: [{ line_id: 'receive-1', kind: 'receive', product_id: 1, quantity: 5, unit_cost_usd: 2 }] }
}
function zero(key, name = 'Catalog only') {
  return { client_request_id: key, mode: 'stock_in', defaults: { branch_id: 1, received_date: '2026-09-05' },
    items: [{ line_id: 'zero-1', kind: 'create_receive', quantity: 0,
      product: { name, barcode: `ZERO-${name}`, cost_price_usd: 1.25, selling_price_usd: 2.5, stock_quantity: 0, branch_id: 1 } }] }
}
async function move(f, key = 'history-transfer-001') {
  const db = getDb(f.env)
  const plan = await transfer.planTransferOperation(db, { user: actor, requestId: key, requestJson: '{}', digest: key,
    scope: 'branches', fromBranchId: 1, toBranchId: 2, reason: 'Restock', lines: [{ productId: 1, destProductId: 1, quantity: 2.5 }], response: { success: true } })
  await db.batchOnce(plan.statements)
  return plan
}
function compat() {
  return load('routes/compat.ts', {
    auth: { requireAuth: async (c, next) => { c.set('user', actor); return next() } },
    reports: { gateTotals: () => { throw new Error('unrelated reports route') } },
  }).default
}
async function readTransfers(app, f, paged) {
  const response = await app.request(`/transfers${paged ? '?page=1&pageSize=20' : ''}`, {}, f.env)
  assert.equal(response.status, 200)
  const body = await response.json()
  return paged ? body.items : body
}
const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}
async function main() {
  await check('migration is additive and does not rewrite legacy history', async () => {
    const f = fixture(sql => sql.exec(`INSERT INTO stock_transfers(id,product_id,product_name,from_branch_id,to_branch_id,quantity,notes,created_at)
      VALUES(17,9,'Legacy',1,2,1.25,'Kept','2020-01-02 03:04:05');`))
    const row = f.sql.prepare('SELECT * FROM stock_transfers WHERE id=17').get()
    assert.equal(row.from_branch_name, null); assert.equal(row.to_branch_name, null)
    assert.equal(row.quantity, 1.25); assert.equal(row.notes, 'Kept'); assert.equal(row.created_at, '2020-01-02 03:04:05')
    assert.equal(f.sql.prepare("PRAGMA table_info(stock_session_members)").all().find(row => row.name === 'branch_name').notnull, 0)
    f.sql.close()
  })
  await check('positive member captures actual label and replay preserves it', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, actor, receive())
    const member = f.sql.prepare('SELECT * FROM stock_session_members').get()
    assert.equal(member.branch_name, 'Shop')
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    await session.replayStockSession(f.env, actor, 'undo', result.actionHistoryId, 0, JSON.parse(history.undo_payload))
    await session.replayStockSession(f.env, actor, 'redo', result.actionHistoryId, 1, { ...JSON.parse(history.redo_payload), generation: 1 })
    assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, 'Shop')
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 5)
    f.sql.close()
  })
  await check('pre-label version2 session postimages still allow exact Undo and Redo after migration', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, actor, receive())
    f.sql.exec(`UPDATE undo_snapshots SET payload_json=json_set(payload_json,
      '$.after.members',json((SELECT json_group_array(json_remove(value,'$.branch_name')) FROM json_each(payload_json,'$.after.members'))),
      '$.expected.members',json((SELECT json_group_array(json_remove(value,'$.branch_name')) FROM json_each(payload_json,'$.expected.members'))))`)
    f.sql.exec('UPDATE stock_session_members SET branch_name=NULL')
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    await session.replayStockSession(f.env, actor, 'undo', result.actionHistoryId, 0, JSON.parse(history.undo_payload))
    await session.replayStockSession(f.env, actor, 'redo', result.actionHistoryId, 1, { ...JSON.parse(history.redo_payload), generation: 1 })
    assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, null)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 5)
    const materialized = '  ហាងដើម  '
    f.sql.prepare('UPDATE stock_session_members SET branch_name=?').run(materialized)
    await session.replayStockSession(f.env, actor, 'undo', result.actionHistoryId, 2, { ...JSON.parse(history.undo_payload), generation: 2 })
    await session.replayStockSession(f.env, actor, 'redo', result.actionHistoryId, 3, { ...JSON.parse(history.redo_payload), generation: 3 })
    assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, materialized)
    // HOTFIX-BRANCH-REV: a branch rename no longer refuses Undo (replay stopped comparing the 'branch'
    // revision, which 0124 bumps on any branches edit incl. the 0229 backfill). The label pin stays: Undo
    // never rewrites the member's captured branch_name.
    f.sql.exec("UPDATE branches SET name='LC Store' WHERE id=1")
    await session.replayStockSession(f.env, actor, 'undo', result.actionHistoryId, 4, { ...JSON.parse(history.undo_payload), generation: 4 })
    assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, materialized)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 0)
    f.sql.close()
  })
  await check('new session postimages still reject changed captured labels', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, actor, receive())
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    f.sql.exec("UPDATE stock_session_members SET branch_name='Changed snapshot'")
    await assert.rejects(() => session.replayStockSession(f.env, actor, 'undo', result.actionHistoryId, 0, JSON.parse(history.undo_payload)))
    assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, 'Changed snapshot')
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 5)
    f.sql.close()
  })
  await check('zero new and identity-folded members retain EN/KM labels in list and detail after rename', async () => {
    const f = fixture()
    const label = '  ហាងដើម  '
    f.sql.prepare('UPDATE branches SET name=? WHERE id=1').run(label)
    await session.commitStockSession(f.env, actor, zero('zero-new-001'))
    await session.commitStockSession(f.env, actor, zero('zero-fold-002'))
    const members = f.sql.prepare('SELECT product_created,branch_name FROM stock_session_members ORDER BY rowid').all()
    assert.equal(members.length, 2); assert.equal(members[0].product_created, 1); assert.equal(members[1].product_created, 0)
    for (const member of members) assert.equal(member.branch_name, label)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 0)
    f.sql.exec("UPDATE branches SET name='LC Store' WHERE id=1")
    const built = query.buildStockInSessionListQuery()
    const rows = f.sql.prepare(built.groupedSql).all()
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.branch_name, label); assert.equal(row.quantity, 0)
      const locator = query.parseStockInSessionKey(row.session_key)
      const lines = f.sql.prepare(query.stockInSessionLinesSql(locator)).all(query.stockInSessionLineParams(locator))
      assert.equal(lines.length, 1); assert.equal(lines[0].branch_name, label)
    }
    f.sql.close()
  })
  await check('zero legacy blank labels use current branch fallback without rewriting bytes', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, actor, zero('zero-legacy-001'))
    f.sql.exec("UPDATE branches SET name='Current Shop' WHERE id=1")
    for (const blank of [null, '', ' ', '\t\r\n', '\u00a0\ufeff\u3000']) {
      f.sql.prepare('UPDATE stock_session_members SET branch_name=?').run(blank)
      const built = query.buildStockInSessionListQuery()
      assert.equal(f.sql.prepare(built.groupedSql).get().branch_name, 'Current Shop')
      assert.equal(f.sql.prepare('SELECT branch_name FROM stock_session_members').get().branch_name, blank)
    }
    f.sql.close()
  })
  await check('transfer forward and inverses append actual effect labels without changing older rows', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, actor, receive())
    const plan = await move(f)
    const first = f.sql.prepare('SELECT * FROM stock_transfers').get()
    assert.equal(first.from_branch_name, 'Shop'); assert.equal(first.to_branch_name, 'Warehouse')
    const history = f.sql.prepare("SELECT * FROM action_history WHERE entity='stock_transfer'").get()
    f.sql.exec("UPDATE branches SET name=' sHoP ' WHERE id=1; UPDATE branches SET name=' WareHOUSE ' WHERE id=2")
    await transfer.replayTransferOperation(f.env, actor, 'undo', history.id, 0, JSON.parse(history.undo_payload))
    await transfer.replayTransferOperation(f.env, actor, 'redo', history.id, 1, { ...JSON.parse(history.redo_payload), generation: 1 })
    const rows = f.sql.prepare('SELECT * FROM stock_transfers ORDER BY id').all()
    assert.equal(rows.length, 3)
    assert.equal(JSON.stringify(rows[0]), JSON.stringify(first))
    assert.equal(rows[1].from_branch_name, ' WareHOUSE '); assert.equal(rows[1].to_branch_name, ' sHoP ')
    assert.equal(rows[2].from_branch_name, ' sHoP '); assert.equal(rows[2].to_branch_name, ' WareHOUSE ')
    for (const row of rows) { assert.equal(row.quantity, 2.5); assert.equal(row.client_request_id, plan.operationId) }
    assert.equal(f.sql.prepare('SELECT SUM(quantity) n FROM branch_stock').get().n, 5)
    f.sql.close()
  })
  await check('both actual compatibility readers prefer snapshots and retain public field shape', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, actor, receive())
    await move(f)
    const label = '  ហាងដើម  '
    f.sql.prepare('UPDATE stock_transfers SET from_branch_name=?').run(label)
    f.sql.exec("UPDATE branches SET name='Changed source' WHERE id=1; UPDATE branches SET name='Changed destination' WHERE id=2")
    const app = compat()
    for (const paged of [false, true]) {
      const [row] = await readTransfers(app, f, paged)
      assert.equal(row.from_name, label); assert.equal(row.to_name, 'Warehouse')
      assert.equal(row.from_branch_id, 1); assert.equal(row.to_branch_id, 2); assert.equal(row.quantity, 2.5)
      assert.equal(Object.hasOwn(row, 'from_branch_name'), false); assert.equal(Object.hasOwn(row, 'to_branch_name'), false)
    }
    for (const blank of [null, '', ' ', '\t\r\n', '\u00a0\ufeff\u3000']) {
      f.sql.prepare('UPDATE stock_transfers SET from_branch_name=?,to_branch_name=?').run(blank, blank)
      for (const paged of [false, true]) {
        const [row] = await readTransfers(app, f, paged)
        assert.equal(row.from_name, 'Changed source'); assert.equal(row.to_name, 'Changed destination')
      }
    }
    f.sql.close()
  })
  await check('session branch rename race refuses atomically with no member label', async () => {
    const f = fixture()
    f.beforeBatch(sql => sql.exec("UPDATE branches SET name='Changed before commit' WHERE id=1"))
    await assert.rejects(() => session.commitStockSession(f.env, actor, receive()))
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_session_members').get().n, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 0)
    f.sql.close()
  })
  await check('transfer labels read at atomic effect time and rollback with later failure', async () => {
    const f = fixture()
    await session.commitStockSession(f.env, actor, receive())
    f.beforeBatch(sql => sql.exec("UPDATE branches SET name=' sHoP ' WHERE id=1"))
    await move(f)
    assert.equal(f.sql.prepare('SELECT from_branch_name FROM stock_transfers').get().from_branch_name, ' sHoP ')
    f.failSql(/UPDATE transfer_operation_receipts SET status='committed'/)
    await assert.rejects(() => move(f, 'history-transfer-fail'))
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_transfers').get().n, 1)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE branch_id=1').get().quantity, 2.5)
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length, 0)
    f.sql.close()
  })
  if (failures.length) throw new Error(`${failures.length} history-label groups failed: ${failures.join('; ')}`)
  console.log('PASS branch history labels: 10 groups, SQLite expression depth 100 / binds 100')
}
module.exports = { fixture, load, actor, receive }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
