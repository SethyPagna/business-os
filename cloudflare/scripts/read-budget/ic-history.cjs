'use strict'
// The grouped Inventory Check shapes need inventory-check history to mean anything: the grouped read looks up each product's newest done/issue item, and the shared seed has none.
// Adding history to the shared seed would move every existing shape's rows, so these shapes run in their own pass (runHistoryPass) on a world that gets a deterministic history
// after boot. The shapes are budgeted in budgets.json like any other; each is measured next to its name-order twin on the same world (the control).
//
// History (I_SEED = 3,020 item rows): 30 days x 2 branches = 60 sessions of 50 lines. A line is done, except every 10th (issue, reason 'short'). The newest session of branch 1 is open
// and its last 10 lines are unstarted. Products are spread over the catalogue so no two lines of one session share a product.
const { slug } = require('./shapes.cjs')

const DAYS = 30
const LINES = 50
const I_SEED = DAYS * 2 * LINES + 20 // + the 20 unstarted lines of the session ensureCheckId opens

async function seedIcHistory(world, ctx) {
  const run = (sql, ...values) => world.db.prepare(sql).bind(...values).run()
  // session k: day = k / 2 (0 = the anchor day), branch = 1 + k % 2; newest first.
  await run(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${DAYS * 2 - 1})
    INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
    SELECT 'hist-'||k, ?, 1 + k%2, 901, 'History '||k, CASE WHEN k = 0 THEN 'open' ELSE 'closed' END, 0, '{}',
      strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k/2)||' days', '-4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k/2)||' days'), CASE WHEN k = 0 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k/2)||' days') END
    FROM s`, world.orgId, ctx.anchor, ctx.anchor, ctx.anchor)
  const U = LINES - 10 // lines of the open session from here on are unstarted
  await run(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < ${DAYS * 2 * LINES - 1}), m AS (SELECT x / ${LINES} AS k, x % ${LINES} AS j FROM n)
    INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
    SELECT 'hist-'||k, 1000 + ((k * 211 + j * 37) % 8650), 1 + k%2, '{}', 5, '{}',
      CASE WHEN k = 0 AND j >= ${U} THEN 'unstarted' WHEN j % 10 = 0 THEN 'issue' ELSE 'done' END,
      CASE WHEN k = 0 AND j >= ${U} THEN NULL WHEN j % 10 = 0 THEN 1 ELSE 5 END,
      CASE WHEN (k > 0 OR j < ${U}) AND j % 10 = 0 THEN 'short' END, 1, 901,
      CASE WHEN k = 0 AND j >= ${U} THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k/2)||' days', '+'||j||' minutes') END
    FROM m`, ctx.anchor)
}

// One entry per shape: [label, url, the name-order request it is measured against (its control)].
function historyEntries({ lastPage = 1, lastPageName = 1 } = {}) {
  const B = '/api/inventory-checks/products?branchId=1'
  const name = 'sortBy=name&sortDirection=asc'
  return [
    ['inventory-checks/products ic_simple grouped checked', `${B}&groupBy=checked&page=1&pageSize=20`, `${B}&${name}&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped checked page step', `${B}&groupBy=checked&page=2&pageSize=20&summary=0`, `${B}&${name}&page=2&pageSize=20&summary=0`],
    ['inventory-checks/products ic_simple grouped checked last page', `${B}&groupBy=checked&page=${lastPage}&pageSize=20&summary=0`, `${B}&${name}&page=${lastPageName}&pageSize=20&summary=0`],
    ['inventory-checks/products ic_simple grouped checked search', `${B}&groupBy=checked&query=serum&page=1&pageSize=20`, `${B}&query=serum&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped checked low stock', `${B}&groupBy=checked&stockState=low_stock&page=1&pageSize=20`, `${B}&stockState=low_stock&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped checked issues', `${B}&groupBy=checked&checkState=issue&page=1&pageSize=20`, `${B}&checkState=issue&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped checked all branches', '/api/inventory-checks/products?groupBy=checked&page=1&pageSize=20', `/api/inventory-checks/products?${name}&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped category', `${B}&groupBy=category&page=1&pageSize=20`, `${B}&${name}&page=1&pageSize=20`],
    ['inventory-checks/products ic_simple grouped category page 2', `${B}&groupBy=category&page=2&pageSize=20&summary=0`, `${B}&${name}&page=2&pageSize=20&summary=0`],
    // The wired list (ic_wired), measured against its own name twin (the Products reader in name order) on the same world.
    ...wiredEntries(),
  ]
}

function wiredEntries() {
  const L = '/api/inventory-checks/list?branchId=1'
  const twin = 'sortBy=name'
  return [
    ['inventory-checks/list wired grouped checked', `${L}&groupBy=checked&page=1&pageSize=20`, `${L}&${twin}&page=1&pageSize=20`, 'ic_wired'],
    ['inventory-checks/list wired grouped checked page step', `${L}&groupBy=checked&page=2&pageSize=20&summary=0`, `${L}&${twin}&page=2&pageSize=20&summary=0`, 'ic_wired'],
    ['inventory-checks/list wired grouped checked search', `${L}&groupBy=checked&query=serum&page=1&pageSize=20`, `${L}&${twin}&query=serum&page=1&pageSize=20`, 'ic_wired'],
    ['inventory-checks/list wired grouped checked low stock', `${L}&groupBy=checked&stockState=low_stock&page=1&pageSize=20`, `${L}&${twin}&stockState=low_stock&page=1&pageSize=20`, 'ic_wired'],
    ['inventory-checks/list wired grouped checked issues', `${L}&groupBy=checked&checkState=issue&page=1&pageSize=20`, `${L}&${twin}&checkState=issue&page=1&pageSize=20`, 'ic_wired'],
    ['inventory-checks/list wired grouped category', `${L}&groupBy=category&page=1&pageSize=20`, `${L}&${twin}&page=1&pageSize=20`, 'ic_wired'],
  ]
}

// Shapes in the getShapes() form ({ id, kind, method, label, url, switches }) plus `control` (the same request in name order, on the same world).
function getHistoryShapes(opts) {
  return historyEntries(opts).map(([label, url, control, sw]) => ({ id: slug(label), kind: 'get', method: 'GET', label, url, anon: false, longRange: false, switches: [sw || 'ic_simple'], control }))
}

module.exports = { seedIcHistory, getHistoryShapes, I_SEED, DAYS, LINES }
