import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { activeReceivingDestination, productCreationRefusal, receivingDestinationRefusal, receivingDetailsLocked, restoreReceivingSubmissions, retainReceivingSubmissions } from '../src/utils/receivingDestination.ts'
import { stockFailureText } from '../src/utils/stockAdjustOutcome.ts'
import type { StockSessionLine } from '../src/utils/stockSessionDraft.ts'
import type * as AttemptModule from '../src/utils/receivingProductAttempt.ts'

const helperPath = fileURLToPath(new URL('../src/utils/receivingProductAttempt.ts', import.meta.url))
const modal = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = modal.indexOf('  const createHeldProduct = ')
const controllerSource = modal.slice(start, modal.indexOf('  // ---- commit ----', start))
assert(start > 0 && controllerSource.includes('createProduct('))
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function loadAttempts(change: (text: string) => string = text => text): typeof AttemptModule {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const load = (file: string): Record<string, unknown> => {
    if (cache.has(file)) return cache.get(file)!.exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const text = readFileSync(file, 'utf8')
    new Function('require', 'module', 'exports', js(file === helperPath ? change(text) : text))((name: string) => {
      assert(name.startsWith('.'), `unexpected dependency ${name}`)
      const target = resolve(dirname(file), name)
      assert(target.startsWith(resolve(dirname(helperPath), '..')))
      return load(target)
    }, mod, mod.exports)
    return mod.exports
  }
  return load(helperPath) as unknown as typeof AttemptModule
}

class Storage {
  data = new Map<string, string>()
  fail = false
  mismatch = false
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.fail) throw Error('storage denied')
    this.data.set(key, this.mismatch && key.startsWith('businessos_receiving_product_attempt') ? '{}' : String(value))
  }
  removeItem(key: string) { this.data.delete(key) }
}
const store = new Storage()
const session = new Storage()
let lockDepth = 0, lockCalls = 0
const tails = new Map<string, Promise<unknown>>()
const locks = { request: <T>(name: string, _options: unknown, action: () => T): Promise<T> => {
  lockCalls++
  const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(() => {
    lockDepth++
    try { return action() } finally { lockDepth-- }
  })
  tails.set(name, next)
  return next
} }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: store, sessionStorage: session, location: { origin: 'https://business.test' }, addEventListener() {}, dispatchEvent() {} } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })
store.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: 3 }))
store.setItem('businessos_read_session', 'same-login-marker')
let serial = 0
const requestId = () => `product-test-${++serial}`
const body = (id: string) => ({ name: 'New', client_request_id: id, userId: 7, userName: 'Actor', branch_id: '1', stock_quantity: 0 })
const noop = () => {}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected
const rawKey = (id: string) => [...store.data.keys()].find(key => key.startsWith('businessos_receiving_product_attempt') && decodeURIComponent(key).includes(`"${id}"`))!
const entryFor = (id: string): StockSessionLine => ({ key: id, requestId: `stock-${id}`, createRequestId: id, createPayload: { name: 'New' },
  product: { id: '', name: 'New' }, productName: 'New', mode: 'add', quantity: 2, freeQuantity: 0, unitCost: '3.25', sellingPrice: '5',
  expiryDate: '2027-01-01', freeGoods: false, batchChoice: 'new', batchLabel: '', reason: 'Delivery', conditionTag: '', createdProduct: false, status: 'queued', detail: '' })
function controller(id: string, response: (payload: Record<string, unknown>) => Promise<unknown>, api = loadAttempts(), source = controllerSource) {
  const entry = entryFor(id)
  const submissionsRef = { current: restoreReceivingSubmissions(null, []) }
  const destinationRef = { current: { branchId: '1', options: [{ value: '1', label: 'Active' }] } }
  let calls = 0, failDraft = false
  const deps = { ...api, submissionsRef, destinationRef, productCreationRefusal, activeReceivingDestination, branchId: '1', user: { id: 7, name: 'Actor' },
    require: () => ({ createProduct: async (payload: Record<string, unknown>, check?: () => void) => {
      check?.()
      assert.equal(lockDepth, 0, 'network must run outside the Web Lock')
      calls++
      const result = await response(payload)
      check?.()
      return result
    } }),
    destinationError: (lines: StockSessionLine[]) => {
      api.overlayReceivingProductAttempts(7, submissionsRef.current, lines)
      return receivingDestinationRefusal(destinationRef.current.branchId, destinationRef.current.options, lines, submissionsRef.current)
    },
    persistSubmissionDraft: () => {
      if (failDraft) throw Object.assign(Error('draft denied'), { code: 'receiving_submission_not_saved' })
      api.overlayReceivingProductAttempts(7, submissionsRef.current, [entry])
      store.setItem('mutable-draft', JSON.stringify({ lines: [entry], receivedDate: '2026-09-03', receivingSubmissions: submissionsRef.current }))
    }, stockFailureText, tr: (key: string) => key, extractHistoryResultId: (result: { id?: number }) => result?.id }
  const create = new Function(...Object.keys(deps), js(source) + ';return createHeldProduct')(...Object.values(deps)) as (line: StockSessionLine) => Promise<number>
  const draftStart = modal.indexOf('  const currentDraft = ')
  const draftSource = modal.slice(draftStart, modal.indexOf('  // Keystrokes', draftStart))
  const draftDeps = { ...deps, receivingDetailsLocked, retainReceivingSubmissions, received: [entry], sessionIdRef: { current: 123 },
    mode: 'add', currentStep: 'items', brand: '', receivedDate: '2026-09-03', supplier: { supplierId: 7, supplierName: 'Supplier' },
    paymentStatus: 'credit', creditDueDate: '2026-10-10', paidAmount: '13', query: '', picked: null, quantity: '2', protectedUnitCost: '3.25',
    sellingPrice: '5', expiryDate: '2027-01-01', reason: '', conditionTag: '', batchChoice: 'new', createPayload: null, createRequestId: '', scannedBarcode: '', createdProductIds: [] }
  const snapshot = new Function(...Object.keys(draftDeps), js(draftSource) + ';return currentDraft')(...Object.values(draftDeps)) as () => { receivingSubmissions?: typeof submissionsRef.current; receivedDate: string; paidAmount: string }
  return { entry, api, submissionsRef, destinationRef, create: () => create(entry), calls: () => calls, failDraft: (value: boolean) => { failDraft = value },
    snapshot,
    staleAutosave: () => store.setItem('mutable-draft', JSON.stringify({ lines: [entry], receivingSubmissions: restoreReceivingSubmissions(null, []) })),
    reload: () => { submissionsRef.current = restoreReceivingSubmissions(JSON.parse(store.getItem('mutable-draft') || '{}'), [entry]); api.overlayReceivingProductAttempts(7, submissionsRef.current, [entry]) } }
}

const api = loadAttempts()
const id = requestId()
await api.registerReceivingProductAttempt(7, id)
assert.equal(api.readReceivingProductAttempt(7, id)?.state, 'prepared')
const ticket = await api.reserveReceivingProductAttempt(7, id, body(id), noop)
assert.equal(api.readReceivingProductAttempt(7, id)?.bodyJson, JSON.stringify(body(id)))
await assert.rejects(loadAttempts().reserveReceivingProductAttempt(7, id, body(id), noop), code('product_create_outcome_unknown'))
await api.finishReceivingProductAttempt(ticket, 'not_dispatched')
await assert.rejects(api.reserveReceivingProductAttempt(7, id, { ...body(id), branch_id: '2' }, noop), code('receiving_submission_locked'))
const next = await loadAttempts().reserveReceivingProductAttempt(7, id, body(id), noop)
await assert.rejects(api.finishReceivingProductAttempt(ticket, 'not_dispatched'), code('product_create_outcome_unknown'))
assert.equal(api.readReceivingProductAttempt(7, id)?.owner, next.owner)
await api.finishReceivingProductAttempt(next, 'confirmed', 72)
await assert.rejects(api.reserveReceivingProductAttempt(7, id, body(id), noop))
assert(lockCalls >= 8)
console.log('PASS durable exact identity/body, no live-attempt replay, terminal retention and old-owner CAS refusal')

for (const outcome of ['unknown', 'pending', 'confirmed'] as const) {
  const key = requestId()
  await api.registerReceivingProductAttempt(7, key)
  const response = async () => {
    if (outcome === 'unknown') throw new TypeError('lost ACK after commit')
    return outcome === 'pending' ? { pending: true } : { id: 72 }
  }
  const a = controller(key, response), b = controller(key, response)
  if (outcome === 'confirmed') assert.equal(await a.create(), 72)
  else await assert.rejects(a.create())
  const durable = store.getItem(rawKey(key))
  const freshSnapshot = b.snapshot()
  assert.equal(freshSnapshot.receivingSubmissions?.productOutcomes[key], outcome === 'pending' ? 'pending' : 'unknown')
  assert.equal(freshSnapshot.receivedDate, '2026-09-03')
  assert.equal(freshSnapshot.paidAmount, '13')
  b.staleAutosave()
  b.submissionsRef.current = retainReceivingSubmissions(b.submissionsRef.current, [])
  store.removeItem('mutable-draft')
  b.staleAutosave()
  b.reload()
  await assert.rejects(b.create(), code(outcome === 'pending' ? 'product_pending_review' : 'product_create_outcome_unknown'))
  b.destinationRef.current.options = []
  await assert.rejects(b.create())
  assert.equal(a.calls() + b.calls(), 1)
  assert.equal(store.getItem(rawKey(key)), durable)
  assert.equal(b.entry.unitCost, '3.25')
  assert.equal(b.entry.expiryDate, '2027-01-01')
}
console.log('PASS actual independent controllers: stale autosave, remove/clear, reload and retirement retain unknown/pending/confirmed fences')

const concurrentId = requestId()
await api.registerReceivingProductAttempt(7, concurrentId)
let release!: () => void
const pendingResponse = new Promise<void>(resolve => { release = resolve })
const a = controller(concurrentId, async () => { await pendingResponse; throw Error('lost ACK') })
const b = controller(concurrentId, async () => { throw Error('must not dispatch') })
const first = a.create()
const second = b.create()
await assert.rejects(second)
assert.equal(a.calls() + b.calls(), 1)
assert.equal(api.readReceivingProductAttempt(7, concurrentId)?.state, 'attempting')
release()
await assert.rejects(first)
console.log('PASS simultaneous actual controllers reserve once before transport; crash/await marker blocks other tabs')

const legacy = controller(requestId(), async () => ({ id: 73 }))
await assert.rejects(legacy.create(), code('product_create_outcome_unknown'))
assert.equal(legacy.calls(), 0)
const freshId = requestId()
await api.registerReceivingProductAttempt(7, freshId)
let sends = 0
const fresh = controller(freshId, async () => {
  if (++sends === 1) throw Object.assign(Error('offline before fetch'), { code: 'write_requires_live_server' })
  return { id: 73 }
})
fresh.failDraft(true)
await assert.rejects(fresh.create(), code('receiving_submission_not_saved'))
assert.equal(fresh.calls(), 0)
assert.equal(api.readReceivingProductAttempt(7, freshId)?.state, 'prepared')
fresh.failDraft(false)
await assert.rejects(fresh.create(), code('write_requires_live_server'))
assert.equal(api.readReceivingProductAttempt(7, freshId)?.state, 'not_dispatched')
assert.equal(await fresh.create(), 73)
for (const failure of [{ status: 400 }, { status: 409 }, { status: 503, outcome: 'unknown' }, { code: 'write_requires_live_server', outcome: 'unknown' }]) {
  const key = requestId()
  await api.registerReceivingProductAttempt(7, key)
  const subject = controller(key, async () => { throw Object.assign(Error('refusal is not proof of no dispatch'), failure) })
  await assert.rejects(subject.create())
  await assert.rejects(controller(key, async () => ({ id: 74 })).create())
  assert.equal(subject.calls(), 1)
}
console.log('PASS legacy markerless refuses; fresh registration and definite pre-dispatch recovery work; generic HTTP failures never reset')

const unavailableId = requestId()
await api.registerReceivingProductAttempt(7, unavailableId)
;(navigator as unknown as { locks?: unknown }).locks = undefined
await assert.rejects(api.reserveReceivingProductAttempt(7, unavailableId, body(unavailableId), noop), code('receiving_submission_not_saved'))
;(navigator as unknown as { locks?: unknown }).locks = locks
store.fail = true
await assert.rejects(api.reserveReceivingProductAttempt(7, unavailableId, body(unavailableId), noop), code('receiving_submission_not_saved'))
store.fail = false
assert.equal(api.readReceivingProductAttempt(7, unavailableId)?.state, 'prepared')
store.mismatch = true
await assert.rejects(api.registerReceivingProductAttempt(7, requestId()), code('receiving_submission_not_saved'))
store.mismatch = false
await assert.rejects(api.reserveReceivingProductAttempt(7, unavailableId, { ...body(unavailableId), name: 'a'.repeat(128 * 1024) }, noop), code('receiving_submission_not_saved'))
const saved = store.getItem(rawKey(unavailableId))!
for (const corrupt of ['{', '{}', saved.replace('"prepared"', '"unknown-mode"'), 'a'.repeat(128 * 1024 + 1)]) {
  store.setItem(rawKey(unavailableId), corrupt)
  await assert.rejects(api.reserveReceivingProductAttempt(7, unavailableId, body(unavailableId), noop))
  store.setItem(rawKey(unavailableId), saved)
}
store.setItem('businessos_user', JSON.stringify({ id: 8, organization_id: 3 }))
await assert.rejects(loadAttempts().reserveReceivingProductAttempt(8, unavailableId, { ...body(unavailableId), userId: 8 }, noop))
store.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: 4 }))
await assert.rejects(loadAttempts().reserveReceivingProductAttempt(7, unavailableId, body(unavailableId), noop))
store.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: 3 }))
store.setItem('businessos_read_session', 'changed-login')
await assert.rejects(loadAttempts().reserveReceivingProductAttempt(7, unavailableId, body(unavailableId), noop))
store.setItem('businessos_read_session', 'same-login-marker')
assert.equal(store.getItem(rawKey(unavailableId)), saved)
console.log('PASS no locks/storage, readback mismatch, oversized/corrupt record, actor/organization/session mismatch all refuse without clearing evidence')

const finalId = requestId()
const finalApi = loadAttempts()
await finalApi.registerReceivingProductAttempt(7, finalId)
const final = controller(finalId, async () => { store.fail = true; return { id: 75 } }, finalApi)
await assert.rejects(final.create(), code('product_create_outcome_unknown'))
store.fail = false
assert.equal(finalApi.readReceivingProductAttempt(7, finalId)?.state, 'attempting')
await assert.rejects(controller(finalId, async () => ({ id: 75 })).create())
assert.equal(final.calls(), 1)
console.log('PASS confirmed-result persistence failure retains the pre-dispatch fence and unknown guidance')

async function heldLockProbe(subject: typeof AttemptModule): Promise<boolean> {
  const key = requestId()
  await subject.registerReceivingProductAttempt(7, key)
  let unblock!: () => void
  const held = locks.request(rawKey(key), {}, () => new Promise<void>(resolve => { unblock = resolve }))
  await Promise.resolve()
  await Promise.resolve()
  let settled = false
  const reserved = subject.reserveReceivingProductAttempt(7, key, body(key), noop).then(result => { settled = true; return result })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const waited = !settled && subject.readReceivingProductAttempt(7, key)?.state === 'prepared'
  unblock()
  await held
  await reserved
  return waited
}
assert.equal(await heldLockProbe(loadAttempts()), true)
const bypass = loadAttempts(text => {
  const start = text.indexOf('  return navigator.locks.request(keyOf(current)')
  const end = text.indexOf('\n}\n', start)
  assert(start > 0 && end > start)
  return text.slice(0, start) + '  return action()' + text.slice(end)
})
assert.equal(await heldLockProbe(bypass), false, 'wrong bypassed lock must fail the held-lock schedule')
const resetUnknown = loadAttempts(text => text.replace('write(attempt, { ...saved, state, productId })', "write(attempt, { ...saved, state: state === 'unknown' ? 'not_dispatched' : state, productId })"))
const wrongId = requestId()
await resetUnknown.registerReceivingProductAttempt(7, wrongId)
const wrongA = controller(wrongId, async () => { throw Error('lost ACK') }, resetUnknown)
const wrongB = controller(wrongId, async () => { throw Error('lost ACK') }, resetUnknown)
await assert.rejects(wrongA.create())
await assert.rejects(wrongB.create())
assert.equal(wrongA.calls() + wrongB.calls(), 2, 'wrong generic failure reset must reproduce duplicate dispatch')
console.log('PASS discriminating controls: lock bypass violates held-lock schedule; unknown reset duplicates actual controller dispatch')

const retirementId = requestId()
const retirementApi = loadAttempts()
await retirementApi.registerReceivingProductAttempt(7, retirementId)
const retirement = controller(retirementId, async () => ({ id: 76 }), {
  ...retirementApi,
  reserveReceivingProductAttempt: async (...args) => {
    const attempt = await retirementApi.reserveReceivingProductAttempt(...args)
    retirement.destinationRef.current.options = []
    return attempt
  },
})
await assert.rejects(retirement.create(), code('product_create_outcome_unknown'))
assert.equal(retirement.calls(), 0)
console.log('PASS destination retirement after reservation refuses before transport and retains uncertainty fence')
