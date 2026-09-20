import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const appSource = read('../src/App.tsx')
const posSource = read('../src/components/pos/POS.tsx')
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

// Mount the actual extracted production hook with React, using the existing
// small DOM fixture rather than importing App and its unrelated page graph.
const lifecycle = read('./productDraftLifecycle.test.ts')
const fixtureEnd = lifecycle.search(/const \{\r?\n  clearWorkDraft/)
assert.ok(fixtureEnd > 0)
const fixture = lifecycle.slice(lifecycle.indexOf('class MemoryStorage'), fixtureEnd)
const doc = new Function(ts.transpileModule(`${fixture}\nreturn memoryDocument;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)()
const events = new EventTarget()
Object.assign(window, {
  location: { origin: 'https://shop.test' },
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
})
const scopes = await import('../src/api/actorReadScope.ts')
const ownership = await import('../src/api/offlineQueueOwnership.ts')
const { setSyncServerUrl } = await import('../src/api/httpState.ts')
setSyncServerUrl('https://shop.test')
const userA = { id: 1, organization_id: 10 }
const userB = { id: 2, organization_id: 10 }
function setActor(user: typeof userA) {
  window.sessionStorage.setItem('businessos_user', JSON.stringify(user))
  scopes.resetActorReadSession()
}
setActor(userA)
const ownerA = ownership.captureOfflineSaleOwner()
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const reads: ReturnType<typeof deferred>[] = []
const production = evaluate([
  extract(appSource, 'pendingSaleOwnerForUser'),
  extract(appSource, 'acceptsOfflineSaleNotice'),
  extract(appSource, 'useSyncErrorBanner'),
].join('\n'), ['useSyncErrorBanner', 'acceptsOfflineSaleNotice'], {
  useState, useEffect, useRef, ...scopes, ...ownership,
  getAppShellApi: () => ({ getPendingSyncState: () => { const request = deferred(); reads.push(request); return request.promise } }),
  scheduleInitialPendingSyncRefresh: (refresh: () => void) => { refresh(); return () => {} },
  scheduleDeferredPendingSyncPolling: () => () => {},
  persistentNoticeFingerprint: () => '', FRONTEND_BUILD_HASH: 'test',
  SYNC_ERROR_RESOLVED_EVENT: 'sync:error-resolved', shouldClearResolvedSyncError: () => false,
})
const container = doc.createElement('div')
const root = createRoot(container as Element)
const frames: Array<{ actor: number | null; total: number | null }> = []
function Probe({ user }: { user: typeof userA | null }) {
  const result = production.useSyncErrorBanner(user)
  const frame = { actor: user?.id ?? null, total: result.pendingSync?.total ?? null }
  frames.push(frame)
  return React.createElement('span', null, JSON.stringify(frame))
}
async function render(user: typeof userA | null) {
  await act(async () => root.render(React.createElement(Probe, { user })))
}
const visible = () => JSON.parse(container.textContent)
await render(userA)
await act(async () => reads[0].resolve({ owner: ownerA, total: 11, review_token: 'a' }))
assert.equal(visible().total, 11)
await act(async () => { events.dispatchEvent(new Event('sync:queue-changed')) })
const delayedA = reads.at(-1)!
setActor(userB)
const frameStart = frames.length
await render(userB)
assert.ok(frames.slice(frameStart).every(frame => frame.total === null), 'A count must disappear on the first B render, before cleanup effects')
await act(async () => delayedA.resolve({ owner: ownerA, total: 99 }))
assert.deepEqual(visible(), { actor: 2, total: null }, 'late A promise cannot repopulate B')
const ownerB = ownership.captureOfflineSaleOwner()
await act(async () => reads.at(-1)!.resolve({ owner: ownerB, total: 2 }))
assert.equal(visible().total, 2)
await act(async () => { events.dispatchEvent(new Event('sync:queue-changed')) })
const delayedB = reads.at(-1)!
await render(null)
await act(async () => delayedB.resolve({ owner: ownerB, total: 22 }))
assert.deepEqual(visible(), { actor: null, total: null })
await render(userB)
await act(async () => reads.at(-1)!.resolve({ owner: ownerA, total: 111 }))
assert.equal(visible().total, null, 'even current-scope reads cannot display an incorrect returned owner')
const scopeB = scopes.captureActorReadScope()
assert.equal(production.acceptsOfflineSaleNotice({ offline_owner: ownerA }, userB, scopeB), false)
assert.equal(production.acceptsOfflineSaleNotice({}, userB, scopeB), false)
assert.equal(production.acceptsOfflineSaleNotice({ offline_owner: ownerB }, userB, scopeB), true)
setSyncServerUrl('https://other.test')
await render(userB)
assert.equal(visible().total, null)
assert.equal(production.acceptsOfflineSaleNotice({ offline_owner: ownerB }, userB, scopeB), false, 'old authority notice denied')
await act(async () => root.unmount())
console.log('PASS mounted shell counts and receipt events are owner/scope fenced across delayed replies, logout and authority changes')

setSyncServerUrl('https://shop.test')
setActor(userA)
const money = await import('../src/utils/saleMoneyV1.ts')
const { assertPosCheckoutOwner } = evaluate(extract(posSource, 'assertPosCheckoutOwner'), ['assertPosCheckoutOwner'], ownership)
const input = { client_request_id: 'unchanged-request', money_precision_version: 1, items: [{ quantity: 1, applied_price_usd: 2 }], subtotal_usd: 2, total_usd: 2, amount_paid_usd: 2, amount_paid_khr: 0, exchange_rate: 4000, sale_status: 'completed' }
const frozen = money.frozenSaleCheckoutBody('unchanged-request', undefined, () => ownership.stampOfflineSaleOwner(input))
const original = JSON.stringify(frozen)
assertPosCheckoutOwner(frozen, userA)
assert.equal(Object.hasOwn(input, 'offline_owner'), false)
assert.deepEqual(frozen.offline_owner, ownerA)
assert.throws(() => assertPosCheckoutOwner(input, userA), /Keep this pending sale/)
setActor(userB)
assert.throws(() => assertPosCheckoutOwner(frozen, userB), /Keep this pending sale/)
setActor(userA)
setSyncServerUrl('https://other.test')
assert.throws(() => assertPosCheckoutOwner(frozen, userA), /Keep this pending sale/)
setSyncServerUrl('https://shop.test')
assertPosCheckoutOwner(frozen, userA)
assert.equal(JSON.stringify(money.frozenSaleCheckoutBody('unchanged-request', frozen)), original)

// Execute the actual existing-checkout callback. Unknown outcomes throw but
// must not call any close/reset/write path or change the saved wire request.
async function retry(payload: Record<string, unknown> | undefined) {
  let dispatched = 0
  let lookedUp = 0
  const notifications: string[] = []
  const retained = { checkoutRequestId: 'unchanged-request', checkoutPayload: payload }
  const { handleCheckout } = evaluate(extract(posSource, 'handleCheckout'), ['handleCheckout'], {
    ...scopes, ...money, assertPosCheckoutOwner, loading: false, user: userA,
    checkoutInFlightRef: { current: false }, resolvedActiveId: 'order-1', active: retained,
    checkoutRequestIdsRef: { current: new Map([['order-1', 'unchanged-request']]) },
    getSaleWriteTransport: async () => ({ recoverSaleCreateReceipt: async () => { lookedUp++; return { committed: false } } }),
    createPosSale: async (value: unknown) => { dispatched++; assert.equal(JSON.stringify(value), original); throw new Error('Unknown network outcome') },
    withLoaderTimeout: (fn: () => unknown) => fn(), POS_CHECKOUT_TIMEOUT_MS: 45000,
    setLoading: () => {}, notify: (message: string) => notifications.push(message), t: (key: string) => key,
    getErrorMessage: (error: Error) => error.message,
    closeOrder: () => assert.fail('failed checkout must remain open'),
    setOrders: () => assert.fail('failed checkout must not reset the saved request'),
  })
  await handleCheckout()
  assert.equal(retained.checkoutRequestId, 'unchanged-request')
  assert.equal(retained.checkoutPayload, payload)
  return { dispatched, lookedUp, notifications }
}
assert.deepEqual(await retry(input), { dispatched: 0, lookedUp: 0, notifications: [ownership.OFFLINE_OWNER_REVIEW_MESSAGE] }, 'ownerless old draft is never adopted, even through receipt recovery')
const retried = await retry(frozen)
assert.equal(retried.dispatched, 1)
assert.equal(retried.lookedUp, 1)
assert.deepEqual(retried.notifications, ['Unknown network outcome'])
assert.equal(JSON.stringify(frozen), original)
const checkoutSource = extract(posSource, 'handleCheckout')
const stampAt = checkoutSource.indexOf('() => stampOfflineSaleOwner(saleData)')
assert.ok(stampAt > 0 && stampAt < checkoutSource.indexOf('writePosDraft(posOrdersStorageKey, serialized)'))
assert.ok(checkoutSource.indexOf('writePosDraft(posOrdersStorageKey, serialized)') < checkoutSource.indexOf('() => createPosSale(frozen, checkoutScope),\n        \'Create POS sale\''))
const review = extract(posSource, 'reviewCheckoutPrices')
assert.ok(review.indexOf('assertPosCheckoutOwner(order.checkoutPayload, user)') < review.indexOf('await getSaleWriteTransport()'))
console.log('PASS real POS retry rejects ownerless/mismatched drafts; same-owner failure preserves original request ID, payload and cart')
