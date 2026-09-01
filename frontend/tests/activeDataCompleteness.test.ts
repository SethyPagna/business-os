import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const frontend = (rel: string) => readFileSync(join(root, 'frontend', rel), 'utf8')
const worker = (rel: string) => readFileSync(join(root, 'cloudflare', rel), 'utf8')
let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('single-product branch transfer searches D1 and exposes later pages', () => {
  const src = frontend('src/components/branches/TransferModal.tsx')
  assert.match(src, /debouncedSearch\.trim\(\) \? \{ query: debouncedSearch\.trim\(\) \} : \{\}/, 'single search must be sent to the branch-stock endpoint')
  assert.ok(src.includes('singleStockPage < singleStockTotalPages'), 'single transfer must expose later branch-stock pages')
  assert.ok(src.includes('loadMoreSingleProducts'), 'single transfer has an explicit load-more path')
  assert.doesNotMatch(src, /const filtered = useMemo\(\(\) => \{[\s\S]{0,500}name\.includes\(query\)/, 'server search must not be hidden again by a narrower client-only search')
})

test('legacy deleted-sales cashier vocabulary is not capped at 100', () => {
  const src = worker('src/routes/compat.ts')
  const route = src.slice(src.indexOf("app.get('/system/legacy-deleted-sales'"), src.indexOf("app.get('/system/integration-doctor'"))
  assert.ok(route.includes('GROUP BY lower(trim(COALESCE(cashier_name, deleted_by'), 'cashier vocabulary is grouped from the authoritative ledger')
  assert.doesNotMatch(route, /ORDER BY name COLLATE NOCASE ASC\s+LIMIT 100/, 'valid cashiers must not disappear after the first 100')
})

test('dedicated import-jobs router is mounted before the compatibility router', () => {
  const src = worker('src/index.ts')
  const dedicated = src.indexOf("app.route('/api/import-jobs', importJobsRoute)")
  const compat = src.indexOf("app.route('/api', compatRoute)")
  assert.ok(dedicated >= 0 && compat >= 0 && dedicated < compat, 'paginated import review must win route matching before the legacy compatibility fallback')
})

test('Sales CSV export pages a frozen snapshot instead of inheriting the 5,000-row preview cap', () => {
  const workerSrc = worker('src/routes/sales.ts')
  const ui = frontend('src/components/sales/ExportModal.tsx')
  assert.ok(workerSrc.includes("app.get('/export'"), 'Worker exposes a paged detail-export path')
  assert.ok(workerSrc.includes('snapshotMaxId') && workerSrc.includes('afterCreatedAt') && workerSrc.includes('afterId'), 'detail export freezes and cursor-pages the receipt set')
  assert.ok(ui.includes('while (page.has_more)') && ui.includes("detailsOnly: 'true'"), 'CSV client walks every server page')
  assert.ok(ui.includes('Sales export could not advance to the next page safely'), 'cursor stalls fail loudly instead of producing a partial file')
})

test('Sales export top-products aggregate is independent of the bounded preview rows', () => {
  const src = worker('src/routes/sales.ts')
  const exportStart = src.indexOf("app.get('/export',")
  const exportEnd = src.indexOf('\n})\n\nexport default app', exportStart)
  const route = src.slice(exportStart, exportEnd)
  assert.match(route, /FROM sale_items si\s+JOIN sales s ON s\.id = si\.sale_id[\s\S]*GROUP BY si\.product_id, si\.product_name[\s\S]*LIMIT 100/, 'top products rank the full filtered period directly in SQL')
})

if (failed) { console.error(`\n${failed} active-data completeness test(s) failed`); process.exit(1) }
console.log('\nAll active-data completeness tests passed')
