// Owner, 5 Oct 2026: the Employee default on Products is product-information edits
// and image upload, WITHOUT cost price and (evening revision) WITHOUT changing a product's
// default selling or wholesale price (the products:price action; they adjust a price per sale in the POS cart).
// Every employee product edit leaves an audit Record AND sends a concise bilingual Telegram alert; the
// Telegram transport is a stub here, so this test never reaches the network. Runs the REAL products routes (harness of
// test-product-resolve-choices-native.cjs) as a user holding exactly the seeded
// Employee role (coreDataInvariants DEFAULT_ROLE_PERMISSIONS.employee, read from the
// source, not copied), and as the other roles the shop runs.
//
//   allowed  PUT a product's information (name, category) passes the permission gate
//   refused  default price change -> 403 product_price_edit_required; an unchanged price is not a change
//            cost price write -> 403 product_cost_edit_required; add, delete, bulk
//            delete, variant, merge, dismiss, zero-quantity cleanup, lookups, rename
//            brand, and the catalog-wide bulk price adjust -> 403
//
// Run (from cloudflare/scripts): node test-employee-products-default-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
// The harness leaves lib/reviewGate inert, which reads as "queued for review" (202). A Full-tier
// actor is never queued, so give it the real answer for Full: null.
const harnessBase = fs.readFileSync(path.join(__dirname, 'test-product-resolve-choices-native.cjs'), 'utf8').split('async function main() {')[0]
// The route also writes an audit row with the changed fields; the harness audit stub has none, so add the shape.
// The route needs the REAL money-plan code (the price gate reads the plan), the real alert formatter, and a Telegram stub that
// records instead of sending. changedFields is a plain key diff (the audit library is not under test here).
const harness = harnessBase
  .replace("  '../lib/cache':", "  '../lib/reviewGate': { maybeQueueForReview: async () => null },\n  '../lib/conflictControl': { getExpectedUpdatedAt: () => null, assertUpdatedAtMatch: () => {}, writeConflictResponse: () => null, WriteConflictError: class extends Error {} },\n  '../lib/telegram': { sendTelegramEvent: async (_env, event) => { TELEGRAM.push(event) } },\n  '../lib/productEditAlert': load('lib/productEditAlert.ts'),\n  '../lib/productWrites': { ...load('lib/productWrites.ts', { './db': { getDb: () => adapter }, './moneyPrecision': moneyPrecision, './catalogCostRecompute': catalogCost }), updateRow: updateRowStub },\n  '../lib/cache':")
  .replace("const noAudit = { audit: async () => {} }", "const TELEGRAM = []\nconst AUDITS = []\nconst UPDATABLE = ['name', 'category', 'brand', 'unit', 'barcode', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'cost_price_usd', 'cost_price_khr']\nasync function updateRowStub(_env, _table, id, body) { const keys = UPDATABLE.filter((key) => Object.hasOwn(body, key)); if (!keys.length) return 0; const params = { id: Number(id), updated_at: new Date().toISOString() }; for (const key of keys) params[key] = body[key]; return adapter.prepare('UPDATE products SET ' + keys.map((key) => key + ' = @' + key).join(', ') + ', updated_at = @updated_at WHERE id = @id').run(params).changes }\nconst plainDiff = (before, after) => { const b = {}; const a = {}; for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) { if (['updated_at', 'id'].includes(key) || JSON.stringify((before || {})[key]) === JSON.stringify((after || {})[key])) continue; b[key] = (before || {})[key]; a[key] = (after || {})[key] } return Object.keys(a).length ? { before: b, after: a } : null }\nconst noAudit = { audit: async (...args) => { AUDITS.push(args) }, changedFields: plainDiff, isSecretShapedAuditKey: (key) => /token|secret|password/i.test(key) }")
if (!harness.includes('maybeQueueForReview') || !harness.includes('plainDiff') || !harness.includes('productEditAlert')) throw new Error('the harness override anchors moved')
const checks = `
async function main() {
  const coreSource = fs.readFileSync(path.join(SRC, 'lib/coreDataInvariants.ts'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const start = coreSource.indexOf('const DEFAULT_ROLE_PERMISSIONS')
  const open = coreSource.indexOf('= {', start) + 2
  const end = coreSource.indexOf('\\n}\\n', open) + 2
  const SEED = new Function('return ' + coreSource.slice(open, end))()
  assert.ok(SEED.employee && SEED.admin, 'seed read from coreDataInvariants.ts')
  const asRole = (id, role, own = {}) => ({ id, username: role, name: role, role_code: role, role_permissions: JSON.stringify(SEED[role] || {}), permissions: JSON.stringify(own) })
  const EMPLOYEE_USER = asRole(21, 'employee')
  const MANAGER_USER = asRole(22, 'manager', { products: true })
  const EMPLOYEE_WITH_COST = asRole(23, 'employee', { product_cost_view: true, product_cost_edit: true })
  const DENIED = 'You do not have permission to perform this action'

  await check('the seeded Employee holds exactly View, Edit and Image on Products and neither cost grant', async () => {
    assert.equal(SEED.employee.products, true)
    assert.equal(SEED.employee.product_cost_view, false)
    assert.equal(SEED.employee.product_cost_edit, false)
    const tier = (action) => permissions.getActionTier(EMPLOYEE_USER, 'products', action)
    for (const action of ['view', 'edit', 'image']) assert.equal(tier(action), 'full', action)
    assert.equal(SEED.employee['products:price'], false, 'the seed switches the default-price action off')
    assert.equal(SEED.employee['products:history'], false, 'the seed switches the Products sub-pages off')
    for (const action of ['add', 'delete', 'bulk_delete', 'variant', 'import', 'import_replace_all', 'export', 'merge_duplicates', 'zero_qty_cleanup', 'manage_lookups', 'price', 'history']) {
      assert.equal(tier(action), 'none', action)
    }
    assert.equal(acquisitionCostAccess.canViewAcquisitionCosts(EMPLOYEE_USER), false)
    assert.equal(acquisitionCostAccess.canEditAcquisitionCosts(EMPLOYEE_USER), false)
    assert.equal(acquisitionCostAccess.canViewAcquisitionCosts(EMPLOYEE_WITH_COST), true, 'an admin can still grant cost to a named employee')
    assert.equal(acquisitionCostAccess.canViewAcquisitionCosts(MANAGER_USER), false, 'a Manager does not see cost by default either')
    assert.equal(acquisitionCostAccess.canEditAcquisitionCosts(MANAGER_USER), false)
  })

  await check('Employee default: editing product information is allowed, a cost write is refused, and nothing else is reachable', async () => {
    fresh()
    state.user = EMPLOYEE_USER
    const row = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    const edited = await request('PUT', '/api/products/' + KEEP, { name: 'Glow Serum 30ml Renewed', category: 'Skin', expected_updated_at: row.updated_at })
    // The harness stubs the product write libraries, so what is under test here is the permission gate:
    // an information edit is not refused (no 403, no review queue 202) for the seeded Employee.
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.notEqual(edited.body.pending, true, 'a Full-tier Edit is applied, not queued')
    const before = dump()
    const cost = await request('PUT', '/api/products/' + KEEP, { cost_price_usd: 1 })
    assert.equal(cost.status, 403, JSON.stringify(cost.body))
    assert.equal(cost.body.code, 'product_cost_edit_required')
    assert.equal(dump(), before, 'a refused cost write changes nothing')
    for (const [method, url, body] of [
      ['POST', '/api/products', { name: 'New thing', selling_price_usd: 1 }],
      ['DELETE', '/api/products/' + M1, undefined],
      ['POST', '/api/products/bulk-delete-jobs', { ids: [M1] }],
      ['POST', '/api/products/variant', {}],
      ['POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: M1, keep: true }],
      ['POST', '/api/products/merge-duplicates', {}],
      ['POST', '/api/products/possible-duplicates/dismiss', {}],
      ['POST', '/api/products/zero-quantity-delete', {}],
      ['POST', '/api/products/lookups/replace', { kind: 'brand', from: 'Glowy', to: 'Other' }],
      ['POST', '/api/products/rename-brand', { from: 'Glowy', to: 'Other' }],
      ['POST', '/api/products/bulk-price-adjust', { direction: 'increase', amount: 10, fields: ['selling_price_usd'], preview: true }],
    ]) {
      const refused = await request(method, url, body)
      assert.equal(refused.status, 403, method + ' ' + url + ' -> ' + refused.status + ' ' + JSON.stringify(refused.body))
    }
    assert.equal(dump(), before, 'every refused action left the database untouched')
  })

  await check('the default selling and wholesale price is behind products:price: a changed price is refused for the Employee, an unchanged one and a Full Products role pass', async () => {
    fresh()
    const stored = one('SELECT selling_price_usd, wholesale_price_usd, selling_price_khr, updated_at FROM products WHERE id = ?', KEEP)
    assert.ok(stored.selling_price_usd > 0 && stored.wholesale_price_usd > 0, 'the fixture row carries both prices')
    state.user = EMPLOYEE_USER
    const before = dump()
    for (const change of [{ selling_price_usd: stored.selling_price_usd + 1 }, { wholesale_price_usd: stored.wholesale_price_usd + 1 }, { wholesale_price_usd: 0 }, { selling_price_khr: 99999 }]) {
      const refused = await request('PUT', '/api/products/' + KEEP, { name: 'Glow Serum 30ml', ...change, expected_updated_at: stored.updated_at })
      assert.equal(refused.status, 403, JSON.stringify(change) + ' ' + JSON.stringify(refused.body))
      assert.equal(refused.body.code, 'product_price_edit_required')
    }
    assert.equal(dump(), before, 'a refused price change writes nothing')
    // The editor posts the whole row back: the SAME price is not a change, so information edits still save.
    const same = await request('PUT', '/api/products/' + KEEP, { name: 'Glow Serum 30ml Renewed', selling_price_usd: stored.selling_price_usd, wholesale_price_usd: stored.wholesale_price_usd, expected_updated_at: stored.updated_at })
    assert.equal(same.status, 200, JSON.stringify(same.body))
    assert.equal(one('SELECT selling_price_usd FROM products WHERE id = ?', KEEP).selling_price_usd, stored.selling_price_usd)
    // Discriminating: the same request is allowed for a Full Products role and for an administrator.
    for (const [who, price] of [[MANAGER_USER, stored.selling_price_usd + 2], [ADMIN, stored.selling_price_usd + 3]]) {
      state.user = who
      const row = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
      const done = await request('PUT', '/api/products/' + KEEP, { selling_price_usd: price, expected_updated_at: row.updated_at })
      assert.equal(done.status, 200, who.username + ' ' + JSON.stringify(done.body))
      assert.equal(one('SELECT selling_price_usd FROM products WHERE id = ?', KEEP).selling_price_usd, price)
    }
    // A role with Edit on but the price action off is refused too, wherever it comes from.
    state.user = asRole(27, 'manager', { products: true, 'products:price': false })
    const row = one('SELECT selling_price_usd, updated_at FROM products WHERE id = ?', KEEP)
    const narrowed = await request('PUT', '/api/products/' + KEEP, { selling_price_usd: row.selling_price_usd + 1, expected_updated_at: row.updated_at })
    assert.equal(narrowed.status, 403, JSON.stringify(narrowed.body))
  })

  await check('the Employee reaches ONLY the main Products page: every sub-page read is refused by the Worker, a Full Products role still gets through', async () => {
    fresh()
    state.user = EMPLOYEE_USER
    const subPages = [
      ['GET', '/api/products/stock-ledger'],
      ['GET', '/api/products/stock-ledger/1/balance'],
      ['GET', '/api/products/stock-in-sessions'],
      ['GET', '/api/products/stock-in-session-lines?key=x'],
      ['GET', '/api/products/' + KEEP + '/detail-report'],
      ['GET', '/api/products/' + KEEP + '/sales-detail?mode=day&period=2026-10-01'],
      ['GET', '/api/products/' + KEEP + '/supplier-purchases?supplierKey=x'],
      ['GET', '/api/products/auto-merges/' + KEEP],
      ['GET', '/api/products/lookups/usage'],
      ['GET', '/api/products/possible-duplicates'],
      ['GET', '/api/products/merge-duplicates/preview'],
      ['GET', '/api/products/possible-duplicates/merge-preview?keepId=' + KEEP + '&mergeId=' + M1 + '&keep=1'],
      ['GET', '/api/products/zero-quantity-candidates'],
    ]
    // Only the permission answer matters here; the harness database is not built for every report query, so a
    // permitted read may answer 500, which is NOT the gate refusing (status is read without parsing the body).
    const statusOf = async (method, url, body) => {
      const init = { method, headers: { 'Content-Type': 'application/json' } }
      if (body !== undefined) init.body = JSON.stringify(body)
      planTier.__resetPlanTierCacheForTests()
      return (await app.request(url, init, { DB: {}, PLAN_TIER: state.tier }, { waitUntil: () => {}, passThroughOnException: () => {} })).status
    }
    for (const [method, url, body] of subPages) {
      assert.equal(await statusOf(method, url, body), 403, method + ' ' + url)
    }
    // (The main page itself -- list, search, filters, an information edit -- stays open: the edit checks above and below pass for this same user.)
    // Discriminating: the same sub-page reads are not refused for a Full Products role, and an explicit history-off narrows one.
    for (const [method, url, body] of subPages.slice(0, 9)) {
      state.user = MANAGER_USER
      assert.notEqual(await statusOf(method, url, body), 403, 'manager ' + method + ' ' + url)
    }
    state.user = asRole(28, 'manager', { products: true, 'products:history': false })
    for (const url of ['/api/products/stock-ledger', '/api/products/stock-in-sessions', '/api/products/' + KEEP + '/detail-report']) {
      assert.equal(await statusOf('GET', url), 403, 'history off narrows ' + url)
    }
  })

  await check('a merge by a non-admin is Recorded and announced once; an administrator merge, a refused merge and a replay send nothing', async () => {
    fresh()
    TELEGRAM.length = 0
    state.user = EMPLOYEE_USER
    const refused = await request('POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: M1, keep: true })
    assert.equal(refused.status, 403)
    assert.equal(TELEGRAM.length, 0, 'a refused merge sends no alert')
    state.user = MANAGER_USER
    const done = await request('POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: M1, keep: true })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(TELEGRAM.length, 1, 'one alert for one merge')
    assert.equal(TELEGRAM[0].type, 'products')
    assert.equal(TELEGRAM[0].heading, '🔀 Products merged')
    const names = one('SELECT (SELECT name FROM products WHERE id = ?) AS kept, (SELECT name FROM products WHERE id = ?) AS merged', KEEP, M1)
    const text = TELEGRAM[0].lines.join('|')
    assert.ok(text.includes('Product: ' + names.kept), text)
    assert.ok(text.includes('Merged: ' + names.merged), text)
    assert.match(text, /By: manager/)
    const replay = await request('POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: M1, keep: true })
    assert.ok(replay.status >= 400 || replay.body.replayed === true, 'the second request is a replay or refusal')
    assert.equal(TELEGRAM.length, 1, 'a replay or refusal sends nothing more')
    fresh()
    TELEGRAM.length = 0
    state.user = ADMIN
    assert.equal((await request('POST', '/api/products/possible-duplicates/merge', { keepId: KEEP, mergeId: M1, keep: true })).status, 200)
    assert.equal(TELEGRAM.length, 0, 'administrator merges are not announced')
  })

  await check('every non-admin product edit leaves a Record AND one concise Telegram alert; administrators and refused edits send none', async () => {
    fresh()
    TELEGRAM.length = 0
    AUDITS.length = 0
    state.user = EMPLOYEE_USER
    const row = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    const edited = await request('PUT', '/api/products/' + KEEP, { name: 'Glow Serum Alert', category: 'Alert Cat', expected_updated_at: row.updated_at })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(AUDITS.filter((a) => a[3] === 'update' && a[4] === 'product').length, 1, 'the Record is written')
    assert.equal(TELEGRAM.length, 1, 'one alert')
    const [event] = TELEGRAM
    assert.equal(event.type, 'products')
    assert.equal(event.heading, '✏️ Product edited')
    const text = event.lines.join('|')
    assert.match(text, /Product: Glow Serum Alert/)
    assert.match(text, /Changed: name, category/)
    assert.match(text, /By: employee/)
    assert.doesNotMatch(text, /cost/i, 'cost is never named in the alert')
    // Refused edits (price, cost) change nothing and tell nobody.
    TELEGRAM.length = 0
    const next = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    assert.equal((await request('PUT', '/api/products/' + KEEP, { selling_price_usd: 777, expected_updated_at: next.updated_at })).status, 403)
    assert.equal((await request('PUT', '/api/products/' + KEEP, { cost_price_usd: 1, expected_updated_at: next.updated_at })).status, 403)
    assert.equal(TELEGRAM.length, 0, 'a refused edit sends no alert')
    // An administrator's own edit is Recorded but never announced.
    state.user = ADMIN
    AUDITS.length = 0
    const adminRow = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    const adminEdit = await request('PUT', '/api/products/' + KEEP, { name: 'Glow Serum Admin', expected_updated_at: adminRow.updated_at })
    assert.equal(adminEdit.status, 200, JSON.stringify(adminEdit.body))
    assert.equal(AUDITS.filter((a) => a[3] === 'update' && a[4] === 'product').length, 1)
    assert.equal(TELEGRAM.length, 0, 'administrator edits are not announced')
  })

  await check('the catalog-wide bulk price adjust needs Edit product, the price action AND the catalog-wide action; a Full Products role keeps it', async () => {
    fresh()
    for (const [who, expected] of [
      [MANAGER_USER, 200],
      [ADMIN, 200],
      [asRole(24, 'manager', { products: true, 'products:edit': false }), 403],
      [asRole(25, 'manager', { products: true, 'products:manage_lookups': false }), 403],
      [asRole(26, 'manager', { products: true, 'products:price': false }), 403],
      [EMPLOYEE_USER, 403],
    ]) {
      state.user = who
      const reply = await request('POST', '/api/products/bulk-price-adjust', { direction: 'increase', amount: 10, fields: ['selling_price_usd'], preview: true })
      assert.equal(reply.status, expected, who.username + ': ' + JSON.stringify(reply.body))
    }
  })

  await check('Employee default with the cost grants added by an admin may write a cost; the default alone never does', async () => {
    fresh()
    state.user = EMPLOYEE_WITH_COST
    const row = one('SELECT updated_at FROM products WHERE id = ?', KEEP)
    const done = await request('PUT', '/api/products/' + KEEP, { cost_price_usd: 4.5, expected_updated_at: row.updated_at })
    assert.equal(done.status, 200, JSON.stringify(done.body))
  })

  console.log(failed ? '\\n' + failed + ' check(s) failed' : '\\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
`
const runner = new Module(__filename, module)
runner.filename = __filename
runner.paths = module.paths
runner._compile(harness + checks, __filename)
