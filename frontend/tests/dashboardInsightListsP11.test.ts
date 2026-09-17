import assert from 'node:assert/strict'
import fs from 'node:fs'

// P11-16: "view more for all the cards except for the low stock items and
// out of stock did not actually view more. seems limited."
//
// Every "View more" float except low-stock/out-of-stock replayed the SAME
// already-truncated preview array (backend LIMIT 10/20) the card itself
// received, instead of fetching the real full list. A new
// /dashboard/insight-list endpoint and getDashboardInsightList() give the
// other four cards (recent sales, expiring products, top products/qty, top
// customers) a genuine full-list read, same as the stock-alert cards.
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const transport = fs.readFileSync(new URL('../src/api/dashboardTransport.ts', import.meta.url), 'utf8')
const compat = fs.readFileSync(new URL('../../cloudflare/src/routes/compat.ts', import.meta.url), 'utf8')

assert.match(transport, /export async function getDashboardInsightList\(/, 'the transport exposes a real full-list fetch')
assert.match(compat, /app\.get\('\/dashboard\/insight-list'/, 'the Worker exposes the insight-list route')
assert.match(compat, /async function dashboardInsightList\(/, 'the Worker computes the full list server-side')

// Each of the four previously-fake "View more" cards now triggers a real
// fetch when its float opens, keyed to the SAME kind the backend expects.
const insightOpenSites: Array<[string, RegExp]> = [
  ['recent sales', /setRecentSalesOpen\(true\); void loadInsightList\('recent_sales'\)/],
  ['top products', /setTopProductsListOpen\(true\); void loadInsightList\(topMode === 'qty' \? 'top_products_qty' : 'top_products'\)/],
  ['top customers', /setTopCustomersListOpen\(true\); void loadInsightList\('top_customers'\)/],
  ['expiring products', /setExpiryAlertsListOpen\(true\); void loadInsightList\('expiring_products'\)/],
]
for (const [name, pattern] of insightOpenSites) {
  assert.match(dashboard, pattern, `opening the ${name} float triggers a real full-list fetch`)
}

// The four floats render from the fetched insight state (DashboardInsightListBody),
// not directly from the truncated summary/analytics arrays they used to replay.
assert.match(dashboard, /function DashboardInsightListBody</, 'a shared real-list body component exists')
const insightBodyUses = [...dashboard.matchAll(/state=\{insightLists(?:\.\w+|\[[^\]]+\])\}/g)].length
assert.ok(insightBodyUses >= 4, `at least 4 floats render from insightLists (found ${insightBodyUses})`)

// Low-stock/out-of-stock and branch performance/best-hour already had a real
// full-list source before this change (paginated stock-alert endpoint;
// byBranch/hourlyDist are not backend-truncated) -- they are deliberately
// left alone, not silently dropped from the fix.
assert.match(dashboard, /getDashboardStockAlerts/, 'low/out-of-stock keep their existing real pagination')
assert.doesNotMatch(dashboard, /loadInsightList\('branch_performance'\)/, 'branch performance is not backend-truncated and needs no insight-list fetch')
assert.doesNotMatch(dashboard, /loadInsightList\('best_hour'\)/, 'best hour is bounded to <=24 rows already and needs no insight-list fetch')

console.log('PASS dashboard "View more" floats fetch the real full list (P11-16)')
