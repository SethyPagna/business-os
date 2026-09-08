const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationPath = path.join(__dirname, '../migrations/0140_sale_record_events.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
assert(!migration.includes('\r'), '0140 trigger SQL must remain LF-only')

const db = new Database(':memory:')
for (const sql of loadAll()) db.exec(sql)
db.pragma('foreign_keys = ON')
db.prepare("INSERT INTO sales(id,receipt_number) VALUES(1,'S-1'),(2,'S-2')").run()

const change = JSON.stringify([{
  field: 'sale_status',
  before: { state: 'known_value', value: 'completed' },
  after: { state: 'known_value', value: 'returned' },
}])
const insert = db.prepare(`INSERT INTO sale_record_events(
  id,sale_id,source_kind,source_id,generation,kind,via,actor_id,actor_username,occurred_at,changes_json,request_digest,response_json
) VALUES(@id,@sale_id,@source_kind,@source_id,@generation,@kind,@via,1,'admin','2026-09-08T00:00:00.000Z',@changes_json,@request_digest,@response_json)`)
const valid = (overrides = {}) => ({
  id: crypto.randomUUID(), sale_id: 1, source_kind: 'sale_status',
  source_id: `actor:1:request:${crypto.randomUUID()}`, generation: 0,
  kind: 'status_changed', via: 'apply', changes_json: change,
  request_digest: 'a'.repeat(64), response_json: '{"success":true}',
  ...overrides,
})

insert.run(valid())
assert.equal(db.prepare('SELECT COUNT(*) n FROM sale_record_events').get().n, 1)
for (const [label, overrides] of [
  ['id', { id: 'not-a-uuid' }],
  ['source', { source_kind: 'other' }],
  ['kind', { kind: 'legacy_sale_change' }],
  ['via', { via: 'amend' }],
  ['generation', { generation: 1.5 }],
  ['json', { changes_json: '{bad' }],
  ['empty changes', { changes_json: '[]' }],
  ['too many changes', { changes_json: JSON.stringify(Array.from({ length: 13 }, () => JSON.parse(change)[0])) }],
  ['digest', { request_digest: 'G'.repeat(64) }],
  ['response shape', { response_json: '[]' }],
  ['source kind pair', { kind: 'item_added' }],
  ['direct replay generation', { generation: 1, via: 'undo' }],
]) assert.throws(() => insert.run(valid(overrides)), /constraint|malformed JSON/i, label)

insert.run(valid({ source_kind: 'sale_settlement', source_id: crypto.randomUUID(), kind: 'payment_settled', generation: 1, via: 'undo' }))
assert.throws(() => insert.run(valid({ source_kind: 'sale_settlement', source_id: crypto.randomUUID(), kind: 'payment_settled', generation: 2, via: 'undo' })), /constraint/i)

const oversized = JSON.stringify([{ field: 'sale_status', before: { state: 'known_value', value: 'ក'.repeat(22000) }, after: { state: 'known_none' } }])
assert(Buffer.byteLength(oversized, 'utf8') > 65536 && oversized.length < 65536, 'fixture distinguishes UTF-8 bytes from JS characters')
assert.throws(() => insert.run(valid({ changes_json: oversized })), /constraint/i)

const shared = `actor:1:request:${crypto.randomUUID()}`
insert.run(valid({ source_id: shared }))
assert.throws(() => insert.run(valid({ source_id: shared, sale_id: 2, kind: 'cancelled' })), /unique/i, 'direct request cannot target a second sale')
const bulkSource = crypto.randomUUID()
insert.run(valid({ source_kind: 'sale_bulk_status', source_id: bulkSource }))
insert.run(valid({ source_kind: 'sale_bulk_status', source_id: bulkSource, sale_id: 2 }))
assert.throws(() => insert.run(valid({ source_kind: 'sale_bulk_status', source_id: bulkSource, kind: 'cancelled' })), /unique/i, 'kind cannot duplicate one source generation and sale')

const immutableId = valid()
insert.run(immutableId)
assert.throws(() => db.prepare('UPDATE sale_record_events SET subject=? WHERE id=?').run('rewrite', immutableId.id), /immutable/i)
assert.throws(() => db.prepare('DELETE FROM sale_record_events WHERE id=?').run(immutableId.id), /immutable/i)
db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{" + '"mode":"backup"' + "}') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
assert.throws(() => db.prepare('DELETE FROM sale_record_events WHERE id=?').run(immutableId.id), /immutable/i)
db.prepare("UPDATE system_flags SET value='{" + '"mode":"restore"' + "}' WHERE key='maintenance'").run()
db.prepare('DELETE FROM sale_record_events WHERE id=?').run(immutableId.id)

const resetId = valid()
insert.run(resetId)
db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
db.prepare("INSERT INTO system_flags(key,value) VALUES('sale_record_events_reset_guard','{" + '"mode":"reset","token":""' + "}')").run()
assert.throws(() => db.prepare('DELETE FROM sale_record_events WHERE id=?').run(resetId.id), /immutable/i)
db.prepare("UPDATE system_flags SET value='{" + '"mode":"reset","token":"test-reset"' + "}' WHERE key='sale_record_events_reset_guard'").run()
db.prepare('DELETE FROM sale_record_events WHERE id=?').run(resetId.id)

const fkId = valid()
insert.run(fkId)
assert.throws(() => db.prepare('DELETE FROM sales WHERE id=1').run(), /foreign key/i)

const backupSource = fs.readFileSync(path.join(__dirname, '../src/lib/backup.ts'), 'utf8')
const coreSource = fs.readFileSync(path.join(__dirname, '../src/lib/coreDataInvariants.ts'), 'utf8')
const systemSource = fs.readFileSync(path.join(__dirname, '../src/routes/system.ts'), 'utf8')
assert.match(backupSource, /BACKUP_TABLES = \[[\s\S]*?'sales'[\s\S]*?'sale_record_events'/)
assert.match(backupSource, /SALE_REPLAY_RESTORE_BUNDLE = \[[\s\S]*?'sale_record_events'/)
assert.match(backupSource, /createSectionBackup[\s\S]*?BACKUP_TABLES\.filter/)
assert.match(coreSource, /FACTORY_RESET_TABLES = \[[\s\S]*?'sale_record_events'[\s\S]*?'sales'/)
assert.match(systemSource, /tablesToClear\.unshift\('sale_record_events'\)/)
assert.match(systemSource, /const statements:[\s\S]*?'DELETE FROM sale_record_events'[\s\S]*?'DELETE FROM sales'/)
assert.match(systemSource, /guardSaleRecordReset\(FACTORY_RESET_TABLES/)

db.close()
console.log('PASS 0140 schema, byte bounds, identity, immutability, restore/reset guards, FK order, and lifecycle coverage')
