import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { saleCustomerMode, customerRequestIsCurrent } from '../src/utils/saleCustomerMode.ts'
import { beginSingleAction, finishSingleAction } from '../src/utils/actionGuards.ts'
import { normalizePermissionState, getPermissionTierFromMap } from '../src/utils/permissions.ts'
import { actionAllowed, isActionOverriddenOff } from '../src/utils/permissionActions.ts'

assert.equal(saleCustomerMode(true, true), 'assignment')
assert.equal(saleCustomerMode(true, false), 'name-only')
assert.equal(saleCustomerMode(false, true), 'denied')
assert.equal(saleCustomerMode(false, false), 'denied')
for (const [raw, expected] of [
  [{ sales: true, contacts: false }, 'assignment'],
  [{ sales: true, 'sales:customer_reassign': false }, 'name-only'],
  [{ sales: true, 'sales:customer': false }, 'denied'],
  [{ sales: 'view', 'sales:customer_reassign': true }, 'denied'],
  [{ sales: false, 'sales:customer': true }, 'denied'],
] as const) {
  const map = normalizePermissionState(raw)
  const tier = getPermissionTierFromMap(map, 'sales', false)
  const can = (action: string) => actionAllowed('sales', action, tier, () => false, (section, key) => isActionOverriddenOff(map, section, key))
  assert.equal(saleCustomerMode(can('customer'), can('customer_reassign')), expected, 'normalized stored role uses actual action permission table')
}
const source = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const code = transformSync(source.slice(source.indexOf('  const customerRows ='), source.indexOf('  const exportVisibleSales =')), { loader: 'ts' }).code
const known = transformSync(source.slice(source.indexOf('export function isKnownUncommittedSaleCustomerChangeError'), source.indexOf('export default function Sales')).replace('export function', 'function'), { loader: 'ts' }).code
const make = new Function('scope', `with(scope) { ${known}\n${code}\nreturn { openSaleCustomerEdit, loadSaleCustomerChoices, submitSaleCustomerChange } }`)
const sale = { id: 72, customer_id: 8, customer_name: 'Original', customer_phone: '012345678', updated_at: 'v1' }
const target = { id: 9, name: 'Sok Dara' }
function deferred() { let resolve!: (v: unknown) => void; let reject!: (e: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(mode = 'assignment') {
  const requests: unknown[] = [], notifications: unknown[] = [], saved: unknown[] = []
  const state: any = { prompt: null, name: null, detail: sale }
  const set = (key: string) => (value: any) => { state[key] = typeof value === 'function' ? value(state[key]) : value }
  const scope: any = {
    authReady: true, statusSecurityScope: 'actor7:0', statusSecurityRef: { current: 'actor7:0' },
    customerModeRef: { current: mode }, saleCustomerGenerationRef: { current: 0 }, saleCustomerOpenRef: { current: null },
    saleCustomerSearchVersionRef: { current: 0 }, saleCustomerSearchAbortRef: { current: null },
    pendingBulkFieldRequest: null, bulkFieldSaving: false, saleCustomerSaving: false,
    bulkStatusInFlightRef: { current: false }, SALES_BULK_LINKED_PAGE_SIZE: 50,
    customerRequestIsCurrent, beginSingleAction, finishSingleAction,
    setSaleCustomerPrompt: set('prompt'), setSaleCustomerNameForm: set('name'), setDetailSale: set('detail'),
    setSaleCustomerSaving: set('saving'), setBulkFieldSaving: set('bulkSaving'),
    notify: (...args: unknown[]) => notifications.push(args), translateOr: (_: string, fallback: string) => fallback,
    getErrorMessage: (e: any, fallback: string) => e?.message || fallback,
    getSalesCustomerPicker: async () => ({ items: [{ ...target, phone: '012345679' }] }),
    updateSalesBulkField: async (payload: unknown) => { requests.push(payload); return { changedCount: 1, unchangedCount: 0 } },
    savePendingBulkFieldRequest: (payload: unknown) => { saved.push(payload); scope.pendingBulkFieldRequest = payload },
    loadSales: async () => {}, actionHistory: { refreshServerItems: async () => {} },
    window: { dispatchEvent() {} }, CustomEvent: class { constructor(_: string, __: unknown) {} },
  }
  return { scope, state, requests, notifications, saved, ...make(scope) }
}

for (const mode of ['assignment', 'name-only', 'denied']) {
  const f = fixture(mode)
  f.openSaleCustomerEdit(sale)
  assert.equal(!!f.state.prompt, mode === 'assignment')
  assert.equal(!!f.state.name, mode === 'name-only')
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  await f.loadSaleCustomerChoices(sale, 'Dara Sok')
  assert.equal(f.state.prompt.choices[0].id, 9, 'authoritative reordered-name match retained')
  const d = deferred(); f.scope.getSalesCustomerPicker = () => d.promise
  const old = f.loadSaleCustomerChoices(sale, 'old')
  f.scope.getSalesCustomerPicker = async () => ({ items: [{ id: 10, name: 'Latest' }] })
  await f.loadSaleCustomerChoices(sale, 'new')
  d.resolve({ items: [{ id: 11, name: 'Stale' }] }); await old
  assert.equal(f.state.prompt.choices[0].id, 10)
  const close = deferred(); f.scope.getSalesCustomerPicker = () => close.promise
  const late = f.loadSaleCustomerChoices(sale, 'closing')
  f.scope.saleCustomerGenerationRef.current++; f.state.prompt = null
  close.resolve({ items: [target] }); await late
  assert.equal(f.state.prompt, null, 'late result cannot reopen closed modal')
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  const d = deferred(); f.scope.getSalesCustomerPicker = () => d.promise
  const old = f.loadSaleCustomerChoices(sale, 'Alice')
  f.scope.statusSecurityRef.current = 'actor7:1'
  d.resolve({ items: [target] }); await old
  assert.deepEqual(f.state.prompt.choices, [], 'same-ID security refresh blocks old lookup')
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  await f.submitSaleCustomerChange(sale, target)
  assert.deepEqual((f.requests[0] as any).action, { kind: 'customer', source_id: 8, target_id: 9 })
  assert.equal(f.state.detail, null, 'refresh closes all stale snapshots together')
  assert.equal(sale.customer_name, 'Original')
}
{
  const f = fixture('name-only'); f.openSaleCustomerEdit(sale)
  await f.submitSaleCustomerChange(sale, target)
  assert.equal(f.requests.length, 0, 'name-only cannot reassign even via stale callback')
  await f.submitSaleCustomerChange(sale, null, undefined, 'Receipt name')
  assert.deepEqual((f.requests[0] as any).action, { kind: 'customer_name', name: 'Receipt name' })
  assert.deepEqual((f.requests[0] as any).items, [{ id: 72, expected_updated_at: 'v1' }])
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  const d = deferred(); f.scope.updateSalesBulkField = (body: unknown) => { f.requests.push(body); return d.promise }
  const first = f.submitSaleCustomerChange(sale, target)
  await f.submitSaleCustomerChange(sale, target)
  assert.equal(f.requests.length, 1, 'same-tick duplicate write suppressed')
  const beforeReplyNotices = f.notifications.length
  f.scope.statusSecurityRef.current = 'actor7:1'
  d.resolve({ changedCount: 1 }); await first
  assert.equal(f.saved.length, 1, 'old-security response cannot clear frozen recovery')
  assert.equal(f.notifications.length, beforeReplyNotices)
  assert.equal(f.state.detail, sale)
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  f.scope.updateSalesBulkField = async (body: unknown) => { f.requests.push(body); throw { status: 504, message: 'unknown outcome' } }
  await f.submitSaleCustomerChange(sale, target)
  const frozen = f.scope.pendingBulkFieldRequest
  await f.submitSaleCustomerChange(sale, { id: 10, name: 'Different' })
  assert.equal(f.requests.length, 1)
  await f.submitSaleCustomerChange(sale, target, frozen)
  assert.equal(f.requests[1], frozen, 'retry reuses exact frozen identity/body')
  const wrong = { ...frozen, items: [{ id: 73 }] }
  await f.submitSaleCustomerChange(sale, target, wrong)
  assert.equal(f.requests.length, 2)
  f.scope.updateSalesBulkField = async () => { throw { status: 403, message: 'Permission revoked before receipt lookup' } }
  await f.submitSaleCustomerChange(sale, target, frozen)
  assert.equal(f.scope.pendingBulkFieldRequest, frozen, 'retry denial cannot prove the original request uncommitted')
}
{
  const f = fixture(); f.openSaleCustomerEdit(sale)
  f.scope.updateSalesBulkField = async () => { throw { status: 409, code: 'loyalty_reassignment_requires_reconciliation', message: 'Loyalty reconciliation required' } }
  await f.submitSaleCustomerChange(sale, target)
  assert.equal(f.scope.pendingBulkFieldRequest, null, 'known loyalty rejection is not frozen as uncertain')
  assert.equal(f.state.detail, sale)
  assert.match(JSON.stringify(f.notifications), /loyalty points and needs reconciliation/)
}
console.log('PASS actual Sales mode/open/search/write callbacks: assignment, name-only, denial, query/close/security races, duplicate and exact retry, loyalty rejection')
