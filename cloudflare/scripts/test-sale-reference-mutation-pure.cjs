const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function loadTs(file, overrides = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    return require(request)
  }, moduleObj)
  return moduleObj.exports
}

const migrationsDir = path.join(__dirname, '../migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
const migration143 = fs.readFileSync(path.join(migrationsDir, '0143_sale_reference_mutation_receipts.sql'), 'utf8')
assert.equal(migration143.includes('\r'), false, 'append-only trigger migration must remain LF-only')

const db = new Database(':memory:')
for (const name of migrationFiles.filter((name) => name < '0143_')) {
  db.exec(fs.readFileSync(path.join(migrationsDir, name), 'utf8'))
}
db.prepare("INSERT INTO sales(id,receipt_number) VALUES(1,'S-1')").run()
const oldEventId = '00000000-0000-4000-8000-000000000001'
db.prepare(`INSERT INTO sale_record_events(
  id,sale_id,source_kind,source_id,generation,kind,via,occurred_at,changes_json
) VALUES(?,1,'sale_status','actor:1:request:old',0,'status_changed','apply','2026-09-09T00:00:00.000Z',?)`).run(
  oldEventId,
  JSON.stringify([{ field: 'sale_status', before: { state: 'known_value', value: 'completed' }, after: { state: 'known_value', value: 'returned' } }]),
)
db.exec(migration143)
const preserved = db.prepare('SELECT id,metadata_json,changes_json FROM sale_record_events WHERE id=?').get(oldEventId)
assert.equal(preserved.id, oldEventId)
assert.equal(preserved.metadata_json, null)
assert.equal(JSON.parse(preserved.changes_json)[0].after.value, 'returned')

const helper = loadTs(path.join(__dirname, '../src/lib/saleReferenceMutation.ts'), {
  './db': {},
  './saleRecordEvents': {
    sha256Hex: async (value) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
  },
})

const digestA = 'a'.repeat(64)
const receiptId = '00000000-0000-4000-8000-000000000002'
const occurredAt = '2026-09-09T01:02:03.004Z'
const responses = {
  customer_profile_carry: { success: true, receipt_id: receiptId, target_id: 7, affected_sales: 2, affected_returns: 1, updated_at: occurredAt },
  delivery_contact_carry: { success: true, receipt_id: receiptId, target_id: 7, affected_sales: 2, updated_at: occurredAt },
  customer_merge: { success: true, receipt_id: receiptId, keep_id: 7, merge_id: 8, affected_sales: 2, updated_at: occurredAt },
  delivery_contact_merge: { success: true, receipt_id: receiptId, keep_id: 7, merge_id: 8, affected_sales: 2, updated_at: occurredAt },
  customer_link_repair: { success: true, receipt_id: receiptId, target_id: 7, affected_sales: 2, updated_at: occurredAt },
  customer_missing_resolve: { success: true, receipt_id: receiptId, target_id: 7, created: false, affected_sales: 2, updated_at: occurredAt },
  payment_method_replace: { success: true, receipt_id: receiptId, affected_sales: 2, affected_payment_lines: 3, updated_at: occurredAt },
}
const targetInputs = {
  customer_profile_carry: { target_id: 7 },
  delivery_contact_carry: { target_id: 7 },
  customer_merge: { keep_id: 7, merge_id: 8 },
  delivery_contact_merge: { keep_id: 7, merge_id: 8 },
  customer_link_repair: { current_id: 7, phone_group_digest: digestA },
  customer_missing_resolve: { group_digest: digestA },
  payment_method_replace: { source_digest: digestA },
}

for (const kind of helper.SALE_REFERENCE_MUTATION_KINDS) {
  const targetKey = helper.saleReferenceTargetKey(kind, targetInputs[kind])
  const statement = helper.buildSaleReferenceReceiptInsert({
    id: receiptId,
    actorId: 1,
    mutationKind: kind,
    targetKey,
    requestId: `request-${kind}`,
    requestDigest: digestA,
    response: responses[kind],
    occurredAt,
  })
  db.prepare(statement.sql).run(statement.params)
  db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ mode: 'reset', token: 'test' }))
  db.prepare('DELETE FROM sale_reference_mutation_receipts WHERE id=?').run(receiptId)
  db.prepare("DELETE FROM system_flags WHERE key='sale_record_events_reset_guard'").run()
}

assert.throws(() => helper.requireSaleReferenceRequestId(' '.repeat(3)), /Refresh this page/)
assert.throws(() => helper.requireSaleReferenceRevision(''), /latest record/)
assert.equal(helper.canonicalSaleReferenceIntent({ z: 1, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":1}')
assert.throws(() => helper.buildSaleReferenceReceiptInsert({
  id: receiptId, actorId: 1, mutationKind: 'customer_profile_carry', targetKey: 'customer:07',
  requestId: 'r', requestDigest: digestA, occurredAt, response: responses.customer_profile_carry,
}), /target key/)
assert.throws(() => helper.buildSaleReferenceReceiptInsert({
  id: receiptId, actorId: 1, mutationKind: 'customer_profile_carry', targetKey: 'customer:7',
  requestId: 'r', requestDigest: digestA, occurredAt, response: { ...responses.customer_profile_carry, private_phone: '012' },
}), /unsupported shape/)

const rawReceiptSql = `INSERT INTO sale_reference_mutation_receipts(
  id,actor_id,mutation_kind,target_key,request_id,request_digest,response_json,occurred_at
) VALUES(@id,1,@kind,@target,@request,@digest,@response,@at)`
assert.throws(() => db.prepare(rawReceiptSql).run({
  id: receiptId, kind: 'payment_method_replace', target: `payment_method:${digestA}`, request: 'raw-extra', digest: digestA, at: occurredAt,
  response: JSON.stringify({ ...responses.payment_method_replace, source_label: 'Private label' }),
}), /CHECK constraint failed/)
assert.throws(() => db.prepare(rawReceiptSql).run({
  id: receiptId, kind: 'customer_link_repair', target: `customer_link:07:${digestA}`, request: 'raw-target', digest: digestA, at: occurredAt,
  response: JSON.stringify(responses.customer_link_repair),
}), /CHECK constraint failed/)
assert.throws(() => db.prepare(rawReceiptSql).run({
  id: receiptId, kind: 'customer_link_repair', target: `customer_link:7:${digestA}`, request: 'raw-time', digest: digestA, at: '2026-09-09T01:02:03Z',
  response: JSON.stringify({ ...responses.customer_link_repair, updated_at: '2026-09-09T01:02:03Z' }),
}), /CHECK constraint failed/)

const contactEventSql = `INSERT INTO sale_record_events(
  id,sale_id,source_kind,source_id,generation,kind,via,occurred_at,changes_json,metadata_json
) VALUES(@id,1,'contact_customer_carry',@source,0,@kind,'apply',@at,@changes,@metadata)`
db.prepare(contactEventSql).run({
  id: '00000000-0000-4000-8000-000000000003', source: receiptId, kind: 'customer_contact_changed', at: occurredAt,
  changes: '[]', metadata: JSON.stringify({ changed_contact_fields: ['address', 'phone'] }),
})
assert.throws(() => db.prepare(contactEventSql).run({
  id: '00000000-0000-4000-8000-000000000004', source: receiptId, kind: 'customer_contact_changed', at: occurredAt,
  changes: '[]', metadata: null,
}), /CHECK constraint failed/)
assert.throws(() => db.prepare(contactEventSql).run({
  id: '00000000-0000-4000-8000-000000000005', source: receiptId, kind: 'customer_contact_changed', at: occurredAt,
  changes: '[]', metadata: JSON.stringify({ changed_contact_fields: ['phone', 'phone'] }),
}), /CHECK constraint failed/)
assert.throws(() => db.prepare(contactEventSql).run({
  id: '00000000-0000-4000-8000-000000000006', source: receiptId, kind: 'customer_contact_changed', at: occurredAt,
  changes: '[]', metadata: JSON.stringify({ changed_contact_fields: ['phone'], private_value: '012' }),
}), /CHECK constraint failed/)

const ctesFor = (candidateCount, fullEvents, finalEventBytes = 0) => `WITH RECURSIVE
  mutationCandidates(n) AS (
    SELECT 1 WHERE ${candidateCount}>0
    UNION ALL SELECT n+1 FROM mutationCandidates WHERE n<${candidateCount}
  ),
  eventProjection(projected_event_json) AS (
    SELECT zeroblob(CASE WHEN n<=${fullEvents} THEN 65536 ELSE ${finalEventBytes} END)
    FROM mutationCandidates WHERE n<=${fullEvents + (finalEventBytes ? 1 : 0)}
  )`
const runGuard = (operationId, ctes) => {
  const statement = helper.saleReferenceGuardInsert(operationId, ctes, {})
  db.prepare(statement.sql).run(statement.params)
  db.prepare(helper.saleReferenceGuardDelete(operationId).sql).run(helper.saleReferenceGuardDelete(operationId).params)
}
runGuard('00000000-0000-4000-8000-000000000010', ctesFor(5000, 128))
assert.throws(() => runGuard('00000000-0000-4000-8000-000000000011', ctesFor(5001, 0)), /CHECK constraint failed/)
assert.throws(() => runGuard('00000000-0000-4000-8000-000000000012', ctesFor(129, 128, 1)), /CHECK constraint failed/)
assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_reference_mutation_guards').get().n, 0)

db.close()
console.log('PASS 0143 preservation, closed receipts/events, UTF-8 bounds and atomic 5000/5001/8MiB guards')
