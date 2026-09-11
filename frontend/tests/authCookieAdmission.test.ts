import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const data = new Map<string, string>()
let onPendingWrite: (() => void) | undefined
const store = {
  get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null,
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { if (key === 'businessos_auth_cookie_pending') onPendingWrite?.(); data.set(key, value) },
  removeItem: (key: string) => data.delete(key),
}
let queue = Promise.resolve()
const locks = { request: (_name: string, options: { mode: string }, action: () => unknown) => {
  assert.equal(options.mode, 'exclusive')
  const result = queue.then(action)
  queue = result.then(() => undefined, () => undefined)
  return result
} }
const events = new EventTarget()
const browser: any = { localStorage: store, sessionStorage: { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {} }, navigator: { locks }, location: { origin: 'https://admission.test' },
  addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) }
Object.assign(globalThis, { window: browser })
const a = await import('../src/api/actorReadScope.ts')
const secondModule = '../src/api/actorReadScope.ts?second-tab'
const b = await import(secondModule)
let second!: Promise<string>
onPendingWrite = () => { onPendingWrite = undefined; second = b.beginActorCookieMutation(); second.catch(() => {}) }
const first = await a.beginActorCookieMutation()
await assert.rejects(second, (e: any) => e.outcome === 'not_dispatched')
assert.equal(data.get('businessos_auth_cookie_pending'), first)
// A generic reset's late generation write cannot overwrite the separate phase.
data.set('businessos_read_session', 'late-generic-reset')
assert.equal(b.isActorCookieMutationPending(), true)
assert.equal(b.completeActorSessionReconciliation(b.actorSessionReconciliationMarker()), false)
assert.equal(a.finishActorCookieMutation(first), true)
assert.equal(a.isActorCookieMutationPending(), false)
b.completeActorSessionReconciliation(b.actorSessionReconciliationMarker())
a.completeActorSessionReconciliation(a.actorSessionReconciliationMarker())
let phaseNotifications = 0
const unsubscribe = b.subscribeActorSessionQuarantine(() => { phaseNotifications++ })
data.set('businessos_auth_cookie_pending', 'auth-pending:phase-event-only')
const phaseEvent = new Event('storage')
Object.defineProperty(phaseEvent, 'key', { value: 'businessos_auth_cookie_pending' })
events.dispatchEvent(phaseEvent)
assert.ok(phaseNotifications > 0, 'phase storage event quarantines subscribers before a generation event arrives')
assert.equal(b.completeActorSessionReconciliation(b.actorSessionReconciliationMarker()), false)
assert.equal(a.finishActorCookieMutation('auth-pending:phase-event-only'), true)
unsubscribe()
b.completeActorSessionReconciliation(b.actorSessionReconciliationMarker())
a.completeActorSessionReconciliation(a.actorSessionReconciliationMarker())
browser.navigator = {}
await assert.rejects(a.beginActorCookieMutation(), (e: any) => e.code === 'auth_lock_unavailable' && e.outcome === 'not_dispatched')
assert.equal(a.isActorCookieMutationPending(), false)
browser.navigator = { locks }

// Execute actual runtime reset with only its DB import replaced by controlled
// deferred I/O. Coordination keys remain live, not stale-restored snapshots.
const source = readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const prepared = source.replace("await import('../../api/localDb.ts')", 'await globalThis.qaRuntimeDb()')
  .replaceAll("await import('../../api/localDb.ts')", 'await globalThis.qaRuntimeDb()')
const code = ts.transpileModule(prepared, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
let release!: () => void
const delayed = new Promise<void>((resolve) => { release = resolve })
Object.assign(globalThis, { qaRuntimeDb: async () => ({ clearLocalMirrorTables: () => delayed }) })
const exports: any = {}
new Function('exports', 'require', code)(exports, (id: string) => {
  assert.equal(id, '../../constants.ts')
  return { STORAGE_KEYS: {} }
})
data.set('businessos_read_session', 'before-reset')
data.set('businessos_auth_cookie_pending', 'auth-pending:before-reset')
const resetting = exports.resetClientRuntimeState({ preserveServiceWorker: true, mirrorTables: [] })
await Promise.resolve()
assert.equal(data.get('businessos_auth_cookie_pending'), 'auth-pending:before-reset', 'reset never removes the live fence, including before DB cleanup finishes')
data.set('businessos_read_session', 'newer-completed-session')
data.delete('businessos_auth_cookie_pending')
release()
await resetting
assert.equal(data.get('businessos_read_session'), 'newer-completed-session')
assert.equal(data.has('businessos_auth_cookie_pending'), false, 'async reset cannot resurrect completed pending owner')
delete (globalThis as any).qaRuntimeDb
console.log('PASS atomic admission interleaving, unsupported fail-closed, independent pending phase and actual async runtime preservation')
