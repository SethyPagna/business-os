// The two-status model on screen (release review a77883c78, Findings 1 and 3).
//
// Owner, 20 Oct 2026: only Completed and Not Paid are sale statuses; returns
// and delivery are TAGS. The Worker now stores a POS delivery order as
// {"sale_status":"completed","delivery_pending":1} and a return as
// return_state, and clears the delivery tag only when `completed` is
// requested on a sale that is already completed (salesStatus.ts
// requestedSaleState). The UI read only sale_status, so every delivery order
// showed Completed and could never be marked delivered, single or grouped.
//
// Each part runs the real code on rows shaped like GET /api/sales rows:
//   1. the badge and its text form, in both packs;
//   2. the status picker's destinations and the Mark delivered chip;
//   3. the sale detail's wiring (what it hands the picker, its no-op guard);
//   4. the single change (confirmation From word and Undo target);
//   5. the group change (From matching, the review, the frozen request);
//   6. still owed, from the debt half of the returns (Finding 3).
// The paid sale with no tags is the control in every part.
//
// DISCRIMINATING: on a77883c78 the badge ignores the row (every case reads
// Completed), the detail's no-op guard swallows Completed on a delivery
// order, a delivery order's group key is `completed` so Completed -> Completed
// is disabled, and still owed subtracts the whole refund ($1 instead of $2).
//
// Run: node tests/saleStatusTagsDisplay.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { transformSync } from 'esbuild'

import { saleStatusDestinations, saleStatusDisplay, saleStatusWords } from '../src/utils/saleStatusDisplay.ts'
import { receiptTotalsFigures, returnOwedReductionUsd } from '../src/utils/receiptTotals.ts'
import { subtractMoney4 } from '../src/utils/moneyPrecision.ts'
import { configuredSettlementMethods, initialSettlementRows, recordedSettlementIssue } from '../src/components/sales/saleSettlement.ts'
import { saleOwnExchangeRate, saleUsesSavedExchangeRate } from '../src/utils/saleMoneyV1.ts'
import { CURRENCY } from '../src/constants.ts'
import { directMutationRefusedBeforeWrite } from '../src/utils/directMutationRequest.ts'
import { bulkDialogDependency, NOT_BULK_DIALOG_DEPENDENCY } from './bulkFieldChangeDialogShim.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const { renderToStaticMarkup } = nodeRequire('react-dom/server') as typeof import('react-dom/server')
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(path.join(here, '..', ...parts), 'utf8').replace(/\r\n?/g, '\n')
const en = JSON.parse(read('src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('src', 'lang', 'km.json')) as Record<string, string>
const tEn = (key: string): string => en[key] ?? key
const tKm = (key: string): string => km[key] ?? key

let failed = 0
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// A TSX module compiled for real; `deps` answers the imports a test stands in for.
function loadTsx(file: string, deps: (id: string) => unknown = () => undefined): Record<string, any> {
  const compiled = transformSync(read(file), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  const dir = path.dirname(path.join(here, '..', file))
  const shim = (id: string): unknown => {
    const standIn = deps(id)
    if (standIn !== undefined) return standIn
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.startsWith('.')) return nodeRequire(path.resolve(dir, id))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}

// Rows as GET /api/sales returns them (s.* plus the attached refunds).
type Row = Record<string, any>
const row = (id: number, columns: Row): Row => ({
  id, receipt_number: `R${id}`, updated_at: `v${id}`, total_usd: 10, amount_paid_usd: 10, amount_paid_khr: 0, exchange_rate: 4100,
  money_precision_version: 1, calculated_total_usd: 10, rounding_adjustment_usd: 0, subtotal_usd: 10, return_state: null, delivery_pending: 0, status_before_return: null, ...columns,
})
const delivery = row(1, { sale_status: 'completed', delivery_pending: 1 })
const paid = row(2, { sale_status: 'completed' })
const fullReturn = row(3, { sale_status: 'completed', return_state: 'full' })
const partialReturn = row(4, { sale_status: 'completed', return_state: 'partial' })
const notPaidPartial = row(5, { sale_status: 'awaiting_payment', return_state: 'partial', amount_paid_usd: 0 })
const legacyReturnedNotPaid = row(6, { sale_status: 'returned', status_before_return: 'awaiting_payment', amount_paid_usd: 0 })
const legacyDelivery = row(7, { sale_status: 'awaiting_delivery' })
const cancelledDelivery = row(8, { sale_status: 'cancelled', delivery_pending: 1 })
const fullReturnDelivering = row(9, { sale_status: 'completed', return_state: 'full', delivery_pending: 1 })

// ---- 1. the badge -------------------------------------------------------------
const badge = loadTsx('src/components/sales/StatusBadge.tsx')
const chips = (props: Row, t = tEn): string[] => [...renderToStaticMarkup(React.createElement(badge.default, { ...props, t }))
  .matchAll(/<span class="text-xs[^"]*">([^<]*)<\/span>/g)].map((match) => match[1])

await check('the badge reads the row: Awaiting Delivery for a delivery order, the return beside the payment state', () => {
  assert.deepEqual(chips({ sale: delivery }), ['Awaiting Delivery'], 'completed + delivery_pending (base: Completed)')
  assert.deepEqual(chips({ sale: legacyDelivery }), ['Awaiting Delivery'], 'a row written before the tags reads the same')
  assert.deepEqual(chips({ sale: fullReturn }), ['Completed', 'Returned'], 'a full return keeps its Returned flag beside Completed')
  assert.deepEqual(chips({ sale: partialReturn }), ['Completed', 'Partial Return'])
  assert.deepEqual(chips({ sale: notPaidPartial }), ['Not Paid', 'Partial Return'], 'a return never turns Not Paid into Completed')
  assert.deepEqual(chips({ sale: legacyReturnedNotPaid }), ['Not Paid', 'Returned'])
  assert.deepEqual(chips({ sale: cancelledDelivery }), ['Cancelled'], 'a cancelled order is not awaiting delivery (the queue leaves it out)')
  assert.deepEqual(chips({ sale: paid }), ['Completed'], 'control: a paid sale with no tags is one Completed chip')
  assert.deepEqual(chips({ status: 'returned' }), ['Returned'], 'a bare report bucket still shows its own word')
  assert.deepEqual(chips({ sale: delivery }, tKm), ['រង់ចាំការដឹកជញ្ជូន'], 'Khmer pack, decoration stripped')
})

await check('the detail row and the dashboard read the same words as text', () => {
  assert.equal(badge.getSaleStatusText(fullReturn, tEn), 'Completed · Returned')
  assert.equal(badge.getSaleStatusText(delivery, tKm), 'រង់ចាំការដឹកជញ្ជូន')
  assert.equal(badge.getSaleStatusText(paid, tEn), 'Completed')
  const dashboard = nodeRequire('../src/components/dashboard/dashboardSaleStatus.ts')
  assert.equal(dashboard.getDashboardSaleLabel(delivery), 'Awaiting Delivery')
  assert.match(dashboard.getDashboardSaleTone(delivery), /blue/, 'the delivery tone, not Completed green')
  assert.equal(dashboard.getDashboardSaleLabel(notPaidPartial), 'Not Paid · Partial Return')
  assert.match(dashboard.getDashboardSaleTone(paid), /emerald/)
})

// ---- 2. the status picker ---------------------------------------------------
// The component called as a function with stand-in hooks, so its chips can be pressed.
const element = (type: unknown, props: Row) => ({ type, props })
const workflowModule = loadTsx('src/components/sales/SaleStatusWorkflow.tsx', (id) => {
  if (id === 'react') return { useState: (initial: unknown) => [initial, () => {}], useEffect: () => {} }
  if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' }
  if (id.endsWith('StatusBadge.tsx')) return badge
  return undefined
})
type Node = { type: unknown; props: Row }
const destinationsOf = (sale: Row) => {
  const view = saleStatusDisplay(sale)
  const picked: string[] = []
  const tree = workflowModule.default({ currentStatus: view.status, returnTag: view.returnTag, selectedStatus: view.status, notes: '', saving: false, t: tEn, onSelect: (status: string) => picked.push(status), onNotesChange: () => {}, onConfirm: () => {} }) as Node
  const buttons = ([] as Node[]).concat(tree.props.children as Node[])
  return { labels: buttons.map((button) => String(button.props.children)), press: (label: string) => { (buttons.find((button) => button.props.children === label)!.props.onClick as () => void)(); return picked } }
}

await check('a delivery order offers Mark delivered, which picks Completed', () => {
  const picker = destinationsOf(delivery)
  assert.deepEqual(picker.labels, ['Mark delivered', 'Not Paid', 'Cancelled'])
  assert.deepEqual(picker.press('Mark delivered'), ['completed'], 'the request word the Worker turns into the delivery')
  assert.deepEqual(destinationsOf(paid).labels, ['Not Paid', 'Awaiting Delivery', 'Cancelled'], 'control: a paid sale is not offered itself')
})

await check('a returned sale is offered only what the Worker accepts', () => {
  assert.deepEqual(destinationsOf(partialReturn).labels, ['Cancelled'])
  assert.deepEqual(destinationsOf(fullReturn).labels, [], 'fully returned: nothing, as the old Returned status')
  assert.deepEqual(destinationsOf(fullReturnDelivering).labels, ['Mark delivered'], 'its delivery can still be closed')
  assert.deepEqual(destinationsOf(notPaidPartial).labels, ['Completed', 'Awaiting Delivery', 'Cancelled'], 'a Not Paid sale may still be paid')
  assert.deepEqual(saleStatusDestinations(saleStatusDisplay(cancelledDelivery)), [], 'a cancelled sale has its own Un-cancel')
  assert.ok(!destinationsOf(legacyReturnedNotPaid).labels.some((label) => /Return/.test(label)), 'return words are never destinations')
})

// ---- 3. the sale detail's wiring --------------------------------------------
const detail = read('src', 'components', 'sales', 'SaleDetailModal.tsx')
await check('the detail hands the picker the shown status, and Completed on a delivery order is not a no-op', () => {
  assert.match(detail, /const statusView = saleStatusDisplay\(sale\)/)
  assert.match(detail, /<SaleStatusWorkflow\s+currentStatus=\{statusView\.status\}\s+returnTag=\{statusView\.returnTag\}/)
  assert.match(detail, /<StatusBadge sale=\{sale\} t=\{t\} \/>/)
  assert.match(detail, /<DetailRow label=\{t\('status'\) \|\| 'Status'\} value=\{getSaleStatusText\(sale, t\)\} \/>/)
  const guard = detail.match(/if \(!authReady \|\| !onStatusChange \|\| newStatus === ([^|]+?) \|\| settlementFrozenRef\.current\) return/)
  assert.ok(guard, 'the handler keeps its no-op guard')
  const noop = (sale: Row, newStatus: string): boolean => new Function('statusView', 'currentStatus', 'newStatus', `return newStatus === ${guard[1]}`)(saleStatusDisplay(sale), sale.sale_status || 'completed', newStatus)
  assert.equal(noop(delivery, 'completed'), false, 'Mark delivered reaches onStatusChange (base: swallowed)')
  assert.equal(noop(paid, 'completed'), true, 'control: Completed on a delivered sale is still a no-op')
  const section = detail.match(/\{pendingStatus \|\| \(onStatusChange && (.+?)\) \? \(/)
  assert.ok(section)
  const shown = (sale: Row): boolean => new Function('saleStatusDestinations', 'statusView', `return ${section[1]}`)(saleStatusDestinations, saleStatusDisplay(sale))
  assert.deepEqual([delivery, paid, fullReturn, fullReturnDelivering, cancelledDelivery].map(shown), [true, true, false, true, false])
})

// ---- 4. the single change ---------------------------------------------------
const sales = read('src', 'components', 'sales', 'Sales.tsx')
await check('the single change confirms From Awaiting Delivery, and Undo puts the delivery back', () => {
  const from = sales.match(/const previousStatus = (.+)\n/)
  assert.ok(from)
  const previousStatus = (previousSale: Row | undefined): string => new Function('previousSale', 'saleStatusDisplay', `return ${from[1]}`)(previousSale, saleStatusDisplay)
  assert.equal(previousStatus(delivery), 'awaiting_delivery', 'base: completed, so the review read Completed -> Completed')
  assert.equal(previousStatus(paid), 'completed')
  assert.match(sales, /fromLabel: getStatusLabel\(previousStatus, t\)/)
  assert.match(sales, /undo: \(\) => replaySaleStatusHistory\(saleId, previousStatus,/, 'Undo of Mark delivered requests awaiting_delivery again')
})

// ---- 5. the group change ----------------------------------------------------
const choices = (() => {
  const start = sales.indexOf('  const valueChoice =')
  const code = ts.transpileModule(`${sales.slice(start, sales.indexOf('  const openBulkChange =', start))}; return { choicesForSale, uniqueChoices }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('t', 'translateOr', 'getStatusLabel', 'saleStatusDisplay', 'saleStatusWords', code)(tEn, (_key: string, english: string) => english, badge.getStatusBadgeLabel, saleStatusDisplay, saleStatusWords) as {
    choicesForSale: (sale: Row, field: string) => Array<{ key: string; label: string; value: string }>
    uniqueChoices: <T>(choices: T[]) => T[]
  }
})()

// As saleBulkStatusPaidGuard.test.ts renders it: `targetKey` stands in for the pick in the To list.
function loadBulkModal(targetKey: string): (props: Row) => unknown {
  const compiled = transformSync(read('src', 'components', 'sales', 'BulkSaleChangeModal.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  const shim = (id: string): unknown => {
    if (id === 'react') return { ...React, useState: (initial: unknown) => React.useState(initial === '' ? targetKey : initial) }
    if (id === 'react-dom') return { createPortal: (node: unknown) => node }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('AppSelect')) return { __esModule: true, default: ({ ariaLabel, value }: Row) => React.createElement('span', { 'data-select': ariaLabel, 'data-value': value }) }
    const dialog = bulkDialogDependency(id, shim)
    return dialog === NOT_BULK_DIALOG_DEPENDENCY ? nodeRequire(id) : dialog
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports.default
}

await check('a group of delivery orders can be marked delivered: From Awaiting Delivery, To Completed', () => {
  assert.deepEqual(choices.choicesForSale(delivery, 'status').map((choice) => choice.key), ['value:awaiting_delivery', 'value:completed'],
    'From matches as the Worker does: the shown status, and Completed for a paid order (base: value:completed only)')
  assert.deepEqual(choices.choicesForSale(paid, 'status').map((choice) => choice.key), ['value:completed'], 'control')
  assert.deepEqual(choices.choicesForSale(notPaidPartial, 'status').map((choice) => choice.key), ['value:awaiting_payment'], 'a return is never a From')
  const selection = [delivery, paid]
  const sourceChoices = choices.uniqueChoices(selection.flatMap((sale) => choices.choicesForSale(sale, 'status')))
  assert.equal(sourceChoices[0].label, 'Awaiting Delivery')
  const statusChoice = (status: string) => ({ key: `value:${status}`, label: status, value: status })
  const globals = globalThis as { document?: unknown }
  const hadDocument = 'document' in globals
  if (!hadDocument) globals.document = { body: null }
  let html: string
  try {
    html = renderToStaticMarkup(React.createElement(loadBulkModal('value:completed'), {
      field: 'status', sourceChoices, targetChoices: ['completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled'].map(statusChoice),
      rows: selection.map((sale) => ({ id: sale.id, receipt: sale.receipt_number, currentKeys: choices.choicesForSale(sale, 'status').map((choice) => choice.key), blockedTargetKeys: [] })),
      translate: (_key: string, english: string) => english, onClose: () => {}, onConfirm: () => {},
    }))
  } finally {
    if (!hadDocument) delete globals.document
  }
  assert.match(html, />R1<\/div>/, 'the delivery order is listed for the change')
  assert.doesNotMatch(html, />R2<\/div>/, 'the delivered sale is not')
  const confirm = html.match(/<button[^>]*class="btn-primary[^"]*"[^>]*>Confirm<\/button>/)
  assert.ok(confirm)
  assert.doesNotMatch(confirm[0], /disabled/, 'base: the only From was Completed, so Completed -> Completed was disabled')
})

await check('the group request names the shown From and leaves expected_status as stored', async () => {
  const start = sales.indexOf('  const handleBulkStatusUpdate = async')
  const handlerCode = ts.transpileModule(`${sales.slice(start, sales.indexOf('  const exportVisibleSales =', start))}; return handleScopedBulkStatusUpdate`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const captured: { prompt: Row | null } = { prompt: null }
  const requests: Row[] = []
  const frozen = { current: [] as unknown[] }
  const context: Row = {
    selectedSales: [delivery], canBulkSales: true, canChangeSaleStatus: true, bulkStatusInFlightRef: { current: false }, bulkStatusSelectionRef: frozen, bulkStatusSaving: '',
    beginSingleAction: () => true, finishSingleAction: () => {}, setCancelPrompt: () => {}, setStatusPrompt: (value: Row) => { captured.prompt = value },
    translateOr: (_key: string, english: string) => english, getStatusLabel: (status: string) => badge.getStatusBadgeLabel(status, tEn), transitionMovesStock: () => false, t: tEn, setBulkStatusSaving: () => {},
    updateSalesBulkStatus: async (payload: Row) => { requests.push(payload); return { changedCount: 1, unchangedCount: 0 } },
    setSelectedIds: () => {}, loadSales: async () => {}, actionHistory: { refreshServerItems: async () => {} }, notify: () => {}, getErrorMessage: (error: Error) => error.message,
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, window: { dispatchEvent: () => {} }, CustomEvent: class {}, crypto: globalThis.crypto,
    pendingBulkRequest: null, directMutationRefusedBeforeWrite, savePendingBulkRequest: () => {}, saleStatusDisplay,
  }
  const scoped = new Function(...Object.keys(context), handlerCode)(...Object.values(context))
  await scoped('completed', null, false, false, [delivery], 'awaiting_delivery', [delivery])
  assert.equal(captured.prompt?.fromLabel, 'Awaiting Delivery', 'the review shows before and after (base: Completed -> Completed)')
  await scoped('completed', null, true, false, [delivery], 'awaiting_delivery', [delivery])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].target_status, 'completed')
  assert.equal(requests[0].source_status, 'awaiting_delivery')
  assert.deepEqual((requests[0].items as Row[]).map((item) => item.expected_status), ['completed'], 'the Worker compares the stored column')
})

// ---- 6. still owed: the debt half of the returns ----------------------------
// The release review's probe: $10 Not Paid, $7 paid. Return A ($2, all debt)
// is cancelled; return B ($2) lowered the debt $1 and refunded $1 cash. The
// list row carries B: refund_usd 2, return_owed_reduction_usd 1. Still owed: $2.
const probe = row(20, { sale_status: 'awaiting_payment', return_state: 'partial', amount_paid_usd: 7, refund_usd: 2, return_owed_reduction_usd: 1 })
const paidWithCashRefund = row(21, { sale_status: 'completed', return_state: 'partial', refund_usd: 2, return_owed_reduction_usd: 0 })

await check('the receipt and the sale detail owe $2, not $1', () => {
  const totals = receiptTotalsFigures(probe)
  assert.equal(totals.outstandingUsd, 2, 'base: 1 (the whole refund subtracted)')
  assert.equal(totals.refundUsd, 2, 'the Refunded row still prints the whole return')
  assert.equal(receiptTotalsFigures({ ...probe, return_owed_reduction_usd: undefined }).outstandingUsd, 1, 'a row from an older Worker falls back to refund_usd')
  assert.equal(receiptTotalsFigures(paidWithCashRefund).outstandingUsd, 0, 'control: a paid sale refunded in cash owes nothing')
  const payable = detail.match(/const payableUsd = (.+)\n/)
  assert.ok(payable)
  const payableUsd = new Function('totals', 'totalUsd', 'refundUsd', 'subtractMoney4', `return ${payable[1]}`)(totals, totals.totalUsd, totals.refundUsd, subtractMoney4)
  assert.equal(payableUsd, 9, 'the settlement covers $10 less the $1 the debt was lowered (base: 8)')
})

await check('Record payment prefills the $2 still owed', () => {
  const start = detail.indexOf('  const settlementSnapshot = (selectedSale')
  const code = transformSync(detail.slice(start, detail.indexOf('  const [settlementSession, setSettlementSession]', start)), { loader: 'ts' }).code
  const snapshot = new Function('settings', 'configuredSettlementMethods', 'saleUsesSavedExchangeRate', 'saleOwnExchangeRate', 'CURRENCY', 'initialSettlementRows', 'returnOwedReductionUsd', 'toNumber', 'subtractMoney4', 'recordedSettlementIssue', `${code}; return settlementSnapshot`)(
    { pos_payment_methods: '["Cash"]' }, configuredSettlementMethods, saleUsesSavedExchangeRate, saleOwnExchangeRate, CURRENCY, initialSettlementRows, returnOwedReductionUsd,
    (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0, subtractMoney4, recordedSettlementIssue)
  const rows = snapshot({ ...probe, payment_details: [{ method: 'Cash', amount_usd: 7, amount_khr: 0 }], payment_method: 'Cash' }).rows as Array<{ usd: string }>
  assert.equal(rows.at(-1)!.usd, '2.00', 'base: 1.00 -- settling it would leave the sale owing')
})

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('sale status tags display: all checks passed')
