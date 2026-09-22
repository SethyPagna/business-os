// Records/history lane, phase 2: GET /api/returns/:id/records.
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... like sales do before and after, by who etc..."
//
// A return's changes were recorded in three different places and NONE of them
// was readable from the return: the edit's before/after (phase 1) in
// audit_logs, the linked sale's status move in sale_record_events under a
// RECEIPT id, and the grouped cancel/restore in the return_bulk_* receipt.
// This file runs the REAL reads (lib/returnRecords.ts's loadReturnRecords, the
// exact SQL the route calls) against a real, fully migrated in-memory D1 and
// pins that all three arrive as one ordered list with who / when /
// before -> after.
//
// routes/returns.ts itself is ~3,000 lines and overflows the TypeScript
// transpiler's stack when loaded into a pure test, which is why the reads live
// in the lib and the route is six lines; a source-shape check at the end pins
// that the route still delegates to them and stays behind the returns read
// gate.
//
// The control that makes the rest meaningful: an edit that changed nothing
// writes an audit row with both value columns NULL (lib/audit.ts's contract),
// and that row must produce a record with NO field diff -- not an invented
// "everything was added" table, which is what a renderer fed the details blob
// would print.
//
// RED before the fix: lib/returnRecords.ts does not exist and routes/returns.ts
// has no /:id/records route at all.
//
// Run: node scripts/test-return-records-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const moduleCache = new Map()
function loadReal(sourcePath, requireOverrides = {}) {
  const outputText = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    if (request.startsWith('.')) {
      const resolved = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(resolved)) {
        if (!moduleCache.has(resolved)) {
          Module._load = originalLoad
          try { moduleCache.set(resolved, loadReal(resolved, requireOverrides)) } finally { Module._load = patchedLoad }
        }
        return moduleCache.get(resolved)
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const workerSrc = (rel) => path.join(cloudflareRoot, 'src', rel)

// A sale_record_events id must be a lowercase v4 UUID (migration 0140's CHECK).
const EVENT_ID = '11111111-2222-4333-8444-555555555555'
const RECEIPT_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa'
const OPERATION_ID = 'op-return-bulk-1'

function seed(db) {
  db.exec(`
    INSERT INTO branches (id, name, is_active) VALUES (3, 'Main shop', 1);
    INSERT INTO users (id, username, password, name, is_active) VALUES (4, 'za', 'x', 'Za Sethy', 1);
    INSERT INTO sales (id, receipt_number, branch_id, branch_name, sale_status, total_usd, created_at)
      VALUES (70, '20260920-101500', 3, 'Main shop', 'returned', 25, '2026-09-20 10:15:00');
    INSERT INTO returns (id, return_number, sale_id, receipt_number, branch_id, branch_name, reason, status, total_refund_usd, created_at, updated_at)
      VALUES (12, 'RET-20260920-0003', 70, '20260920-101500', 3, 'Main shop', 'Damaged item', 'completed', 25, '2026-09-20 10:20:00', '2026-09-20 11:00:00');

    -- 1. the creation row: keyed by its RECEIPT id, naming the return only in record_id
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, table_name, record_id, details, new_value, created_at)
      VALUES (1, 4, 'za', 'create', 'return_create', 'receipt-abc', 'returns', 12,
        '{"return_number":"RET-20260920-0003","return_items":2}',
        '{"return_number":"RET-20260920-0003","return_items":2}', '2026-09-20 10:20:00');

    -- 2. an edit that really changed two columns (phase 1's changedFields shape)
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, table_name, record_id, details, old_value, new_value, created_at)
      VALUES (2, 4, 'za', 'update', 'return', '12', 'returns', 12,
        '{"reason":"Customer brought the receipt"}',
        '{"reason":"Damaged item","total_refund_usd":25}',
        '{"reason":"Wrong size","total_refund_usd":18}', '2026-09-20 11:00:00');

    -- 3. the CONTROL: an edit that changed nothing -- both value columns NULL
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, table_name, record_id, details, old_value, new_value, created_at)
      VALUES (3, 4, 'za', 'update', 'return', '12', 'returns', 12, '{}', NULL, NULL, '2026-09-20 11:05:00');

    -- 4. an audit row for a DIFFERENT return, which must never appear here
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, new_value, created_at)
      VALUES (4, 4, 'za', 'update', 'return', '99', 'returns', 99, '{"status":"completed"}', '{"status":"cancelled"}', '2026-09-20 11:06:00');

    -- 5. the linked sale's status move, reachable only through the edit receipt
    INSERT INTO return_mutation_receipts (id, actor_id, return_id, sale_id, mutation_kind, request_id, request_digest, request_json, response_json, occurred_at)
      VALUES ('${RECEIPT_ID}', 4, 12, 70, 'edit', 'req-1',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '{"reason":"Wrong size"}', '{"id":12}', '2026-09-20 11:00:00');
    INSERT INTO sale_record_events (id, sale_id, source_kind, source_id, generation, kind, via, subject, actor_id, actor_username, occurred_at, changes_json)
      VALUES ('${EVENT_ID}', 70, 'return_edit', '${RECEIPT_ID}', 0, 'status_changed', 'apply', 'RET-20260920-0003', 4, 'za', '2026-09-20 11:00:00',
        '[{"field":"sale_status","before":{"state":"known_value","value":"completed"},"after":{"state":"known_value","value":"returned"}}]');

    -- 6. a grouped status change whose receipt carries THIS return's own pair
    INSERT INTO action_history (id, scope, entity, entity_id, label, reversible, status, created_by_id, created_by_name, created_at)
      VALUES (31, 'returns', 'return', '${OPERATION_ID}', '2 returns: status completed -> cancelled', 1, 'undoable', 4, 'za', '2026-09-21 09:00:00');
    INSERT INTO return_bulk_operations (id, actor_id, request_id, request_json, history_id, generation, receipt_json)
      VALUES ('${OPERATION_ID}', 4, 'req-bulk-1', '{"field":"status","source":"completed","target":"cancelled"}', 31, 0,
        '{"operationId":"${OPERATION_ID}","items":[{"id":12,"return_number":"RET-20260920-0003","before":"completed","after":"cancelled","changed":true},{"id":99,"return_number":"RET-20260920-0009","before":"completed","after":"cancelled","changed":true}]}');
    INSERT INTO return_bulk_members (operation_id, return_id, revision, sale_id, sale_revision, stock_fingerprint)
      VALUES ('${OPERATION_ID}', 12, 0, 70, 0, 'fp');
    INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, table_name, record_id, details, created_at)
      VALUES (5, 4, 'za', 'action_undo', 'return', '${OPERATION_ID}', 'returns', '${OPERATION_ID}',
        '{"kind":"return.fields.bulk"}', '2026-09-21 09:30:00');
  `)
}

async function main() {
  const db = openDb(MIGRATION_SQLS)
  seed(db)
  const { loadReturnRecords } = loadReal(workerSrc('lib/returnRecords.ts'))

  const body = await loadReturnRecords(db, 12)
  assert.ok(body, 'the return exists, so its records must load')
  const records = body.records || []
  const byId = (prefix) => records.filter((record) => record.id.startsWith(prefix))

  check('the route answers one ordered list for this return only', () => {
    assert.equal(body.returnId, 12)
    assert.equal(body.returnNumber, 'RET-20260920-0003')
    assert.ok(records.length >= 5, `expected every source to contribute, got ${JSON.stringify(records.map((r) => r.kind))}`)
    assert.ok(!records.some((record) => record.id === 'audit:4'), 'another return\'s audit row must never appear here')
    const stamps = records.map((record) => record.at_ms).filter((value) => value !== null)
    assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b), 'records read oldest first')
  })

  check('the creation row is found through record_id, not entity_id', () => {
    const created = records.find((record) => record.kind === 'return_created')
    assert.ok(created, 'the return_create row must be part of the return\'s own history')
    assert.equal(created.actor_username, 'za')
    assert.equal(created.at, '2026-09-20 10:20:00')
    assert.equal(created.subject, 'RET-20260920-0003')
  })

  check('an edit shows exactly the fields that moved, before -> after', () => {
    const edit = records.find((record) => record.id === 'audit:2')
    assert.ok(edit)
    assert.equal(edit.kind, 'return_updated')
    assert.equal(edit.actor_username, 'za')
    const fields = Object.fromEntries(edit.changes.map((change) => [change.field, change]))
    assert.deepEqual(fields.reason.before, { state: 'known_value', value: 'Damaged item' })
    assert.deepEqual(fields.reason.after, { state: 'known_value', value: 'Wrong size' })
    assert.deepEqual(fields.total_refund_usd.before, { state: 'known_value', value: 25 })
    assert.deepEqual(fields.total_refund_usd.after, { state: 'known_value', value: 18 })
  })

  check('CONTROL: an edit that changed nothing produces no diff', () => {
    const unchanged = records.find((record) => record.id === 'audit:3')
    assert.ok(unchanged, 'the row still says WHO saved and WHEN')
    assert.deepEqual(unchanged.changes, [], 'but it must not invent a field table out of the details blob')
  })

  check('the linked sale status move is its own record, with the sale branch', () => {
    const event = byId('sale_event:')[0]
    assert.ok(event, 'the sale_record_events row must be reachable through the edit receipt')
    assert.equal(event.kind, 'sale_status_changed')
    assert.equal(event.subject, '20260920-101500', 'the row names the SALE it moved')
    assert.equal(event.branch_name, 'Main shop', 'the branch is shown where the row genuinely carries one')
    assert.deepEqual(event.changes, [{
      field: 'sale_status',
      before: { state: 'known_value', value: 'completed' },
      after: { state: 'known_value', value: 'returned' },
    }])
  })

  check('a grouped action shows THIS return\'s pair, not the batch summary', () => {
    const bulk = byId('bulk:')[0]
    assert.ok(bulk)
    assert.equal(bulk.kind, 'return_bulk_change')
    assert.equal(bulk.actor_username, 'za')
    assert.equal(bulk.at, '2026-09-21 09:00:00')
    assert.deepEqual(bulk.changes, [{
      field: 'status',
      before: { state: 'known_value', value: 'completed' },
      after: { state: 'known_value', value: 'cancelled' },
    }])
    assert.ok(!JSON.stringify(bulk).includes('RET-20260920-0009'), 'another member of the batch must not leak in')
  })

  check('the grouped undo is attributed to whoever replayed it', () => {
    const replay = records.find((record) => record.kind === 'return_replayed')
    assert.ok(replay, 'a grouped undo is keyed by the OPERATION id and needs the membership join')
    assert.equal(replay.via, 'undo')
    assert.equal(replay.actor_username, 'za')
  })

  const missing = await loadReturnRecords(db, 999)
  check('an unknown return answers "not found", never an empty trail', () => {
    assert.equal(missing, null, 'a 200 with zero records would read as "nobody ever touched this return"')
  })

  // The browser renders these records through the same field-row builder the
  // sales float uses, so the value states must be the shape it accepts.
  check('every change carries the closed value-state shape the float renders', () => {
    for (const record of records) {
      for (const change of record.changes) {
        for (const side of [change.before, change.after]) {
          assert.ok(['known_value', 'known_none', 'unknown'].includes(side.state), JSON.stringify(side))
        }
      }
    }
  })

  check('the route delegates to these reads and stays behind the returns read gate', () => {
    const source = fs.readFileSync(workerSrc('routes/returns.ts'), 'utf8')
    assert.match(source, /app\.get\('\/:id\/records', async \(c\) => \{[\s\S]{0,400}?loadReturnRecords\(getDb\(c\.env\), returnId\)/,
      'GET /:id/records must call loadReturnRecords -- a second copy of these queries in the route would be untestable')
    assert.match(source, /getActionTier\(user, 'returns', 'view'\) === 'none'/,
      "the router's GET gate is what read-protects this route; it must still be there")
    const routeBody = source.slice(source.indexOf("app.get('/:id/records'"), source.indexOf("app.post('/quote'"))
    assert.ok(!/FROM sale_record_events/.test(routeBody), 'the records route must hold no SQL of its own')
  })

  console.log('\nOK ' + passed + ' checks')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
