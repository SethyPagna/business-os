import assert from 'node:assert/strict'
import { resolveNotificationTarget, RETIRED_PAGE_TARGETS } from '../src/utils/notificationTargets.ts'
import fs from 'node:fs'

// NOTIF-V2: every notification row links to the place it is about. This pins the resolver per kind,
// and -- the discriminating half -- that every page id it can produce is a real, reachable page.
// Before, most rows named retired page ids ('inventory', 'loyalty_points', 'backup', 'users') that
// AppContext.canAccessPage refuses, so a click closed the panel and went nowhere.

// The pages AppContext.canAccessPage knows: the keys of its PAGE_PERMISSIONS table.
const appContext = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const permissionsBlock = appContext.match(/const PAGE_PERMISSIONS: Record<string, string \| null> = \{([\s\S]*?)\r?\n\}/)
assert.ok(permissionsBlock, 'PAGE_PERMISSIONS table found')
const AdminPageIds = new Set([...permissionsBlock[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1]))
assert.ok(AdminPageIds.has('dashboard') && AdminPageIds.has('branches') && AdminPageIds.has('settings'), 'the table was parsed')
assert.ok(!AdminPageIds.has('inventory') && !AdminPageIds.has('loyalty_points') && !AdminPageIds.has('users'), 'control: the retired ids really are not pages')

const everyone = () => true
const noDashboard = (page: string) => page !== 'dashboard'

// --- stock: the Dashboard card that lists it
assert.deepEqual(
  resolveNotificationTarget({ kind: 'inventory_low_stock', pageId: 'dashboard', anchor: 'low-stock' }, 'dashboard', everyone),
  { page: 'dashboard', anchor: 'low-stock' },
  'low stock lands on the Dashboard Low stock card')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'inventory_out_of_stock', saleId: 12 }, 'dashboard', everyone),
  { page: 'dashboard', anchor: 'out-of-stock' },
  'out of stock lands on the Out of stock card even when the row also names its sale (the stock is what the row is about)')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'inventory_out_of_stock' }, 'dashboard', noDashboard),
  { page: 'branches', anchor: 'hub:branches:products', focus: { type: 'inventory-products', stockFilter: 'out' } },
  'someone who cannot open the Dashboard gets the Branches products list filtered to out of stock')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'inventory_low_stock' }, 'dashboard', noDashboard).focus,
  { type: 'inventory-products', stockFilter: 'low' })

// --- sales: the sale itself
assert.deepEqual(
  resolveNotificationTarget({ kind: 'sales_awaiting_payment', pageId: 'sales', saleId: 4411 }, 'sales', everyone),
  { page: 'sales', anchor: 'hub:sales:sales', focus: { type: 'sale', saleId: 4411 } })
assert.deepEqual(
  resolveNotificationTarget({ kind: 'sales_awaiting_delivery', saleId: '77' }, 'sales', everyone).focus,
  { type: 'sale', saleId: 77 }, 'a string id from JSON still resolves')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'sales_awaiting_delivery', saleId: 0 }, 'sales', everyone),
  { page: 'sales' }, 'a missing / zero sale id falls back to the Sales page, never to a bogus focus')

// --- imports: the report, not a page
assert.deepEqual(
  resolveNotificationTarget({ kind: 'import_warnings', pageId: 'dashboard', importJobId: 'job-9' }, 'imports', everyone),
  { page: 'dashboard', importJobId: 'job-9' })

// --- security, backup, loyalty, suppliers, products
assert.deepEqual(
  resolveNotificationTarget({ kind: 'security_device_new_country', pageId: 'settings', anchor: 'hub:settings:users' }, 'settings', everyone),
  { page: 'settings', anchor: 'hub:settings:users', focus: { type: 'users-devices' } })
assert.deepEqual(
  resolveNotificationTarget({ kind: 'security_device_pending', pageId: 'users', anchor: 'devices' }, 'users', everyone),
  { page: 'settings', anchor: 'hub:settings:users', focus: { type: 'users-devices' } }, 'a stale cached row naming the retired users page still lands on Devices')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'system_drive_sync_connect', pageId: 'settings', anchor: 'hub:settings:backup' }, 'settings', everyone),
  { page: 'settings', anchor: 'hub:settings:backup' })
assert.deepEqual(
  resolveNotificationTarget({ kind: 'loyalty_points_balance', pageId: 'promotions', anchor: 'hub:promotions:loyalty' }, 'promotions', everyone),
  { page: 'promotions', anchor: 'hub:promotions:loyalty' })
assert.deepEqual(
  resolveNotificationTarget({ kind: 'supplier_credit_overdue', pageId: 'contacts', anchor: 'hub:contacts:suppliers', search: 'Acme Co' }, 'contacts', everyone),
  { page: 'contacts', anchor: 'hub:contacts:suppliers', focus: { type: 'search', page: 'contacts', search: 'Acme Co', anchor: 'hub:contacts:suppliers' } },
  'the supplier is searched for, not just the list opened')
assert.deepEqual(
  resolveNotificationTarget({ kind: 'product_expiring', pageId: 'products', search: '  Day Cream ' }, 'products', everyone),
  { page: 'products', focus: { type: 'search', page: 'products', search: 'Day Cream' } })
assert.deepEqual(
  resolveNotificationTarget({ kind: 'portal_pending_review', pageId: 'catalog' }, 'portal', everyone),
  { page: 'catalog' })

// --- retired ids from a stale cached summary still land somewhere real
for (const [retired, expected] of Object.entries(RETIRED_PAGE_TARGETS)) {
  const target = resolveNotificationTarget({ kind: 'something_else', pageId: retired }, 'dashboard', everyone)
  assert.equal(target.page, expected.page, `${retired} -> ${expected.page}`)
  assert.equal(target.anchor, expected.anchor)
}
// ...and the section's page is used when the row names none; the Dashboard when nothing does.
assert.equal(resolveNotificationTarget({ kind: 'x' }, 'sales', everyone).page, 'sales')
assert.equal(resolveNotificationTarget({ kind: 'x' }, '', everyone).page, 'dashboard')

// --- every page id the resolver can emit is a page AppContext knows
const emitted = new Set<string>()
const kinds = ['inventory_out_of_stock', 'inventory_low_stock', 'sales_awaiting_payment', 'sales_awaiting_delivery', 'product_expired', 'product_expiring',
  'supplier_credit_overdue', 'supplier_credit_due', 'loyalty_points_balance', 'portal_pending_review', 'import_warnings', 'system_drive_sync_connect',
  'system_drive_sync_disabled', 'security_device_new_country', 'security_device_pending', 'import_job']
for (const kind of kinds) {
  for (const access of [everyone, noDashboard]) {
    emitted.add(resolveNotificationTarget({ kind, saleId: 3, search: 'x' }, 'dashboard', access).page)
    emitted.add(resolveNotificationTarget({ kind }, 'dashboard', access).page)
  }
}
for (const page of Object.values(RETIRED_PAGE_TARGETS)) emitted.add(page.page)
for (const page of emitted) assert.ok(AdminPageIds.has(page), `resolver emitted '${page}', which AppContext.canAccessPage would refuse`)

console.log('PASS notification targets resolve every kind to a real destination')
