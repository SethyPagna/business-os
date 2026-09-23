// S4-41 on the Sales page's group Status action (and the single-sale path's
// reading of the same refusal).
//
// The owner's rule: a paid sale carries the completed status, and the paid
// statuses (completed, awaiting_delivery) mean the sale IS paid. The Worker
// refuses a group that would move a Not Paid sale still owing money to one of
// them (POST /api/sales/bulk-status, 400 insufficient_payment_for_status). The
// page must not walk the cashier into that refusal: its review names such
// sales, leaves them out of the change, and sends only the rest.
//
// Three parts, because each alone passes on a broken page:
//
//   1. THE RULE. The page decides which targets a sale may not take with the
//      shared rule (utils/saleStatusResolution.ts). The expression is lifted
//      out of Sales.tsx and run on rows shaped like GET /api/sales rows (the
//      Worker's own `s.*` columns) through the UI copy AND the Worker copy of
//      the rule; saleStatusResolutionParity.test.ts proves those two files
//      identical, and the Worker's status and group routes import the same one.
//   2. THE REVIEW. BulkSaleChangeModal is rendered for real (portal, icons and
//      AppSelect stubbed, a paid target chosen) and must name the skipped
//      sales in the translated message, list only the others, and offer no
//      Confirm once nothing is left.
//   3. THE WIRING. A skipped sale is not sent; a refusal (stale rows) clears
//      the retry body, reloads the rows and maps to a translated message; and
//      the new key exists in both language packs with the modal's inline
//      fallbacks matching them. The single-sale status path, which meets the
//      same refusal on an Undo or Redo of a reopen, translates it too.
//
// DISCRIMINATING: on the page before this change the expression does not
// exist (part 1 red), the review lists the owing sales and never mentions
// them (part 2 red), and the request carries every selected sale (part 3 red).
//
// Run: node tests/saleBulkStatusPaidGuard.test.ts
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'

import * as uiRule from '../src/utils/saleStatusResolution.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`PASS ${name}`) })
    .catch((error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) })
}

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(path.join(here, ...parts), 'utf8').replace(/\r\n?/g, '\n')
const salesPage = read('..', 'src', 'components', 'sales', 'Sales.tsx')
const modalSource = read('..', 'src', 'components', 'sales', 'BulkSaleChangeModal.tsx')
const workerBulk = read('..', '..', 'cloudflare', 'src', 'lib', 'saleBulkStatus.ts')
const workerRoutes = read('..', '..', 'cloudflare', 'src', 'routes', 'sales.ts')
const en = JSON.parse(read('..', 'src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('..', 'src', 'lang', 'km.json')) as Record<string, string>

type Rule = typeof uiRule
type Row = Record<string, unknown>

// The Worker copy of the rule, loaded for real (the same way
// saleStatusResolutionParity.test.ts does it): its extensionless import is
// pointed at the Worker's financialPrecision.ts and the result is written to
// a temp file outside the repo.
async function loadWorkerRule(): Promise<Rule> {
  const precision = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'financialPrecision.ts')
  const patched = read('..', '..', 'cloudflare', 'src', 'lib', 'saleStatusResolution.ts')
    .replace(/from '\.\/financialPrecision'/, `from ${JSON.stringify(pathToFileURL(precision).href)}`)
  assert.ok(patched.includes('file:///'), 'the Worker copy should import financialPrecision relatively')
  const temp = path.join(os.tmpdir(), `saleBulkStatusPaidGuard.worker.${process.pid}.${Date.now()}.ts`)
  writeFileSync(temp, patched)
  try {
    return await import(pathToFileURL(temp).href) as Rule
  } finally {
    rmSync(temp, { force: true })
  }
}

// --- 1. the rule, as the page applies it ------------------------------------

const blockedExpression = salesPage.match(/blockedTargetKeys: (PAID_SALE_STATUSES\.filter\(\(status\) => statusChangeNeedsPayment\(sale\.sale_status, status, sale\)\)\.map\(\(status\) => `value:\$\{status\}`\))/)
// The page's own expression, compiled once and fed either copy of the rule.
const blockedTargets = blockedExpression
  ? new Function('PAID_SALE_STATUSES', 'statusChangeNeedsPayment', 'sale', `return ${blockedExpression[1]}`) as
    (paid: readonly string[], rule: Rule['statusChangeNeedsPayment'], sale: Row) => string[]
  : null

// Rows as GET /api/sales returns them: the sale's own columns, V1 money.
const listRow = (id: number, status: string | null, money: Row): Row => ({
  id, receipt_number: `R${id}`, sale_status: status, updated_at: 'same-second',
  total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 0, exchange_rate: 4100,
  money_precision_version: 1, calculated_total_usd: 10, ...money,
})
const SALES: Array<{ row: Row; blocked: string[]; why: string }> = [
  { row: listRow(1, 'awaiting_payment', {}), blocked: ['value:completed', 'value:awaiting_delivery'], why: 'owes the whole total' },
  { row: listRow(2, 'awaiting_payment', { amount_paid_khr: 41000 }), blocked: [], why: 'paid to the riel in KHR' },
  { row: listRow(3, 'completed', {}), blocked: [], why: 'already Completed: not this rule\'s move' },
  { row: listRow(4, 'awaiting_payment', { amount_paid_usd: 9.99, amount_paid_khr: 40 }), blocked: ['value:completed', 'value:awaiting_delivery'], why: 'one riel short on a mixed tender' },
  { row: listRow(5, null, {}), blocked: [], why: 'a NULL status is a legacy Completed' },
]

await runTest('the page asks the shared rule which targets each sale may not take', () => {
  assert.ok(blockedTargets, 'Sales.tsx should build blockedTargetKeys from PAID_SALE_STATUSES and statusChangeNeedsPayment')
  assert.match(salesPage, /import \{ PAID_SALE_STATUSES, statusChangeNeedsPayment \} from '\.\.\/\.\.\/utils\/saleStatusResolution\.ts'/)
  // Only the Status review is gated; payment method, driver and customer changes are not status moves.
  assert.match(salesPage, /\.\.\.\(field === 'status' \? \{ blockedTargetKeys: /)
  // The blocked keys must be spelled like the Status targets the review offers.
  assert.match(salesPage, /key: `value:\$\{status\.toLocaleLowerCase\(\)\}`/)
  for (const status of uiRule.PAID_SALE_STATUSES) assert.equal(status, status.toLocaleLowerCase())
  for (const { row, blocked, why } of SALES) {
    assert.deepEqual(blockedTargets!(uiRule.PAID_SALE_STATUSES, uiRule.statusChangeNeedsPayment, row), blocked, `R${row.id}: ${why}`)
  }
})

await runTest('the UI copy and the Worker copy block exactly the same sales', async () => {
  assert.ok(blockedTargets)
  const worker = await loadWorkerRule()
  for (const { row } of SALES) {
    assert.deepEqual(
      blockedTargets!(worker.PAID_SALE_STATUSES, worker.statusChangeNeedsPayment, row),
      blockedTargets!(uiRule.PAID_SALE_STATUSES, uiRule.statusChangeNeedsPayment, row),
      `R${row.id}`,
    )
  }
  // ...and the Worker routes refuse by calling that rule, not by comparing money themselves.
  assert.match(workerBulk, /import \{ statusChangeNeedsPayment \} from '\.\/saleStatusResolution'/)
  assert.ok((workerBulk.match(/statusChangeNeedsPayment\(/g) || []).length >= 2, 'the group apply and its undo/redo replay both ask the rule')
  assert.match(workerRoutes, /import \{[^}]*\bstatusChangeNeedsPayment\b[^}]*\} from '\.\.\/lib\/saleStatusResolution'/)
  assert.match(workerRoutes, /!paymentFieldsSent && statusChangeNeedsPayment\(oldStatus, saleStatus, sale\)/)
})

// --- 2. the review, rendered ------------------------------------------------

type AnyProps = Record<string, any>

// `targetKey` stands in for the cashier's pick in the To list: the modal's
// only empty-string state is that pick, so the stubbed useState seeds it.
function loadModal(targetKey: string): (props: AnyProps) => unknown {
  const compiled = transformSync(read('..', 'src', 'components', 'sales', 'BulkSaleChangeModal.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id === 'react') return { ...React, useState: (initial: unknown) => React.useState(initial === '' ? targetKey : initial) }
    if (id === 'react-dom') return { createPortal: (node: unknown) => node }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('AppSelect')) return { __esModule: true, default: ({ ariaLabel, value }: AnyProps) => React.createElement('span', { 'data-select': ariaLabel, 'data-value': value }) }
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports.default as (props: AnyProps) => unknown
}

// The rows carry the blocked targets the fixture table declares (part 1
// proves the page computes exactly those), so a red here is the review's own.
function renderReview(targetKey: string, sales: typeof SALES): string {
  const Modal = loadModal(targetKey)
  const rows = sales.map(({ row: sale, blocked }) => ({
    id: Number(sale.id),
    receipt: String(sale.receipt_number),
    currentKeys: [`value:${String(sale.sale_status || 'completed')}`],
    blockedTargetKeys: blocked,
  }))
  const statusChoice = (status: string) => ({ key: `value:${status}`, label: status, value: status })
  const globals = globalThis as { document?: unknown }
  const hadDocument = 'document' in globals
  if (!hadDocument) globals.document = { body: null }
  try {
    return renderToStaticMarkup(React.createElement(Modal, {
      field: 'status',
      rows,
      sourceChoices: [statusChoice('awaiting_payment'), statusChoice('completed')],
      targetChoices: ['completed', 'awaiting_delivery', 'cancelled', 'awaiting_payment'].map(statusChoice),
      translate: (_key: string, english: string) => english,
      onClose: () => {},
      onConfirm: () => {},
    }))
  } finally {
    if (!hadDocument) delete globals.document
  }
}
const confirmButton = (html: string): string => {
  const match = html.match(/<button[^>]*class="btn-primary text-sm"[^>]*>Confirm<\/button>/)
  assert.ok(match, 'the review should render its Confirm button')
  return match[0]
}

await runTest('the review names the sales that owe money and leaves them out of the change', () => {
  const html = renderReview('value:completed', SALES)
  assert.match(html, /2 Not Paid sales are not fully paid and will be skipped\. Record their payment on each sale first\./)
  assert.match(html, />R1, R4</, 'the skipped receipts are named so the shop knows which to settle')
  assert.match(html, />R2<\/div>/, 'the paid Not Paid sale is listed for the change')
  assert.doesNotMatch(html, />R1<\/div>|>R4<\/div>/, 'an owing sale must not be listed as changing')
  assert.doesNotMatch(confirmButton(html), /disabled/, 'the paid one can still be confirmed')
})

await runTest('with every matching sale owing money there is nothing to confirm', () => {
  const html = renderReview('value:awaiting_delivery', SALES.filter(({ blocked }) => blocked.length))
  assert.match(html, /2 Not Paid sales are not fully paid/)
  assert.match(confirmButton(html), /disabled=""/)
})

await runTest('a target that is not a paid status skips nobody', () => {
  const html = renderReview('value:cancelled', SALES)
  assert.doesNotMatch(html, /not fully paid/)
  for (const receipt of ['R1', 'R2', 'R4']) assert.match(html, new RegExp(`>${receipt}</div>`))
  assert.doesNotMatch(confirmButton(html), /disabled/)
})

// --- 3. the wiring ------------------------------------------------------------

await runTest('a skipped sale is never sent, and a refusal still reads in the shop\'s language', () => {
  assert.match(modalSource, /onConfirm\(source, target, eligible, blocked\)/, 'the review hands back the rows it skipped')
  assert.match(salesPage, /onConfirm=\{\(source, target, matched, blocked\) => \{/)
  assert.match(
    salesPage,
    /handleScopedBulkStatusUpdate\(String\(target\.value \|\| ''\), null, false, false, matchedSales, String\(source\.value \|\| 'completed'\), bulkChangePrompt\.sales\.filter\(\(sale\) => !blockedIds\.has\(Number\(sale\.id\)\)\)\)/,
    'the frozen request leaves the skipped sales out (a source-matching owing sale would refuse the whole group)',
  )
  // The Worker decides before writing and before recording the request id,
  // so a payment refusal is a known outcome: clear the retry body (a kept one
  // blocks every later group change), reload the stale rows the review
  // trusted, and translate.
  assert.match(salesPage, /const unpaid = \(error as \{ code\?: string \} \| null\)\?\.code === 'insufficient_payment_for_status'\s+if \(unpaid\) \{\s+savePendingBulkRequest\(null\)\s+void loadSales\(true\)\s+\}/)
  assert.match(salesPage, /translateOr\('sale_settlement_full_required', /)
})

await runTest('the skipped-sales message exists in both packs, and the inline fallbacks match them', () => {
  const key = 'sale_bulk_status_unpaid_skipped'
  assert.ok(en[key]?.includes('{n}') && km[key]?.includes('{n}'), `${key} with a {n} slot in en.json and km.json`)
  const call = modalSource.match(new RegExp(`translate\\('${key}', '([^']+)', '([^']+)'\\)`))
  assert.ok(call, 'the modal translates the message through the shared key')
  assert.equal(call[1], en[key], 'English fallback matches en.json')
  assert.equal(call[2], km[key], 'Khmer fallback matches km.json')
  assert.equal(typeof en.sale_settlement_full_required, 'string')
  assert.equal(typeof km.sale_settlement_full_required, 'string')
})

await runTest('the single-sale status path translates the same refusal', () => {
  // The payment form always sends a settlement for a Not Paid -> paid move
  // (SaleDetailModal needsPaymentEntry), so the refusal arrives through
  // replaySaleStatusHistory / retryPendingDirectStatusRequest and ends here.
  assert.match(salesPage, /const problem = error as \{ syncErrorId\?: string; syncErrorChannel\?: string; code\?: string \}/)
  assert.match(
    salesPage,
    /notify\(problem\.code === 'insufficient_payment_for_status'\s+\? translateOr\('sale_settlement_full_required', '[^']+'\)\s+: `Failed to update status: /,
  )
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
