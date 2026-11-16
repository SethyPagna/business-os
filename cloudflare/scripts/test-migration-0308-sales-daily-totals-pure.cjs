'use strict'
// Pins migration 0308 (stored daily sales totals) on the REAL migration chain, in node:sqlite:
//   - the file is LF-only, keeps rowid, has no comment-only statement and no compound SELECT, carries PRE / POST / RECOVERY, numbered 0308 once;
//   - it applies after every earlier migration, seeds one dirty row per business day that has a sale (incl. the '' day), writes the coverage row, and a
//     second run aborts;
//   - the four triggers mark exactly the right day(s) dirty for every kind of write, skip restore mode, and never raise (NULL created_at);
//   - COST: the table rows each write adds are measured with total_changes() against the same chain WITHOUT 0308 (the difference is the trigger cost):
//     the first sale statement of a day +1, every later statement of a dirty day 0, a write to a clean past day +1, a claim and a commit 1 each.
//
// Run (from cloudflare/): node scripts/test-migration-0308-sales-daily-totals-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0308_sales_daily_totals.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const earlier = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = (withMigration, seedSql) => {
  const db = new DatabaseSync(':memory:')
  for (const f of earlier) db.exec(fs.readFileSync(path.join(directory, f), 'utf8').replace(/\r\n/g, '\n'))
  if (seedSql) db.exec(seedSql)
  if (withMigration) db.exec(sql)
  return db
}
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }
const code = sql.replace(/^--.*$/gm, '')

check('the file is LF-only, numbered 0308 once, keeps rowid, and carries PRE / POST / RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(code), false)
  assert.match(sql, /PRE:/); assert.match(sql, /POST:/); assert.match(sql, /RECOVERY:/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0308_')), [migration])
})

check('no comment-only statement and no compound SELECT (D1 refuses both)', () => {
  const blocks = sql.split(/\n\s*\n/)
  for (const block of blocks) assert.ok(block.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')), `comment-only block: ${block.slice(0, 60)}`)
  assert.equal(/\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/i.test(code), false, 'compound SELECT')
  assert.equal(/\bINSERT OR REPLACE\b|\bREPLACE INTO\b/i.test(code), false, 'REPLACE fires no delete trigger')
  assert.ok(sql.trimEnd().endsWith(';'), 'the file does not end on a comment')
})

// ---- fixture: sales that exist BEFORE the migration -------------------------------------------------------------------------------------------------------------
const sale = (receipt, createdAt, branch = 1) => `INSERT INTO sales(receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,branch_id,created_at) VALUES('${receipt}','req-${receipt}',0,10,10,${branch},${createdAt === null ? 'NULL' : `'${createdAt}'`});`
const SEED = [
  "INSERT INTO branches(name) VALUES('LC Store');",
  sale('A1', '2026-11-02 03:00:00'), sale('A2', '2026-11-02 09:00:00'),
  sale('A3', '2026-11-02 16:30:00'), // 23:30 local = still 2026-11-02
  sale('A4', '2026-11-02 17:00:00'), // 00:00 local = 2026-11-03
  sale('B1', '2026-10-01'), // a date-only created_at (stock-action import)
  sale('N1', null), // a NULL created_at lands on the empty day
].join('\n')

const migrated = chain(true, SEED)
const dayRows = (db) => db.prepare('SELECT business_date, state, claim_gen, kernel_version, data_epoch, refusal, payload FROM sales_daily_totals ORDER BY business_date').all().map((r) => ({ ...r }))

check('applies on the full chain; seeds one DIRTY row per day that has a sale (incl. the empty day); a second run aborts', () => {
  const rows = dayRows(migrated)
  assert.deepEqual(rows.map((r) => r.business_date), ['', '2026-10-01', '2026-11-02', '2026-11-03'])
  for (const r of rows) assert.deepEqual([r.state, r.claim_gen, r.kernel_version, r.data_epoch, r.refusal, r.payload], [1, 0, 0, '', null, '{}'])
  assert.throws(() => migrated.exec(sql), /already exists/i)
})

check('the coverage row carries the data epoch; the two indexes and four triggers exist; the partial index holds only unfinished days', () => {
  const epoch = migrated.prepare("SELECT value FROM system_flags WHERE key='data_epoch'").get().value
  assert.equal(migrated.prepare("SELECT value FROM system_flags WHERE key='sales_daily_coverage'").get().value, JSON.stringify({ epoch, kernel: 1 }))
  const names = (type) => migrated.prepare('SELECT name FROM sqlite_master WHERE type=? AND name LIKE ? ORDER BY name').all(type, '%sales_daily%').map((r) => r.name)
  assert.deepEqual(names('trigger'), ['sales_daily_mark_revision_insert', 'sales_daily_mark_revision_update', 'sales_daily_mark_sale_delete', 'sales_daily_mark_sale_moved'])
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_customers_anonymous' AND sql LIKE '%WHERE COALESCE(is_anonymous, 0) <> 0'").get())
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_sales_daily_totals_pending' AND sql LIKE '%WHERE state <> 0'").get())
  // the pending index is what the cron reads: it must seek the partial index, not scan the table
  const plan = migrated.prepare("EXPLAIN QUERY PLAN SELECT business_date FROM sales_daily_totals WHERE state <> 0 AND business_date < '2026-11-14' ORDER BY business_date LIMIT 7").all().map((r) => r.detail).join(' | ')
  assert.match(plan, /idx_sales_daily_totals_pending/)
})

check('a migration on an EMPTY sales table seeds nothing and still passes its POST assertion', () => {
  const empty = chain(true)
  assert.equal(empty.prepare('SELECT COUNT(*) n FROM sales_daily_totals').get().n, 0)
  assert.ok(empty.prepare("SELECT 1 FROM system_flags WHERE key='sales_daily_coverage'").get())
})

// ---- the triggers, write by write, on a twin pair: the chain without 0308 is the baseline for row cost ----------------------------------------------------------
const base = chain(false, SEED)
const total = (db) => db.prepare('select total_changes() n').get().n
const states = (db) => Object.fromEntries(db.prepare('SELECT business_date, state FROM sales_daily_totals').all().map((r) => [r.business_date, r.state]))
const costs = []
function step(label, statements, expectStates) {
  const tb = total(base), tm = total(migrated)
  base.exec(`BEGIN;${statements}COMMIT;`); migrated.exec(`BEGIN;${statements}COMMIT;`)
  const extra = (total(migrated) - tm) - (total(base) - tb)
  costs.push([label, extra])
  if (expectStates) for (const [day, state] of Object.entries(expectStates)) assert.equal(states(migrated)[day], state, `${label}: ${day}`)
  return extra
}
const claim = (day) => `UPDATE sales_daily_totals SET state = 2, claim_gen = claim_gen + 1 WHERE business_date = '${day}' AND state <> 0;`
const commit = (day, gen) => `UPDATE sales_daily_totals SET state = 0, payload = '{"v":1}' WHERE business_date = '${day}' AND state = 2 AND claim_gen = ${gen};`
const clean = (day) => { migrated.exec(`UPDATE sales_daily_totals SET state = 0, claim_gen = claim_gen + 1 WHERE business_date = '${day}'`) }
const saleId = (receipt) => migrated.prepare('SELECT id FROM sales WHERE receipt_number = ?').get(receipt).id
const genOf = (day) => migrated.prepare('SELECT claim_gen g FROM sales_daily_totals WHERE business_date=?').get(day).g

check('FIRST sale statement of a new day costs +1 table row; the second sale and every line of that dirty day cost 0', () => {
  assert.equal(step('first sale of 2026-11-05', sale('C1', '2026-11-05 03:00:00'), { '2026-11-05': 1 }), 1)
  assert.equal(step('line of that sale', `INSERT INTO sale_items(sale_id,product_id,product_name,quantity,branch_id) VALUES(${saleId('C1')},NULL,'Cream',1,1);`), 0)
  assert.equal(step('second sale same day', sale('C2', '2026-11-05 09:00:00')), 0)
  assert.equal(step('line of the second sale', `INSERT INTO sale_items(sale_id,product_id,product_name,quantity,branch_id) VALUES(${saleId('C2')},NULL,'Cream',2,1);`), 0)
  assert.equal(step('a status update on a dirty day', `UPDATE sales SET sale_status='awaiting_payment' WHERE id=${saleId('C2')};`), 0)
})

check('claim and commit write 1 row each; a write BETWEEN them sets the day dirty again and the commit is refused', () => {
  const day = '2026-11-05'
  migrated.exec(claim(day)); assert.equal(states(migrated)[day], 2)
  const gen = genOf(day)
  step('write during recompute (status)', `UPDATE sales SET sale_status='completed' WHERE id=${saleId('C2')};`, { [day]: 1 })
  const before = total(migrated)
  migrated.exec(commit(day, gen))
  assert.equal(total(migrated) - before, 0, 'a refused commit writes nothing')
  assert.equal(states(migrated)[day], 1)
  const claimBefore = total(migrated); migrated.exec(claim(day))
  assert.equal(total(migrated) - claimBefore, 1, 'a claim is one row'); costs.push(['claim', 1])
  const gen2 = genOf(day)
  assert.equal(gen2, gen + 1, 'each claim is a new generation')
  const b2 = total(migrated); migrated.exec(commit(day, gen2)); assert.equal(total(migrated) - b2, 1); costs.push(['commit', 1])
  assert.equal(states(migrated)[day], 0)
  // a commit of a stale generation never overwrites a newer claim
  migrated.exec(`UPDATE sales SET sale_status='awaiting_payment' WHERE id=${saleId('C2')};`); migrated.exec(claim(day))
  const b3 = total(migrated); migrated.exec(commit(day, gen2)); assert.equal(total(migrated) - b3, 0)
  assert.equal(states(migrated)[day], 2)
  migrated.exec(commit(day, gen2 + 1))
  assert.equal(states(migrated)[day], 0)
})

check('a write to a CLEAN past day costs +1 table row (the mark) and leaves the other days alone', () => {
  clean('2026-11-02'); clean('2026-11-03')
  assert.equal(step('return on a clean past day', `INSERT INTO returns(sale_id,total_refund_usd,status,return_scope,branch_id) VALUES(${saleId('A1')},5,'completed','customer',1);`, { '2026-11-02': 1, '2026-11-03': 0 }), 1)
  const second = step('another return on the same (now dirty) day', `INSERT INTO returns(sale_id,total_refund_usd,status,return_scope,branch_id) VALUES(${saleId('A2')},1,'completed','customer',1);`)
  assert.equal(second, 0)
})

check('every kind of child write marks the day of its sale: lines, fee, sale update, line delete', () => {
  const day = '2026-11-02'
  const cases = [
    ['line insert', `INSERT INTO sale_items(sale_id,product_id,product_name,quantity,branch_id) VALUES(${saleId('A1')},NULL,'X',1,1);`],
    ['line update', `UPDATE sale_items SET quantity=3 WHERE sale_id=${saleId('A1')};`],
    ['fee insert', `INSERT INTO fees(sale_id,fee_type,amount_usd,branch_id,fee_date) VALUES(${saleId('A1')},'delivery',1,1,'2026-11-02');`],
    ['fee update', `UPDATE fees SET amount_usd=2 WHERE sale_id=${saleId('A1')};`],
    ['sale update', `UPDATE sales SET total_usd=11 WHERE id=${saleId('A1')};`],
    ['line delete', `DELETE FROM sale_items WHERE sale_id=${saleId('A1')};`],
  ]
  for (const [label, statement] of cases) { clean(day); step(label, statement, { [day]: 1 }) }
})

check('a created_at MOVE marks BOTH the old and the new day; a same-value update marks only the own day of the sale', () => {
  clean('2026-11-02'); clean('2026-11-03')
  step('A1 moved 2026-11-02 -> 2026-11-09', `UPDATE sales SET created_at='2026-11-09 03:00:00' WHERE id=${saleId('A1')};`, { '2026-11-02': 1, '2026-11-09': 1, '2026-11-03': 0 })
  clean('2026-11-02'); clean('2026-11-09')
  step('created_at rewritten to the same value', `UPDATE sales SET created_at=created_at WHERE id=${saleId('A1')};`, { '2026-11-09': 1, '2026-11-02': 0 })
})

check('a sale DELETE marks its day (the revision trigger finds no sale row) and a NULL created_at never raises', () => {
  clean('2026-11-02'); clean('2026-11-03'); clean('')
  step('hard delete of A2', `DELETE FROM sales WHERE id=${saleId('A2')};`, { '2026-11-02': 1, '2026-11-03': 0 })
  step('write on the NULL-date sale', `UPDATE sales SET total_usd=12 WHERE id=${saleId('N1')};`, { '': 1 })
  clean(''); step('delete the NULL-date sale', `DELETE FROM sales WHERE id=${saleId('N1')};`, { '': 1 })
})

check('late evening and midnight boundaries: 16:59 UTC is the same local day, 17:00 UTC is the next', () => {
  const keyOf = (utc) => migrated.prepare("SELECT COALESCE(date(?, '+7 hours'), '') k").get(utc).k
  assert.equal(keyOf('2026-11-02 16:59:59'), '2026-11-02'); assert.equal(keyOf('2026-11-02 17:00:00'), '2026-11-03')
})

check('restore mode skips every trigger (a restore rotates the data epoch instead), and leaving it re-arms them', () => {
  // 0243 admits a maintenance row only inside a stock transaction permit
  migrated.exec("INSERT INTO system_flags(key,value,updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key='stock_schema_epoch'")
  migrated.exec("INSERT INTO system_flags(key,value,updated_at) VALUES('maintenance','{\"mode\":\"restore\"}',CURRENT_TIMESTAMP)")
  const day = '2026-11-20'
  const before = JSON.stringify(states(migrated))
  migrated.exec(sale('R1', `${day} 03:00:00`)); migrated.exec("UPDATE sales SET created_at='2026-11-21 03:00:00' WHERE receipt_number='R1'"); migrated.exec("DELETE FROM sales WHERE receipt_number='R1'")
  assert.equal(JSON.stringify(states(migrated)), before)
  migrated.exec("DELETE FROM system_flags WHERE key='maintenance'")
  migrated.exec(sale('R2', `${day} 03:00:00`))
  assert.equal(states(migrated)[day], 1)
})

check('the CHECK refuses a state outside 0..2 and business_date is unique', () => {
  assert.throws(() => migrated.exec("UPDATE sales_daily_totals SET state = 3 WHERE business_date = '2026-11-02'"), /CHECK/i)
  assert.throws(() => migrated.exec("INSERT INTO sales_daily_totals(business_date) VALUES('2026-11-02')"), /UNIQUE/i)
})

console.log('\ntrigger row cost per statement (table rows beyond the same statement without 0308):')
for (const [label, extra] of costs) console.log(`  ${String(extra).padStart(2)}  ${label}`)
console.log(`\n${passed} checks passed`)
