import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { formatBatchReceivedDate } from '../src/utils/batchLabel.ts'

// P10-19 (owner): "the date in the Not Yet Paid in add stock etc... are not
// working". The defect was that no stock-receipt confirmation showed the
// typed Payment / due date back before it committed. The three retired forms
// each built that row through utils/stockAdjustReview.ts (deleted with them by
// UI-STOCK-3); the one Stock Session's Review step now states it in its
// summary (spec 4.3), so the rule is pinned there by running the float's own
// summary code.
//
// Retired with the util: the signed-quantity rows ("Add quantity +4 pcs",
// "Set total quantity 5 -> 9", "Difference"). The session's Review shows
// before -> after per line instead (StockSessionReviewStep).

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const float = read('../src/components/inventory/FastStockInModal.tsx')

const start = float.indexOf('  const branchName = branchOptions.find(')
const end = float.indexOf('})()', float.indexOf('const reviewSummary = (() => {')) + '})()'.length
assert.ok(start > 0 && end > start, 'the float review summary located')
const js = ts.transpileModule(`${float.slice(start, end)}\nreturn reviewSummary`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
type Line = { mode: 'add' | 'remove' | 'set' }
function summaryFor(input: { lines: Line[]; paymentStatus: 'paid' | 'credit'; creditDueDate: string; paidAmount?: string }): string[] {
  const bindings = {
    branchOptions: [{ value: '1', label: 'Store' }], branchId: '1', supplier: { supplierName: 'Supplier A' },
    received: input.lines, paidAmount: input.paidAmount ?? '', itemsTotal: 12.5, canViewCosts: true, usdSymbol: '$',
    paymentStatus: input.paymentStatus, creditDueDate: input.creditDueDate, receivedDate: '2026-09-30',
    tr: (_key: string, fallback: string) => fallback, formatBatchReceivedDate,
  }
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings))
}

const credit = summaryFor({ lines: [{ mode: 'add' }], paymentStatus: 'credit', creditDueDate: '2026-10-15' })
assert.equal(credit.length, 2)
assert.match(credit[1], /^30\/09\/2026 · Not Yet Paid \$12\.50 · Due 15\/10\/2026$/, 'a Not Yet Paid receipt shows its due date, day-first')

const paid = summaryFor({ lines: [{ mode: 'add' }], paymentStatus: 'paid', creditDueDate: '2026-10-15', paidAmount: '10' })
assert.match(paid[1], /· Paid \$10\.00$/, 'a Paid receipt shows Paid and the typed amount, never a due date')

for (const mode of ['remove', 'set'] as const) {
  const summary = summaryFor({ lines: [{ mode }], paymentStatus: 'paid', creditDueDate: '' })
  assert.deepEqual(summary, ['Store · Supplier A'], `a ${mode} session states no payment fact`)
}

assert.match(float, /<StockSessionReviewStep [^\n]*summary=\{reviewSummary\}/, 'the Review step renders that summary')

const inventorySource = read('../src/components/inventory/Inventory.tsx')
assert.doesNotMatch(inventorySource, /window\.confirm\(adjustConfirmLabel\)/, 'Inventory.tsx never commits a stock change behind a bare native confirm')

console.log('PASS P10-19: the Stock Session review states Payment / due date before a receipt commits, and none for remove or set')
