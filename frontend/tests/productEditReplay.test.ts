import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { productEditHistoryReceipt, type ProductEditReplayIntent } from '../src/utils/productEditRequests.ts'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'

const source = readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const helper = source.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(helper)
const build = new Function(`${stripTypeScriptTypes(helper.replace('export ', ''))}; return buildServerReplayRequest`)()
assert.deepEqual(build({ applier: 'product.edit.v1', operation_id: '1', generation: 0 }), { require_applied: true, expected_generation: 0 })
console.log('PASS product edit replay preserves generation zero')

const { executeProductEditReplay } = await import('../src/utils/productEditRequests.ts')
for (const direction of ['undo', 'redo'] as const) {
  let raw: string | null = null
  const store = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value }, removeItem: () => { raw = null } }
  const pending = { serverId: 42, operationId: '7', direction, generation: 0 }
  const sent: unknown[] = []
  let commits = 0
  const receipts = new Map<string, unknown>()
  const send = async (intent: ProductEditReplayIntent, body: unknown) => {
    assert.ok(raw)
    sent.push({ intent: { serverId: intent.serverId, operationId: intent.operationId, direction: intent.direction, generation: intent.generation }, body })
    const id = JSON.stringify([intent.serverId, intent.operationId, intent.direction, intent.generation])
    if (!receipts.has(id)) {
      commits++
      const pointer = { applier: 'product.edit.v1', operation_id: '7', generation: 3 }
      receipts.set(id, { applied: true, action_history_id: 42, operation_id: '7', generation: 1, current_generation: 3,
        item: { id: 42, undo_payload: pointer, redo_payload: pointer } })
    }
    if (sent.length === 1) throw new Error('lost response')
    return receipts.get(id)
  }
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, send, () => {}), /lost response/)
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, async () => { throw Object.assign(new Error('permission revoked'), { status: 403 }) }, () => {}), /permission revoked/)
  assert.ok(raw, 'later permission refusal must preserve the earlier uncertain transition')
  await assert.rejects(executeProductEditReplay(store, 'actor', { ...pending, serverId: 43 }, send, () => {}), /pending Product Undo/)
  await executeProductEditReplay(store, 'actor', { ...pending, direction: direction === 'undo' ? 'redo' : 'undo', generation: 1 }, send, () => {})
  assert.deepEqual(sent[0], sent[1])
  assert.equal(commits, 1)
  assert.equal(raw, null)
  const queueReceipt = { pending: true, applied: false, pendingActionId: 51, operation_id: '7', generation: 0 }
  const queued = await executeProductEditReplay(store, 'actor', pending, async () => queueReceipt, () => {})
  assert.deepEqual(queued, queueReceipt)
  assert.ok(raw, 'pending approval retains the exact transition')
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, async () => ({ applied: false }), () => {}), /not confirmed/)
  assert.ok(raw)
  await assert.rejects(executeProductEditReplay(store, 'actor', pending, send, () => { throw new Error('stale actor') }), /stale actor/)
  assert.equal(commits, 1)
}
console.log('PASS exact Undo and Redo retries survive refetched generation, pending review and actor change')

const ast = ts.createSourceFile('actionHistory.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function closure(name: string, scope: Record<string, unknown>): any {
  const matches: ts.VariableDeclaration[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1)
  const javascript = ts.transpileModule(`return ${matches[0].initializer!.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('useCallback', ...Object.keys(scope), javascript)((fn: unknown) => fn, ...Object.values(scope))
}
const pointer = { applier: 'product.edit.v1', operation_id: '72', generation: 0 }
const result = { applied: true, action_history_id: 88, operation_id: '72', generation: 0, history: { id: 88, undo_payload: pointer, redo_payload: pointer } }
let rows: Array<Record<string, unknown>> = [], refreshes = 0, actorCurrent = true
const adopt = closure('adoptServerAction', {
  actorScopeRef: { current: 'actor7' }, actorScope: 'actor7', readScope: {}, limit: 10,
  serverItemsAuthority: {}, setServerItemsAuthority() {}, captureActorReadScope: () => ({}),
  isActorReadScopeCurrent: () => actorCurrent, productEditHistoryReceipt,
  setServerItems: (change: (previous: typeof rows) => typeof rows) => { rows = change(rows) },
  refreshServerItems: () => { refreshes++ },
})
assert.equal(adopt(result), true)
assert.equal(adopt(result), true)
assert.equal(rows.length, 1, 'adoption deduplicates the server ID without creating another History row')
assert.equal(refreshes, 2)
actorCurrent = false
assert.equal(adopt({ ...result, action_history_id: 99 }), false)
assert.equal(rows.length, 1)

for (const direction of ['undo', 'redo'] as const) for (const response of [{ applied: true }, { pending: true, applied: false }, { applied: false }]) {
  let mutations = 0, patches = 0, moved = 0
  const entry = { id: 'local', serverId: 88, undo: () => { mutations++ }, redo: () => { mutations++ } }
  const replay = closure('runEntry', {
    undoStack: [entry], redoStack: [entry], busy: '', limit: 10, notify: () => {},
    setBusy: () => {}, refreshServerItems: () => {}, resolveReplayAction,
    setUndoStack: () => { moved++ }, setRedoStack: () => { moved++ },
    getErrorMessage: (error: unknown) => String(error),
    loadActionHistoryTransport: async () => ({ undoActionHistory: async () => response, redoActionHistory: async () => response,
      updateActionHistory: async () => { patches++ } }),
  })
  assert.equal(await replay(direction), !('pending' in response))
  assert.equal(mutations, response.applied === false && !('pending' in response) ? 1 : 0)
  assert.equal(patches, 0)
  assert.equal(moved, 'pending' in response ? 0 : 2)
}
console.log('PASS actual History adoption and replay skip legacy writes after applied and do not advance pending review')

let replayRaw: string | null = null
const replayStore = { getItem: () => replayRaw, setItem: (_key: string, value: string) => { replayRaw = value }, removeItem: () => { replayRaw = null } }
let release!: () => void
const hold = new Promise<void>(resolve => { release = resolve })
let attempts = 0
const requested = { serverId: 88, operationId: '72', direction: 'undo' as const, generation: 0 }
const concurrent = async () => {
  if (++attempts === 1) { await hold; throw Object.assign(new Error('first refused'), { status: 403 }) }
  throw new Error('second outcome unknown')
}
const first = executeProductEditReplay(replayStore, 'actor', requested, concurrent, () => {})
await assert.rejects(executeProductEditReplay(replayStore, 'actor', requested, concurrent, () => {}), /second outcome unknown/)
release()
await assert.rejects(first, /first refused/)
assert.ok(replayRaw)
for (const reply of [{ applied: true }, { ...result, generation: 1, current_generation: 1, item: result.history }]) {
  await assert.rejects(executeProductEditReplay(replayStore, 'actor', requested, async () => reply, () => {}), /not confirmed/)
  assert.ok(replayRaw, 'invalid completion pointers cannot clear the pending transition')
}
console.log('PASS concurrent replay refusals and malformed completion receipts retain original transition')

for (const change of ['invalidation', 'actor', 'permission', 'stale']) {
  let revision = change === 'stale' ? 1 : 0, currentActor = true, stored: string | null = null, sent = 0
  const actorRef = { current: 'actor7' }
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value }, removeItem: () => { stored = null } }
  const currentPointer = { ...pointer, generation: 1 }
  const response = { applied: true, action_history_id: 88, operation_id: '72', generation: 1, current_generation: 1,
    item: { id: 88, undo_payload: currentPointer, redo_payload: currentPointer } }
  const current = (_scope: unknown, invalidation = true) => currentActor && (!invalidation || revision === 0)
  const run = closure('runServerEntry', {
    busy: '', actorScope: 'actor7', actorScopeRef: actorRef, readScope: {}, setBusy() {}, notify() {}, refreshServerItems() {},
    serverItemsAuthority: {}, setServerItemsAuthority() {}, captureActorReadScope: () => ({}),
    serverItems: [{ id: 88, undo_payload: pointer, redo_payload: pointer }], setServerItems() {},
    navigator: { onLine: true }, window: { sessionStorage: storage }, productEditStorageKey: () => 'replay',
    executeProductEditReplay, buildServerReplayRequest: build, isActorReadScopeCurrent: current,
    assertActorReadScope: (scope: unknown, invalidation = true) => { if (!current(scope, invalidation)) throw new Error('stale actor or revision') },
    localizeProductEditError: async (error: unknown) => error, getErrorMessage: String,
    loadActionHistoryTransport: async () => ({ undoActionHistory: async () => {
      sent++
      if (change === 'actor') currentActor = false
      else if (change === 'permission') actorRef.current = 'actor7:revoked'
      else revision++
      return response
    } }),
  })
  assert.equal(await run('undo', 88), change === 'invalidation', 'normal write invalidation must not become a failed replay; actor switches must remain fenced')
  assert.equal(stored === null, change === 'invalidation' || change === 'stale')
  assert.equal(sent, change === 'stale' ? 0 : 1)
}
console.log('PASS actual server replay accepts own invalidation; actor, permission and stale pre-dispatch controls remain fenced')

function dependencyHooks() {
  const slots: any[] = []
  let cursor = 0
  let effects: Array<() => void> = []
  const same = (left: unknown[] | undefined, right: unknown[] | undefined) => !!left && !!right
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  const memo = (factory: () => unknown, dependencies?: unknown[]) => {
    const index = cursor++
    if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: factory(), dependencies }
    return slots[index].value
  }
  return {
    begin() { cursor = 0 },
    commit() { const pending = effects; effects = []; pending.forEach(effect => effect()) },
    useState(initial: any) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (value: any) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }]
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ||= { current: initial } },
    useMemo: memo,
    useCallback(fn: unknown, dependencies: unknown[]) { return memo(() => fn, dependencies) },
    useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        const cleanup = slots[index]?.cleanup
        slots[index] = { dependencies }
        effects.push(() => { cleanup?.(); slots[index].cleanup = effect() })
      }
    },
  }
}

function mapStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, String(value)) }, removeItem: (key: string) => { values.delete(key) } }
}

const hookWindow = {
  localStorage: mapStorage(), sessionStorage: mapStorage(), location: { origin: 'https://product.test' },
  addEventListener() {}, setTimeout: () => 1, clearTimeout() {},
}
hookWindow.sessionStorage.setItem('businessos_user', JSON.stringify({ id: 7 }))
const hookModules: Record<string, any> = {
  './httpState.ts': { getSyncServerUrl: () => 'https://worker.test' },
  './unresolvedSignout.ts': { isSignoutBlocked: () => false },
}
function loadHookModule(relative: string) {
  const original = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const javascript = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(javascript, { exports, require: (name: string) => {
    assert.ok(name in hookModules, `missing actual hook dependency ${name}`)
    return hookModules[name]
  }, window: hookWindow, navigator: { onLine: true }, console, Date, Math, globalThis: { crypto: { randomUUID: () => 'hook-runtime' } } })
  return exports
}
const actualReadScope = loadHookModule('../src/api/actorReadScope.ts')
const hooks = dependencyHooks()
let hookRows: Array<Record<string, unknown>> = [{ id: 88, status: 'undoable', undo_payload: pointer, redo_payload: pointer }]
let hookSends = 0
const sentHookBodies: unknown[] = []
const hookTransport = {
  getActionHistory: async () => ({ items: hookRows }),
  getActionHistoryUsers: async () => [],
  undoActionHistory: async (_id: unknown, body: { expected_generation: number }) => hookReply(body, 'redoable'),
  redoActionHistory: async (_id: unknown, body: { expected_generation: number }) => hookReply(body, 'undoable'),
}
function hookReply(body: { expected_generation: number }, status: string) {
  hookSends++
  sentHookBodies.push(body)
  actualReadScope.invalidateActorReadChannel('actionHistory')
  const generation = body.expected_generation + 1
  const latestPointer = { ...pointer, generation }
  const item = { id: 88, status, undo_payload: latestPointer, redo_payload: latestPointer }
  hookRows = [item]
  return { applied: true, action_history_id: 88, operation_id: '72', generation, current_generation: generation, item }
}
Object.assign(hookModules, {
  react: hooks,
  '../api/actorReadScope.ts': actualReadScope,
  './productEditRequests.ts': { executeProductEditReplay, productEditHistoryReceipt, productEditStorageKey: () => 'hook-replay', localizeProductEditError: async (error: unknown) => error },
  './workDrafts.ts': { scopedWorkDraftKey: (key: string) => key },
  './permissions.ts': { effectivePermissions: (user: unknown) => user },
  './loaders': {
    beginTrackedRequest: (ref: { current: number }) => ++ref.current,
    invalidateTrackedRequest: (ref: { current: number }) => ++ref.current,
    isTrackedRequestCurrent: (ref: { current: number }, id: number) => ref.current === id,
    withLoaderTimeout: (task: () => unknown) => Promise.resolve().then(task),
  },
  '../api/actionHistoryTransport.ts': hookTransport,
})
const actualHistory = loadHookModule('../src/utils/actionHistory.ts')
const hookUser = { id: 7, isAdmin: false, products_edit: true }
const hookNotify = () => {}
const renderHistory = () => { hooks.begin(); const view = actualHistory.useActionHistory({ scope: 'products', user: hookUser, notify: hookNotify }); hooks.commit(); return view }
let hookView = renderHistory()
await hookView.refreshServerItems()
hookView = renderHistory()
assert.equal(hookView.serverItems.length, 1)
const earlierUndo = hookView.undoServer
actualReadScope.invalidateActorReadChannel('actionHistory')
hookView = renderHistory()
assert.equal(hookView.serverItems.length, 0, 'an unrelated invalidation must hide previously fetched rows even when every memo input except read revision is unchanged')
await hookView.refreshServerItems()
hookView = renderHistory()
assert.equal(hookView.serverItems.length, 1, 'refresh may return the same rows array and must still restore current visibility')
assert.equal(await earlierUndo(88), false, 'a callback held across invalidation remains stale')
assert.equal(hookSends, 0)
assert.equal(await hookView.undoServer(88), true, 'a fresh UI callback must use the refreshed read revision')
await new Promise(resolve => setImmediate(resolve))
hookView = renderHistory()
assert.equal(hookView.serverItems[0].status, 'redoable')
assert.equal(await hookView.redoServer(88), true)
assert.deepEqual(JSON.parse(JSON.stringify(sentHookBodies)), [{ require_applied: true, expected_generation: 0 }, { require_applied: true, expected_generation: 1 }])
assert.equal(hookWindow.sessionStorage.getItem('hook-replay'), null)
console.log('PASS dependency-aware actual History hook hides invalidated rows, refreshes unchanged arrays and replays both directions with fresh authority')
