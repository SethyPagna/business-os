import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildProductWritePayload } from '../src/components/products/helpers/productWriteHelpers.ts'
import * as costFormat from '../src/utils/costBreakdownFormat.ts'

const absent = buildProductWritePayload({ name: 'Ordinary', cost_price_usd: 7.123456 }) as Record<string, unknown>
assert.equal(Object.hasOwn(absent, 'purchase_price_usd'), false, 'absent purchase is not inferred from cost')
assert.equal(absent.cost_price_usd, 7.123456, 'known raw precision survives restore planning')
assert.equal(Object.hasOwn(absent, 'custom_fields'), false, 'omitted custom fields do not become a database binding object')
const known = buildProductWritePayload({ cost_price_usd: 0, cost_price_khr: null, purchase_price_usd: 8.654321, custom_fields: { note: 'kept' } }) as Record<string, unknown>
assert.equal(known.cost_price_usd, 0)
assert.equal(known.cost_price_khr, null)
assert.equal(known.purchase_price_usd, 8.654321)
assert.equal(known.custom_fields, '{"note":"kept"}')
console.log('PASS canonical legacy field presence, zero, null, precision and custom fields')

const { executeProductEditRequest, productEditHistoryReceipt } = await import('../src/utils/productEditRequests.ts')
const rows = new Map<string, string>()
const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
const body = { name: 'Changed', expectedUpdatedAt: 'old', custom_fields: '{}' }
const sent: unknown[] = []
let commits = 0
const receipts = new Map<string, unknown>()
let current = true
const guard = () => { if (!current) throw new Error('stale actor') }
const pointer = { applier: 'product.edit.v1', operation_id: '72', generation: 0 }
const receipt = { success: true, applied: true, action_history_id: 88, operation_id: '72', generation: 0, history: { id: 88, status: 'undoable', server_replayable: true, undo_payload: pointer, redo_payload: pointer } }
const send = async (intent: { productId: string; body: Record<string, unknown> }) => {
  assert.ok(rows.get('actor-7'), 'identity must be durable before dispatch')
  sent.push(structuredClone({ productId: intent.productId, body: intent.body }))
  const id = String(intent.body.client_request_id)
  if (!receipts.has(id)) { commits++; receipts.set(id, receipt) }
  if (sent.length === 1) throw new Error('lost committed response')
  return receipts.get(id)
}
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, send, guard), /lost committed response/)
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, { ...body, name: 'Different' }, send, guard), /pending product save/)
assert.equal(sent.length, 1, 'different intent cannot overwrite an uncertain request')
const result = await executeProductEditRequest(storage, 'actor-7', 12, { ...body, expectedUpdatedAt: 'fresh' }, send, guard)
assert.deepEqual(sent[0], sent[1], 'reload retry keeps the original version and request identity')
assert.equal(commits, 1)
assert.equal(rows.size, 0)
assert.equal(productEditHistoryReceipt(result)?.id, 88)
assert.equal(productEditHistoryReceipt({ ...receipt, action_history_id: 89 }), null)
assert.equal(productEditHistoryReceipt({ ...receipt, pending: true }), null)
assert.equal(productEditHistoryReceipt({ ...receipt, generation: 1 }), null)
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => ({ success: true }), guard), /not confirmed/)
assert.ok(rows.get('actor-7'), 'success-shaped missing receipt does not discard retry evidence')
const unknownIdentity = JSON.parse(rows.get('actor-7')!)['12'].body.client_request_id
for (const response of [{ applied: true }, { ...receipt, action_history_id: 99 }, { ...receipt, generation: 1 }, { pending: true, applied: false }]) {
  await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => response, guard), /not confirmed/)
  assert.equal(JSON.parse(rows.get('actor-7')!)['12'].body.client_request_id, unknownIdentity, 'invalid applied or pending receipt retains the original identity')
}
current = false
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, send, guard), /stale actor/)
assert.equal(sent.length, 2)
current = true
await executeProductEditRequest(storage, 'actor-7', 12, body, async () => ({ pending: true, applied: false, pendingActionId: 51, operation_id: '72', generation: 0 }), guard)
assert.equal(rows.size, 0, 'confirmed review queue is distinct from applied and needs no duplicate submission')
let dispatches = 0
await assert.rejects(executeProductEditRequest({ ...storage, setItem() {} }, 'lost-storage', 12, body, async () => { dispatches++; return receipt }, guard), /retry could not be saved/)
assert.equal(dispatches, 0)
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => { current = false; return receipt }, guard), /stale actor/)
assert.ok(rows.get('actor-7'), 'actor switch after commit leaves retry under its original principal')
assert.equal(rows.get('actor-8'), undefined)
current = true
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => { throw Object.assign(new Error('edge'), { status: 403, transientGateway: true }) }, guard), /edge/)
assert.ok(rows.get('actor-7'))
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => { throw Object.assign(new Error('denied'), { status: 403 }) }, guard), /denied/)
assert.ok(rows.get('actor-7'), 'a later refusal cannot prove the earlier uncertain write failed')
const retained = JSON.parse(rows.get('actor-7')!)['12'].body.client_request_id
await executeProductEditRequest(storage, 'actor-7', 12, body, async intent => {
  assert.equal(intent.body.client_request_id, retained)
  return receipt
}, guard)
assert.equal(rows.size, 0)
await assert.rejects(executeProductEditRequest(storage, 'actor-7', 12, body, async () => { throw Object.assign(new Error('first denied'), { status: 403 }) }, guard), /first denied/)
assert.equal(rows.size, 0, 'first authoritative refusal with no prior uncertainty may release the identity')
console.log('PASS durable edit intent, exact retry, unknown response, review queue, storage and actor fences')

const restored = costFormat.normalizeCostBreakdown({ inputs: [
  { source: 'undo', restored_basis: 'none', target_entry_id: null, cost_usd: 0, previous_cost_usd: 9, recorded_at: '01/10/2026', user_name: 'Dara' },
  { source: 'redo', restored_basis: 'entry', target_entry_id: 42, cost_usd: 9, previous_cost_usd: 7, recorded_at: '02/10/2026', user_name: 'Sok' },
] })!
assert.equal(restored.inputs[0].source, 'undo')
assert.equal(restored.inputs[1].source, 'redo')
assert.equal(restored.inputs[1].target_entry_id, 42)
assert.equal(costFormat.costRowMeta(restored.inputs[0], '01/10/2026'), '01/10/2026 · Dara')
const require = createRequire(import.meta.url)
const floatSource = readFileSync(new URL('../src/components/shared/CostCalculationFloat.tsx', import.meta.url), 'utf8')
const floatCode = ts.transpileModule(floatSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
for (const language of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const module = { exports: {} as { default?: React.ComponentType<any> } }
  let index = 0
  const states = [restored, '', false]
  const mockedRequire = (id: string): any => {
    if (id === 'react') return { ...React, useState: () => [states[index++], () => {}], useEffect: () => {}, useRef: () => ({ current: true }) }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('AppContext')) return { useApp: () => ({ user: { role: 'admin' } }) }
    if (id.includes('acquisitionCostAccess')) return { canViewAcquisitionCosts: () => true }
    if (id.includes('costBreakdownFormat')) return costFormat
    if (id.includes('formatters')) return { fmtDate: (value: string) => value }
    if (id.includes('productReadTransport')) return {}
    if (id.includes('Modal')) return { default: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }
    throw new Error(`Unexpected float dependency ${id}`)
  }
  new Function('require', 'module', 'exports', floatCode)(mockedRequire, module, module.exports)
  const html = renderToStaticMarkup(React.createElement(module.exports.default!, { productId: 42, onClose() {}, t: (key: string, fallback: string) => pack[key] || fallback, fmtUSD: String, fmtKHR: String }))
  assert.ok(html.includes(pack.cost_breakdown_undo_tag))
  assert.ok(html.includes(pack.cost_breakdown_redo_tag))
  assert.ok(html.includes(pack.cost_breakdown_restore_catalog))
  assert.ok(html.includes('Dara'))
}
console.log('PASS actual cost float renders Undo, Redo and restored lot basis in English and Khmer')

const barSource = readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx', import.meta.url), 'utf8')
const barCode = ts.transpileModule(barSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
for (const language of ['en', 'km']) for (const direction of ['undo', 'redo'] as const) {
  const pack = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const module = { exports: {} as { default?: React.ComponentType<any> } }
  const buttons: Array<{ onClick?: () => void; children?: unknown }> = []
  const jsx = require('react/jsx-runtime')
  const collect = (name: string) => (type: unknown, props: Record<string, unknown>, key: unknown) => {
    if (type === 'button') buttons.push(props)
    return jsx[name](type, props, key)
  }
  const shim = (id: string): any => {
    if (id === 'react/jsx-runtime') return { ...jsx, jsx: collect('jsx'), jsxs: collect('jsxs') }
    if (id.includes('LazyPortalMenu')) return { default: ({ content }: { content: (value: unknown) => React.ReactNode }) => React.createElement('section', null, content({ closeMenu() {} })) }
    if (id.includes('AppSelect') || id.includes('history.js')) return { default: () => null }
    if (id.includes('formatters')) return { fmtDateTime24: String }
    return require(id)
  }
  new Function('require', 'module', 'exports', barCode)(shim, module, module.exports)
  const clicked: unknown[] = []
  const history = { undo() {}, redo() {}, undoItems: [], redoItems: [], serverItems: [
    { ...receipt.history, label: 'product.edit.v1', status: direction === 'undo' ? 'undoable' : 'redoable', server_replayable: true },
    { id: 99, label: 'Sale 42', status: 'recorded' },
  ], undoServer: (...args: unknown[]) => clicked.push(args), redoServer: (...args: unknown[]) => clicked.push(args) }
  const html = renderToStaticMarkup(React.createElement(module.exports.default!, { history, t: (key: string) => pack[key] }))
  assert.ok(html.includes(pack.product_edit_history_label))
  assert.ok(html.includes('Sale 42'), 'unrelated labels are preserved')
  assert.ok(!html.includes('product.edit.v1'))
  for (const button of buttons) button.onClick?.()
  assert.deepEqual(clicked, [[88, pack[direction === 'undo' ? 'product_edit_history_undo' : 'product_edit_history_redo']]])
}
console.log('PASS actual History bar and replay completion labels use both packs without changing sibling labels')

const transportSource = readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8')
const transportAst = ts.createSourceFile('productWriteTransport.ts', transportSource, ts.ScriptTarget.Latest, true)
const updateFunction = transportAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateProduct')
assert.ok(updateFunction)
const updateCode = ts.transpileModule(updateFunction.getText(transportAst).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let clock = 0
const transmitted: Array<Record<string, unknown>> = []
const scope = {
  captureActorReadScope: () => ({}), assertActorReadScope: () => {}, window: { sessionStorage: storage },
  productEditStorageKey: () => 'actual-transport', executeProductEditRequest, localizeProductEditError: async (error: unknown) => error,
  getDevicePayload: () => ({ clientTime: `2026-10-02T06:00:0${clock++}Z`, deviceTz: 'Asia/Phnom_Penh', deviceName: 'Test Browser' }),
  encodeId: String, route: async (_channel: string, dispatch: () => Promise<unknown>) => dispatch(),
  apiFetch: async (_method: string, _url: string, value: Record<string, unknown>) => {
    transmitted.push(structuredClone(value))
    if (transmitted.length === 1) throw new Error('actual transport reply lost')
    return receipt
  },
}
const updateProduct = new Function(...Object.keys(scope), `${updateCode}; return updateProduct`)(...Object.values(scope))
await assert.rejects(updateProduct(12, body), /actual transport reply lost/)
await updateProduct(12, { ...body, expectedUpdatedAt: 'newest' })
assert.deepEqual(transmitted[0], transmitted[1], 'real transport must retain original body despite new client clock and version metadata')
console.log('PASS actual update transport retries the original request after clock and version changes')

let releaseFirst!: () => void
const firstRefusal = new Promise<void>(resolve => { releaseFirst = resolve })
let sends = 0
const concurrent = async () => {
  sends++
  if (sends === 1) { await firstRefusal; throw Object.assign(new Error('first refused'), { status: 403 }) }
  throw new Error('second committed reply lost')
}
const first = executeProductEditRequest(storage, 'concurrent', 12, body, concurrent, guard)
await assert.rejects(executeProductEditRequest(storage, 'concurrent', 12, body, concurrent, guard), /second committed reply lost/)
const concurrentIdentity = JSON.parse(rows.get('concurrent')!)['12'].body.client_request_id
releaseFirst()
await assert.rejects(first, /first refused/)
assert.equal(JSON.parse(rows.get('concurrent')!)['12'].body.client_request_id, concurrentIdentity)
await executeProductEditRequest(storage, 'concurrent', 12, body, async intent => {
  assert.equal(intent.body.client_request_id, concurrentIdentity)
  return receipt
}, guard)
console.log('PASS a concurrent earlier refusal cannot erase a later uncertain send')
