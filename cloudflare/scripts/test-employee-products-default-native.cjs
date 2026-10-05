// Owner, 5 Oct 2026: the Employee default on Products is product-information edits
// and image upload, WITHOUT cost price. Runs the REAL products routes (harness of
// test-product-resolve-choices-native.cjs) as a user holding exactly the seeded
// Employee role (coreDataInvariants DEFAULT_ROLE_PERMISSIONS.employee, read from the
// source, not copied), and as the other roles the shop runs.
//
//   allowed  PUT a product's information (name, category) passes the permission gate
//   refused  cost price write -> 403 product_cost_edit_required; add, delete, bulk
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
const harness = harnessBase
  .replace("  '../lib/cache':", "  '../lib/reviewGate': { maybeQueueForReview: async () => null },\n  '../lib/cache':")
  .replace("const noAudit = { audit: async () => {} }", "const noAudit = { audit: async () => {}, changedFields: () => ({}) }")
if (!harness.includes('maybeQueueForReview') || !harness.includes('changedFields')) throw new Error('the harness override anchors moved')
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
    for (const action of ['add', 'delete', 'bulk_delete', 'variant', 'import', 'import_replace_all', 'export', 'merge_duplicates', 'zero_qty_cleanup', 'manage_lookups']) {
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

  await check('the catalog-wide bulk price adjust needs Edit product AND the catalog-wide action; a Full Products role keeps it', async () => {
    fresh()
    for (const [who, expected] of [
      [MANAGER_USER, 200],
      [ADMIN, 200],
      [asRole(24, 'manager', { products: true, 'products:edit': false }), 403],
      [asRole(25, 'manager', { products: true, 'products:manage_lookups': false }), 403],
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
