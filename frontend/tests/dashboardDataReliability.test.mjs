import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.jsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
const methods = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')

assert.doesNotMatch(methods, /getDashboard[\s\S]{0,120}\(\)\s*=>\s*\(\{\}\)/, 'dashboard reads should not fall back to an empty object that looks like real data')
assert.doesNotMatch(methods, /getAnalytics[\s\S]{0,200}\(\)\s*=>\s*\(\{\}\)/, 'analytics reads should not fall back to an empty object that looks like real data')

assert.match(dashboard, /function isDashboardSummaryPayload/, 'dashboard should validate summary payloads before rendering them')
assert.match(dashboard, /function isDashboardAnalyticsPayload/, 'dashboard should validate analytics payloads before rendering them')
assert.doesNotMatch(dashboard, /setSummary\(\{\}\)/, 'dashboard should preserve the previous summary when refresh fails')
assert.match(dashboard, /const \[summaryError, setSummaryError\]/, 'dashboard should track summary load errors separately')
assert.match(dashboard, /const \[analyticsError, setAnalyticsError\]/, 'dashboard should track analytics load errors separately')
assert.match(dashboard, /Showing saved dashboard totals/, 'dashboard should explain when it is showing saved/stale totals')
assert.match(dashboard, /Analytics unavailable/, 'dashboard should distinguish analytics failures from genuine no-data states')
assert.doesNotMatch(dashboard, /PortalMenu/, 'dashboard detail rows should open directly without an extra menu step')
assert.match(dashboard, /setProductDetail\(\{ \.\.\.p, insightType: 'low_stock' \}\)/, 'dashboard low-stock rows should open direct item details')
assert.match(dashboard, /setProductDetail\(\{ \.\.\.p, insightType: 'out_of_stock' \}\)/, 'dashboard out-of-stock rows should open direct item details')
assert.match(dashboard, /openHourDetail\(h, i \+ 1\)/, 'dashboard best-hour rows should open a detail view')
assert.match(dashboard, /const openInventoryOverview = useCallback\(/, 'dashboard should expose a direct inventory follow-through action')
assert.match(dashboard, /DASHBOARD_INVENTORY_FOCUS_KEY/, 'dashboard should persist a focused inventory handoff when drilling into stock alerts')
assert.match(dashboard, /review_in_inventory', 'Review in inventory'/, 'dashboard preview-truncated stock cards should offer an explicit inventory review action')
assert.match(dashboard, /min-h-10 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold/, 'dashboard range controls should keep the larger tap target sizing')
assert.match(inventory, /sessionStorage\.getItem\(DASHBOARD_INVENTORY_FOCUS_KEY\)/, 'inventory should consume dashboard handoff focus when navigating from stock previews')
assert.match(inventory, /setInventorySection\('products'\)/, 'inventory dashboard handoff should reset the section to products')
assert.match(inventory, /setTab\('products'\)/, 'inventory dashboard handoff should reset the tab to products')

console.log('PASS dashboard data reliability guards')
