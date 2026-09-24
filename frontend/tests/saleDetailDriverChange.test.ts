// G3: the sale detail screen changes or clears an EXISTING driver.
//
// Before G3 the detail could only ADD a driver to a counter sale; an existing
// driver could be changed only through the Sales page's group Driver action.
// The detail now sends that same group request with ONE sale, so it carries
// the group path's before/after record, grants and Undo (Worker contract
// pinned by cloudflare/scripts/test-sale-driver-change-single-pure.cjs).
//
//   1. THE REQUEST. Sales.tsx's changeSaleDriver and submitBulkFieldChange are
//      run for real (sliced out of the page with stubbed state): a change, a
//      clear and a first driver on a cleared delivery each send one sale with
//      the right source/target, and success is reported back to the detail.
//   2. THE GATE. The detail offers the control for a delivery sale in every
//      status except cancelled (the expression is lifted and evaluated), only
//      with the group path's grants, through the shared searchable picker.
//   3. BOTH PACKS carry the new labels and the inline fallbacks match them.
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

function harness(options: { pending?: unknown; changedCount?: number } = {}) {
  const sent: any[] = []
  const notes: unknown[] = []
  const scope: any = {
    canBulkSales: true, canAmendSales: true, canReassignSaleCustomer: true,
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
  }
  const code = `${slice('  const valueChoice =', '  const choicesForSale =')}\n${slice('  const submitBulkFieldChange =', '  const customerRows =')}`
  const api = new Function('scope', `with (scope) { ${code}\nreturn { changeSaleDriver } }`)(scope) as { changeSaleDriver: (sale: unknown, target: unknown) => Promise<boolean> }
  return { ...api, sent, notes }
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

await runTest('an unchanged answer keeps the picker open, and a pending retry blocks a new request', async () => {
  const unchanged = harness({ changedCount: 0 })
  assert.equal(await unchanged.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  const pending = harness({ pending: { client_request_id: 'older' } })
  assert.equal(await pending.changeSaleDriver(withDriver, { id: 2, name: 'Driver B' }), false)
  assert.deepEqual(pending.sent, [], 'no request while an earlier outcome is unknown')
  assert.match(String(pending.notes[0]), /previous request has an unknown outcome/)
})

await runTest('the detail offers the change in every status except cancelled, with the group grants', () => {
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
  assert.match(salesPage, /onDriverChange=\{canBulkSales && canAmendSales \? \(sale, target\) => changeSaleDriver\(sale as SaleRecord, target\) : undefined\}/)
  // The change uses the same searchable picker as Add delivery, and can clear.
  assert.match(detail, /const renderDriverPicker = \(inputId: string\) => \(/)
  assert.match(detail, /type="search"\n\s+value=\{deliverySearch\}/)
  assert.match(detail, /\{renderDriverPicker\('sale-add-delivery-driver-search'\)\}/)
  assert.match(detail, /\{renderDriverPicker\('sale-change-driver-search'\)\}/)
  assert.match(detail, /onClick=\{\(\) => \{ void applyDriverChange\(null\) \}\}/)
  assert.match(detail, /if \(!deliveryAdding && !driverChanging\) return/, 'the picker loads drivers for the change too')
})

await runTest('both packs carry the new labels and the inline fallbacks match them', () => {
  for (const key of ['change_driver', 'remove_driver']) {
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
