import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { beginSingleAction, finishSingleAction } from '../src/utils/actionGuards.ts'
import { subtractDecimalSum } from '../src/utils/moneyPrecision.ts'

// Execute shipping callback ASTs, not reimplementations/source regex claims.
function callback(file: string, name: string, bindings: Record<string, unknown>): (...args: any[]) => Promise<void> {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer!.getText(ast)
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.ok(expression, name)
  const js = ts.transpileModule(`const handler = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), js + ';return handler')(...Object.values(bindings))
}
function deferred() { let resolve!: (value?: any) => void; let reject!: (error: Error) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(options: { restored?: boolean; storageFailure?: boolean; timeout?: boolean } = {}) {
  let authority = 1
  const events: string[] = [], network = deferred(), success = deferred()
  const pending = { bodyJson: '{"client_request_id":"original"}' }
  const transport = {
    loadPendingReturnCreateV1: () => options.restored ? pending : null,
    authorizeReturnCreateRecovery: (_actor: unknown, actual: unknown, reviewed: boolean) => { assert.equal(actual, pending); if (!reviewed) throw Error('review required'); events.push('authorize'); return { original: pending } },
    prepareReturnCreateV1: () => { events.push('prepare'); if (options.storageFailure) throw Error('storage failure'); return pending },
    submitReturnCreateV1: (_actor: unknown, actual: unknown) => { assert.equal(actual, pending); events.push('POST'); return network.promise },
    clearPendingReturnCreateV1: () => { events.push('clear') },
  }
  const lifecycle = { current: { alive: true, generation: 0, scope: { authority: 1 } } }
  const bindings: Record<string, any> = {
    sessionStale: false, lifecycle, beginSingleAction, finishSingleAction, submitInFlightRef: { current: false },
    captureActorReadScope: () => ({ authority }), isActorReadScopeCurrent: (scope: { authority: number }) => scope.authority === authority,
    setSubmitting: (value: boolean) => events.push('busy:' + value), loadReturnsTransport: async () => transport,
    pendingV1: null, pendingLoaded: true, reviewedPendingBody: options.restored ? pending.bodyJson : null, setReviewedPendingBody: () => {}, user: { id: 7 }, isV1Sale: true, quote: { sale_id: 11 }, reviewedIntentRef: { current: 'exact' }, quoteIntent: 'exact', pendingError: '',
    replacements: [], activeItems: [{ id: 3, returnQty: 1, stock_action: 'none', branch_id: 2 }], finalReason: 'reason', itemsMissingLot: [],
    notes: '', returnType: 'refund', foundSale: { id: 11, branch_id: 2 }, setPendingV1: (value: unknown) => events.push(value ? 'pending' : 'unpending'),
    withLoaderTimeout: async (fn: () => Promise<unknown>) => { const promise = fn(); if (options.timeout) { void promise.catch(() => {}); throw Error('timeout') } return promise }, RETURN_CREATE_TIMEOUT_MS: 1,
    notify: () => events.push('notify'), T: (_key: string, fallback: string) => fallback, getLoaderErrorMessage: (e: Error) => e.message,
    window: { dispatchEvent: () => events.push('invalidate') }, CustomEvent: class {},
    onSuccess: () => { events.push('success'); return success.promise }, onClose: () => events.push('close'),
    setPendingQuoteRejected: (value: boolean) => events.push('rejected:' + value),
  }
  return { events, network, success, lifecycle, bindings, handler: () => callback('../src/components/returns/NewReturnModal.tsx', 'submitNetReturn', bindings), switchActor: () => { authority++ } }
}
{
  const h = setup(), run = h.handler()
  const first = run(), second = run()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.events.filter(x => x === 'POST').length, 1)
  h.network.resolve({ id: 1 }); h.success.resolve(); await Promise.all([first, second])
  assert.ok(h.events.indexOf('pending') < h.events.indexOf('POST'), 'durable prepare precedes POST')
  assert.ok(h.events.indexOf('clear') < h.events.indexOf('success'))
  assert.equal(h.events.filter(x => x === 'close').length, 1)
}
for (const outcome of ['success', 'error', 'unmount']) {
  const h = setup(), pending = h.handler()()
  await new Promise(resolve => setTimeout(resolve, 0))
  const before = h.events.length
  if (outcome === 'unmount') { h.lifecycle.current.alive = false; h.lifecycle.current.generation++ } else h.switchActor()
  if (outcome === 'error') h.network.reject(Error('late error')); else h.network.resolve({ id: 1 })
  await pending
  assert.deepEqual(h.events.slice(before), [], 'late old-actor/unmounted success,error,finally never publish')
}
{
  const h = setup({ restored: true }); h.bindings.activeItems = []; h.bindings.quote = null; h.bindings.finalReason = ''
  const pending = h.handler()(); await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(h.events.includes('POST')); assert.ok(!h.events.includes('prepare'), 'reopen retries original without reconstructing from form')
  h.network.resolve({ id: 1 }); h.success.resolve(); await pending
}
{
  const h = setup({ storageFailure: true }); await h.handler()()
  assert.ok(!h.events.includes('POST')); assert.ok(!h.events.includes('clear'))
}
{
  const h = setup({ timeout: true }); await h.handler()()
  assert.ok(h.events.includes('pending')); assert.ok(!h.events.includes('clear')); assert.ok(!h.events.includes('success'))
  h.network.resolve({ id: 1 })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(!h.events.includes('clear'), 'late acknowledgement after UI timeout does not discard frozen retry')
}
{
  const h = setup(); const pending = h.handler()()
  await new Promise(resolve => setTimeout(resolve, 0)); h.network.resolve({ id: 1 })
  await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(h.events.includes('success'))
  h.switchActor(); h.success.resolve(); await pending
  assert.ok(!h.events.includes('close'), 'actor switch during onSuccess await cannot close new actor UI')
}
{
  const h = setup(), response = deferred()
  h.bindings.quoteBusy = false; h.bindings.unsupportedMoneyVersion = false
  h.bindings.replacementsMissingLot = []; h.bindings.quoteIntentRef = { current: 'exact' }
  h.bindings.setQuoteBusy = (value: boolean) => h.events.push('quoteBusy:' + value)
  h.bindings.setQuote = () => h.events.push('quote'); h.bindings.setStep = () => h.events.push('step')
  h.bindings.RETURN_HISTORY_LOOKUP_TIMEOUT_MS = 1
  h.bindings.loadReturnsTransport = async () => ({ getReturnQuoteV1: () => response.promise })
  const review = callback('../src/components/returns/NewReturnModal.tsx', 'reviewReturn', h.bindings)()
  await new Promise(resolve => setTimeout(resolve, 0)); h.bindings.quoteIntentRef.current = 'edited'
  response.resolve({ sale_id: 11 }); await review
  assert.ok(!h.events.includes('quote')); assert.ok(!h.events.includes('step')); assert.ok(h.events.includes('quoteBusy:false'))
}
{
  const guard = callback('../src/components/returns/EditReturnModal.tsx', 'handleSubmit', { ret: { money_precision_version: 1 } })
  await guard() // Any fallthrough references missing bindings and fails the test.
}
for (const bindings of [{ pendingLoaded: false, pendingError: '' }, { pendingLoaded: true, pendingError: 'unreadable' }]) {
  await callback('../src/components/returns/NewReturnModal.tsx', 'handleSubmit', bindings)()
  await callback('../src/components/returns/NewReturnModal.tsx', 'reviewReturn', bindings)()
  // Applies before choosing legacy/v1: unreadable existing work never admits a new write.
}
const exactQuantity = callback('../src/components/returns/NewReturnModal.tsx', 'exactReturnQuantity', { subtractDecimalSum })
assert.equal(await exactQuantity(.3, [.1]), .2, 'Select All preserves the exact remaining fractional quantity')
assert.throws(() => exactQuantity(.3, [-1e-20]), /return_v1_review_required/, 'unrepresentable quantity is not silently lost')
{
  const h = setup({ restored: true }); h.bindings.reviewedPendingBody = null
  await h.handler()()
  assert.ok(!h.events.includes('POST'), 'saved original must be explicitly reviewed before recovery')
}
{
  const h = setup({ restored: true, timeout: true }); await h.handler()()
  assert.ok(h.events.includes('authorize')); assert.ok(h.events.includes('POST')); assert.ok(!h.events.includes('clear'))
  h.switchActor(); h.network.resolve({ id: 1 }); await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(!h.events.includes('success')); assert.ok(!h.events.includes('clear'))
}
console.log('PASS actual return modal callbacks: one-flight, freeze-before-send, timeout/reopen, stale quote, actor changes at awaits, no late publications, v1 edit refuses legacy submit')
