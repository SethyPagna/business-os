// G3: the sale detail screen changes or clears an EXISTING driver.
//
// Before G3 the detail could only ADD a driver to a counter sale; an existing
// driver could be changed only through the Sales page's group Driver action.
// The detail now sends that group request with ONE sale, so it carries the group
// path's before/after record and Undo. It is authorised like the delivery cost,
// not like the group: sales:amend alone, and closed outside the sale edit window
// for a non-admin (Worker contract pinned by
// cloudflare/scripts/test-sale-driver-change-single-pure.cjs).
//
//   1. THE REQUEST. Sales.tsx's changeSaleDriver and submitBulkFieldChange are
//      run for real (sliced out of the page with stubbed state): a change, a
//      clear and a first driver on a cleared delivery each send one sale with
//      the right source/target, and success is reported back to the detail.
//   2. THE GATE. The detail offers the control for a delivery sale in every
//      status except cancelled (the expression is lifted and evaluated), only
//      with sales:amend alone (the delivery cost's grant; sales:bulk stays the
//      multi-sale switch) and, for a non-admin, only inside the sale edit window
//      (G1, the same gate as the delivery-cost edit), through the shared searchable
//      picker. Apply opens the shared review dialog showing the driver before and
//      after and the delivery expenses that move with it (G3).
//   3. AFTER SAVING (G8): a sale open from outside the visible list page is read
//      again so the open detail shows its new driver.
//   4. BOTH PACKS carry the new labels and the inline fallbacks match them.
//
// DISCRIMINATING: on 0293aeb0 changeSaleDriver, onDriverChange and the
// canChangeDriver gate do not exist, so every part is red.
//
// Run: node tests/saleDetailDriverChange.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { saleAmendmentWindowAllows } from '../src/utils/permissions.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(path.join(here, ...parts), 'utf8').replace(/\r\n?/g, '\n')
const salesPage = read('..', 'src', 'components', 'sales', 'Sales.tsx')
const detail = read('..', 'src', 'components', 'sales', 'SaleDetailModal.tsx')
const en = JSON.parse(read('..', 'src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('..', 'src', 'lang', 'km.json')) as Record<string, string>

const slice = (from: string, to: string): string => {
  const start = salesPage.indexOf(from)
  const end = salesPage.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `Sales.tsx should contain ${from} before ${to}`)
  return transformSync(salesPage.slice(start, end), { loader: 'ts' }).code
}

function harness(options: { pending?: unknown; changedCount?: number; canBulkSales?: boolean; canAmendSales?: boolean; onPage?: boolean; previewError?: unknown; movedExpenseCount?: number } = {}) {
  const sent: any[] = []
  const previews: any[] = []
  const rereads: number[] = []
  const detailUpdates: any[] = []
  const notes: unknown[] = []
  const scope: any = {
    canBulkSales: options.canBulkSales ?? true, canAmendSales: options.canAmendSales ?? true, canReassignSaleCustomer: true,
    pendingBulkFieldRequest: options.pending ?? null, bulkFieldSaving: false, bulkStatusInFlightRef: { current: false },
    beginSingleAction: (ref: { current: boolean }) => { if (ref.current) return false; ref.current = true; return true },
    finishSingleAction: (ref: { current: boolean }) => { ref.current = false },
    setBulkFieldSaving: () => {}, savePendingBulkFieldRequest: () => {}, setBulkChangePrompt: () => {}, setSelectedIds: () => {},
    updateSalesBulkField: async (payload: unknown) => { sent.push(payload); return { changedCount: options.changedCount ?? 1, unchangedCount: 0 } },
    loadSales: async () => {}, actionHistory: { refreshServerItems: async () => {} },
    window: { dispatchEvent: () => {} }, CustomEvent: class { type: string; constructor(type: string) { this.type = type } },
    notify: (message: unknown) => { notes.push(message) },
    translateOr: (_key: string, english: string) => english, t: (key: string) => key, getStatusLabel: (status: string) => status,
    getErrorMessage: (_e: unknown, fallback: string) => fallback,
    saleCancelledRefusal: () => false, cancelledRefusalMessage: () => '',
    crypto: { randomUUID: () => 'request-0001' },
    isAdmin: false, settings: { sale_amendment_window_minutes: '0' }, saleAmendmentWindowAllows,
    driverWindowClosedMessage: () => 'window closed',
    visibleSales: options.onPage === false ? [] : [{ id: 7 }],
    readAuthoritativeSale: async (id: number, accept: (row: any) => boolean) => { rereads.push(id); const row = { id, delivery_contact_id: 2, updated_at: 'v2' }; return accept(row) ? row : null },
    setDetailSale: (update: unknown) => { detailUpdates.push(update) }, setSelectedSale: () => {},
    previewSalesBulkField: async (payload: unknown) => { previews.push(payload); if (options.previewError) throw options.previewError; return { preview: true, movedExpenseCount: options.movedExpenseCount ?? 0 } },
  }
  const code = `${slice('  const valueChoice =', '  const choicesForSale =')}\n${slice('  const submitBulkFieldChange =', '  const customerRows =')}`
  const api = new Function('scope', `with (scope) { ${code}\nreturn { changeSaleDriver, submitBulkFieldChange, previewSaleDriver } }`)(scope) as { changeSaleDriver: (sale: unknown, target: unknown) => Promise<boolean>; submitBulkFieldChange: (...args: unknown[]) => Promise<boolean>; previewSaleDriver: (sale: unknown, target: unknown) => Promise<{ expenseCount: number } | null> }
  return { ...api, sent, notes, previews, rereads, detailUpdates, scope }
}

const withDriver = { id: 7, receipt_number: 'R7', sale_status: 'completed', updated_at: 'v1', is_delivery: 1, delivery_contact_id: 1, delivery_contact_name: 'Driver A' }
const cleared = { ...withDriver, delivery_contact_id: null, delivery_contact_name: null }

await runTest('the detail changes, clears and re-sets a driver through a one-sale group request', async () => {
  const change = harness()
  assert.equal(await change.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), true, 'success is reported so the picker closes')
  assert.deepEqual(change.sent, [{ client_request_id: 'request-0001', items: [{ id: 7, expected_updated_at: 'v1' }], action: { kind: 'delivery_contact', source_id: 1, target_id: 2 } }])

  const clear = harness()
  assert.equal(await clear.changeSaleDriver(withDriver, null), true)
  assert.deepEqual(clear.sent[0].action, { kind: 'delivery_contact', source_id: 1, target_id: null })

  const first = harness()
  assert.equal(await first.changeSaleDriver(cleared, { id: 2, name: 'Driver B' }), true)
  assert.deepEqual(first.sent[0].action, { kind: 'delivery_contact', source_id: null, target_id: 2 })
})

await runTest('sales:amend alone sends the one-sale change; sales:bulk stays required for a group', async () => {
  const amendOnly = harness({ canBulkSales: false })
  assert.equal(await amendOnly.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), true)
  assert.equal(amendOnly.sent.length, 1)
  const noAmend = harness({ canBulkSales: false, canAmendSales: false })
  assert.equal(await noAmend.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  assert.deepEqual(noAmend.sent, [])
  const group = harness({ canBulkSales: false })
  const choice = { key: '1', label: 'Driver A', id: 1 }
  assert.equal(await group.submitBulkFieldChange('delivery_contact', choice, { key: '2', label: 'Driver B', id: 2 }, [{ id: 7 }, { id: 8 }], [withDriver, { ...withDriver, id: 8 }]), false)
  assert.deepEqual(group.sent, [], 'a two-sale driver change still needs sales:bulk')
})

await runTest('an unchanged answer keeps the picker open, and a pending retry blocks a new request', async () => {
  const unchanged = harness({ changedCount: 0 })
  assert.equal(await unchanged.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  const pending = harness({ pending: { client_request_id: 'older' } })
  assert.equal(await pending.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  assert.deepEqual(pending.sent, [], 'no request while an earlier outcome is unknown')
  assert.match(String(pending.notes[0]), /previous request has an unknown outcome/)
})

await runTest('the detail offers the change in every status except cancelled, with sales:amend alone', () => {
  const gate = detail.match(/const canChangeDriver = (!!onDriverChange && !!toNumber\(sale\.is_delivery\) && currentStatus !== 'cancelled')\n/)
  assert.ok(gate, 'SaleDetailModal should gate the control with canChangeDriver')
  const evaluate = new Function('onDriverChange', 'toNumber', 'sale', 'currentStatus', `return ${gate[1]}`) as (...args: unknown[]) => boolean
  const toNumber = (value: unknown) => Number(value) || 0
  for (const status of ['completed', 'awaiting_payment', 'awaiting_delivery', 'partial_return', 'returned']) {
    assert.equal(evaluate(() => {}, toNumber, { is_delivery: 1 }, status), true, status)
  }
  assert.equal(evaluate(() => {}, toNumber, { is_delivery: 1 }, 'cancelled'), false, 'cancelled is read-only')
  assert.equal(evaluate(() => {}, toNumber, { is_delivery: 0 }, 'completed'), false, 'a counter sale uses Add delivery instead')
  assert.equal(evaluate(undefined, toNumber, { is_delivery: 1 }, 'completed'), false, 'hidden without the grants')
  assert.match(salesPage, /onDriverChange=\{canAmendSales && saleAmendmentWindowAllows\(settings\?\.sale_amendment_window_minutes, detailSale\.created_at, isAdmin\) \? \(sale, target\) => changeSaleDriver\(sale as SaleRecord, target\) : undefined\}/)
  // The change uses the same searchable picker as Add delivery, and can clear.
  assert.match(detail, /const renderDriverPicker = \(inputId: string\) => \(/)
  assert.match(detail, /type="search"\n\s+value=\{deliverySearch\}/)
  assert.match(detail, /\{renderDriverPicker\('sale-add-delivery-driver-search'\)\}/)
  assert.match(detail, /\{renderDriverPicker\('sale-change-driver-search'\)\}/)
  assert.match(detail, /onClick=\{\(\) => \{ void openDriverReview\(null\) \}\}/)
  assert.match(detail, /onClick=\{\(\) => \{ void openDriverReview\(deliveryContact\) \}\}/, 'Apply reviews first')
  assert.match(detail, /onConfirm=\{\(\) => applyDriverChange\(driverConfirm\.target\)\}/)
  assert.match(detail, /driverLabel\(sale\.delivery_contact_name, sale\.delivery_contact_phone\)[\s\S]*?driverConfirm\.target \? driverLabel\(driverConfirm\.target\.name/, 'the dialog shows before and after')
  assert.match(detail, /openDriverReview\(null\) \}\} title=\{translateOr\('remove_driver'[^\n]*aria-label=/, 'the remove button is icon-only with a tooltip')
  assert.match(detail, /if \(!deliveryAdding && !driverChanging\) return/, 'the picker loads drivers for the change too')
})

await runTest('G1: the detail offers the driver change outside the sale edit window to an admin only, the delivery cost\'s gate', () => {
  const driverGate = salesPage.match(/onDriverChange=\{(canAmendSales && saleAmendmentWindowAllows\(settings\?\.sale_amendment_window_minutes, detailSale\.created_at, isAdmin\)) \?/)
  assert.ok(driverGate, 'Sales.tsx gates onDriverChange on the window')
  const costGate = salesPage.match(/onAmend=\{(canAmendSales && saleAmendmentWindowAllows\(settings\?\.sale_amendment_window_minutes, detailSale\.created_at, isAdmin\)) \?/)
  assert.ok(costGate && costGate[1] === driverGate[1], 'the driver edit and the delivery-cost edit ask the same question')
  assert.match(salesPage, /onDriverPreview=\{canAmendSales && saleAmendmentWindowAllows\(settings\?\.sale_amendment_window_minutes, detailSale\.created_at, isAdmin\) \?/)
  const gate = new Function('canAmendSales', 'saleAmendmentWindowAllows', 'settings', 'detailSale', 'isAdmin', `return ${driverGate[1]}`) as (...args: unknown[]) => boolean
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
  const at = (minutes: string, created: string, isAdmin: boolean, amend = true) => gate(amend, saleAmendmentWindowAllows, { sale_amendment_window_minutes: minutes }, { created_at: created }, isAdmin)
  assert.equal(at('60', hoursAgo(2), false), false, 'a sale 2 h old with a 60 min window: no control for a non-admin')
  assert.equal(at('60', hoursAgo(2), true), true, 'an admin still has it')
  assert.equal(at('60', hoursAgo(0.1), false), true, 'inside the window it is offered')
  assert.equal(at('0', hoursAgo(500), false), true, 'window 0 is unlimited')
  assert.equal(at('60', hoursAgo(0.1), false, false), false, 'without sales:amend it is never offered')
})

await runTest('G1: a group driver change is stopped before sending for a non-admin when a matching sale is outside the window; an admin sends it', async () => {
  const old = { ...withDriver, id: 7, created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }
  const choice = { key: '1', label: 'Driver A', id: 1 }
  const blocked = harness()
  blocked.scope.settings = { sale_amendment_window_minutes: '60' }
  assert.equal(await blocked.submitBulkFieldChange('delivery_contact', choice, { key: '2', label: 'Driver B', id: 2 }, [{ id: 7 }], [old]), false)
  assert.deepEqual(blocked.sent, [])
  assert.deepEqual(blocked.notes, ['window closed'])
  const admin = harness()
  admin.scope.settings = { sale_amendment_window_minutes: '60' }
  admin.scope.isAdmin = true
  assert.equal(await admin.submitBulkFieldChange('delivery_contact', choice, { key: '2', label: 'Driver B', id: 2 }, [{ id: 7 }], [old]), true)
  assert.equal(admin.sent.length, 1)
})

await runTest('G8: a sale open from outside the visible list page is read again after the save, and shows its new driver', async () => {
  const offPage = harness({ onPage: false })
  assert.equal(await offPage.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), true)
  assert.deepEqual(offPage.rereads, [7], 'the authoritative read runs for a sale the list does not show')
  assert.equal(offPage.detailUpdates.length, 1)
  assert.deepEqual(offPage.detailUpdates[0]({ id: 7, delivery_contact_id: 1 }), { id: 7, delivery_contact_id: 2, updated_at: 'v2' })
  assert.deepEqual(offPage.detailUpdates[0]({ id: 99 }), { id: 99 }, 'another open sale is left alone')
  const onPage = harness({ onPage: true })
  assert.equal(await onPage.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), true)
  assert.deepEqual(onPage.rereads, [], 'a sale on the visible page is refreshed by the list reload, with no extra read')
  const unchanged = harness({ onPage: false, changedCount: 0 })
  assert.equal(await unchanged.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  assert.deepEqual(unchanged.rereads, [], 'nothing changed, nothing to re-read')
})

await runTest('G3: the review preview asks the Worker (writing nothing) and reports how many delivery expenses move; a refusal opens no dialog', async () => {
  const moves = harness({ movedExpenseCount: 2 })
  assert.deepEqual(await moves.previewSaleDriver(withDriver, { id: 2, name: 'Driver B' }), { expenseCount: 2 })
  assert.deepEqual(moves.previews, [{ client_request_id: 'request-0001', items: [{ id: 7, expected_updated_at: 'v1' }], action: { kind: 'delivery_contact', source_id: 1, target_id: 2 } }])
  assert.deepEqual(moves.sent, [], 'a preview sends no write')
  const refused = harness({ previewError: Object.assign(new Error('closed'), { code: 'window' }) })
  assert.equal(await refused.previewSaleDriver(withDriver, { id: 2, name: 'Driver B' }), null)
  assert.deepEqual(refused.notes, ['window closed'])
  assert.match(detail, /if \(preview\) setDriverConfirm\(\{ target, expenseCount: preview\.expenseCount \}\)/, 'no dialog without a preview answer')
  assert.match(detail, /\.\.\.\(driverConfirm\.expenseCount > 0 \? \[\{ label: translateOr\('expense'/, 'the dialog lists the moved expenses')
})

await runTest('G3: the dialog line names the driver and counts the expenses, in English and from the packs', () => {
  for (const key of ['driver_expense_moves_one', 'driver_expense_moves_many', 'driver_expense_unlinks_one', 'driver_expense_unlinks_many', 'driver_bulk_expenses_note', 'sale_driver_window_closed', 'sale_driver_history_label']) {
    assert.equal(typeof en[key], 'string', key + ' in en.json')
    assert.ok(/[ក-៿]/.test(km[key]), key + ' in km.json is Khmer')
  }
  assert.equal(en.driver_expense_moves_one.replace('{driver}', 'Driver B'), '1 delivery expense moves to Driver B')
  assert.ok(km.driver_expense_moves_many.includes('{count}') && km.driver_expense_moves_many.includes('{driver}'))
  assert.match(en.driver_change_note, /delivery fee and courier cost now count for the new driver/)
  assert.ok(km.driver_change_note.includes('ថ្លៃដឹក') && km.driver_change_note !== en.driver_change_note)
})

await runTest('G7: the comments no longer claim the group grants or the group path\'s permission checks', () => {
  assert.doesNotMatch(salesPage, /Same grants as the group Driver change it reuses/)
  assert.doesNotMatch(salesPage, /passes the same permission checks and gets the same Undo/)
  assert.doesNotMatch(read('saleDetailDriverChange.test.ts'), /it carries the group path's before\/after record,\s+grants and Undo/)
})

await runTest('both packs carry the new labels and the inline fallbacks match them', () => {
  for (const key of ['change_driver', 'remove_driver', 'driver_change_title', 'driver_remove_title', 'driver_before', 'driver_after', 'driver_change_note']) {
    assert.equal(typeof en[key], 'string', `${key} in en.json`)
    assert.equal(typeof km[key], 'string', `${key} in km.json`)
    const call = detail.match(new RegExp(`translateOr\\('${key}', '([^']+)', '([^']+)'\\)`))
    assert.ok(call, `SaleDetailModal translates ${key}`)
    assert.equal(call[1], en[key])
    assert.equal(call[2], km[key])
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
