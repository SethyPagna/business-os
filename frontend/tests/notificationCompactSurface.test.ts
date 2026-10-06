import assert from 'node:assert/strict'
import fs from 'node:fs'

// NOTIF-V2 (owner 6 Oct 2026): stock notifications are SALE events, every row is one compact line with
// an icon by kind, repeats fold, and every row links to where it lives. This pins the wiring that the
// pure resolver/grouping tests cannot see, and the Worker <-> panel contract between the two packages.
const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
const panel = read('../src/components/shared/NotificationCenter.tsx')
const kinds = read('../src/components/shared/notificationKinds.ts')
const worker = read('../../cloudflare/src/routes/notifications.ts')
const dashboard = read('../src/components/dashboard/Dashboard.tsx')
const sales = read('../src/components/sales/Sales.tsx')
const users = read('../src/components/users/Users.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const flat = (text: string) => text.replace(/\r\n/g, '\n')

// --- the panel routes every click through the one resolver, and says so when a page is off limits
assert.match(panel, /resolveNotificationTarget\(item, section\.pageId, canAccessPage\)/)
assert.match(panel, /queueNotificationFocus\(target\.focus\)/)
assert.match(panel, /navigateTo\(target\.page, target\.anchor\)/)
assert.match(panel, /notify\(tr\('no_permission'/, 'a refused page is reported, not silently closed on')
assert.doesNotMatch(panel, /navigateTo\(item\.pageId \|\| section\.pageId \|\| 'dashboard', item\.anchor\)/, 'the old direct navigation (dead page ids) is gone')
assert.match(panel, /setReportJobId\(target\.importJobId\)/, 'an import row opens its report')
assert.match(flat(panel), /const next = \{ \.\.\.current, \[item\.id\]: Date\.now\(\) \}\n\s+writeSeenAlertTimes\(next\)/, 'a clicked row is stamped as read')
assert.match(panel, /setOpen\(false\)/)

// --- compact rows: kind icon, one scrolling line for the title and one for the meta, time via fmtDateTime24
assert.match(panel, /<NotificationKindIcon kind=\{item\.kind\}/)
assert.match(panel, /detail-scroll-text text-\[13px\]/)
assert.match(panel, /item\.at \? fmtDateTime24\(item\.at\) : ''/)
// Dates: the Worker hands over the stored DATE untouched; the panel formats it with the canonical helper.
assert.match(panel, /fmtDateOnly\(expiryDate\)/)
assert.match(panel, /fmtDateOnly\(dueDate\)/)
assert.doesNotMatch(worker, /formatDateDmy/, 'no private date formatter in the Worker bell')
assert.match(worker, /expiryDate: product\.expiry_date/)
assert.doesNotMatch(panel, /\$\{expiryDate\}|\n\s+dueDate,\n/, 'a raw stored date is never printed')
assert.doesNotMatch(panel, /function NotificationSeverityIcon/, 'the generic severity mark was replaced by the per-kind icon')
for (const kind of ['inventory_out_of_stock', 'inventory_low_stock', 'sales_awaiting_payment', 'sales_awaiting_delivery', 'product_expired', 'product_expiring',
  'supplier_credit_overdue', 'supplier_credit_due', 'loyalty_points_balance', 'portal_pending_review', 'import_warnings', 'import_job',
  'system_drive_sync_connect', 'system_drive_sync_disabled', 'security_device_new_country', 'security_device_pending']) {
  assert.match(kinds, new RegExp(`\\b${kind}:`), `${kind} has an icon`)
}

// --- grouping: folded unless someone is searching/filtering
assert.match(panel, /groupNotificationItems\(section\.items, groupingMin\)/)
assert.match(panel, /normalizedNotificationSearch \|\| toneFilter !== 'all' \? Number\.POSITIVE_INFINITY : NOTIFICATION_GROUP_MIN/)

// --- the client-composed imports section no longer shares the Worker's 'imports' id
assert.match(panel, /id: 'import_jobs'/)
assert.doesNotMatch(panel, /setImportJobsSection\(\{\s*id: 'imports'/)

// --- the standing "every product under its threshold" listing is gone from the Worker
assert.doesNotMatch(worker, /buildInventorySection|INVENTORY_PREVIEW_ITEMS|INVENTORY_FULL_ITEMS/, 'the old always-on listing path is removed')
assert.doesNotMatch(worker, /FROM products\s+WHERE is_active = 1\s+AND \(COALESCE\(stock_quantity, 0\) <=/, 'no product-under-threshold query remains in the bell')
assert.match(worker, /stockAlertFeedSql\(config\)/)
assert.match(worker, /function canSeeStockAlerts\(user: SessionUser\): boolean \{\s*return hasPermission\(user, 'dashboard'\) \|\| hasPermission\(user, 'inventory'\)/)
assert.match(worker, /includeSale/, 'receipt numbers follow the sales read rule')
// the old per-row copy for rows the Worker never labelled is gone too
assert.doesNotMatch(panel, /notification_inventory_out_of_stock|notification_inventory_low_stock/)

// --- Worker contract: the anchors it sends are the ones the Dashboard answers, and every metaKey it sends has copy
const dashboardAnchors = { low: /DASHBOARD_LOW_STOCK_ANCHOR/, out: /DASHBOARD_OUT_OF_STOCK_ANCHOR/ }
assert.match(worker, /anchor: out \? 'out-of-stock' : 'low-stock'/)
assert.match(dashboard, dashboardAnchors.low)
assert.match(dashboard, dashboardAnchors.out)
assert.match(dashboard, /ref=\{lowStockCardRef\} id="dashboard-low-stock"/)
assert.match(dashboard, /ref=\{outOfStockCardRef\} id="dashboard-out-of-stock"/)
assert.match(dashboard, /setMobileSection\('inventory'\)/, 'a phone unhides the group the cards live in')
assert.match(dashboard, /addEventListener\(APP_NAVIGATION_EVENT, onNavigate\)/, 'an already-mounted Dashboard hears the link')
const workerMetaKeys = [...new Set([...worker.matchAll(/metaKey: (?:'([a-z_]+)'|[^'\n]*\? '([a-z_]+)' : '([a-z_]+)')/g)].flatMap((match) => match.slice(1).filter(Boolean)))]
assert.ok(workerMetaKeys.length >= 14, `the Worker sends structured meta for its kinds (found ${workerMetaKeys.length})`)
for (const key of workerMetaKeys) {
  assert.match(panel, new RegExp(`(?:\\b${key}:|ITEM_META_COPY\\.${key} =)`), `the panel has copy for the Worker's metaKey ${key}`)
}

// --- destinations answer the hand-offs the panel queues
assert.match(sales, /SALE_FOCUS_KEY/)
assert.match(sales, /addEventListener\(SALE_FOCUS_EVENT, openQueuedSale\)/)
assert.match(sales, /readAuthoritativeSale\(saleId\)\.then\(\(sale\) => \{ if \(sale && aliveRef\.current\) openSaleDetail\(sale\) \}\)/)
assert.match(users, /takeQueuedFocus<\{ tab\?: string \}>\(USERS_FOCUS_KEY\)\?\.tab === 'devices'/)

// --- both packs carry every new string, translated (no English placeholder in km), same {slots}
const newKeys = [
  'notification_left', 'notification_credit_due', 'notification_credit_overdue', 'notification_drive_sync_off',
  'notification_kind_credit_due', 'notification_kind_credit_overdue', 'notification_supplier_credit_title',
]
for (const key of newKeys) {
  assert.ok(en[key], `en.json has ${key}`)
  assert.ok(km[key], `km.json has ${key}`)
  assert.notEqual(km[key], en[key], `${key} is translated in km.json, not an English copy`)
  assert.match(km[key], /[ក-៿]/, `${key} is Khmer script`)
  assert.deepEqual(en[key].match(/\{[a-z]+\}/g) || [], km[key].match(/\{[a-z]+\}/g) || [], `${key} keeps the same slots in both packs`)
}
// every pack key the kind table and the meta copy read resolves in both packs
const referencedPackKeys = new Set<string>()
for (const match of kinds.matchAll(/\['([a-z_A-Z]+)', '/g)) referencedPackKeys.add(match[1])
for (const match of panel.matchAll(/packWord\(t, '([a-z_A-Z]+)'/g)) referencedPackKeys.add(match[1])
for (const key of referencedPackKeys) {
  assert.ok(en[key] !== undefined, `en.json resolves ${key}`)
  assert.ok(km[key] !== undefined, `km.json resolves ${key}`)
}
assert.match(en.notification_inventory_alerts_desc, /Sales that take a product to low stock or out of stock/, 'the Settings blurb describes the new behaviour')
assert.match(km.notification_inventory_alerts_desc, /[ក-៿]/)

console.log('PASS notification panel is compact, event-driven for stock, and linked to real destinations')
