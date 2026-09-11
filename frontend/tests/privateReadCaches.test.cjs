const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function storage() { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k,v) => rows.set(k,String(v)), removeItem: k => rows.delete(k) } }
const window = { localStorage: storage(), sessionStorage: storage(), location: { origin: 'https://app.test' }, addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {} }
let server = 'https://one.test'
let hooks, scope, supplierReply, shiftReply, historyReply, usersReply = async () => []
function harness() {
  const values = []; let cursor = 0; let effects = []
  return {
    reset() { cursor = 0; effects = [] }, effects() { const pending = effects; effects = []; pending.forEach(fn => fn()) },
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next }] },
    useRef(initial) { const i = cursor++; return values[i] ||= { current: initial } },
    useCallback(fn) { return fn }, useMemo(fn) { return fn() }, useEffect(fn) { effects.push(fn) },
  }
}
function load(relative, extra = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  const requireMock = name => {
    if (extra[name]) return extra[name]
    if (name === 'react') return hooks
    if (name.includes('actorReadScope')) return scope
    if (name.includes('httpState')) return { getSyncServerUrl: () => server }
    if (name.includes('contactsTransport')) return { getSuppliers: () => supplierReply() }
    if (name.includes('shiftTransport')) return { fetchCurrentShift: () => shiftReply() }
    if (name.includes('actionHistoryTransport')) return { getActionHistory: () => historyReply(), getActionHistoryUsers: () => usersReply() }
    if (name.includes('workDrafts')) return { scopedWorkDraftKey: value => value }
    if (name.includes('permissions')) return { effectivePermissions: user => ({ isAdmin: user?.role === 'admin' }) }
    if (name.includes('loaders')) return { beginTrackedRequest: ref => ++ref.current, invalidateTrackedRequest: ref => ++ref.current, isTrackedRequestCurrent: (ref,id) => ref.current === id, withLoaderTimeout: task => task() }
    return {}
  }
  vm.runInNewContext(js, { exports, require: requireMock, window, globalThis: { crypto: { randomUUID: () => 'opaque-runtime' } }, Date, Math, console, navigator: { onLine: true } }, { filename: relative })
  return exports
}
function actor(name) { window.sessionStorage.setItem('businessos_user', name); scope.resetActorReadSession() }
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setImmediate(resolve))
async function main() {
  hooks = harness(); scope = load('src/api/actorReadScope.ts')
  const suppliers = load('src/components/shared/SupplierPickerField.tsx')
  actor('admin'); supplierReply = async () => [{ id: 1, name: 'admin private' }]
  assert.equal((await suppliers.loadSupplierNames())[0].name, 'admin private')
  actor('employee'); supplierReply = async () => [{ id: 2, name: 'employee' }]
  assert.equal((await suppliers.loadSupplierNames())[0].name, 'employee')
  actor('admin'); supplierReply = async () => [{ id: 3, name: 'admin fresh' }]
  assert.equal((await suppliers.loadSupplierNames())[0].name, 'admin fresh')
  scope.resetActorReadSession(); const pending = deferred(); supplierReply = () => pending.promise
  const old = suppliers.loadSupplierNames(); await tick(); server = 'https://two.test'; pending.resolve([{ id: 4, name: 'late' }]); await assert.rejects(old, { code: 'stale_read_scope' })
  supplierReply = async () => { throw Object.assign(new Error('denied'), { status: 403 }) }
  await assert.rejects(suppliers.loadSupplierNames(), { status: 403 })
  const shifts = load('src/components/pos/ShiftGate.tsx')
  const oldKey = shifts.shiftCacheKey(1, 2, 'per_account'); scope.resetActorReadSession()
  assert.notEqual(oldKey, shifts.shiftCacheKey(1, 2, 'per_account'))
  const serverKey = shifts.shiftCacheKey(1, 2, 'per_account'); server = 'https://three.test'
  assert.notEqual(serverKey, shifts.shiftCacheKey(1, 2, 'per_account'))
  actor('admin'); const adminKey = shifts.shiftCacheKey(1, 2, 'per_account'); actor('employee')
  assert.notEqual(adminKey, shifts.shiftCacheKey(1, 2, 'per_account')); actor('admin')
  assert.notEqual(adminKey, shifts.shiftCacheKey(1, 2, 'per_account'))
  shifts.publishShift(oldKey, { secret: 'old' })
  hooks = harness(); hooks.reset(); shiftReply = async () => ({ secret: 'new' })
  assert.equal(shifts.useSharedShift(1, 1, 'per_account').state, null)
  const lateShift = deferred(); shiftReply = () => lateShift.promise
  hooks.reset(); const shiftView = shifts.useSharedShift(2, 1, 'per_account'); const shiftLoad = shiftView.refresh()
  actor('employee'); lateShift.resolve({ secret: 'admin' }); await shiftLoad
  hooks = harness(); hooks.reset(); assert.equal(shifts.useSharedShift(2, 1, 'per_account').state, null)
  const history = load('src/utils/actionHistory.ts')
  actor('admin'); const a = scope.captureActorReadScope('actionHistory')
  history.writeCachedServerItems('global', [{ id: 'private' }], a)
  assert.equal(history.readCachedServerItems('global', a)[0].id, 'private')
  const cacheKey = scope.actorReadStorageKey('actionHistory:cache:global', a)
  window.sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now() - 60_001, items: [{ id: 'expired' }] }))
  assert.equal(history.readCachedServerItems('global', a).length, 0)
  actor('employee'); const b = scope.captureActorReadScope('actionHistory')
  assert.equal(history.readCachedServerItems('global', b).length, 0)
  history.writeCachedServerItems('global', [{ id: 'late' }], a)
  assert.equal(history.readCachedServerItems('global', b).length, 0)
  actor('admin'); assert.equal(history.readCachedServerItems('global', scope.captureActorReadScope('actionHistory')).length, 0)
  window.sessionStorage.setItem('actionHistory:cache:global', JSON.stringify([{ id: 'legacy secret' }]))
  assert.equal(history.readCachedServerItems('global', scope.captureActorReadScope('actionHistory')).length, 0)
  hooks = harness(); const user = { role: 'admin' }; const render = () => { hooks.reset(); return history.useActionHistory({ user }) }
  let view = render(); historyReply = async () => ({ items: [{ id: 'current' }] }); await view.refreshServerItems(); view = render(); assert.equal(view.serverItems[0].id, 'current')
  historyReply = async () => { throw Object.assign(new Error('denied'), { status: 403 }) }; await view.refreshServerItems(); view = render(); assert.equal(view.serverItems.length, 0)
  historyReply = async () => ({ items: [{ id: 'current again' }] }); await view.refreshServerItems(); view = render()
  historyReply = async () => { throw Object.assign(new Error('expired login'), { status: 401 }) }; await view.refreshServerItems(); view = render(); assert.equal(view.serverItems.length, 0)
  const pendingHistory = deferred(); historyReply = () => pendingHistory.promise; const historyLoad = view.refreshServerItems(); await tick(); actor('employee'); pendingHistory.resolve({ items: [{ id: 'late admin' }] }); await historyLoad; view = render(); assert.equal(view.serverItems.length, 0)
  const tasks = []; window.setTimeout = fn => { tasks.push(fn); return tasks.length }
  actor('admin'); hooks = harness(); hooks.reset(); history.useActionHistory({ user }); hooks.effects()
  const lateUsers = deferred(); usersReply = () => lateUsers.promise; historyReply = async () => ({ items: [] })
  tasks.splice(0).forEach(task => task()); await tick(); actor('employee'); lateUsers.resolve([{ id: 'admin directory secret' }]); await tick()
  hooks.reset(); assert.equal(history.useActionHistory({ user: { role: 'employee' } }).userOptions.length, 0)
  console.log('private read caches: executable supplier, shift, and history isolation/late-response/denial checks passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
