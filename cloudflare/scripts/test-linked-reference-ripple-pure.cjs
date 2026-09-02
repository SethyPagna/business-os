// UXA-04 contract: a linked-reference write must invalidate the read-cache
// namespaces and live views that consume its mutable display data. Historical
// audit evidence remains immutable, and reference cascades never touch cost.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const repo = path.join(root, '..')
const readWorker = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const readFrontend = (relative) => fs.readFileSync(path.join(repo, 'frontend', relative), 'utf8')
const compact = (value) => value.replace(/\s+/g, ' ')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('category and unit carry invalidate the product cache and signal product readers', () => {
  const source = readWorker('src/routes/lookups.ts')
  assert.match(source, /bumpVersion\(c\.env, 'products'\)/)
  assert.match(source, /broadcast\(c\.env, 'products', \{ action: `\$\{kind\}_ripple`/)
  assert.match(source, /await db\.batch\(\[\.\.\.lookupStatements, \.\.\.carry\.statements\]\)/)
  assert.ok(source.indexOf("await bumpVersion(c.env, 'products')") < source.indexOf("broadcast(c.env, table, { action: duplicate"), 'cache version must advance before the live rename signal')
})

check('contact rename and merge advance every dependent version namespace', () => {
  const source = compact(readWorker('src/routes/contacts.ts'))
  assert.match(source, /config\.table === 'customers'[\s\S]*Versions\.push\('sales', 'returns'\)/)
  assert.match(source, /config\.table === 'suppliers'[\s\S]*Versions\.push\('products', 'returns'\)/)
  assert.match(source, /config\.table === 'delivery_contacts'[\s\S]*Versions\.push\('sales'\)/)
  assert.match(source, /await Promise\.all\(\[\.\.\.new Set\([^)]+Versions\)\]\.map\(\(namespace\) => bumpVersion\(c\.env, namespace\)\)\)/)
})

check('merge repoints stable ids and refreshes operational display snapshots', () => {
  const source = compact(readWorker('src/routes/contacts.ts'))
  assert.match(source, /UPDATE sales SET customer_id = @keepId, customer_name = @keeperName, customer_phone = @keeperPhone, customer_address = @keeperAddress WHERE customer_id = @mergeId/)
  assert.match(source, /UPDATE returns SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId/)
  assert.match(source, /UPDATE sales SET delivery_contact_id = @keepId, delivery_contact_name = @keeperName WHERE delivery_contact_id = @mergeId/)
  assert.match(source, /lower\(trim\(COALESCE\(supplier, ''\)\)\) = @mergedNameLower/)
})

check('user carry invalidates sales/returns and self-service rename emits the same users signal', () => {
  const source = readWorker('src/routes/users.ts')
  assert.ok((source.match(/Promise\.all\(\[bumpVersion\(c\.env, 'sales'\), bumpVersion\(c\.env, 'returns'\)\]\)/g) || []).length >= 2)
  assert.match(source, /broadcast\(c\.env, 'users', \{ action: 'update', id: targetId \}\)/)
})

check('open pages subscribe to every reference channel they render', () => {
  const sales = readFrontend('src/components/sales/Sales.tsx')
  const returns = readFrontend('src/components/returns/Returns.tsx')
  const inventory = readFrontend('src/components/inventory/Inventory.tsx')
  const branches = readFrontend('src/components/branches/Branches.tsx')
  const files = readFrontend('src/components/files/FilesPage.tsx')
  const review = readFrontend('src/components/review/ReviewQueue.tsx')
  const supplierPicker = readFrontend('src/components/shared/SupplierPickerField.tsx')
  const productForm = readFrontend('src/components/products/forms/ProductForm.tsx')
  for (const channel of ['customers', 'deliveryContacts', 'users', 'products', 'settings']) assert.ok(sales.includes(`'${channel}'`), `Sales misses ${channel}`)
  for (const channel of ['customers', 'suppliers', 'users']) assert.ok(returns.includes(`'${channel}'`), `Returns misses ${channel}`)
  assert.match(sales, /setDetailSale\(refreshOpen\)/, 'open sale detail must rebind to the refreshed stable id')
  assert.match(sales, /setSelectedSale\(refreshOpen\)/, 'open receipt/print must rebind to the refreshed stable id')
  assert.match(returns, /setDetailRet\(refreshOpen\)/, 'open return detail must rebind to the refreshed stable id')
  assert.match(returns, /setEditRet\(refreshOpen\)/, 'open return editor must rebind to the refreshed stable id')
  for (const channel of ['suppliers', 'users']) assert.ok(inventory.includes(`'${channel}'`), `Inventory misses ${channel}`)
  assert.match(branches, /channel === 'users'/)
  assert.match(files, /channel === 'files' \|\| channel === 'users'/)
  assert.match(review, /syncChannel\.channel === 'pendingActions' \|\| syncChannel\.channel === 'users'/)
  assert.match(sales, /syncChannel\.channel === 'users'\) setUserOptionsLoaded\(false\)/, 'cashier filter options must be invalidated')
  assert.match(supplierPicker, /ensureSupplierSyncCacheListener\(\)/, 'shared supplier-name cache must subscribe to invalidation')
  assert.match(supplierPicker, /invalidateSupplierNamesCache\(\)/)
  assert.match(productForm, /setSupplierReferenceVersion\(\(version\) => version \+ 1\)/, 'open product form must reload supplier options')
})

check('payment, reason and label changes have version/live refresh signals', () => {
  const settings = readWorker('src/routes/settings.ts')
  const inventory = readWorker('src/routes/inventory.ts')
  const returns = readWorker('src/routes/returns.ts')
  const fees = readWorker('src/routes/fees.ts')
  assert.match(settings, /bumpVersion\(c\.env, 'sales'\)/)
  assert.match(settings, /broadcast\(c\.env, 'settings', \{ action: 'payment_method_replace'/)
  assert.match(inventory, /broadcast\(c\.env, 'inventory', \{ action: 'reasons_replace'/)
  assert.match(returns, /bumpVersion\(c\.env, 'returns'\)/)
  assert.match(returns, /broadcast\(c\.env, 'returns', \{ action: 'reason_replace'/)
  assert.match(fees, /broadcast\(c\.env, 'fees', \{ action: 'label_replace'/)
})

check('reference ripples preserve audit history and never alter product cost', () => {
  const cascade = readWorker('src/lib/renameCascade.ts')
  const userIdentity = readWorker('src/lib/userIdentity.ts')
  const contacts = readWorker('src/routes/contacts.ts')
  assert.doesNotMatch(cascade, /(?:cost_price|unit_cost)/i)
  assert.doesNotMatch(userIdentity.match(/USER_NAME_SNAPSHOTS[\s\S]*?\n\]/)?.[0] || '', /audit_logs/)
  assert.match(contacts, /Immutable audit\/event rows are deliberately not rewritten/)
})

console.log(`\n${passed} linked-reference ripple checks passed.`)
