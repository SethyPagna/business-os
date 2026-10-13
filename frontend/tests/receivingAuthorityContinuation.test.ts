import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as actor from '../src/api/actorReadScope.ts'
import { __resetApiHealthForTests, pingServerHealth, setSyncServerUrl } from '../src/api/http.ts'
import { permissionRefreshIntent } from '../src/utils/permissionRefreshAccumulator.ts'

// The Stock Session writes for the owner who opened it: server, origin, user id
// and organization. Every case below runs the REAL authority module in one fake
// tab, so same-user churn (a session reset, a permission/profile/expiry rewrite,
// a reconnect) must continue, and a real owner change must refuse -- with saving
// cleared, a message, and the exits reachable.

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
function effectCallback(text: string, marker: string): string {
  const tree = ts.createSourceFile('modal.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' && node.arguments[0]?.getText(tree).includes(marker)) callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(callback, marker)
  return callback.getText(tree)
}
const http = source('api/http.ts'), transport = source('api/inventoryWriteTransport.ts'), modal = source('components/inventory/FastStockInModal.tsx')

// ---- one fake browser tab ----
const local = new Map<string, string>(), tabSession = new Map<string, string>()
const store = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, String(value)) }, removeItem: (key: string) => { map.delete(key) } })
let onSyncUpdate: ((detail: any) => void) | null = null
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: store(local), sessionStorage: store(tabSession), location: { origin: 'https://shop.test', hostname: 'shop.test' },
  addEventListener() {}, removeEventListener() {},
  dispatchEvent: (event: { type?: string; detail?: unknown }) => { if (event?.type === 'sync:update') onSyncUpdate?.(event.detail); return true },
  setTimeout, clearTimeout, setInterval, clearInterval,
} })
const SERVER = 'https://original.example.test'
const OWNER = { id: 7, organization_id: 3, role_id: 2, name: 'Cashier', permissions: ['inventory.adjust'] }
const writeUser = (patch: Record<string, unknown> = {}): void => { local.set('businessos_user', JSON.stringify({ ...OWNER, ...patch })) }
function freshTab() {
  local.clear(); tabSession.clear(); writeUser(); setSyncServerUrl(SERVER); __resetApiHealthForTests()
  actor.resetActorReadSession()
  if (actor.isActorSessionQuarantined()) actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
  assert.equal(actor.isActorSessionQuarantined(), false)
}

// A failed probe then a good one: http.ts's own reconnect refresh, the real
// permission-refresh intent, and the reset AppContext.clearLocalBusinessState runs.
async function healthFlap() {
  const before = actor.captureActorReadScope('inventory')
  const nativeFetch = globalThis.fetch
  let resets = 0
  onSyncUpdate = (detail) => {
    if (permissionRefreshIntent(detail, { userId: OWNER.id, roleId: OWNER.role_id }) === 'refresh') { actor.resetActorReadSession(); resets++ }
  }
  try {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await pingServerHealth(true)
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch
    await pingServerHealth(true)
  } finally { globalThis.fetch = nativeFetch; onSyncUpdate = null }
  assert(resets > 0, 'the reconnect really ran the permission-refresh reset')
  assert.equal(actor.isActorReadScopeCurrent(before, false), false, 'control: the full read fingerprint moved')
}
const SAME_USER: Record<string, () => void | Promise<void>> = {
  'session reset': () => actor.resetActorReadSession(),
  'permissions rewrite': () => writeUser({ permissions: ['inventory.adjust', 'products.add'] }),
  'avatar rewrite': () => writeUser({ avatar_path: 'avatar.png' }),
  'expiry rewrite': () => { local.set('businessos_user_expiry', String(Date.now() + 86_400_000)) },
  'health flap': healthFlap,
}
const REAL_CHANGE: Record<string, () => void | Promise<void>> = {
  'another user': () => writeUser({ id: 8 }),
  'another organization': () => writeUser({ organization_id: 4 }),
  'another server': () => setSyncServerUrl('https://other.example.test'),
  // B is observed by an ordinary read while signed in, then A returns.
  'A to B and back to A': () => { writeUser({ id: 8 }); actor.captureActorReadScope(); writeUser() },
}

let failed = 0
async function check(name: string, action: () => Promise<void> | void) {
  try { freshTab(); await action(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}

await check('the real modules: same-user churn keeps the write identity, a real change refuses it', async () => {
  for (const [name, change] of Object.entries(SAME_USER)) {
    freshTab(); const identity = actor.captureActorWriteIdentity(); await change()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), true, name)
    assert.doesNotThrow(() => actor.assertActorWriteIdentity(identity), name)
  }
  for (const [name, change] of Object.entries(REAL_CHANGE)) {
    freshTab(); const identity = actor.captureActorWriteIdentity(); await change()
    assert.equal(actor.isActorWriteIdentityCurrent(identity), false, name)
    assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_owner_changed', outcome: 'not_dispatched' }, name)
  }
  freshTab(); const identity = actor.captureActorWriteIdentity(), read = actor.captureActorReadScope('inventory')
  actor.invalidateActorReadChannel('inventory')
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'cache invalidation is ignored')
  assert.equal(actor.isActorReadScopeCurrent(read, false), true, 'the read fence ignores it too without includeInvalidation')
})

await check('another tab signing in locks the identity, and the same owner confirmed again releases it', () => {
  const identity = actor.captureActorWriteIdentity()
  local.set('businessos_read_session', 'another-tab-signed-in')
  assert.equal(actor.isActorWriteIdentityCurrent(identity), false, 'locked while the change is checked')
  assert.throws(() => actor.assertActorWriteIdentity(identity), { code: 'actor_session_quarantined' })
  assert.equal(actor.isActorWriteIdentityCurrent(identity, true), true, 'the owner itself did not change')
  assert.equal(actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()), true)
  assert.equal(actor.isActorWriteIdentityCurrent(identity), true, 'the same owner continues once confirmed')
})

// ---- the transport: route() + commitFastStockIn extracted from source, real authority ----
function transportFixture(mode: 'normal' | 'late-success' | 'late-404' | 'fresh-404' | 'settlement-switch' | 'before-dispatch', change: () => void | Promise<void>) {
  const calls: string[][] = [], settled: number[][] = [], invalidations: string[] = [], events: unknown[] = []
  const route = extract(http, 'route', {
    ...actor, getSyncServerUrl: () => 'https://fixture.invalid',
    getReadServerBaseUrl: () => 'https://fixture.invalid', hasStoredAuthSession: () => true, getSameOriginApiBaseUrl: () => '',
    throwIfRequestAborted() {}, _serverOnline: true, cacheInvalidateWithDerived: (key: string) => invalidations.push(key),
    setServerHealth() {}, logCall() {}, isConnectivityError: () => false, isWriteConflictError: () => false,
    isInvalidSessionError: () => false, createSyncErrorId: () => 'event', window: { dispatchEvent: (event: unknown) => events.push(event) },
  })
  const isDeferredStockInResult = extract(transport, 'isDeferredStockInResult', {})
  const commitStockInLinesInRounds = extract(transport, 'commitStockInLinesInRounds', { isDeferredStockInResult })
  const commit = extract(transport, 'commitFastStockIn', {
    ...actor, receiveBatchWireBody: (body: unknown) => body, getDevicePayload: () => ({}), commitStockInLinesInRounds,
    route: async (...args: unknown[]) => { if (mode === 'before-dispatch' && !calls.length) await change(); return route(...args) },
    fastStockInCommitPayload: extract(transport, 'fastStockInCommitPayload', {}),
    apiFetch: async (_method: string, _url: string, body: any) => {
      calls.push(body.lines.map((line: any) => line.key))
      if (mode === 'late-success' || mode === 'late-404') await change()
      if (mode === 'late-404' || mode === 'fresh-404') throw Object.assign(new Error('No route'), { status: 404 })
      return { results: body.lines.map((line: any, index: number) => index === 0 ? { key: line.key, ok: true } : { key: line.key, ok: false, code: 'deferred' }) }
    },
  })
  const lines = ['existing', 'new'].map(key => ({ key, wire: 'receive', body: { productId: key === 'existing' ? 1 : 2 } }))
  const run = (writeIdentity?: unknown) => commit(lines, async (rows: any[]) => {
    settled.push(rows.map(row => row.index))
    if (mode === 'settlement-switch') await change()
  }, writeIdentity ? { writeIdentity } : undefined)
  return { calls, settled, invalidations, events, run }
}
const refused = (error: any) => ['actor_owner_changed', 'actor_session_quarantined'].includes(error.code)

await check('original owner completes deferred rounds once and retains result order', async () => {
  const f = transportFixture('normal', () => {}), results = await f.run()
  assert.deepEqual(f.calls, [['existing', 'new'], ['new']]); assert(results.every((row: any) => row.ok))
  assert.deepEqual(f.settled, [[0], [1]])
})
for (const [name, change] of Object.entries(REAL_CHANGE)) {
  for (const mode of ['late-success', 'late-404', 'before-dispatch'] as const) {
    await check(`${name}, ${mode}: the stale operation cannot publish or select the old-Worker fallback`, async () => {
      const f = transportFixture(mode, change)
      await assert.rejects(f.run(), refused)
      assert.equal(f.calls.length, mode === 'before-dispatch' ? 0 : 1)
      assert.deepEqual(f.settled, []); assert.deepEqual(f.invalidations, []); assert.deepEqual(f.events, [])
    })
  }
}
for (const [name, change] of Object.entries(SAME_USER)) {
  await check(`${name}, late success and late 404: the same owner's rounds continue`, async () => {
    const f = transportFixture('late-success', change), results = await f.run()
    assert.deepEqual(f.calls, [['existing', 'new'], ['new']]); assert(results.every((row: any) => row.ok)); assert.deepEqual(f.settled, [[0], [1]])
    freshTab()
    const fallback = transportFixture('late-404', change)
    assert.equal(await fallback.run(), null, 'the old-Worker fallback stays available to the same owner')
  })
}
await check('original current 404 retains legacy fallback', async () => {
  const f = transportFixture('fresh-404', () => {}); assert.equal(await f.run(), null); assert.equal(f.calls.length, 1)
})
await check('an owner change during settlement cannot send another deferred round', async () => {
  const f = transportFixture('settlement-switch', REAL_CHANGE['another user']), results = await f.run().catch((error: any) => error)
  assert.deepEqual(f.calls, [['existing', 'new']])
  assert(Array.isArray(results) ? results[1].ok === false : refused(results))
})
await check('an identity captured before product preparation is not recaptured at stock entry', async () => {
  const f = transportFixture('normal', () => {}), owner = actor.captureActorWriteIdentity(); writeUser({ id: 8 })
  await assert.rejects(f.run(owner), refused); assert.deepEqual(f.calls, [])
})

// ---- the modal: performCommit and friends extracted from source, real authority ----
function modalFixture(boundary: string, change: () => void | Promise<void>) {
  const receivingIdentity = actor.captureActorWriteIdentity()
  const effects: Array<{ name: string; current: boolean }> = [], requests: number[] = []
  const effect = (name: string) => effects.push({ name, current: actor.isActorWriteIdentityCurrent(receivingIdentity) })
  let saving = false, switched = false
  const received = [1, 2].map(id => ({ key: String(id), product: { id }, mode: 'add', status: 'queued', quantity: 1, freeQuantity: 0, createPayload: boundary.startsWith('create') && id === 1 ? { name: 'New' } : null }))
  const tr = (_key: string, fallback: string) => fallback
  const dependencies: Record<string, any> = {
    isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, saving: false, received, branchId: '1', canEditCosts: true, canViewCosts: true,
    paidAmount: '', paymentStatus: 'paid', creditDueDate: '', submissionsRef: { current: {} },
    refuseDestination: () => false, lineNeedsCreate: (line: any) => !!line.createPayload,
    setSaving: (value: boolean) => { saving = value; effect(`saving:${value}`) }, setSignInChanged: (value: boolean) => effect(`sign-in-changed:${value}`),
    setReceived: (lines: any[] = []) => {
      effect('received')
      // Between two old-Worker sends: the next line must be checked before it goes out.
      if (boundary === 'fallback-between' && !switched && lines.some(line => line.status === 'saved')) { switched = true; void change() }
    },
    setCreatedProductIds: () => effect('created-ids'),
    setStep: () => effect('step'), notify: () => effect('notify'), tr,
    finishSession: () => effect('finish'), onDone: () => effect('done'),
    persistSessionDraft: () => effect('draft'), persistSubmissionDraft: () => effect('submission'),
    applyLineOutcome: (lines: any[], key: string, patch: any) => lines.map(line => line.key === key ? { ...line, ...patch } : line),
    createHeldProduct: async () => { await change(); if (boundary.endsWith('error')) throw Error('Late create failure'); return 72 }, failureText: () => 'Failed', stockLineNeedsRemoval: () => false,
    describeLineResult: () => 'Received', commitSessionBlock: () => ({}), captureReceivingRequest() {},
    buildLineRequest: (line: any) => ({ key: line.key, wire: 'receive', body: { productId: line.product.id } }),
    isDeferredStockInResult: () => false,
    commitFastStockIn: async (_lines: unknown, settled: (rows: unknown[]) => void) => {
      if (boundary === 'round-settle') {
        await change()
        settled([{ index: 0, result: { ok: true } }, { index: 1, result: { ok: true } }])
        return [{ ok: true }, { ok: true }]
      }
      if (boundary.startsWith('commit')) { await change(); if (boundary.endsWith('error')) throw Error('Late commit failure') }
      return boundary.startsWith('fallback') ? null : []
    },
    receiveBatchStock: async (body: any) => {
      requests.push(body.productId)
      if (boundary !== 'fallback-between') await change()
      if (boundary.endsWith('error')) throw Error('Late fallback failure')
      return { success: true }
    },
    adjustStock: () => { throw new Error('unexpected adjustment') },
  }
  dependencies.ownerChangedText = extract(modal, 'ownerChangedText', { tr })
  dependencies.assertReceivingOwner = extract(modal, 'assertReceivingOwner', dependencies)
  dependencies.stopForSignInChange = extract(modal, 'stopForSignInChange', dependencies)
  dependencies.performCommitSequential = extract(modal, 'performCommitSequential', dependencies)
  const performCommit = extract(modal, 'performCommit', dependencies)
  const perform = async () => { if (boundary === 'before') await change(); await performCommit() }
  return { perform, effects, requests, saving: () => saving, receivingIdentity }
}
const exits = (saving: boolean, receivingIdentity: unknown) => {
  const reached: string[] = []
  const closeGuard = { requestClose: () => reached.push('close'), promptOpen: false }
  extract(modal, 'requestCloseIfIdle', { saving, closeGuard })()
  extract(modal, 'preserveAndMinimize', {
    saving, onMinimize: () => reached.push('minimize'), flushPendingWorkDraft() {}, fastStockInDraftKey: 'pinned-owner-key', sessionLabel: 'Add Session',
    onClose: () => reached.push('closed'), notify: (message: string) => reached.push(`notice:${message.slice(0, 7)}`),
    tr: (_key: string, fallback: string) => fallback, isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity,
  })()
  let onKey: ((event: unknown) => void) | undefined
  extract(`const listen = ${effectCallback(modal, 'onEscape')}`, 'listen', {
    saving, selectedGroup: null, reasonsOpen: false, closeGuard: { ...closeGuard, requestClose: () => reached.push('escape') },
    parentPanelRef: { current: null }, Element: class {}, window: { addEventListener: (_type: string, handler: any) => { onKey = handler }, removeEventListener() {} },
  })()
  assert(onKey)
  onKey({ key: 'Escape', defaultPrevented: false, target: null, preventDefault() {} })
  return reached
}

const SAME_USER_BOUNDARIES = ['before', 'create', 'commit', 'round-settle', 'fallback']
for (const [name, change] of Object.entries(SAME_USER)) {
  for (const boundary of SAME_USER_BOUNDARIES) {
    await check(`actual modal, ${name} at ${boundary}: the same owner's session continues and completes`, async () => {
      const f = modalFixture(boundary, change); await f.perform()
      const names = f.effects.map(effect => effect.name)
      assert.deepEqual(f.effects.filter(effect => !effect.current), [], 'nothing ran under a refused identity')
      assert(names.includes('finish'), names.join(','))
      assert.equal(names.some(entry => entry.startsWith('sign-in-changed')), false)
      assert.equal(f.saving(), false)
      if (boundary === 'fallback') assert.deepEqual(f.requests, [1, 2])
    })
  }
}
// The owner really changed: nothing is applied, saving clears, the message shows.
const STOP = new Set(['saving:false', 'sign-in-changed:true'])
for (const [name, change] of Object.entries(REAL_CHANGE)) {
  for (const boundary of ['before', 'create', 'create-error', 'commit', 'commit-error', 'fallback', 'fallback-error', 'fallback-between', 'round-settle']) {
    await check(`actual modal, ${name} at ${boundary}: applies nothing, clears saving and says how to continue`, async () => {
      const f = modalFixture(boundary, change); await f.perform()
      const stale = f.effects.filter(effect => !effect.current).map(effect => effect.name)
      assert.deepEqual(new Set(stale), STOP, stale.join(','))
      assert.equal(f.saving(), false, 'saving is cleared, so close and minimize work')
      assert.equal(f.effects.some(effect => effect.name === 'finish'), false)
      if (boundary.startsWith('fallback')) assert.deepEqual(f.requests, [1])
    })
  }
}
for (const boundary of ['create', 'commit', 'fallback', 'round-settle']) {
  await check(`actual modal, another user at ${boundary}: close, Escape and minimize stay reachable and minimize tells the truth`, async () => {
    const f = modalFixture(boundary, REAL_CHANGE['another user']); await f.perform()
    assert.deepEqual(exits(f.saving(), f.receivingIdentity), ['close', 'notice:Closed.', 'closed', 'escape'], 'no chip for the new owner, no "nothing was lost"')
  })
}
await check('positive control: the same owner after a reset minimizes to the chip as before', async () => {
  const f = modalFixture('commit', SAME_USER['session reset']); await f.perform()
  assert.deepEqual(exits(f.saving(), f.receivingIdentity), ['close', 'minimize', 'closed', 'escape'])
})
await check('direct finish callback: the same owner finishes; another owner keeps the draft and gets the message', () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), effects: string[] = []
  const finish = extract(modal, 'finishSession', { isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, stopForSignInChange: () => effects.push('sign-in-changed'), onDone: () => effects.push('done'), clearWorkDraft: () => effects.push('clear'), fastStockInDraftKey: 'old-owner', onClose: () => effects.push('close') })
  actor.resetActorReadSession(); finish(); assert.deepEqual(effects, ['done', 'clear', 'close'], 'a session reset still finishes')
  effects.length = 0
  writeUser({ id: 8 }); finish(); assert.deepEqual(effects, ['sign-in-changed'])
})
await check('modal keeps the identity and draft key it opened with across a new-owner render', () => {
  let identitySlot: unknown, keyRef: unknown, ownerKey = 'owner-one'
  const useState = (init: () => unknown) => [identitySlot ??= init()]
  const tree = ts.createSourceFile('modal.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let statement = ''
  const visit = (node: ts.Node) => { if (ts.isVariableStatement(node) && node.getText(tree).includes('useState(captureActorWriteIdentity)')) statement = node.getText(tree); ts.forEachChild(node, visit) }
  visit(tree); assert(statement)
  const currentIdentity = () => new Function('useState', 'captureActorWriteIdentity', `${statement}; return receivingIdentity`)(useState, actor.captureActorWriteIdentity)
  const currentKey = () => extract(modal, 'fastStockInDraftKey', { scopedWorkDraftKey: () => ownerKey, useRef: (value: unknown) => ({ current: keyRef ??= value }) })
  const originalIdentity = currentIdentity(), originalKey = currentKey()
  writeUser({ id: 8 }); ownerKey = 'owner-two'
  assert.equal(currentIdentity(), originalIdentity); assert.equal(currentKey(), originalKey)
  assert.equal(actor.isActorWriteIdentityCurrent(originalIdentity as actor.ActorWriteIdentity), false)
})
await check('autosave: the same owner keeps saving through churn; another owner is not saved and is told', async () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), writes: unknown[] = [], flags: boolean[] = []
  const run = extract(`const run = ${effectCallback(modal, 'scheduleWorkDraftWrite')}`, 'run', {
    isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
    scheduleWorkDraftWrite: (...args: unknown[]) => writes.push(args), fastStockInDraftKey: 'old-owner', currentDraft: () => ({ lines: ['original'] }),
  })
  run(); await healthFlap(); actor.resetActorReadSession(); writeUser({ avatar_path: 'a.png' }); run()
  assert.equal(writes.length, 2, 'churn keeps the autosave going'); assert.deepEqual(flags, [false, false])
  writeUser({ id: 8 }); run()
  assert.equal(writes.length, 2, 'nothing is saved under another owner')
  assert.deepEqual(flags, [false, false, true], 'and the message shows instead of silently not saving')
})
await check('a locked session shows the message, and the same owner confirmed again clears it', async () => {
  const receivingIdentity = actor.captureActorWriteIdentity(), flags: boolean[] = []
  const subscribe = extract(`const subscribe = ${effectCallback(modal, 'subscribeActorSessionQuarantine')}`, 'subscribe', {
    subscribeActorSessionQuarantine: actor.subscribeActorSessionQuarantine, isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent,
    receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
  })
  const unsubscribe = subscribe()
  try {
    local.set('businessos_read_session', 'another-tab-signed-in'); actor.isActorSessionQuarantined()
    assert.deepEqual(flags, [], 'never set inside the notifying call (it may run inside another component render)')
    await Promise.resolve(); assert.deepEqual(flags, [true])
    actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
    await Promise.resolve(); assert.deepEqual(flags, [true, false])
  } finally { unsubscribe() }
})
await check('the message is inline and translated, Complete waits while it shows, and the header exits stay on', () => {
  const en = JSON.parse(source('lang/en.json')), km = JSON.parse(source('lang/km.json'))
  for (const key of ['stock_session_sign_in_changed', 'stock_session_kept_for_owner']) {
    assert(String(km[key] || '').includes('វគ្គ'), `${key}: Khmer names the session`)
    assert.notEqual(km[key], en[key])
  }
  const flat = modal.replace(/\r\n/g, '\n')
  assert(flat.includes(`tr('stock_session_sign_in_changed', ${JSON.stringify(en.stock_session_sign_in_changed).replace(/^"|"$/g, "'")})`), 'the fallback is the pack English')
  assert(flat.includes(`tr('stock_session_kept_for_owner', ${JSON.stringify(en.stock_session_kept_for_owner).replace(/^"|"$/g, "'")})`), 'the fallback is the pack English')
  assert.match(flat, /\{signInChanged \? <p role="alert"[^>]*>\{ownerChangedText\(\)\}<\/p> : null\}\s*<StockSessionFooter/)
  assert.match(flat, /primaryDisabled=\{footerDisabled \|\| signInChanged\}/)
  assert.match(flat, /<StockSessionHeader[\s\S]*?disabled=\{busy\}[\s\S]*?onClose=\{requestCloseIfIdle\}/, 'close and minimize follow saving alone')
  assert.match(flat, /const busy = saving\n/)
  assert.match(flat, /const editLocked = busy \|\| signInChanged\n/, 'edits that would no longer be saved are locked')
  for (const surface of ['StockSessionSharedDetails', 'StockSessionLineEntry', 'StockSessionItems', 'StockSessionPaymentStep']) {
    assert.match(flat, new RegExp(`<${surface}[\\s\\S]*?(?:busy|disabled)=\\{editLocked(?: \\|\\| detailsLocked)?\\}`), surface)
  }
  assert.match(flat, /<StockSessionSteps [^\n]*disabled=\{editLocked\}/)
})
await check('F4: an owner change while the product attempt registers cannot hold the product; churn can', async () => {
  const run = async (change: () => void | Promise<void>) => {
    freshTab()
    const receivingIdentity = actor.captureActorWriteIdentity(), applied: unknown[] = [], flags: boolean[] = []
    const tr = (_key: string, fallback: string) => fallback
    const dependencies: Record<string, any> = {
      isActorWriteIdentityCurrent: actor.isActorWriteIdentityCurrent, receivingIdentity, setSignInChanged: (value: boolean) => flags.push(value),
      omitUnauthorizedCatalogCosts: (value: unknown) => value, user: { id: 7 }, onPrepareProduct: async (value: unknown) => value,
      createClientRequestId: () => 'product-1', registerReceivingProductAttempt: async () => { await change() },
      stockFailureText: () => 'Failed', tr, priceText: (value: unknown) => String(value ?? ''),
      applyEntry: (entry: unknown) => applied.push(entry), setBatchChoice: () => applied.push('batch'), setSupplier: () => applied.push('supplier'),
      supplier: { supplierName: '' }, brand: '', canReceive: true, canViewCosts: true,
    }
    dependencies.ownerChangedText = extract(modal, 'ownerChangedText', { tr })
    dependencies.assertReceivingOwner = extract(modal, 'assertReceivingOwner', dependencies)
    const hold = extract(modal, 'holdNewProduct', dependencies)
    return { promise: hold({ name: 'New' }), applied, flags }
  }
  const control = await run(() => {}); await control.promise
  assert.equal(control.applied.length, 2, 'positive control: the current owner holds the product')
  const churn = await run(SAME_USER['session reset']); await churn.promise
  assert.equal(churn.applied.length, 2, 'a session reset does not block holding the product')
  const fenced = await run(REAL_CHANGE['another user'])
  await assert.rejects(fenced.promise, (error: any) => error.code === 'actor_owner_changed' && /signed-in account changed/.test(error.message))
  assert.deepEqual(fenced.applied, []); assert.deepEqual(fenced.flags, [true])
})
if (failed) process.exitCode = 1
