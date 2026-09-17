// Migration 0179, run against a real migrated database.
//
// Owner (Sep 4 2026): "zero all the membership points, make the membership
// points on off in settings."
// Owner (Sep 17 2026, P10-13): "some still have membership points not zeroed".
//
// Migration 0117 did the data half in September and left the master switch
// (settings key `loyalty_points_enabled`) to the Settings screen, where it was
// never written -- and every reader treats an ABSENT key as ON, so the
// programme kept accruing. This pins the finished shutdown: the switch is
// written, the three ADDING terms of the balance formula are neutralised, the
// two SUBTRACTING terms are left completely alone, the flip is logged with the
// exact ids it touched so it can be undone, and a second application is a
// no-op.
//
// The migrations are applied the way D1 applies them: the chain up to 0178,
// then a seed, then 0179.
//
// Run (from cloudflare/): node scripts/test-membership-points-switch-off-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const MIGRATIONS = path.join(__dirname, '..', 'migrations')
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const read = (name) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
const M0179 = files.find((f) => f.startsWith('0179_'))
check('migration 0179 is present', Boolean(M0179))
const chain = files.filter((f) => f < M0179).map(read)

// Sale 3 is already non-accruing (imported history, the standing rule that
// historical sales never earn points). It must stay out of the log, or an undo
// would hand points to history that never had any.
const SEED = [
  "INSERT INTO customers (id, name, membership_number) VALUES (1, 'A', 'LC-00001'), (2, 'B', 'LC-00002');",
  "INSERT INTO sales (id, customer_id, total_usd, membership_points_redeemed, loyalty_accrual, sale_status)",
  "  VALUES (1, 1, 40.0, 0, 1, 'completed'), (2, 2, 60.0, 10, 1, 'completed'), (3, 1, 10.0, 0, 0, 'completed');",
  "INSERT INTO loyalty_point_adjustments (id, customer_id, points, note) VALUES (1, 1, 25, 'goodwill');",
  "INSERT INTO customer_share_submissions (id, customer_id, customer_name, status, reward_points)",
  "  VALUES (1, 2, 'B', 'approved', 5);",
].join('\n')

const build = (times) => {
  const tail = []
  for (let i = 0; i < times; i += 1) tail.push(read(M0179))
  return openDb([...chain, SEED, ...tail])
}

const db = build(1)
const one = (sql, params = {}) => db.prepare(sql).get(params)
const all = (sql, params = {}) => db.prepare(sql).all(params)

check('the master switch is written, as the string the Settings page writes',
  one("SELECT value AS v FROM settings WHERE key = 'loyalty_points_enabled'").v === 'false')
check('no sale is left accruing',
  Number(one('SELECT COUNT(*) AS n FROM sales WHERE COALESCE(loyalty_accrual, 1) = 1').n) === 0)
check('every customer balance computes to zero',
  all('SELECT customer_id, SUM(COALESCE(total_usd,0)) - SUM(COALESCE(membership_points_redeemed,0)) AS pts'
    + ' FROM sales WHERE customer_id IS NOT NULL AND COALESCE(loyalty_accrual,1) = 1'
    + ' GROUP BY customer_id HAVING pts > 0').length === 0)
check('what a customer actually redeemed is never rewritten',
  Number(one('SELECT membership_points_redeemed AS r FROM sales WHERE id = 2').r) === 10)

const adjustment = one('SELECT voided_at AS v, points AS p FROM loyalty_point_adjustments WHERE id = 1')
check('a hand-issued adjustment stops counting but is still readable',
  adjustment.v != null && Number(adjustment.p) === 25)
const submission = one('SELECT reward_points_voided_at AS v, reward_points AS p FROM customer_share_submissions WHERE id = 1')
check('an approved share reward stops counting but keeps what it was worth',
  submission.v != null && Number(submission.p) === 5)

const log = one("SELECT * FROM loyalty_points_reset_log WHERE reason = 'membership_points_switch_off_2026_09_17'")
check('the reset is logged with the exact ids it flipped, not "all sales"',
  Boolean(log) && String(log.sales_reset_ids).split(',').sort().join(',') === '1,2'
  && Number(log.sales_reset_count) === 2)
check('an already non-accruing sale is not in the log, so an undo cannot grant it points',
  !String(log.sales_reset_ids).split(',').includes('3'))
check('the undo restores the switch as well as the ledgers',
  /DELETE FROM settings WHERE key = 'loyalty_points_enabled'/.test(String(log.undo_sql))
  && /UPDATE sales SET loyalty_accrual = 1/.test(String(log.undo_sql)))
check('the Sep 4 reset log row is untouched, so the two resets undo independently',
  Number(one('SELECT COUNT(*) AS n FROM loyalty_points_reset_log').n) === 2)

const twice = build(2)
check('applying the migration a second time writes no second log row',
  Number(twice.prepare("SELECT COUNT(*) AS n FROM loyalty_points_reset_log"
    + " WHERE reason = 'membership_points_switch_off_2026_09_17'").get({}).n) === 1)
check('and leaves the switch off',
  twice.prepare("SELECT value AS v FROM settings WHERE key = 'loyalty_points_enabled'").get({}).v === 'false')

console.log(`\nAll ${checks} checks passed.`)
