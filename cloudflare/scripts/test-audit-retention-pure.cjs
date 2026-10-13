// Audit retention must preserve the only actor/time evidence for Return bulk
// undo/redo while continuing to delete every unrelated old audit row. Both the
// scheduled path and the legacy/manual clear route use the same SQL builder.
//
// Run (from cloudflare/): node scripts/test-audit-retention-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert/strict')
const Database = require('better-sqlite3')

const auditPath = path.join(__dirname, '..', 'src', 'lib', 'audit.ts')
const auditSource = fs.readFileSync(auditPath, 'utf8')
const output = ts.transpileModule(auditSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
let storedRetention = null
const policyOutput = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'auditRetentionPolicy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const policyModule = { exports: {} }
new Function('exports', 'module', policyOutput)(policyModule.exports, policyModule)
const localRequire = (request) => {
  if (request === './db') return { getDb: () => ({ prepare: () => ({ get: async () => (storedRetention === null ? null : { value: storedRetention }) }) }) }
  if (request === './actorSnapshot') return { ACTOR_USERNAME_SQL: '', resolveActorUsername: () => null }
  return require(request)
}
new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
const { buildAuditLogRetentionDeleteSql } = moduleObj.exports

assert.equal(typeof buildAuditLogRetentionDeleteSql, 'function')
const sql = buildAuditLogRetentionDeleteSql()

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    action TEXT,
    entity TEXT,
    details TEXT,
    entity_id TEXT,
    user_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT
  );
`)
const insert = sqlite.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)')
const old = '2026-01-01 00:00:00'
insert.run(1, 'update', 'sale', '{}', old)
insert.run(2, 'action_undo', 'return', '{"kind":"something.else"}', old)
insert.run(3, 'return_fields_bulk', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(4, 'action_undo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(5, 'action_redo', 'return', '{"kind":"return.fields.bulk"}', old)
insert.run(6, 'action_redo', 'product', '{"kind":"return.fields.bulk"}', old)
insert.run(7, 'update', 'sale', '{}', '2026-09-07 00:00:00')
const requestId = 'shift_request_123456'
const request = { id: requestId, target: 17, canonical: JSON.stringify({ client_request_id: requestId, expected_revision: 2 }) }
for (const [offset, action] of ['shift.close', 'shift.reopen', 'shift.amend', 'shift.cancel'].entries()) {
  insert.run(8 + offset, action, 'shift_session', JSON.stringify({ request }), old)
}
// The route accepts numeric-string revisions too. Retention recognizes its
// receipt envelope, not a stricter reimplementation of request validation.
insert.run(99, 'shift.close', 'shift_session', JSON.stringify({ request: { ...request,
  canonical: JSON.stringify({ client_request_id: requestId, expected_revision: '2' }),
} }), old)
const ordinaryShiftRows = [
  ['shift.close', 'shift_session', '{}'],
  ['shift.open', 'shift_session', JSON.stringify({ request })],
  ['shift.open_after_cancel', 'shift_session', JSON.stringify({ request })],
  ['shift.close', 'sale', JSON.stringify({ request })],
  ['shift.close', 'shift_session', '{broken'],
  ['shift.close', 'shift_session', null],
  ...[
    { ...request, id: 'short' },
    { ...request, id: 'invalid request id' },
    { ...request, target: null },
    { ...request, target: 0 },
    { ...request, canonical: null },
    { ...request, canonical: '{broken' },
    { ...request, canonical: '{}' },
    { ...request, canonical: JSON.stringify({ client_request_id: 'different_request_id', expected_revision: 2 }) },
    { ...request, canonical: JSON.stringify({ client_request_id: null }) },
  ].map(request => ['shift.close', 'shift_session', JSON.stringify({ request })]),
]
for (const [offset, row] of ordinaryShiftRows.entries()) insert.run(12 + offset, ...row, old)

const priceReceipt = { kind: 'product.bulk-price-adjust', version: 1, client_request_id: 'price_adjust_aged001',
  claim_nonce: '11111111-1111-1111-1111-111111111111', rowsTouched: 2,
  request: JSON.stringify({ direction: 'increase', amount: 1, fields: ['selling_price_usd'], skip_zero: false }) }
const insertPrice = (id, details, overrides = {}) => sqlite.prepare(`INSERT INTO audit_logs
  (id,action,entity,entity_id,user_id,details,old_value,new_value,created_at) VALUES(@id,@action,@entity,@entityId,@actor,@details,@before,@after,@created)`)
  .run({id,action:'update',entity:'product',entityId:'bulk-price-adjust',actor:21,details:JSON.stringify(details),before:'{"rows_touched":0}',after:'{"rows_touched":2}',created:old,...overrides})
insertPrice(100,priceReceipt)
const malformedPrices = [
  { ...priceReceipt, kind: 'other' }, { ...priceReceipt, version: 2 }, { ...priceReceipt, client_request_id: 'short' },
  { ...priceReceipt, client_request_id: 'bad id x' }, { ...priceReceipt, claim_nonce: 'short' },
  { ...priceReceipt, rowsTouched: null }, { ...priceReceipt, rowsTouched: -1 }, { ...priceReceipt, rowsTouched: 1.5 },
  { ...priceReceipt, request: '{broken' }, { ...priceReceipt, request: '{}' },
  ...[{direction:'sideways'},{amount:0},{amount:'1'},{fields:[]},{fields:['unsafe_field']},{fields:[1]},{skip_zero:1}]
    .map(change=>({...priceReceipt,request:JSON.stringify({direction:'increase',amount:1,fields:['selling_price_usd'],skip_zero:false,...change})})),
]
for (const [offset,details] of malformedPrices.entries()) insertPrice(101+offset,details)
const unrelatedPrices = [{entity:'sale'},{entityId:'another'},{action:'create'},{actor:0},{after:'{"rows_touched":3}'},{after:null},{before:'{broken'}]
for (const [offset,overrides] of unrelatedPrices.entries()) insertPrice(200+offset,priceReceipt,overrides)

const result = sqlite.prepare(sql).run({ cutoff: '2026-09-01 00:00:00' })
assert.equal(result.changes, 4 + ordinaryShiftRows.length + malformedPrices.length + unrelatedPrices.length, 'ordinary, legacy, malformed and unrelated operational audits still expire')
assert.deepEqual(
  sqlite.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((row) => row.id),
  [4, 5, 7, 8, 9, 10, 11, 99, 100],
  'only Return replay, exact Shift receipts and validated completed price receipts bypass age retention',
)
for (const id of [8, 9, 10, 11]) {
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT details FROM audit_logs WHERE id=?').get(id).details).request, request,
    'retention preserves byte-equivalent request identity for later exact replay')
}
sqlite.close()

const compatSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
assert.match(auditSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'scheduled retention must use the shared narrow deletion SQL')
assert.match(compatSource, /import \{ audit, buildAuditLogRetentionDeleteSql \} from '\.\.\/lib\/audit'/,
  'manual retention must import the same policy')
assert.match(compatSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'manual retention must use the same narrow deletion SQL')
assert.doesNotMatch(compatSource, /DELETE FROM audit_logs WHERE id IN \(SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000\)/,
  'manual retention must not retain its old blanket deletion path')

// ---------------------------------------------------------------------------------------------------------------
// K11, owner ruling 13 Oct (relayed): "keep old expenses ... for the revert, yes, as it is same with stock changes ...
// for undo redo history no need." Expense evidence and revert records never age out; Undo/Redo history still does.
// The same fixture is run against the shipped SQL and against three wrong policies (sweep off, no K11 exemptions,
// keep every expense row including its undo history); each wrong policy must give a different answer.
// ---------------------------------------------------------------------------------------------------------------
{
  const { AUDIT_RETENTION_KEPT_REVERT_ACTIONS, AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES } = moduleObj.exports
  assert.deepEqual([...AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES], ['fee', 'fee_label'])
  const rows = [
    // [id, action, entity, details, keep]
    [1, 'create', 'fee', '{"after":{"amount_usd":5}}', true],
    [2, 'update', 'fee', '{"before":{},"after":{}}', true],
    [3, 'delete', 'fee', '{"before":{},"after":null}', true],
    [4, 'delete', 'fee', null, true],                        // the pre-fix approved delete wrote details = NULL
    [5, 'replace', 'fee_label', '{"from":"a","to":"b"}', true],
    [6, 'classify', 'fee_label', '{"label":"Grab"}', true],
    [7, 'approve', 'pending_action', '{"section":"fees","action_type":"delete"}', true],
    [8, 'reject', 'pending_action', '{"section":"fees","action_type":"delete"}', true],
    [9, 'stock_revert', 'product', '{"movementId":1}', true],
    [10, 'stock_revert_repair', 'product', '{}', true],
    [11, 'stock_revert_repair_before', 'product', '{}', true],
    [12, 'action_undo', 'fee', '{"actionHistoryId":1}', false],  // Undo/Redo history: "no need"
    [13, 'action_redo', 'fee', '{"actionHistoryId":1}', false],
    [14, 'action_undo', 'product', '{"actionHistoryId":2}', false],
    [15, 'approve', 'pending_action', '{"section":"products"}', false],
    [16, 'reject', 'pending_action', '{broken', false],
    [17, 'update', 'settings', '{}', false],
    [18, null, null, null, false],                           // NULL entity/action must not be kept by accident
    [19, 'adjust', 'product', '{"note":"stock_revert"}', false],
  ]
  const recent = [[100, 'update', 'settings', '{}'], [101, 'action_undo', 'fee', '{}']]
  const run = (deleteSql) => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, action TEXT, entity TEXT, details TEXT, entity_id TEXT, user_id INTEGER, old_value TEXT, new_value TEXT, created_at TEXT)')
    const ins = db.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)')
    for (const [id, action, entity, details] of rows) ins.run(id, action, entity, details, '2026-08-01 00:00:00')
    for (const [id, action, entity, details] of recent) ins.run(id, action, entity, details, '2026-09-30 00:00:00')
    db.prepare(deleteSql).run({ cutoff: '2026-09-01 00:00:00' })
    const left = db.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((row) => row.id)
    db.close()
    return left
  }
  const expected = [...rows.filter((row) => row[4]).map((row) => row[0]), ...recent.map((row) => row[0])]
  const shipped = buildAuditLogRetentionDeleteSql()
  assert.deepEqual(run(shipped), expected, 'K11: expense evidence and revert records survive; Undo/Redo history and ordinary rows age out')

  // Discrimination: the fixture tells the ruling apart from the plausible wrong policies.
  const k11 = /\n\s*AND NOT \(COALESCE\(entity, ''\) IN \('fee', 'fee_label'\)[\s\S]*?AND COALESCE\(action, ''\) NOT IN \('stock_revert', 'stock_revert_repair', 'stock_revert_repair_before'\)/
  assert.match(shipped, k11, 'the K11 predicate is where this test expects it')
  const wrong = {
    'sweep disabled (keeps everything)': shipped.replace('WHERE created_at < @cutoff', 'WHERE 0'),
    'no K11 exemptions (blanket 21-day sweep)': shipped.replace(k11, ''),
    'every expense row kept, its Undo/Redo history too': shipped.replace("AND COALESCE(action, '') NOT IN ('action_undo', 'action_redo'))", ')'),
  }
  for (const [name, sql] of Object.entries(wrong)) {
    assert.notEqual(sql, shipped, name + ': the mutation applied')
    assert.notDeepEqual(run(sql), expected, name + ' must not satisfy the ruling')
  }

  // Every revert action the source writes is on the kept list (a new 'stock_revert*' action cannot silently age out).
  const srcRoot = path.join(__dirname, '..', 'src')
  const written = new Set()
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.ts')) for (const m of fs.readFileSync(full, 'utf8').matchAll(/'(stock_revert[a-z_]*)'/g)) written.add(m[1])
  } }
  walk(srcRoot)
  assert.ok(written.has('stock_revert'), 'the stock Revert route still writes stock_revert')
  for (const action of written) assert.ok(AUDIT_RETENTION_KEPT_REVERT_ACTIONS.includes(action), 'revert action ' + action + ' must be kept by retention')
  console.log('audit retention K11: expense evidence + revert records kept, Undo/Redo history pruned; 3 wrong policies rejected')
}

{
  const { getAuditLogRetentionDays } = moduleObj.exports
  ;(async () => {
    for (const [stored, expected] of [[null, 21], ['1', 21], ['20', 21], ['0', 21], ['-3', 21], ['abc', 21], ['21', 21], ['45', 45]]) {
      storedRetention = stored
      assert.equal(await getAuditLogRetentionDays({}), expected, `a stored ${JSON.stringify(stored)} must not shorten the window below 21 days`)
    }
    const { parseAuditRetentionDays, AUDIT_LOG_RETENTION_FLOOR_DAYS } = policyModule.exports
    assert.equal(moduleObj.exports.DEFAULT_AUDIT_LOG_RETENTION_DAYS, AUDIT_LOG_RETENTION_FLOOR_DAYS, 'the purge default and the floor the routes enforce are one number')
    for (const [input, expected] of [[21, 21], ['3650', 3650], [' 30 ', 30], [20, null], [3651, null], [21.5, null], ['21.5', null], ['', null], [null, null], [[30], null], ['1e2', null]]) {
      assert.equal(parseAuditRetentionDays(input), expected, `parse ${JSON.stringify(input)}`)
    }
    console.log('audit retention floor: a stored value under 21 days never shortens the window; whole days from 21 to 3650 only')
  })().catch((error) => { console.error(error); process.exit(1) })
}

console.log('audit retention: Return bulk provenance and exact Shift lifecycle receipts preserved narrowly')
