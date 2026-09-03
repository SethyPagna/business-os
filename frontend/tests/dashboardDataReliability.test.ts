import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const branchesHub = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const methods = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const transport = fs.readFileSync(new URL('../src/api/dashboardTransport.ts', import.meta.url), 'utf8')
const compat = fs.readFileSync(new URL('../../cloudflare/src/routes/compat.ts', import.meta.url), 'utf8')

assert.doesNotMatch(methods, /getDashboard[\s\S]{0,120}\(\)\s*=>\s*\(\{\}\)/, 'dashboard reads should not fall back to an empty object that looks like real data')
assert.doesNotMatch(methods, /getAnalytics[\s\S]{0,200}\(\)\s*=>\s*\(\{\}\)/, 'analytics reads should not fall back to an empty object that looks like real data')

assert.match(dashboard, /function isDashboardSummaryPayload/, 'dashboard should validate summary payloads before rendering them')
assert.match(dashboard, /function isDashboardAnalyticsPayload/, 'dashboard should validate analytics payloads before rendering them')
assert.match(dashboard, /Number\.isFinite\(Number\(totals\?\.revenue_usd\)\)/, 'analytics validation must reject an empty totals object that would render as fake zero revenue')
assert.match(dashboard, /Number\.isFinite\(Number\(totals\?\.tx_count\)\)/, 'analytics validation must use the tx_count field returned by the analytics API')
assert.doesNotMatch(dashboard, /totals\?\.transaction_count/, 'analytics validation must not require the nonexistent transaction_count field')
assert.match(dashboard, /if \(!isDashboardAnalyticsPayload\(data\)\)[\s\S]{0,220}normalizeDashboardAnalyticsPayload\(data\)/, 'dashboard must validate the raw response before filling defaults')
assert.doesNotMatch(dashboard, /setSummary\(\{\}\)/, 'dashboard should preserve the previous summary when refresh fails')
assert.match(dashboard, /const \[summaryError, setSummaryError\]/, 'dashboard should track summary load errors separately')
assert.match(dashboard, /const \[analyticsError, setAnalyticsError\]/, 'dashboard should track analytics load errors separately')
assert.match(dashboard, /Showing saved dashboard totals/, 'dashboard should explain when it is showing saved/stale totals')
assert.match(dashboard, /Analytics unavailable/, 'dashboard should distinguish analytics failures from genuine no-data states')
assert.doesNotMatch(dashboard, /PortalMenu/, 'dashboard detail rows should open directly without an extra menu step')
assert.match(dashboard, /setProductDetail\(\{ \.\.\.p, insightType: 'low_stock' \}\)/, 'dashboard low-stock rows should open direct item details')
assert.match(dashboard, /setProductDetail\(\{ \.\.\.p, insightType: 'out_of_stock' \}\)/, 'dashboard out-of-stock rows should open direct item details')
// Re-anchored to the LIVE BestHourCard wiring: the old `openHourDetail(h,
// i + 1)` string lived only inside a dead `className="hidden"` copy of the
// section, which is now deleted (the pin was passing on zombie markup).
assert.match(dashboard, /onOpenHour=\{openHourDetail\}/, 'dashboard best-hour card should be wired to the hour detail view')
assert.match(dashboard, /onOpenHour\(hour, index \+ 1\)/, 'dashboard best-hour rows should open a detail view')
assert.match(dashboard, /const openInventoryOverview = useCallback\(/, 'dashboard should expose a direct inventory follow-through action')
assert.match(dashboard, /DASHBOARD_INVENTORY_FOCUS_KEY/, 'dashboard should persist a focused inventory handoff when drilling into stock alerts')
assert.match(dashboard, /review_in_inventory', 'Review in inventory'/, 'dashboard preview-truncated stock cards should offer an explicit inventory review action')
assert.match(dashboard, /triggerClassName="flex w-full min-w-0 items-center justify-center gap-1\.5 rounded-lg px-2 py-1 !min-h-9 sm:px-3"/, 'dashboard date picker should stay compact on mobile')
assert.match(dashboard, /min-h-7[^"]*px-2\.5 py-1 text-\[11px\] font-semibold/, 'dashboard export control should stay compact on mobile')
assert.doesNotMatch(dashboard, /RANGE_PRESETS/, 'dashboard should not restore the removed preset-chip controls')
// The dashboard's default window is TODAY -- the business day, exactly like
// the list pages (user, 2026-09-03) -- and it governs the FLOW cards only.
assert.doesNotMatch(dashboard, /offsetDate\(-6\)/, 'dashboard must not default to a rolling seven-day window')
assert.match(dashboard, /getDashboard\(\{ startDate: start, endDate: end, granularity \}\)/, 'summary refresh must receive the same range as analytics')
assert.match(transport, /appendQuery\('\/api\/dashboard', query\)/, 'dashboard summary transport must forward range parameters')
assert.match(compat, /startDate: String\(query\.startDate \|\| today\)/, 'the dashboard API fallback range must be today as well')
assert.match(compat, /async function dashboardSummary\(env: Env, query: Record<string, string>\)/, 'dashboard summary must accept the selected range')
// The selected range scopes the sales/returns tiles and the recent-sales
// feed. It must NOT scope the inventory alert cards: a product that is out of
// stock cannot sell, so restricting them to "products sold in the range"
// emptied the out-of-stock alert exactly when it mattered. See
// cloudflare/scripts/test-compat-dashboard-daterange-pure.cjs for the
// behavioral proof against real sqlite.
assert.doesNotMatch(compat, /productInRangeClause/, 'inventory alert cards must not be scoped to products sold in the selected range')
assert.match(compat, /whereSql: 'WHERE p\.is_active = 1',/, 'dashboard stock stats must stay catalog-wide so the card badges match their lists')
assert.match(dashboard, /getDashboardSaleItemCount/, 'dashboard sale details should expose a total item count')
assert.match(dashboard, /t\('cashier'\)[\s\S]{0,220}getDashboardSaleItemCount\(recentSaleDetail\)/, 'dashboard sale details should include Cashier and Items')
assert.match(dashboard, /modal-scroll grid grid-cols-2 gap-2 p-4/, 'dashboard sale details should use compact two-per-row facts')
assert.ok((dashboard.match(/compact-analytics-legend/g) || []).length >= 2, 'three-item analytics legends should stay compact on one row')
assert.doesNotMatch(dashboard, /getBusinessTimezoneOffsetHours/, 'business-hour analytics must not apply the UTC+7 offset twice')
assert.match(dashboard, /summary\?\.expiring_count/, 'expiry preview badge should show the complete backend count, not the ten-row preview length')
assert.match(dashboard, /createPortal\([\s\S]*recentSaleDetail[\s\S]*document\.body/, 'dashboard sale details should portal above the page layer')
// Aug 31 2026: the Branches hub's Products slice was removed as redundant
// with the Products page, so the handoff chain is now: Dashboard writes the
// inventory-focus key -> BranchesHubPage consumes it and FORWARDS a
// 'products' drill to the Products page (carrying the stock filter) via the
// products-focus key -> Products.tsx consumes that and applies the filter.
assert.match(branchesHub, /sessionStorage\.getItem\(DASHBOARD_INVENTORY_FOCUS_KEY\)/, 'the Branches hub should consume the dashboard stock-drill handoff')
assert.match(branchesHub, /bos:dashboard:products-focus/, 'the Branches hub should forward a products drill to the Products page')
assert.match(branchesHub, /navigateTo\('products'\)/, 'the Branches hub should navigate the forwarded drill to the Products page')
assert.match(products, /bos:dashboard:products-focus/, 'the Products page should consume the forwarded dashboard stock drill')
assert.match(products, /setStockFilter\(stockState\)/, 'the Products page should apply the forwarded stock filter')

console.log('PASS dashboard data reliability guards')
