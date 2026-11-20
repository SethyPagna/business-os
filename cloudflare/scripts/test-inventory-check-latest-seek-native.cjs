'use strict'
// icr0 slice 2: the two statements that walked every count a product ever had are newest-first seeks on index 0285 (inventory_check_items_product_latest), with the same answers.
//   LATEST_ITEMS_SQL (lib/inventoryCheckList.ts): each product's newest done/issue item at a branch (the sets, chips and day filters). It was a ROW_NUMBER() window over every item at the branch.
//   lastCheckedSql   (lib/inventoryCheckGrouping.ts): the date the grouped list ranks by. With no branch it was MAX over every item of the product at every branch.
// The OLD texts are copied here from afd991a39 and run on the same database as the new ones. Over seeded worlds with ties on updated_at (broken by session id), counts in open sessions, another
// organization's items, an item whose branch differs from its session's, a deactivated product and counts of a product that no longer exists, the new answers must equal the old ones row for row
// (and by hash), for both organizations, both branches, and the "no branch" date. The read-budget shape is the query plan: every access to the items table is a SEARCH on index 0285 (no SCAN, no
// window over the items), which is what makes the rows read O(products) and not O(counts); the old statements fail that shape. The real D1 row counts are measured on the one-year world by icr0.
// Run: node scripts/test-inventory-check-latest-seek-native.cjs
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { buildWorld } = require('./harness/count-tasks-world.cjs')

const w = buildWorld()
const list = w.app.load('lib/inventoryCheckList.ts')
const grouping = w.app.load('lib/inventoryCheckGrouping.ts')
const dates = w.app.load('lib/businessDateWindow.ts')
const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n     ')}`) } }

// ---- the statements as they were at afd991a39 -----------------------------------------------------------------------------------------------------------------------------------------------------
const OLD_LATEST_SQL = `WITH latest AS (
    SELECT i.product_id AS product_id, i.state AS state, i.updated_at AS updated_at,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.updated_at DESC, i.session_id DESC) AS rn
    FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id = s.id AND i.branch_id = s.branch_id
    WHERE s.organization_id IS @organization AND s.branch_id = @branchId AND i.state IN ('done', 'issue'))
  SELECT product_id, state, ${dates.localDateExpr('updated_at')} AS day FROM latest WHERE rn = 1 ORDER BY updated_at DESC, product_id LIMIT @limit`
const oldLastChecked = (productId, branchScoped) => `(SELECT MAX(i.updated_at) FROM inventory_check_items i INDEXED BY inventory_check_items_product_latest
    CROSS JOIN inventory_check_sessions s ON s.id=i.session_id
    WHERE i.product_id=${productId}${branchScoped ? ' AND i.branch_id=@branchId' : ''} AND i.state IN ('done','issue')
      AND s.organization_id IS @checkOrg AND s.branch_id=i.branch_id)`

// ---- a seeded world --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const PRODUCTS = 260
const GONE = [901, 902, 903] // ids with counts and no product row
function seed(seedNumber) {
  const raw = w.raw.db
  raw.exec('PRAGMA foreign_keys=OFF; DELETE FROM inventory_check_items; DELETE FROM inventory_check_lot_lines;')
  raw.exec('DROP TRIGGER IF EXISTS inventory_check_items_no_delete; DROP TRIGGER IF EXISTS inventory_check_sessions_no_delete; DROP TRIGGER IF EXISTS inventory_check_events_no_delete; DROP TRIGGER IF EXISTS inventory_check_events_no_update')
  raw.exec('DELETE FROM inventory_check_events; DELETE FROM inventory_check_approvals; DELETE FROM inventory_check_sessions')
  let state = seedNumber * 7919 + 13
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const stamps = Array.from({ length: 9 }, (_, i) => `2026-0${1 + (i % 9)}-1${i % 9}T0${i % 8}:30:00.000Z`)
  const session = raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at) VALUES(?,?,?,8,'',?,0,'{}',?,?)")
  const item = raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',5,'{}',?,?,?,1,8,?)")
  const ids = [...Array.from({ length: PRODUCTS }, (_, i) => i + 1), ...GONE]
  for (let s = 0; s < 120; s++) {
    const branch = rand() < 0.6 ? 1 : 2, org = rand() < 0.85 ? null : 2, status = rand() < 0.2 ? 'open' : 'closed', at = pick(stamps)
    session.run(`s${s}`, org, branch, status, at, at)
    const count = 3 + Math.floor(rand() * 40), chosen = new Set()
    while (chosen.size < count) chosen.add(pick(ids))
    for (const product of chosen) {
      const itemBranch = rand() < 0.02 ? (branch === 1 ? 2 : 1) : branch // a rare item whose branch differs from its session's: never read
      const itemState = pick(['done', 'done', 'issue', 'unstarted'])
      item.run(`s${s}`, product, itemBranch, itemState, itemState === 'unstarted' ? null : 5, itemState === 'issue' ? 'short' : null, rand() < 0.5 ? at : pick(stamps))
    }
  }
  // Some counted products are inactive. The guard refuses to deactivate a product that holds stock, so the stock is taken to zero first (the same four places it checks), then the product is switched off.
  w.stockWrite(() => {
    raw.exec('UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id % 37 = 0)')
    raw.exec('UPDATE branch_stock SET quantity = 0 WHERE product_id % 37 = 0')
    raw.exec('UPDATE damaged_stock_lots SET quantity_remaining = 0 WHERE product_id % 37 = 0')
    raw.exec('UPDATE products SET stock_quantity = 0 WHERE id % 37 = 0')
    raw.exec('UPDATE products SET is_active = 0 WHERE id % 37 = 0')
  })
}
const hash = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex')
const run = (sql, params) => { const statement = w.raw.db.prepare(sql); statement.setAllowUnknownNamedParameters(true); return statement.all(params ?? {}).map((row) => ({ ...row })) }
const lastDates = (expr, params) => run(`SELECT p.id AS id, ${expr} AS k FROM products p ORDER BY p.id`, params)

function equalOnWorld(seedNumber) {
  seed(seedNumber)
  let compared = 0
  for (const organization of [null, 2]) for (const branchId of [1, 2]) for (const limit of [100000, 40, 1]) {
    const before = run(OLD_LATEST_SQL, { organization, branchId, limit }), after = run(list.LATEST_ITEMS_SQL, { organization, branchId, limit })
    assert.deepEqual(after, before, `LATEST_ITEMS_SQL seed ${seedNumber} org ${organization} branch ${branchId} limit ${limit}`)
    assert.equal(hash(after), hash(before)); compared += before.length
  }
  for (const checkOrg of [null, 2]) {
    for (const branchId of [1, 2]) assert.deepEqual(lastDates(grouping.lastCheckedSql('p.id', true), { checkOrg, branchId }), lastDates(oldLastChecked('p.id', true), { checkOrg, branchId }), `last checked, branch ${branchId}, org ${checkOrg}`)
    assert.deepEqual(lastDates(grouping.lastCheckedSql('p.id', false), { checkOrg }), lastDates(oldLastChecked('p.id', false), { checkOrg }), `last checked, no branch, org ${checkOrg}`)
  }
  return compared
}

// ---- the read-budget shape: index steps, not rows of the table --------------------------------------------------------------------------------------------------------------------------------------
const plan = (sql, params) => run(`EXPLAIN QUERY PLAN ${sql}`, params).map((row) => row.detail)
function shape(sql, params) {
  const lines = plan(sql, params)
  return {
    lines,
    itemScans: lines.filter((line) => /^SCAN (i|f|n|inventory_check_items)\b/.test(line)),
    itemSearchesOn0285: lines.filter((line) => /SEARCH (i|f|n|inventory_check_items) USING (COVERING )?INDEX inventory_check_items_product_latest/.test(line)),
    window: lines.filter((line) => /WINDOW|CO-ROUTINE latest/.test(line)),
  }
}

async function main() {
  for (const seedNumber of [1, 2, 3, 4, 5, 6]) await check(`seed ${seedNumber}: the seek statements answer exactly what the old walks answered (sets for both organizations and branches, the date with and without a branch)`, async () => {
    const compared = equalOnWorld(seedNumber)
    assert.ok(compared > 200, `the world must hold rows to compare (${compared})`)
  })

  await check('the world exercises what it claims: ties, open sessions, a deleted product, the other organization', async () => {
    seed(1)
    const ties = run("SELECT product_id,branch_id,updated_at,COUNT(*) AS n FROM inventory_check_items WHERE state IN ('done','issue') GROUP BY product_id,branch_id,updated_at HAVING n > 1")
    assert.ok(ties.length > 5, 'ties on updated_at')
    assert.ok(run("SELECT 1 FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE s.status='open' AND i.state IN ('done','issue') LIMIT 1").length)
    assert.ok(run('SELECT 1 FROM inventory_check_items WHERE product_id IN (901,902,903) AND state IN (\'done\',\'issue\') LIMIT 1').length, 'counts of a product that no longer exists')
    assert.ok(run("SELECT 1 FROM inventory_check_items i JOIN products p ON p.id=i.product_id WHERE p.is_active = 0 AND i.state IN ('done','issue') LIMIT 1").length, 'counts of an inactive product')
    assert.ok(run('SELECT 1 FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE s.organization_id = 2 LIMIT 1').length)
    assert.ok(run('SELECT 1 FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.branch_id <> s.branch_id LIMIT 1').length, 'an item at a branch other than its session\'s')
    const tied = run(OLD_LATEST_SQL, { organization: null, branchId: 1, limit: 100000 })
    assert.ok(tied.some((row) => GONE.includes(row.product_id)), 'the old sets include a product that no longer exists (and so do the new ones, by the equality above)')
  })

  await check('read-budget shape: every access to the items table is a seek on index 0285 and nothing scans, windows or sorts the items', async () => {
    seed(1)
    for (const [name, sql, params] of [
      ['LATEST_ITEMS_SQL', list.LATEST_ITEMS_SQL, { organization: null, branchId: 1, limit: 100 }],
      ['last checked, branch', `SELECT p.id, ${grouping.lastCheckedSql('p.id', true)} FROM products p`, { checkOrg: null, branchId: 1 }],
      ['last checked, no branch', `SELECT p.id, ${grouping.lastCheckedSql('p.id', false)} FROM products p`, { checkOrg: null }],
    ]) {
      const s = shape(sql, params)
      assert.deepEqual(s.itemScans, [], `${name}: no scan of the items table\n${s.lines.join('\n')}`)
      assert.deepEqual(s.window, [], `${name}: no window over the items\n${s.lines.join('\n')}`)
      assert.ok(s.itemSearchesOn0285.length >= 1, `${name}: items are read through index 0285\n${s.lines.join('\n')}`)
    }
    const old = shape(OLD_LATEST_SQL, { organization: null, branchId: 1, limit: 100 })
    assert.ok(old.window.length > 0 || old.itemScans.length > 0 || old.itemSearchesOn0285.length === 0, 'the old statement is exactly what the shape refuses')
    const oldDate = shape(`SELECT p.id, ${oldLastChecked('p.id', false)} FROM products p`, { checkOrg: null })
    assert.ok(oldDate.itemSearchesOn0285.length >= 1)
  })

  if (failures.length) { console.error(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exit(1) }
  console.log(`PASS test-inventory-check-latest-seek-native (${passed})`)
}
main().catch((error) => { console.error(error); process.exit(1) })
