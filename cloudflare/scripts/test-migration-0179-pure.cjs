// Pins migration 0179 (membership-points master switch off) on the REAL
// migration chain: seed sales that are still accruing alongside sales that
// are already 0, apply 0179's own SQL, and prove the switch, the scoping and
// the undo contract all hold.
//
// Run: node scripts/test-migration-0179-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const REASON = 'membership_points_switch_off_2026_09_17'

function loadUpTo(maxNumber) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => Number(f.slice(0, 4)) <= maxNumber)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

const migration0179Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0179_membership_points_switch_off.sql'), 'utf8')

function seeded() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const m of loadUpTo(178)) db.exec(m)

  // Still accruing -- these are the ones the migration must flip.
  db.prepare(`INSERT INTO sales (id, receipt_number, loyalty_accrual, total_usd) VALUES (10, 'R10', 1, 5)`).run()
  db.prepare(`INSERT INTO sales (id, receipt_number, loyalty_accrual, total_usd) VALUES (11, 'R11', 1, 8)`).run()
  db.prepare(`INSERT INTO sales (id, receipt_number, loyalty_accrual, total_usd) VALUES (12, 'R12', 1, 3)`).run()
  // Already non-accruing (imported history / prior opt-out) -- the
  // discriminating case: must be flipped by NOTHING and named NOWHERE.
  db.prepare(`INSERT INTO sales (id, receipt_number, loyalty_accrual, total_usd) VALUES (20, 'R20', 0, 40)`).run()
  db.prepare(`INSERT INTO sales (id, receipt_number, loyalty_accrual, total_usd) VALUES (21, 'R21', 0, 60)`).run()

  db.prepare(`INSERT INTO loyalty_point_adjustments (id, customer_id, points, note) VALUES (1, 2, 50, 'manual bonus')`).run()
  db.prepare(`INSERT INTO customer_share_submissions (id, customer_id, membership_number, customer_name, status, reward_points)
    VALUES (1, 2, 'LC-00002', 'B', 'approved', 30)`).run()

  return db
}

// --- PRE: settings row absent, three sales still accruing -------------------
{
  const db = seeded()
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM settings WHERE key = 'loyalty_points_enabled'").get().c, 0, 'PRE: switch row absent')
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales WHERE COALESCE(loyalty_accrual,1) = 1').get().c, 3, 'PRE: exactly 3 sales still accruing')
  db.close()
}

// --- POST: switch off, scoping, and the reset log naming the exact set -----
{
  const db = seeded()
  db.exec(migration0179Sql)

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'loyalty_points_enabled'").get()
  assert.strictEqual(setting.value, 'false', 'switch is written as the exact string the settings page reads')

  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sales WHERE COALESCE(loyalty_accrual,1) = 1').get().c, 0, 'no sale is left accruing')

  const stillOff = db.prepare('SELECT loyalty_accrual FROM sales WHERE id IN (20,21)').all()
  assert.deepStrictEqual(stillOff.map((r) => r.loyalty_accrual), [0, 0], 'rows already 0 stay 0')

  const log = db.prepare('SELECT * FROM loyalty_points_reset_log WHERE reason = ?').get(REASON)
  assert.ok(log, 'a reset-log row is written under this migration\'s own reason')
  assert.strictEqual(log.sales_reset_count, 3, 'the log records exactly the 3 rows this migration flipped')
  const resetIds = log.sales_reset_ids.split(',').map(Number).sort((a, b) => a - b)
  assert.deepStrictEqual(resetIds, [10, 11, 12], 'the discriminating case: rows already 0 (20, 21) are named NOWHERE in the reset log -- an undo must not hand them points')

  const adjustment = db.prepare('SELECT voided_at, voided_reason FROM loyalty_point_adjustments WHERE id = 1').get()
  assert.ok(adjustment.voided_at, 'the hand-issued adjustment is voided')
  assert.strictEqual(adjustment.voided_reason, REASON)

  const submission = db.prepare('SELECT reward_points_voided_at, reward_points, reward_points_voided_reason FROM customer_share_submissions WHERE id = 1').get()
  assert.ok(submission.reward_points_voided_at, 'the approved share reward is voided')
  assert.strictEqual(submission.reward_points, 30, 'reward_points itself is left intact -- only the voided marker is set')

  db.close()
}

// --- Undo contract: running the stored undo_sql restores the pre-migration state exactly
{
  const db = seeded()

  const before = {
    settingsCount: db.prepare("SELECT COUNT(*) c FROM settings WHERE key='loyalty_points_enabled'").get().c,
    sales: db.prepare('SELECT id, loyalty_accrual FROM sales ORDER BY id').all(),
    adjustment: db.prepare('SELECT voided_at, voided_reason FROM loyalty_point_adjustments WHERE id = 1').get(),
    submission: db.prepare('SELECT reward_points_voided_at, reward_points_voided_reason FROM customer_share_submissions WHERE id = 1').get(),
  }

  db.exec(migration0179Sql)
  const undoSql = db.prepare('SELECT undo_sql FROM loyalty_points_reset_log WHERE reason = ?').get(REASON).undo_sql
  assert.ok(undoSql && undoSql.length > 0, 'undo_sql is stored on the log row')
  db.exec(undoSql)

  const after = {
    settingsCount: db.prepare("SELECT COUNT(*) c FROM settings WHERE key='loyalty_points_enabled'").get().c,
    sales: db.prepare('SELECT id, loyalty_accrual FROM sales ORDER BY id').all(),
    adjustment: db.prepare('SELECT voided_at, voided_reason FROM loyalty_point_adjustments WHERE id = 1').get(),
    submission: db.prepare('SELECT reward_points_voided_at, reward_points_voided_reason FROM customer_share_submissions WHERE id = 1').get(),
  }

  assert.deepStrictEqual(after, before, 'running the stored undo_sql returns the database to its exact pre-migration state')

  db.close()
}

console.log('test-migration-0179-pure: ok (switch on-off, scoping excludes already-zero rows, reset log names the exact set, undo_sql restores pre-migration state exactly)')
