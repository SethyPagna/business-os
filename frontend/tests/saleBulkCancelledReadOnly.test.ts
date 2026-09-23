// G1 on the Sales page's group field changes (payment method, driver,
// customer): a CANCELLED sale is read-only.
//
// Owner rule (23 Sep 2026): "add/edit sales customer, driver, delivery fee,
// add item, replace, edit, etc... are able to do in all status except
// cancelled." The Worker now refuses a group that holds a cancelled sale
// (POST /api/sales/bulk-update, cancelled_sale_read_only; behaviour pinned by
// cloudflare/scripts/test-sale-bulk-update-cancelled-pure.cjs). The page must
// not walk the cashier into that refusal:
//
//   1. THE RULE. The page's filter and the Worker's check agree on which
//      selected sales are cancelled (both expressions are lifted out of their
//      files and run on the same rows, including a legacy NULL status).
//   2. THE WIRING. Field changes send only the live sales, the buttons are
//      disabled when every selected sale is cancelled, a compact InfoHint
//      states the reason and count, and a refusal (a sale cancelled after the
//      page loaded) clears the retry body, reloads and translates.
//   3. THE REVIEW. BulkSaleChangeModal, rendered, states how many cancelled
//      sales were left out, and says nothing when none were.
//   4. BOTH PACKS carry the new keys and the inline fallbacks match them.
//
// DISCRIMINATING: on 0293aeb0 none of the expressions exist, the request
// carries every selected sale and the modal never mentions cancelled sales.
//
// Run: node tests/saleBulkCancelledReadOnly.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(path.join(here, ...parts), 'utf8').replace(/\r\n?/g, '\n')
const salesPage = read('..', 'src', 'components', 'sales', 'Sales.tsx')
const modalSource = read('..', 'src', 'components', 'sales', 'BulkSaleChangeModal.tsx')
const workerBulk = read('..', '..', 'cloudflare', 'src', 'lib', 'saleBulkUpdate.ts')
const en = JSON.parse(read('..', 'src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('..', 'src', 'lang', 'km.json')) as Record<string, string>
type Row = Record<string, unknown>

const ROWS: Row[] = [
  { id: 1, sale_status: 'cancelled' },
  { id: 2, sale_status: 'completed' },
  { id: 3, sale_status: 'awaiting_payment' },
  { id: 4, sale_status: 'awaiting_delivery' },
  { id: 5, sale_status: null },
  { id: 6, sale_status: 'partial_return' },
]

await runTest('the page and the Worker agree on which selected sales are read-only', () => {
  const page = salesPage.match(/const fieldEditableSales = selectedSales\.filter\(\((sale)\) => ([^\n]+)\)\n/)
  assert.ok(page, 'Sales.tsx should derive fieldEditableSales from the selection')
  const pageEditable = new Function(page[1], `return ${page[2]}`) as (sale: Row) => boolean
  const worker = workerBulk.match(/const isCancelled = \((sale): Row\) => ([^\n]+)\n/)
  assert.ok(worker, 'saleBulkUpdate.ts should name its cancelled check')
  const workerCancelled = new Function(worker[1], `return ${worker[2]}`) as (sale: Row) => boolean
  assert.deepEqual(ROWS.filter(pageEditable).map((row) => row.id), [2, 3, 4, 5, 6], 'only the cancelled sale is left out')
  for (const row of ROWS) assert.equal(pageEditable(row), !workerCancelled(row), `sale ${row.id}`)
  // The Worker checks the rule at read time AND inside the atomic write, for apply and replay.
  assert.match(workerBulk, /if \(sales\.some\(isCancelled\)\) refuseCancelled\(sales\.filter\(isCancelled\)\)/)
  assert.match(workerBulk, /const guards: StockStatement\[\] = \[notCancelledGuard\(ids\)\]/)
  assert.match(workerBulk, /statements\.push\(notCancelledGuard\(changedIds\)\)/)
  assert.match(workerBulk, /code: CANCELLED_SALE_READ_ONLY_CODE/)
  assert.match(workerBulk, /const CANCELLED_SALE_READ_ONLY_CODE = 'cancelled_sale_read_only'/)
})

await runTest('field changes send only live sales; Status stays offered to un-cancel', () => {
  assert.match(salesPage, /const frozenSales = \(field === 'status' \? selectedSales : fieldEditableSales\)\.map\(\(sale\) => \(\{ \.\.\.sale \}\)\)\n\s+if \(!frozenSales\.length\) return/)
  assert.match(salesPage, /cancelledCount: selectedSales\.length - frozenSales\.length,/)
  assert.match(salesPage, /cancelledCount=\{bulkChangePrompt\.cancelledCount\}/)
  // The request is built from the frozen (live-only) sales.
  assert.match(salesPage, /items: frozenSales\.map\(\(sale\) => \(\{ id: Number\(sale\.id\), expected_updated_at: /)
  assert.match(salesPage, /void submitBulkFieldChange\(bulkChangePrompt\.field, source, target, matched, bulkChangePrompt\.sales\)/)
  for (const field of ['payment_method', 'delivery_contact', 'customer']) {
    assert.match(salesPage, new RegExp(`openBulkChange\\('${field}'\\) \\}\\} disabled=\\{selectedSales\\.length > 25 \\|\\| bulkFieldSaving \\|\\| !fieldEditableSales\\.length\\}`), `${field} is disabled when every selected sale is cancelled`)
  }
  assert.match(salesPage, /openBulkChange\('status'\) \}\} disabled=\{selectedSales\.length > 25 \|\| !!bulkStatusSaving \|\| bulkFieldSaving\}/, 'Status is not gated: it un-cancels')
  assert.match(salesPage, /selectedCancelledCount > 0 \? <InfoHint text=\{translateOr\('sale_bulk_cancelled_skipped', /)
})

await runTest('a cancelled refusal is a known outcome: retry dropped, list reloaded, message translated', () => {
  assert.match(salesPage, /const saleCancelledRefusal = \(error: unknown\) => \(error as \{ code\?: string \} \| null\)\?\.code === 'cancelled_sale_read_only'/)
  assert.match(salesPage, /const cancelled = saleCancelledRefusal\(error\)\n\s+if \(cancelled\) \{\n\s+savePendingBulkFieldRequest\(null\)\n\s+void loadSales\(true\)\n\s+\}/)
  assert.match(salesPage, /notify\(cancelled \? cancelledRefusalMessage\(\) : getErrorMessage\(/)
  // The single-sale customer path (same endpoint) reads the refusal the same way.
  assert.match(salesPage, /: saleCancelledRefusal\(error\) \? cancelledRefusalMessage\(\) : getErrorMessage\(/)
})

type AnyProps = Record<string, any>
function renderModal(cancelledCount: number): string {
  const compiled = transformSync(modalSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id === 'react-dom') return { createPortal: (node: unknown) => node }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('AppSelect')) return { __esModule: true, default: ({ ariaLabel }: AnyProps) => React.createElement('span', { 'data-select': ariaLabel }) }
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  const Modal = mod.exports.default as (props: AnyProps) => unknown
  const globals = globalThis as { document?: unknown }
  const hadDocument = 'document' in globals
  if (!hadDocument) globals.document = { body: null }
  try {
    const choice = { key: 'linked:1', label: 'Driver A', id: 1 }
    return renderToStaticMarkup(React.createElement(Modal, {
      field: 'delivery_contact', rows: [{ id: 2, receipt: 'R2', currentKeys: ['linked:1'] }],
      sourceChoices: [choice], targetChoices: [choice], cancelledCount,
      translate: (_key: string, english: string) => english, onClose: () => {}, onConfirm: () => {},
    }))
  } finally {
    if (!hadDocument) delete globals.document
  }
}

await runTest('the review states how many cancelled sales were left out, and only when some were', () => {
  assert.match(renderModal(2), /2 cancelled sales cannot be edited and are left out\./)
  assert.doesNotMatch(renderModal(0), /cancelled sales cannot be edited/)
})

await runTest('both packs carry the new keys and the inline fallbacks match them', () => {
  for (const key of ['sale_bulk_cancelled_skipped', 'sale_cancelled_read_only']) {
    assert.equal(typeof en[key], 'string', `${key} in en.json`)
    assert.equal(typeof km[key], 'string', `${key} in km.json`)
  }
  assert.ok(en.sale_bulk_cancelled_skipped.includes('{n}') && km.sale_bulk_cancelled_skipped.includes('{n}'))
  for (const source of [salesPage, modalSource]) {
    const calls = [...source.matchAll(/translate(?:Or)?\('(sale_bulk_cancelled_skipped|sale_cancelled_read_only)', '([^']+)', '([^']+)'\)/g)]
    assert.ok(calls.length > 0)
    for (const [, key, english, khmer] of calls) {
      assert.equal(english, en[key], `${key} English fallback`)
      assert.equal(khmer, km[key], `${key} Khmer fallback`)
    }
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
