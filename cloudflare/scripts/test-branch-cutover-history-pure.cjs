// Branch cutover registry v3, action_history family (G12 design §1.3 table, §1.5 T1.1/T1.2/T1.4).
// - every registered undo applier has exactly one cutover rule (registry parity with undoAppliers.ts)
// - classifyCutoverHistory table: rule x touch, unknown applier and malformed touch refuse
// - the SQL projection (historyOpenPageSql) derives the same decision as the JS classifier for a fixture with
//   rows of every family at the source, the target and neither, undoable and redoable, at SQLite depth 100
// - leave appliers' replay modules never write stock (static pin, T1.4)
// - the closure statements close exactly the planned rows, write one audit row each, and refuse a second apply
// - E9: the touch bit is re-derived in JS from independently projected branch-id facts; a wrong JSON path in
//   the SQL touch predicate (or in the facts query) refuses the page instead of being agreed by both sides
// The fixture builder is exported for the end-to-end parent test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(name, mutations = []) {
  let source = fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/\r\n/g, '\n')
  for (const [from, to] of mutations) { assert.ok(source.includes(from), from); source = source.replace(from, to) }
  const module = { exports: {} }
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', js)(() => ({}), module, module.exports)
  return module.exports
}
function migrated() {
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100; raw.limits.variableNumber = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  return raw
}

/**
 * Seeds open history rows of every applier family (plus closed and client-only rows) referencing
 * branch ids { source, target, other }. Returns [{ id, applier, expected: 'leave'|'close'|'absent' }].
 * 'absent' rows are not open applier rows (closed, client closures) and must stay byte-identical.
 */
function seedHistoryFamilies(raw, { source, target, other }, base = 9000) {
  const rows = []
  let n = base
  const sale = (branch) => { const id = ++n; raw.prepare("INSERT INTO sales(id,branch_id,branch_name,receipt_number) VALUES(?,?,NULL,?)").run(id, branch, 'R' + id); return id }
  const ret = (branch) => { const id = ++n; raw.prepare("INSERT INTO returns(id,branch_id,branch_name) VALUES(?,?,NULL)").run(id, branch); return id }
  const snap = (kind, payload) => { const id = ++n; raw.prepare('INSERT INTO undo_snapshots(id,kind,status,payload_json) VALUES(?,?,?,?)').run(id, kind, 'applied', JSON.stringify(payload)); return id }
  const history = (applier, expected, { status = 'undoable', undo, redo, entity = 'fixture', entityId = null, reversible = 1, label } = {}) => {
    const id = ++n
    const undoPayload = undo ?? JSON.stringify({ applier })
    const redoPayload = redo ?? JSON.stringify({ applier })
    raw.prepare(`INSERT INTO action_history(id,scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,7,'operator','2026-10-01 10:00:00','2026-10-01 10:00:00')`).run(id, 'fixture', entity, entityId, label || applier + ' ' + expected, reversible, status, undoPayload, redoPayload)
    rows.push({ id, applier, expected }); return id
  }
  // leave: no stock at any branch in their replay
  for (const applier of ['customer.gender_restore', 'sale.fields.bulk', 'sale.customer.bulk', 'sale.customer.v2.bulk', 'sale.customer.single', 'sale.settlement', 'supplier.backfill']) {
    history(applier, 'leave'); history(applier, 'leave', { status: 'redoable' })
  }
  // branch.update: either branch closes; a third branch leaves
  history('branch.update', 'close', { undo: JSON.stringify({ applier: 'branch.update', id: source }), redo: JSON.stringify({ applier: 'branch.update', id: source }) })
  history('branch.update', 'close', { status: 'redoable', undo: JSON.stringify({ applier: 'branch.update', id: target }), redo: JSON.stringify({ applier: 'branch.update', id: target }) })
  history('branch.update', 'leave', { undo: JSON.stringify({ applier: 'branch.update', id: other }), redo: JSON.stringify({ applier: 'branch.update', id: other }) })
  // stock.transfer always closes (pre-cutover transfers are between the two branches)
  history('stock.transfer', 'close', { entity: 'stock_transfer', entityId: 'pre-cutover-transfer', undo: JSON.stringify({ applier: 'stock.transfer', operation_id: 'pre-cutover-transfer', generation: 0, permission: 'branches' }) })
  // product.merge.group always closes (documented over-close)
  history('product.merge.group', 'close', { undo: JSON.stringify({ applier: 'product.merge.group', generation: 0, group_key: 'g', review_id: 'r', snapshot_id: snap('product.merge.group', { children: [] }) }) })
  // stock.session: member at source closes, target-only leaves
  for (const [branch, expected] of [[source, 'close'], [target, 'leave']]) {
    const h = history('stock.session', expected); const op = 'session-' + h
    raw.prepare("INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json,history_id) VALUES(?,7,?,'stock_in','{}',?)").run(op, op, h)
    raw.prepare("INSERT INTO stock_session_members(operation_id,line_id,command_kind,product_id,branch_id,quantity) VALUES(?,'l1','receive',1,?,1)").run(op, branch)
  }
  // stock.quantity_set (branch in request_json) and stock.session_line_edit (branch in before_json)
  for (const [applier, column] of [['stock.quantity_set', 'request_json'], ['stock.session_line_edit', 'before_json']]) {
    for (const [branch, expected, status] of [[source, 'close', 'undoable'], [target, 'leave', 'undoable'], [source, 'close', 'redoable']]) {
      const h = history(applier, expected, { status }); const op = 'adj-' + h
      const json = { request_json: '{}', before_json: '{}', after_json: '{}', revision_json: '{}' }; json[column] = JSON.stringify({ branchId: branch, productId: 1 })
      raw.prepare(`INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json,history_id)
        VALUES(?,7,?,?,'d','{}',?,?,?,?)`).run(op, op, json.request_json, json.before_json, json.after_json, json.revision_json, h)
    }
  }
  // sale.add_items: via the snapshot's saleId; a target sale leaves
  for (const [branch, expected] of [[source, 'close'], [target, 'leave']]) {
    const id = sale(branch)
    history('sale.add_items', expected, { undo: JSON.stringify({ applier: 'sale.add_items', snapshot_id: snap('sale.add_items', { saleId: id, lines: [{ branchId: branch, productId: 1 }] }) }) })
  }
  // sale.status.bulk: any member sale at the source closes
  for (const [branches, expected] of [[[target, source], 'close'], [[target], 'leave']]) {
    const h = history('sale.status.bulk', expected); const op = 'ssb-' + h
    raw.prepare("INSERT INTO sale_bulk_operations(id,actor_id,request_id,request_json,history_id,receipt_json) VALUES(?,7,?,'{}',?,'{}')").run(op, op, h)
    for (const branch of branches) raw.prepare("INSERT INTO sale_bulk_members(operation_id,sale_id,revision,movement_fingerprint) VALUES(?,?,0,'f')").run(op, sale(branch))
  }
  // return.fields.bulk: any member return at the source closes
  for (const [branch, expected] of [[source, 'close'], [target, 'leave']]) {
    const h = history('return.fields.bulk', expected); const op = 'rfb-' + h
    raw.prepare(`INSERT INTO return_bulk_operations(id,actor_id,request_id,request_json,history_id,receipt_json) VALUES(?,7,?,'{"field":"status"}',?,'{}')`).run(op, op, h)
    raw.prepare("INSERT INTO return_bulk_members(operation_id,return_id,revision,stock_fingerprint) VALUES(?,?,0,'f')").run(op, ret(branch))
  }
  // product.merge / .bulk: snapshot atoms under a branch key equal to the source close
  for (const applier of ['product.merge', 'product.merge.bulk']) {
    history(applier, 'close', { undo: JSON.stringify({ applier, snapshot_id: snap(applier, { losers: [{ id: 5, stock: [{ branch_id: source, quantity: 2 }, { branch_id: target, quantity: 1 }] }] }) }) })
    history(applier, 'leave', { status: 'redoable', redo: JSON.stringify({ applier, snapshot_id: snap(applier, { losers: [{ id: 6, stock: [{ branchId: target, quantity: 1 }] }] }) }) })
  }
  // product.remove: snapshot via product_remove_operations; source stock row also closes
  for (const [branch, expected] of [[source, 'close'], [target, 'leave']]) {
    const h = history('product.remove', expected); const op = 'remove-' + h; const s = snap('product.remove', { stock: [{ b: branch, q: 1 }] })
    raw.prepare(`INSERT INTO product_remove_operations(operation_id,actor_id,requester_id,source,request_id,product_id,reason,state_digest,plan_digest,plan_json,status,undo_snapshot_id,action_history_id)
      VALUES(?,7,7,'direct',?,?,'fixture','s','p','{}','undo_ready',?,?)`).run(op, op, 100000 + h, s, h)
  }
  // not open applier rows: closed, non-reversible, client closures without an applier, malformed JSON
  history('stock.quantity_set', 'absent', { status: 'recorded' })
  history('stock.transfer', 'absent', { reversible: 0 })
  history('client', 'absent', { undo: '{}', redo: '{}' })
  history('client', 'absent', { undo: 'not json', redo: 'not json' })
  return rows
}

async function main() {
  const history = load('lib/branchCutoverHistory.ts')
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }

  await check('every registered undo applier has exactly one cutover rule (registry parity)', () => {
    const source = fs.readFileSync(path.join(root, 'src/lib/undoAppliers.ts'), 'utf8')
    const block = source.slice(source.indexOf('const APPLIERS: Record<string, UndoApplierDef> = {'), source.indexOf('// registered applier (the fall-through-to-client-replay case).'))
    const constants = {}
    for (const file of fs.readdirSync(path.join(root, 'src/lib'))) {
      for (const m of fs.readFileSync(path.join(root, 'src/lib', file), 'utf8').matchAll(/export const ([A-Z_]+_KIND) = '([^']+)'/g)) constants[m[1]] = m[2]
    }
    const kinds = [...block.matchAll(/^  (?:'([^']+)'|\[([A-Z_]+)\]): /gm)].map(m => m[1] || constants[m[2]])
    assert.equal(kinds.length, 19); assert.ok(kinds.every(Boolean))
    assert.deepEqual([...kinds].sort(), Object.keys(history.CUTOVER_HISTORY_RULES).sort())
  })

  await check('T1.1 classifier table: rule x touch, unknown applier and malformed touch refuse', () => {
    const expect = { leave: [0, 0, 0, 0], close: [1, 1, 1, 1], close_if_source: [0, 1, 0, 1], close_if_either: [0, 1, 1, 1] }
    for (const [applier, rule] of Object.entries(history.CUTOVER_HISTORY_RULES)) {
      for (const touch of [0, 1, 2, 3]) assert.equal(history.classifyCutoverHistory({ applier, touch }), expect[rule][touch] ? 'close' : 'leave', applier + ' ' + touch)
    }
    for (const applier of ['', 'future.kind', 'constructor', '__proto__', null, 7]) assert.throws(() => history.classifyCutoverHistory({ applier, touch: 1 }), /history_applier_unclassified/)
    for (const touch of [-1, 4, 1.5, 'x', null]) assert.throws(() => history.classifyCutoverHistory({ applier: 'stock.session', touch }), /history_touch_invalid/)
    // the leave set is exactly the design's seven money/metadata-only kinds
    assert.deepEqual(Object.entries(history.CUTOVER_HISTORY_RULES).filter(([, rule]) => rule === 'leave').map(([k]) => k).sort(),
      ['customer.gender_restore', 'sale.customer.bulk', 'sale.customer.single', 'sale.customer.v2.bulk', 'sale.fields.bulk', 'sale.settlement', 'supplier.backfill'])
  })

  await check('SQL projection and JS classifier agree for every family at source, target and neither (depth 100)', () => {
    const raw = migrated()
    const ids = { source: 2, target: 1, other: 3 }
    const rows = seedHistoryFamilies(raw, ids)
    const page = raw.prepare(history.historyOpenPageSql()).all({ source: 2, target: 1, after: 0, limit: 1000 })
    const seen = new Map(page.map(entry => [entry.k, history.checkCutoverHistoryRow(entry.j, { source: 2, target: 1 })]))
    for (const row of rows) {
      if (row.expected === 'absent') { assert.equal(seen.has(row.id), false, row.applier + ' ' + row.id); continue }
      assert.equal(seen.get(row.id)?.decision, row.expected, row.applier + ' ' + row.id)
    }
    assert.equal(seen.size, rows.filter(row => row.expected !== 'absent').length)
    // T1.2: the same Set at the warehouse leaves; swapping the cutover direction flips it
    const swapped = raw.prepare(history.historyOpenPageSql()).all({ source: 1, target: 2, after: 0, limit: 1000 }).map(entry => history.checkCutoverHistoryRow(entry.j, { source: 1, target: 2 }))
    const qs = swapped.filter(entry => entry.row.applier === 'stock.quantity_set').map(entry => entry.decision).sort()
    assert.deepEqual(qs, ['close', 'leave', 'leave'])
    // paging in rowid order with a small limit returns the same rows
    let after = 0, paged = []
    for (;;) { const p = raw.prepare(history.historyOpenPageSql()).all({ source: 2, target: 1, after, limit: 3 }); paged.push(...p); if (p.length < 3) break; after = p[p.length - 1].k }
    assert.deepEqual(paged.map(p => p.k), page.map(p => p.k))
    // aggregate preview and the finalize predicate agree with the page
    const counts = raw.prepare(history.HISTORY_DECISION_COUNTS_SQL).all({ source: 2, target: 1 })
    assert.equal(counts.reduce((sum, c) => sum + c.n, 0), seen.size); assert.ok(counts.every(c => c.decision !== 'unclassified'))
    assert.equal(raw.prepare(`SELECT ${history.HISTORY_OPEN_CLOSABLE_EXISTS} AS x`).get({ source: 2, target: 1 }).x, 1)
    assert.equal(raw.limits.exprDepth, 100); raw.close()
  })

  await check('a disagreeing projection or an ambiguous applier refuses the page', () => {
    const ids = { source: 2, target: 1 }
    const base = { id: 5, entity: null, entity_id: null, status: 'undoable', reversible: 1, updated_at: null, last_error: null, applier: 'stock.session', other: 'stock.session', touch: 1, decision: 'close', facts: [1, 2], undo: '{}', redo: '{}' }
    assert.equal(history.checkCutoverHistoryRow(JSON.stringify(base), ids).decision, 'close')
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, decision: 'leave' }), ids), /history_classification_disagrees/)
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, other: 'stock.transfer' }), ids), /history_applier_ambiguous/)
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, applier: 'future.kind', other: null, decision: 'unclassified' }), ids), /history_applier_unclassified/)
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, status: 'recorded' }), ids), /history_row_invalid/)
    // E9: facts and touch must agree; complete appliers exactly, bulk appliers at least for a header at the source
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, facts: [1] }), ids), /history_facts_disagree/)
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, touch: 0, decision: 'leave' }), ids), /history_facts_disagree/)
    for (const facts of [null, undefined, '[2]', [2.5], ['2']]) assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, facts }), ids), /history_facts_invalid/, JSON.stringify(facts))
    const bulk = { ...base, applier: 'sale.status.bulk', other: 'sale.status.bulk' }
    assert.equal(history.checkCutoverHistoryRow(JSON.stringify({ ...bulk, facts: [1] }), ids).decision, 'close', 'a line at the source is not projected: the SQL bit stands')
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...bulk, facts: [2], touch: 0, decision: 'leave' }), ids), /history_facts_disagree/)
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...base, applier: 'product.merge', other: 'product.merge', facts: [2] }), ids), /history_facts_invalid/)
    const update = { ...base, applier: 'branch.update', other: 'branch.update', touch: 2, decision: 'close', facts: [1] }
    assert.equal(history.checkCutoverHistoryRow(JSON.stringify(update), ids).decision, 'close')
    assert.throws(() => history.checkCutoverHistoryRow(JSON.stringify({ ...update, touch: 0, decision: 'leave' }), ids), /history_facts_disagree/)
  })

  await check('T1.4 leave appliers never write stock (static pin of their replay modules)', () => {
    const modules = ['saleSettlementAction.ts', 'saleBulkUpdate.ts', 'customerGenderRestoration.ts']
    for (const file of modules) {
      const text = fs.readFileSync(path.join(root, 'src/lib', file), 'utf8')
      assert.doesNotMatch(text, /(UPDATE|INSERT INTO|DELETE FROM)\s+(branch_stock|branch_batch_stock|inventory_movements)\b/i, file)
    }
    const undo = fs.readFileSync(path.join(root, 'src/lib/undoAppliers.ts'), 'utf8')
    for (const name of ['applySupplierBackfillUndo', 'applySupplierBackfillRedo']) {
      const start = undo.indexOf('async function ' + name); assert.ok(start > 0, name)
      const body = undo.slice(start, undo.indexOf('\n}\n', start))
      assert.doesNotMatch(body, /(UPDATE|INSERT INTO|DELETE FROM)\s+(branch_stock|branch_batch_stock|inventory_movements)\b/i, name)
    }
  })

  await check('closure statements close exactly the planned rows with one audit each and refuse a second apply', () => {
    const raw = migrated()
    const rows = seedHistoryFamilies(raw, { source: 2, target: 1, other: 3 })
    const page = raw.prepare(history.historyOpenPageSql()).all({ source: 2, target: 1, after: 0, limit: 1000 }).map(entry => history.checkCutoverHistoryRow(entry.j, { source: 2, target: 1 }))
    const closes = page.filter(entry => entry.decision === 'close').map(entry => ({ id: entry.row.id, marker: history.UNDO_CLOSED_BRANCH_RETIRED, previousStatus: entry.row.status, applier: entry.row.applier, updatedAt: entry.row.updated_at }))
    const leaveBefore = raw.prepare('SELECT * FROM action_history WHERE id IN (' + page.filter(e => e.decision === 'leave').map(e => e.row.id).join(',') + ') ORDER BY id').all()
    const statements = history.historyClosureStatements({ closes, operationId: '00000000-0000-4000-8000-000000000001', actorId: 7, actorName: 'operator', source: 2, target: 1 })
    const run = () => { raw.exec('BEGIN'); try { for (const s of statements) raw.prepare(s.sql).all(s.params); raw.exec('COMMIT') } catch (e) { raw.exec('ROLLBACK'); throw e } }
    run()
    const closed = raw.prepare("SELECT id,status,reversible,last_error FROM action_history WHERE last_error=? ORDER BY id").all(history.UNDO_CLOSED_BRANCH_RETIRED)
    assert.deepEqual(closed.map(r => r.id), closes.map(c => c.id).sort((a, b) => a - b))
    assert.ok(closed.every(r => r.status === 'recorded' && r.reversible === 0))
    assert.equal(raw.prepare(history.CLOSURE_AUDIT_COUNT_SQL).all({ operation: '00000000-0000-4000-8000-000000000001' })[0]['count(*)'], closes.length)
    assert.deepEqual(raw.prepare('SELECT * FROM action_history WHERE id IN (' + leaveBefore.map(r => r.id).join(',') + ') ORDER BY id').all(), leaveBefore)
    assert.throws(run, /branch_cutover_history_conflict/)
    assert.equal(raw.prepare(history.CLOSURE_AUDIT_COUNT_SQL).all({ operation: '00000000-0000-4000-8000-000000000001' })[0]['count(*)'], closes.length)
    assert.equal(raw.prepare(`SELECT ${history.HISTORY_OPEN_CLOSABLE_EXISTS} AS x`).get({ source: 2, target: 1 }).x, 0)
    assert.equal(rows.filter(r => r.expected === 'close').length, closes.length)
    assert.ok(history.isUndoClosedByBranchCutover(closed[0])); assert.equal(history.isUndoClosedByBranchCutover({ reversible: 1, last_error: history.UNDO_CLOSED_BRANCH_RETIRED }), false)
    raw.close()
  })

  await check('E9 a wrong JSON path in the SQL touch predicate, or in the facts query, refuses the page (it is not agreed by both sides)', () => {
    const ids = { source: 2, target: 1 }
    const pageOf = (module) => {
      const raw = migrated(); seedHistoryFamilies(raw, { source: 2, target: 1, other: 3 })
      try { return raw.prepare(module.historyOpenPageSql()).all({ ...ids, after: 0, limit: 1000 }).map(entry => module.checkCutoverHistoryRow(entry.j, ids)) } finally { raw.close() }
    }
    // the real module: every complete applier carries facts; product.* carry none
    const rows = pageOf(history).map(entry => entry.row)
    for (const row of rows) {
      if (history.HISTORY_COMPLETE_FACT_APPLIERS.includes(row.applier) || history.HISTORY_HEADER_FACT_APPLIERS.includes(row.applier)) assert.ok(Array.isArray(row.facts), row.applier)
      else assert.equal(row.facts, null, row.applier)
    }
    assert.ok(rows.some(row => row.applier === 'stock.quantity_set' && row.facts.includes(2)))
    // plausible wrong implementations, each agreed by the decision table alone at ecc17dd14
    const mutants = {
      'touch path typo (quantity_set reads $.branch_id)': [["WHEN 'stock.quantity_set' THEN EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o WHERE o.history_id=h.id AND @source IN (\n      CAST(json_extract(${valid('o.request_json')},'$.branchId')",
        "WHEN 'stock.quantity_set' THEN EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o WHERE o.history_id=h.id AND @source IN (\n      CAST(json_extract(${valid('o.request_json')},'$.branch_id')"]],
      'touch join drops the snapshot lines (sale.add_items)': [["      OR EXISTS(SELECT 1 FROM json_each(u.payload_json,'$.lines') l WHERE json_type(l.value)='object' AND CAST(json_extract(l.value,'$.branchId') AS INTEGER)=@source)))",
        "      OR 0))"], ["      EXISTS(SELECT 1 FROM sales s WHERE s.id=CAST(json_extract(u.payload_json,'$.saleId') AS INTEGER) AND s.branch_id=@source)\n      OR EXISTS(SELECT 1 FROM sale_items si",
        "      0\n      OR EXISTS(SELECT 1 FROM sale_items si"], ["      OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=CAST(json_extract(u.payload_json,'$.saleId') AS INTEGER) AND si.branch_id=@source)",
        "      OR 0"]],
      'touch reads the wrong session column': [['WHEN \'stock.session\' THEN EXISTS(SELECT 1 FROM stock_session_operations o JOIN stock_session_members m ON m.operation_id=o.id WHERE o.history_id=h.id AND m.branch_id=@source)',
        'WHEN \'stock.session\' THEN EXISTS(SELECT 1 FROM stock_session_operations o JOIN stock_session_members m ON m.operation_id=o.id WHERE o.history_id=h.id AND m.product_id=@source)']],
      'facts path typo': [["`SELECT CAST(json_extract(${asJson('o.' + column)},'$.branchId') AS INTEGER) AS b", "`SELECT CAST(json_extract(${asJson('o.' + column)},'$.branch_id') AS INTEGER) AS b"]],
    }
    for (const [name, mutations] of Object.entries(mutants)) {
      assert.throws(() => pageOf(load('lib/branchCutoverHistory.ts', mutations)), /history_facts_disagree/, name)
    }
  })

  console.log(`${checks} branch cutover history pure checks passed`)
}
module.exports = { seedHistoryFamilies }
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
