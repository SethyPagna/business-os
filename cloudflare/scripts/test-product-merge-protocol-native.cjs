const assert = require('node:assert/strict')
const { fixture, loadStockSession } = require('./test-stock-session-atomic.cjs')
const { executeStockTransaction } = loadStockSession('lib/stockTransaction.ts')
const { getDb } = loadStockSession('lib/db.ts')
const capture = loadStockSession('lib/productMergeSnapshot.ts')
const protocol = loadStockSession('lib/productMergeProtocol.ts')
const planKind = protocol.PRODUCT_MERGE_PLAN_V2
const transitionKind = protocol.PRODUCT_MERGE_TRANSITION_V2
const sql = protocol.productMergeProtocolSchemaSql()
assert.equal(sql.includes('\r'), false, 'generated migration SQL is LF-only')
for (const args of [[0,'op',-1,null],[1,'',-1,null],[1,'op',-2,null],[1,'op',0,null],
  [1,'op',-1,2],[1,'op',0,0],[1,'op',Number.MAX_SAFE_INTEGER,2],[1,'x'.repeat(201),0,2]]) {
  assert.throws(() => protocol.productMergePointer(...args), /merge_state_conflict/)
}
assert.equal(Object.isFrozen(protocol.productMergePointer(1, 'op', 0, 2)), true)
function world() {
  const f = fixture(db => {
    db.exec(`UPDATE products SET stock_quantity=1 WHERE id=1; UPDATE branch_stock SET quantity=1 WHERE product_id=1;
      INSERT INTO products(id,name,stock_quantity,is_active) VALUES(2,'Original loser',2,1),(3,'Unrelated',0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2),(3,1,0);
      INSERT INTO product_batches(id,variant_product_id,batch_key,unit_cost_usd,received_quantity,received_cost_usd,is_active)
        VALUES(1,2,'original-financial-receipt',2,2,4,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,0);
      INSERT INTO inventory_movements(id,product_id,product_name,branch_id,movement_type,quantity,reason) VALUES(99,2,'Original loser',1,'add',2,'Original immutable receipt');`)
    const receipt = db.prepare("SELECT sql FROM sqlite_master WHERE name='transfer_operation_receipts'").get().sql
    assert.ok(receipt)
    db.exec(`INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,status,response_json,operation_id,provenance_version,replay_state)
      VALUES(1,7,'original-transfer','original-digest','{}','pending','{}','original-transfer',1,'applied');
      INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      VALUES(1,0,2,1,1,1,1,0,'{}','{}','[{"source_batch_id":1,"quantity":1}]');
      UPDATE transfer_operation_receipts SET status='committed' WHERE id=1;`)
  })
  f.sql.exec(sql)
  return { ...f, db: getDb(f.env) }
}
const pointer = generation => JSON.stringify(protocol.productMergePointer(1, 'merge-protocol', generation, generation < 0 ? null : generation + 2))
const invariantTables = ['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','inventory_movements','action_history','undo_snapshots','transfer_operation_receipts','transfer_operation_members','system_flags']
const state = f => Object.fromEntries(invariantTables.map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))

async function prepare(f, generation = -1, fault = '', actor = 7) {
  const readPlan = capture.planProductMergeCaseSnapshot(1, 2, [])
  const rows = await capture.runProductMergeReadBatch(f.db, readPlan.reads)
  const snapshot = readPlan.decode(rows)
  const source = rows.get('capture')[0].data
  const direction = generation % 2 === 0 ? 'undo' : 'redo'
  const plan = JSON.stringify({ version: 2, actor_id: 7, history_id: 1, operation_id: 'merge-protocol', request_id: 'stable-request', keeper_id: 1, loser_id: 2, source_capture: source })
  const transition = JSON.stringify({ operation_id: 'merge-protocol', plan_id: 1, history_id: 1, keeper_id: 1,
    loser_id: fault === 'swapped-loser' ? 3 : 2, actor_id: fault === 'wrong-actor' ? actor + 1 : actor,
    from_generation: generation, to_generation: generation + 1, direction: fault === 'wrong-direction' ? 'invalid' : direction,
    prior_pointer: pointer(generation), source_capture: source })
  const statement = (sql, params = {}) => ({ sql, params })
  const transitionId = generation + 3
  const out = [capture.productMergeCaptureGuard(snapshot)]
  if (generation === -1) out.push(
    statement(`INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id) VALUES(1,'${planKind}','recorded',@plan,7)`, { plan }),
    statement("INSERT INTO action_history(id,scope,entity,entity_id,label,status,undo_payload,redo_payload,created_by_id) VALUES(1,'products','product_merge','merge-protocol','Merge fixture','recorded',@pointer,@pointer,7)", { pointer: pointer(-1) }),
  )
  out.push(statement(`INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id) VALUES(@id,'${transitionKind}','prepared',@transition,@actor)`, { id: transitionId, transition, actor }))
  if (direction === 'undo') out.push(statement('UPDATE products SET is_active=1 WHERE id=2'))
  out.push(
    statement('UPDATE branch_stock SET quantity=CASE product_id WHEN 1 THEN @keeper ELSE @loser END WHERE product_id IN (1,2)', { keeper: direction === 'undo' ? 1 : 3, loser: direction === 'undo' ? 2 : 0 }),
    statement('UPDATE products SET stock_quantity=CASE id WHEN 1 THEN @keeper ELSE @loser END WHERE id IN (1,2)', { keeper: direction === 'undo' ? 1 : 3, loser: direction === 'undo' ? 2 : 0 }),
    statement("INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason) VALUES(1,1,'adjust',@keeper,@reason),(2,1,'adjust',@loser,@reason)", { keeper: direction === 'undo' ? -2 : 2, loser: direction === 'undo' ? 2 : -2, reason: `Compensating generation ${generation + 1}` }),
  )
  const leftover = {
    'cache-left': 'UPDATE products SET stock_quantity=1 WHERE id=2',
    'branch-left': 'UPDATE branch_stock SET quantity=1 WHERE product_id=2',
    'receipt-left': 'UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1',
    'tag-left': "INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining,condition_tag) VALUES(2,1,1,1,'damaged')",
  }[fault]
  if (leftover) out.push(statement(leftover))
  if (direction === 'redo') out.push(statement('UPDATE products SET is_active=0 WHERE id=2'))
  if (fault === 'catalog-twice') out.push(statement('UPDATE products SET is_active=1 WHERE id=2'))
  const next = JSON.parse(pointer(generation + 1))
  if (fault === 'pointer-operation') next.operation_id = 'unrelated-merge'
  if (fault === 'pointer-applier') next.applier = 'product.delete'
  if (fault === 'pointer-version') next.version = 1
  if (fault === 'pointer-seal') next.seal_id = 77
  out.push(statement("UPDATE action_history SET undo_payload=@next,redo_payload=@next,status=@status WHERE id=1 AND undo_payload=@prior AND redo_payload=@prior", {
    next: JSON.stringify(next), prior: fault === 'history-cas' ? '{}' : pointer(generation), status: direction === 'undo' ? 'redoable' : 'undoable',
  }))
  if (fault !== 'missing-seal') out.push(statement(`UPDATE undo_snapshots SET status='sealing',payload_json=json_set(payload_json,'$.post_capture',${fault === 'false-seal' ? "json('{}')" : `json((SELECT data FROM (${readPlan.reads[0].sql}) WHERE oversized=0))`}) WHERE id=@transitionId`, fault === 'false-seal' ? { transitionId } : { ...readPlan.reads[0].params, transitionId }))
  if (fault === 'late-failure') out.push(statement('SELECT json_extract(\'[1]\',\'$[merge_late_failure]\')'))
  return out
}

async function main() {
  for (const fault of ['swapped-loser','wrong-actor','wrong-direction','history-cas','missing-seal','late-failure',
    'cache-left','branch-left','receipt-left','tag-left','catalog-twice','false-seal',
    'pointer-operation','pointer-applier','pointer-version','pointer-seal']) {
    const f = world()
    try {
      const before = state(f)
      await assert.rejects(executeStockTransaction(f.db, await prepare(f, -1, fault), 'once'))
      assert.deepEqual(state(f), before, fault + ' rolls back complete graph')
      console.log('PASS ' + fault + ': no stock/history/authority residue')
    } finally { f.sql.close() }
  }
  for (const fault of ['history-identity', 'history-labels', 'initial-seal', 'after-seal-history', 'after-seal-stock', 'early-publish', 'history-delete']) {
    const f = world()
    try {
      const before = state(f), statements = await prepare(f)
      if (fault === 'history-identity') {
        const write = statements.find(row => row.sql.startsWith('UPDATE action_history SET undo_payload'))
        write.sql = write.sql.replace('SET undo_payload=', "SET created_by_id=8,entity='unrelated',entity_id='unrelated',label='rewritten',undo_payload=")
      }
      if (fault === 'initial-seal') {
        const history = statements.find(row => row.sql.startsWith('INSERT INTO action_history'))
        const pointer = JSON.parse(history.params.pointer); pointer.seal_id = 999
        history.params.pointer = JSON.stringify(pointer)
        const transition = statements.find(row => row.params?.transition)
        const payload = JSON.parse(transition.params.transition); payload.prior_pointer = history.params.pointer
        transition.params.transition = JSON.stringify(payload)
        statements.find(row => row.sql.startsWith('UPDATE action_history SET undo_payload')).params.prior = history.params.pointer
      }
      if (fault === 'after-seal-history') statements.push({ sql: "UPDATE action_history SET undo_payload='{}',redo_payload='{}' WHERE id=1" })
      if (fault === 'history-labels') statements.push({ sql: "UPDATE action_history SET undo_label='Rewritten',redo_label='Rewritten',reversible=0 WHERE id=1" })
      if (fault === 'after-seal-stock') statements.push({ sql: 'UPDATE branch_stock SET quantity=4 WHERE product_id=1' }, { sql: 'UPDATE products SET stock_quantity=4 WHERE id=1' })
      if (fault === 'early-publish') statements.push({ sql: "UPDATE undo_snapshots SET status='sealed' WHERE id=2" })
      if (fault === 'history-delete') statements.push({ sql: 'DELETE FROM action_history WHERE id=1' })
      await assert.rejects(executeStockTransaction(f.db, statements, 'once'), /merge_history_immutable|merge_transition_/, fault)
      assert.deepEqual(state(f), before, fault + ' must roll back complete transaction, not leave a stale seal')
      console.log('PASS completion boundary: ' + fault)
    } finally { f.sql.close() }
  }
  await verifyInsertIdentity()
  for (const omitGuard of [false, true]) {
    const rival = world()
    try {
      const statements = await prepare(rival)
      await executeStockTransaction(rival.db, [{sql:'UPDATE branch_stock SET quantity=3 WHERE product_id=2'}, {sql:'UPDATE products SET stock_quantity=3 WHERE id=2'}], 'once')
      const before = state(rival)
      await assert.rejects(executeStockTransaction(rival.db, omitGuard ? statements.slice(1) : statements, 'once'))
      assert.deepEqual(state(rival), before)
      console.log('PASS source-CAS rival preserves complete graph; explicit outer guard omitted=' + omitGuard)
    } finally { rival.sql.close() }
  }
  {
    const changed = world()
    try {
      await executeStockTransaction(changed.db, await prepare(changed), 'once')
      await executeStockTransaction(changed.db, [{sql:'UPDATE branch_stock SET quantity=4 WHERE product_id=1'}, {sql:'UPDATE products SET stock_quantity=4 WHERE id=1'}], 'once')
      const before = state(changed)
        await assert.rejects(executeStockTransaction(changed.db, await prepare(changed, 0), 'once'))
        assert.deepEqual(state(changed), before)
        console.log('PASS ordinary fresh Undo refuses intervening stock change before capture')
    } finally { changed.sql.close() }
  }
  const f = world()
  try {
    const original = state(f)
    const first = await prepare(f)
    f.loseNextCommitAcknowledgement()
    await assert.rejects(executeStockTransaction(f.db, first, 'once'))
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind=? AND status='sealed'").get(transitionKind).n, 1)
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 3)
    const committed = state(f)
    const planBytes = f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=1').get().payload_json
    const firstPost = JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=2').get().payload_json).post_capture
    const actualCapture = await capture.runProductMergeReadBatch(f.db, capture.planProductMergeCaseSnapshot(1, 2, []).reads)
    assert.deepEqual(firstPost, JSON.parse(actualCapture.get('capture')[0].data), 'seal is actual full bounded post-state')
    await assert.rejects(executeStockTransaction(f.db, first, 'once'))
    assert.deepEqual(state(f), committed)
    for (const generation of [0,1,2,3]) await executeStockTransaction(f.db, await prepare(f, generation, '', generation % 2 === 0 ? 8 : 7), 'once')
    assert.deepEqual(f.sql.prepare('SELECT created_by_id FROM undo_snapshots WHERE kind=? ORDER BY id').all(transitionKind).map(row => row.created_by_id), [7,8,7,8,7])
    assert.equal(f.sql.prepare('SELECT created_by_id FROM action_history WHERE id=1').get().created_by_id, 7, 'replay performer does not replace original creator')
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 3)
    assert.deepEqual(f.sql.prepare('SELECT * FROM inventory_movements WHERE id=99').all(), original.inventory_movements)
    assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_members').all(), original.transfer_operation_members)
    assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_receipts').all(), original.transfer_operation_receipts)
    assert.deepEqual(f.sql.prepare('SELECT * FROM product_batches').all(), original.product_batches)
    assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=1').get().payload_json, planBytes)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n, 11)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    await assert.rejects(executeStockTransaction(f.db, [{ sql: "UPDATE undo_snapshots SET payload_json='{}' WHERE id=1" }], 'once'))
    await assert.rejects(executeStockTransaction(f.db, [{ sql: 'UPDATE transfer_operation_members SET quantity=2' }], 'once'))
    await assert.rejects(executeStockTransaction(f.db, [{ sql: 'UPDATE product_batches SET variant_product_id=1 WHERE id=1' }], 'once'))
    await assert.rejects(executeStockTransaction(f.db, [{ sql: 'DELETE FROM product_batches WHERE id=1' }], 'once'))
    const beforeStale = state(f)
    await assert.rejects(executeStockTransaction(f.db, await prepare(f, 0), 'once'))
    assert.deepEqual(state(f), beforeStale)
    await executeStockTransaction(f.db, [{ sql: "UPDATE action_history SET last_error='Display diagnostic' WHERE id=1" }], 'once')
    assert.equal(f.sql.prepare('SELECT last_error FROM action_history WHERE id=1').get().last_error, 'Display diagnostic', 'unchanged historical identity/head permits diagnostics')
    console.log('PASS lost ACK physical once, original plan/history immutable and four compensating replay transitions')
  } finally { f.sql.close() }
  console.log('LOCAL PROTOCOL MODULE ONLY: no numbered migration, route integration, clone mapping or Free/Paid admission certificate')
}
async function verifyInsertIdentity(makeWorld = world) {
  const cases = [
    ['history identity', "INSERT OR REPLACE INTO action_history(id,scope,entity,entity_id,label,status,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at,last_error) SELECT id,scope,entity,entity_id,label,status,undo_payload,redo_payload,8,created_by_name,created_at,updated_at,last_error FROM action_history WHERE id=1"],
    ['history kind', "INSERT OR REPLACE INTO action_history(id,scope,entity,entity_id,label,status,undo_payload,redo_payload,created_by_id) VALUES(1,'products','unrelated','other','Replaced','recorded','{}','{}',8)"],
    ['plan kind', "INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) VALUES(1,'unrelated','recorded','{}',7)"],
    ['seal kind', "INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) VALUES(2,'unrelated','recorded','{}',7)"],
    ['plan request', `INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) SELECT 99,kind,status,json_set(payload_json,'$.history_id',99,'$.operation_id','different-operation'),created_by_id FROM undo_snapshots WHERE id=1`],
    ['plan operation', `INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) SELECT 99,kind,status,json_set(payload_json,'$.history_id',99,'$.request_id','different-request'),created_by_id FROM undo_snapshots WHERE id=1`],
    ['plan history', `INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) SELECT 99,kind,status,json_set(payload_json,'$.request_id','different-request','$.operation_id','different-operation'),created_by_id FROM undo_snapshots WHERE id=1`],
    ['seal generation', `INSERT OR REPLACE INTO undo_snapshots(id,kind,status,payload_json,created_by_id) SELECT 99,kind,status,payload_json,created_by_id FROM undo_snapshots WHERE id=2`],
  ]
  for (const [name, write] of cases) {
    const f = makeWorld()
    try {
      assert.equal(f.sql.pragma('recursive_triggers', { simple: true }), 0, 'identity protection does not depend on recursive delete triggers')
      await executeStockTransaction(f.db, await prepare(f), 'once')
      const before = state(f)
      await assert.rejects(executeStockTransaction(f.db, [{ sql: write }], 'once'), /merge_history_immutable|merge_identity_immutable|merge_plan_invalid|merge_transition_invalid/, name)
      assert.deepEqual(state(f), before, name + ' preserves original rows, current stock and transaction authority')
      console.log('PASS insert identity: ' + name)
    } finally { f.sql.close() }
  }
  for (const fault of ['wrong-history-id', 'duplicate-history-head', 'pending-collision']) {
    const f = makeWorld()
    try {
      const before = state(f), statements = await prepare(f)
      if (fault === 'wrong-history-id') {
        const plan = statements.find(row => row.params?.plan)
        plan.params.plan = JSON.stringify({ ...JSON.parse(plan.params.plan), history_id: 99 })
      }
      if (fault === 'duplicate-history-head') {
        const historyIndex = statements.findIndex(row => row.sql.startsWith('INSERT INTO action_history'))
        statements.splice(historyIndex + 1, 0, { ...statements[historyIndex], sql: statements[historyIndex].sql.replace('VALUES(1,', 'VALUES(99,') })
      }
      if (fault === 'pending-collision') {
        const transitionIndex = statements.findIndex(row => row.params?.transition)
        const row = statements[transitionIndex]
        statements.splice(transitionIndex + 1, 0, { ...row, sql: row.sql.replace('INSERT INTO', 'INSERT OR REPLACE INTO'), params: { ...row.params, id: 99 } })
      }
      await assert.rejects(executeStockTransaction(f.db, statements, 'once'), /merge_history_immutable|merge_identity_immutable|merge_transition_invalid/, fault)
      assert.deepEqual(state(f), before, fault + ' rolls back the original transaction')
      console.log('PASS insert identity: ' + fault)
    } finally { f.sql.close() }
  }
  const f = makeWorld()
  try {
    const trigger = f.sql.prepare("SELECT sql FROM sqlite_master WHERE name='product_merge_v2_finish'").get().sql
    const select = trigger.slice(trigger.indexOf('AND EXISTS(') + 'AND EXISTS('.length, trigger.lastIndexOf('\n  BEGIN')).trim().slice(0, -1)
    const plan = f.sql.prepare('EXPLAIN QUERY PLAN ' + select).all()
    assert.ok(plan.some(row => /SCAN t USING INDEX product_merge_v2_single_pending/.test(row.detail)), 'transaction finish scans the single-pending partial index, not all historical transitions')
    console.log('PASS finish query plan uses the at-most-one pending transition index')
  } finally { f.sql.close() }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { world, prepare, state, main, verifyInsertIdentity }
