import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createPosTrackingOwner, needsPosTrackingSheet, posTrackingFingerprint, provesUntrackedLots, type PosTrackingState } from '../src/components/pos/posProductTracking.ts'

const user = { id: 7, permissions: { pos: true } }
const owner = createPosTrackingOwner()
const initial = posTrackingFingerprint(user, true, '2')
const scope = owner.scope(initial)
assert.equal(owner.scope(posTrackingFingerprint({ ...user }, true, '2')), scope)
assert.notEqual(owner.scope(posTrackingFingerprint(user, true, '3')), scope)
assert.notEqual(owner.scope(initial), scope, 'A-B-A never revives old work')
assert.notEqual(posTrackingFingerprint(user, false, '2'), initial)
assert.notEqual(posTrackingFingerprint({ ...user, permissions: { pos: false } }, true, '2'), initial)
for (const status of ['loading', 'failed'] as const) assert.ok(needsPosTrackingSheet({ scope, status, ids: new Set() }, scope, 3263))
assert.ok(needsPosTrackingSheet({ scope: 'old', status: 'ready', ids: new Set() }, scope, 3263))
assert.ok(needsPosTrackingSheet({ scope, status: 'ready', ids: new Set([3263]) }, scope, 3263))
assert.equal(needsPosTrackingSheet({ scope, status: 'ready', ids: new Set() }, scope, 3263), false)
for (const invalid of [null, {}, { batches: [] }, { batches: [], known_positive_quantity: '0' }, { batches: [], known_positive_quantity: 3 }, { batches: [{ quantity: 0 }], known_positive_quantity: 0 }]) assert.equal(provesUntrackedLots(invalid), false)
assert.ok(provesUntrackedLots({ batches: [], known_positive_quantity: 0 }))

const source = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const callback = source.slice(source.indexOf('  const openProductCard ='), source.indexOf('  /** Open shared image lightbox'))
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
// Execute the actual lookup effect: late branch/actor generations and effect
// cleanup cannot turn their empty response into the new scope's ready state.
{
  const start = source.indexOf('  useEffect(() => {\n    let cancelled = false\n    const scope = trackingScope')
  const end = source.indexOf('\n\n  useEffect(() => () => trackingOwner.current.cancel()', start)
  assert.ok(start >= 0 && end > start)
  const code = transformSync(source.slice(start, end), { loader: 'tsx', format: 'cjs' }).code
  for (const transition of ['scope', 'cleanup', 'success', 'error']) {
    const response = deferred(), states: PosTrackingState[] = []
    const current = { current: 'first' }; let cleanup: (() => void) | undefined
    const deps = {
      useEffect: (fn: () => (() => void) | undefined) => { cleanup = fn() },
      trackingScope: 'first', trackingScopeRef: current, authReady: true, user,
      primaryBranchFilterId: 2, batchTrackingReloadKey: 0,
      setBatchTracking: (state: PosTrackingState) => states.push(state),
      getTrackedBatchProductIds: () => response.promise, getErrorMessage: String,
      console: { error() {} },
    }
    new Function(...Object.keys(deps), code)(...Object.values(deps))
    assert.equal(states[0].status, 'loading')
    if (transition === 'scope') current.current = 'second'
    if (transition === 'cleanup') cleanup?.()
    if (transition === 'error') response.reject(new Error('offline'))
    else response.resolve({ productIds: [] })
    await flush()
    assert.equal(states.length, transition === 'scope' || transition === 'cleanup' ? 1 : 2)
    if (transition === 'success') assert.equal(states[1].status, 'ready')
    if (transition === 'error') assert.equal(states[1].status, 'failed')
  }
}
function fixture(status: PosTrackingState['status'] = 'ready') {
  const trackingOwner = { current: createPosTrackingOwner() }
  const trackingScope = trackingOwner.current.scope(initial)
  const reads: Array<{ product: number; branch: string; signal: AbortSignal; response: ReturnType<typeof deferred> }> = []
  const added: unknown[][] = [], sheets: unknown[] = []
  const dependencies = {
    trackingOwner, trackingScope, trackingScopeRef: { current: trackingScope }, batchTracking: { scope: trackingScope, status, ids: new Set() },
    authReady: true, user, primaryBranchFilterId: 2, defaultBranchId: 2,
    useCallback: (fn: unknown) => fn, asNumber: Number, promotionRules: [], exchangeRate: 4100,
    promotionBadgeForProduct: (p: { promotion?: boolean }) => ({ active: p.promotion }),
    needsPosTrackingSheet, setDetailProduct: (p: unknown) => sheets.push(p),
    resolveSaleBranch: () => ({ branchId: 2, blocked: false }),
    addToCart: (...args: unknown[]) => added.push(args),
    readFreshPickerLots: (product: number, branch: string, signal: AbortSignal) => {
      const response = deferred(); reads.push({ product, branch, signal, response }); return response.promise
    },
  }
  const code = transformSync(callback, { loader: 'tsx', format: 'cjs' }).code
  const open = new Function(...Object.keys(dependencies), `${code}; return openProductCard`)(...Object.values(dependencies))
  return { open, reads, added, sheets, trackingOwner }
}
const product = { id: 3263, wholesale_price_usd: 0, wholesale_price_khr: 0 }
for (const status of ['loading', 'failed'] as const) {
  const f = fixture(status); f.open(product, { inStock: true })
  assert.equal(f.added.length, 0); assert.deepEqual(f.sheets, [product]); assert.equal(f.reads.length, 0)
}
{
  const f = fixture(); f.open(product, { inStock: true })
  assert.equal(f.added.length, 0, 'cached empty index cannot immediately fast-add')
  assert.equal(f.reads[0].product, 3263); assert.equal(f.reads[0].branch, '2')
  f.reads[0].response.resolve({ batches: [{ id: 56957, quantity: 3 }], known_positive_quantity: 3 }); await flush()
  assert.deepEqual(f.sheets, [product]); assert.equal(f.added.length, 0)
}
{
  const f = fixture(); f.open(product, { inStock: true })
  f.reads[0].response.resolve({ batches: [], known_positive_quantity: 0 }); await flush()
  assert.deepEqual(f.added[0], [product, 'selling', undefined, 2]); assert.equal(f.sheets.length, 0)
}
for (const next of [posTrackingFingerprint(user, true, '3'), posTrackingFingerprint({ id: 8, permissions: { all: true } }, true, '2'), posTrackingFingerprint(user, false, '2')]) {
  const f = fixture(); f.open(product, { inStock: true }); f.trackingOwner.current.scope(next)
  assert.ok(f.reads[0].signal.aborted)
  f.reads[0].response.resolve({ batches: [], known_positive_quantity: 0 }); await flush()
  assert.equal(f.added.length, 0); assert.equal(f.sheets.length, 0)
}
{
  const f = fixture(); f.open(product, { inStock: true }); f.reads[0].response.reject(new Error('403')); await flush()
  assert.equal(f.added.length, 0); assert.deepEqual(f.sheets, [product])
}
for (const options of [{ groupProduct: true, inStock: true }, { inStock: false }]) {
  const f = fixture(); f.open(product, options); assert.deepEqual(f.sheets, [product]); assert.equal(f.reads.length, 0)
}
for (const alternate of [{ ...product, wholesale_price_usd: 5 }, { ...product, promotion: true }]) {
  const f = fixture(); f.open(alternate, { inStock: true }); assert.deepEqual(f.sheets, [alternate]); assert.equal(f.reads.length, 0)
}
{
  const f = fixture(); f.open(product, { inStock: true }); f.open({ ...product, id: 8 }, { groupProduct: true })
  f.reads[0].response.resolve({ batches: [], known_positive_quantity: 0 }); await flush()
  assert.equal(f.added.length, 0); assert.equal(f.sheets.length, 1)
}
console.log('PASS POS actual card callback: tracking readiness, fresh empty proof, target dated lot, actor/branch/session races, errors and alternate-price/group/out-of-stock parity')
