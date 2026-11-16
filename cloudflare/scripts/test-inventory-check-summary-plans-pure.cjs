'use strict'
// Query plans of the ic_simple check summary, page facts and checkState filter (lane ic-summary-reads). Production keeps no ANALYZE statistics, and the old summary
// (`product_id IN (SELECT id FROM cohort)` over a plain JOIN) planned as: every session of the organization, then one probe of the items per cohort product = sessions x products rows
// (537K rows for 3,020 check items). The pinned text reads each product's items through inventory_check_items_product_latest and the session by key: a few rows per ITEM.
// This test requires that plan with no statistics and after ANALYZE (scratch in-memory database only), for every statement that carries the rule, and plants plan mutants.
//
// Run: node scripts/test-inventory-check-summary-plans-pure.cjs
const assert = require('node:assert/strict')
const { bundle, bundleMutated, buildWorld } = require('./harness/ic-grouped-world.cjs')

const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

const plan = (db, sql, params) => {
  const statement = db.prepare(`EXPLAIN QUERY PLAN ${sql}`); statement.setAllowUnknownNamedParameters(true)
  return statement.all(params || {}).map(row => row.detail)
}
async function record(api, db, query) {
  const seen = []
  const adapter = { async batch(statements) {
    seen.push(...statements)
    return statements.map(({ sql, params = {} }) => { const prepared = db.prepare(sql); prepared.setAllowUnknownNamedParameters(true); return { success: true, results: prepared.all(params) } })
  } }
  await api.readInventoryCheckProductsSimple(adapter, admin, query, { lowStock, check: { organizationId: 1, viewerId: 1, canSeeStaffIdentity: () => true } })
  return seen
}
// Every plan line that touches the two IC tables, or an index of them.
// Aliases i and s also name the stock tables in the stock ledger, so only a line naming an IC table or index, or a bare scan of i/s, counts.
const icLines = lines => lines.filter(line => /inventory_check_(items|sessions)/.test(line) || (/^SCAN (i|s)( |$)/.test(line) && !/idx_(branch|damaged)/.test(line)))
// The lookup rule: a product's items by the 0285 index (with the branch as an index term when scoped) and the session by its key; nothing reads sessions first or scans an IC table.
function explainsPinned(lines, scoped, label) {
  const ic = icLines(lines)
  const items = ic.filter(line => /^SEARCH i USING/.test(line)), sessions = ic.filter(line => /^SEARCH s USING/.test(line))
  assert.ok(items.length > 0, `${label}: no items search\n${lines.join('\n')}`)
  for (const line of items) {
    assert.ok(line.includes(scoped ? 'inventory_check_items_product_latest (product_id=? AND branch_id=?)' : 'inventory_check_items_product_latest (product_id=?)'), `${label}: items must be searched by the 0285 index${scoped ? ' with the branch' : ''}: ${line}\n${lines.join('\n')}`)
  }
  assert.equal(sessions.length, items.length, `${label}: one session lookup per items lookup\n${lines.join('\n')}`)
  for (const line of sessions) assert.ok(/SEARCH s USING (INTEGER PRIMARY KEY|INDEX sqlite_autoindex_inventory_check_sessions_1) \((rowid|id)=\?\)/.test(line), `${label}: session by key: ${line}`)
  assert.deepEqual(ic.filter(line => /^SCAN [is]\b/.test(line) || /sessions_recent|items_state|sqlite_autoindex_inventory_check_items/.test(line)), [], `${label}: no scan, no session-first walk, no session-keyed items index\n${lines.join('\n')}`)
  return items.length
}

const QUERIES = [
  // [query, branch scoped, expected item searches in the summary, in the page statement (grouping by checked adds the grouping lookup, lastCheckedSql)]
  [{ summary: '1' }, false, 1, 2], [{ branchId: '1' }, true, 1, 2], [{ branchId: '2', groupBy: 'checked' }, true, 1, 3], [{ query: 'a', stockState: 'low_stock' }, false, 1, 2],
]
const FILTERS = [['in_check', 1], ['ok', 2], ['issue', 2], ['not_checked', 2]] // [state, subqueries per cohort statement]

async function verify(api, label, { throwOnFirst = true } = {}) {
  for (const stats of [false, true]) {
    const { db } = buildWorld(4)
    if (stats) db.exec('ANALYZE') // scratch in-memory database only
    const mode = stats ? 'after ANALYZE' : 'with no statistics'
    for (const [query, scoped, summaryLookups, pageLookups] of QUERIES) {
      const statements = await record(api, db, query)
      const summary = statements.find(statement => statement.sql.includes('AS total_variants'))
      assert.ok(summary, 'the summary statement is sent on page 1')
      assert.equal(explainsPinned(plan(db, summary.sql, summary.params), scoped, `${label} summary ${JSON.stringify(query)} ${mode}`), summaryLookups, 'one search of the items in the summary (obs)')
      const page = statements.find(statement => statement.sql.includes('LIMIT 501') && statement.sql.includes('__page AS MATERIALIZED'))
      assert.equal(explainsPinned(plan(db, page.sql, page.params), scoped, `${label} page ${JSON.stringify(query)} ${mode}`), pageLookups, 'two searches of the items in the page rows (latest, open_check)')
    }
    for (const [state] of FILTERS) for (const branchId of [undefined, '1']) {
      const query = { checkState: state, summary: '0', ...(branchId ? { branchId } : {}) }
      for (const statement of await record(api, db, query)) {
        const lines = plan(db, statement.sql, statement.params)
        if (!icLines(lines).length) continue
        // The filter's own subqueries (cohort / count / page statements) plus, on the page statement, the two page CTEs.
        explainsPinned(lines, !!branchId, `${label} checkState=${state} ${branchId ? 'one branch' : 'all branches'} ${mode}`)
      }
    }
  }
}

async function main() {
  await check('the summary, page facts and checkState filters read items by the 0285 index and sessions by key (no statistics, then ANALYZE)', async () => {
    await verify(bundle('inventoryCheckProducts.ts'), 'real')
  })

  const MUTANTS = {
    // The old summary: sessions first, one probe of the items per cohort product.
    P1: ["FROM (SELECT DISTINCT id FROM cohort) c CROSS JOIN ${CHECK_ITEMS_SQL}\n      WHERE i.product_id=c.id AND", "FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id\n      WHERE i.product_id IN (SELECT id FROM cohort) AND"],
    // The pin dropped: the planner is free again (ANALYZE flips it to the session-keyed index).
    P2: ["const CHECK_ITEMS_SQL = 'inventory_check_items i INDEXED BY inventory_check_items_product_latest CROSS JOIN", "const CHECK_ITEMS_SQL = 'inventory_check_items i JOIN"],
    // The page rows: the old IN form.
    P3: ["FROM (SELECT DISTINCT id FROM __page) pg CROSS JOIN ${CHECK_ITEMS_SQL} LEFT JOIN users u ON u.id=i.updated_by\n    WHERE i.product_id=pg.id AND i.state IN ('done','issue')", "FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id LEFT JOIN users u ON u.id=i.updated_by\n    WHERE i.product_id IN (SELECT id FROM __page) AND i.state IN ('done','issue')"],
    // The branch text dropped from the index terms (the branch is then only a filter).
    P4: ["${branchScoped ? ' AND i.branch_id=@branchId' : ''}", "${branchScoped ? ' AND (@branchId IS NULL OR i.branch_id=@branchId)' : ''}"],
  }
  await check('plan mutants P1-P4 are each caught', async () => {
    const survived = []
    for (const [id, pair] of Object.entries(MUTANTS)) {
      const api = await bundleMutated('inventoryCheckProducts.ts', { 'inventoryCheckProducts.ts': [pair] })
      let caught = false
      try { await verify(api, id) } catch { caught = true }
      if (!caught) survived.push(id)
    }
    assert.deepEqual(survived, [], `plan mutants that survived: ${survived.join(', ')}`)
  })
  console.log(`${passed} passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
