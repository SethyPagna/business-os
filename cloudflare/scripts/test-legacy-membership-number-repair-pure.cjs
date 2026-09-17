// Migration 0178, run against a real migrated database.
//
// Owner (Sep 17, P10-12): "customer still have old membership ids".
//
// Between Sep 5 and Sep 6 2026 a change minted eight random A-Z0-9 characters
// instead of the house `LC-#####` sequence, and the rows created in that
// window were never repaired. What is worth testing is not that the SQL
// parses -- it is that the repair moves exactly those rows, leaves every
// other row alone (including a hand-typed lowercase house number and a
// customer with no number at all), carries the one denormalised copy with it,
// and does nothing the second time it is applied.
//
// The migrations are applied the way D1 applies them: the chain up to 0177,
// then a seed, then 0178.
//
// Run (from cloudflare/): node scripts/test-legacy-membership-number-repair-pure.cjs

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
const M0178 = files.find((f) => f.startsWith('0178_'))
check('migration 0178 is present', Boolean(M0178))
const chain = files.filter((f) => f < M0178).map(read)

const SEED = [
  "INSERT INTO customers (id, name, membership_number) VALUES",
  "  (1, 'House One',   'LC-00001'),",
  "  (2, 'House Two',   'LC-00002'),",
  "  (3, 'House Three', 'lc-00003'),",
  "  (4, 'Legacy A',    'QVWK5RSC'),",
  "  (5, 'Blank',       NULL),",
  "  (6, 'Legacy B',    '6HCD9V1Z');",
  "INSERT INTO customer_share_submissions (id, customer_id, membership_number, customer_name, status, reward_points)",
  "  VALUES (1, 6, '6HCD9V1Z', 'Legacy B', 'approved', 5);",
].join('\n')

const build = (times) => {
  const tail = []
  for (let i = 0; i < times; i += 1) tail.push(read(M0178))
  return openDb([...chain, SEED, ...tail])
}

const db = build(1)
const one = (sql, params = {}) => db.prepare(sql).get(params)
const all = (sql, params = {}) => db.prepare(sql).all(params)

const numbers = all('SELECT id, membership_number AS m FROM customers ORDER BY id')
const byId = new Map(numbers.map((r) => [Number(r.id), r.m]))
check('a house number is never touched, whatever its case',
  byId.get(1) === 'LC-00001' && byId.get(2) === 'LC-00002' && byId.get(3) === 'lc-00003')
check('a customer with no number is left with no number', byId.get(5) == null)
// The seeded maximum house sequence is 3, and the repair appends in id order.
check('the first legacy id becomes the next number after the maximum', byId.get(4) === 'LC-00004')
check('the second legacy id follows it, in customer-id order', byId.get(6) === 'LC-00005')
check('no two customers end up sharing a number',
  all("SELECT lower(trim(membership_number)) AS k FROM customers"
    + " WHERE COALESCE(trim(membership_number),'') <> '' GROUP BY k HAVING COUNT(*) > 1").length === 0)
check('nothing non-house survives the repair',
  Number(one("SELECT COUNT(*) AS n FROM customers"
    + " WHERE COALESCE(trim(membership_number),'') <> ''"
    + "   AND NOT (lower(trim(membership_number)) GLOB 'lc-[0-9]*'"
    + "            AND lower(trim(membership_number)) NOT GLOB 'lc-*[^0-9]*')").n) === 0)

const repair = all('SELECT customer_id, old_number, new_number FROM customer_membership_number_repair ORDER BY customer_id')
check('every move is recorded old-beside-new, so it can be undone exactly',
  repair.length === 2
  && Number(repair[0].customer_id) === 4 && repair[0].old_number === 'QVWK5RSC' && repair[0].new_number === 'LC-00004'
  && Number(repair[1].customer_id) === 6 && repair[1].old_number === '6HCD9V1Z' && repair[1].new_number === 'LC-00005')
check('the denormalised copy on a share submission moves with the customer',
  one('SELECT membership_number AS m FROM customer_share_submissions WHERE id = 1').m === 'LC-00005')
check('the move is written to the audit trail',
  Number(one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'repair_legacy_membership_number'").n) === 2)

const twice = build(2)
check('applying the migration a second time renumbers nobody again',
  JSON.stringify(twice.prepare('SELECT id, membership_number AS m FROM customers ORDER BY id').all({})) === JSON.stringify(numbers))
check('and writes no second repair row and no second audit row',
  Number(twice.prepare('SELECT COUNT(*) AS n FROM customer_membership_number_repair').get({}).n) === 2
  && Number(twice.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'repair_legacy_membership_number'").get({}).n) === 2)

console.log(`\nAll ${checks} checks passed.`)
