'use strict'
// The shapes the gate measures: one entry per GET the frontend or a report can send (the endpoint-reads sweep of 1 Nov 2026
// plus the Inventory Check name, search, stock-sort and Issues pages), and the write shapes the Free plan has to carry.
// Each shape is { id, kind, method, label, url | request(world) | run(world, send), anon?, longRange? }.
// {{stockKey}} and {{checkId}} are resolved against the seeded world just before the measured request.
const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90)

function getEntries(ctx) {
  const T = ctx.today, M = ctx.month, W = ctx.week, Y = ctx.year
  const R = (s, e) => `startDate=${s}&endDate=${e}`
  const P = 'page=1&pageSize=50'
  return [
    // auth / bootstrap
    ['auth/me', '/api/auth/me'], ['auth/bootstrap', '/api/auth/bootstrap'], ['auth/verification-capabilities', '/api/auth/verification-capabilities'],
    ['auth/otp/status/:id', '/api/auth/otp/status/x'], ['auth/devices/sessions', '/api/auth/devices/sessions'], ['auth/devices/pending', '/api/auth/devices/pending'], ['auth/devices', '/api/auth/devices'],
    ['organizations/bootstrap', '/api/organizations/bootstrap'], ['organizations/search', '/api/organizations/search?q=budget'], ['organizations/current', '/api/organizations/current'],
    ['system/bootstrap', '/api/system/bootstrap'], ['system/config', '/api/system/config'], ['runtime/version', '/api/runtime/version'], ['runtime/cron-health', '/api/runtime/cron-health'],
    ['runtime/catalog-integrity (catalog stock diagnostics)', '/api/runtime/catalog-integrity'], ['sync/owner', '/api/sync/owner'],
    // settings
    ['settings', '/api/settings'], ['settings/meta', '/api/settings/meta'], ['settings/payment-methods/unregistered', '/api/settings/payment-methods/unregistered'],
    ['settings/payment-methods/impact', '/api/settings/payment-methods/impact?from=Cash&to=ABA'], ['pos/address-presets', '/api/pos/address-presets'], ['telegram/status', '/api/telegram/status'],
    // products
    ['products/search Products default (created_desc, 50, branch_stock,images,batches,tagged_lots)', `/api/products/search?${P}&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products text "serum"', `/api/products/search?${P}&query=serum&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products text "product 12"', `/api/products/search?${P}&query=product%2012&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products barcode', `/api/products/search?${P}&query=8850000001234&searchMode=smart&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products category filter', `/api/products/search?${P}&category=Category%203&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products brand filter', `/api/products/search?${P}&brand=Brand%207&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products supplier filter', `/api/products/search?${P}&supplier=Supplier%209&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search Products branch 1 low stock', `/api/products/search?${P}&branchId=1&stockState=low&sort=created_desc&include=branch_stock,images,batches,tagged_lots`],
    ['products/search POS page (name_asc, family, metadata=0)', `/api/products/search?page=1&pageSize=48&sort=name_asc&include=branch_stock,images,family&metadata=0&surface=pos&branchId=1`],
    ['products/search POS text', `/api/products/search?page=1&pageSize=48&query=cream&sort=name_asc&include=branch_stock,images,family&metadata=0&surface=pos&branchId=1`],
    ['products/search Promotions discounted', '/api/products/search?promo=discounted&pageSize=100'],
    ['products/search by ids (after-write refetch)', '/api/products/search?page=1&pageSize=3&ids=1000,1001,1002&include=branch_stock,images,batches'],
    ['products/bootstrap POS first load', `/api/products/bootstrap?page=1&pageSize=48&sort=name_asc&include=branch_stock,images,family&metadata=0&surface=pos&branchId=1`],
    ['products/search-index', '/api/products/search-index'], ['products (legacy list)', `/api/products?${P}`],
    ['products/filters (facets: category/brand/supplier lists)', '/api/products/filters'], ['products/filters POS scoped', '/api/products/filters?branchId=1&surface=pos'],
    ['products/:id/detail-report 30d', `/api/products/1000/detail-report?${R(M, T)}`], ['products/:id/detail-report all', '/api/products/1000/detail-report'],
    ['products/:id/sales-detail', `/api/products/1000/sales-detail?mode=month&period=${T.slice(0, 7)}`], ['products/:id/supplier-purchases', '/api/products/1000/supplier-purchases?supplierKey=id:1'],
    ['products/:id/cost-breakdown', '/api/products/1000/cost-breakdown'],
    ['products/stock-in-sessions', `/api/products/stock-in-sessions?${P}`], ['products/stock-in-session-lines', `/api/products/stock-in-session-lines?key={{stockKey}}`],
    ['products/stock-ledger', `/api/products/stock-ledger?${P}&${R(M, T)}`], ['products/stock-ledger/:id/balance', '/api/products/stock-ledger/1/balance'],
    ['products/auto-merges/:productId', '/api/products/auto-merges/1000'], ['products/rename-impact', '/api/products/rename-impact?name=Product%200%20Serum'],
    ['products/bulk-delete-jobs/:id', '/api/products/bulk-delete-jobs/1'], ['products/merge-duplicates/preview', '/api/products/merge-duplicates/preview'],
    ['products/possible-duplicates (Conflicts)', '/api/products/possible-duplicates'], ['products/data-gaps/counts (Conflicts badges)', '/api/products/data-gaps/counts'],
    ['products/data-gaps', `/api/products/data-gaps?${P}`], ['products/possible-duplicates/merge-batch/reviews/:id', '/api/products/possible-duplicates/merge-batch/reviews/1'],
    ['products/possible-duplicates/merge-preview', '/api/products/possible-duplicates/merge-preview?ids=1000,1001'],
    ['products/zero-quantity-candidates', '/api/products/zero-quantity-candidates'], ['products/lookups/usage', '/api/products/lookups/usage?type=brand&value=Brand%201'],
    ['categories', '/api/categories'], ['units', '/api/units'],
    // batches
    ['batches/picker-lots', '/api/batches/picker-lots?productId=1000&branchId=1'], ['batches/tracked-product-ids (active-or-stock batch catalog)', '/api/batches/tracked-product-ids'],
    ['batches/damaged-lots', '/api/batches/damaged-lots'], ['batches', '/api/batches?productId=1000'],
    // inventory
    ['inventory/products/search default', `/api/inventory/products/search?${P}&sort=name_asc&include=branch_stock`], ['inventory/products/search text', `/api/inventory/products/search?${P}&query=balm`],
    ['inventory/bootstrap', '/api/inventory/bootstrap'], ['inventory/summary', '/api/inventory/summary'], ['inventory/stats', '/api/inventory/stats'],
    ['inventory/movements default', `/api/inventory/movements?${P}`], ['inventory/movements 30d', `/api/inventory/movements?${P}&${R(M, T)}`], ['inventory/movements search', `/api/inventory/movements?${P}&search=product`],
    ['inventory/movements/:id/balance', '/api/inventory/movements/1/balance'], ['inventory/reasons', '/api/inventory/reasons'], ['inventory/reasons/impact', '/api/inventory/reasons/impact?reason=seed'],
    ['inventory/tagged-lots', '/api/inventory/tagged-lots'], ['inventory/rfid/status', '/api/inventory/rfid/status'], ['inventory/rfid/tags/search', '/api/inventory/rfid/tags/search?q=x'],
    ['inventory/rfid/sessions/:id/review', '/api/inventory/rfid/sessions/1/review'], ['transfers', `/api/transfers?${P}`],
    // inventory checks
    ['inventory-checks/products all-time name page (Check default)', `/api/inventory-checks/products?branchId=1&sortBy=name&sortDirection=asc&page=1&pageSize=20`],
    ['inventory-checks/products 30d name page', `/api/inventory-checks/products?branchId=1&sortBy=name&sortDirection=asc&page=1&pageSize=20&${R(M, T)}`],
    ['inventory-checks/products all-time stock sort', `/api/inventory-checks/products?branchId=1&sortBy=stock&sortDirection=desc&page=1&pageSize=20`],
    ['inventory-checks/products all-time + customer ranking', `/api/inventory-checks/products?branchId=1&sortBy=name&sortDirection=asc&page=1&pageSize=20&customerRanking=1`],
    ['inventory-checks/products search', `/api/inventory-checks/products?branchId=1&query=serum&page=1&pageSize=20`],
    ['inventory-checks/products in session', `/api/inventory-checks/products?sessionId={{checkId}}&page=1&pageSize=20`],
    ['inventory-checks/sessions', `/api/inventory-checks/sessions?branchId=1&page=1&pageSize=20`], ['inventory-checks/sessions/:id', `/api/inventory-checks/sessions/{{checkId}}`],
    ['inventory-checks/sessions/:id/history', `/api/inventory-checks/sessions/{{checkId}}/history?page=1&pageSize=20`],
    // sales
    ['sales list today', `/api/sales?page=1&limit=20&${R(T, T)}`], ['sales list 30d', `/api/sales?page=1&limit=20&${R(M, T)}`], ['sales list all-time', '/api/sales?page=1&limit=20'],
    ['sales list search all-time', '/api/sales?page=1&limit=20&search=Customer%2012'], ['sales list receipt search', '/api/sales?page=1&limit=20&search=R0100005'],
    ['sales/stats today', `/api/sales/stats?${R(T, T)}`], ['sales/stats 30d', `/api/sales/stats?${R(M, T)}`], ['sales/stats all-time', '/api/sales/stats'], ['sales/stats search', '/api/sales/stats?search=Customer%2012'],
    ['sales/stats-strip today', `/api/sales/stats-strip?${R(T, T)}`], ['sales/stats-strip 30d', `/api/sales/stats-strip?${R(M, T)}`],
    ['sales/daily-report', `/api/sales/daily-report?date=${T}`], ['sales/day-report', `/api/sales/day-report?date=${T}`], ['sales/delivery-contact-report', `/api/sales/delivery-contact-report?${R(M, T)}`],
    ['sales/customer-report', `/api/sales/customer-report?customerId=1&${R(Y, T)}`], ['sales/export 30d', `/api/sales/export?${R(M, T)}`],
    ['sales/money-precision-capability', '/api/sales/money-precision-capability'], ['sales/create-receipt', '/api/sales/create-receipt?requestId=none'], ['sales/delivery-options', '/api/sales/delivery-options'],
    ['sales/:id/amendments', '/api/sales/100000/amendments'], ['sales/:id/records (sale detail records)', '/api/sales/100000/records'],
    // returns
    ['returns list', `/api/returns?page=1&pageSize=20`], ['returns list 30d', `/api/returns?page=1&pageSize=20&${R(M, T)}`], ['returns/export', `/api/returns/export?${R(M, T)}`],
    ['returns/damaged-lots', '/api/returns/damaged-lots'], ['returns/receipt-lookup', '/api/returns/receipt-lookup?receipt=R0100005'], ['returns/report', `/api/returns/report?${R(M, T)}`],
    ['returns/reason-presets', '/api/returns/reason-presets'], ['returns/reasons/impact', '/api/returns/reasons/impact?reason=seed'], ['returns/capabilities', '/api/returns/capabilities'],
    ['returns/:id', '/api/returns/1'], ['returns/:id/records', '/api/returns/1/records'],
    // contacts
    ['customers list', '/api/customers?page=1&pageSize=50'], ['customers search', '/api/customers?page=1&pageSize=50&search=Customer%2012'], ['customers phone search', '/api/customers?page=1&pageSize=50&search=0000000123'],
    ['customers/:id/rename-impact', '/api/customers/1/rename-impact?name=X'], ['customers/check-duplicate', '/api/customers/check-duplicate?name=Customer%201&phone=0000000001'], ['customers/duplicates', '/api/customers/duplicates'],
    ['customers/membership/:n', '/api/customers/membership/1'], ['customers/gender-restoration/status', '/api/customers/gender-restoration/status'],
    ['customers/reports/ar-invoices', `/api/customers/reports/ar-invoices?${R(Y, T)}`], ['customers/link-conflicts', '/api/customers/link-conflicts'], ['customers/points-summary', '/api/customers/points-summary?customerId=1'],
    ['suppliers list', '/api/suppliers?page=1&pageSize=50'], ['suppliers/duplicates', '/api/suppliers/duplicates'], ['suppliers/:id/purchases', '/api/suppliers/1/purchases'],
    ['suppliers/reports/stock-in-invoices', `/api/suppliers/reports/stock-in-invoices?${R(Y, T)}`], ['suppliers/reports/stock-in-invoice-lines', `/api/suppliers/reports/stock-in-invoice-lines?${R(Y, T)}`],
    ['suppliers/reports/ap-invoices', `/api/suppliers/reports/ap-invoices?${R(Y, T)}`],
    ['delivery-contacts list', '/api/delivery-contacts?page=1&pageSize=50'], ['delivery-contacts/duplicates', '/api/delivery-contacts/duplicates'],
    // dashboard / reports / notifications
    ['dashboard/startup today', `/api/dashboard/startup?${R(T, T)}&granularity=day`], ['dashboard/startup 7d', `/api/dashboard/startup?${R(W, T)}&granularity=day`],
    ['dashboard/startup 30d', `/api/dashboard/startup?${R(M, T)}&granularity=day`], ['dashboard/startup 365d', `/api/dashboard/startup?${R(Y, T)}&granularity=month`],
    ['dashboard', `/api/dashboard?${R(T, T)}`], ['dashboard/stock-alerts', '/api/dashboard/stock-alerts?state=low&page=1&pageSize=10'],
    ['dashboard/insight-list top_customers 30d', `/api/dashboard/insight-list?insight=top_customers&${R(M, T)}`], ['dashboard/insight-list', `/api/dashboard/insight-list?insight=top_products&${R(M, T)}`], ['analytics', `/api/analytics?${R(M, T)}`],
    ['reports/overview 30d', `/api/reports/overview?${R(M, T)}`], ['reports/periods', `/api/reports/periods?${R(M, T)}&granularity=day`], ['reports/grouped by product 30d', `/api/reports/grouped?${R(M, T)}&by=product`], ['reports/grouped by customer 30d', `/api/reports/grouped?${R(M, T)}&by=customer`], ['reports/grouped by product 365d', `/api/reports/grouped?${R(Y, T)}&by=product`],
    ['reports/business-summary/sales', `/api/reports/business-summary/sales?${R(M, T)}`], ['reports/business-summary/returns', `/api/reports/business-summary/returns?${R(M, T)}`],
    ['reports/business-summary/expenses', `/api/reports/business-summary/expenses?${R(M, T)}`],
    ['notifications/summary (bell)', '/api/notifications/summary'],
    ['notifications/summary/items inventory', '/api/notifications/summary/items?section=inventory'],
    // fees / shifts
    ['fees list', `/api/fees?page=1&pageSize=20&${R(M, T)}`], ['fees/report', `/api/fees/report?${R(M, T)}`], ['fees/labels', '/api/fees/labels'], ['fees/labels/impact', '/api/fees/labels/impact?label=Fee%201'],
    ['fees/labels/type-impact', '/api/fees/labels/type-impact?type=other'], ['fees/:id', '/api/fees/1'],
    // 6.0.1053: the catalog reads of the Expenses page, and the two shapes that also read the courier cost recorded on sales (switch expenses_sale_rows is seeded ON).
    ['fees/types', '/api/fees/types'], ['fees/types with uses and archived (manager)', '/api/fees/types?uses=1&include_archived=1'], ['fees/types/impact', '/api/fees/types/impact?name=Rent'],
    ['fees/labels with archived (manager)', '/api/fees/labels?include_archived=1'],
    ['fees list with sale delivery rows (source=all)', `/api/fees?page=1&pageSize=20&source=all&${R(M, T)}`], ['fees/report with sale delivery (include=sales)', `/api/fees/report?${R(M, T)}&include=sales`],
    ['shifts/policy', '/api/shifts/policy'], ['shifts/current', '/api/shifts/current'], ['shifts list', '/api/shifts?page=1&pageSize=20'], ['shifts/:id/history', '/api/shifts/1/history'],
    // branches / promotions / users
    ['branches', '/api/branches'], ['branches/summary', '/api/branches/summary'], ['branches/stock-integrity', '/api/branches/stock-integrity'], ['branches/:id/stock', '/api/branches/1/stock?page=1&pageSize=50'],
    ['promotions/rules/active', '/api/promotions/rules/active'], ['promotions/rules', '/api/promotions/rules'], ['promotions', '/api/promotions'],
    ['users', '/api/users'], ['users/:id/profile', '/api/users/901/profile'], ['users/:id/auth-methods', '/api/users/901/auth-methods'], ['users/password-reset-requests', '/api/users/password-reset-requests'],
    ['users/password-hash-status', '/api/users/password-hash-status'], ['roles', '/api/roles'], ['roles/defaults', '/api/roles/defaults'],
    // files / notes / ai / backups
    ['files', '/api/files?page=1&pageSize=50'], ['files/:id/usage', '/api/files/1/usage'], ['notes', '/api/notes'], ['ai/providers', '/api/ai/providers'], ['ai/responses', '/api/ai/responses'],
    ['backups', '/api/backups'], ['backups/maintenance', '/api/backups/maintenance'],
    // imports / review / audit / history
    ['import-jobs/queue/status', '/api/import-jobs/queue/status'], ['import-jobs', '/api/import-jobs'], ['import-jobs/:id', '/api/import-jobs/1'], ['import-jobs/:id/review', '/api/import-jobs/1/review'],
    ['import-jobs/:id/report', '/api/import-jobs/1/report'], ['import-jobs/:id/errors.csv', '/api/import-jobs/1/errors.csv'],
    ['review/mine', '/api/review/mine'], ['review', '/api/review?status=pending'], ['review/:id', '/api/review/1'],
    ['action-history', '/api/action-history?page=1&pageSize=20'], ['action-history/movements/:id/revert-preview', '/api/action-history/movements/1/revert-preview'], ['action-history/:id/details', '/api/action-history/1/details'],
    ['system/audit-logs (Records)', '/api/system/audit-logs?page=1&pageSize=50'], ['system/audit-logs entity filter', '/api/system/audit-logs?page=1&pageSize=50&entity=sale&entityId=100005'],
    ['system/legacy-deleted-sales', '/api/system/legacy-deleted-sales'], ['system/integration-doctor', '/api/system/integration-doctor'], ['system/data-path', '/api/system/data-path'],
    ['system/scale-migration/status', '/api/system/scale-migration/status'], ['system/drive-sync/status', '/api/system/drive-sync/status'], ['system/jobs', '/api/system/jobs'], ['system/jobs/:id', '/api/system/jobs/1'],
    ['system/debug/log', '/api/system/debug/log'], ['system/verify-integrity', '/api/system/verify-integrity'],
    ['system/shared-general-customer-repair/preview', '/api/system/shared-general-customer-repair/preview'], ['system/shared-general-customer-membership-repair/preview', '/api/system/shared-general-customer-membership-repair/preview'],
    ['system/sale-not-paid-stock-recovery-20260909/preview', '/api/system/sale-not-paid-stock-recovery-20260909/preview'], ['system/legacy-subtotal-repair/preview', '/api/system/legacy-subtotal-repair/preview'],
    // portal / public catalog (anonymous)
    ['portal/config', '/api/portal/config', { anon: true }], ['portal/bootstrap', '/api/portal/bootstrap', { anon: true }], ['portal/catalog/meta', '/api/portal/catalog/meta', { anon: true }],
    ['portal/catalog/products', '/api/portal/catalog/products?page=1&pageSize=24', { anon: true }], ['portal/catalog/products category', '/api/portal/catalog/products?page=1&pageSize=24&category=Category%203', { anon: true }],
    ['portal/catalog/products/search', '/api/portal/catalog/products/search?q=serum&page=1&pageSize=24', { anon: true }], ['portal/promotions', '/api/portal/promotions', { anon: true }],
    ['portal/ai/status', '/api/portal/ai/status', { anon: true }], ['portal/auth/me', '/api/portal/auth/me', { anon: true }], ['portal/account/cart', '/api/portal/account/cart', { anon: true }],
    ['portal/account/wishlist', '/api/portal/account/wishlist', { anon: true }], ['portal/membership/:n', '/api/portal/membership/1', { anon: true }],
    ['portal/submissions/review', '/api/portal/submissions/review'], ['portal/submissions/:id/screenshot/:i', '/api/portal/submissions/1/screenshot/0'],
    ['inventory-checks/products all-time name page, page 2', `/api/inventory-checks/products?branchId=1&sortBy=name&sortDirection=asc&page=2&pageSize=20`],
    ['inventory-checks/products Issues all sessions', `/api/inventory-checks/products?branchId=1&state=issue&page=1&pageSize=20`],
    ['inventory-checks/products Issues in session', `/api/inventory-checks/products?sessionId={{checkId}}&state=issue&page=1&pageSize=20`],
    ['inventory-checks/products stock sort ascending', `/api/inventory-checks/products?branchId=1&sortBy=stock&sortDirection=asc&page=1&pageSize=20`],
  ]
}

// Windows of a month or more, and unbounded ones, are the long-range shapes the governor sheds first.
const LONG_RANGE = /(?:^|[ /])(30d|365d|all-time)$/i

function getShapes(ctx) {
  const seen = new Set()
  return getEntries(ctx).map(([label, url, opt = {}]) => {
    let id = slug(label)
    if (seen.has(id)) id += '-' + [...seen].filter((x) => x.startsWith(id)).length
    seen.add(id)
    return { id, kind: 'get', method: 'GET', label, url, anon: Boolean(opt.anon), longRange: LONG_RANGE.test(label) }
  })
}

module.exports = { getShapes, slug }
