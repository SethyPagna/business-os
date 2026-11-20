// The sign-in marker (localStorage 'business-os:portal-signed-in') lets every tab keep Google's translate script off without asking the
// Worker. This runs the real usePortalAccount hook against a fake storage and a fake Worker API:
//   - who sets and clears the marker (compare-and-clear, never a blind clear);
//   - the writing tab updates its own state (it gets no storage event);
//   - a failed first check never reads as "signed out"; a 428 is a live session;
//   - storage / pageshow / visibilitychange / resume only re-read the marker: zero requests.
//
// Run: node tests/portalSignedInMarker.test.ts
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as options from '../src/components/catalog/portalLanguageOptions.ts'
import * as account from '../src/components/catalog/portalAccount.ts'

const failures: string[] = []
const check = async (name: string, run: () => void | Promise<void>) => {
  try { await run() } catch (error) { failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`) }
}

class MemoryNode {
  nodeType: number; nodeName: string; tagName: string; ownerDocument: unknown
  namespaceURI = 'http://www.w3.org/1999/xhtml'; parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []; style = {}; nodeValue = ''
  constructor(type: number, name: string, doc: unknown) { this.nodeType = type; this.nodeName = name; this.tagName = name; this.ownerDocument = doc }
  appendChild(child: MemoryNode) { child.parentNode = this; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode) { child.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, child); return child }
  removeChild(child: MemoryNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child }
  addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {}
  get firstChild() { return this.childNodes[0] || null }
  set textContent(_text: string) { this.childNodes = [] }
}
const docEvents = new EventTarget()
const doc: Record<string, unknown> = { nodeType: 9, visibilityState: 'visible', addEventListener: docEvents.addEventListener.bind(docEvents), removeEventListener: docEvents.removeEventListener.bind(docEvents), dispatchEvent: docEvents.dispatchEvent.bind(docEvents) }
doc.createElement = (name: string) => new MemoryNode(1, name.toUpperCase(), doc)
doc.createElementNS = (_ns: string, name: string) => (doc.createElement as (n: string) => MemoryNode)(name)
doc.createTextNode = (text: string) => { const node = new MemoryNode(3, '#text', doc); node.nodeValue = text; return node }
doc.documentElement = (doc.createElement as (n: string) => MemoryNode)('html')
doc.body = (doc.createElement as (n: string) => MemoryNode)('body')
doc.activeElement = doc.body
const winEvents = new EventTarget()
const win: Record<string, unknown> = {
  document: doc, HTMLElement: MemoryNode, HTMLIFrameElement: class {}, location: { pathname: '/', hash: '', search: '' },
  addEventListener: winEvents.addEventListener.bind(winEvents), removeEventListener: winEvents.removeEventListener.bind(winEvents), dispatchEvent: winEvents.dispatchEvent.bind(winEvents),
}
doc.defaultView = win
Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

const KEY = options.PORTAL_SIGNED_IN_KEY
let store = new Map<string, string>()
const useStore = (initial: Record<string, string> = {}) => {
  store = new Map(Object.entries(initial))
  win.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } }
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const refusal = (status: number, code = '') => Object.assign(new Error('refused'), { status, code })
const profile = { account: { membershipId: 'M1', name: 'Sok', email: null } }

type Hook = ReturnType<typeof account.usePortalAccount>
let latest!: Hook
const renders: Array<{ marker: string; sessionKnown: boolean }> = []
const lists = { items: [], setAll() {} }
function Probe() {
  latest = account.usePortalAccount(lists, lists, (_key: string, fallback?: string) => fallback ?? '')
  renders.push({ marker: latest.marker, sessionKnown: latest.sessionKnown })
  return null
}
async function mount(api: Record<string, unknown>) {
  renders.length = 0
  win.api = api
  const root = createRoot((doc.createElement as (n: string) => MemoryNode)('div') as unknown as Element)
  await act(async () => root.render(React.createElement(Probe)))
  return { unmount: () => act(async () => root.unmount()) }
}
const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key })

await check('the helpers: absent, present, unreadable; every write is a new value; compare-and-clear', () => {
  useStore()
  assert.equal(options.readPortalSignedIn(), 'absent')
  const first = options.markPortalSignedIn()
  const second = options.markPortalSignedIn()
  assert.equal(options.readPortalSignedIn(), 'present')
  assert.notEqual(first, second, 'two writes in the same millisecond still differ, so other tabs always get an event')
  options.clearPortalSignedIn(first)
  assert.equal(options.readPortalSignedIn(), 'present', 'an older value does not clear a newer write')
  options.clearPortalSignedIn(second)
  assert.equal(options.readPortalSignedIn(), 'absent')
  options.markPortalSignedIn()
  options.clearPortalSignedIn()
  assert.equal(options.readPortalSignedIn(), 'absent', 'a plain clear always clears')
  win.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(options.readPortalSignedIn(), 'unreadable')
  assert.equal(options.readPortalSignedInValue(), null)
  assert.equal(options.markPortalSignedIn(), '')
  assert.doesNotThrow(() => options.clearPortalSignedIn())
  win.localStorage = undefined
  assert.equal(options.readPortalSignedIn(), 'unreadable', 'no localStorage at all')
})

await check('the first render already knows the marker', async () => {
  useStore({ [KEY]: '1' })
  const view = await mount({ getPortalAccountMe: () => new Promise(() => {}) })
  assert.equal(renders[0].marker, 'present')
  assert.equal(renders[0].sessionKnown, false)
  await view.unmount()
})

await check('a session found on load sets the marker', async () => {
  useStore()
  const view = await mount({ getPortalAccountMe: async () => profile })
  assert.equal(latest.sessionKnown, true)
  assert.equal(latest.marker, 'present')
  assert.ok(store.get(KEY))
  await view.unmount()
})

await check('a real "signed out" answer clears a stale marker, but only when it is unchanged since the check was sent', async () => {
  useStore({ [KEY]: 'old' })
  const view = await mount({ getPortalAccountMe: async () => ({ account: null }) })
  assert.equal(latest.sessionKnown, true)
  assert.equal(store.has(KEY), false)
  assert.equal(latest.marker, 'absent')
  await view.unmount()

  useStore({ [KEY]: 'old' })
  const pending = deferred<unknown>()
  const second = await mount({ getPortalAccountMe: () => pending.promise })
  store.set(KEY, 'written-by-another-tab')
  await act(async () => pending.resolve({ account: null }))
  assert.equal(store.get(KEY), 'written-by-another-tab', 'a newer write by another tab stays')
  assert.equal(latest.marker, 'present')
  await second.unmount()

  useStore()
  const third = await mount({ getPortalAccountMe: async () => ({ account: null }) })
  assert.equal(store.has(KEY), false, 'no marker, nothing written')
  await third.unmount()
})

await check('a FAILED first check keeps translation off: not known, marker untouched', async () => {
  for (const failure of [new Error('offline'), refusal(500), refusal(503, 'database_unavailable')]) {
    useStore({ [KEY]: 'kept' })
    const view = await mount({ getPortalAccountMe: async () => { throw failure } })
    assert.equal(latest.ready, true, 'ready stays for its other users')
    assert.equal(latest.sessionKnown, false, 'but the session is not known')
    assert.equal(latest.account, null)
    assert.equal(store.get(KEY), 'kept', 'a failed check changes nothing')
    await view.unmount()
  }
  useStore()
  const view = await mount({ getPortalAccountMe: async () => { throw refusal(503) } })
  assert.equal(latest.sessionKnown, false)
  assert.equal(store.has(KEY), false, 'and writes nothing')
  assert.equal(allowed(), false, 'the rule stays closed for a guest whose check failed')
  await view.unmount()
})

function allowed() {
  return options.portalTranslateAllowed({ sessionReady: latest.sessionKnown, signedIn: !!latest.account || latest.consentRenewal, accountOpen: false, marker: latest.marker })
}

await check('a 428 portal_consent_required answer is a live session: known, marker set, counts as signed in', async () => {
  useStore()
  const view = await mount({ getPortalAccountMe: async () => { throw refusal(428, account.CONSENT_RENEWAL_CODE) } })
  assert.equal(latest.sessionKnown, true)
  assert.equal(latest.consentRenewal, true)
  assert.equal(latest.marker, 'present')
  assert.ok(store.get(KEY))
  assert.equal(allowed(), false)
  await act(async () => latest.dismissConsentRenewal())
  assert.equal(latest.marker, 'present', 'dismissing the prompt keeps the session, so the marker stays')
  assert.equal(allowed(), false)
  await view.unmount()
})

await check('a sign-in sets the marker BEFORE the request and again on success; this tab sees it', async () => {
  useStore()
  let seenAtSend: string | null = null
  const view = await mount({
    getPortalAccountMe: async () => ({ account: null }),
    signinPortalAccount: async () => { seenAtSend = store.get(KEY) ?? null; return profile },
  })
  const afterLoad = store.get(KEY)
  assert.equal(afterLoad, undefined)
  let ok = false
  await act(async () => { ok = await latest.signIn({}) })
  assert.equal(ok, true)
  assert.ok(seenAtSend, 'set before the network call')
  assert.notEqual(store.get(KEY), seenAtSend, 'written again on success')
  assert.equal(latest.marker, 'present')
  assert.equal(allowed(), false)
  await view.unmount()
})

await check('a failed sign-in or sign-up: cleared only for a definite 4xx refusal that this tab alone wrote', async () => {
  const run = async (initial: Record<string, string>, fail: (state: { store: Map<string, string> }) => unknown, method: 'signIn' | 'signUp' = 'signIn') => {
    useStore()
    const failing = async () => { throw fail({ store }) }
    const view = await mount({ getPortalAccountMe: async () => ({ account: null }), signinPortalAccount: failing, signupPortalAccount: failing })
    for (const [key, value] of Object.entries(initial)) store.set(key, value)
    const before = store.get(KEY) ?? null
    let ok = true
    await act(async () => { ok = await latest[method]({}) })
    assert.equal(ok, false)
    const result = { value: store.get(KEY) ?? null, marker: latest.marker, before }
    await view.unmount()
    return result
  }
  const refused = await run({}, () => refusal(401, 'bad_credentials'))
  assert.equal(refused.value, null, 'a 401 with nothing before: cleared')
  assert.equal(refused.marker, 'absent', 'and this tab sees it')
  assert.equal((await run({}, () => refusal(409, 'exists'), 'signUp')).value, null, 'a refused sign-up too')
  assert.ok((await run({}, () => new Error('Failed to fetch'))).value, 'a network error: the server may have made the session')
  assert.ok((await run({}, () => refusal(500))).value, '5xx: kept')
  assert.ok((await run({}, () => refusal(504))).value, 'timeout-like 5xx: kept')
  assert.ok((await run({}, () => refusal(428, account.CONSENT_RENEWAL_CODE))).value, 'a consent-required answer means a live session: kept')
  assert.ok((await run({ [KEY]: 'someone-signed-in' }, () => refusal(401))).value, 'a marker that was already there is never cleared')
  assert.equal((await run({}, ({ store: s }) => { s.set(KEY, 'another-tab'); return refusal(401) })).value, 'another-tab', 'a newer write by another tab stays')
})

await check('sign-out clears the marker and this tab sees it at once; a failed sign-out keeps it', async () => {
  useStore()
  const view = await mount({ getPortalAccountMe: async () => profile, signoutPortalAccount: async () => ({}) })
  assert.equal(latest.marker, 'present')
  await act(async () => { await latest.signOut() })
  assert.equal(store.has(KEY), false)
  assert.equal(latest.marker, 'absent', 'no storage event reaches the writing tab, so the hook updates itself')
  assert.equal(latest.account, null)
  assert.equal(allowed(), true, 'translation can resume without a reload')
  await view.unmount()

  useStore()
  const failing = await mount({ getPortalAccountMe: async () => profile, signoutPortalAccount: async () => { throw new Error('offline') } })
  await act(async () => { await latest.signOut() })
  assert.ok(store.get(KEY), 'the session may still be alive')
  assert.equal(latest.marker, 'present')
  await failing.unmount()
})

await check('consent renewal success writes the marker', async () => {
  useStore()
  const view = await mount({ getPortalAccountMe: async () => { throw refusal(428, account.CONSENT_RENEWAL_CODE) }, renewPortalConsent: async () => profile })
  store.delete(KEY)
  await act(async () => { await latest.renewConsent({}) })
  assert.ok(store.get(KEY))
  assert.equal(latest.marker, 'present')
  await view.unmount()
})

await check('storage, pageshow, visibilitychange and resume only re-read the marker, and add zero requests', async () => {
  useStore()
  const calls: string[] = []
  const api: Record<string, unknown> = {}
  for (const name of ['getPortalAccountMe', 'signinPortalAccount', 'signupPortalAccount', 'signoutPortalAccount', 'renewPortalConsent', 'getPortalCart', 'savePortalCart', 'getPortalWishlist', 'savePortalWishlist']) {
    api[name] = async () => { calls.push(name); return name === 'getPortalAccountMe' ? { account: null } : {} }
  }
  const view = await mount(api)
  assert.deepEqual(calls, ['getPortalAccountMe'], 'the one load-time check')
  assert.equal(latest.marker, 'absent')

  store.set(KEY, 't1')
  await act(async () => { winEvents.dispatchEvent(storageEvent('some-other-key')) })
  assert.equal(latest.marker, 'absent', 'an unrelated key is ignored')
  await act(async () => { winEvents.dispatchEvent(storageEvent(KEY)) })
  assert.equal(latest.marker, 'present', 'storage event for the marker key')
  store.delete(KEY)
  await act(async () => { winEvents.dispatchEvent(storageEvent(null)) })
  assert.equal(latest.marker, 'absent', 'localStorage.clear() has key null')

  store.set(KEY, 't2')
  await act(async () => { winEvents.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false })) })
  assert.equal(latest.marker, 'present', 'any pageshow, persisted or not')
  store.delete(KEY)
  await act(async () => { winEvents.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })) })
  assert.equal(latest.marker, 'absent')

  store.set(KEY, 't3')
  doc.visibilityState = 'hidden'
  await act(async () => { docEvents.dispatchEvent(new Event('visibilitychange')) })
  assert.equal(latest.marker, 'absent', 'hidden: nothing to do')
  doc.visibilityState = 'visible'
  await act(async () => { docEvents.dispatchEvent(new Event('visibilitychange')) })
  assert.equal(latest.marker, 'present')

  store.delete(KEY)
  await act(async () => { docEvents.dispatchEvent(new Event('resume')) })
  assert.equal(latest.marker, 'absent', 'a frozen tab waking up')

  await act(async () => { winEvents.dispatchEvent(new Event('focus')) })
  assert.deepEqual(calls, ['getPortalAccountMe'], 'no event reached the network')
  await view.unmount()

  store.set(KEY, 't4')
  await act(async () => { winEvents.dispatchEvent(storageEvent(KEY)) })
  assert.deepEqual(calls, ['getPortalAccountMe'], 'listeners are removed on unmount')
})

assert.deepEqual(failures, [], `signed-in marker:\n  ${failures.join('\n  ')}`)
console.log('PASS signed-in marker: set and compare-and-clear, own-tab state, failed check and 428, listeners reread only')
