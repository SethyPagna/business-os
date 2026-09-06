import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')
const repoRoot = path.resolve(frontendRoot, '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const componentRoot = path.join(frontendRoot, 'src', 'components')
const componentFiles = walk(componentRoot).filter((file) => file.endsWith('.tsx'))
const relative = (file: string): string => path.relative(frontendRoot, file).replace(/\\/g, '/')
const pagerConsumers = componentFiles
  .filter((file) => /<PaginationControls\b/.test(fs.readFileSync(file, 'utf8')))
  .map(relative)
  .sort()

// Deliberately explicit: adding a paginated page requires adding it here and
// proves the UI-05 audit considered its total, cache and last-page behavior.
const expectedConsumers = [
  'src/components/branches/Branches.tsx',
  'src/components/catalog/catalogPagination.tsx',
  'src/components/contacts/ApInvoicesSection.tsx',
  'src/components/contacts/ArInvoicesSection.tsx',
  'src/components/contacts/ContactImportConflictsModal.tsx',
  'src/components/contacts/DuplicatesTab.tsx',
  'src/components/contacts/SaleLinkConflictsSection.tsx',
  'src/components/contacts/shared.tsx',
  'src/components/contacts/StockInInvoicesSection.tsx',
  'src/components/contacts/SupplierPurchasesModal.tsx',
  'src/components/fees/FeesPage.tsx',
  'src/components/files/FilePickerModal.tsx',
  'src/components/files/FilesPage.tsx',
  'src/components/imports/ServerImportReviewScreen.tsx',
  'src/components/inventory/InventoryMovementsSurface.tsx',
  'src/components/inventory/InventoryProductsSurface.tsx',
  'src/components/pos/POS.tsx',
  'src/components/products/Products.tsx',
  'src/components/products/ProductsImageOnlyView.tsx',
  'src/components/products/StockChangeSection.tsx',
  'src/components/products/StockInSessionsSection.tsx',
  'src/components/products/import/ProductImportConflictsModal.tsx',
  'src/components/products/import/ProductServerImportReviewScreen.tsx',
  'src/components/returns/Returns.tsx',
  'src/components/review/LegacyDeletedSalesSection.tsx',
  'src/components/sales/Sales.tsx',
  'src/components/shared/NotificationCenter.tsx',
  'src/components/utils-settings/AuditLog.tsx',
].sort()

check('every audited paginated consumer is inventoried', () => {
  assert.deepStrictEqual(pagerConsumers, expectedConsumers)
  for (const file of pagerConsumers) {
    const source = read(`frontend/${file}`)
    assert.match(source, /<PaginationControls\b[\s\S]*?totalItems=\{/, `${file} must use an authoritative total`)
    assert.match(source, /<PaginationControls\b[\s\S]*?onPageChange=\{/, `${file} must wire page changes`)
  }
})

// An inventory is not evidence if it can certify a file nothing renders.
// ArInvoicesSection.tsx sat in the list above -- paging correctly, clamping
// correctly, counting correctly -- while the only references to its name in
// the whole frontend were its own `export default` and this file's two path
// strings. docs/DATA-VISIBILITY-AND-CREDIT-AUDIT.md had asked for it to be
// mounted into the Customers tab; nothing was, so the audited behavior was
// unreachable and this test's green was about a file no user could open.
//
// So the inventory now also proves each entry is REACHED: some other module
// under src/ names it in a static or dynamic import. That is the weakest true
// statement available from source alone -- it does not prove a route renders
// it -- but it is exactly the gap that let an orphan through, and it is
// mechanical rather than a hand-kept list of "these ones are really mounted".
function importedBasenames(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const file of walk(path.join(frontendRoot, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const source = fs.readFileSync(file, 'utf8')
    // `from './X'`, `from './X.tsx'` and `import('./X')` alike.
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (!spec.startsWith('.')) continue
      const base = path.basename(spec).replace(/\.(tsx|ts|js)$/, '')
      if (!map.has(base)) map.set(base, new Set())
      map.get(base)!.add(relative(file))
    }
  }
  return map
}

check('every inventoried paginated surface is reachable from the app', () => {
  const imports = importedBasenames()
  const importersOf = (file: string): string[] => {
    const base = path.basename(file).replace(/\.tsx$/, '')
    return [...(imports.get(base) || [])].filter((importer) => importer !== file).sort()
  }

  const orphans = expectedConsumers.filter((file) => importersOf(file).length === 0)
  assert.deepStrictEqual(
    orphans,
    [],
    'a paginated surface no module imports cannot be opened, so auditing its paging proves nothing -- mount it or drop it',
  )

  // Positive control. A resolver that silently matched everything (a bad
  // regex, an empty walk) would report zero orphans forever and the assertion
  // above would be a green that means nothing. So the same resolver is asked
  // about a name that is deliberately absent, and must say "nothing".
  assert.deepStrictEqual(
    importersOf('src/components/contacts/NoSuchPaginatedSurface.tsx'),
    [],
    'the reachability resolver must report a name nothing imports as unimported',
  )
  assert.ok(
    importersOf('src/components/contacts/ArInvoicesSection.tsx').includes('src/components/contacts/CustomersTab.tsx'),
    'the AR ledger is mounted by the Customers tab, mirroring how SuppliersTab mounts the supplier ledgers',
  )
})

check('no page-local Previous/Next paginator remains', () => {
  const manualPager = /(tr|t)\('previous'|>Previous<|>Next<|(tr|t)\('next'/
  const allowed = new Set([
    'src/components/products/Products.tsx', // image-lightbox navigation, not row pagination
    'src/components/shared/PaginationControls.tsx',
  ])
  const offenders = componentFiles
    .filter((file) => manualPager.test(fs.readFileSync(file, 'utf8')))
    .map(relative)
    .filter((file) => !allowed.has(file))
  assert.deepStrictEqual(offenders, [])
})

check('server-paged mutable/filterable lists correct an empty former last page', () => {
  for (const file of [
    'frontend/src/components/contacts/ApInvoicesSection.tsx',
    'frontend/src/components/contacts/ArInvoicesSection.tsx',
    'frontend/src/components/contacts/StockInInvoicesSection.tsx',
    'frontend/src/components/fees/FeesPage.tsx',
    'frontend/src/components/files/FilePickerModal.tsx',
    'frontend/src/components/products/StockInSessionsSection.tsx',
    'frontend/src/components/review/LegacyDeletedSalesSection.tsx',
  ]) {
    const source = read(file)
    assert.match(source, /clampPage\(/, `${file} must clamp from the response total`)
    assert.match(source, /nextPage !== page|nextPage !== linePage/, `${file} must re-request the valid page`)
  }
})

check('cached paged reads isolate every query (and record id where applicable)', () => {
  const contracts: Array<[string, RegExp]> = [
    ['frontend/src/api/auditLogTransport.ts', /`audit_log:get:\$\{query\}`/],
    ['frontend/src/api/contactReadTransport.ts', /const cacheKey = `\$\{config\.routeKey\}:\$\{query\}`/],
    ['frontend/src/api/feesTransport.ts', /`fees:get:\$\{query \|\| 'all'\}`/],
    ['frontend/src/api/fileTransport.ts', /`files:get:\$\{query\}`/],
    ['frontend/src/api/importJobsTransport.ts', /`importJobs:review:\$\{id\}:\$\{query\}`/],
    ['frontend/src/api/inventoryTransport.ts', /`inventory:products:search:v2:\$\{query\}`/],
    ['frontend/src/api/productReadTransport.ts', /`products:search:\$\{query\}`/],
    ['frontend/src/api/returnsReadTransport.ts', /`returns:get:\$\{query\}`/],
    ['frontend/src/api/salesTransport.ts', /`sales:get:\$\{query\}`/],
  ]
  for (const [file, pattern] of contracts) assert.match(read(file), pattern, `${file} cache key must include the stable query`)
})

check('Worker list endpoints count the same filtered/grouped scope they page', () => {
  const contacts = read('cloudflare/src/routes/contacts.ts')
  for (const route of ['stock-in-invoices', 'stock-in-invoice-lines', 'ap-invoices', 'ar-invoices']) {
    assert.match(contacts, new RegExp(`app\\.get\\('/(?:suppliers|customers)/reports/${route}'[\\s\\S]*?LIMIT @limit OFFSET @offset`), `${route} must be bounded`)
  }
  assert.match(contacts, /stock-in-invoices'[\s\S]*?COUNT\(\*\) AS total FROM \([\s\S]*?GROUP BY t\.supplier_key, t\.received_day/, 'stock-in invoice totals count groups, not raw lines')
  assert.match(contacts, /pageSize = clampInt\(query\.page_size, 20, 1, 100\)/, 'stock-in group page size must honor the shared 20\/50\/100 choices')
  assert.match(contacts, /ap-invoices'[\s\S]*?FROM supplier_invoices si \$\{where\}/, 'AP total must use the filtered where clause')
  assert.match(contacts, /ar-invoices'[\s\S]*?FROM customer_receivables cr \$\{where\}/, 'AR total must use the filtered where clause')

  const products = read('cloudflare/src/routes/products.ts')
  assert.match(products, /stock-in-sessions'[\s\S]*?COUNT\(\*\) OVER \(\) AS total[\s\S]*?LIMIT @limit OFFSET @offset/, 'stock-in sessions must return the total and page from one grouped query')

  const compat = read('cloudflare/src/routes/compat.ts')
  assert.match(compat, /legacy-deleted-sales'[\s\S]*?COUNT\(\*\) AS lines[\s\S]*?legacy_deleted_sale_items d \$\{where\}/, 'deleted-sale totals must follow the active filters')

  const files = read('cloudflare/src/routes/files.ts')
  assert.match(files, /SELECT COUNT\(\*\) AS count FROM logical_assets \$\{whereSql\}[\s\S]*?FROM logical_assets \$\{whereSql\}[\s\S]*?LIMIT @limit OFFSET @offset/, 'file library must count and page the same filtered logical listing')
  assert.match(files, /const MAX_FILE_PAGE_SIZE = 100/, 'file library must honor the shared 20\/50\/100 choices')
})

console.log(`\npaginationSurfaceContract: ${passed} check(s) passed.`)
