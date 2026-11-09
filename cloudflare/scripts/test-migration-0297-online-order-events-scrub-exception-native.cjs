'use strict'
// Pins migration 0297 (the one narrow exception to the append-only online order Records) on the REAL chain: the file is LF-only; PRE and POST are real (proven by
// mutating the file); a second apply aborts; no row changes; every ordinary UPDATE still aborts; ONLY "clear the two free-text columns of an event whose order is
// scrubbed, touching nothing else" gets through; DELETE is still refused.
//
// Run: node scripts/test-migration-0297-online-order-events-scrub-exception-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0297_online_order_events_scrub_exception.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
function check(name, run) { run(); passed += 1; console.log(`PASS ${name}`) }
const fresh = () => new Database(schema)
const abortName = (error) => (String(error.message).match(/online_order_events_scrub_exception_0297_[a-z]+/) || [''])[0]
const APPEND_ONLY = /online_order_events is append-only/

function seeded() {
  const db = fresh()
  db.exec(sql)
  db.exec("INSERT INTO branches (name, role, is_active, is_default) VALUES ('Shop','shop',1,1)")
  db.exec(`INSERT INTO online_orders (order_no, token_hash, state, fulfilment, branch_id, customer_name, customer_phone, currency, goods_total_usd, items_json, pricing_version, updated_at)
           VALUES ('LB-1', 'h1', 'expired', 'pickup', 1, 'Dara', '012345678', 'USD', 25, '[]', 1, '2026-08-01 00:00:00'),
                  ('LB-2', 'h2', 'expired', 'pickup', 1, 'Sok', '012999888', 'USD', 25, '[]', 1, '2026-08-01 00:00:00')`)
  db.exec(`INSERT INTO online_order_events (order_id, event, source, public_comment, internal_note, detail_json) VALUES
           (1, 'note', 'staff', 'call 012 345 678', 'lives at House 77', '{"a":1}'), (2, 'note', 'staff', 'call 012 999 888', 'second order', NULL)`)
  return db
}

check('the file is LF-only', () => assert.ok(!sql.includes('\r')))

check('applies on the real chain; one update trigger remains and it is the new one; no row changes', () => {
  const db = fresh()
  const before = db.prepare('SELECT COUNT(*) n FROM online_order_events').get().n
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM online_order_events').get().n, before)
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'online_order_events' AND name LIKE '%append_only_update'").all()
  assert.equal(triggers.length, 1); assert.match(triggers[0].sql, /scrubbed_at/)
})

check('a second apply aborts at the PRE bound; PRE and POST are real (mutated file)', () => {
  const db = fresh(); db.exec(sql)
  assert.throws(() => db.exec(sql), (error) => abortName(error) === 'online_order_events_scrub_exception_0297_pre')
  const noCreate = sql.replace(/CREATE TRIGGER online_order_events_append_only_update[\s\S]*?\nEND;\n/, '')
  assert.notEqual(noCreate, sql)
  assert.throws(() => fresh().exec(noCreate), (error) => abortName(error) === 'online_order_events_scrub_exception_0297_post')
})

check('ordinary updates still abort: any column, a comment set to new text, one column cleared but another changed, an UNSCRUBBED order, and delete', () => {
  const db = seeded()
  assert.throws(() => db.exec("UPDATE online_order_events SET event = 'created' WHERE id = 1"), APPEND_ONLY)
  assert.throws(() => db.exec("UPDATE online_order_events SET public_comment = 'rewritten' WHERE id = 1"), APPEND_ONLY)
  assert.throws(() => db.exec("UPDATE online_order_events SET public_comment = NULL, internal_note = NULL, detail_json = '{}' WHERE id = 1"), APPEND_ONLY)
  assert.throws(() => db.exec("UPDATE online_order_events SET public_comment = NULL, internal_note = NULL WHERE id = 1"), APPEND_ONLY, 'the order is not scrubbed yet')
  assert.throws(() => db.exec('DELETE FROM online_order_events WHERE id = 1'), /immutable/)
})

check('once its order is scrubbed, the two free-text columns of that order\'s events can be emptied, and nothing else about them can change', () => {
  const db = seeded()
  db.exec("UPDATE online_orders SET scrubbed_at = '2026-11-09 03:00:00' WHERE id = 1")
  db.exec('UPDATE online_order_events SET public_comment = NULL, internal_note = NULL WHERE order_id = 1')
  const first = db.prepare('SELECT * FROM online_order_events WHERE id = 1').get()
  assert.equal(first.public_comment, null); assert.equal(first.internal_note, null); assert.equal(first.detail_json, '{"a":1}'); assert.equal(first.event, 'note')
  assert.throws(() => db.exec("UPDATE online_order_events SET internal_note = 'again' WHERE id = 1"), APPEND_ONLY)
  assert.throws(() => db.exec("UPDATE online_order_events SET event = 'created' WHERE id = 1"), APPEND_ONLY)
  assert.throws(() => db.exec('UPDATE online_order_events SET public_comment = NULL, internal_note = NULL WHERE order_id = 2'), APPEND_ONLY, 'the other order is not scrubbed')
  assert.equal(db.prepare('SELECT public_comment FROM online_order_events WHERE id = 2').get().public_comment, 'call 012 999 888')
})

check('PINNED: on a scrubbed order no column except the two free-text ones can change, no row of another order can change, and no row can be deleted', () => {
  const db = seeded()
  db.exec("UPDATE online_orders SET scrubbed_at = '2026-11-09 03:00:00' WHERE id = 1")
  const columns = db.prepare('PRAGMA table_info(online_order_events)').all().map((c) => c.name).filter((n) => n !== 'public_comment' && n !== 'internal_note')
  const changed = { id: 99, order_id: 2, payment_id: 5, request_id: 5, event: 'created', from_state: 'x', to_state: 'y', source: 'sweep', actor_id: 5, actor_name: 'z', amount_usd: 1, amount_khr: 1, reference: 'r', attachments_json: '[]', sale_id: 5, return_id: 5, amendment_group_id: 'g', action_history_id: 5, detail_json: '{"b":2}', created_at: '2000-01-01 00:00:00' }
  assert.deepEqual(columns.filter((c) => !(c in changed)), [], 'every column of the table is exercised: add new columns to this test')
  for (const column of columns) {
    // each column alone, together with clearing the two free-text columns (the shape the scrub uses)
    assert.throws(() => db.prepare(`UPDATE online_order_events SET public_comment = NULL, internal_note = NULL, ${column} = ? WHERE id = 1`).run(changed[column]), APPEND_ONLY, column)
    assert.throws(() => db.prepare(`UPDATE online_order_events SET ${column} = ? WHERE id = 1`).run(changed[column]), APPEND_ONLY, `${column} alone`)
  }
  for (const id of [1, 2]) assert.throws(() => db.prepare('DELETE FROM online_order_events WHERE id = ?').run(id), /immutable/)
  assert.throws(() => db.exec('DELETE FROM online_order_events'), /immutable/)
  assert.throws(() => db.exec("UPDATE online_order_events SET public_comment = NULL, internal_note = NULL WHERE id = 2"), APPEND_ONLY, 'a row of an unscrubbed order')
  assert.deepEqual(db.prepare('SELECT id, public_comment FROM online_order_events ORDER BY id').all(), [{ id: 1, public_comment: 'call 012 345 678' }, { id: 2, public_comment: 'call 012 999 888' }], 'nothing changed')
})

check('RECOVERY (drop the trigger, recreate the 0293 one) restores strict append-only', () => {
  const db = seeded()
  db.exec("DROP TRIGGER online_order_events_append_only_update; CREATE TRIGGER online_order_events_append_only_update BEFORE UPDATE ON online_order_events BEGIN SELECT RAISE(ABORT, 'online_order_events is append-only: correct an entry by appending a new one, never by rewriting one'); END;")
  db.exec("UPDATE online_orders SET scrubbed_at = '2026-11-09 03:00:00' WHERE id = 1")
  assert.throws(() => db.exec('UPDATE online_order_events SET public_comment = NULL, internal_note = NULL WHERE order_id = 1'), APPEND_ONLY)
})

console.log(`migration 0297: ${passed} checks passed`)
