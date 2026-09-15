import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P6-7: owner screenshots showed a misaligned "red line" under every card row
// on the admin Dashboard -- a short card's bottom border stopped short of a
// tall sibling's (Sales vs Analytics, and the two other card rows). Root
// cause was `items-start` on the grid rows, which lets each card size to its
// own content instead of stretching to match the row. Pin the fix (grid rows
// use CSS grid's default stretch, not items-start) and the reused "View
// more" float pattern that lets an over-height card's full list still be
// seen comfortably (owner: "do like sale ... click on view to open a float
// to show even more").
const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')

// The three card grid rows (Analytics+Sales; Best Hour/Top Products/Top
// Customers; Expiry/Low Stock/Out of Stock/Branch/Imports/Payment) all
// stretch their cards to one shared row height instead of leaving each card
// at its own intrinsic height.
const gridRows = [...dashboard.matchAll(/<div className="grid grid-cols-1[^"]*">/g)].map((m) => m[0])
assert.ok(gridRows.length >= 3, 'the dashboard renders its three card grid rows')
for (const row of gridRows) {
  assert.doesNotMatch(row, /items-start/, `card grid row does not opt out of stretch: ${row}`)
}

// The Analytics card (lg:col-span-2) is a flex column so it can share the
// row's stretched height with its RecentSalesCard sibling instead of being
// treated as plain block content.
assert.match(
  dashboard,
  /<div className="lg:col-span-2 card flex flex-col p-3 sm:p-3\.5">/,
  'the Analytics card is a flex column that can stretch to match its row',
)

// One shared modal shell is reused by every card's "View more" float instead
// of each pasting its own header/close/backdrop markup (no second modal
// system).
assert.match(dashboard, /function DashboardListModal\(/, 'a single reusable list-float component exists')
const dashboardListModalUses = [...dashboard.matchAll(/<DashboardListModal\b/g)].length
assert.ok(dashboardListModalUses >= 6, `DashboardListModal is reused by multiple cards (found ${dashboardListModalUses})`)

// One shared "View more" footer helper, gated the same way the pre-existing
// Sales card already was (more than 5 entries), pinned to the stretched
// card's bottom edge.
assert.match(dashboard, /function DashboardViewMoreFooter\(/, 'a single reusable View-more footer component exists')
assert.match(dashboard, /className="relative z-10 mt-auto border-t/, 'the View-more footer pins to the bottom of a stretched card')

const viewMoreCards = [
  { name: 'Sales', pattern: /<DashboardViewMoreFooter show=\{sales\.length > 5\}/ },
  { name: 'Top Products', pattern: /<DashboardViewMoreFooter show=\{topList\.length > 5\}/ },
  { name: 'Top Customers', pattern: /<DashboardViewMoreFooter show=\{customers\.length > 5\}/ },
  { name: 'Branch Performance', pattern: /<DashboardViewMoreFooter show=\{all\.length > 5\}/ },
  { name: 'Expiry Alerts', pattern: /<DashboardViewMoreFooter show=\{items\.length > 5\}/ },
  { name: 'Best Hour', pattern: /<DashboardViewMoreFooter show=\{busyHours\.length > 5\}/ },
  { name: 'Recent Imports', pattern: /<DashboardViewMoreFooter show=\{recentImportFiles\.length > 5\}/ },
]
for (const { name, pattern } of viewMoreCards) {
  assert.match(dashboard, pattern, `${name} card gets a View-more float once it exceeds the compact row threshold`)
}

// P6-8: the mobile Sales card's last metadata row (Shop/branch, status,
// payment method, item count) scrolls horizontally on small screens using
// the exact same utility classes as the sibling metadata rows above it, so
// it is reachable instead of clipped.
const salesListSurface = readFileSync(new URL('../src/components/sales/SalesListSurface.tsx', import.meta.url), 'utf8')
const scrollUtilityClasses = 'flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
assert.match(
  salesListSurface,
  /data-sales-card-primary-meta="" className="mb-1 flex min-w-0 flex-nowrap items-center gap-x-1\.5 overflow-x-auto overscroll-x-contain whitespace-nowrap[\s\S]{0,80}\[&::-webkit-scrollbar\]:hidden"/,
  'the first mobile sale card meta row scrolls horizontally',
)
assert.match(
  salesListSurface,
  new RegExp(`data-sales-card-status-meta="" className="mt-1 ${scrollUtilityClasses.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
  'the last mobile sale card row (Shop/status/payment/item count) uses the identical scroll utility classes as the sibling meta rows',
)

console.log('PASS dashboard card row alignment, view-more floats, and sales last-row scroll (P6-7/P6-8)')
