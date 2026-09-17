// Pins migration 0178 (legacy membership-number repair) on the REAL migration
// chain: seed customers with non-`LC-#####` membership numbers alongside
// customers already in shape, apply 0178's own SQL, and prove it repairs
// exactly the malformed rows and leaves everything else untouched.
//
// Run: node scripts/test-migration-0178-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

function loadUpTo(maxNumber) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => Number(f.slice(0, 4)) <= maxNumber)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

const migration0178Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0178_legacy_membership_number_repair.sql'), 'utf8')

// Builds a DB on the real chain up to (and NOT including) 0178, then seeds
// the exact shapes the header describes: one already-in-shape customer, one
// lowercase-but-in-shape customer, two malformed (random-id) customers, and
// one customer with no membership number at all (must be ignored, not
// crash the repair).
function seeded() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const m of loadUpTo(177)) db.exec(m)

  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (1, 'Already In Shape', 'LC-00001')`).run()
  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (2, 'Random Shape B', 'AB3F7GH2')`).run()
  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (3, 'Lowercase In Shape', 'lc-00002')`).run()
  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (4, 'No Number', NULL)`).run()
  db.prepare(`INSERT INTO customers (id, name, membership_number) VALUES (5, 'Random Shape E', '12345678')`).run()

  db.prepare(`INSERT INTO customer_share_submissions (id, customer_id, membership_number, customer_name)
    VALUES (1, 2, 'AB3F7GH2', 'Random Shape B')`).run()

  return db
}

function membershipShapeCount(db) {
  return db.prepare(`
    SELECT COUNT(*) c FROM customers
     WHERE COALESCE(trim(membership_number),'') <> ''
       AND NOT (lower(trim(membership_number)) GLOB 'lc-[0-9]*'
                AND lower(trim(membership_number)) NOT GLOB 'lc-*[^0-9]*')
  `).get().c
}

// --- PRE: exactly the two malformed rows are out of shape ------------------
{
  const db = seeded()
  assert.strictEqual(membershipShapeCount(db), 2, 'PRE: exactly customers 2 and 5 are out of the LC-##### shape')
  db.close()
}

// --- POST: repair applies, discriminating case (already-in-shape) untouched
{
  const db = seeded()
  db.exec(migration0178Sql)

  assert.strictEqual(membershipShapeCount(db), 0, 'POST: every membership number is now in shape')

  const c1 = db.prepare('SELECT membership_number FROM customers WHERE id = 1').get()
  const c3 = db.prepare('SELECT membership_number FROM customers WHERE id = 3').get()
  // The discriminating case: a customer already in shape must be left
  // completely untouched -- exact original value, not re-cased or renumbered.
  assert.strictEqual(c1.membership_number, 'LC-00001', 'already-in-shape customer 1 is untouched')
  assert.strictEqual(c3.membership_number, 'lc-00002', 'already-in-shape (lowercase) customer 3 is untouched, including its casing')

  const repairRows = db.prepare('SELECT customer_id, old_number, new_number FROM customer_membership_number_repair ORDER BY customer_id').all()
  assert.strictEqual(repairRows.length, 2, 'repair table holds one row per repaired customer, not one for the untouched ones')
  assert.deepStrictEqual(repairRows.map((r) => r.customer_id), [2, 5])
  assert.strictEqual(repairRows[0].old_number, 'AB3F7GH2')
  assert.strictEqual(repairRows[1].old_number, '12345678')
  // base.max_seq is 2 (from LC-00001 and lc-00002); repaired rows append after
  // it in customer-id order, per the migration's own "WHY APPEND" note.
  assert.strictEqual(repairRows[0].new_number, 'LC-00003')
  assert.strictEqual(repairRows[1].new_number, 'LC-00004')

  const c2 = db.prepare('SELECT membership_number FROM customers WHERE id = 2').get()
  const c5 = db.prepare('SELECT membership_number FROM customers WHERE id = 5').get()
  assert.strictEqual(c2.membership_number, 'LC-00003')
  assert.strictEqual(c5.membership_number, 'LC-00004')

  const dupes = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT membership_number FROM customers
       WHERE COALESCE(trim(membership_number), '') <> ''
       GROUP BY lower(trim(membership_number)) HAVING COUNT(*) > 1
    )
  `).get().c
  assert.strictEqual(dupes, 0, 'no two customers share a membership number after the repair')

  // The denormalised copy in customer_share_submissions moves with the repair.
  const submission = db.prepare('SELECT membership_number FROM customer_share_submissions WHERE id = 1').get()
  assert.strictEqual(submission.membership_number, 'LC-00003', 'the share-submission copy is repaired alongside its customer')

  const auditCount = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'repair_legacy_membership_number'`).get().c
  assert.strictEqual(auditCount, 2, 'one audit row per repaired customer')

  db.close()
}

// --- Re-run: idempotent, nothing changes a second time ---------------------
{
  const db = seeded()
  db.exec(migration0178Sql)
  const before = {
    c2: db.prepare('SELECT membership_number FROM customers WHERE id = 2').get().membership_number,
    c5: db.prepare('SELECT membership_number FROM customers WHERE id = 5').get().membership_number,
    repairRows: db.prepare('SELECT COUNT(*) c FROM customer_membership_number_repair').get().c,
    auditRows: db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'repair_legacy_membership_number'`).get().c,
  }

  db.exec(migration0178Sql)

  assert.strictEqual(db.prepare('SELECT membership_number FROM customers WHERE id = 2').get().membership_number, before.c2, 're-run does not touch customer 2 again')
  assert.strictEqual(db.prepare('SELECT membership_number FROM customers WHERE id = 5').get().membership_number, before.c5, 're-run does not touch customer 5 again')
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM customer_membership_number_repair').get().c, before.repairRows, 're-run inserts no extra repair rows (OR IGNORE keyed on customer_id)')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'repair_legacy_membership_number'`).get().c, before.auditRows, 're-run logs no duplicate audit rows')

  db.close()
}

// --- Full real chain: the migration is registered and runs cleanly ---------
{
  const { loadAll } = require('./harness/load_migrations.cjs')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const m of loadAll()) db.exec(m)
  assert.ok(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='customer_membership_number_repair'").get().c === 1)
  db.close()
}

console.log('test-migration-0178-pure: ok (malformed numbers repaired, already-in-shape rows untouched, denormalised copy moves, no duplicates, idempotent)')
