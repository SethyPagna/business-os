// A Save sends only what changed (owner, 5 Oct 2026: Save "updates EVERYTHING to
// latest instead of only the changed fields").
//
// Pinned against the real code, not its shape alone:
//   1. diffSettings / sendChangedSettings (the pipeline AppContext.saveSettings
//      runs): a 100-key form with 2 edits sends 2 keys (the old page sent 100);
//      an unchanged form makes NO request; a key with a save in flight is never
//      dropped as "unchanged"; a deliberate clear is never dropped.
//   2. settingsSaveOutcome: AppContext.saveSettings answers a failed write with
//      { success: false } instead of throwing -- the old callers read that as saved.
//   3. the transport really posts only what it is given, remembers the Worker's
//      writeId so this tab ignores its own broadcast echo (only for a caller that
//      adopts the answer), and tells no page to refresh when nothing changed.
//   4. AppContext sends through that pipeline, adopts the answer without a refetch
//      and does not reload the settings table for its own echo.
//
// Run: node tests/settingsDiffSave.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { saveSettings as transportSaveSettings } from '../src/api/settingsTransport.ts'
import {
  diffSettings,
  isOwnSettingsWrite,
  rememberOwnSettingsWrite,
  resetOwnSettingsWritesForTests,
  sendChangedSettings,
  serializeSettingValue,
  settingsSaveNormalisedKeys,
  settingsSaveOutcome,
  settingsSaveSucceeded,
} from '../src/utils/settingsSave.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function wholeForm(count = 100): Record<string, string> {
  const form: Record<string, string> = {}
  for (let i = 0; i < count; i += 1) form[`setting_${i}`] = `value ${i}`
  return form
}

// ---------------------------------------------------------------- 1. the diff
await test('a 100-key form with two edits sends exactly those two keys (the old page sent all 100)', () => {
  const loaded = wholeForm()
  const form = { ...loaded, setting_3: 'edited', setting_77: 'also edited' }
  const { changed, unchanged } = diffSettings(form, loaded)
  assert.deepEqual(Object.keys(changed).sort(), ['setting_3', 'setting_77'])
  assert.equal(unchanged.length, 98)
})

await test('an untouched form sends nothing', () => {
  const loaded = wholeForm()
  assert.deepEqual(diffSettings({ ...loaded }, loaded).changed, {})
})

await test('a key the snapshot has never seen is always sent, even an empty one', () => {
  assert.deepEqual(diffSettings({ brand_new: '' }, { other: '1' }).changed, { brand_new: '' })
})

await test('a deliberate clear is sent even when the snapshot says the key is already empty', () => {
  const { changed } = diffSettings({ customer_portal_ai_prompt: '' }, { customer_portal_ai_prompt: '' }, ['customer_portal_ai_prompt'])
  assert.deepEqual(changed, { customer_portal_ai_prompt: '' })
})

await test('values compare in the Worker\'s own text form: an object equals the JSON text it is stored as', () => {
  assert.equal(serializeSettingValue({ a: 1 }), '{"a":1}')
  assert.deepEqual(diffSettings({ k: { a: 1 } }, { k: '{"a":1}' }).changed, {})
  assert.deepEqual(diffSettings({ k: { a: 2 } }, { k: '{"a":1}' }).changed, { k: { a: 2 } })
  assert.deepEqual(diffSettings({ flag: true }, { flag: 'true' }).changed, {}, 'true and "true" are stored identically')
})

await test('undefined is never sent', () => {
  assert.deepEqual(diffSettings({ a: undefined, b: '1' }, {}).changed, { b: '1' })
})

// ------------------------------------------------- 1b. the pipeline AppContext runs
await test('sendChangedSettings: one request, only the changed keys', async () => {
  const loaded = wholeForm()
  const calls: Array<Record<string, unknown>> = []
  const result = await sendChangedSettings({
    requested: { ...loaded, setting_5: 'x' },
    snapshot: loaded,
    inFlight: new Map(),
    send: async (changed) => { calls.push(changed); return { success: true } },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { setting_5: 'x' })
  assert.deepEqual(result.sent, { setting_5: 'x' })
})

await test('sendChangedSettings: nothing changed means NO request at all', async () => {
  const loaded = wholeForm()
  let requests = 0
  const result = await sendChangedSettings({ requested: { ...loaded }, snapshot: loaded, inFlight: new Map(), send: async () => { requests += 1; return {} } })
  assert.equal(requests, 0)
  assert.deepEqual(result.sent, {})
})

await test('sendChangedSettings: a change back made while the first save is still in flight is still sent', async () => {
  // Save A sets k to "1" (snapshot still says "0"); before it lands the person sets k back to "0".
  // Judged against the stale snapshot the second save looks unchanged and would be dropped,
  // leaving the server on "1".
  const snapshot = { k: '0' }
  const inFlight = new Map<string, number>()
  const sent: Array<Record<string, unknown>> = []
  let releaseFirst: () => void = () => {}
  const first = sendChangedSettings({
    requested: { k: '1' }, snapshot, inFlight,
    send: (changed) => new Promise((resolve) => { sent.push(changed); releaseFirst = () => resolve({ success: true }) }),
  })
  assert.equal(inFlight.get('k'), 1)
  const second = sendChangedSettings({ requested: { k: '0' }, snapshot, inFlight, send: async (changed) => { sent.push(changed); return { success: true } } })
  await second
  releaseFirst()
  await first
  assert.deepEqual(sent, [{ k: '1' }, { k: '0' }], 'both writes reach the server, in order')
  assert.equal(inFlight.size, 0, 'the in-flight marks are released')
})

await test('sendChangedSettings: a rejected request releases its marks and rejects', async () => {
  const inFlight = new Map<string, number>()
  await assert.rejects(sendChangedSettings({ requested: { k: '1' }, snapshot: {}, inFlight, send: async () => { throw new Error('offline') } }), /offline/)
  assert.equal(inFlight.size, 0)
})

await test('sendChangedSettings: a conflict answer comes back as is, with nothing adopted', async () => {
  const conflict = { conflict: true, currentSettings: { k: 'theirs' } }
  const result = await sendChangedSettings({ requested: { k: '1' }, snapshot: {}, inFlight: new Map(), send: async () => conflict })
  assert.equal(result.conflict, conflict)
  assert.deepEqual(result.normalised, {})
})

await test('sendChangedSettings: values the Worker normalised are returned for the saver to adopt', async () => {
  const result = await sendChangedSettings({ requested: { link: ' https://x.example ' }, snapshot: {}, inFlight: new Map(), send: async () => ({ success: true, saved: { link: 'https://x.example' } }) })
  assert.deepEqual(result.normalised, { link: 'https://x.example' })
})

// ------------------------------------------------------- 2. reading the answer
await test('a failed write is "failed", never "saved" (the old callers read it as saved)', () => {
  assert.equal(settingsSaveOutcome({ success: false, error: new Error('403') }), 'failed')
  assert.equal(settingsSaveOutcome(undefined), 'failed')
  assert.equal(settingsSaveOutcome({ success: true }), 'saved')
  assert.equal(settingsSaveOutcome({ success: true, unchanged: true }), 'unchanged')
  assert.equal(settingsSaveOutcome({ success: false, conflict: true }), 'conflict')
  assert.equal(settingsSaveSucceeded({ success: false }), false)
  assert.equal(settingsSaveSucceeded({ success: true, unchanged: true }), true)
  assert.deepEqual(settingsSaveNormalisedKeys({ success: true, normalized: ['a', 3, 'b'] }), ['a', 'b'])
  assert.deepEqual(settingsSaveNormalisedKeys({ success: true }), [])
})

// ------------------------------------------------------- 3. the transport + echo
// A window with just enough for the transport: events, empty storage, an origin.
function fakeWindow(): EventTarget {
  return Object.assign(new EventTarget(), {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { origin: 'https://sync.example.test' },
  })
}
function resetApi() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('https://sync.example.test')
  setSyncToken('')
  resetOwnSettingsWritesForTests()
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

await test('the transport posts what it is given and remembers the Worker\'s writeId, so the broadcast echo is recognised as this tab\'s own', async () => {
  resetApi()
  const original = globalThis.fetch
  const posts: Array<Record<string, unknown>> = []
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (String(init?.method || 'GET').toUpperCase() === 'POST') {
      posts.push(JSON.parse(String(init?.body || '{}')))
      return Promise.resolve(json({ updatedAt: '2026-10-05 10:00:00', writeId: 'write-1', keys: ['a'], saved: { a: 'normalised' } }))
    }
    return Promise.resolve(json({ updatedAt: '2026-10-05 09:00:00' }))
  }) as typeof fetch
  try {
    await transportSaveSettings({ a: ' raw ' }, { answerAdopted: true })
    assert.equal(posts.length, 1)
    assert.equal(Object.keys(posts[0]).filter((key) => key !== 'expectedUpdatedAt').join(','), 'a', 'only the given key is posted')
    assert.equal(isOwnSettingsWrite({ action: 'update', keys: ['a'], writeId: 'write-1' }), true, 'this tab\'s own echo')
    assert.equal(isOwnSettingsWrite({ action: 'update', keys: ['a'], writeId: 'someone-else' }), false, 'another device\'s write is NOT ignored')
    assert.equal(isOwnSettingsWrite(null), false)
    assert.equal(isOwnSettingsWrite({ action: 'update' }), false, 'an old Worker\'s broadcast has no id and is never ignored')
  } finally {
    globalThis.fetch = original
  }
})

await test('a caller that does not adopt the answer (the brand-list modal calls the api directly) keeps the old behaviour: its echo and dispatch still reload', async () => {
  resetApi()
  const original = globalThis.fetch
  const events: Array<Record<string, unknown>> = []
  const listener = (event: Event) => { events.push((event as CustomEvent).detail) }
  const hadWindow = typeof (globalThis as { window?: unknown }).window !== 'undefined'
  if (!hadWindow) (globalThis as { window?: unknown }).window = fakeWindow()
  const target = (globalThis as unknown as { window: EventTarget }).window
  target.addEventListener('sync:update', listener)
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (String(init?.method || 'GET').toUpperCase() === 'POST') return Promise.resolve(json({ updatedAt: 'x', writeId: 'write-2', keys: ['b'] }))
    return Promise.resolve(json({ updatedAt: 'x' }))
  }) as typeof fetch
  try {
    await transportSaveSettings({ b: '1' })
    assert.equal(isOwnSettingsWrite({ writeId: 'write-2' }), false, 'the echo is not ignored')
    assert.ok(events.length > 0 && events.every((detail) => detail.ownSettingsWrite === false), 'the dispatch is not marked as the saver own')
    events.length = 0
    await transportSaveSettings({ c: '1' }, { answerAdopted: true })
    assert.ok(events.length > 0 && events.every((detail) => detail.ownSettingsWrite === true), 'an adopting caller dispatch is marked')
  } finally {
    globalThis.fetch = original
    target.removeEventListener('sync:update', listener)
    if (!hadWindow) delete (globalThis as { window?: unknown }).window
  }
})

await test('a save the Worker reports as having changed nothing tells no page to refresh', async () => {
  resetApi()
  const original = globalThis.fetch
  const events: Array<Record<string, unknown>> = []
  const listener = (event: Event) => { events.push((event as CustomEvent).detail) }
  const hadWindow = typeof (globalThis as { window?: unknown }).window !== 'undefined'
  if (!hadWindow) (globalThis as { window?: unknown }).window = fakeWindow()
  const target = (globalThis as unknown as { window: EventTarget }).window
  target.addEventListener('sync:update', listener)
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    if (String(init?.method || 'GET').toUpperCase() === 'POST') return Promise.resolve(json({ updatedAt: 'x', keys: [], unchanged: ['d'] }))
    return Promise.resolve(json({ updatedAt: 'x' }))
  }) as typeof fetch
  try {
    await transportSaveSettings({ d: '1' }, { answerAdopted: true })
    assert.equal(events.length, 0)
  } finally {
    globalThis.fetch = original
    target.removeEventListener('sync:update', listener)
    if (!hadWindow) delete (globalThis as { window?: unknown }).window
  }
})

await test('remembered write ids expire', () => {
  resetOwnSettingsWritesForTests()
  rememberOwnSettingsWrite('w', 1000)
  assert.equal(isOwnSettingsWrite({ writeId: 'w' }, 1000 + 60_000), true)
  assert.equal(isOwnSettingsWrite({ writeId: 'w' }, 1000 + 3 * 60_000), false)
})

// ------------------------------------------------------- 6. AppContext + callers
const appContext = read('../src/AppContext.tsx')
await test('AppContext.saveSettings sends through the diffing pipeline, adopts the answer without a refetch, and keeps its snapshot current', () => {
  const save = appContext.slice(appContext.indexOf('const saveSettings = useCallback('))
  const body = save.slice(0, save.indexOf('\n  }, ['))
  assert.match(body, /await sendChangedSettings\(\{/)
  assert.match(body, /snapshot: settingsRef\.current,/)
  assert.match(body, /settingsRef\.current = \{ \.\.\.settingsRef\.current, \.\.\.adopted \}/, 'the ref is updated at once, not on the next render')
  assert.match(body, /setSettings\(\(prev\) => \(\{ \.\.\.prev, \.\.\.adopted \}\)\)/)
  assert.doesNotMatch(body, /loadSettings\(/, 'no refetch after a save')
  assert.match(body, /return \{ success: true, unchanged: true \}/)
})

await test('AppContext: the saver\'s own settings echo and own dispatch do not re-read the settings table', () => {
  const echo = appContext.indexOf("if (channel === 'settings' && isOwnSettingsWrite(detail.payload)) return")
  const reload = appContext.indexOf("if (channel === 'settings' && !detail.ownSettingsWrite && !isOwnSettingsWrite(detail.payload)) loadSettings()")
  assert.ok(echo > 0 && reload > echo)
  assert.match(appContext, /\.\.\.\(detail\.ownSettingsWrite \? \{ ownSettingsWrite: true \} : \{\}\),/, 'pages are told which dispatch was their own')
})


if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nsettingsDiffSave: all checks passed')
