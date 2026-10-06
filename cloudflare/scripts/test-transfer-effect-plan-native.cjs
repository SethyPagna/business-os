// CUTOVER-LC item 3 (and E8, item 2): the transfer effect statements the
// cutover child runs 3,408 times.
//
//  1. Query plans (native SQLite, no index statistics -- what D1 has): the
//     branch_batch_stock UPDATE must SEARCH the (batch_id, branch_id) unique
//     index instead of scanning the table, and the untracked-stock guard must
//     reach branch_batch_stock through the product's lots instead of reading the
//     whole branch through idx_branch_batch_stock_branch_qty. The old text is
//     kept below as an oracle: its plans MUST show the scan (the control that
//     proves this test can tell the two apart).
//  2. Behaviour: new and old statements leave byte-identical stock tables for a
//     transfer with a shared lot, a lot only at the source, untracked stock and
//     a fractional lot, and both trip the same guard when the ledgers move
//     between plan and batch.
//  3. E8: the same transfer commits when the branches are renamed (names no
//     longer 'Shop' / 'Warehouse') as long as the roles say so, and is refused
//     when the roles do not form a shop/warehouse pair.
//
// Run: node scripts/test-transfer-effect-plan-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(relative) {
  relative = path.posix.normalize(relative.endsWith('.ts') ? relative : relative + '.ts')
  if (cache.has(relative)) return cache.get(relative).exports
  const module = { exports: {} }; cache.set(relative, module)
  let source = fs.readFileSync(path.join(root, 'src', relative), 'utf8')
  // Wrong-implementation controls (each must turn the named checks RED):
  //   TRANSFER_WRONG_CONTROL=name_guard    the guard SQL reads names only (pre-E8)
  //   TRANSFER_WRONG_CONTROL=exists_update the UPDATE goes back to the EXISTS form
  if (relative === 'lib/canonicalBranchIdentity.ts' && process.env.TRANSFER_WRONG_CONTROL === 'name_guard') {
    const from = "const BRANCH_ROLE_SQL = 'LOWER(TRIM(COALESCE(role, name)))'"
    assert.ok(source.includes(from)); source = source.replace(from, "const BRANCH_ROLE_SQL = 'LOWER(TRIM(name))'")
  }
  if (relative === 'lib/transferOperation.ts' && process.env.TRANSFER_WRONG_CONTROL === 'exists_update') {
    const from = 'WHERE (batch_id,branch_id) IN (SELECT from_batch,from_branch FROM (${sourceLots}))'
    assert.ok(source.includes(from)); source = source.replace(from, 'WHERE EXISTS(SELECT 1 FROM (${sourceLots}) a WHERE a.from_batch=branch_batch_stock.batch_id AND a.from_branch=branch_batch_stock.branch_id)')
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', compiled)(request => {
    if (['./importMaintenanceFence', '../durable-objects/broadcastHub', './cache'].includes(request)) return new Proxy({}, { get: () => () => { throw Error('Unexpected effect ' + request) } })
    assert.ok(request.startsWith('.'), 'Unexpected dependency ' + request)
    return load(path.posix.join(path.posix.dirname(relative), request))
  }, module, module.exports)
  return module.exports
}
const transfer = load('lib/transferOperation')
const { D1Compat } = load('lib/db')
const actor = { id: 7, username: 'operator', name: 'Operator', organization_id: 1, role_id: null, permissions: '{"branches":true}', is_active: 1 }

// The statements exactly as they were before this change (oracle).
const NEW_UNTRACKED = `FROM product_batches b CROSS JOIN branch_batch_stock bs ON bs.batch_id=b.id AND bs.branch_id=m.from_branch
          WHERE b.variant_product_id=m.from_product),0),0)`.replace(/\r?\n\s*/g, ' ')
const OLD_UNTRACKED = `FROM branch_batch_stock bs JOIN product_batches b ON b.id=bs.batch_id
          WHERE b.variant_product_id=m.from_product AND bs.branch_id=m.from_branch),0),0)`.replace(/\r?\n\s*/g, ' ')
const NEW_UPDATE_WHERE = 'WHERE (batch_id,branch_id) IN (SELECT from_batch,from_branch FROM ('
const flat = sql => sql.replace(/\s+/g, ' ')
function toOld(statement) {
  const sql = flat(statement.sql)
  if (sql.includes(NEW_UNTRACKED)) return { ...statement, sql: sql.replace(NEW_UNTRACKED, OLD_UNTRACKED) }
  if (sql.startsWith('UPDATE branch_batch_stock SET quantity=quantity-') && sql.includes(NEW_UPDATE_WHERE)) {
    const at = sql.indexOf(NEW_UPDATE_WHERE)
    const lotsSql = sql.slice(at + NEW_UPDATE_WHERE.length, sql.length - 2) // the sourceLots text, minus the two closing parens
    return { ...statement, sql: sql.slice(0, at) + `WHERE EXISTS(SELECT 1 FROM (${lotsSql}) a WHERE a.from_batch=branch_batch_stock.batch_id AND a.from_branch=branch_batch_stock.branch_id)` }
  }
  return statement
}

function schema() {
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  return raw
}

// names/roles: [[name, role], [name, role]] for branch ids 1 and 2.
function world(branches = [['Shop', null], ['Warehouse', null]], { noise = 0 } = {}) {
  const raw = schema()
  const insert = raw.prepare('INSERT INTO branches(id,name,role,is_active,is_default) VALUES(?,?,?,1,?)')
  branches.forEach(([name, role], i) => insert.run(i + 1, name, role, i === 0 ? 1 : 0))
  raw.exec(`INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true}',1);
    INSERT INTO products(id,name,sku,is_active,cost_price_usd,cost_price_khr) VALUES(1,'Mixed','P1',1,2.5,10000),(2,'Untracked','P2',1,1,4000),(3,'Fractional','P3',1,1,4000),(4,'Other','P4',1,1,4000);`)
  const lot = raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,?,NULL,'n',?,?,1)")
  const bbs = raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)')
  const bs = raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
  // P1: lot 1 shared (source 4, target 6), lot 2 only at the source (3); source stock 7 + 2 untracked.
  lot.run(1, 1, 'k1', 'k1', '2026-01-01', 1, 1.5); lot.run(2, 1, 'k2', 'k2', '2026-02-01', 2, 2)
  bbs.run(1, 1, 4); bbs.run(1, 2, 6); bbs.run(2, 1, 3)
  bs.run(1, 1, 9); bs.run(1, 2, 6)
  // P2: no lots at all, 5 untracked at the source.
  bs.run(2, 1, 5); bs.run(2, 2, 0)
  // P3: fractional lot.
  lot.run(3, 3, 'k3', 'k3', '2026-03-01', 1, 1); bbs.run(3, 1, 0.5); bs.run(3, 1, 0.75); bs.run(3, 2, 0)
  for (let i = 0; i < noise; i += 1) { // noise lots of other products at both branches
    const id = 100 + i, product = 1000 + i
    raw.prepare('INSERT INTO products(id,name,sku,is_active,cost_price_usd,cost_price_khr) VALUES(?,?,?,1,1,4000)').run(product, 'N' + i, 'N' + i)
    lot.run(id, product, 'n' + i, 'n' + i, '2026-01-01', 1, 1)
    bbs.run(id, 1, 2); bbs.run(id, 2, 2); bs.run(product, 1, 2); bs.run(product, 2, 2)
  }
  raw.exec("UPDATE products SET created_at='2026-01-01 00:00:00'") // snapshots embed created_at; two worlds must agree
  raw.exec('UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id)')
  const log = { executed: [], explain: [] }
  function prepared(sql, values = []) {
    const args = () => /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
    const execute = () => {
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return { success: true, results: statement.all(...args()), meta: { changes: 0 } }
      const result = statement.run(...args())
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    const plan = () => raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args()).map(row => String(row.detail))
    return { sql, values, bind: (...bound) => prepared(sql, bound), execute, plan,
      all: async () => execute(), run: async () => execute() }
  }
  let before = null
  const db = new D1Compat({ prepare: prepared, batch: async statements => {
    if (before) { const hook = before; before = null; hook(raw) }
    raw.exec('BEGIN IMMEDIATE')
    try { const result = statements.map(statement => { log.executed.push(statement.sql); return statement.execute() }); raw.exec('COMMIT'); return result }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  } })
  // Capture mode: translate the statements and EXPLAIN them without running them.
  const explainer = new D1Compat({ prepare: prepared, batch: async statements => { statements.forEach(statement => log.explain.push({ sql: statement.sql, plan: statement.plan() })); return statements.map(() => ({ success: true, results: [], meta: { changes: 0 } })) } })
  return { raw, db, explainer, log, beforeBatch: hook => { before = hook } }
}

const STOCK_TABLES = ['branch_stock', 'branch_batch_stock']
const stockState = w => JSON.stringify({
  tables: STOCK_TABLES.map(table => w.raw.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all().map(row => { const copy = { ...row }; delete copy.updated_at; delete copy.created_at; return copy })),
  products: w.raw.prepare('SELECT id,stock_quantity FROM products ORDER BY id').all(),
  movements: w.raw.prepare('SELECT product_id,branch_id,branch_name,movement_type,quantity,batch_id FROM inventory_movements ORDER BY product_id,branch_id,movement_type,batch_id,quantity').all(),
  transfers: w.raw.prepare('SELECT product_id,from_branch_id,to_branch_id,from_branch_name,to_branch_name,quantity FROM stock_transfers ORDER BY product_id').all(),
})
async function plan(w, lines, from = 1, to = 2) {
  return transfer.planTransferOperation(w.db, { user: actor, requestId: 'req-' + Math.random(), requestJson: '{}', digest: 'd'.repeat(64), scope: 'branches',
    fromBranchId: from, toBranchId: to, reason: 'plan test', lines, response: { success: true } })
}
const LINES = [
  { productId: 1, destProductId: 1, quantity: 9, batchId: null },
  { productId: 2, destProductId: 2, quantity: 5, batchId: null },
  { productId: 3, destProductId: 3, quantity: 0.75, batchId: null },
]

let checks = 0
async function check(name, fn) { await fn(); checks += 1; console.log('PASS ' + name) }
const scans = (lines, table) => lines.filter(line => new RegExp(`\\bSCAN ${table}\\b`).test(line))

async function main() {
  const effect = () => transfer.transferEffectStatements('00000000-0000-4000-8000-000000000001', false, 0, actor, 'plan test')
  const update = statements => statements.find(statement => /^UPDATE branch_batch_stock SET quantity=quantity-/.test(flat(statement.sql)))
  const untrackedGuard = statements => statements.find(statement => statement.sql.includes('m.untracked>'))

  await check('the cutover child UPDATE of branch_batch_stock searches the (batch, branch) unique index; the old text scans the table', async () => {
    const w = world(undefined, { noise: 30 })
    const statements = effect()
    await w.explainer.batchOnce([update(statements), toOld(update(statements))])
    const [fresh, old] = w.log.explain
    assert.ok(!flat(fresh.sql).includes('EXISTS(SELECT 1 FROM (SELECT from_product'), 'the rewrite must not keep the EXISTS form')
    assert.deepEqual(scans(fresh.plan, 'branch_batch_stock'), [], fresh.plan.join('\n'))
    assert.ok(fresh.plan.some(line => /SEARCH branch_batch_stock USING (COVERING )?INDEX idx_branch_batch_stock_batch_branch_unique \(batch_id=\? AND branch_id=\?\)/.test(line)), fresh.plan.join('\n'))
    // Control: the oracle really is the old text and its plan really scans.
    assert.ok(flat(old.sql).includes('WHERE EXISTS(SELECT 1 FROM (SELECT from_product'), 'oracle conversion lost the old text')
    assert.ok(scans(old.plan, 'branch_batch_stock').length > 0, 'control: the old UPDATE must scan\n' + old.plan.join('\n'))
  })

  await check('the untracked-stock guard reads the product lots, not the whole branch', async () => {
    const w = world(undefined, { noise: 30 })
    const statements = effect()
    await w.explainer.batchOnce([untrackedGuard(statements), toOld(untrackedGuard(statements))])
    const [fresh, old] = w.log.explain
    const branchWide = lines => lines.filter(line => /idx_branch_batch_stock_branch_qty/.test(line))
    assert.deepEqual(branchWide(fresh.plan), [], fresh.plan.join('\n'))
    assert.ok(fresh.plan.some(line => /SEARCH b USING (COVERING )?INDEX \w+ \(variant_product_id=\?\)/.test(line)), fresh.plan.join('\n'))
    assert.ok(fresh.plan.some(line => /SEARCH bs USING (COVERING )?INDEX idx_branch_batch_stock_batch_branch_unique \(batch_id=\? AND branch_id=\?\)/.test(line)), fresh.plan.join('\n'))
    // Control: the old join order is the one that read the branch.
    assert.ok(branchWide(old.plan).length > 0 || scans(old.plan, 'branch_batch_stock').length > 0, 'control: the old guard must read the branch\n' + old.plan.join('\n'))
  })

  await check('old and new statements leave identical stock for shared, source-only, untracked and fractional lots', async () => {
    const fresh = world(), old = world()
    const planned = await plan(fresh, LINES)
    // The oracle world runs the SAME planned statements with the old text, so
    // only the two rewritten statements differ.
    const oracle = planned.statements.map(toOld)
    assert.equal(oracle.filter((statement, i) => statement !== planned.statements[i]).length, 2, 'exactly the two rewritten statements differ')
    await fresh.db.batchOnce(planned.statements)
    await old.db.batchOnce(oracle)
    assert.equal(stockState(fresh), stockState(old))
    // And the transfer did what it says: everything left the source.
    assert.deepEqual(fresh.raw.prepare('SELECT product_id,quantity FROM branch_stock WHERE branch_id=1 AND product_id IN (1,2,3) ORDER BY product_id').all().map(row => ({ ...row })),
      [{ product_id: 1, quantity: 0 }, { product_id: 2, quantity: 0 }, { product_id: 3, quantity: 0 }])
    assert.deepEqual(fresh.raw.prepare('SELECT batch_id,quantity FROM branch_batch_stock WHERE branch_id=2 AND batch_id IN (1,2,3) ORDER BY batch_id').all().map(row => ({ ...row })),
      [{ batch_id: 1, quantity: 10 }, { batch_id: 2, quantity: 3 }, { batch_id: 3, quantity: 0.5 }])
    // Rows of other lots at the source are untouched by the IN-tuple update.
    assert.equal(fresh.raw.prepare('SELECT COUNT(*) AS n FROM branch_batch_stock').get().n, 6)
  })

  await check('a ledger move between plan and batch trips the same guard in both versions and writes nothing', async () => {
    for (const converter of [statement => statement, toOld]) {
      const w = world()
      const planned = await plan(w, [{ productId: 1, destProductId: 1, quantity: 9, batchId: null }])
      const before = stockState(w)
      // Lots now claim all of the source stock: the 2 untracked units are gone.
      w.beforeBatch(raw => raw.exec('UPDATE branch_batch_stock SET quantity=9 WHERE batch_id=2 AND branch_id=1'))
      await assert.rejects(() => w.db.batchOnce(planned.statements.map(converter)), /NOT NULL constraint failed: branches\.name/)
      w.raw.exec('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=2 AND branch_id=1')
      assert.equal(stockState(w), before)
    }
  })

  await check('E8: the transfer commits for renamed branches whose roles say shop and warehouse (names are labels)', async () => {
    const w = world([['Old Shop', 'shop'], ['LC Store', 'warehouse']])
    const planned = await plan(w, [{ productId: 1, destProductId: 1, quantity: 9, batchId: null }])
    await w.db.batchOnce(planned.statements)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity, 15)
    assert.deepEqual(w.raw.prepare('SELECT from_branch_name,to_branch_name FROM stock_transfers').all().map(row => ({ ...row })), [{ from_branch_name: 'Old Shop', to_branch_name: 'LC Store' }])
  })

  await check('E8: roles outrank names -- a branch NAMED Shop whose role is warehouse is a warehouse; two shops or no warehouse refuse', async () => {
    // Names say Shop/Warehouse but the roles are swapped: the roles decide, so source = warehouse role, target = shop role is still a pair.
    const swapped = world([['Shop', 'warehouse'], ['Warehouse', 'shop']])
    await swapped.db.batchOnce((await plan(swapped, [{ productId: 1, destProductId: 1, quantity: 9, batchId: null }])).statements)
    assert.equal(swapped.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity, 15)
    // Two active shops (the post-finalize shape with Old Shop wrongly active): no pair, refused in the batch, nothing written.
    const twoShops = world([['Old Shop', 'shop'], ['LC Store', 'shop']])
    const planned = await plan(twoShops, [{ productId: 1, destProductId: 1, quantity: 9, batchId: null }])
    const before = stockState(twoShops)
    await assert.rejects(() => twoShops.db.batchOnce(planned.statements), /NOT NULL constraint failed: branches\.name/)
    assert.equal(stockState(twoShops), before)
    // One active branch left (the real post-cutover state): Old Shop inactive.
    const oneActive = world([['Old Shop', 'shop'], ['LC Store', 'shop']])
    oneActive.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const plannedOne = await plan(oneActive, [{ productId: 1, destProductId: 1, quantity: 9, batchId: null }])
    await assert.rejects(() => oneActive.db.batchOnce(plannedOne.statements), /NOT NULL constraint failed: branches\.name/)
  })

  console.log(`${checks} transfer effect plan native checks passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
