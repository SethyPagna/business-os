import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import {
  SALE_LINE_IN_FLIGHT_BOUND_MS,
  directMutationStorageKey,
  loadPendingDirectMutation,
  runSaleLineMutation,
} from '../src/utils/directMutationRequest.ts'

class MemoryStorage {
  private rows = new Map<string, string>()
  get length() { return this.rows.size }
  key(index: number) { return [...this.rows.keys()][index] ?? null }
  getItem(key: string) { return this.rows.get(key) ?? null }
  setItem(key: string, value: string) { this.rows.set(key, value) }
  removeItem(key: string) { this.rows.delete(key) }
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, _options: unknown, action: () => unknown) => action() } } })

const actor = 'runtime:employee912', entity = '41'
const r0 = '2026-10-05T01:00:00.000Z', r1 = '2026-10-05T01:00:05.000Z'
const amendment = (id: string, quantity: number, version = r0) => ({ client_request_id: id, money_precision_version: 1, expected_updated_at: version,
  expected_exchange_rate: 4000, kind: 'line_updated', sale_item_id: 7, quantity, expected_header_quote: { total_usd: quantity * 9.5 } })
const refused = { mutationError: 'Your screen was holding an older version of this sale.', code: 'write_conflict', proven_uncommitted: true }
const unproven = { mutationError: 'Could not update the sale: Too many requests' }
const timeout = Object.assign(new Error('Amend sale timed out'), { code: 'loader_timeout' })
function runner(storage: MemoryStorage, clock: { now: number }, send: (body: Record<string, unknown>) => Promise<unknown>, sent: Record<string, unknown>[] = []) {
  return (body?: Record<string, unknown>, receipt = { committed: false }) => runSaleLineMutation<unknown>({
    kind: 'sale-amendment', actorId: actor, entityId: entity, storage, body, isCurrent: () => true, now: () => clock.now,
    readReceipt: async () => receipt,
    send: async frozen => { sent.push(frozen); return send(frozen) },
    isCommitted: result => !!result && typeof result === 'object' && (result as { committed?: unknown }).committed === true,
    isProvenUncommitted: result => !!result && typeof result === 'object' && (result as { proven_uncommitted?: unknown }).proven_uncommitted === true,
  })
}
const pending = (storage: MemoryStorage) => loadPendingDirectMutation('sale-amendment', actor, entity, storage)

{
  const storage = new MemoryStorage(), clock = { now: Date.parse(r0) }, sent: Record<string, unknown>[] = []
  let reply: unknown = refused
  const run = runner(storage, clock, async () => reply, sent)
  const outcome = await run(amendment('stale-r0', 3))
  assert.equal(outcome.committed, false)
  assert.equal(outcome.released, true)
  assert.equal(pending(storage), null, 'a refusal proved before any write must not pause later edits')
  reply = { committed: true, response: { updated_at: r1 } }
  const next = await run(amendment('fresh-r1', 3, r1))
  assert.equal(next.committed, true)
  assert.deepEqual(sent.map(body => [body.client_request_id, body.expected_updated_at]), [['stale-r0', r0], ['fresh-r1', r1]])
  console.log('PASS proven pre-write refusal on a first send releases the request and the next fresh edit is admitted')
}
{
  const storage = new MemoryStorage(), clock = { now: Date.parse(r0) }, sent: Record<string, unknown>[] = []
  const run = runner(storage, clock, async () => { throw timeout }, sent)
  const body = amendment('unknown-outcome', 2)
  await assert.rejects(run(body))
  assert.deepEqual(pending(storage)!.body, body, 'a timeout keeps the exact body and identity frozen')
  await assert.rejects(run(amendment('different-edit', 4, r1)), /pending sale request/)
  assert.equal(sent.length, 1, 'a frozen unknown outcome admits no other change')
  for (const reply of [unproven, { mutationError: 'Could not update the sale: HTTP 503' }, false]) {
    const other = new MemoryStorage()
    const outcome = await runner(other, clock, async () => reply)(amendment('known-unproven', 2))
    assert.equal(outcome.released, undefined)
    assert.ok(pending(other), 'a refusal without proof of no write stays frozen')
  }
  console.log('PASS unknown outcomes and unproven refusals stay frozen with the same identity')
}
{
  const storage = new MemoryStorage(), clock = { now: Date.parse(r0) }, sent: Record<string, unknown>[] = []
  let fail = true
  const run = runner(storage, clock, async () => { if (fail) throw timeout; return refused }, sent)
  const body = amendment('timed-out-then-refused', 2)
  const key = directMutationStorageKey('sale-amendment', actor, entity)
  await assert.rejects(run(body))
  const frozen = storage.getItem(key)
  clock.now += 2 * SALE_LINE_IN_FLIGHT_BOUND_MS
  await assert.rejects(run(), 'a late Retry that times out again is another send that may still land')
  fail = false
  clock.now += 60_000
  const early = await run()
  assert.equal(early.released, undefined, 'an old request whose latest send timed out a minute ago stays frozen')
  assert.equal(storage.getItem(key), frozen, 'the frozen record stays byte-identical across retries')
  clock.now += SALE_LINE_IN_FLIGHT_BOUND_MS
  const late = await run()
  assert.equal(late.released, true)
  assert.equal(pending(storage), null)
  assert.equal(storage.length, 0, 'release also forgets the send time')
  assert.deepEqual(sent.map(row => row.client_request_id), Array(4).fill('timed-out-then-refused'))
  console.log('PASS retry refusal releases only after every earlier send of the identity is past the in-flight bound')
}
{
  const storage = new MemoryStorage(), clock = { now: Date.parse(r0) }
  const body = amendment('legacy-stuck', 2)
  storage.setItem(directMutationStorageKey('sale-amendment', actor, entity), JSON.stringify({ version: 2, kind: 'sale-amendment', actorId: actor, entityId: entity,
    createdAt: clock.now - 2 * SALE_LINE_IN_FLIGHT_BOUND_MS, reconcileAfter: clock.now + 1e9, history: null, body }))
  const committedElsewhere = await runner(storage, clock, async () => { throw Error('must not resend a committed request') })(undefined, { committed: true, response: { updated_at: r1 } } as never)
  assert.equal(committedElsewhere.committed, true, 'receipt-first recovery still wins over any resend')
  storage.setItem(directMutationStorageKey('sale-amendment', actor, entity), JSON.stringify({ version: 2, kind: 'sale-amendment', actorId: actor, entityId: entity,
    createdAt: clock.now - 2 * SALE_LINE_IN_FLIGHT_BOUND_MS, reconcileAfter: clock.now + 1e9, history: null, body }))
  const released = await runner(storage, clock, async () => refused)()
  assert.equal(released.released, true, 'an old request stuck behind the stale-version bug is released by its proven refusal')
  assert.equal(pending(storage), null)
  console.log('PASS receipt-first recovery precedes release; an existing stuck request is released on its proven refusal')
}

const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
function actual(source: string, name: string, env: Record<string, unknown>) {
  const parsed = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => { if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(parsed) === name) initializer = ts.isFunctionDeclaration(node) ? node as unknown as ts.Expression : node.initializer; ts.forEachChild(node, visit) }
  visit(parsed)
  assert.ok(initializer, name)
  const text = ts.isFunctionDeclaration(initializer as ts.Node) ? `(${(initializer as ts.Node).getText(parsed).replace(/^export\s+/, '')})` : initializer!.getText(parsed)
  const code = ts.transpileModule('const actual = ' + text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('env', 'with(env) { ' + code + '; return actual }')(env)
}
const provesNoCommit = actual(sales, 'saleLineRefusalProvesNoCommit', {})
for (const [error, expected] of [
  [{ status: 409, code: 'write_conflict' }, true], [{ status: 403, code: null }, true], [{ status: 409, code: 'exchange_rate_changed' }, true],
  [{ status: 409, code: 'sale_header_quote_conflict' }, true], [{ status: 409, code: 'idempotency_conflict' }, false], [{ status: 429, code: null }, false],
  [{ status: 500, code: null }, false], [{ status: 503, code: 'money_precision_schema_not_ready' }, false], [{ code: 'loader_timeout' }, false],
  [{ status: 409, code: 'money_precision_basket_review_needed' }, false], [new Error('Failed to fetch'), false],
] as const) assert.equal(provesNoCommit(error), expected, JSON.stringify(error))
for (const name of ['handleAmendSale', 'handleAddSaleItems']) {
  for (const [thrown, proven] of [[{ status: 409, code: 'write_conflict', conflict: true, actualUpdatedAt: r1, message: 'changed' }, true], [{ status: 403, code: null, message: 'denied' }, true], [{ status: 429, code: null, message: 'slow down' }, false]] as const) {
    const refreshed: unknown[] = []
    const env: Record<string, unknown> = {
      statusSecurityRef: { current: 'scope' }, aliveRef: { current: true }, canAmendSales: true, canAddSaleItems: true, notify: () => {},
      translateOr: (_key: string, english: string) => english, t: (key: string) => key, withLoaderTimeout: async (run: () => unknown) => run(),
      getSalesApi: () => ({ amendSale: async () => { throw thrown }, addSaleItems: async () => { throw thrown } }),
      saleLineRefusalProvesNoCommit: provesNoCommit, directMutationOutcomeIsUnknown: () => false, isWriteConflict: (error: { conflict?: boolean }) => !!error.conflict,
      refreshCommittedLineSale: async (...args: unknown[]) => { refreshed.push(args) }, loadSales: async () => {}, getErrorMessage: (error: { message?: string }) => String(error.message),
      saleInvalidRateMessage: () => null, SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS: 1,
    }
    const result = await actual(sales, name, env)(41, name === 'handleAmendSale' ? amendment('parent', 2) : [{ product_id: 2, quantity: 1 }], { client_request_id: 'parent' })
    assert.equal(result.proven_uncommitted === true, proven, `${name} ${JSON.stringify(thrown)}`)
    if (thrown.code === 'write_conflict') assert.deepEqual(refreshed, [[41, r1, 'scope']], 'a refused stale edit reloads the exact sale so the redo starts from the latest version')
  }
}
console.log('PASS actual Sales handlers mark only server-proven pre-write refusals; 429, 5xx, timeouts and idempotency conflicts stay unproven')

const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
{
  const storage = new MemoryStorage(), pendingStates: unknown[] = [], sends: Record<string, unknown>[] = []
  let reply: unknown = refused
  const env: Record<string, any> = {
    lineWriteOwnerRef: { current: null }, captureActorReadScope: () => ({}), isActorReadScopeCurrent: () => true,
    detailScope: 'scope', detailScopeRef: { current: 'scope' }, detailAliveRef: { current: true }, authReady: true, user: { id: 912 }, sale: { id: 41, money_precision_version: 1 }, lineMutationActor: actor,
    setLineRecoveryBusy: () => {}, setPendingLineMutation: (value: unknown) => pendingStates.push(value), setLineRecoveryError: () => {},
    runSaleLineMutation, getSaleLineReceipt: async () => ({ committed: false }), window: { localStorage: storage, dispatchEvent: () => {} }, CustomEvent: class {},
    moneyCapability: { assertReady: () => {} }, onAmend: async (_id: unknown, body: Record<string, unknown>) => { sends.push(body); return reply }, onAddItems: undefined,
    t: (key: string) => key, compareSaleHeaderQuote: () => 'match', headerQuote: () => ({}), setLineHeaderConflict: () => {}, setLineReviewConfirm: () => {}, setAmendConfirm: () => {}, setAddConfirmOpen: () => {},
  }
  const execute = actual(modal, 'executeLineMutation', env)
  const result = await execute('sale-amendment', amendment('modal-stale', 3))
  assert.equal(result.proven_uncommitted, true)
  assert.equal(pendingStates.at(-1), null, 'the detail leaves its paused state after a proven refusal')
  assert.equal(pending(storage), null)
  reply = { committed: true, response: { updated_at: r1 } }
  assert.equal((await execute('sale-amendment', amendment('modal-redo', 3, r1))).committed, true)
  reply = { mutationError: 'review', code: 'sale_header_quote_conflict', proven_uncommitted: true, header_quote: { total_usd: 21 } }
  await execute('sale-amendment', amendment('modal-header', 2, r1))
  assert.ok(pending(storage), 'a header conflict with its new quote keeps the request for the explicit total review')
  assert.deepEqual(sends.map(body => body.client_request_id), ['modal-stale', 'modal-redo', 'modal-header'])
  console.log('PASS actual detail executor leaves the paused state on a proven refusal and admits the redo')
}
