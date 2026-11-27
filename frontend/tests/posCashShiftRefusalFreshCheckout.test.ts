// R40 fix 3: after a 409 shift_required_for_cash is released (receipt proof: none), the NEXT Complete Sale must not find the refused id again.
// releaseCashShiftRefusal cleared the order's checkoutRequestId and payload but left checkoutRequestIdsRef holding it, so handleCheckout read
// pendingId from the ref, took the frozen-retry path with an undefined payload and threw the owner-review message before any request.
// This drives the real extracted handleCheckout and releaseCashShiftRefusal together over one fake scope.
// Mutants killed (each turns one assertion red):
//   the release no longer deletes the ref                  -> "the second checkout does not retry the refused id"
//   the release deletes the ref under the wrong key        -> "the second checkout does not retry the refused id"
//   the release deletes the ref without the id check       -> "a newer id on the same order is not erased"
//   the release stops clearing the order's id and payload  -> "the released order holds no request id and no payload"
//   a refusal with a receipt present is released anyway    -> "a committed receipt is shown, the ref is kept out of the retry path"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { cashShiftRefusalOutcome } from '../src/components/pos/cashShiftRefusalRelease.ts'
import { OFFLINE_OWNER_REVIEW_MESSAGE } from '../src/api/offlineQueueOwnership.ts'

const posSource = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
function extract(source: string, name: string): string {
  const ast = ts.createSourceFile('owned.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast)
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) result = `const ${name} = ${node.initializer.getText(ast)}`
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(result, name)
  return result
}
function evaluate(source: string, names: string[], context: Record<string, unknown>): any {
  const code = ts.transpileModule(source + `\nreturn {${names.join(',')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), code)(...Object.values(context))
}

type Order = { id: string; checkoutRequestId: string; checkoutPayload?: Record<string, unknown>; checkoutReviewRequestId?: string }

async function scenario(options: { receipt?: boolean; ref?: Map<string, string> } = {}) {
  let orders: Order[] = [{ id: 'order-1', checkoutRequestId: 'refused-1', checkoutPayload: { client_request_id: 'refused-1' } }]
  const activeOrder: Record<string, unknown> = { ...orders[0] }
  const ref = { current: options.ref ?? new Map([['order-1', 'refused-1']]) }
  const events: string[] = []
  const notes: string[] = []
  let lookedUp = 0
  let dispatched = 0
  let recorded: unknown = null
  const shared = {
    captureActorReadScope: () => ({}), isActorReadScopeCurrent: () => true, assertActorSessionDispatchAllowed: () => {},
    cashShiftRefusalOutcome, SHIFT_STATE_CHANGED_EVENT: 'shift-state-changed', window: { dispatchEvent: (event: { type: string }) => { events.push(event.type) } },
    Event: class { type: string; constructor(type: string) { this.type = type } },
    CustomEvent: class { type: string; constructor(type: string) { this.type = type } },
    checkoutInFlightRef: { current: false }, checkoutRequestIdsRef: ref, resolvedActiveId: 'order-1',
    getSaleWriteTransport: async () => ({ recoverSaleCreateReceipt: async () => { lookedUp++; return options.receipt ? { committed: true, response: { id: 7 } } : { committed: false } } }),
    setOrders: (update: (previous: Order[]) => Order[]) => { orders = update(orders); for (const key of Object.keys(activeOrder)) delete (activeOrder as Record<string, unknown>)[key]; Object.assign(activeOrder, orders[0]) },
    setLoading: () => {}, notify: (message: string) => notes.push(message), t: (key: string) => key,
    getErrorMessage: (error: Error) => error.message, saleSubmitRefusalText: () => null, localizeBranchRuleError: (value: string) => value,
    withLoaderTimeout: (fn: () => unknown) => fn(), POS_CHECKOUT_TIMEOUT_MS: 45000,
    createPosSale: async () => { dispatched++; throw Object.assign(new Error('Open a shift first'), { status: 409, code: 'shift_required_for_cash' }) },
    frozenSaleCheckoutBody: (id: string, payload: unknown) => ({ ...(payload as object), client_request_id: id }),
    canonicalSaleReceipt: (value: unknown) => value, isSaleRecorded: () => false, SaleCheckoutRecoveryRequiredError: class extends Error {},
    assertPosCheckoutOwner: (payload: Record<string, unknown> | undefined) => { if (!payload || !payload.client_request_id) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE) },
    loading: false, savingBlocked: false, savingBlockedText: '', user: { id: 1 }, moneyVersion: 0,
    setReceiptQueue: (update: (previous: unknown[]) => unknown[]) => { recorded = update([]) }, closeOrder: () => {}, loadCatalogData: () => {}, POS_CHECKOUT_SYNC_SOURCE: 'pos',
    active: activeOrder,
  }
  const source = `${extract(posSource, 'releaseCashShiftRefusal')}\n${extract(posSource, 'handleCheckout')}`
  const { handleCheckout } = evaluate(source, ['handleCheckout'], shared)
  return { handleCheckout, ref, notes, events, get orders() { return orders }, get lookedUp() { return lookedUp }, get dispatched() { return dispatched }, get recorded() { return recorded } }
}

console.log('--- the refused id is gone after the release')
{
  const run = await scenario()
  await run.handleCheckout()
  assert.equal(run.dispatched, 1, 'the frozen retry sent its request once and was refused')
  assert.equal(run.lookedUp, 2, 'the receipt was asked for before the retry and again by the release')
  assert.deepEqual(run.orders[0], { id: 'order-1', checkoutRequestId: '', checkoutPayload: undefined, checkoutReviewRequestId: undefined }, 'the released order holds no request id and no payload')
  assert.equal(run.ref.current.has('order-1'), false, 'the released order has no id left in the ref')
  assert.ok(run.events.includes('shift-state-changed'), 'the shift gate is told to re-read')
  run.notes.length = 0
  const lookedBefore = run.lookedUp
  await run.handleCheckout()
  assert.deepEqual(run.notes, ['money_precision_unavailable'], 'the second checkout reaches the fresh-sale path and is stopped only by its first money gate')
  assert.equal(run.notes.includes(OFFLINE_OWNER_REVIEW_MESSAGE), false, 'the second checkout does not retry the refused id')
  assert.equal(run.lookedUp, lookedBefore, 'the second checkout asks for no receipt of the refused id')
  assert.equal(run.dispatched, 1, 'the second checkout sends nothing from the retry path')
  console.log('PASS a second Complete Sale after the cash-shift release is a fresh checkout, not a frozen retry')
}

console.log('--- a newer id on the same order is kept')
{
  const ref = new Map([['order-1', 'newer-2']])
  const run = await scenario({ ref })
  await run.handleCheckout()
  assert.equal(ref.get('order-1'), 'newer-2', 'a newer id on the same order is not erased')
  console.log('PASS the release erases only the id it released')
}

console.log('--- a committed receipt')
{
  const run = await scenario({ receipt: true })
  await run.handleCheckout()
  assert.deepEqual(run.recorded, [{ id: 7 }], 'a committed receipt is shown, the ref is kept out of the retry path')
  console.log('PASS a refusal whose earlier attempt committed shows the receipt')
}

console.log('--- source pin')
{
  const release = extract(posSource, 'releaseCashShiftRefusal')
  assert.ok(release.includes("const orderKey = String(orderId || 'pos-order')"), 'the release uses the key handleCheckout reads')
  assert.ok(release.includes('if (checkoutRequestIdsRef.current.get(orderKey) === requestId) checkoutRequestIdsRef.current.delete(orderKey)'), 'the release deletes that ref, only its own id')
  assert.ok(release.indexOf('checkoutRequestIdsRef.current.delete(') > release.indexOf('outcome.kind !== \'release\''), 'only a proven absence deletes the ref')
  assert.ok(posSource.includes("const orderKey = String(resolvedActiveId || 'pos-order')"), 'the key handleCheckout uses')
  console.log('PASS the release deletes the ref under handleCheckout key, after the proof')
}
