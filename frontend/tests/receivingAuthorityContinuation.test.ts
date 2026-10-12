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

function tryExtract(text: string, name: string, dependencies: Record<string, any>): any {
  try { return extract(text, name, dependencies) } catch { return undefined }
}
function modalFixture(boundary: string) {
  const scope = authority(), receivingScope = scope.captureActorReadScope()
  const effects: Array<{ name: string; current: boolean }> = [], requests: number[] = []
  const effect = (name: string) => effects.push({ name, current: scope.isActorReadScopeCurrent(receivingScope) })
  let saving = false
  const received = [1, 2].map(id => ({ key: String(id), product: { id }, mode: 'add', status: 'queued', quantity: 1, freeQuantity: 0, createPayload: boundary.startsWith('create') && id === 1 ? { name: 'New' } : null }))
  const dependencies: Record<string, any> = {
    ...scope, receivingScope, saving: false, received, branchId: '1', canEditCosts: true, canViewCosts: true,
    paidAmount: '', paymentStatus: 'paid', creditDueDate: '', submissionsRef: { current: {} },
    refuseDestination: () => false, lineNeedsCreate: (line: any) => !!line.createPayload,
    setSaving: (value: boolean) => { saving = value; effect(`saving:${value}`) }, setSignInChanged: (value: boolean) => effect(`sign-in-changed:${value}`),
    setReceived: () => effect('received'), setCreatedProductIds: () => effect('created-ids'),
    setStep: () => effect('step'), notify: () => effect('notify'), tr: (_key: string, fallback: string) => fallback,
    finishSession: () => effect('finish'), onDone: () => effect('done'),
    persistSessionDraft: () => effect('draft'), persistSubmissionDraft: () => effect('submission'),
    applyLineOutcome: (lines: any[], key: string, patch: any) => lines.map(line => line.key === key ? { ...line, ...patch } : line),
    createHeldProduct: async () => { scope.change(); if (boundary.endsWith('error')) throw Error('Late create failure'); return 72 }, failureText: () => 'Failed', stockLineNeedsRemoval: () => false,
    describeLineResult: () => 'Received', commitSessionBlock: () => ({}), captureReceivingRequest() {},
    buildLineRequest: (line: any) => ({ key: line.key, wire: 'receive', body: { productId: line.product.id } }),
    isDeferredStockInResult: () => false,
    commitFastStockIn: async (_lines: unknown, settled: (rows: unknown[]) => void) => {
      if (boundary === 'round-settle' || boundary === 'round-control') {
        if (boundary === 'round-settle') scope.change()
        settled([{ index: 0, result: { ok: true } }, { index: 1, result: { ok: true } }])
        return [{ ok: true }, { ok: true }]
      }
      if (boundary.startsWith('commit')) { scope.change(); if (boundary.endsWith('error')) throw Error('Late commit failure') }
      return boundary.startsWith('fallback') ? null : []
    },
    receiveBatchStock: async (body: any) => { requests.push(body.productId); scope.change(); if (boundary.endsWith('error')) throw Error('Late fallback failure'); return { success: true } },
    adjustStock: () => { throw new Error('unexpected adjustment') },
  }
  dependencies.stopForSignInChange = tryExtract(modal, 'stopForSignInChange', dependencies)
  dependencies.performCommitSequential = extract(modal, 'performCommitSequential', dependencies)
  const perform = extract(modal, 'performCommit', dependencies)
  if (boundary === 'before') scope.change()
  return { perform, effects, requests, saving: () => saving }
}
// A sign-in change (even the same user's permission refresh) fences the session:
// nothing is applied, but saving clears and the inline message names the way out.
const staleStop = ['saving:false', 'sign-in-changed:true']
for (const boundary of ['before', 'create', 'create-error', 'commit', 'commit-error', 'fallback', 'fallback-error', 'round-settle']) {
  await check(`actual modal ${boundary}: stale continuation applies nothing, clears saving and says how to continue`, async () => {
    const f = modalFixture(boundary); await f.perform()
    assert.deepEqual(f.effects.filter(effect => !effect.current).map(effect => effect.name), staleStop)
    assert.equal(f.saving(), false, 'saving is cleared, so close and minimize work')
    assert.equal(f.effects.some(effect => effect.name === 'finish'), false)
    if (boundary.startsWith('fallback')) assert.deepEqual(f.requests, [1])
  })
}
await check('positive control: a current receipt round is applied and the session finishes', async () => {
  const f = modalFixture('round-control'); await f.perform()
  const names = f.effects.map(effect => effect.name)
  assert(names.includes('draft') && names.includes('received') && names.includes('finish'), names.join(','))
  assert.equal(names.some(name => name.startsWith('sign-in-changed')), false)
  assert.equal(f.saving(), false)
})
for (const boundary of ['create', 'commit', 'fallback', 'round-settle']) {
  await check(`actual modal ${boundary}: close, minimize and Escape stay reachable after a mid-save sign-in change`, async () => {
    const f = modalFixture(boundary); await f.perform()
    const saving = f.saving(), reached: string[] = []
    const closeGuard = { requestClose: () => reached.push('close'), promptOpen: false }
    extract(modal, 'requestCloseIfIdle', { saving, closeGuard })()
    extract(modal, 'preserveAndMinimize', { saving, onMinimize: () => reached.push('minimize'), flushPendingWorkDraft() {}, fastStockInDraftKey: 'old-owner', sessionLabel: 'Add Session', onClose() {} })()
    const tree = ts.createSourceFile('modal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let escapeEffect: ts.Node | undefined
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes('onEscape')) escapeEffect = node.arguments[0]
      ts.forEachChild(node, visit)
    }
    visit(tree); assert(escapeEffect)
    let onKey: ((event: unknown) => void) | undefined
    const listen = extract(`const listen = ${escapeEffect.getText(tree)}`, 'listen', {
      saving, selectedGroup: null, reasonsOpen: false, closeGuard: { ...closeGuard, requestClose: () => reached.push('escape') },
      parentPanelRef: { current: null }, Element: class {}, window: { addEventListener: (_type: string, handler: any) => { onKey = handler }, removeEventListener() {} },
    })
    listen(); assert(onKey)
    onKey({ key: 'Escape', defaultPrevented: false, target: null, preventDefault() {} })
    assert.deepEqual(reached, ['close', 'minimize', 'escape'])
  })
}
await check('direct finish callback preserves draft after owner changes and says how to continue', () => {
  const scope = authority(), receivingScope = scope.captureActorReadScope(), effects: string[] = []
  const finish = extract(modal, 'finishSession', { ...scope, receivingScope, stopForSignInChange: () => effects.push('sign-in-changed'), onDone: () => effects.push('done'), clearWorkDraft: () => effects.push('clear'), fastStockInDraftKey: 'old-owner', onClose: () => effects.push('close') })
  finish(); assert.deepEqual(effects, ['done', 'clear', 'close'], 'positive control: a current scope finishes')
  effects.length = 0
  scope.change(); finish(); assert.deepEqual(effects, ['sign-in-changed'])
})
await check('the sign-in message is inline, bilingual, and leaves Complete off while close stays on', () => {
  const en = JSON.parse(source('lang/en.json')), km = JSON.parse(source('lang/km.json'))
  const text = String(en.stock_session_sign_in_changed || '')
  assert.match(text, /sign-in changed/i); assert.match(text, /Close this session/)
  assert(String(km.stock_session_sign_in_changed || '').includes('វគ្គ'), 'Khmer names the session')
  assert.notEqual(km.stock_session_sign_in_changed, text)
  const flat = modal.replace(/\r\n/g, '\n')
  assert.match(flat, /\{signInChanged \? <p role="alert"[^>]*>\{tr\('stock_session_sign_in_changed', '[^']+'\)\}<\/p> : null\}\s*<StockSessionFooter/)
  assert.match(flat, /primaryDisabled=\{footerDisabled \|\| signInChanged\}/)
  assert.match(flat, /const busy = saving\n/, 'the header close and minimize are not disabled by the sign-in change')
})
await check('a sign-in change while the product attempt registers cannot hold the product', async () => {
  const run = async (switchDuringRegister: boolean) => {
    const scope = authority(), receivingScope = scope.captureActorReadScope(), applied: unknown[] = []
    const hold = extract(modal, 'holdNewProduct', {
      ...scope, receivingScope, omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 }, onPrepareProduct: async (value: unknown) => value,
      createClientRequestId: () => 'product-1', registerReceivingProductAttempt: async () => { if (switchDuringRegister) scope.change() },
      stockFailureText: () => 'Failed', tr: (_key: string, fallback: string) => fallback, priceText: (value: unknown) => String(value ?? ''),
      applyEntry: (entry: unknown) => applied.push(entry), setBatchChoice: () => applied.push('batch'), setSupplier: () => applied.push('supplier'),
      supplier: { supplierName: '' }, brand: '', canReceive: true, canViewCosts: true,
    })
    return { promise: hold({ name: 'New' }), applied }
  }
  const control = await run(false); await control.promise
  assert.equal(control.applied.length, 2, 'positive control: a current scope holds the product')
  const fenced = await run(true)
  await assert.rejects(fenced.promise, { code: 'stale_read_scope' })
  assert.deepEqual(fenced.applied, [])
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
  const scope = authority(), receivingScope = scope.captureActorReadScope(), writes: unknown[] = [], flags: boolean[] = []
  const run = extract(`const run = ${callback.getText(tree)}`, 'run', { ...scope, receivingScope, setSignInChanged: (value: boolean) => flags.push(value), scheduleWorkDraftWrite: (...args: unknown[]) => writes.push(args), fastStockInDraftKey: 'old-owner', currentDraft: () => ({ lines: ['original'] }) })
  run(); assert.equal(writes.length, 1); assert.deepEqual(flags, [])
  scope.change(); run(); assert.equal(writes.length, 1)
  assert.deepEqual(flags, [true], 'an edit after a sign-in change shows the message instead of silently not saving')
})
await check('image preparation cannot publish held product after original owner changes', async () => {
  const scope = authority(), receivingScope = scope.captureActorReadScope()
  const hold = extract(modal, 'holdNewProduct', { ...scope, receivingScope, omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 }, onPrepareProduct: async (value: unknown) => { scope.change(); return value } })
  await assert.rejects(hold({ name: 'New' }), { code: 'stale_read_scope' })
})
if (failed) process.exitCode = 1
