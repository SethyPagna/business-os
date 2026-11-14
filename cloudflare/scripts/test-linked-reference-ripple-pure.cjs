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
  // d1-queries S10 (6.0.1640s) moved the lookups writers from bumpVersion('products') to one bumpVersions(['products', 'lookups']) so the cached category/unit list
  // invalidates with the rows. The products bump must still happen on BOTH carrying writers (rename/merge and delete), and 'lookups' must ride with it.
  const carrying = source.match(/await bumpVersions\(c\.env, \['products', LOOKUP_CACHE_NAMESPACE\]\)/g) || []
  assert.strictEqual(carrying.length, 2, 'rename/merge and delete each bump products together with the lookups version')
  assert.match(source, /broadcast\(c\.env, 'products', \{ action: `\$\{kind\}_ripple`/)
  assert.match(source, /await db\.batch\(\[\.\.\.lookupStatements, \.\.\.carry\.statements\]\)/)
  const bumpAt = source.indexOf("await bumpVersions(c.env, ['products', LOOKUP_CACHE_NAMESPACE])")
  assert.ok(bumpAt > -1 && bumpAt < source.indexOf("broadcast(c.env, table, { action: duplicate"), 'cache version must advance before the live rename signal')
})

check('contact rename and merge advance every dependent version namespace', () => {
  const source = compact(readWorker('src/routes/contacts.ts'))
  assert.match(source, /config\.table === 'customers'[\s\S]*Versions\.push\('sales', 'returns'\)/)
  assert.match(source, /config\.table === 'suppliers'[\s\S]*Versions\.push\('products', 'returns'\)/)
  assert.match(source, /config\.table === 'delivery_contacts'[\s\S]*Versions\.push\('sales'\)/)
  // One bumpVersions([...]) call per commit (B-C10: one quota admission), not one bumpVersion per namespace.
  assert.match(source, /await bumpVersions\(c\.env, \[\.\.\.new Set\(updateVersions\)\]\)/)
  assert.match(source, /await bumpVersions\(c\.env, \[\.\.\.new Set\(mergeVersions\)\]\)/)
  assert.ok(!/bumpVersion\(c\.env, namespace\)/.test(source), 'no per-namespace bumpVersion loop is left in contacts.ts')
})

check('merge repoints stable ids and refreshes operational display snapshots', () => {
  const source = compact(`${readWorker('src/routes/contacts.ts')}\n${readWorker('src/lib/contactMerge.ts')}`)
  assert.match(source, /UPDATE sales SET customer_id = @keepId, customer_name = @keeperName, customer_phone = @keeperPhone, customer_address = @keeperAddress WHERE customer_id = @mergeId/)
  assert.match(source, /UPDATE returns SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId/)
  assert.match(source, /UPDATE sales SET delivery_contact_id = @keepId, delivery_contact_name = @keeperName WHERE delivery_contact_id = @mergeId/)
  assert.match(source, /UPDATE fees SET delivery_contact_id = @keepId/)
  assert.match(source, /lower\(trim\(COALESCE\(supplier, ''\)\)\) = @mergedNameLower/)
})

check('user carry invalidates sales/returns and self-service rename emits the same users signal', () => {
  const source = readWorker('src/routes/users.ts')
  assert.ok((source.match(/await bumpVersions\(c\.env, \['sales', 'returns'\]\)/g) || []).length >= 2)
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
  // d1-client C3 (6.0.1623) moved the Sales channel list out of the component into salesReloadCoalescer.ts (one trailing reload per burst). The page must still
  // react to every one of the eight reference channels, so pin the list where it now lives and that Sales.tsx feeds each sync event into the coalescer.
  const salesChannels = readFrontend('src/components/sales/salesReloadCoalescer.ts')
  for (const channel of ['sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings']) assert.ok(salesChannels.includes(`'${channel}'`), `Sales reload list misses ${channel}`)
  assert.ok(sales.includes('salesReloadRef.current?.note({ channel: syncChannel.channel, source: syncChannel.source })'), 'Sales must hand every sync event to the coalescer')
  for (const channel of ['customers', 'suppliers', 'users']) assert.ok(returns.includes(`'${channel}'`), `Returns misses ${channel}`)
  assert.match(sales, /setDetailSale\(refreshOpen\)/, 'open sale detail must rebind to the refreshed stable id')
  assert.match(sales, /setSelectedSale\(refreshOpen\)/, 'open receipt/print must rebind to the refreshed stable id')
  assert.match(returns, /setDetailRet\(refreshOpen\)/, 'open return detail must rebind to the refreshed stable id')
  assert.match(returns, /setEditRet\(\(current\) => current \? \{ \.\.\.\(refreshOpen\(current\) as ReturnRow\), updated_at: current\.updated_at \} : current\)/, 'open return editor must rebind to the refreshed stable id and keep the version its fields came from')
  for (const channel of ['suppliers', 'users']) assert.ok(inventory.includes(`'${channel}'`), `Inventory misses ${channel}`)
  assert.match(branches, /channel === 'users'/)
  assert.match(files, /channel === 'files' \|\| channel === 'users'/)
  assert.match(review, /syncChannel\.channel === 'pendingActions' \|\| syncChannel\.channel === 'users'/)
  // d1-client C3 (6.0.1623): the users channel now sets plan.userOptions in the coalescer, which the page turns into setUserOptionsLoaded(false) when the burst runs.
  assert.ok(salesChannels.includes("if (event.channel === 'users') plan.userOptions = true"), 'cashier filter options must be invalidated')
  assert.ok(sales.includes('if (plan.userOptions) setUserOptionsLoaded(false)'), 'the coalesced plan must reload the cashier options')
  // p9/perf-2: the supplier-name cache moved into the shared picker option
  // cache (frontend/src/api/pickerOptionsCache.ts); the invalidation
  // subscription lives there once per channel, and the picker goes through it.
  const pickerCache = readFrontend('src/api/pickerOptionsCache.ts')
  assert.match(pickerCache, /window\.addEventListener\('sync:update'/, 'shared picker option cache must subscribe to invalidation')
  assert.match(pickerCache, /invalidatePickerOptionsCache\(channel\)/, 'sync:update for a channel must drop that channel cache')
  assert.match(supplierPicker, /loadPickerOptions|invalidatePickerOptionsCache/, 'supplier picker must use the shared picker option cache')
  assert.match(supplierPicker, /invalidateSupplierNamesCache\(\)/)
  assert.match(productForm, /setSupplierReferenceVersion\(\(version\) => version \+ 1\)/, 'open product form must reload supplier options')
})

check('payment, reason and label changes have version/live refresh signals', () => {
  const settings = readWorker('src/routes/settings.ts')
  const inventory = readWorker('src/routes/inventory.ts')
  const returns = readWorker('src/routes/returns.ts')
  const fees = readWorker('src/routes/feesCatalog.ts')
  // A-C3 / B-C10: the payment-method replace moves settings and sales in ONE awaited call (the sales caches show the method label).
  assert.match(settings, /bumpVersions\(c\.env, \['settings', 'sales'\]\)/)
  assert.match(settings, /broadcast\(c\.env, 'settings', \{ action: 'payment_method_replace'/)
  assert.match(inventory, /broadcast\(c\.env, 'inventory', \{ action: 'reasons_replace'/)
  // 6.0.1897 (F8): the reason replace advances settings and returns in ONE awaited call before the response, then broadcasts.
  assert.match(returns, /await bumpVersions\(c\.env, \['settings', 'returns'\]\)\r?\n\s*c\.executionCtx\.waitUntil\(broadcast\(c\.env, 'settings', \{ action: 'return_reason_replace'/)
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
