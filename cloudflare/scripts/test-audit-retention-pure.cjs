// Audit retention: one shared SQL builder (the daily purge and the password-gated DELETE both use it).
// Owner, 14 Oct 2026: the audit rows of sales, payments (settle and refunds), returns, every stock change,
// permission/role/user changes and reverts, undo and redo are kept forever; every other row follows the retention
// setting, floor 21 days. The 13 Oct ruling that old expenses are kept still holds. The exact Shift lifecycle receipts
// and the validated completed bulk price-adjust receipts are kept too (they are replay receipts).
//
// Pins:
//   - the shipped SQL against every entity/action pair the Worker writes (scripts/harness/audit_retention_classes.cjs);
//   - DRIFT: the source writes no entity/action pair that table does not classify;
//   - discrimination: each plausible wrong policy gives a different answer on the same fixture;
//   - the stored-value floor and the policy parser.
//
// Run (from cloudflare/): node scripts/test-audit-retention-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert/strict')
const Database = require('better-sqlite3')
const { ROWS, DYNAMIC_ENTITIES, FAMILY_ACTION, RAW_SQL_WRITERS } = require('./harness/audit_retention_classes.cjs')

const srcRoot = path.join(__dirname, '..', 'src')
const auditSource = fs.readFileSync(path.join(srcRoot, 'lib', 'audit.ts'), 'utf8')
const output = ts.transpileModule(auditSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const moduleObj = { exports: {} }
let storedRetention = null
const policyOutput = ts.transpileModule(fs.readFileSync(path.join(srcRoot, 'lib', 'auditRetentionPolicy.ts'), 'utf8'), {
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
const shipped = buildAuditLogRetentionDeleteSql()

const SCHEMA = `CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, action TEXT, entity TEXT, table_name TEXT, details TEXT, entity_id TEXT,
  user_id INTEGER, old_value TEXT, new_value TEXT, created_at TEXT)`
const OLD = '2026-01-01 00:00:00'
const CUTOFF = '2026-09-01 00:00:00'

// ---- the narrow receipts: exact Shift lifecycle and validated completed price adjustments --------------------------
{
  const sqlite = new Database(':memory:')
  sqlite.exec(SCHEMA)
  const insert = sqlite.prepare('INSERT INTO audit_logs(id,action,entity,details,created_at) VALUES(?,?,?,?,?)')
  insert.run(1, 'update', 'settings', '{}', OLD)
  insert.run(2, 'update', 'settings', '{}', '2026-09-07 00:00:00')
  const requestId = 'shift_request_123456'
  const request = { id: requestId, target: 17, canonical: JSON.stringify({ client_request_id: requestId, expected_revision: 2 }) }
  for (const [offset, action] of ['shift.close', 'shift.reopen', 'shift.amend', 'shift.cancel'].entries()) {
    insert.run(8 + offset, action, 'shift_session', JSON.stringify({ request }), OLD)
  }
  // The route accepts numeric-string revisions too. Retention recognizes its receipt envelope, not a stricter
  // reimplementation of request validation.
  insert.run(99, 'shift.close', 'shift_session', JSON.stringify({ request: { ...request,
    canonical: JSON.stringify({ client_request_id: requestId, expected_revision: '2' }),
  } }), OLD)
  const ordinaryShiftRows = [
    ['shift.close', 'shift_session', '{}'],
    ['shift.open', 'shift_session', JSON.stringify({ request })],
    ['shift.open_after_cancel', 'shift_session', JSON.stringify({ request })],
    ['shift.close', 'settings', JSON.stringify({ request })],
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
  for (const [offset, row] of ordinaryShiftRows.entries()) insert.run(12 + offset, ...row, OLD)

  const priceReceipt = { kind: 'product.bulk-price-adjust', version: 1, client_request_id: 'price_adjust_aged001',
    claim_nonce: '11111111-1111-1111-1111-111111111111', rowsTouched: 2,
    request: JSON.stringify({ direction: 'increase', amount: 1, fields: ['selling_price_usd'], skip_zero: false }) }
  const insertPrice = (id, details, overrides = {}) => sqlite.prepare(`INSERT INTO audit_logs
    (id,action,entity,entity_id,user_id,details,old_value,new_value,created_at) VALUES(@id,@action,@entity,@entityId,@actor,@details,@before,@after,@created)`)
    .run({id,action:'update',entity:'product',entityId:'bulk-price-adjust',actor:21,details:JSON.stringify(details),before:'{"rows_touched":0}',after:'{"rows_touched":2}',created:OLD,...overrides})
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
  const unrelatedPrices = [{entity:'settings'},{entityId:'another'},{action:'delete'},{actor:0},{after:'{"rows_touched":3}'},{after:null},{before:'{broken'}]
  for (const [offset,overrides] of unrelatedPrices.entries()) insertPrice(200+offset,priceReceipt,overrides)

  const result = sqlite.prepare(shipped).run({ cutoff: CUTOFF })
  assert.equal(result.changes, 1 + ordinaryShiftRows.length + malformedPrices.length + unrelatedPrices.length,
    'ordinary, legacy, malformed and unrelated operational audits still expire')
  assert.deepEqual(
    sqlite.prepare('SELECT id FROM audit_logs ORDER BY id').all().map((row) => row.id),
    [2, 8, 9, 10, 11, 99, 100],
    'only exact Shift receipts and validated completed price receipts bypass age retention here',
  )
  for (const id of [8, 9, 10, 11]) {
    assert.deepEqual(JSON.parse(sqlite.prepare('SELECT details FROM audit_logs WHERE id=?').get(id).details).request, request,
      'retention preserves byte-equivalent request identity for later exact replay')
  }
  sqlite.close()
}

const compatSource = fs.readFileSync(path.join(srcRoot, 'routes', 'compat.ts'), 'utf8')
assert.match(auditSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'scheduled retention must use the shared deletion SQL')
assert.match(compatSource, /import \{ audit, buildAuditLogRetentionDeleteSql \} from '\.\.\/lib\/audit'/,
  'manual retention must import the same policy')
assert.match(compatSource, /prepare\(buildAuditLogRetentionDeleteSql\(\)\)/,
  'manual retention must use the same deletion SQL')
assert.doesNotMatch(compatSource, /DELETE FROM audit_logs WHERE id IN \(SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000\)/,
  'manual retention must not retain its old blanket deletion path')

// ---- owner 14 Oct: the kept-forever classes, against every pair the Worker writes ---------------------------------------
const runPolicy = (deleteSql, rows) => {
  const db = new Database(':memory:')
  db.exec(SCHEMA)
  const ins = db.prepare('INSERT INTO audit_logs(id,action,entity,table_name,details,created_at) VALUES(?,?,?,?,?,?)')
  rows.forEach((row, index) => {
    ins.run(index * 2 + 1, row.action, row.entity, row.table ?? row.entity, row.details ?? null, '2026-08-01 00:00:00')
    ins.run(index * 2 + 2, row.action, row.entity, row.table ?? row.entity, row.details ?? null, '2026-09-30 00:00:00')
  })
  db.prepare(deleteSql).run({ cutoff: CUTOFF })
  const left = new Set(db.prepare('SELECT id FROM audit_logs').all().map((row) => row.id))
  db.close()
  return rows.map((row, index) => ({ label: `${row.entity}/${row.action}${row.details ? ' ' + row.details : ''}`, old: left.has(index * 2 + 1), recent: left.has(index * 2 + 2), kept: row.kept }))
}
const wrongRows = (outcome) => outcome.filter((row) => !row.recent || row.old !== row.kept).map((row) => row.label)
{
  const rows = ROWS.map(([entity, action, kept, details]) => ({ entity, action, kept, details }))
  assert.ok(rows.length >= 150, `the table lists the writers (${rows.length} pairs)`)
  assert.ok(rows.filter((row) => row.kept).length >= 60 && rows.filter((row) => !row.kept).length >= 60, 'both classes are populated')
  assert.deepEqual(wrongRows(runPolicy(shipped, rows)), [], 'the shipped SQL keeps exactly the kept-forever pairs and deletes the other old rows')

  // Legacy rows and spelling variants.
  const special = [
    { entity: null, table: 'sales', action: 'update', kept: true },
    { entity: '', table: 'roles', action: 'update', kept: true },
    { entity: null, table: null, action: 'sale_settlement', kept: true },
    { entity: '', table: '', action: 'return', kept: true },
    { entity: null, table: null, action: 'stock_adjust', kept: true },
    { entity: null, table: null, action: 'login', kept: false },
    { entity: null, table: null, action: null, kept: false },
    { entity: ' SALE ', table: null, action: 'update', kept: true },
    { entity: 'brand', action: 'brand_rename_undo', kept: true },
    { entity: 'brand', action: 'brand_rename_redo', kept: true },
    { entity: 'brand', action: 'undo_nothing', kept: false },
    { entity: 'brand', action: 'redo', kept: false },
    { entity: 'pending_action', action: 'approve', details: '{"section":"fees"}', kept: true },
    { entity: 'pending_action', action: 'approve', details: '{"section":"products"}', kept: false },
    { entity: 'pending_action', action: 'reject', details: '{broken', kept: false },
    { entity: 'settings', action: 'adjust', details: '{"note":"stock_revert"}', kept: false },
    { entity: 'users', action: 'update', kept: true },
    { entity: 'user', action: 'login', kept: false },
  ]
  assert.deepEqual(wrongRows(runPolicy(shipped, special)), [], 'legacy rows, spelling variants, undo/redo suffixes and review decisions')

  // Discrimination: the same fixture tells the ruling apart from each plausible wrong policy.
  const clause = /\n\s*AND NOT \(LOWER\(TRIM\(COALESCE\(NULLIF\(TRIM\(entity\), ''\), table_name, ''\)\)\) IN [\s\S]*?\n(?=\s*AND NOT \(COALESCE\(entity, ''\) = 'pending_action')/
  assert.match(shipped, clause, 'the kept-forever predicate is where this test expects it')
  const mutate = (replacement) => shipped.replace(clause, replacement)
  const wrong = {
    'sweep disabled (keeps everything)': shipped.replace('WHERE created_at < @cutoff', 'WHERE 0'),
    'blanket sweep (no kept classes)': mutate('\n'),
    'only the 13 Oct expense/revert rule': mutate(`\n      AND NOT (COALESCE(entity, '') IN ('fee', 'fee_label') OR COALESCE(action, '') IN ('stock_revert', 'stock_revert_repair', 'stock_revert_repair_before'))\n`),
    'sales and returns only': mutate(`\n      AND NOT (COALESCE(entity, '') IN ('sale', 'sale_creation', 'return', 'return_create', 'fee', 'fee_label'))\n`),
    'every user row kept (sign-ins included)': mutate(`\n      AND NOT (${shipped.match(clause)[0].replace(/AND NOT \(/, '').replace(/\)\s*$/, '')} OR entity IN ('user', 'users'))\n`),
  }
  for (const [name, sql] of Object.entries(wrong)) {
    assert.notEqual(sql, shipped, `${name}: the mutation applied`)
    assert.notDeepEqual(wrongRows(runPolicy(sql, rows)), [], `${name} must not satisfy the ruling`)
  }
  console.log('audit retention 14 Oct: every kept-forever class survives, every other old row expires; 5 wrong policies rejected')
}

// ---- DRIFT: every entity/action pair the source writes is classified in the table ---------------------------------------
{
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (entry.name.endsWith('.ts')) out.push(full)
    }
    return out
  }
  const splitArgs = (source, start) => {
    let depth = 0
    let current = ''
    const args = []
    let quote = null
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i]
      if (quote) {
        current += ch
        if (ch === '\\') { current += source[i + 1]; i += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue }
      if ('([{'.includes(ch)) { depth += 1; current += ch; continue }
      if (')]}'.includes(ch)) {
        if (depth === 0) { args.push(current.trim()); return args }
        depth -= 1
        current += ch
        continue
      }
      if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue }
      current += ch
    }
    return args
  }
  const literal = (arg) => /^'([^']*)'$/.exec(arg || '')?.[1]
  const classified = new Set(ROWS.map(([entity, action]) => `${entity}/${action}`))
  const classifiedEntities = new Set(ROWS.map(([entity]) => entity))
  const found = new Map()
  const rawWriters = {}
  const files = walk(srcRoot)
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const rel = path.relative(srcRoot, file).replace(/\\/g, '/')
    const raw = (source.match(/INSERT INTO audit_logs/g) || []).length
    if (raw) rawWriters[rel] = raw
    for (const [pattern, actionAt, entityAt] of [[/\b(?:audit|auditOrThrow)\(/g, 3, 4], [/\bbuildAuditStatement\(/g, 2, 3]]) {
      let match
      while ((match = pattern.exec(source))) {
        const args = splitArgs(source, match.index + match[0].length)
        const action = literal(args[actionAt])
        const entity = literal(args[entityAt])
        if (action && entity) found.set(`${entity}/${action}`, rel)
        else if (entity && !action && args.length >= 5) found.set(`${entity}/<dynamic action>`, rel)
        else if (action && !entity && args.length >= 5 && !DYNAMIC_ENTITIES.length) found.set(`<dynamic entity>/${action}`, rel)
        else if (action && !entity && args.length >= 5) found.set(`<dynamic entity>/${action}`, rel)
      }
    }
    for (const m of source.matchAll(/key: \{ actorId: [^}]*?action: '([^']+)', entity: '([^']+)'/g)) found.set(`${m[2]}/${m[1]}`, rel)
  }
  assert.ok(found.size >= 80, `the scan found the audit call sites (${found.size} distinct pairs)`)
  const unclassified = []
  for (const [pair, rel] of found) {
    const [entity, action] = pair.split('/')
    if (entity === '<dynamic entity>') {
      assert.ok(classified.has(`customer/${action}`) || classified.has(`brand/${action}`) || [...DYNAMIC_ENTITIES].some((e) => classified.has(`${e}/${action}`)),
        `${rel}: ${pair} is written for a variable entity and no entity in DYNAMIC_ENTITIES classifies it`)
      continue
    }
    if (action === '<dynamic action>') {
      assert.ok(classifiedEntities.has(entity), `${rel}: entity ${entity} writes a variable action and the table does not mention the entity`)
      continue
    }
    if (!classified.has(pair) && !FAMILY_ACTION.test(action)) unclassified.push(`${pair} (${rel})`)
  }
  assert.deepEqual(unclassified, [], 'every entity/action pair the source writes is classified as kept or expiring in scripts/harness/audit_retention_classes.cjs')
  assert.deepEqual(rawWriters, RAW_SQL_WRITERS,
    'a raw INSERT INTO audit_logs appeared or moved: classify its entity/action pairs in the table, then update RAW_SQL_WRITERS')

  // Every undo/redo and revert action is kept by shape or by name.
  const { AUDIT_RETENTION_KEPT_REVERT_ACTIONS, AUDIT_RETENTION_KEPT_STOCK_ACTIONS, AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES } = moduleObj.exports
  assert.deepEqual([...AUDIT_RETENTION_KEPT_EXPENSE_ENTITIES], ['fee', 'fee_label'])
  const writtenActions = new Set()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const m of source.matchAll(/'(stock_revert[a-z_]*)'/g)) writtenActions.add(m[1])
  }
  assert.ok(writtenActions.has('stock_revert'), 'the stock Revert route still writes stock_revert')
  for (const action of writtenActions) assert.ok(AUDIT_RETENTION_KEPT_REVERT_ACTIONS.includes(action), `revert action ${action} must be kept by retention`)
  const cutoverActions = new Set()
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/export const (BRANCH_CUTOVER_[A-Z_]*AUDIT_ACTION|BRANCH_CUTOVER_[A-Z_]*FOLD_ACTION|STOCK_SESSION_CLOSED_AUDIT_ACTION)\s*=\s*'([^']+)'/g)) cutoverActions.add(m[2])
  }
  assert.ok(cutoverActions.size >= 6, `the branch-cutover audit actions were found (${cutoverActions.size})`)
  for (const action of cutoverActions) {
    assert.ok(AUDIT_RETENTION_KEPT_STOCK_ACTIONS.includes(action) || /_undo$|_redo$/.test(action) || ROWS.some(([entity, rowAction, kept]) => rowAction === action && kept),
      `branch cutover / stock session action ${action} is a stock change and must be kept`)
  }
  console.log(`audit retention drift: ${found.size} written pairs all classified; ${Object.keys(rawWriters).length} raw-SQL writer files unchanged`)
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

console.log('audit retention: kept-forever classes, exact Shift receipts and validated price receipts preserved narrowly')
