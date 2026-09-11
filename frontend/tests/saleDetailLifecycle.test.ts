import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { configuredSettlementMethods } from '../src/components/sales/saleSettlement.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'

const source = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const helper = fs.readFileSync(new URL('../src/components/sales/saleSettlementConfig.ts', import.meta.url), 'utf8')
const module = { exports: {} as any }
const requests: any[] = []
new Function('require', 'module', 'exports', transformSync(helper, { loader: 'ts', format: 'cjs' }).code)(
  (name: string) => name.includes('permissions') ? { effectivePermissions } : name.includes('saleSettlement') ? { configuredSettlementMethods } : { apiFetch: (...args: any[]) => { requests.push(args); return Promise.resolve({ pos_payment_methods: '["Cash","ABA"]', exchange_rate: '4100' }) } }, module, module.exports,
)
const { parseSettlementConfig, readSettlementConfig, startSettlementConfigRead, saleSecurityFingerprint, advanceSaleSecurityScope } = module.exports
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const deferred = () => { let resolve!: (value: any) => void; let reject!: (value: any) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// Execute the actual production effect and its dependency array on each render.
// Callback identity changes are deliberately supplied by this hook harness.
function effect(marker: string, env: any) {
  const at = source.indexOf(marker)
  assert.ok(at >= 0, marker)
  const start = source.lastIndexOf('useEffect(() => {', at)
  const end = source.indexOf('])', source.indexOf('\n  }, [', at)) + 2
  const code = transformSync(source.slice(start, end), { loader: 'tsx' }).code
  const run = new Function('env', `with (env) { ${code} }`)
  let previous: unknown[] | undefined
  let cleanup: (() => void) | undefined
  env.useEffect = (callback: () => (() => void) | undefined, deps: unknown[]) => {
    if (previous && deps.every((value, index) => Object.is(value, previous![index]))) return
    cleanup?.(); previous = deps; cleanup = callback()
  }
  return { render: () => run(env), unmount: () => cleanup?.() }
}

for (const bad of [undefined, {}, { pos_payment_methods: 'broken' }, { pos_payment_methods: [3] }]) assert.throws(() => parseSettlementConfig(bad))
assert.deepEqual(parseSettlementConfig({ pos_payment_methods: '[]' }).configuredMethods, [], 'only an explicit valid registry verifies empty')
const signal = new AbortController().signal
assert.deepEqual((await readSettlementConfig(signal)).configuredMethods, ['Cash', 'ABA'])
assert.equal(requests[0][0], 'GET'); assert.match(requests[0][1], /^\/api\/settings\?_settlement=/)
assert.equal(requests[0][3], 8000); assert.equal(requests[0][4].signal, signal)

let request = deferred()
let aborted = false
const configEnv: any = {
  detailScope: 'actor1:sale1', authReady: true, rawMethodsVersion: '', rawRateVersion: '', paymentConfigReload: 0,
  paymentConfig: { scope: 'actor1:sale1', status: 'loading' },
  setPaymentConfig(value: any) { this.paymentConfig = typeof value === 'function' ? value(this.paymentConfig) : value },
  readSettlementConfig: (signal: AbortSignal) => { signal.addEventListener('abort', () => { aborted = true }); return request.promise },
  startSettlementConfigRead,
}
configEnv.setPaymentConfig = configEnv.setPaymentConfig.bind(configEnv)
const configEffect = effect('setPaymentConfig((current) => ({ ...current, scope: detailScope, status:', configEnv)
configEffect.render()
assert.equal(configEnv.paymentConfig.status, 'loading', 'unready is not verified empty')
const oldRequest = request
request = deferred(); configEnv.detailScope = 'actor2:sale1'; configEffect.render()
assert.equal(aborted, true)
oldRequest.resolve(parseSettlementConfig({ pos_payment_methods: '["STALE"]' })); await flush()
assert.equal(configEnv.paymentConfig.status, 'loading', 'late previous actor response ignored')
request.reject(new Error('offline')); await flush()
assert.equal(configEnv.paymentConfig.status, 'failed', 'failed lookup has explicit retry state')
request = deferred(); configEnv.paymentConfigReload++; configEffect.render()
request.resolve(parseSettlementConfig({ pos_payment_methods: '["Cash","ABA"]' })); await flush()
assert.equal(configEnv.paymentConfig.status, 'ready')

const rows = [{ method: 'ABA', usd: '7', khr: '0' }]
const hydration: any = {
  paymentConfig: configEnv.paymentConfig, paymentConfigLoaded: true, statusSaving: false, pendingStatus: false,
  session: { configuredMethods: [], exchangeRate: 4100, rows, expectedUpdatedAt: 'reviewed-version' },
  setSettlementSession(update: any) { this.session = update(this.session) },
}
hydration.setSettlementSession = hydration.setSettlementSession.bind(hydration)
const hydrateEffect = effect('if (!paymentConfigLoaded', hydration)
hydrateEffect.render()
assert.deepEqual(hydration.session.configuredMethods, ['Cash', 'ABA'], 'late metadata hydrates the same sale')
assert.equal(hydration.session.rows, rows, 'typed tender is never recreated')
assert.equal(hydration.session.expectedUpdatedAt, 'reviewed-version')
hydration.pendingStatus = true
hydration.paymentConfig = { ...hydration.paymentConfig, value: { configuredMethods: ['Cash'], exchangeRate: 4200 } }
hydrateEffect.render()
assert.deepEqual(hydration.session.configuredMethods, ['Cash', 'ABA'], 'uncertain review stays exact')
hydration.pendingStatus = false; hydrateEffect.render()
assert.deepEqual(hydration.session.configuredMethods, ['Cash'])
assert.equal(hydration.session.rows, rows)

const statusEnv: any = { detailScope: 'actor1:sale1', sale: { sale_status: 'awaiting_payment' }, statusSaving: false, pendingStatus: false, lastServerStatusRef: { current: 'actor1:sale1:awaiting_payment' }, selected: 'completed', setNewStatus(value: string) { this.selected = value } }
statusEnv.setNewStatus = statusEnv.setNewStatus.bind(statusEnv)
const statusEffect = effect('const serverStatus =', statusEnv)
statusEffect.render(); statusEnv.statusSaving = true; statusEffect.render(); statusEnv.statusSaving = false; statusEffect.render()
assert.equal(statusEnv.selected, 'completed', 'failure/unrelated render retains selected review status')
statusEnv.sale = { sale_status: 'cancelled' }; statusEffect.render()
assert.equal(statusEnv.selected, 'cancelled', 'actual authoritative status changes are not frozen')

let reads = 0
let historyRequest = deferred()
const history: any = { hasAmendmentsLoader: true, saleId: 1, detailScope: 'actor1:sale1', amendReloadToken: 0, amendments: null,
  amendmentsLoaderRef: { current: () => { reads++; return historyRequest.promise } },
  setAmendmentsLoading(value: boolean) { this.loading = value }, setAmendmentsFailed(value: boolean) { this.failed = value }, setAmendments(value: any) { this.amendments = value },
}
for (const name of ['setAmendmentsLoading', 'setAmendmentsFailed', 'setAmendments']) history[name] = history[name].bind(history)
const historyEffect = effect('if (!hasAmendmentsLoader', history)
historyEffect.render()
historyRequest.resolve([{ id: 1 }]); await flush()
for (let i = 0; i < 8; i++) { history.amendmentsLoaderRef.current = () => { reads++; return Promise.resolve([]) }; historyEffect.render() }
assert.equal(reads, 1, 'new parent callbacks do not reload and flash lower content')
assert.equal(history.loading, false); assert.deepEqual(history.amendments, [{ id: 1 }])
historyRequest = deferred(); history.amendmentsLoaderRef.current = () => { reads++; return historyRequest.promise }
history.amendReloadToken++; historyEffect.render()
assert.equal(reads, 2); assert.equal(history.loading, false, 'explicit background refresh keeps existing content mounted')
historyEffect.unmount(); historyRequest.resolve([{ id: 'wrong actor' }]); await flush()
assert.deepEqual(history.amendments, [{ id: 1 }])
configEffect.unmount()

let statusWrites = 0
let closed = 0
const statusRequest = deferred()
const submitEnv: any = {
  newStatus: 'completed', currentStatus: 'awaiting_payment', authReady: true, settlementFrozenRef: { current: false },
  needsPaymentEntry: true, paymentConfigReady: false, detailScope: 'actor1:sale1',
  detailScopeRef: { current: 'actor1:sale1' }, detailAliveRef: { current: true },
  sale: { id: 1 }, statusNotes: '', onStatusChange: () => { statusWrites++; return statusRequest.promise },
  setStatusSaving: () => {}, onClose: () => { closed++ },
}
const submitStart = source.indexOf('const handleStatusUpdate =')
const submitEnd = source.indexOf('const handleMembershipAttach =', submitStart)
const submitCode = transformSync(source.slice(submitStart, submitEnd), { loader: 'tsx' }).code
const submit = new Function('env', `with (env) { ${submitCode}; return handleStatusUpdate }`)(submitEnv)
await submit()
assert.equal(statusWrites, 0, 'unverified methods cannot send a settlement')
submitEnv.needsPaymentEntry = false
const firstWrite = submit(); await submit()
assert.equal(statusWrites, 1, 'same-tick duplicate submit is locked before React rerenders')
submitEnv.detailScopeRef.current = 'actor2:sale1'
statusRequest.resolve({ updated_at: 'committed' }); await firstWrite
assert.equal(closed, 0, 'late old-actor completion cannot close current detail')

let trackedReads = 0
const trackedEnv: any = {
  canLoadAddItems: true, detailScope: 'actor1:sale1', sale: { branch_id: 2 }, trackedBatchReloadKey: 0,
  getTrackedBatchProductIds: () => { trackedReads++; return Promise.resolve({ productIds: [3263] }) },
  setTrackedBatchLookupState: () => {}, setTrackedBatchLookupError: () => {}, setTrackedBatchProductIds: () => {},
}
const trackedEffect = effect('if (!canLoadAddItems) return undefined', trackedEnv)
trackedEffect.render(); await flush()
for (let i = 0; i < 5; i++) trackedEffect.render()
assert.equal(trackedReads, 1, 'unchanged capability does not refetch tracked IDs on parent callbacks')
trackedEnv.sale = { branch_id: 3 }; trackedEffect.render(); await flush()
assert.equal(trackedReads, 2, 'branch change still revalidates tracking')
trackedEffect.unmount()

const actor = { id: 7, name: 'Before', organization_id: 1, permissions: { sales: true, 'sales:status': true, products: true } }
const fingerprint = saleSecurityFingerprint(actor, true)
assert.equal(saleSecurityFingerprint({ ...actor, name: 'After', permissions: '{"products":true,"sales:status":true,"sales":true}' }, true), fingerprint, 'profile and normalized permission ordering are stable')
const revoked = saleSecurityFingerprint({ ...actor, permissions: { ...actor.permissions, 'sales:status': false } }, true)
assert.notEqual(revoked, fingerprint)
assert.notEqual(saleSecurityFingerprint({ ...actor, role_code: 'admin' }, true), fingerprint)
assert.notEqual(saleSecurityFingerprint({ ...actor, organization_id: 2 }, true), fingerprint)
const securityState = { fingerprint, generation: 0 }
const originalScope = advanceSaleSecurityScope(securityState, fingerprint)
assert.equal(advanceSaleSecurityScope(securityState, saleSecurityFingerprint({ ...actor, name: 'After' }, true)), originalScope)
assert.notEqual(advanceSaleSecurityScope(securityState, revoked), originalScope)
assert.notEqual(advanceSaleSecurityScope(securityState, fingerprint), originalScope, 'restored permission does not resurrect earlier generation')
const beforeReauth = advanceSaleSecurityScope(securityState, fingerprint)
advanceSaleSecurityScope(securityState, saleSecurityFingerprint(actor, false))
assert.notEqual(advanceSaleSecurityScope(securityState, fingerprint), beforeReauth, 'same-ID reauthentication is a new generation')

// Re-run production read and submit with a same-ID permission change, not an actor swap.
const staleConfigRequest = deferred()
const sameActorEnv: any = { ...configEnv, detailScope: `${originalScope}:sale1`, paymentConfig: { status: 'loading' }, readSettlementConfig: () => staleConfigRequest.promise }
sameActorEnv.setPaymentConfig = (value: any) => { sameActorEnv.paymentConfig = typeof value === 'function' ? value(sameActorEnv.paymentConfig) : value }
const sameActorEffect = effect('setPaymentConfig((current) => ({ ...current, scope: detailScope, status:', sameActorEnv)
sameActorEffect.render()
sameActorEnv.detailScope = `${advanceSaleSecurityScope(securityState, revoked)}:sale1`
const freshConfigRequest = deferred(); sameActorEnv.readSettlementConfig = () => freshConfigRequest.promise
sameActorEffect.render()
staleConfigRequest.resolve(parseSettlementConfig({ pos_payment_methods: '["STALE"]' })); await flush()
assert.equal(sameActorEnv.paymentConfig.status, 'loading', 'old same-ID permission scope cannot hydrate registry')
freshConfigRequest.resolve(parseSettlementConfig({ pos_payment_methods: '["Cash"]' })); await flush()
assert.deepEqual(sameActorEnv.paymentConfig.value.configuredMethods, ['Cash'])
sameActorEffect.unmount()
const sameActorRequest = deferred()
const sameActorSubmitEnv = { ...submitEnv, detailScope: originalScope, detailScopeRef: { current: originalScope }, settlementFrozenRef: { current: false }, onStatusChange: () => sameActorRequest.promise, setPayError: () => { throw new Error('old security response must not update error') } }
const sameActorSubmit = new Function('env', `with (env) { ${submitCode}; return handleStatusUpdate }`)(sameActorSubmitEnv)
const sameActorWrite = sameActorSubmit()
sameActorSubmitEnv.detailScopeRef.current = advanceSaleSecurityScope(securityState, revoked)
sameActorRequest.resolve({ settlementError: 'old-session error' }); await sameActorWrite
assert.equal(closed, 0)

// Execute Sales' own read callback: caller-side fences are too late if this
// callback has already published the old response during its awaited refresh.
const salesSource = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function salesReadCallback(name: string, env: Record<string, unknown>) {
  const start = salesSource.indexOf(`const ${name} = useCallback`)
  const end = salesSource.indexOf('\n\n  useEffect', start)
  const code = transformSync(salesSource.slice(start, end), { loader: 'tsx' }).code
  return new Function(...Object.keys(env), `${code}; return ${name}`)(...Object.values(env))
}
let listRequest = deferred()
const listSignals: AbortSignal[] = []
const published: unknown[] = []
const errors: unknown[] = []
const loadingStates: boolean[] = []
let watchdogClears = 0
const readEnv: any = {
  useCallback: (callback: unknown) => callback, authReady: true, canViewSales: true, statusSecurityScope: 'scope1',
  statusSecurityRef: { current: 'scope1' }, loadSecurityRef: { current: 'scope1' }, aliveRef: { current: true },
  loadPromiseRef: { current: null }, pendingLoadRef: { current: null }, loadAbortRef: { current: null },
  loadRequestRef: { current: 0 }, loadedOnceRef: { current: false }, loadWatchdogRef: { current: undefined }, latestLoadRef: { current: null },
  beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent,
  clearLoadWatchdog: () => { watchdogClears++ }, setLoading: (value: boolean) => loadingStates.push(value), setLoadError: (value: unknown) => errors.push(value),
  window: { setTimeout: () => 1 }, isAdmin: false, userFilter: 'all', statusFilter: 'all', debouncedSearch: '',
  salesDateRange: {}, salesPage: 1, salesPageSize: 25, salesSortSpec: { field: 'date', direction: 'desc' },
  fetchSales: (_params: unknown, options: { signal: AbortSignal }) => { listSignals.push(options.signal); return listRequest.promise },
  withLoaderTimeout: (read: () => Promise<unknown>) => read(), SALES_LIST_REQUEST_TIMEOUT_MS: 8000,
  normalizeSaleRows: (rows: unknown) => rows, setSales: (rows: unknown) => published.push(rows),
  getErrorMessage: (error: unknown) => String(error), translateOr: (_key: string, fallback: string) => fallback,
  resolvePendingSalesLoad: (pending: unknown, success: boolean) => success ? pending : null,
}
const oldLoad = salesReadCallback('loadSales', readEnv)
const oldRead = oldLoad(false)
const oldListRequest = listRequest
readEnv.statusSecurityRef.current = 'scope2'
listRequest = deferred()
const freshLoad = salesReadCallback('loadSales', { ...readEnv, statusSecurityScope: 'scope2' })
readEnv.latestLoadRef.current = freshLoad
const freshRead = freshLoad(false)
assert.equal(listSignals.length, 2, 'new authority starts immediately instead of coalescing behind prior read')
assert.equal(listSignals[0].aborted, true)
const freshPromise = readEnv.loadPromiseRef.current
const freshQueue = { silent: true }; readEnv.pendingLoadRef.current = freshQueue
const clearsBeforeOld = watchdogClears
oldListRequest.resolve([{ id: 'old-private-sale' }]); await oldRead
assert.deepEqual(published, [], 'old result cannot publish before mutation caller resumes')
assert.equal(readEnv.loadPromiseRef.current, freshPromise)
assert.equal(readEnv.pendingLoadRef.current, freshQueue, 'old finally cannot consume new authority queue')
assert.equal(watchdogClears, clearsBeforeOld, 'old finally cannot clear new authority watchdog')
assert.equal(loadingStates.at(-1), true)
readEnv.pendingLoadRef.current = null
listRequest.resolve([{ id: 'current-sale' }]); await freshRead
assert.deepEqual(published, [[{ id: 'current-sale' }]])
assert.equal(loadingStates.at(-1), false)
await oldLoad(false)
assert.equal(listSignals.length, 2, 'retained old closure cannot send a new read')

let statsRequest = deferred()
const stats: unknown[] = []
const statsEnv = { ...readEnv, isActive: true, salesStatsRequestRef: { current: 0 }, fetchSalesStats: () => statsRequest.promise, setSalesStats: (value: unknown) => stats.push(value) }
const oldStats = salesReadCallback('loadSalesStats', { ...statsEnv, statusSecurityScope: 'scope2' })()
readEnv.statusSecurityRef.current = 'scope3'
statsRequest.resolve({ total_count: 100 }); await oldStats
assert.deepEqual(stats, [], 'old same-user aggregate cannot publish after permission change')
statsRequest = deferred()
const freshStats = salesReadCallback('loadSalesStats', { ...statsEnv, statusSecurityScope: 'scope3' })()
statsRequest.resolve({ total_count: 2 }); await freshStats
assert.equal((stats[0] as any).total_count, 2)
listRequest = deferred()
const rejectedRead = salesReadCallback('loadSales', { ...readEnv, statusSecurityScope: 'scope3' })(false)
readEnv.statusSecurityRef.current = 'scope4'
const errorCount = errors.length
listRequest.reject(new Error('old-authority failure')); await rejectedRead
assert.equal(errors.length, errorCount, 'late old-scope failure cannot replace current error state')
const readCount = listSignals.length
await salesReadCallback('loadSales', { ...readEnv, authReady: false, statusSecurityScope: 'scope4' })(false)
assert.equal(listSignals.length, readCount, 'reauthentication cannot start a read')
console.log('saleDetailLifecycle: actual configuration/status/history effects PASS')
