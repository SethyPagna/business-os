import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
function extract(text: string, name: string, dependencies: Record<string, any>): any {
  const tree = ts.createSourceFile('source.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.FunctionDeclaration | ts.VariableDeclaration | undefined
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(found, name)
  const declaration = (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(tree)
  const compiled = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled}; return ${name}`)(...Object.values(dependencies), {})
}
const http = source('api/http.ts'), transport = source('api/inventoryWriteTransport.ts')
const actor = source('api/actorReadScope.ts'), modal = source('components/inventory/FastStockInModal.tsx')
function authority() {
  let generation = 1
  const captureActorReadScope = () => ({ authority: String(generation), channel: 'inventory', revision: '0' })
  const isActorReadScopeCurrent = (scope: { authority: string }) => scope.authority === String(generation)
  const assertActorReadScope = extract(actor, 'assertActorReadScope', { isActorReadScopeCurrent })
  const assertActorSessionDispatchAllowed = extract(actor, 'assertActorSessionDispatchAllowed', {
    isActorReadScopeCurrent, isActorSessionQuarantined: () => false, isActorCookieMutationPending: () => false,
  })
  return { captureActorReadScope, isActorReadScopeCurrent, assertActorReadScope, assertActorSessionDispatchAllowed, change: () => { generation++ } }
}
function fixture(mode: 'normal' | 'late-success' | 'late-404' | 'fresh-404' | 'settlement-switch' | 'before-dispatch') {
  const scope = authority(), calls: string[][] = [], settled: number[][] = [], invalidations: string[] = [], events: unknown[] = []
  const route = extract(http, 'route', {
    ...scope, getSyncServerUrl: () => { if (mode === 'before-dispatch') scope.change(); return 'https://fixture.invalid' },
    getReadServerBaseUrl: () => 'https://fixture.invalid', hasStoredAuthSession: () => true, getSameOriginApiBaseUrl: () => '',
    throwIfRequestAborted() {}, _serverOnline: true, cacheInvalidateWithDerived: (key: string) => invalidations.push(key),
    setServerHealth() {}, logCall() {}, isConnectivityError: () => false, isWriteConflictError: () => false,
    isInvalidSessionError: () => false, createSyncErrorId: () => 'event', window: { dispatchEvent: (event: unknown) => events.push(event) },
  })
  const isDeferredStockInResult = extract(transport, 'isDeferredStockInResult', {})
  const commitStockInLinesInRounds = extract(transport, 'commitStockInLinesInRounds', { isDeferredStockInResult })
  const commit = extract(transport, 'commitFastStockIn', {
    ...scope, route, receiveBatchWireBody: (body: unknown) => body, getDevicePayload: () => ({}), commitStockInLinesInRounds,
    fastStockInCommitPayload: extract(transport, 'fastStockInCommitPayload', {}),
    apiFetch: async (_method: string, _url: string, body: any) => {
      calls.push(body.lines.map((line: any) => line.key))
      if (mode === 'late-success' || mode === 'late-404') scope.change()
      if (mode === 'late-404' || mode === 'fresh-404') throw Object.assign(new Error('No route'), { status: 404 })
      return { results: body.lines.map((line: any, index: number) => index === 0 ? { key: line.key, ok: true } : { key: line.key, ok: false, code: 'deferred' }) }
    },
  })
  const lines = ['existing', 'new'].map(key => ({ key, wire: 'receive', body: { productId: key === 'existing' ? 1 : 2 } }))
  const run = (writeScope?: unknown) => commit(lines, (rows: any[]) => {
    settled.push(rows.map(row => row.index))
    if (mode === 'settlement-switch') scope.change()
  }, writeScope ? { writeScope } : undefined)
  return { scope, calls, settled, invalidations, events, run }
}

let failed = 0
async function check(name: string, action: () => Promise<void> | void) {
  try { await action(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}
await check('original owner completes deferred rounds once and retains result order', async () => {
  const f = fixture('normal'), results = await f.run()
  assert.deepEqual(f.calls, [['existing', 'new'], ['new']]); assert(results.every((row: any) => row.ok))
  assert.deepEqual(f.settled, [[0], [1]])
})
for (const mode of ['late-success', 'late-404', 'before-dispatch'] as const) {
  await check(`${mode}: stale operation cannot publish or select sequential fallback`, async () => {
    const f = fixture(mode)
    await assert.rejects(f.run(), (error: any) => ['stale_read_scope', 'actor_session_quarantined'].includes(error.code))
    assert.equal(f.calls.length, mode === 'before-dispatch' ? 0 : 1)
    assert.deepEqual(f.settled, []); assert.deepEqual(f.invalidations, []); assert.deepEqual(f.events, [])
  })
}
await check('original current 404 retains legacy fallback', async () => {
  const f = fixture('fresh-404'); assert.equal(await f.run(), null); assert.equal(f.calls.length, 1)
})
await check('scope changed by settlement cannot send another deferred round', async () => {
  const f = fixture('settlement-switch'), results = await f.run()
  assert.deepEqual(f.calls, [['existing', 'new']]); assert.equal(results[0].ok, true); assert.equal(results[1].ok, false)
})
await check('caller scope from before product preparation is not recaptured at stock entry', async () => {
  const f = fixture('normal'), owner = f.scope.captureActorReadScope(); f.scope.change()
  await assert.rejects(f.run(owner)); assert.deepEqual(f.calls, [])
})

function modalFixture(boundary: string) {
  const scope = authority(), receivingScope = scope.captureActorReadScope()
  const effects: Array<{ name: string; current: boolean }> = [], requests: number[] = []
  const effect = (name: string) => effects.push({ name, current: scope.isActorReadScopeCurrent(receivingScope) })
  const received = [1, 2].map(id => ({ key: String(id), product: { id }, mode: 'add', status: 'queued', quantity: 1, freeQuantity: 0, createPayload: boundary.startsWith('create') && id === 1 ? { name: 'New' } : null }))
  const dependencies: Record<string, any> = {
    ...scope, receivingScope, saving: false, received, branchId: '1', canEditCosts: true, canViewCosts: true,
    paidAmount: '', paymentStatus: 'paid', creditDueDate: '', submissionsRef: { current: {} },
    refuseDestination: () => false, lineNeedsCreate: (line: any) => !!line.createPayload,
    setSaving: () => effect('saving'), setReceived: () => effect('received'), setCreatedProductIds: () => effect('created-ids'),
    setStep: () => effect('step'), notify: () => effect('notify'), tr: (_key: string, fallback: string) => fallback,
    finishSession: () => effect('finish'), onDone: () => effect('done'),
    persistSessionDraft: () => effect('draft'), persistSubmissionDraft: () => effect('submission'),
    applyLineOutcome: (lines: any[], key: string, patch: any) => lines.map(line => line.key === key ? { ...line, ...patch } : line),
    createHeldProduct: async () => { scope.change(); if (boundary.endsWith('error')) throw Error('Late create failure'); return 72 }, failureText: () => 'Failed', stockLineNeedsRemoval: () => false,
    describeLineResult: () => 'Received', commitSessionBlock: () => ({}), captureReceivingRequest() {},
    buildLineRequest: (line: any) => ({ key: line.key, wire: 'receive', body: { productId: line.product.id } }),
    isDeferredStockInResult: () => false,
    commitFastStockIn: async () => { if (boundary.startsWith('commit')) { scope.change(); if (boundary.endsWith('error')) throw Error('Late commit failure') }; return boundary.startsWith('fallback') ? null : [] },
    receiveBatchStock: async (body: any) => { requests.push(body.productId); scope.change(); if (boundary.endsWith('error')) throw Error('Late fallback failure'); return { success: true } },
    adjustStock: () => { throw new Error('unexpected adjustment') },
  }
  dependencies.performCommitSequential = extract(modal, 'performCommitSequential', dependencies)
  const perform = extract(modal, 'performCommit', dependencies)
  if (boundary === 'before') scope.change()
  return { perform, effects, requests }
}
for (const boundary of ['before', 'create', 'create-error', 'commit', 'commit-error', 'fallback', 'fallback-error']) {
  await check(`actual modal ${boundary}: stale continuation cannot apply results, clear or finish`, async () => {
    const f = modalFixture(boundary); await f.perform()
    assert.deepEqual(f.effects.filter(effect => !effect.current), [])
    assert.equal(f.effects.some(effect => effect.name === 'finish'), false)
    if (boundary.startsWith('fallback')) assert.deepEqual(f.requests, [1])
  })
}
await check('direct finish callback preserves draft after owner changes', () => {
  const scope = authority(), receivingScope = scope.captureActorReadScope(), effects: string[] = []
  const finish = extract(modal, 'finishSession', { ...scope, receivingScope, onDone: () => effects.push('done'), clearWorkDraft: () => effects.push('clear'), fastStockInDraftKey: 'old-owner', onClose: () => effects.push('close') })
  scope.change(); finish(); assert.deepEqual(effects, [])
})
await check('modal keeps mounted scope and draft key across a new-owner render', () => {
  const scope = authority()
  let scopeRef: unknown, keyRef: unknown, ownerKey = 'owner-one'
  const currentScope = () => extract(modal, 'receivingScope', { ...scope, useRef: (value: unknown) => ({ current: scopeRef ??= value }) })
  const currentKey = () => extract(modal, 'fastStockInDraftKey', { scopedWorkDraftKey: () => ownerKey, useRef: (value: unknown) => ({ current: keyRef ??= value }) })
  const originalScope = currentScope(), originalKey = currentKey()
  scope.change(); ownerKey = 'owner-two'
  assert.equal(currentScope(), originalScope); assert.equal(currentKey(), originalKey)
  assert.equal(scope.isActorReadScopeCurrent(originalScope), false)
})
await check('stale render cannot schedule draft data under another owner', () => {
  const tree = ts.createSourceFile('modal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('scheduleWorkDraftWrite')) callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree); assert(callback)
  const scope = authority(), receivingScope = scope.captureActorReadScope(), writes: unknown[] = []
  const run = extract(`const run = ${callback.getText(tree)}`, 'run', { ...scope, receivingScope, scheduleWorkDraftWrite: (...args: unknown[]) => writes.push(args), fastStockInDraftKey: 'old-owner', currentDraft: () => ({ lines: ['original'] }) })
  run(); assert.equal(writes.length, 1)
  scope.change(); run(); assert.equal(writes.length, 1)
})
await check('image preparation cannot publish held product after original owner changes', async () => {
  const scope = authority(), receivingScope = scope.captureActorReadScope()
  const hold = extract(modal, 'holdNewProduct', { ...scope, receivingScope, omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 }, onPrepareProduct: async (value: unknown) => { scope.change(); return value } })
  await assert.rejects(hold({ name: 'New' }), { code: 'stale_read_scope' })
})
if (failed) process.exitCode = 1
