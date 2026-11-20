#!/usr/bin/env node
// Q4 (lane/money-quick-wins): the bell's sales, imports and portal sections are answered from the plan-lifetime section cache (notifications.ts `ttlOnly`), like
// inventory, expiry and supplier credit already were, so every section may be up to the plan's lifetime old and the panel shows the oldest "as of" (owner, 11 Nov).
//   - a second summary inside the lifetime reads no row for those three sections, and its body (sections and generatedAt) is the first one's;
//   - a till's own SALE does not force a read: a plain read after a 'sales' version bump still serves the entry (it may lag, with its "as of");
//   - `?fresh=1` with no write in between is served from the entry; with the section's data version moved (a sale, a customer or portal write, a product or import)
//     it recomputes, and a section whose version did not move does not;
//   - what a recompute reads is what the section showed before this change (a pending submission appears after the fresh read, not before).
// MUTANT=<name> applies one defect to the Worker bundle (the section skips the cache, the imports filter runs before the cache): the test must go red.
// Run: node scripts/test-bell-sections-cached-native.cjs
'use strict'
process.env.READ_BUDGET_DEADLINE_MS ||= '120000'
const { bootWorld, lastStatements } = require('./read-budget/world.cjs')

const FILE = 'src/routes/notifications.ts'
const SALES_CALL = "tasks.push(cachedSection('sales', ['sales'], 'not-paid-delivery-pending', () => buildSalesSection(c.env), { ttlOnly: true }))"
const PORTAL_CALL = "if (hasPermission(user, 'customer_portal')) tasks.push(cachedSection('portal', ['customers'], 'pending-share-submissions', () => buildPortalSection(c.env), { ttlOnly: true }))"
const IMPORTS_CALL = "tasks.push(cachedSection('imports', ['products', 'customers', 'sales'], 'warnings-2d', () => readImportWarningRows(c.env), { ttlOnly: true }).then((rows) => importsSectionFor(rows, user)))"
const MUTANTS = {
  salesSkipsTheCache: [{ name: 'm-sales', file: FILE, from: SALES_CALL, to: "tasks.push(buildSalesSection(c.env))" }],
  portalSkipsTheCache: [{ name: 'm-portal', file: FILE, from: PORTAL_CALL, to: "if (hasPermission(user, 'customer_portal')) tasks.push(buildPortalSection(c.env))" }],
  importsSkipTheCache: [{ name: 'm-imports', file: FILE, from: IMPORTS_CALL, to: "tasks.push(readImportWarningRows(c.env).then((rows) => importsSectionFor(rows, user)))" }],
  // a recompute that ignores the section's version: fresh=1 after a sale would serve the old entry
  // a resolving route that does not move the version its bell section is keyed on: the acting admin's fresh read would re-serve the resolved item
  portalReviewSkipsItsBump: [{ name: 'm-portal-bump', file: 'src/routes/portal.ts', from: "  await bumpVersion(c.env, 'customers')", to: '  void 0' }],
  importCancelSkipsItsBump: [{ name: 'm-import-bump', file: 'src/routes/importJobs.ts', from: "  await bumpVersion(c.env, 'products') // a cancelled job leaves the bell's imports section (stamped with this version): the acting device's fresh read must recompute", to: '  void 0' }],
  // section-scoped fresh: the list is ignored (a plain read), any list is `fresh=1`, an unknown name throws, the status route skips its version bump
  scopedListIgnored: [{ name: 'm-list-ignored', file: FILE, from: 'const isFresh = (name: string) => freshAll || Boolean(freshNames?.has(name))', to: 'const isFresh = (name: string) => freshAll' }],
  anyListIsFresh1: [{ name: 'm-any-list', file: FILE, from: "const freshAll = freshParam === '1'", to: 'const freshAll = freshParam.length > 0' }],
  unknownNameThrows: [{ name: 'm-unknown', file: FILE, from: 'const isFresh = (name: string) => freshAll || Boolean(freshNames?.has(name))', to: "if (freshNames && [...freshNames].some((n) => !['inventory', 'expiry', 'sales', 'portal', 'imports', 'supplier_credit', 'inventory-full', 'loyalty'].includes(n))) throw new Error('unknown section')\n  const isFresh = (name: string) => freshAll || Boolean(freshNames?.has(name))" }],
  statusRouteSkipsItsBump: [{ name: 'm-status-bump', file: 'src/routes/sales.ts', from: '  // audit insert can run after the response is sent. The cache bump does not: it is awaited first (W3 Slice A).', to: "  // audit insert can run after the response is sent. The cache bump does not: it is awaited first (W3 Slice A).\n  const bumpVersions = async (_env: unknown, _names: string[]) => undefined" }],
  salesIgnoresItsVersion: [{ name: 'm-sales-ns', file: FILE, from: SALES_CALL, to: "tasks.push(cachedSection('sales', [], 'not-paid-delivery-pending', () => buildSalesSection(c.env), { ttlOnly: true }))" }],
}
const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT] : null
if (process.env.MUTANT && !mutant) { console.error('unknown MUTANT ' + process.env.MUTANT); process.exit(2) }

const SECTION = {
  sales: (s) => /FROM sales/.test(s.sql) && /ORDER BY created_at DESC LIMIT 50/.test(s.sql.replace(/\s+/g, ' ')),
  imports: (s) => /FROM import_jobs/.test(s.sql) && /warning_count > 0/.test(s.sql),
  portal: (s) => /FROM customer_share_submissions/.test(s.sql) && /status = 'pending'/.test(s.sql),
}
const problems = []
const check = (label, ok, detail) => { if (!ok) problems.push(label + (detail === undefined ? '' : ': ' + JSON.stringify(detail))); console.log((ok ? 'ok    ' : 'RED   ') + label) }

async function main() {
  const world = await bootWorld({ tier: 'free', patches: mutant || [] })
  try {
    const kv = await world.mf.getKVNamespace('CACHE', 'w0')
    const bump = (namespace) => kv.put('v2:' + namespace, 'monqw-' + namespace + '-' + Date.now() + '-' + Math.random())
    const read = async (query = '') => {
      const r = await world.send('GET', '/api/notifications/summary' + query, undefined, { miss: false })
      const stmts = await lastStatements(world)
      const per = Object.fromEntries(Object.keys(SECTION).map((k) => [k, stmts.filter(SECTION[k])]))
      return { r, per, rows: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.reduce((n, s) => n + s.rr, 0)])), count: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.length])) }
    }
    const ids = (r) => r.json.sections.map((s) => s.id)

    const first = await read()
    check('the first summary answers 200', first.r.status === 200, first.r.status)
    check('the first summary computes the sales section (2 statements), imports (1) and portal (1)', first.count.sales === 2 && first.count.imports === 1 && first.count.portal === 1, first.count)
    check('the seed has Not Paid sales, so the sales section is shown', ids(first.r).includes('sales'), ids(first.r))
    check('no pending submission yet: no portal section', !ids(first.r).includes('portal'))

    // 1. a second summary inside the lifetime
    const second = await read()
    check('the second summary reads no row for sales, imports or portal', second.count.sales + second.count.imports + second.count.portal === 0, second.count)
    check('the second summary body is the first one (sections and "as of")', JSON.stringify(second.r.json.sections) === JSON.stringify(first.r.json.sections) && second.r.json.generatedAt === first.r.json.generatedAt, [first.r.json.generatedAt, second.r.json.generatedAt])

    // 2. data changes, no fresh read: served from the entry, still the first answer
    await world.db.prepare("INSERT INTO customer_share_submissions (customer_id, membership_number, customer_name, platform, status) VALUES (1, 'M-1', 'Pending Person', 'facebook', 'pending')").run()
    const saleRow = (await world.all("SELECT id FROM sales WHERE sale_status = 'completed' ORDER BY id DESC LIMIT 1"))[0]
    await world.db.prepare("UPDATE sales SET sale_status = 'awaiting_payment', amount_paid_usd = 0 WHERE id = ?").bind(saleRow.id).run()
    await bump('sales') // a till's own sale: no fresh flag follows it (frontend/src/api/bellFreshness.ts bellWriteFor: POST /api/sales maps to nothing)
    const afterSale = await read()
    check('a plain read after a sale still serves the entries (no read, same body)', afterSale.count.sales + afterSale.count.imports + afterSale.count.portal === 0 && JSON.stringify(afterSale.r.json.sections) === JSON.stringify(first.r.json.sections), afterSale.count)

    // 3. ?fresh=1: only a section whose data version moved since its entry was computed recomputes. The sales version moved above (imports read it too; the portal does not).
    const freshPortalNothingMoved = await read('?fresh=1')
    check('fresh=1: the portal (version not moved) is served from the entry', freshPortalNothingMoved.count.portal === 0, freshPortalNothingMoved.count)
    check('fresh=1 after a sale version moved: the sales section recomputes (2 statements) and so do the imports (1)', freshPortalNothingMoved.count.sales === 2 && freshPortalNothingMoved.count.imports === 1, freshPortalNothingMoved.count)
    const freshAgain = await read('?fresh=1')
    check('fresh=1 again with no write in between: nothing is re-read', freshAgain.count.sales + freshAgain.count.imports + freshAgain.count.portal === 0, freshAgain.count)
    check('the recomputed sales section shows the changed sale; the portal entry still does not show the submission yet', !ids(freshPortalNothingMoved.r).includes('portal'), ids(freshPortalNothingMoved.r))

    // 4. a customers write (a portal review or a contact edit), own and non-sale: fresh=1 recomputes the portal section only
    await bump('customers')
    const freshCustomers = await read('?fresh=1')
    check('fresh=1 after a customers write: portal recomputes (1 statement), sales does not', freshCustomers.count.portal === 1 && freshCustomers.count.sales === 0, freshCustomers.count)
    check('the pending submission is now in the bell', ids(freshCustomers.r).includes('portal'), ids(freshCustomers.r))
    const afterwards = await read()
    check('a plain read afterwards serves it again, with the same "as of"', afterwards.count.sales + afterwards.count.imports + afterwards.count.portal === 0 && ids(afterwards.r).includes('portal') && afterwards.r.json.generatedAt === freshCustomers.r.json.generatedAt, afterwards.count)

    // 5. a product write: fresh=1 recomputes the imports rows (and inventory); sales and portal are not re-read
    await bump('products')
    const freshProducts = await read('?fresh=1')
    check('fresh=1 after a products write: imports recompute (1 statement), sales and portal do not', freshProducts.count.imports === 1 && freshProducts.count.sales === 0 && freshProducts.count.portal === 0, freshProducts.count)

    // 5b. resolving an item: the acting admin's next summary (?fresh=1, which the frontend asks for after a portal review or an import write, bellFreshness.ts)
    // no longer lists it and reads only the sections whose version the route moved; another user inside the lifetime is served the entry; an unresolved item stays.
    const hash = (await world.all('SELECT password FROM users WHERE id = 901'))[0].password
    const orgRow = (await world.all('SELECT organization_id FROM users WHERE id = 901'))[0]
    await world.db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_admin_two','Second Admin',?,901,'{}',1,?,0)").bind(hash, orgRow.organization_id).run()
    const login2 = await world.send('POST', '/api/auth/login', { username: 'budget_admin_two', password: 'budget-password-1', organizationId: world.orgId }, { cookie: null })
    check('a second admin signs in', login2.status === 200, login2.status)
    const cookie2 = login2.setCookie.split(';')[0]
    const read2 = async (query = '') => {
      const r = await world.send('GET', '/api/notifications/summary' + query, undefined, { miss: false, cookie: cookie2 })
      const stmts = await lastStatements(world)
      return { r, count: Object.fromEntries(Object.keys(SECTION).map((k) => [k, stmts.filter(SECTION[k]).length])) }
    }
    const items = (r, id) => ((r.json.sections.find((x) => x.id === id) || {}).items || []).map((i) => i.id)
    await world.db.prepare("INSERT INTO customer_share_submissions (customer_id, membership_number, customer_name, platform, status) VALUES (1, 'M-2', 'Second Person', 'tiktok', 'pending')").run()
    const subs = await world.all("SELECT id FROM customer_share_submissions WHERE status = 'pending' ORDER BY id")
    const [keepId, resolveId] = [subs[0].id, subs[subs.length - 1].id]
    await world.db.prepare("INSERT INTO import_jobs (id, type, status, phase, warning_count, finished_at) VALUES ('imp-bell-1', 'products', 'completed', 'done', 3, datetime('now'))").run()
    await bump('customers'); await bump('products')
    const shown = await read('?fresh=1')
    check('setup: two pending submissions and an import warning are in the bell', items(shown.r, 'portal').length === 2 && ids(shown.r).includes('imports'), [items(shown.r, 'portal'), ids(shown.r)])
    const otherBefore = await read2()
    check('a second admin inside the lifetime is served the entry (no row of the three sections) and still sees both submissions', otherBefore.count.portal + otherBefore.count.imports + otherBefore.count.sales === 0 && items(otherBefore.r, 'portal').length === 2, [otherBefore.count, items(otherBefore.r, 'portal')])

    const approve = await world.send('PATCH', '/api/portal/submissions/' + resolveId + '/review', { status: 'approved', reward_points: 0 })
    check('the portal approve answers 200', approve.status === 200, [approve.status, approve.text.slice(0, 200)])
    const afterApprove = await read('?fresh=1')
    check('after the approve, the acting admin no longer sees that submission and still sees the unresolved one', !items(afterApprove.r, 'portal').includes('portal-' + resolveId) && items(afterApprove.r, 'portal').includes('portal-' + keepId), items(afterApprove.r, 'portal'))
    check('the approve fresh read recomputes the portal section and not the sales section', afterApprove.count.portal === 1 && afterApprove.count.sales === 0, afterApprove.count)
    const otherAfter = await read2()
    check('the second admin is served the refreshed entry without a row read', otherAfter.count.portal + otherAfter.count.imports + otherAfter.count.sales === 0 && !items(otherAfter.r, 'portal').includes('portal-' + resolveId), [otherAfter.count, items(otherAfter.r, 'portal')])

    const cancel = await world.send('POST', '/api/import-jobs/imp-bell-1/cancel', {})
    check('the import cancel answers 200', cancel.status === 200, [cancel.status, cancel.text.slice(0, 200)])
    const afterCancel = await read('?fresh=1')
    check('after the import review, the acting admin no longer sees the warning; the imports section recomputes, sales and portal do not', !ids(afterCancel.r).includes('imports') && afterCancel.count.imports === 1 && afterCancel.count.sales === 0 && afterCancel.count.portal === 0, [ids(afterCancel.r), afterCancel.count])
    check('an unresolved submission is still listed after another section write', items(afterCancel.r, 'portal').includes('portal-' + keepId), items(afterCancel.r, 'portal'))
    await bump('sales')
    const afterSales = await read('?fresh=1')
    check('an unresolved submission is still listed after a sales write and a fresh read', items(afterSales.r, 'portal').includes('portal-' + keepId), items(afterSales.r, 'portal'))

    // 5d. section-scoped fresh (lead decision, 21 Nov): the status route names what it resolves; the acting admin re-reads ONLY those sections (?fresh=sales) and the catalog sections
    // (inventory, expiry, supplier credit) are not run. Another user's plain read is the 5-minute rule: it may still list the settled sale until someone refreshes the entry.
    const CATALOG = (s) => (/out_of_stock_threshold/.test(s.sql) && /FROM products/.test(s.sql)) || (/expiry_date/.test(s.sql) && /FROM products/.test(s.sql)) || (/credit_due_date/.test(s.sql) && /FROM product_batches/.test(s.sql))
    const readAs = async (query, cookie) => {
      const r = await world.send('GET', '/api/notifications/summary' + query, undefined, cookie ? { miss: false, cookie } : { miss: false })
      const stmts = await lastStatements(world)
      return { r, sales: stmts.filter(SECTION.sales).length, catalog: stmts.filter(CATALOG).length, rr: r.rr }
    }
    await bump('sales'); await bump('stock')
    const warmed = await readAs('?fresh=1')
    const notPaid = items(warmed.r, 'sales').filter((id) => id.startsWith('pay-')).map((id) => Number(id.slice(4)))
    check('setup: at least two Not Paid sales are in the acting admin bell for the scoped-fresh cases', notPaid.length >= 2, notPaid.length)
    const [saleA, saleB] = notPaid
    const settle = async (id, requestId) => {
      const sale = (await world.all('SELECT total_usd, exchange_rate FROM sales WHERE id = ?', id))[0]
      return world.send('PATCH', '/api/sales/' + id + '/status', { sale_status: 'completed', client_request_id: requestId, payment_details: [{ method: 'Cash', amount_usd: Number(sale.total_usd) }], expected_exchange_rate: sale.exchange_rate })
    }
    await readAs('', cookie2)
    const settleA = await settle(saleA, 'bellfresh-a')
    check('the status route settles the first sale (200)', settleA.status === 200, [settleA.status, settleA.text.slice(0, 200)])
    const otherPlain = await readAs('', cookie2)
    check('another user\'s plain read right after it may still list the settled sale (the 5-minute rule), and reads no row of any section', items(otherPlain.r, 'sales').includes('pay-' + saleA) && otherPlain.sales === 0 && otherPlain.catalog === 0, [items(otherPlain.r, 'sales'), otherPlain.sales, otherPlain.catalog])
    const scopedSales = await readAs('?fresh=sales')
    check('?fresh=sales: the acting admin no longer lists the settled sale and still lists the unsettled one', !items(scopedSales.r, 'sales').includes('pay-' + saleA) && items(scopedSales.r, 'sales').includes('pay-' + saleB), items(scopedSales.r, 'sales'))
    check('?fresh=sales runs the sales section (2 statements) and none of inventory, expiry, supplier credit', scopedSales.sales === 2 && scopedSales.catalog === 0, [scopedSales.sales, scopedSales.catalog])
    const otherAfterScoped = await readAs('', cookie2)
    check('the scoped read refreshed the entry for everyone: the other user now no longer sees it, with no row read', !items(otherAfterScoped.r, 'sales').includes('pay-' + saleA) && otherAfterScoped.sales === 0, [items(otherAfterScoped.r, 'sales'), otherAfterScoped.sales])
    const settleB = await settle(saleB, 'bellfresh-b')
    check('the status route settles the second sale (200)', settleB.status === 200, [settleB.status, settleB.text.slice(0, 200)])
    const everything = await readAs('?fresh=1')
    check('?fresh=1 after the same write also recomputes the catalog sections (the route moved the stock version)', everything.sales === 2 && everything.catalog > 0, [everything.sales, everything.catalog])
    check('?fresh=sales read fewer rows than ?fresh=1 after the same write', scopedSales.rr < everything.rr, [scopedSales.rr, everything.rr])
    console.log('rows read after the same status write: ?fresh=sales ' + scopedSales.rr + ', ?fresh=1 ' + everything.rr)
    const plainNames = await readAs('?fresh=nothing,at,all')
    check('unknown section names are a plain read (200, no producer run)', plainNames.r.status === 200 && plainNames.sales + plainNames.catalog === 0, [plainNames.r.status, plainNames.sales, plainNames.catalog])

    // clearing a delivery: a delivery order is Completed with the delivery tag; settling it through the status route takes it out of the section
    const deliverable = (await world.all("SELECT id FROM sales WHERE sale_status = 'completed' ORDER BY id DESC LIMIT 1"))[0]
    await world.db.prepare('UPDATE sales SET delivery_pending = 1 WHERE id = ?').bind(deliverable.id).run()
    await bump('sales')
    const withDelivery = await readAs('?fresh=sales')
    check('setup: the delivery order is in the acting admin\'s bell', items(withDelivery.r, 'sales').includes('delivery-' + deliverable.id), items(withDelivery.r, 'sales'))
    const clear = await world.send('PATCH', '/api/sales/' + deliverable.id + '/status', { sale_status: 'completed', client_request_id: 'bellfresh-d' })
    check('the route clears the delivery (200)', clear.status === 200, [clear.status, clear.text.slice(0, 200)])
    const afterClear = await readAs('?fresh=sales')
    check('?fresh=sales: the cleared delivery is gone from the acting admin\'s bell and no catalog section ran', !items(afterClear.r, 'sales').includes('delivery-' + deliverable.id) && afterClear.catalog === 0, [items(afterClear.r, 'sales'), afterClear.catalog])

    // 6. the "as of" is the oldest compute time of what was served
    check('generatedAt is never later than the first computation of any served section', Date.parse(afterwards.r.json.generatedAt) <= Date.parse(freshProducts.r.json.generatedAt) + 1 && Date.parse(first.r.json.generatedAt) <= Date.parse(afterwards.r.json.generatedAt), [first.r.json.generatedAt, afterwards.r.json.generatedAt, freshProducts.r.json.generatedAt])
    console.log('rows read for the three sections, first / second: ' + JSON.stringify(first.rows) + ' / ' + JSON.stringify(second.rows))
    console.log('summary rows read, first / second: ' + first.r.rr + ' / ' + second.r.rr + '; D1 calls ' + first.r.calls + ' / ' + second.r.calls)
  } finally { await world.dispose() }
  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log('\nall green')
}
main().catch((e) => { console.error('crashed: ' + (e && e.stack)); process.exit(1) })
