// INV-A S4a (Inventory replan 2.3-2.5): the wired Inventory Check routes, GET /api/inventory-checks/list and /overlay, behind the read switch ic_wired, over the real routes
// and migrations. Pinned here:
//  OFF   both routes answer 404 and prepare no Inventory Check statement; the legacy list is unaffected (R7: a legacy-key request stays on the old route, with the switch ON too);
//  PARITY  for 10 scopes x 3 viewers the list rows are Products' rows (byte-identical for a viewer whose Products answer needs no cut; otherwise exactly the documented cut), the
//          second route is a cache HIT in both orders, and no statement of either route reads the stock ledger (a positive control shows the pin can see it on the old route);
//  PROJECTION  a blind counter gets no stock, no lot quantity and no held stock; barcode, price, category, brand, received date follow the grants; nobody gets cost;
//  FILTERS  Issues / Counted / Pending use the server-only restriction, Not checked leaves the checked set out; latest wins; other branches and organizations are not read;
//          a set over inventoryCheckFilterMaxIds is refused 503; the counts are IC data on the inventory_checks version;
//  OVERLAY  the viewer's count entries, pending marks and last movement of the window's ids only; mixed-format created_at (14:00 beats ISO 09:00); bounded by the plan fields;
//  WRITERS  an Inventory Check writer moves the inventory_checks version before it answers (and a refusal does not), so the id sets are fresh after it, not before.
//
// Run: node scripts/test-inventory-check-wired-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond, detail) { if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail); assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }
// The first place two JSON values differ, for a failing comparison.
function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[key], b[key], `${path}.${key}`); if (d) return d }
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
}

const ids100 = Array.from({ length: 12 }, (_, i) => 100 + i)
const app = createInvApp({
  mount: {
    '/api/products': 'routes/products.ts',
    '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts',
    '/api/inventory-checks': 'routes/inventoryChecks.ts',
  },
  seed(raw, seedStockFixture) {
    seedStockFixture(raw.db, () => {
      ids100.forEach((id, i) => {
        const quantity = id === 100 ? 0 : id === 101 ? 2 : id === 102 ? 3 : 10 + i
        raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,supplier,description,
          low_stock_threshold,out_of_stock_threshold,is_active,created_at,updated_at) VALUES(?,?,?,?,?,9.5,38000,4,16000,?,?,?,?,3,0,1,?,'2026-09-01 00:00:00')`)
          .run([id, `${['Aloe', 'Beauty', 'Camellia', 'Dew'][i % 4]} ${i % 2 ? 'Powder' : 'Serum'} ${id}`, `SKU${id}`, `88500000${id}`, quantity, i % 2 ? 'Brand A' : 'Brand B', i % 3 ? 'Cat X' : 'Cat Y',
            `Sup ${i % 3}`, `Desc ${id}`, `2026-09-${String(10 + i).padStart(2, '0')} 00:00:00`])
        raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([id, quantity])
        if (quantity > 0 && id < 106) {
          raw.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,batch_number,unit_cost_usd,is_active,supplier_name)
            VALUES(?,?,?,?,?,?,1,4.25,1,'Dane')`).run([9000 + id, id, `K${id}`, `L${id}`, '2026-08-01', '2027-01-01'])
          raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run([9000 + id, quantity])
        }
      })
      raw.prepare("INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity,quantity_remaining,condition_tag) VALUES(103,'P103',1,2,2,'damaged')").run()
      // Inventory Check: sessions, items, one pending approval.
      const session = (id, org, branch, by, status) => raw.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at)
        VALUES(?,?,?,?,?,?,'{}','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z')`).run([id, org, branch, by, `Count ${id}`, status])
      const item = (sid, product, branch, state, counted, baseline, reason, by, at) => raw.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
        VALUES(?,?,?,?,?,'{}',?,?,?,1,?,?)`).run([sid, product, branch, JSON.stringify({ id: product, name: `P${product}` }), baseline, state, counted, reason, by, at])
      session('sA', null, 1, 72, 'open'); session('sB', null, 1, 71, 'closed'); session('sC', null, 2, 71, 'closed'); session('sF', 2, 1, 71, 'closed'); session('sP', null, 1, 72, 'open')
      item('sA', 100, 1, 'done', 5, 5, null, 72, '2026-11-01T01:00:00.000Z')
      item('sA', 101, 1, 'issue', 2, 3, 'Two on shelf', 72, '2026-11-01T02:00:00.000Z')
      item('sA', 103, 1, 'unstarted', null, 10, null, null, null)
      item('sB', 101, 1, 'done', 3, 3, null, 71, '2026-11-02T01:00:00.000Z') // newer than sA's issue: the latest of 101 is done
      item('sB', 102, 1, 'issue', 1, 3, 'Damaged box', 71, '2026-11-02T02:00:00.000Z')
      item('sC', 104, 2, 'issue', 1, 3, 'Other branch', 71, '2026-11-02T03:00:00.000Z')
      item('sF', 105, 1, 'issue', 1, 3, 'Foreign organization', 71, '2026-11-02T04:00:00.000Z')
      item('sP', 106, 1, 'done', 7, 10, null, 72, '2026-11-03T01:00:00.000Z')
      raw.prepare(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json)
        VALUES('sP',NULL,1,'pending',1,72,'2026-11-03T01:00:00.000Z','{"106":10}')`).run()
      // Movements: 100 has an ISO 09:00Z and a later 14:00 of the same day (plain text order picks the ISO one); 101 only ISO; 102 none.
      const move = (product, at) => raw.prepare("INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,created_at) VALUES(?,1,'adjust',1,?)").run([product, at])
      move(100, '2026-10-01 10:00:00'); move(100, '2026-11-03T09:00:00.000Z'); move(100, '2026-11-03 14:00:00'); move(101, '2026-11-02T08:00:00.000Z'); move(103, '2026-11-03 10:00:00')
    })
  },
})
const itemsOf = (r) => (r.json && r.json.items) || []
const body = (r) => JSON.stringify(r.json)

// What Products sends for a scope, and the Inventory Check parameters that mean the same thing.
const PRODUCTS_BASE = (page, size, sort, extra = '') => `/api/products/search?page=${page}&pageSize=${size}&searchMode=smart&sort=${sort}&include=branch_stock,images,batches,tagged_lots${extra}`
const SCOPES = [
  ['default', '', PRODUCTS_BASE(1, 50, 'created_desc')],
  ['step', 'page=2&pageSize=5', PRODUCTS_BASE(2, 5, 'created_desc')],
  ['brand', 'brand=Brand%20A', PRODUCTS_BASE(1, 50, 'created_desc', '&brand=Brand%20A')],
  ['category', 'category=Cat%20X', PRODUCTS_BASE(1, 50, 'created_desc', '&category=Cat%20X')],
  ['text', 'query=powder', PRODUCTS_BASE(1, 50, 'created_desc', '&query=powder')],
  ['barcode', 'query=88500000103', PRODUCTS_BASE(1, 50, 'created_desc', '&query=88500000103')],
  ['low', 'branchId=1&stockState=low_stock', PRODUCTS_BASE(1, 50, 'created_desc', '&branchId=1&stockState=low')],
  ['out', 'branchId=1&stockState=out_of_stock', PRODUCTS_BASE(1, 50, 'created_desc', '&branchId=1&stockState=out')],
  ['in', 'stockState=in_stock', PRODUCTS_BASE(1, 50, 'created_desc', '&stockState=in_stock')],
  ['name desc', 'sortBy=name&sortDirection=desc', PRODUCTS_BASE(1, 50, 'name_desc')],
]
// The cut the grants describe, written out from the spec and not from the code.
const COST = ['cost_price_usd', 'cost_price_khr', 'cost_needs_review', 'purchase_price_usd', 'purchase_price_khr', 'cost_review_key']
const GROUPS = {
  stock: ['stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold'], barcode: ['barcode', 'sku'], category: ['category', 'categories'], brand: ['brand', 'brands'],
  price: ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr',
    'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at'],
  received: ['batch_count', 'expiry_date', 'expiry_alert_days'],
}
function expectedRow(row, fields, productsPage) {
  const out = { ...row }
  for (const key of COST) delete out[key]
  for (const [group, keys] of Object.entries(GROUPS)) if (!fields[group]) for (const key of keys) delete out[key]
  if (!productsPage) { delete out.supplier; delete out.description }
  if (!fields.stock) out.branch_stock = out.branch_stock.map(({ quantity: _q, ...entry }) => entry)
  if (!fields.received) { delete out.lots; delete out.lots_more }
  else if (out.lots) out.lots = out.lots.map((lot) => ({ ...lot, ...(productsPage ? {} : { supplier_name: undefined }), branches: lot.branches.map(({ quantity, ...entry }) => (fields.stock ? { ...entry, quantity } : entry)) }))
  return JSON.parse(JSON.stringify(out))
}
const FIELDS = {
  admin: { stock: true, barcode: true, price: true, category: true, brand: true, received: true }, checker: { stock: true, barcode: true, price: true, category: true, brand: true, received: true },
  stockOnly: { stock: true, received: true }, receivedOnly: { received: true }, blind: { brand: true, category: true },
}
const PAGE = { admin: true, checker: true, stockOnly: false, receivedOnly: false, blind: false }
// The same Products URL with the lots token in its include parameter (not in its key).
const withLots = (url) => url.replace("include=branch_stock,images,batches,tagged_lots", "include=branch_stock,images,batches,tagged_lots,lots")
const ledger = /recorded_ordinary_quantity|ordinary_totals|stock_schema_epoch|inventoryBranchId|inventoryProductIds|stock_diagnostics/

;(async () => {
  const U = app.users
  // ---- OFF ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  app.setUser(U.checker)
  let mark = app.mark()
  const offList = await app.get('/api/inventory-checks/list'), offOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100')
  check('OFF: /list and /overlay answer 404', offList.status === 404 && offOverlay.status === 404 && offList.json.code === 'not_found')
  check('OFF: they prepared no Inventory Check, products or movement statement', !app.since(mark).some((sql) => /inventory_check|inventory_movements|FROM products/.test(sql)))
  const legacyOff = await app.get('/api/inventory-checks/products?page=1&pageSize=5&sortBy=name&sortDirection=asc')
  check('OFF: the legacy list answers as before', legacyOff.status === 200 && itemsOf(legacyOff).length > 0)

  app.setSwitch('ic_wired', 'on')
  app.setSwitch('ic_fix_stock', 'on')
  const legacyOn = await app.get('/api/inventory-checks/products?page=1&pageSize=5&sortBy=name&sortDirection=asc')
  check('R7: with ic_wired ON a legacy-key request stays on the old route and answers the same bytes', legacyOn.status === 200 && body(legacyOn) === body(legacyOff))
  const legacyIssue = await app.get('/api/inventory-checks/products?page=1&pageSize=5&checkState=issue')
  check('R7: the legacy Issues word is still the old route (not a wired list)', legacyIssue.status === 200 && !('wired' in legacyIssue.json))

  // ---- PARITY and key sharing ------------------------------------------------------------------------------------------------------------------------------------------------------
  const ledgerSeen = []
  let checkedScopes = 0
  for (const [index, [name, icQuery, productsUrl]] of SCOPES.entries()) {
    for (const viewer of ['admin', 'checker', 'stockOnly']) {
      // A filter on a field the viewer's grants hide is refused; a search by text without the barcode field is name-only (another key, by design).
      if ((icQuery.includes('brand=') && !FIELDS[viewer].brand) || (icQuery.includes('category=') && !FIELDS[viewer].category)) {
        app.setUser(U[viewer]); const hidden = await app.get(`/api/inventory-checks/list?${icQuery}`)
        check(`${name} / ${viewer}: a filter on a hidden field is refused 403`, hidden.status === 403)
        checkedScopes++
        continue
      }
      const sharesKey = !(icQuery.includes('query=') && !FIELDS[viewer].barcode)
      // What ONE cold read of this scope costs in page queries (a scope may run more than one statement), measured on an empty cache.
      app.setUser(U.admin); app.clearCaches()
      const coldStart = app.counters.pageQueries
      await app.get(productsUrl)
      const coldCost = app.counters.pageQueries - coldStart
      app.setUser(U[viewer]); app.clearCaches()
      const productsFirst = index < 5
      const pageBefore = app.counters.pageQueries
      mark = app.mark()
      app.setUser(U.admin)
      const asProducts = productsFirst ? await app.get(productsUrl) : null
      app.setUser(U[viewer])
      const wired = await app.get(`/api/inventory-checks/list${icQuery ? `?${icQuery}` : ''}`)
      const afterWired = app.counters.pageQueries
      // The comparison read asks for the lots token too (Inventory always does); it is not part of the key, so this read is a hit as well.
      const productsAfter = await (async () => { app.setUser(U.admin); return app.get(withLots(productsUrl)) })()
      app.setUser(U[viewer])
      ledgerSeen.push(...app.since(mark).filter((sql) => ledger.test(sql)))
      check(`${name} / ${viewer}: the wired list answers 200 and is marked wired`, wired.status === 200 && wired.json.wired === true)
      if (sharesKey) check(`${name} / ${viewer}: both routes together cost one cold read (${coldCost} page statement(s)) in either order: the second is a cache hit`, coldCost >= 1 && app.counters.pageQueries - pageBefore === coldCost && (productsFirst || afterWired - pageBefore === coldCost), () => JSON.stringify({ coldCost, pair: app.counters.pageQueries - pageBefore, afterWired: afterWired - pageBefore, productsFirst, wiredStatus: wired.status }))
      const expected = productsAfter.json.items.map((row) => expectedRow(row, FIELDS[viewer], PAGE[viewer]))
      check(`${name} / ${viewer}: rows are Products' rows with exactly the documented cut`, JSON.stringify(itemsOf(wired)) === JSON.stringify(expected), () => firstDiff(itemsOf(wired), expected))
      check(`${name} / ${viewer}: total, page and size are Products'`, wired.json.total === productsAfter.json.total && wired.json.page === productsAfter.json.page && (!sharesKey || wired.json.pageSize === productsAfter.json.pageSize))
      if (viewer === 'checker') {
        app.setUser(U.checker)
        const own = await app.get(withLots(productsUrl))
        check(`${name} / checker: a viewer whose Products answer needs no cut gets byte-identical rows and projected:false`, wired.json.projected === false && JSON.stringify(itemsOf(wired)) === JSON.stringify(own.json.items))
      } else if (viewer === 'admin') {
        check(`${name} / admin: cost is cut, so the answer says projected:true (the page must not hand it to Products' store)`, wired.json.projected === true && !JSON.stringify(wired.json.items).includes('cost_price'))
      } else check(`${name} / stockOnly: projected:true`, wired.json.projected === true)
      checkedScopes++
    }
  }
  check(`${checkedScopes} scope/viewer combinations checked (10 scopes x 3 viewers)`, checkedScopes === 30)
  const blindScope = await (async () => { app.setUser(U.blind); app.clearCaches(); const r = await app.get('/api/inventory-checks/list'); app.setUser(U.admin); const p = await app.get(SCOPES[0][2]); return { r, p } })()
  check('blind: the cut is exactly the documented one (brand and category only)', JSON.stringify(itemsOf(blindScope.r)) === JSON.stringify(blindScope.p.json.items.map((row) => expectedRow(row, FIELDS.blind, false))))
  const blindText = JSON.stringify(blindScope.r.json)
  check('blind: no stock figure anywhere (no stock_quantity, no branch quantity, no tagged_lots, no lots)', !/stock_quantity|"quantity"|tagged_lots|"lots"/.test(blindText))
  check('blind: no cost, price, barcode or supplier', !/cost_price|selling_price|barcode|"sku"|supplier|description/.test(blindText))
  // Defence in depth: whatever the route asked the reader for, the projection itself drops held stock for a viewer without the stock field.
  const lib = app.load('lib/inventoryCheckList.ts'), accessOf = app.load('lib/inventoryCheckAccess.ts').getInventoryCheckAccess
  const direct = lib.projectInventoryList({ items: [], tagged_lots: [{ product_id: 1, quantity: 2 }], promotion_rules: [{ id: 1 }] }, U.blind, accessOf(U.blind), false).body
  check('the projection drops held stock and promotion rules for a blind viewer even when handed them', !('tagged_lots' in direct) && !('promotion_rules' in direct))
  const kept = lib.projectInventoryList({ items: [], tagged_lots: [{ product_id: 1, quantity: 2 }] }, U.stockOnly, accessOf(U.stockOnly), false).body
  check('and keeps held stock for a viewer with the stock field', Array.isArray(kept.tagged_lots))
  app.setUser(U.receivedOnly); app.clearCaches()
  const received = await app.get('/api/inventory-checks/list')
  const row = itemsOf(received).find((r) => r.lots && r.lots.length)
  check('received dates without stock: lots keep their dates and branch ids but no quantity, no supplier', row && row.lots.every((l) => l.received_at && l.branches.every((b) => !('quantity' in b)) && !('supplier_name' in l)))
  app.setUser(U.none)
  const none = await app.get('/api/inventory-checks/list')
  check('no Inventory Check grant: 403', none.status === 403)
  check('no statement of either route reads the stock ledger, across all of the above', ledgerSeen.length === 0)
  app.setUser(U.checker)
  mark = app.mark()
  await app.get('/api/inventory-checks/products?page=1&pageSize=5')
  check('control: the pin can see the ledger (the old list reads it)', app.since(mark).some((sql) => ledger.test(sql)))

  // ---- query validation ------------------------------------------------------------------------------------------------------------------------------------------------------------
  app.setUser(U.checker)
  for (const [label, query] of [['stock sort is dropped', 'sortBy=stock'], ['unknown key', 'bogus=1'], ['a duplicated key', 'page=1&page=2'], ['page 0', 'page=0'], ['pageSize 101', 'pageSize=101'],
    ['a check state needs a branch', 'checkState=issue'], ['unknown check state', 'branchId=1&checkState=weird'], ['ids and a check state', 'branchId=1&checkState=issue&ids=1'], ['sort alias', 'sort_by=name']]) {
    const r = await app.get(`/api/inventory-checks/list?${query}`)
    check(`${label}: 400`, r.status === 400)
  }
  app.setUser(U.stockOnly)
  check('a hidden-field filter is refused 403 (brand without the brand grant)', (await app.get('/api/inventory-checks/list?brand=Brand%20A')).status === 403)

  // ---- check-state filters ---------------------------------------------------------------------------------------------------------------------------------------------------------
  app.setUser(U.checker); app.clearCaches()
  const state = async (checkState, extra = '') => app.get(`/api/inventory-checks/list?branchId=1&checkState=${checkState}${extra}`)
  const idSet = (r) => itemsOf(r).map((x) => x.id).sort((a, b) => a - b).join(',')
  const issue = await state('issue'), ok = await state('ok'), pending = await state('pending'), notChecked = await state('not_checked')
  check('Issues: only products whose LATEST observation at the branch is an issue (102), not 101 (a newer done) nor other branches or organizations', idSet(issue) === '102')
  check('Counted: latest done (100, 101, 106)', idSet(ok) === '100,101,106')
  check('Pending: products with a count line waiting for approval (106)', idSet(pending) === '106')
  check('Not checked: everything else of the catalogue, none of the checked (103, 104, 105, 107-111)', idSet(notChecked) === '103,104,105,107,108,109,110,111')
  check('the totals follow the restricted cohort', issue.json.total === 1 && ok.json.total === 3 && notChecked.json.total === 8)
  check('the summary counts are IC data: counted 3, issues 1, pending 1', ok.json.summary && ok.json.summary.ok === 3 && ok.json.summary.issue === 1 && ok.json.summary.pending === 1)
  const whole = await app.get('/api/inventory-checks/list?branchId=1')
  check('an unfiltered list also says Not checked (catalogue total 12 minus 4 checked = 8)', whole.json.summary.not_checked === 8 && whole.json.summary.total === 12)
  check('a filtered list does not claim a Not checked figure', !('not_checked' in ok.json.summary))
  const noSummary = await app.get('/api/inventory-checks/list?branchId=1&summary=0')
  check('summary=0 skips the counts', !('summary' in noSummary.json))
  // The overlay carries the same strip counts and the same Fix stock capability as the list, for the branch and grants of the viewer (a page fed from Products' store has no list answer).
  for (const viewer of ['admin', 'checker', 'receivedOnly', 'blind']) {
    app.setUser(U[viewer])
    const listed = await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
    const wholeList = await app.get('/api/inventory-checks/list?branchId=1')
    const overlaid = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101')
    check(`overlay summary equals the list summary (${viewer})`, listed.status === 200 && overlaid.status === 200 && JSON.stringify(overlaid.json.summary) === JSON.stringify(listed.json.summary) && Boolean(overlaid.json.summary))
    const { not_checked: _notChecked, total: _total, ...wholeCounts } = wholeList.json.summary
    check(`and the unfiltered list's counts (${viewer}); Not checked and total stay with the page's own Products total`, JSON.stringify(overlaid.json.summary) === JSON.stringify(wholeCounts))
    check(`overlay capabilities equal the list capabilities (${viewer})`, JSON.stringify(overlaid.json.capabilities ?? null) === JSON.stringify(listed.json.capabilities ?? null))
    check(`pending is in the overlay summary only for a viewer who may see stock (${viewer})`, ('pending' in overlaid.json.summary) === ('pending' in listed.json.summary))
    const overlayNoSummary = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100&summary=0')
    check(`summary=0 leaves the overlay counts out and keeps capabilities (${viewer})`, !('summary' in overlayNoSummary.json) && JSON.stringify(overlayNoSummary.json.capabilities ?? null) === JSON.stringify(listed.json.capabilities ?? null))
  }
  app.setUser(U.admin)
  const capsAdmin = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100'), capsChecker = await (async () => { app.setUser(U.checker); return app.get('/api/inventory-checks/overlay?branchId=1&ids=100') })()
  app.setUser(U.admin)
  check('capabilities differ by grant: the control that proves the comparison can fail (approveCounts for admin, not for the checker)', capsAdmin.json.capabilities.approveCounts === true && capsChecker.json.capabilities.approveCounts === false)
  app.setUser(U.receivedOnly)
  const blindPending = await app.get('/api/inventory-checks/list?branchId=1&checkState=pending')
  check('G12: Pending for a viewer without the stock field is an empty page (200), not a 400 a tab would repeat; and the same page with the choice off still lists products', blindPending.status === 200 && blindPending.json.items.length === 0 && blindPending.json.total === 0 && (await app.get('/api/inventory-checks/list?branchId=1')).json.items.length > 0, JSON.stringify(blindPending.json).slice(0, 200))
  app.setUser(U.checker)
  // the restricted read is its own cache entry and does not disturb the plain one
  const pageBefore = app.counters.pageQueries
  await state('issue'); await app.get('/api/inventory-checks/list?branchId=1')
  check('a repeated restricted read and the plain read are both cache hits', app.counters.pageQueries === pageBefore)
  // over the plan's id limit
  app.raw.exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('sBig',NULL,1,71,'Big','closed','{}','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    WITH RECURSIVE n(i) AS (SELECT 20000 UNION ALL SELECT i+1 FROM n WHERE i<22100)
    INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at)
    SELECT 'sBig',i,1,'{}',1,'{}','done',1,1,71,'2026-11-04T00:00:00.000Z' FROM n`)
  const freeEnv = { ...app.env, PLAN_TIER: 'free' }
  app.clearCaches(); app.kv.clear()
  const tooBig = await app.get('/api/inventory-checks/list?branchId=1&checkState=not_checked', freeEnv)
  check('Free: a checked set over inventoryCheckFilterMaxIds (2,000) is refused 503 inventory_check_filter_too_large', tooBig.status === 503 && tooBig.json.code === 'inventory_check_filter_too_large')
  const stillPlain = await app.get('/api/inventory-checks/list?branchId=1', freeEnv)
  check('the plain list still answers (without a summary) when the sets are too large', stillPlain.status === 200 && !('summary' in stillPlain.json))
  app.clearCaches()
  const paidBig = await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
  check('Paid: the same set (10,000) is served', paidBig.status === 200 && paidBig.json.summary.ok > 2000 && paidBig.json.total === 3)

  // ---- overlay ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  app.clearCaches(); app.kv.clear()
  app.setUser(U.checker)
  const overlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101,102,103,106,111')
  check('overlay answers 200 for the window', overlay.status === 200 && overlay.json.items.length === 6)
  const byId = Object.fromEntries(overlay.json.items.map((e) => [e.product_id, e]))
  check('count entry: 100 done 5, seen 5, with the name of who counted (the viewer is the counter)', byId[100].check.state === 'ok' && byId[100].check.counted_quantity === 5 && byId[100].check.seen_quantity === 5 && byId[100].check.by === 'u72')
  check('count entry: the LATEST observation wins (101: done in the newer session, not the older issue)', byId[101].check.state === 'ok' && byId[101].check.session_id === 'sB' && byId[101].check.counted_quantity === 3)
  check('count entry: 102 is an issue with its note', byId[102].check.state === 'issue' && byId[102].check.note === 'Damaged box')
  check('an unstarted line is not a count entry (103), and an unchecked product has none (111)', !byId[103].check && !byId[111].check)
  check('pending mark on 106 only', byId[106].pending === true && !byId[100].pending && !byId[101].pending)
  check('last movement: 14:00 beats ISO 09:00 of the same day (product 100)', byId[100].last_change_at === '2026-11-03 14:00:00')
  check('last movement: a product with only an ISO row (101)', byId[101].last_change_at === '2026-11-02T08:00:00.000Z')
  check('last movement: a product with none is null (102)', byId[102].last_change_at === null)
  check('overlay carries the inventory_checks version and no stock quantity of the product', typeof overlay.json.version === 'string' && !/stock_quantity/.test(JSON.stringify(overlay.json)))
  const overlayStatements = app.batches.filter((b) => /inventory_check_items|inventory_movements/.test(b.sql))
  const oneBatch = app.batches.slice(-3)
  check('the overlay reads ran in ONE batch of three statements (counts, pending, last movement)', oneBatch.length === 3 && /inventory_check_items/.test(oneBatch[0].sql) && /inventory_check_approvals/.test(oneBatch[1].sql) && /inventory_movements/.test(oneBatch[2].sql))
  check('the movement lookup is two index steps: newest day, then julianday over a bounded subselect', /ORDER BY m\.created_at DESC, m\.id DESC LIMIT 1/.test(oneBatch[2].sql) && /julianday\(recent\.created_at\)/.test(oneBatch[2].sql) && /LIMIT @lastChangeRows/.test(oneBatch[2].sql))
  check('the movement lookup is bounded by the plan field (Paid 8)', oneBatch[2].params.lastChangeRows === 8 && JSON.parse(oneBatch[2].params.ids).length === 6)
  check('overlay statements never mention the ledger', !app.since(0).some((sql) => ledger.test(sql) && /inventory_movements|inventory_check_approvals/.test(sql)))
  void overlayStatements
  const freeOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100', freeEnv)
  check('Free: the same lookup is bounded at 4 rows per product', freeOverlay.status === 200 && app.batches.slice(-1)[0].params.lastChangeRows === 4)
  const tooMany = await app.get(`/api/inventory-checks/overlay?branchId=1&ids=${Array.from({ length: 151 }, (_, i) => i + 1).join(',')}`, freeEnv)
  check('Free: more than inventoryOverlayMaxRows (150) ids is refused 400', tooMany.status === 400)
  const paidMany = await app.get(`/api/inventory-checks/overlay?branchId=1&ids=${Array.from({ length: 151 }, (_, i) => i + 1).join(',')}`)
  check('Paid: 151 ids is served (limit 300)', paidMany.status === 200)
  for (const [label, query] of [['no ids', 'branchId=1'], ['no branch', 'ids=100'], ['bad id', 'branchId=1&ids=1,x'], ['zero branch', 'branchId=0&ids=1']]) check(`overlay ${label}: 400`, (await app.get(`/api/inventory-checks/overlay?${query}`)).status === 400)
  const overlayLib = app.load('lib/inventoryCheckOverlay.ts')
  const directOverlay = await overlayLib.readInventoryOverlay(app.env, U.blind, { branchId: 1, ids: [106], pendingAvailable: true })
  check('a viewer without the stock field is never told about pending counts, whatever the caller allows', !directOverlay[0].pending)
  app.setUser(U.blind)
  const blindOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101,106')
  const blindEntries = Object.fromEntries(blindOverlay.json.items.map((e) => [e.product_id, e]))
  check('blind counter: no seen figure, no pending mark, and the counted figure only for their own sessions', !JSON.stringify(blindOverlay.json).includes('seen_quantity') && !blindEntries[106].pending && blindEntries[100].check.counted_quantity === undefined)
  check('blind counter: names follow the staff-identity rule (not 72 s name)', blindEntries[100].check.by === undefined)
  app.setUser(U.admin)
  const adminOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=103&lots=1')
  check('lots=1 returns the received dates for the same ids through the same reader', adminOverlay.json.lots && adminOverlay.json.lots[0].product_id === 103 && adminOverlay.json.lots[0].lots[0].lot_code === 'L103' && adminOverlay.json.lots[0].lots[0].branches[0].quantity === 13)
  app.setUser(U.receivedOnly)
  const receivedOverlay = await app.get('/api/inventory-checks/overlay?branchId=1&ids=103&lots=1')
  check('lots for a viewer without stock carry no quantity', receivedOverlay.json.lots[0].lots[0].branches.every((b) => !('quantity' in b)))
  app.setUser(U.none)
  check('overlay without the Inventory Check grant: 403', (await app.get('/api/inventory-checks/overlay?branchId=1&ids=100')).status === 403)

  // ---- writers move the version ----------------------------------------------------------------------------------------------------------------------------------------------------
  app.setUser(U.checker); app.clearCaches()
  const cache = app.load('lib/cache.ts')
  const version = () => cache.getVersionWithFallback(app.env, 'inventory_checks')
  const before = await version()
  const warm = await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
  check('before the write: Counted holds 100, 101, 106', idSet(warm) === '100,101,106')
  app.raw.exec(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at)
    VALUES('sB',111,1,'{}',21,'{}','done',21,1,71,'2026-11-04T05:00:00.000Z')`)
  const stale = await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
  check('the sets are cached on the inventory_checks version: a row written behind the Worker is not seen yet', idSet(stale) === '100,101,106' && (await version()) === before)
  const refused = await app.send('PATCH', '/api/inventory-checks/sessions/sA', { action: 'bogus', expectedRevision: 0, requestId: 'req-refused-0001' })
  const afterRefusal = await version()
  // A refusal before the write (here an invalid action, 400) moves nothing; a 5xx (an unknown outcome) may have written and does move it.
  check('a refused write (4xx) does not move the version', refused.status >= 400 && refused.status < 500 && afterRefusal === before, JSON.stringify({ status: refused.status, body: refused.json, before, now: afterRefusal }))
  app.delayKvWrites(150) // slow KV: only an AWAITED bump has landed by the time the answer is back
  const closed = await app.send('PATCH', '/api/inventory-checks/sessions/sA', { action: 'close', expectedRevision: 0, requestId: 'req-close-00001' })
  const movedAtAnswer = (await version()) !== before
  app.delayKvWrites(0)
  check('a real Inventory Check writer answers 200', closed.status === 200, JSON.stringify(closed.json))
  check('and the inventory_checks version moved before it answered (awaited, even with slow KV)', movedAtAnswer)
  const fresh = await app.get('/api/inventory-checks/list?branchId=1&checkState=ok')
  check('so the next read has the new set (111 now counted)', idSet(fresh) === '100,101,106,111')
  app.setSwitch('ic_wired', 'off')
  const offBefore = await version()
  const offWrite = await app.send('PATCH', '/api/inventory-checks/sessions/sA', { action: 'resume', expectedRevision: 1, requestId: 'req-resume-0001' })
  check('G6: with ic_wired OFF the writer STILL moves the version, so a copy cached while ON cannot serve a stale Issues filter after a flip back', offWrite.status === 200 && (await version()) !== offBefore)
  console.log(`\n${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
