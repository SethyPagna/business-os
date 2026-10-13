import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type * as AttemptModule from '../src/utils/receivingProductAttempt.ts'
import type * as ScopeModule from '../src/api/actorReadScope.ts'
import type * as HttpStateModule from '../src/api/httpState.ts'

// F3: a receiving product-attempt record belongs to who signs the write -- the
// server, origin, account and organization -- and to the device's owner
// generation, not to the read-session marker. A same-user reset keeps it: a held,
// never-sent product stays sendable and a confirmed one stays confirmed. Another
// account, organization or server, or A -> B -> A, refuses it.
//
// Every "tab" is a fresh graph of the production modules over one shared
// localStorage, so a reload and a second tab are real, and the reset is the real
// runtime reset that the app's permission refresh and session expiry run.

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const js = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const mirrorResets: string[] = []
const localDb = {
  async resetLocalMirrorDbPreservingOfflineWork() { mirrorResets.push('preserve') },
  async resetLocalMirrorDb() { mirrorResets.push('reset') },
  async clearLocalMirrorTables() { mirrorResets.push('scoped') },
}
type Tab = {
  attempts: typeof AttemptModule
  scope: typeof ScopeModule
  http: typeof HttpStateModule
  runtime: { resetClientRuntimeState(options: Record<string, unknown>): Promise<void> }
}
function openTab(): Tab {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const load = (file: string): Record<string, unknown> => {
    const hit = cache.get(file)
    if (hit) return hit.exports
    const mod = { exports: {} as Record<string, unknown> }
    cache.set(file, mod)
    new Function('require', 'module', 'exports', js(readFileSync(file, 'utf8')))((name: string) => {
      const target = resolve(dirname(file), name)
      if (target === resolve(src, 'api/localDb.ts')) return localDb
      assert(name.startsWith('.') && target.startsWith(src), `unexpected dependency ${name}`)
      return load(target)
    }, mod, mod.exports)
    return mod.exports
  }
  return {
    attempts: load(resolve(src, 'utils/receivingProductAttempt.ts')) as unknown as Tab['attempts'],
    scope: load(resolve(src, 'api/actorReadScope.ts')) as unknown as Tab['scope'],
    http: load(resolve(src, 'api/httpState.ts')) as unknown as Tab['http'],
    runtime: load(resolve(src, 'platform/runtime/clientRuntime.ts')) as unknown as Tab['runtime'],
  }
}

class MemoryStorage {
  data = new Map<string, string>()
  get length() { return this.data.size }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
  clear() { this.data.clear() }
}
const local = new MemoryStorage()
const session = new MemoryStorage()
const tails = new Map<string, Promise<unknown>>()
const locks = { request: <T>(name: string, _options: unknown, action: () => T): Promise<T> => {
  const next = (tails.get(name) || Promise.resolve()).catch(() => {}).then(action)
  tails.set(name, next)
  return next
} }
const ORIGIN = 'https://business.test'
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: local, sessionStorage: session, location: { origin: ORIGIN },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
} })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })

const USER = 'businessos_user'
const MARKER = 'businessos_read_session'
const PREFIX = 'businessos_receiving_product_attempt_v1:'
let logins = 0, serial = 0
const nextId = () => `owner-binding-${++serial}`
const account = (id: number, organization = 3) => JSON.stringify({ id, organization_id: organization, name: `Staff ${id}` })
// A sign-in writes the account and settles a new session marker (actorReadScope's cookie phase).
const signIn = (id: number, organization = 3) => { local.setItem(USER, account(id, organization)); local.setItem(MARKER, `login-${++logins}`) }
const body = (id: string, actor = 7) => ({ name: 'New', client_request_id: id, userId: actor, userName: 'Staff', branch_id: '1', stock_quantity: 0 })
const noop = () => {}
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected
const keyFor = (id: string, server = ORIGIN) => PREFIX + encodeURIComponent(JSON.stringify([ORIGIN, server, id]))
const reconcile = (tab: Tab) => {
  // Another tab's sign-in or reset locks this one until the app confirms the owner (App.tsx reconciliation).
  if (tab.scope.isActorSessionQuarantined()) assert.equal(tab.scope.completeActorSessionReconciliation(tab.scope.actorSessionReconciliationMarker()), true)
}
// AppContext.clearLocalBusinessState -> resetLocalBusinessState, with the exact
// options the permission refresh passes, then the bootstrap writing the same
// account back (resetLocalBusinessState never forwards clearAuth, so the stored
// account is cleared by the reset and restored by applyBootstrapPayload).
async function permissionRefresh(tab: Tab, id = 7) {
  tab.scope.resetActorReadSession()
  await tab.runtime.resetClientRuntimeState({
    preserveDeviceSettings: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: false,
    preserveOrganization: false, preserveOfflineWork: true, preserveServiceWorker: true, preserveUiDrafts: true,
  })
  local.setItem(USER, account(id))
}
// handleUnauthorizedSession: the session expired; the account is signed out with drafts kept.
async function sessionExpiry(tab: Tab) {
  tab.scope.resetActorReadSession()
  await tab.runtime.resetClientRuntimeState({
    preserveDeviceSettings: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: true,
    preserveOrganization: false, preserveOfflineWork: true, preserveServiceWorker: true, preserveUiDrafts: true,
  })
  local.removeItem(USER)
}
const state = (tab: Tab, id: string, actor = 7) => tab.attempts.readReceivingProductAttempt(actor, id)?.state

// ---------------------------------------------------------------------------
// 1. A real owner change still refuses (green before and after F3)
// ---------------------------------------------------------------------------
{
  signIn(7)
  const tab = openTab()
  const held = nextId()
  await tab.attempts.registerReceivingProductAttempt(7, held)
  const saved = local.getItem(keyFor(held))
  signIn(8); reconcile(tab)
  assert.throws(() => tab.attempts.readReceivingProductAttempt(8, held), code('product_create_outcome_unknown'), 'another account cannot read it')
  assert.throws(() => tab.attempts.readReceivingProductAttempt(7, held), code('receiving_submission_locked'), 'nor act as the account that held it')
  await assert.rejects(tab.attempts.reserveReceivingProductAttempt(8, held, body(held, 8), noop))
  signIn(7, 4); reconcile(tab)
  await assert.rejects(tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop), 'another organization refuses')
  signIn(7); reconcile(tab)
  await assert.rejects(tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop), code('product_create_outcome_unknown'), 'A -> B -> A in this tab refuses')
  assert.equal(local.getItem(keyFor(held)), saved, 'refusal keeps the evidence byte for byte')
  console.log('PASS another account or organization, and A -> B -> A in the same tab, refuse without clearing the record')
}
{
  signIn(7)
  const holder = openTab()
  const held = nextId()
  await holder.attempts.registerReceivingProductAttempt(7, held)
  // A second tab signs B in and A back; the holding tab never sees B.
  const other = openTab()
  signIn(8); other.scope.captureActorWriteIdentity()
  signIn(7); other.scope.captureActorWriteIdentity()
  reconcile(holder)
  await assert.rejects(holder.attempts.reserveReceivingProductAttempt(7, held, body(held), noop), code('product_create_outcome_unknown'), 'A -> B -> A in another tab refuses')
  // Across reloads: a fresh tab sees B, a later fresh tab sees A again.
  const reloaded = nextId()
  await openTab().attempts.registerReceivingProductAttempt(7, reloaded)
  signIn(8); openTab().scope.captureActorWriteIdentity()
  signIn(7)
  await assert.rejects(openTab().attempts.reserveReceivingProductAttempt(7, reloaded, body(reloaded), noop), code('product_create_outcome_unknown'), 'A -> B -> A across reloads refuses')
  console.log('PASS A -> B -> A refuses when another tab or a reload saw B, not only this tab')
}

// ---------------------------------------------------------------------------
// 2. A same-user reset keeps the record (RED on 90f92dab1)
// ---------------------------------------------------------------------------
{
  signIn(7)
  const tab = openTab()
  const held = nextId(), done = nextId()
  await tab.attempts.registerReceivingProductAttempt(7, held)
  await tab.attempts.registerReceivingProductAttempt(7, done)
  const ticket = await tab.attempts.reserveReceivingProductAttempt(7, done, body(done), noop)
  await tab.attempts.finishReceivingProductAttempt(ticket, 'confirmed', 81)
  await permissionRefresh(tab)
  assert.equal(state(tab, held), 'prepared', 'a held, never-sent product survives a same-user permission refresh')
  assert.equal(state(tab, done), 'confirmed', 'a confirmed product stays confirmed')
  assert.equal(tab.attempts.readReceivingProductAttempt(7, done)?.productId, 81)
  const outcomes = { products: {}, productOutcomes: {} as Record<string, string>, unknown: [] as string[] }
  tab.attempts.overlayReceivingProductAttempts(7, outcomes as never, [{ key: held, createRequestId: held, createPayload: { name: 'New' }, product: { id: '' } }] as never)
  assert.equal(outcomes.productOutcomes[held], 'not_sent')
  assert.deepEqual(outcomes.unknown, [])
  const sent = await tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop)
  assert.equal(sent.state, 'attempting', 'and it is still sendable')
  console.log('PASS same-user permission refresh in this tab: held stays sendable, confirmed stays confirmed')
}
{
  signIn(7)
  const holder = openTab()
  const held = nextId()
  await holder.attempts.registerReceivingProductAttempt(7, held)
  await permissionRefresh(openTab())
  assert.throws(() => holder.attempts.readReceivingProductAttempt(7, held), code('actor_session_quarantined'), 'locked while the other tab\'s reset is checked')
  reconcile(holder)
  assert.equal((await holder.attempts.reserveReceivingProductAttempt(7, held, body(held), noop)).state, 'attempting')
  console.log('PASS same-user reset in another tab: once the same owner is confirmed the held product is sendable')
}
{
  signIn(7)
  const tab = openTab()
  const held = nextId()
  await tab.attempts.registerReceivingProductAttempt(7, held)
  await sessionExpiry(tab)
  signIn(7)
  const reloaded = openTab()
  assert.equal((await reloaded.attempts.reserveReceivingProductAttempt(7, held, body(held), noop)).state, 'attempting')
  console.log('PASS session expiry, reload and the same account signing back in keep the held product sendable')
}
{
  signIn(7)
  const tab = openTab()
  const held = nextId()
  await tab.attempts.registerReceivingProductAttempt(7, held)
  let release!: () => void
  const holding = locks.request(keyFor(held), {}, () => new Promise<void>(resolve => { release = resolve }))
  await Promise.resolve()
  const waiting = tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop)
  await permissionRefresh(tab)
  release()
  await holding
  assert.equal((await waiting).state, 'attempting', 'a reset while the reservation waited for the lock does not refuse it')
  console.log('PASS a same-user reset during the lock wait keeps the reservation')
}

// ---------------------------------------------------------------------------
// 3. Each part of the binding refuses on its own
// ---------------------------------------------------------------------------
{
  signIn(7)
  const tab = openTab()
  const held = nextId()
  await tab.attempts.registerReceivingProductAttempt(7, held)
  const raw = local.getItem(keyFor(held))!
  const saved = JSON.parse(raw) as Record<string, unknown>
  assert.equal(typeof saved.generation, 'number', 'the record carries the owner generation')
  assert.equal('session' in saved, false, 'and no read-session marker')
  // Same generation, one field different: what a same-generation race between two
  // tabs could leave behind. Each comparison must refuse alone.
  for (const [field, value] of [['actor', 8], ['organization', 4], ['server', 'https://other.test'], ['origin', 'https://other.test'], ['generation', Number(saved.generation) - 1]] as const) {
    local.setItem(keyFor(held), JSON.stringify({ ...saved, [field]: value }))
    assert.throws(() => tab.attempts.readReceivingProductAttempt(7, held), code('product_create_outcome_unknown'), field)
  }
  local.setItem(keyFor(held), raw)
  assert.equal(state(tab, held), 'prepared')
  // Another server: its records are not this server's, and X -> Y -> X refuses like A -> B -> A.
  tab.http.setSyncServerUrl('https://other.test')
  await assert.rejects(tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop))
  tab.http.setSyncServerUrl('')
  await assert.rejects(tab.attempts.reserveReceivingProductAttempt(7, held, body(held), noop), code('product_create_outcome_unknown'), 'server X -> Y -> X refuses')
  assert.equal(local.getItem(keyFor(held)), raw)
  console.log('PASS account, organization, server, origin and generation each refuse alone; server X -> Y -> X refuses')
}

// ---------------------------------------------------------------------------
// 4. Records written before F3 (version 1, bound to the read-session marker)
// ---------------------------------------------------------------------------
{
  signIn(7)
  const tab = openTab()
  const legacy = (id: string, patch: Record<string, unknown> = {}) => {
    const record = { actor: 7, organization: 3, origin: ORIGIN, server: ORIGIN, session: local.getItem(MARKER), requestId: id,
      version: 1, state: 'prepared', owner: null, bodyJson: null, productId: null, ...patch }
    local.setItem(keyFor(id), JSON.stringify(record))
    return local.getItem(keyFor(id))!
  }
  // Accepted only under the rule it was written under: same account, organization,
  // origin and server, and its marker still the current one (no sign-in or reset since).
  const current = nextId()
  legacy(current)
  assert.equal(state(tab, current), 'prepared')
  assert.equal((await tab.attempts.reserveReceivingProductAttempt(7, current, body(current), noop)).state, 'attempting')
  const upgraded = JSON.parse(local.getItem(keyFor(current))!)
  assert.equal(upgraded.version, 2, 'its next write stores the new binding')
  assert.equal('session' in upgraded, false)
  assert.equal(typeof upgraded.generation, 'number')
  // Anything else needs re-confirmation: it reads as unknown and is never sent.
  for (const [name, patch] of [
    ['an earlier marker', { session: 'login-before-a-reset' }],
    ['another account', { actor: 8 }],
    ['another organization', { organization: 4 }],
    ['another server', { server: 'https://other.test' }],
  ] as const) {
    const id = nextId()
    const raw = legacy(id, patch)
    assert.throws(() => tab.attempts.readReceivingProductAttempt(7, id), code('product_create_outcome_unknown'), name)
    await assert.rejects(tab.attempts.reserveReceivingProductAttempt(7, id, body(id), noop), code('product_create_outcome_unknown'), name)
    const outcomes = { products: {}, productOutcomes: {} as Record<string, string>, unknown: [] as string[] }
    tab.attempts.overlayReceivingProductAttempts(7, outcomes as never, [{ key: id, createRequestId: id, createPayload: { name: 'New' }, product: { id: '' } }] as never)
    assert.equal(outcomes.productOutcomes[id], 'unknown', name)
    assert.equal(local.getItem(keyFor(id)), raw, `${name}: the old record is kept as evidence`)
  }
  console.log('PASS legacy records: accepted only under their own marker and owner, then upgraded; otherwise unknown and never sent')
}
assert(mirrorResets.length >= 4 && mirrorResets.every(call => call === 'preserve'), 'the real runtime reset ran, keeping offline work')
