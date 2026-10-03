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
  if (relative === 'lib/branchCutoverChild.ts' && process.env.CHILD_WRONG_CONTROL) {
    const mutations = {
      retry: ['await db.batchOnce(statements)', 'await db.batch(statements)'],
      guards: ['SELECT CASE WHEN (${condition}) THEN 1', 'SELECT CASE WHEN (1) THEN 1'],
      receipt_order: ['if (existing.receipt) return', 'if (false && existing.receipt) return'],
      tenant: ['actor.organization_id === organizationId', 'true'],
      split: ['await db.batchOnce(statements)', 'await (async () => { await db.batchOnce(statements.slice(0, -6)); return db.batchOnce(statements.slice(-6)) })()'],
      quantity_gap: ['requireChild(quantity(total) && Math.abs(total - amount) <= roundoff)', 'requireChild(quantity(total) && Math.abs(total - amount) <= EPSILON)'],
      quantity_zero: ['requireChild(portions.length > 0 && portions.every(value => quantity(value) && value > 0))', 'if (portions.length === 0) return; requireChild(portions.every(value => quantity(value) && value > 0))'],
      quantity_minimum: ['requireChild(quantity(total) && Math.abs(total - amount) <= roundoff)', 'requireChild(amount >= EPSILON && Math.abs(total - amount) <= EPSILON)'],
      quantity_exact: ['requireChild(quantity(total) && Math.abs(total - amount) <= roundoff)', 'requireChild(total === amount)'],
      delta_zero_only: ['requireRepresentedQuantity(amount, realized, [])', 'requireChild(realized > 0)'],
      delta_absolute: ['requireRepresentedQuantity(amount, realized, [])', 'requireChild(realized > 0 && Math.abs(realized - amount) <= EPSILON)'],
      delta_binary: ['const realized = Number(direction === 1 ? subtractDecimalSum(after, [before]) : subtractDecimalSum(before, [after]))', 'const realized = direction === 1 ? after - before : before - after'],
      delta_lot: ['requireQuantityDelta(to, take.quantity, 1)', 'requireChild(true)'],
      delta_serialization: ["branch_id,printf('%!.17g',quantity)", 'branch_id,quantity'],
    }
    const mutation = mutations[process.env.CHILD_WRONG_CONTROL]
    assert.ok(mutation && source.includes(mutation[0])); source = source.replace(mutation[0], mutation[1])
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', compiled)(request => {
    if (['./importMaintenanceFence', '../durable-objects/broadcastHub', './cache'].includes(request)) return new Proxy({}, { get: () => () => { throw Error('Unexpected effect ' + request) } })
    assert.ok(request.startsWith('.'), 'Unexpected dependency ' + request)
    return load(path.posix.join(path.posix.dirname(relative), request))
  }, module, module.exports)
  return module.exports
}
const journal = load('lib/branchCutoverJournal')
const child = load('lib/branchCutoverChild')
const { D1Compat } = load('lib/db')
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = { id: 7, username: 'operator', name: 'Operator', organization_id: 1, role_id: null, permissions: '{"branches":true}', is_active: 1 }
const budget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, completionQueries: 0, retryQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
function world(lots = [1], untracked = 0) {
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  raw.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true}',1);
    INSERT INTO products(id,name,sku,is_active,cost_price_usd,cost_price_khr) VALUES(1,'Product','P1',1,2.5,10000);`)
  for (const [i, quantity] of lots.entries()) {
    raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,batch_number,unit_cost_usd,is_active) VALUES(?,1,?,?,'2026-01-01','2027-01-01','Original note',?,?,1)").run(i + 1, 'lot-' + i, 'lot-' + i, i + 1, i + 1)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(i + 1, quantity)
  }
  const quantity = lots.reduce((a, b) => a + b, 0) + untracked
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,?),(1,2,0)').run(quantity)
  raw.prepare('UPDATE products SET stock_quantity=?,cost_price_usd=2.5,cost_price_khr=10000 WHERE id=1').run(quantity)
  raw.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('branch_cutover_control_incarnation', uuid(99))
  const stats = { reads: 0, batches: 0, binds: 0, statements: 0, sql: [], before: null, after: null, failAt: -1, unreadable: false }
  function prepared(sql, values = []) {
    assert.ok(values.length <= 100); stats.binds = Math.max(stats.binds, values.length)
    const execute = () => {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const result = statement.run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { sql, values, bind: (...bound) => prepared(sql, bound), execute,
      all: async () => { stats.reads++; stats.sql.push(sql); if (stats.unreadable) throw Error('proof unavailable'); return execute() }, run: async () => execute() }
  }
  const db = new D1Compat({ prepare: prepared, batch: async statements => {
    stats.batches++; stats.statements = statements.length
    if (stats.before) { const hook = stats.before; stats.before = null; await hook(raw) }
    raw.exec('BEGIN IMMEDIATE')
    let result
    try { result = statements.map((statement, i) => { if (i === stats.failAt) throw Error('injected boundary'); return statement.execute() }); raw.exec('COMMIT') }
    catch (error) { raw.exec('ROLLBACK'); throw error }
    if (stats.after) { const hook = stats.after; stats.after = null; hook(raw) }
    return result
  } })
  return { raw, db, stats, quantity }
}
const ownership = row => ({ operationId: row.operation_id, actorId: row.actor_id, organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token })
async function planned(w, transfer = {}, manifestQuantityText = w.quantity.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 })) {
  let row = (await journal.beginBranchCutoverJournal(w.db, { operationId: uuid(1), beginRequestId: 'cutover_begin_001', actorId: 7, organizationId: '1', controlIncarnation: uuid(99), token: uuid(2), sourceBranchId: 1, targetBranchId: 2,
    intentJson: '{"action":"retire","sourceBranchId":1,"targetBranchId":2}', sourcePreimageJson: '{"id":1,"name":"Shop"}', targetPreimageJson: '{"id":2,"name":"Warehouse"}' })).row
  row = await journal.checkpointBranchCutoverJournal(w.db, ownership(row), row.revision, { phase: 'capturing', records: 1, cursorJson: '{"id":1}', digest: 'a'.repeat(64) })
  row = await journal.sealBranchCutoverManifest(w.db, ownership(row), row.revision, JSON.stringify({ version: 1, sourceBranchId: 1, targetBranchId: 2, capturedRecords: 1, movingProducts: 1, sourceQuantityText: manifestQuantityText, sourceLotQuantityText: manifestQuantityText, anomalies: 0, captureDigest: row.capture_digest }))
  row = await journal.finishBranchCutoverSnapshots(w.db, ownership(row), row.revision)
  const envelope = { version: 1, kind: 'branch-cutover-child', operationId: row.operation_id, sequence: 0, actorId: 7, organizationId: '1', controlIncarnation: row.control_incarnation, sourceBranchId: 1, targetBranchId: 2, reason: 'Retire Shop', transfer: { productId: 1, quantity: w.quantity, batchId: null, ...transfer } }
  const childJson = JSON.stringify(envelope)
  row = await journal.sealBranchCutoverChild(w.db, ownership(row), row.revision, childJson)
  w.stats.batches = 0; w.stats.reads = 0; w.stats.sql = []
  return { row, proof: ownership(row), expected: { sequence: 0, childJson } }
}
const execute = (w, p, overrides = {}) => child.executePlannedBranchCutoverChild(w.db, overrides.actor || actor, overrides.proof || p.proof, overrides.expected || p.expected, overrides.budget || budget, overrides.organizationId === undefined ? 1 : overrides.organizationId)
const tables = ['branch_stock', 'branch_batch_stock', 'product_batches', 'products', 'inventory_movements', 'stock_transfers', 'transfer_operation_receipts', 'transfer_operation_members', 'action_history', 'audit_logs', 'branch_cutovers', 'system_flags']
const snapshot = w => JSON.stringify(Object.fromEntries(tables.map(table => [table, w.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
function legacyMutation(w, table, sql) {
  const triggers = w.raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table)
  for (const trigger of triggers) w.raw.exec(`DROP TRIGGER "${trigger.name}"`)
  w.raw.exec('PRAGMA ignore_check_constraints=ON')
  try { w.raw.exec(sql) } finally { w.raw.exec('PRAGMA ignore_check_constraints=OFF'); for (const trigger of triggers) w.raw.exec(trigger.sql) }
}
let checks = 0
async function check(name, fn) { if (process.env.CHILD_TEST_PATTERN && !new RegExp(process.env.CHILD_TEST_PATTERN).test(name)) return; await fn(); checks++; console.log('PASS ' + name) }
async function main() {
  await check('actual fingerprint distinguishes adjacent REAL costs and preserves null with matching byte admission', async () => {
    const w = world([1]); const p = await planned(w); const prepare = w.db.prepare.bind(w.db); let observed
    w.db.prepare = sql => {
      if (sql.startsWith('SELECT CASE WHEN') && sql.includes('json_group_array')) observed = sql
      return prepare(sql)
    }
    await execute(w, p); assert.ok(observed)
    const summarySql = w.stats.sql.find(sql => sql.startsWith('SELECT COUNT(*) AS count'))
    const fingerprint = () => {
      const params = { product: 1, source: 1, target: 2 }
      const value = w.raw.prepare(observed).get(params).value
      const measured = w.raw.prepare(summarySql).get(params).bytes
      assert.ok(measured >= Buffer.byteLength(value) && measured <= Buffer.byteLength(value) + 1)
      return value
    }
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=?').run(1.0000000000000002)
    const first = fingerprint()
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=?').run(1.0000000000000004)
    const second = fingerprint(); assert.notEqual(first, second)
    assert.equal(Number(JSON.parse(first)[0][9]), 1.0000000000000002)
    assert.equal(Number(JSON.parse(second)[0][9]), 1.0000000000000004)
    w.raw.exec('UPDATE product_batches SET unit_cost_usd=NULL')
    assert.equal(JSON.parse(fingerprint())[0][9], null); w.raw.close()
  })
  await check('lot fingerprint preserves low digits needed for actual delta refusal', async () => {
    const w = world([2e-10]); const lotBalance = 999999.9998999991
    w.raw.exec('UPDATE branch_stock SET quantity=1000000 WHERE branch_id=2')
    w.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,2,?)').run(lotBalance)
    const { subtractDecimalSum } = load('lib/moneyPrecision')
    const rounded = JSON.parse(w.raw.prepare('SELECT json_array(quantity) AS value FROM branch_batch_stock WHERE branch_id=2').get().value)[0]
    assert.notEqual(rounded, lotBalance)
    assert.equal(Number(subtractDecimalSum(rounded + 2e-10, [rounded])), 2e-10)
    assert.equal(Number(subtractDecimalSum(lotBalance + 2e-10, [lotBalance])), 3e-10)
    const p = await planned(w); const before = snapshot(w)
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  await check('partial decimal debit 0.9 minus 0.7 preserves native branch and lot quantities', async () => {
    const w = world([0.9]); const p = await planned(w, { quantity: 0.7 }); await execute(w, p)
    const { subtractDecimalSum } = load('lib/moneyPrecision')
    for (const table of ['branch_stock', 'branch_batch_stock']) {
      const after = w.raw.prepare(`SELECT quantity FROM ${table} WHERE branch_id=1`).get().quantity
      assert.equal(String(after), '0.20000000000000007')
      const delta = Number(subtractDecimalSum(0.9, [after]))
      assert.ok(delta > 0 && Math.abs(delta - 0.7) <= 0.7 * 2 ** -52)
    }
    assert.equal((await execute(w, p)).replayed, true); w.raw.close()
  })
  for (const branch of [1, 2]) await check('negative branch balance refuses without effects ' + branch, async () => {
    const w = world(); const p = await planned(w)
    legacyMutation(w, 'branch_stock', `UPDATE branch_stock SET quantity=-0.1 WHERE branch_id=${branch}`)
    const before = snapshot(w); await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  await check('same-lot credit drift refuses even when branch decimal delta is represented', async () => {
    const w = world([1e-10])
    w.raw.exec('UPDATE branch_stock SET quantity=1000000 WHERE branch_id=2; INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,2,999999.9999)')
    const { subtractDecimalSum } = load('lib/moneyPrecision')
    assert.equal(Number(subtractDecimalSum(1000000 + 1e-10, [1000000])), 1e-10)
    assert.equal(Number(subtractDecimalSum(999999.9999 + 1e-10, [999999.9999])), 2e-10)
    const p = await planned(w); const before = snapshot(w)
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const [name, balance, amount] of [['zero', 1e9, 1e-10], ['disproportionate nonzero', 1e6, 1.5e-10]]) for (const direction of ['source', 'target']) await check(direction + ' branch and lot ' + name + ' actual delta refuses before dispatch', async () => {
    const w = world([amount]); const branch = direction === 'source' ? 1 : 2
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=?').run(balance, branch)
    w.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,?,?) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity').run(branch, balance)
    w.raw.prepare('UPDATE products SET stock_quantity=?').run(balance)
    const realized = direction === 'source' ? balance - (balance - amount) : (balance + amount) - balance
    assert.ok(name === 'zero' ? realized === 0 : realized > 0 && Math.abs(realized - amount) > amount * 0.1)
    const p = await planned(w, { quantity: amount }, '1'); const before = snapshot(w)
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const balance of [100, 1e9]) for (const direction of ['source', 'target']) await check(direction + ' canonical decimal delta at balance ' + balance + ' remains valid', async () => {
    const amount = 0.1; const w = world([amount]); const branch = direction === 'source' ? 1 : 2
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=?').run(balance, branch)
    w.raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,?,?) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity').run(branch, balance)
    const p = await planned(w, { quantity: amount }, '1'); const result = await execute(w, p)
    assert.equal(result.replayed, false); assert.equal(w.stats.batches, 1)
    const expected = direction === 'source' ? (balance === 100 ? '99.9' : '999999999.9') : (balance === 100 ? '100.1' : '1000000000.1')
    const { subtractDecimalSum } = load('lib/moneyPrecision')
    for (const table of ['branch_stock', 'branch_batch_stock']) {
      const after = w.raw.prepare(`SELECT quantity FROM ${table} WHERE branch_id=?`).get(branch).quantity
      assert.equal(String(after), expected)
      assert.equal(Number(direction === 'source' ? subtractDecimalSum(balance, [after]) : subtractDecimalSum(after, [balance])), amount)
    }
    assert.equal((await execute(w, p)).replayed, true); w.raw.close()
  })
  for (const amount of [Number.MIN_VALUE, 1e-20, 1e-10]) await check('zero represented portions refuse positive quantity ' + amount, async () => {
    const w = world([], 1); const p = await planned(w, { quantity: amount }); const before = snapshot(w)
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const mode of ['planning', 'stored']) await check(mode + ' deficit above independently bounded IEEE roundoff refuses', async () => {
    const unit = new Float64Array([1]); const bits = new BigUint64Array(unit.buffer); bits[0] += 1n
    const spacing = unit[0] - 1; const deficit = 1e-14
    const w = mode === 'planning' ? world([1], deficit) : world([1, deficit])
    const p = await planned(w, {}, '1')
    const represented = 1; const independentUpperBound = spacing * 2
    assert.ok(w.quantity - represented > independentUpperBound && w.quantity - represented < 1e-9)
    if (mode === 'stored') {
      await execute(w, p)
      legacyMutation(w, 'transfer_operation_members', "UPDATE transfer_operation_members SET allocations_json=json_remove(allocations_json,'$[1]')")
    }
    const before = snapshot(w); const batches = w.stats.batches
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, batches); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const [name, lots, untracked] of [['pure', [], 1e-10], ['mixed', [1], 1e-10]]) await check(name + ' positive untracked deficit refuses before dispatch', async () => {
    const w = world(lots, untracked); const p = await planned(w); const before = snapshot(w)
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const [name, lots, keep] of [['pure', [1e-10], 0], ['mixed', [1, 1e-10], 1]]) await check(name + ' stored positive provenance deficit refuses replay without writes', async () => {
    const w = world(lots); const p = await planned(w); await execute(w, p)
    const allocations = JSON.parse(w.raw.prepare('SELECT allocations_json FROM transfer_operation_members').get().allocations_json).slice(0, keep)
    legacyMutation(w, 'transfer_operation_members', `UPDATE transfer_operation_members SET allocations_json='${JSON.stringify(allocations).replaceAll("'", "''")}'`)
    const before = snapshot(w); const batches = w.stats.batches
    await assert.rejects(execute(w, p), /branch_cutover_child_conflict/)
    assert.equal(w.stats.batches, batches); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const [name, lots, untracked, requested] of [['tiny tracked', [1e-10], 0], ['ordinary untracked', [], 0.8], ['decimal thirds', [0.1, 0.2, 0.3], 0], ['mixed fractions', [0.1, 0.2], 0.4], ['lower rounding', [0.7, 0.2], 0, 0.9], ['128 fractional lots', Array(128).fill(0.1), 0]]) await check(name + ' represented fractional provenance commits and replays', async () => {
    const w = world(lots, untracked)
    if (requested !== undefined) {
      w.quantity = requested; w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=1').run(requested)
      w.raw.prepare('UPDATE products SET stock_quantity=? WHERE id=1').run(requested)
    }
    const p = await planned(w, {}, w.quantity.toFixed(12)); const result = await execute(w, p)
    assert.equal(result.replayed, false); assert.equal(w.stats.batches, 1)
    const member = w.raw.prepare('SELECT quantity,untracked_quantity,allocations_json FROM transfer_operation_members').get()
    const allocations = JSON.parse(member.allocations_json)
    const represented = allocations.reduce((total, allocation) => total + allocation.quantity, member.untracked_quantity)
    assert.ok(represented > 0 && Math.abs(represented - member.quantity) <= 1e-9)
    assert.equal(allocations.length, lots.length)
    const movements = w.raw.prepare('SELECT movement_type,quantity FROM inventory_movements ORDER BY id').all()
    for (const direction of ['transfer_out', 'transfer_in']) {
      const values = movements.filter(movement => movement.movement_type === direction).map(movement => movement.quantity)
      assert.deepEqual(values, [...allocations.map(allocation => allocation.quantity), ...(member.untracked_quantity > 0 ? [member.untracked_quantity] : [])])
    }
    assert.equal((await execute(w, p)).replayed, true); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  await check('actual one-batch transfer and journal progress', async () => {
    const w = world(); const p = await planned(w); const result = await execute(w, p)
    assert.equal(result.replayed, false); assert.equal(result.row.next_sequence, 1); assert.equal(result.row.planned_child_json, null)
    assert.equal(w.stats.batches, 1); assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=1').get().quantity, 0)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=2').get().quantity, 1)
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n, 1)
    w.raw.close()
  })
  for (const [name, lots, untracked] of [['two same-date lots', [1, 2], 0], ['128 lots', Array(128).fill(1), 0], ['mixed tracked and untracked', [1], 2], ['fractional', [0.5, 0.3], 0], ['untracked only', [], 2]]) await check(name + ' conservation, dates and costs', async () => {
    const w = world(lots, untracked); const p = await planned(w)
    const before = w.raw.prepare('SELECT id,batch_key,lot_code,received_at,expiry_date,notes,unit_cost_usd FROM product_batches ORDER BY id').all()
    const result = await execute(w, p)
    assert.equal(result.replayed, false); assert.equal(w.stats.batches, 1); assert.ok(w.stats.binds <= 100)
    assert.deepEqual(w.raw.prepare('SELECT id,batch_key,lot_code,received_at,expiry_date,notes,unit_cost_usd FROM product_batches ORDER BY id').all(), before)
    assert.ok(Math.abs(w.raw.prepare('SELECT SUM(quantity) n FROM branch_stock').get().n - w.quantity) < 1e-9)
    assert.ok(Math.abs(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=1').get().quantity) < 1e-9)
    assert.ok(Math.abs(w.raw.prepare('SELECT SUM(quantity) n FROM branch_batch_stock').get().n - lots.reduce((a, b) => a + b, 0)) < 1e-9)
    assert.equal(w.raw.prepare('SELECT stock_quantity FROM products').get().stock_quantity, w.quantity)
    for (const table of ['transfer_operation_receipts', 'transfer_operation_members', 'action_history', 'audit_logs', 'stock_transfers']) assert.equal(w.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 1)
    const movements = w.raw.prepare('SELECT movement_type,batch_id,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr FROM inventory_movements ORDER BY id').all()
    const direction = value => movements.filter(m => m.movement_type === value).map(({ movement_type, ...m }) => m)
    assert.deepEqual(direction('transfer_out'), direction('transfer_in'))
    for (const movement of movements) assert.equal(movement.unit_cost_usd, movement.batch_id ?? 2.5)
    console.log(JSON.stringify({ scenario: name, reads: w.stats.reads, statements: w.stats.statements, maxBindings: w.stats.binds }))
    await assert.rejects(journal.abortEffectFreeBranchCutoverJournal(w.db, p.proof, result.row.revision, 'No effects'))
    w.raw.close()
  })
  await check('lost acknowledgement recovers one committed receipt before mutable planning; later child does not hide replay', async () => {
    const w = world(); const p = await planned(w)
    w.stats.after = () => { throw Error('network acknowledgement lost') }
    const result = await execute(w, p); assert.equal(result.replayed, true); assert.equal(w.stats.batches, 1)
    const next = JSON.stringify({ ...JSON.parse(p.expected.childJson), sequence: 1 })
    await journal.sealBranchCutoverChild(w.db, p.proof, result.row.revision, next)
    w.raw.exec('UPDATE products SET cost_price_usd=99; UPDATE branches SET is_active=0 WHERE id=1')
    const before = snapshot(w); const batches = w.stats.batches; w.stats.sql = []
    const replay = await execute(w, p)
    assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, result.receipt); assert.equal(snapshot(w), before); assert.equal(w.stats.batches, batches)
    assert.ok(w.stats.sql.every(sql => !/FROM products|FROM product_batches|JOIN branch_batch_stock/i.test(sql)))
    w.raw.close()
  })
  await check('lost acknowledgement with unreadable proof stays unknown and never sends a second write', async () => {
    const w = world(); const p = await planned(w)
    w.stats.after = () => { w.stats.unreadable = true; throw Error('ack lost') }
    await assert.rejects(execute(w, p), error => error.code === 'branch_cutover_child_outcome_unknown')
    assert.equal(w.stats.batches, 1); assert.equal(w.raw.prepare('SELECT next_sequence FROM branch_cutovers').get().next_sequence, 1)
    w.stats.unreadable = false; assert.equal((await execute(w, p)).replayed, true); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  await check('every atomic statement failure conserves complete business and journal state', async () => {
    const reference = world(); const rp = await planned(reference); await execute(reference, rp); const count = reference.stats.statements; reference.raw.close()
    for (let at = 0; at < count; at++) {
      const w = world(); const p = await planned(w); const before = snapshot(w); w.stats.failAt = at
      await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 1); assert.equal(snapshot(w), before, 'boundary ' + at); w.raw.close()
    }
  })
  await check('two simultaneous invocations commit one effect and one journal advance', async () => {
    const w = world(); const p = await planned(w)
    let release; const barrier = new Promise(resolve => { release = resolve }); let arrived = false
    w.stats.before = async () => { arrived = true; await barrier }
    const first = execute(w, p)
    while (!arrived) await new Promise(resolve => setImmediate(resolve))
    const second = await execute(w, p); release(); const loser = await first
    assert.equal(second.replayed, false); assert.equal(loser.replayed, true); assert.equal(w.stats.batches, 2)
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n, 1)
    assert.equal(w.raw.prepare('SELECT next_sequence FROM branch_cutovers').get().next_sequence, 1); w.raw.close()
  })
  for (const mutation of ["UPDATE branch_stock SET quantity=quantity+1 WHERE branch_id=1", "UPDATE branch_stock SET quantity=quantity+1 WHERE branch_id=2", "UPDATE product_batches SET received_at='2020-01-01'", 'UPDATE product_batches SET unit_cost_usd=99', 'DELETE FROM branch_batch_stock', 'UPDATE products SET cost_price_usd=99', 'UPDATE branches SET is_active=0 WHERE id=2', "INSERT INTO branches(name,is_active) VALUES('Shop',1)", "UPDATE users SET permissions='{}' WHERE id=7", 'UPDATE users SET organization_id=NULL WHERE id=7']) await check('batch-time race refused: ' + mutation, async () => {
    const w = world(); const p = await planned(w); let raced
    w.stats.before = raw => { raw.exec(mutation); raced = snapshot(w) }
    await assert.rejects(execute(w, p)); assert.equal(snapshot(w), raced); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  for (const patch of [{ actor: { ...actor, organization_id: null } }, { organizationId: 2 }, { actor: { ...actor, id: 8 } }, { actor: { ...actor, is_active: 0 } }, { proof: { operationId: uuid(1), actorId: 7, organizationId: '1', controlIncarnation: uuid(99), token: uuid(3) } }]) await check('wrong actor / organization / ownership refused', async () => {
    const w = world(); const p = await planned(w); const before = snapshot(w)
    await assert.rejects(execute(w, p, patch)); assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const permissions of ['{}', '{"branches":"review"}', '{"branches":true,"branches:transfer":false}']) await check('current granular grant refuses ' + permissions, async () => {
    const w = world(); const p = await planned(w); w.raw.prepare('UPDATE users SET permissions=?').run(permissions)
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  for (const patch of [{ version: 0 }, { kind: 'transfer' }, { reason: '' }, { transfer: { productId: 1, quantity: 1 } }, { transfer: { productId: 1, destProductId: 2, quantity: 1, batchId: null } }, { sequence: 1 }]) await check('strict child envelope refuses ' + JSON.stringify(patch), async () => {
    const w = world(); const p = await planned(w); const expected = { ...p.expected, childJson: JSON.stringify({ ...JSON.parse(p.expected.childJson), ...patch }) }
    await assert.rejects(execute(w, p, { expected })); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  for (const prepare of [w => legacyMutation(w, 'product_batches', 'UPDATE product_batches SET is_active=0'), w => w.raw.exec('UPDATE branch_stock SET quantity=0 WHERE branch_id=1'), w => legacyMutation(w, 'branch_batch_stock', 'UPDATE branch_batch_stock SET quantity=-1'), w => w.raw.exec('UPDATE branch_batch_stock SET quantity=2'), w => w.raw.exec('UPDATE branch_stock SET quantity=1e999 WHERE branch_id=1')]) await check('stock/lot anomaly refuses without writes', async () => {
    const w = world(); const p = await planned(w); prepare(w); const before = snapshot(w)
    await assert.rejects(execute(w, p)); assert.equal(snapshot(w), before); w.raw.close()
  })
  await check('129 positive lots refused even when selected batch needs only one', async () => {
    const w = world(Array(129).fill(1)); const p = await planned(w, { batchId: 1, quantity: 1 }); const before = snapshot(w)
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0); assert.equal(snapshot(w), before); w.raw.close()
  })
  await check('UTF-8 metadata and invocation budget refuse before writes', async () => {
    const w = world(); const p = await planned(w)
    w.raw.prepare('UPDATE product_batches SET notes=?').run('ខ'.repeat(90000)); await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0)
    w.raw.exec("UPDATE product_batches SET notes='small'")
    await assert.rejects(execute(w, p, { budget: { ...budget, alreadyUsed: 990 } })); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('zero-row journal update must throw and roll back transfer', async () => {
    const w = world(); const p = await planned(w)
    w.raw.exec("CREATE TRIGGER fixture_skip BEFORE UPDATE ON branch_cutovers WHEN NEW.next_sequence>OLD.next_sequence BEGIN SELECT RAISE(IGNORE); END")
    const before = snapshot(w); await assert.rejects(execute(w, p)); assert.equal(snapshot(w), before); w.raw.close()
  })
  for (const [table, sql] of [
    ['transfer_operation_receipts', "UPDATE transfer_operation_receipts SET response_json=json_set(response_json,'$.operation_id','forged')"],
    ['transfer_operation_receipts', 'UPDATE transfer_operation_receipts SET generation=1'],
    ['transfer_operation_receipts', "UPDATE transfer_operation_receipts SET replay_state='reversed'"],
    ['transfer_operation_receipts', "UPDATE transfer_operation_receipts SET status='planning'"],
    ['transfer_operation_receipts', 'UPDATE transfer_operation_receipts SET provenance_version=0'],
    ['transfer_operation_members', 'UPDATE transfer_operation_members SET destination_product_id=2'],
    ['transfer_operation_members', "UPDATE transfer_operation_members SET allocations_json='[]'"],
    ['action_history', 'DELETE FROM action_history'],
  ]) await check('incomplete/forged committed provenance refuses: ' + sql, async () => {
    const w = world(); const p = await planned(w); await execute(w, p); legacyMutation(w, table, sql)
    const before = snapshot(w); const batches = w.stats.batches
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, batches); assert.equal(snapshot(w), before); w.raw.close()
  })
  await check('journal-only and receipt-only states refuse without repair', async () => {
    for (const missing of ['receipt', 'journal']) {
      const w = world(); const p = await planned(w)
      if (missing === 'receipt') w.raw.exec('UPDATE branch_cutovers SET next_sequence=1,committed_children=1,revision=revision+1,planned_child_json=NULL,planned_child_key=NULL,planned_child_digest=NULL')
      else {
        await execute(w, p)
        legacyMutation(w, 'branch_cutovers', `UPDATE branch_cutovers SET next_sequence=0,committed_children=0,revision=${p.row.revision},planned_child_json='${p.expected.childJson}',planned_child_key='${p.row.planned_child_key}',planned_child_digest='${p.row.planned_child_digest}'`)
      }
      const before = snapshot(w); const batches = w.stats.batches
      await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, batches); assert.equal(snapshot(w), before); w.raw.close()
    }
  })
  for (const value of [null, '{}', '{"mode":"restore"}', '{bad']) await check('missing/corrupt/wrong-mode maintenance refuses ' + value, async () => {
    const w = world(); const p = await planned(w)
    legacyMutation(w, 'system_flags', value === null ? "DELETE FROM system_flags WHERE key='maintenance'" : `UPDATE system_flags SET value='${value}' WHERE key='maintenance'`)
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('changed control incarnation refuses restored old ownership', async () => {
    const w = world(); const p = await planned(w)
    legacyMutation(w, 'system_flags', `UPDATE system_flags SET value='${uuid(100)}' WHERE key='branch_cutover_control_incarnation'`)
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('explicit lot uses its exact ID and leaves other same-date stock intact', async () => {
    const w = world([2, 3]); const p = await planned(w, { batchId: 2, quantity: 1 })
    const result = await execute(w, p); assert.equal(result.receipt.destBatchId, 2)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().quantity, 2)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=2 AND branch_id=1').get().quantity, 2)
    assert.equal((await execute(w, p)).replayed, true); w.raw.close()
  })
  await check('actual query budget exact limit and one over; Free is explicitly refused', async () => {
    for (const [used, allowed] of [[932, true], [933, false]]) {
      const w = world(); const p = await planned(w)
      if (allowed) { await execute(w, p, { budget: { ...budget, alreadyUsed: used } }); assert.equal(w.stats.statements, 30) }
      else { await assert.rejects(execute(w, p, { budget: { ...budget, alreadyUsed: used } })); assert.equal(w.stats.batches, 0) }
      w.raw.close()
    }
    const w = world(); const p = await planned(w)
    await assert.rejects(execute(w, p, { budget: { ...budget, tier: 'free' } })); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('actual total SQL/parameter UTF-8 budget at nearest character boundary and one over', async () => {
    const w = world(); const p = await planned(w); const realBatch = w.db.batchOnce.bind(w.db)
    let measured = 0
    w.db.batchOnce = async statements => { measured = statements.reduce((n, s) => n + Buffer.byteLength(s.sql) + Buffer.byteLength(JSON.stringify(s.params || {})), 0); throw Error('measurement only') }
    const permissions = n => JSON.stringify({ branches: true, padding: 'ខ'.repeat(n) })
    const measure = async n => { measured = 0; w.raw.prepare('UPDATE users SET permissions=?').run(permissions(n)); await assert.rejects(execute(w, p)); return measured }
    const zero = await measure(0); const one = await measure(1); const slope = one - zero
    assert.ok(slope >= 3 && zero > 0)
    const count = Math.floor((1048576 - zero) / slope)
    assert.ok(await measure(count)); assert.equal(await measure(count + 1), 0)
    w.db.batchOnce = realBatch; w.raw.prepare('UPDATE users SET permissions=?').run(permissions(count))
    await execute(w, p); assert.equal(w.stats.batches, 1); w.raw.close()
  })
  await check('bounded planner prevents a post-admission oversized metadata/lot read from writing', async () => {
    const w = world(); const p = await planned(w); const prepare = w.db.prepare.bind(w.db); let changed = false
    w.db.prepare = sql => {
      if (!changed && sql.startsWith('SELECT * FROM (SELECT id,')) {
        changed = true; w.raw.prepare('UPDATE product_batches SET notes=?').run('ខ'.repeat(90000))
      }
      return prepare(sql)
    }
    await assert.rejects(execute(w, p)); assert.equal(changed, true); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  await check('fractional quantity lost in a large REAL destination is refused before writes', async () => {
    const w = world([], 0.1); const p = await planned(w)
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=2').run(Number.MAX_SAFE_INTEGER - 1)
    await assert.rejects(execute(w, p)); assert.equal(w.stats.batches, 0); w.raw.close()
  })
  console.log(`${checks} branch cutover child native groups passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
