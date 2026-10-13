import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as destination from '../src/utils/receivingDestination.ts'
import * as draft from '../src/utils/stockSessionDraft.ts'
import * as outcome from '../src/utils/stockAdjustOutcome.ts'
import { extractHistoryResultId } from '../src/utils/historyHelpers.ts'
import type { StockSessionLine } from '../src/utils/stockSessionDraft.ts'
import type { FastStockInCommitLine, FastStockInCommitSettled } from '../src/api/inventoryWriteTransport.ts'
import type * as AttemptModule from '../src/utils/receivingProductAttempt.ts'

const helperPath = fileURLToPath(new URL('../src/utils/receivingProductAttempt.ts', import.meta.url))
const modal = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function section(start: string, end: string): string {
  const from = modal.indexOf(start), to = modal.indexOf(end, from)
  assert(from >= 0 && to > from, `actual modal section: ${start}`)
  return modal.slice(from, to)
}
const controllerSource = [
  section('function applyLineOutcome(', 'interface FastStockInModalProps'),
  section('  const destinationError = ', '  const changeBranch = '),
  section('  const createHeldProduct = ', '  // ---- commit ----'),
  section('  const buildLineRequest = ', '  // Fallback:'),
  section('  const performCommit = ', '  // ---- payment ----'),
].join('\n')

function loadAttempts(): typeof AttemptModule {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const load = (file: string): Record<string, unknown> => {
    if (cache.has(file)) return cache.get(file)!.exports
    const mod = { exports: {} }
    cache.set(file, mod)
    new Function('require', 'module', 'exports', js(readFileSync(file, 'utf8')))((name: string) => {
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
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
}
const store = new Storage(), session = new Storage()
const tails = new Map<string, Promise<unknown>>()
const locks = { request<T>(name: string, _options: unknown, action: () => T): Promise<T> {
  const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(action)
  tails.set(name, next)
  return next
} }
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: store, sessionStorage: session, location: { origin: 'https://business.test' }, addEventListener() {}, dispatchEvent() {},
} })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })
store.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: 3 }))
store.setItem('businessos_read_session', 'same-login-marker')

let serial = 0
function line(created: boolean): StockSessionLine {
  const key = `line-${++serial}`
  return {
    key, requestId: `stock-${key}`, createRequestId: created ? `product-${key}` : '',
    createPayload: created ? { name: `New ${key}` } : null,
    product: { id: created ? '' : 1, name: created ? 'New' : 'Existing' }, productName: created ? 'New' : 'Existing',
    mode: 'add', quantity: 2, freeQuantity: 0, unitCost: '3.25', sellingPrice: '', expiryDate: '', freeGoods: false,
    batchChoice: 'new', batchLabel: '', reason: 'Delivery', conditionTag: '', createdProduct: created, status: 'queued', detail: '',
  }
}

type CreationOutcome = 'confirmed' | 'unknown' | 'pending'
async function controller(createdRows: boolean[], creationOutcomes: CreationOutcome | CreationOutcome[] = 'confirmed') {
  const api = loadAttempts()
  let received = createdRows.map(line), saving = false, step = 'review', finished = 0, creates = 0
  const original = structuredClone(received)
  for (const entry of received.filter(row => row.createPayload)) {
    assert(entry.createRequestId)
    await api.registerReceivingProductAttempt(7, entry.createRequestId)
  }
  const submissionsRef = { current: destination.restoreReceivingSubmissions(null, received) }
  const destinationRef = { current: { branchId: '1', options: [{ value: '1', label: 'Active' }] } }
  const requests: Array<{ lines: FastStockInCommitLine[]; options: unknown }> = []
  const receivingIdentity = { owner: 'same-receiving-owner', epoch: 0 }
  const notifications: string[] = []
  let savedDraft: { lines: StockSessionLine[]; receivingSubmissions: destination.ReceivingSubmissions } | null = null
  const persist = (lines = received) => {
    api.overlayReceivingProductAttempts(7, submissionsRef.current, lines)
    savedDraft = structuredClone({ lines, receivingSubmissions: submissionsRef.current })
  }
  const complete = async () => {
    const renderedReceived = received
    const dependencies = {
      ...api, ...destination, ...draft, ...outcome, extractHistoryResultId,
      receivingIdentity, isActorWriteIdentityCurrent: () => true, assertReceivingOwner: () => {}, stopForSignInChange: () => { throw Error('unexpected owner change') },
      submissionsRef, destinationRef, received, branchId: '1', user: { id: 7, name: 'Actor' }, saving,
      canEditCosts: true, canEditPrice: true, canViewCosts: true, paidAmount: '', paymentStatus: 'paid', creditDueDate: '',
      receivedDate: '2026-10-12', supplier: { supplierId: null, supplierName: 'Supplier' }, sessionIdRef: { current: 123 },
      require(name: string) {
        assert.equal(name, '../../api/productWriteTransport.ts')
        return { createProduct: async (_payload: Record<string, unknown>, check: () => void) => {
          check()
          creates++
          const creationOutcome = Array.isArray(creationOutcomes) ? creationOutcomes[creates - 1] : creationOutcomes
          if (creationOutcome === 'unknown') throw new TypeError('lost acknowledgement after product creation')
          const result = creationOutcome === 'pending' ? { pending: true } : { id: 71 + creates }
          check()
          return result
        } }
      },
      tr: (key: string, fallback?: string) => fallback || key,
      notify: (message: string) => notifications.push(message),
      setStep: (value: string) => { step = value }, setSaving: (value: boolean) => { saving = value },
      setReceived: (value: StockSessionLine[]) => { received = value }, setCreatedProductIds: () => {},
      persistSubmissionDraft: (lines = renderedReceived) => persist(lines), persistSessionDraft: persist,
      stockLineReason: (entry: StockSessionLine) => entry.reason,
      describeLineResult: () => 'Received', isDeferredStockInResult: (result: { code?: string }) => result.code === 'deferred',
      commitFastStockIn: async (lines: FastStockInCommitLine[], settled: (value: FastStockInCommitSettled) => void, options: unknown) => {
        requests.push(structuredClone({ lines, options }))
        const results = lines.map(entry => ({ ok: true, key: entry.key }))
        settled(results.map((result, index) => ({ index, result })))
        return results
      },
      performCommitSequential: () => { throw Error('unexpected old-Worker fallback') }, onDone: () => {},
      finishSession: () => { finished++ },
    }
    const performCommit = new Function(...Object.keys(dependencies), js(controllerSource) + ';return performCommit')(...Object.values(dependencies)) as () => Promise<void>
    await performCommit()
  }
  return { complete, original, requests, notifications, api, submissionsRef, receivingIdentity,
    state: () => ({ received, saving, step, finished, creates }),
    restore() {
      assert(savedDraft)
      received = structuredClone(savedDraft.lines)
      submissionsRef.current = destination.restoreReceivingSubmissions(savedDraft, received)
      api.overlayReceivingProductAttempts(7, submissionsRef.current, received)
    },
  }
}

for (const rows of [[false], [true], [false, true], [true, false], [true, true], [false, true, true]]) {
  const subject = await controller(rows)
  await subject.complete()
  const state = subject.state()
  assert.equal(subject.requests.length, 1, `${JSON.stringify(rows)}: a confirmed product must reach the stock commit in the same Complete action`)
  assert.equal(state.creates, rows.filter(Boolean).length)
  assert.equal(state.finished, 1)
  assert.equal(state.saving, false)
  assert(state.received.every(entry => entry.status === 'saved'))
  let createdId = 71
  assert.deepEqual(subject.requests[0].lines.map(entry => entry.body.productId), rows.map(created => created ? ++createdId : 1))
  assert.deepEqual(subject.requests[0].lines.map(entry => entry.body.clientRequestId), subject.original.map(entry => entry.requestId))
  assert.deepEqual(subject.requests[0].options, { session: { supplierTotalUsd: rows.length * 6.5, paymentStatus: 'paid' }, writeIdentity: subject.receivingIdentity })
  assert.deepEqual(subject.submissionsRef.current.unknown, [])
  await subject.complete()
  assert.equal(subject.state().creates, state.creates, 'another Complete action cannot create again')
  assert.equal(subject.requests.length, 1, 'another Complete action cannot receive stock twice')
  console.log(`PASS actual complete flow ${JSON.stringify(rows)}: exact existing/created IDs, supplier total, receipt IDs and one stock dispatch`)
}

for (const failure of ['unknown', 'pending'] as const) {
  const subject = await controller([false, true], failure)
  await subject.complete()
  subject.restore()
  await subject.complete()
  const state = subject.state(), created = state.received.find(entry => entry.createPayload)!
  assert.equal(subject.requests.length, 0, `${failure}: no partial receiving when creation has not been confirmed`)
  assert.equal(state.creates, 1, `${failure}: restore and retry cannot duplicate creation`)
  assert.equal(state.finished, 0)
  assert.equal(state.step, 'items')
  assert.equal(state.saving, false)
  assert.equal(created.product.id, '')
  assert.equal(created.quantity, 2)
  assert.equal(created.unitCost, '3.25')
  assert.equal(subject.api.readReceivingProductAttempt(7, created.createRequestId)?.state, failure)
  console.log(`PASS actual complete flow ${failure}: existing stock stays untouched, draft preserves entry and creation cannot repeat after restore`)
}

for (const outcomes of [['confirmed', 'unknown'], ['unknown', 'confirmed']] as const) {
  const subject = await controller([false, true, true], [...outcomes])
  await subject.complete()
  const state = subject.state(), created = state.received.filter(entry => entry.createPayload)
  const uncertain = created[outcomes.indexOf('unknown')]
  assert.equal(state.creates, 2)
  assert.equal(subject.requests.length, 0, 'one unconfirmed creation blocks receipt for the whole supplier total')
  assert.deepEqual(subject.submissionsRef.current.unknown, [uncertain.key], 'confirming one product clears only its own stale marker')
  assert.equal(subject.api.readReceivingProductAttempt(7, uncertain.createRequestId)?.state, 'unknown')
  const confirmedIndex = outcomes.indexOf('confirmed')
  assert.equal(created[confirmedIndex].product.id, 72 + confirmedIndex)
  subject.restore()
  await subject.complete()
  assert.equal(subject.state().creates, 2)
  assert.equal(subject.requests.length, 0)
  assert(subject.submissionsRef.current.unknown.includes(uncertain.key))
  console.log(`PASS actual complete flow ${JSON.stringify(outcomes)}: another line's unknown marker survives confirmation and restore`)
}
