// Owner, 5 Oct 2026: cost price is NEVER visible by default. This is the matrix of
// every surface that can carry an acquisition cost, and what keeps it from a user
// who holds neither product_cost_view nor product_cost_edit (the seeded Employee and
// Manager roles hold neither).
//
//   GRANTS    the seeded roles and the one-click Employee preset hold neither grant,
//             and the real permission helpers say so
//   SERVER    every route module that can emit a cost is classified: either its
//             responses go through acquisitionCostResponses / a canView... gate, or
//             it is listed as carrying no cost; a NEW route file fails until it is
//             classified, so a surface cannot appear unreviewed
//   WRITES    every catalog / receipt / import cost WRITE needs product_cost_edit
//   CLIENT    every component that renders a cost reads the same grant (the server
//             projection is the boundary; this is the second line)
//
// Runtime evidence for each row is named in the RUNTIME list and must exist.
// Run (from cloudflare/scripts): node test-cost-visibility-matrix-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log('PASS ' + name) }

function load(file) {
  const mod = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)((name) => (name.startsWith('.') ? load(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts')) : require(name)), mod, mod.exports)
  return mod.exports
}

const coreSource = read('cloudflare/src/lib/coreDataInvariants.ts')
const seedStart = coreSource.indexOf('const DEFAULT_ROLE_PERMISSIONS')
const seedOpen = coreSource.indexOf('= {', seedStart) + 2
const SEED = new Function('return ' + coreSource.slice(seedOpen, coreSource.indexOf('\n}\n', seedOpen) + 2))()
const access = load(path.join(root, 'cloudflare/src/lib/acquisitionCostAccess.ts'))
const frontendPermissions = load(path.join(root, 'frontend/src/utils/permissions.ts'))
const frontendAccess = load(path.join(root, 'frontend/src/utils/acquisitionCostAccess.ts'))
const presets = (() => {
  const source = read('frontend/src/components/users/rolePresetDefaults.ts')
  const employee = source.slice(source.indexOf("key: 'employee'"), source.indexOf("key: 'manager'"))
  return employee
})()

const session = (role, own = {}) => ({ id: 9, username: role, role_code: role, role_permissions: JSON.stringify(SEED[role] || {}), permissions: JSON.stringify(own) })

check('GRANTS: no seeded role except Admin can view or edit a cost, in the Worker or the browser', () => {
  for (const role of ['employee', 'manager']) {
    const user = session(role, role === 'manager' ? { products: true, inventory: true, sales: true, returns: true, contacts: true } : {})
    assert.equal(access.canViewAcquisitionCosts(user), false, role + ' view (Worker)')
    assert.equal(access.canEditAcquisitionCosts(user), false, role + ' edit (Worker)')
    assert.equal(frontendAccess.canViewAcquisitionCosts(user), false, role + ' view (browser)')
    assert.equal(frontendAccess.canEditAcquisitionCosts(user), false, role + ' edit (browser)')
  }
  assert.equal(access.canViewAcquisitionCosts(session('admin')), true)
  assert.equal(access.canEditAcquisitionCosts(session('admin')), true)
})

check('GRANTS: broad access never implies a cost grant (products, inventory, sales, returns, contacts, reports, settings all Full)', () => {
  const everything = { products: true, inventory: true, sales: true, returns: true, fees: true, contacts: true, branches: true, settings: true, audit_log: true, dashboard: true, backup: true }
  const user = session('manager', everything)
  assert.equal(access.canViewAcquisitionCosts(user), false)
  assert.equal(access.canEditAcquisitionCosts(user), false)
  assert.equal(access.canViewAcquisitionCosts(session('manager', { ...everything, product_cost_edit: true })), false, 'edit does not imply view')
  assert.equal(access.canEditAcquisitionCosts(session('manager', { ...everything, product_cost_view: true })), false, 'view does not imply edit')
  assert.equal(access.canViewAcquisitionCosts(session('manager', { product_cost_view: true })), true, 'only the explicit grant shows a cost')
})

check('GRANTS: the Employee seed and the one-click preset both carry the two cost grants as false, and agree', () => {
  assert.equal(SEED.employee.product_cost_view, false)
  assert.equal(SEED.employee.product_cost_edit, false)
  assert.match(presets, /product_cost_view: false/)
  assert.match(presets, /product_cost_edit: false/)
  for (const role of ['manager', 'admin']) {
    assert.equal(SEED[role].product_cost_view, undefined, role + ' seed grants no cost view by name')
    assert.equal(SEED[role].product_cost_edit, undefined)
  }
})

check('GRANTS: the Employee default holds Products View, Edit and Image and nothing else on Products', () => {
  const user = session('employee')
  const merged = frontendPermissions.effectivePermissions(user)
  assert.equal(merged.getPermissionTier('products'), 'full')
  const actions = ['view', 'add', 'edit', 'delete', 'bulk_delete', 'variant', 'image', 'import', 'import_replace_all', 'export', 'merge_duplicates', 'zero_qty_cleanup', 'manage_lookups']
  for (const action of actions) assert.equal(merged.can('products', action), ['view', 'edit', 'image'].includes(action), 'browser: ' + action)
  const permissions = load(path.join(root, 'cloudflare/src/lib/permissions.ts'))
  for (const action of actions) assert.equal(permissions.getActionTier(user, 'products', action) === 'full', ['view', 'edit', 'image'].includes(action), 'Worker: ' + action)
})

// ---- SERVER matrix ---------------------------------------------------------
// route file -> how its cost-bearing responses are governed
const PROJECTED = {
  'products.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /hasCatalogCostWrite\(body, user\)/],
  'inventory.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /hasAcquisitionCostInput/],
  'batches.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /canEditAcquisitionCosts/],
  'branches.ts': [/app\.use\('\*', acquisitionCostResponses\)/],
  'sales.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /canViewAcquisitionCosts/],
  'returns.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /canViewAcquisitionCosts/, /canEditAcquisitionCosts/],
  'stockInCommit.ts': [/app\.use\('\*', acquisitionCostResponses\)/],
  'importJobs.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /isAcquisitionCostImport/, /canEditAcquisitionCosts/],
  'actionHistory.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /projectAcquisitionCosts/],
  'reviewQueue.ts': [/app\.use\('\*', acquisitionCostResponses\)/, /hasAcquisitionCostInput/],
  'contacts.ts': [/app\.use\('\/suppliers', acquisitionCostResponses\)/, /app\.use\('\/suppliers\/\*', acquisitionCostResponses\)/],
  'compat.ts': [/app\.use\('\/dashboard', acquisitionCostResponses\)/, /app\.use\('\/analytics', acquisitionCostResponses\)/, /app\.use\('\/system\/audit-logs', acquisitionCostResponses\)/, /canViewAcquisitionCosts/],
  'reports.ts': [/canViewAcquisitionCosts/, /gateTotals/],
  'productCost.ts': [/canViewAcquisitionCosts/],
  'backups.ts': [/canViewAcquisitionCosts/, /canEditAcquisitionCosts/],
}
// route files that never put a cost-bearing field in a response (checked below)
const NO_COST = ['ai.ts', 'auth.ts', 'devices.ts', 'fees.ts', 'files.ts', 'lookups.ts', 'notes.ts', 'notifications.ts', 'organizations.ts',
  'portal.ts', 'pos.ts', 'promotions.ts', 'runtime.ts', 'settings.ts', 'shifts.ts', 'sync.ts', 'system.ts', 'telegram.ts', 'users.ts']
const COST_FIELD = /\b(cost_price_(?:usd|khr)|purchase_price_(?:usd|khr)|received_cost_usd|cost_usd|cogs|total_cost_usd)\b/

check('SERVER: every cost-bearing route module is governed by the projection middleware or an explicit cost gate', () => {
  for (const [file, patterns] of Object.entries(PROJECTED)) {
    const source = read('cloudflare/src/routes', file)
    for (const pattern of patterns) assert.match(source, pattern, file + ' must keep ' + pattern)
  }
})

check('SERVER: every route file is classified, so a new surface cannot ship unreviewed', () => {
  const files = fs.readdirSync(path.join(root, 'cloudflare/src/routes')).filter((name) => name.endsWith('.ts'))
  const known = new Set([...Object.keys(PROJECTED), ...NO_COST])
  for (const file of files) assert.ok(known.has(file), file + ' is new: classify it in PROJECTED (cost-bearing) or NO_COST (and justify it) before it ships')
  for (const file of known) assert.ok(files.includes(file), file + ' is classified but no longer exists')
})

check('SERVER: the NO_COST route files do not select or return a cost column in a response', () => {
  // portal/system mention cost in comments only; notifications selects unit_cost_usd but builds items without it.
  for (const file of NO_COST) {
    const source = read('cloudflare/src/routes', file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    // notifications.ts filters credit lots on received_cost_usd inside its SQL; nothing it builds returns a cost.
    const hit = source.replace(file === 'notifications.ts' ? /COALESCE\(pb\.received_cost_usd, 0\) > 0/g : /$^/, '').match(COST_FIELD)
    assert.equal(hit, null, file + ' mentions ' + (hit && hit[0]) + ' outside a comment; move it to PROJECTED with a gate, or remove the field')
  }
  const notifications = read('cloudflare/src/routes/notifications.ts')
  assert.doesNotMatch(notifications, /label:[^\n]*unit_cost|meta:[^\n]*unit_cost/, 'the credit reminder never prints the lot cost')
})

check('WRITES: every catalog / receipt / session cost write is behind product_cost_edit', () => {
  const products = read('cloudflare/src/routes/products.ts')
  assert.match(products, /hasCatalogCostWrite\(body, user\)/, 'PUT /products/:id')
  assert.match(products, /canEditAcquisitionCosts\(user\)/, 'bulk price adjust and merge cost choice')
  for (const file of ['inventory.ts', 'batches.ts', 'importJobs.ts']) {
    assert.match(read('cloudflare/src/routes', file), /canEditAcquisitionCosts|hasAcquisitionCostInput/, file + ' write gate')
  }
  // Stock sessions (stockInCommit.ts) validate the request inside lib/stockSession.ts.
  assert.match(read('cloudflare/src/lib/stockSession.ts'), /hasAcquisitionCostInput\(raw, user\)\) fail\('Cost-entry permission is required to enter receipt costs\.', 403, 'product_cost_edit_required'\)/)
})

// ---- CLIENT matrix ---------------------------------------------------------
const CLIENT_GATED = [
  'components/products/Products.tsx', 'components/products/forms/ProductForm.tsx', 'components/products/helpers/productExport.ts',
  'components/products/surfaces/ProductDetailModal.tsx', 'components/products/surfaces/ProductDetailReport.tsx',
  'components/products/StockChangeSection.tsx', 'components/products/StockInSessionsSection.tsx',
  'components/products/MergeStockChoiceDialog.tsx', 'components/products/MergeDuplicatesReviewModal.tsx', 'components/products/ProductDuplicatesTab.tsx',
  'components/products/SelectedConflictMergeReviewModal.tsx', 'components/products/productResolveAdapter.ts',
  'components/products/import/BulkImportModal.tsx', 'components/products/import/StockActionImportModal.tsx',
  'components/pos/ProductDetailSheet.tsx', 'components/inventory/Inventory.tsx', 'components/inventory/ProductDetailModal.tsx',
  'components/inventory/FastStockInModal.tsx', 'components/inventory/MovementDetailFloat.tsx', 'components/branches/Branches.tsx',
  'components/contacts/StockInInvoicesSection.tsx', 'components/contacts/SupplierPurchasesModal.tsx', 'components/contacts/ApInvoicesSection.tsx',
  'components/returns/Returns.tsx', 'components/shared/CostCalculationFloat.tsx', 'components/shared/StockLineChange.tsx',
  'components/stock-session/StockSessionItems.tsx', 'components/stock-session/StockSessionLineEntry.tsx',
  'components/stock-session/StockSessionPaymentStep.tsx', 'components/stock-session/StockSessionReviewStep.tsx',
]
check('CLIENT: every component that renders or edits a cost reads the explicit cost grant', () => {
  for (const file of CLIENT_GATED) {
    const source = read('frontend/src', file)
    assert.match(source, /canViewAcquisitionCosts|canEditAcquisitionCosts|hasPermission\('product_cost_(?:view|edit)'\)|canViewCosts|canEditCosts/, file + ' must read the cost grant')
  }
})

// ---- RUNTIME evidence ------------------------------------------------------
const RUNTIME = [
  'cloudflare/scripts/test-acquisition-cost-access.cjs', 'cloudflare/scripts/test-acquisition-cost-envelopes-native.cjs',
  'cloudflare/scripts/test-cost-grant-consistency.cjs', 'cloudflare/scripts/test-cost-residual-access.cjs',
  'cloudflare/scripts/test-reports-cost-visibility-pure.cjs', 'cloudflare/scripts/test-backup-read-cost-native.cjs',
  'cloudflare/scripts/test-employee-products-default-native.cjs',
  'frontend/tests/acquisitionCostAccess.test.ts', 'frontend/tests/acquisitionCostSecondarySurfaces.test.ts',
  'frontend/tests/stockCostAccess.test.ts', 'frontend/tests/supplierCostVisibility.test.ts', 'frontend/tests/rolePresetDefaults.test.ts',
]
check('RUNTIME: the tests that exercise each row of the matrix exist', () => {
  for (const file of RUNTIME) assert.ok(fs.existsSync(path.join(root, file)), file + ' is named as evidence and must exist')
})

console.log('\nALL ' + passed + ' CHECKS PASSED')
