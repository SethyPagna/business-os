'use strict'
// Query plans of the grouped Inventory Check list. Production keeps no ANALYZE statistics, so the "last checked" lookup is pinned (CROSS JOIN + INDEXED BY); this test proves
// the pins hold with no statistics and after ANALYZE (run on a scratch in-memory database only): the lookup SEARCHes inventory_check_items through
// inventory_check_items_product_latest and the session by its key, and no statement of a grouped read SCANs either IC table.
//
// Run: node scripts/test-inventory-check-grouped-plans-pure.cjs
const assert = require('node:assert/strict')
const { bundle, buildWorld } = require('./harness/ic-grouped-world.cjs')

const products = bundle('inventoryCheckProducts.ts')
const grouping = bundle('inventoryCheckGrouping.ts')
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const NL = String.fromCharCode(10)
let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

const plan = (db, sql, params) => {
  const statement = db.prepare(`EXPLAIN QUERY PLAN ${sql}`); statement.setAllowUnknownNamedParameters(true)
  return statement.all(params || {}).map(row => row.detail)
}
// Aliases i and s also name the stock tables in the stock ledger, so a scan through one of their own indexes is not an IC scan.
const icScans = lines => lines.filter(line => /^SCAN (i|s|inventory_check_items|inventory_check_sessions)/.test(line) && !/idx_(branch|damaged)/.test(line))
// One grouped read, recording every statement with its parameters.
async function record(db, query, org = 1) {
  const seen = []
  const adapter = { async batch(statements) {
    seen.push(...statements)
    return statements.map(({ sql, params = {} }) => { const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true); return { success: true, results: prepared.all(params) } })
  } }
  await products.readInventoryCheckProductsSimple(adapter, admin, query, { lowStock, check: { organizationId: org, viewerId: 1, canSeeStaffIdentity: () => true } })
  return seen
}

async function main() {
  for (const stats of [false, true]) {
    const { db } = buildWorld(4)
    if (stats) db.exec('ANALYZE') // scratch in-memory database only
    const label = stats ? 'after ANALYZE' : 'with no statistics'

    await check(`the last-checked lookup is two index searches (${label})`, async () => {
      for (const branchScoped of [true, false]) {
        const sql = `SELECT p.id, ${grouping.lastCheckedSql('p.id', branchScoped)} AS k FROM products p`
        const lines = plan(db, sql, { checkOrg: 1, branchId: 1 })
        assert.ok(lines.some(line => /SEARCH i USING INDEX inventory_check_items_product_latest \(product_id=\?/.test(line)), `items by the 0285 index:\n${lines.join('\n')}`)
        assert.ok(lines.some(line => /SEARCH s USING (INTEGER PRIMARY KEY|INDEX sqlite_autoindex_inventory_check_sessions_1|PRIMARY KEY)/.test(line) || /SEARCH s USING .*\(id=\?\)/.test(line)), `session by key:\n${lines.join('\n')}`)
        assert.deepEqual(icScans(lines), [], `no scan of an IC table:\n${lines.join('\n')}`)
        if (branchScoped) assert.ok(lines.some(line => /branch_id=\?/.test(line)), 'the branch is an index term')
      }
    })

    await check(`every statement of a grouped read prepares and scans no IC table (${label})`, async () => {
      for (const query of [{ groupBy: 'checked' }, { groupBy: 'checked', branchId: '1' }, { groupBy: 'checked', checkState: 'ok', summary: '1' }, { groupBy: 'checked', query: 'a' },
        { groupBy: 'checked', stockState: 'low_stock', page: '2', pageSize: '4' }]) {
        const statements = await record(db, query)
        const count = statements.filter(statement => statement.sql.includes('COUNT(*) AS count') && statement.sql.includes('FROM families') && !statement.sql.includes('LIMIT 501'))
        const pages = statements.filter(statement => statement.sql.includes('INDEXED BY') && statement.sql.includes('LIMIT 501'))
        assert.equal(pages.length, 1, 'one page statement carries the generator'); assert.equal(count.length, 1); assert.ok(query.checkState || !count[0].sql.includes('INDEXED BY'), 'the count statement does not carry the per-row lookup (a checkState filter pins its own, since lane ic-summary-reads)')
        // A checkState filter reads the same index in the cohort itself (an older copy of the rule), so the lookup counts below are asserted for queries without one.
        const countPlan = plan(db, count[0].sql, count[0].params)
        if (!query.checkState) assert.ok(!countPlan.some(line => /inventory_check_items_product_latest/.test(line)), `the count statement never runs the per-row lookup: ${countPlan.join(NL)}`)
        const pagePlan = plan(db, pages[0].sql, pages[0].params)
        const lookups = pagePlan.filter(line => /SEARCH i USING INDEX inventory_check_items_product_latest/.test(line))
        // One grouping lookup per cohort row (a second textual one when no branch is named, see lastCheckedSql: the sole active branch's seek, and the all-branch seek that runs when there is not exactly one) plus the page rows' two CTEs (latest, open_check), which read the same index since lane ic-summary-reads; a CTE read twice would add another.
        if (!query.checkState) assert.equal(lookups.length, query.branchId ? 3 : 4, `the page statement runs the grouping lookup once per cohort row and each page CTE once (a CTE read twice would run it again): ${pagePlan.join(NL)}`)
        for (const { sql, params } of statements) assert.deepEqual(icScans(plan(db, sql, params)), [], `no IC table is scanned: ${JSON.stringify(query)}`)
      }
    })
  }
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
