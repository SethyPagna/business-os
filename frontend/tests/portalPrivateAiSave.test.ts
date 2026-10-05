// The Website Editor never blanks the assistant's prompt or provider
// (FX-sec2, refuter R-sec F2, 27 Sep 2026).
//
// The public portal config stopped carrying the merchant's AI prompt and
// provider id (FX-sec). The editor then took both from the app's settings
// map, which cannot show where its values came from: it is {} until the
// staff settings arrive and holds only this device's keys when they fail.
// A save in either state sent both keys blank and the Worker stored them
// (the refuter's probe ended {"prompt":"","provider":""}):
//   S2  the website loaded before the staff settings, then Save sent blanks;
//   S3  the staff settings failed and the map held only this device's keys.
//
// The editor now reads the two values from the server's own answer
// (components/catalog/portalPrivateAi.ts, loaded through settingsTransport
// getSettings({ serverOnly: true })), keeps both fields and Save locked until
// that read settles, and sends a key only when the person changed it. A key
// changed to blank is named in clearKeys, the Worker's explicit clear list;
// cloudflare/src/routes/settings.ts keeps any other blank as stored.
//
// Run: node tests/portalPrivateAiSave.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, cacheInvalidate, cacheSet, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { getSettings, saveSettings } from '../src/api/settingsTransport.ts'
import { normalizeSettingsWriteOptions } from '../src/utils/settingsWriteOptions.ts'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Mod = typeof import('../src/components/catalog/portalPrivateAi.ts')
let mod: Mod | null = null
try {
  mod = await import('../src/components/catalog/portalPrivateAi.ts')
} catch (error) {
  console.error('portalPrivateAi.ts could not be loaded:', (error as Error).message)
}
const need = (): Mod => { assert.ok(mod, 'components/catalog/portalPrivateAi.ts exists'); return mod! }

const PROMPT_KEY = 'customer_portal_ai_prompt'
const PROVIDER_KEY = 'customer_portal_ai_provider_id'
const PROMPT = 'You are the Leang Cosmetics assistant. Never quote cost prices.'
// GET /api/settings as the server answers it for a Website Editor account.
const SERVER_SETTINGS = { [PROMPT_KEY]: PROMPT, [PROVIDER_KEY]: '3', customer_portal_ai_title: 'Beauty Assistant' }
// What the app's settings map held in S3: this device's keys and nothing else.
const DEVICE_ONLY_SETTINGS = { language: 'km', theme: 'dark' }
const BLANK = { [PROMPT_KEY]: '', [PROVIDER_KEY]: '' }
const NOTHING = { updates: {}, clearKeys: [] }

const loaded = () => need().applyPrivateAiRead(need().createPrivateAiState(), SERVER_SETTINGS)

await runTest('S2 race: until the server read lands, Save is blocked and would carry neither key', () => {
  const m = need()
  const loading = m.createPrivateAiState()
  assert.equal(loading.status, 'loading')
  assert.equal(m.privateAiBlocksSave(loading), true, 'Save waits for the read')
  assert.deepEqual(m.privateAiSaveChanges(loading), NOTHING)
  assert.deepEqual(m.privateAiFormValues(loading), BLANK, 'the locked fields show nothing')
  const typed = m.editPrivateAi(loading, PROMPT_KEY, '')
  assert.equal(typed, loading, 'a value the editor has not seen cannot be edited')
  assert.deepEqual(m.privateAiSaveChanges(typed), NOTHING)
})

await runTest('S2 race, continued: once the stored values arrive, an untouched save carries neither key', () => {
  const m = need()
  const state = loaded()
  assert.equal(state.status, 'loaded')
  assert.equal(m.privateAiBlocksSave(state), false)
  assert.deepEqual(m.privateAiFormValues(state), { [PROMPT_KEY]: PROMPT, [PROVIDER_KEY]: '3' }, 'the fields show what is stored')
  assert.deepEqual(m.privateAiSaveChanges(state), NOTHING)
  // Retyping the stored text, or padding it with spaces, is not a change.
  const retyped = m.editPrivateAi(m.editPrivateAi(state, PROMPT_KEY, `  ${PROMPT} `), PROVIDER_KEY, '3')
  assert.deepEqual(m.privateAiSaveChanges(retyped), NOTHING)
})

await runTest('S3 degraded: when the server read fails, both fields stay locked and a save carries neither key', () => {
  const m = need()
  const failedRead = m.applyPrivateAiRead(m.createPrivateAiState(), null)
  assert.equal(failedRead.status, 'failed')
  assert.equal(m.privateAiBlocksSave(failedRead), false, 'the rest of the website still saves')
  const typed = m.editPrivateAi(m.editPrivateAi(failedRead, PROMPT_KEY, ''), PROVIDER_KEY, '')
  assert.deepEqual(m.privateAiSaveChanges(typed), NOTHING)
  assert.deepEqual(m.privateAiFormValues(typed), BLANK)
  assert.equal(m.applyPrivateAiRead(m.createPrivateAiState(), 'offline').status, 'failed', 'a non-map answer is a failed read, never "nothing stored"')
  // Even a device-only map mistaken for the server's answer sends nothing
  // unless the person changes a field.
  assert.deepEqual(m.privateAiSaveChanges(m.applyPrivateAiRead(m.createPrivateAiState(), DEVICE_ONLY_SETTINGS)), NOTHING)
})

await runTest('control: a changed prompt and provider are sent, trimmed', () => {
  const m = need()
  const edited = m.editPrivateAi(m.editPrivateAi(loaded(), PROMPT_KEY, '  Answer in Khmer first. '), PROVIDER_KEY, '5')
  assert.deepEqual(m.privateAiSaveChanges(edited), { updates: { [PROMPT_KEY]: 'Answer in Khmer first.', [PROVIDER_KEY]: '5' }, clearKeys: [] })
})

await runTest('control: clearing the prompt or choosing Automatic is sent blank and named in clearKeys', () => {
  const m = need()
  const cleared = m.editPrivateAi(m.editPrivateAi(loaded(), PROMPT_KEY, '   '), PROVIDER_KEY, '')
  assert.deepEqual(m.privateAiSaveChanges(cleared), { updates: { [PROMPT_KEY]: '', [PROVIDER_KEY]: '' }, clearKeys: [PROMPT_KEY, PROVIDER_KEY] })
  const promptOnly = m.editPrivateAi(loaded(), PROMPT_KEY, '')
  assert.deepEqual(m.privateAiSaveChanges(promptOnly), { updates: { [PROMPT_KEY]: '' }, clearKeys: [PROMPT_KEY] })
})

await runTest('after a save its values are the baseline; an edit typed during the save stays pending; a failed refresh keeps them', () => {
  const m = need()
  let state = m.editPrivateAi(loaded(), PROMPT_KEY, 'New rules')
  const sent = { ...m.privateAiSaveChanges(state).updates, customer_portal_business_tagline: 'edited' }
  state = m.editPrivateAi(state, PROVIDER_KEY, '5')
  const settled = m.settlePrivateAiSave(state, sent)
  assert.deepEqual(settled.values, { [PROMPT_KEY]: 'New rules', [PROVIDER_KEY]: '3' })
  assert.deepEqual(m.privateAiSaveChanges(settled), { updates: { [PROVIDER_KEY]: '5' }, clearKeys: [] })
  const refreshFailed = m.applyPrivateAiRead(settled, null)
  assert.equal(refreshFailed.status, 'loaded', 'a failed refresh never locks values that already loaded')
  assert.deepEqual(refreshFailed.values, settled.values)
})

await runTest('a refresh carrying another device\'s change moves the baseline and keeps this person\'s own edit', () => {
  const m = need()
  const refreshed = m.applyPrivateAiRead(m.editPrivateAi(loaded(), PROMPT_KEY, 'Mine'), { [PROMPT_KEY]: 'Theirs', [PROVIDER_KEY]: '4' })
  assert.deepEqual(m.privateAiFormValues(refreshed), { [PROMPT_KEY]: 'Mine', [PROVIDER_KEY]: '4' })
  assert.deepEqual(m.privateAiSaveChanges(refreshed), { updates: { [PROMPT_KEY]: 'Mine' }, clearKeys: [] })
})

await runTest('the two keys, and the form their values are compared in', () => {
  const m = need()
  assert.deepEqual([...m.PRIVATE_AI_SETTING_KEYS], [PROMPT_KEY, PROVIDER_KEY])
  assert.equal(m.isPrivateAiKey(PROMPT_KEY), true)
  assert.equal(m.isPrivateAiKey('customer_portal_ai_title'), false)
  const cases: Array<[typeof PROMPT_KEY | typeof PROVIDER_KEY, unknown, string]> = [
    [PROVIDER_KEY, '7', '7'], [PROVIDER_KEY, 7, '7'], [PROVIDER_KEY, '0', ''], [PROVIDER_KEY, 'abc', ''],
    [PROVIDER_KEY, null, ''], [PROMPT_KEY, null, ''], [PROMPT_KEY, '  x ', 'x'],
  ]
  for (const [key, value, expected] of cases) assert.equal(m.normalizePrivateAiValue(key, value), expected, `${key} ${JSON.stringify(value)}`)
})

function resetApiState() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
  cacheInvalidate('settings')
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const isPost = (init?: RequestInit) => String(init?.method || 'GET').toUpperCase() === 'POST'

await runTest('clearKeys reaches the Worker on the first attempt and on the conflict retry, cut to keys the save sends', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if (!isPost(init)) return Promise.resolve(json({}))
    const body = JSON.parse(String(init?.body || '{}'))
    bodies.push(body)
    if (!body.expectedUpdatedAt) {
      return Promise.resolve(json({ error: 'Settings changed on another device.', code: 'write_conflict', conflict: true, actualUpdatedAt: 'server-v1', currentSettings: { [PROMPT_KEY]: PROMPT } }, 409))
    }
    return Promise.resolve(json({ updatedAt: 'server-v2', keys: [PROMPT_KEY] }))
  }) as typeof fetch
  try {
    const result = await saveSettings({ [PROMPT_KEY]: '' }, { skipExpectedUpdatedAt: true, clearKeys: [PROMPT_KEY, PROVIDER_KEY, 7] }) as Record<string, unknown>
    assert.equal(result?.updatedAt, 'server-v2')
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[0], { [PROMPT_KEY]: '', clearKeys: [PROMPT_KEY] })
    assert.deepEqual(bodies[1], { [PROMPT_KEY]: '', clearKeys: [PROMPT_KEY], expectedUpdatedAt: 'server-v1' }, 'the retry still asks for the clear')
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('control: a save that names nothing to clear sends no clearKeys field', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if (isPost(init)) bodies.push(JSON.parse(String(init?.body || '{}')))
    return Promise.resolve(json({ updatedAt: 'server-v2', keys: [] }))
  }) as typeof fetch
  try {
    await saveSettings({ customer_portal_business_tagline: 'a' }, { skipExpectedUpdatedAt: true })
    await saveSettings({ customer_portal_business_tagline: 'b' }, { skipExpectedUpdatedAt: true, clearKeys: [PROMPT_KEY] })
    assert.deepEqual(bodies, [{ customer_portal_business_tagline: 'a' }, { customer_portal_business_tagline: 'b' }])
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('the app keeps clearKeys when it normalises write options on the way to the transport', () => {
  assert.deepEqual(normalizeSettingsWriteOptions({ clearKeys: [PROMPT_KEY] }).clearKeys, [PROMPT_KEY])
  assert.deepEqual(normalizeSettingsWriteOptions({}).clearKeys, [])
  const appContext = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
  assert.match(appContext, /const normalizedOptions = normalizeSettingsWriteOptions\(options\)/)
  assert.match(appContext, /const sendOptions = \{ \.\.\.normalizedOptions, answerAdopted: true \}/)
  assert.match(appContext, /api\.saveSettings\?\.\(changed, sendOptions\)/)
})

await runTest('a serverOnly settings read asks the server even over a fresh cached copy, and fails rather than fall back', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  let prompt = 'OLD'
  let status = 200
  let settingsReads = 0
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isPost(init) && /\/api\/settings(?:\?|$)/.test(String(input))) {
      settingsReads += 1
      return Promise.resolve(status === 200 ? json({ [PROMPT_KEY]: prompt, updatedAt: 't1' }) : json({ error: 'Server error' }, status))
    }
    return Promise.resolve(json({}))
  }) as typeof fetch
  try {
    // A fresh copy in the read cache (routeMirrored 'settings:get') is what
    // an ordinary read answers with, without asking the server.
    cacheSet('settings:get', { [PROMPT_KEY]: 'OLD' })
    const cached = await getSettings()
    assert.equal(cached[PROMPT_KEY], 'OLD')
    assert.equal(settingsReads, 0, 'control: the ordinary read is answered from the cache')
    prompt = 'NEW'
    const fresh = await getSettings({ serverOnly: true })
    assert.equal(settingsReads, 1)
    assert.equal(fresh[PROMPT_KEY], 'NEW', 'the cached copy is never the answer')
    assert.equal(Object.prototype.hasOwnProperty.call(fresh, 'updatedAt'), false)
    const readsBefore = settingsReads
    status = 500
    await assert.rejects(() => getSettings({ serverOnly: true }))
    assert.equal(settingsReads, readsBefore + 1, 'the failure is the server\'s own answer')
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

await runTest('the editor takes the two values only from the server read, never from the app settings map or the public config', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  assert.doesNotMatch(page, /settings: appSettings|appSettingsRef|withPrivateAiSettings|privateAiKnown/, 'the app settings map is not a source for them')
  const draft = between(page, 'function buildDraft(', '\n}\n')
  assert.doesNotMatch(draft, /customer_portal_ai_(?:prompt|provider_id)\s*:/, 'the draft built from the public or cached config never carries them')
  const reader = between(page, 'async function loadPrivateAiSettings(', '\n  }\n')
  assert.match(reader, /getCatalogApi\(\)\.getSettings\(\{ serverOnly: true \}\)/)
  assert.match(reader, /isTrackedRequestCurrent\(privateAiReadRef, readId\)/)
  assert.match(reader, /setPrivateAi\(\(current\) => applyPrivateAiRead\(current, settings\)\)/)
  const load = between(page, 'async function loadPortal() {', '\n  }\n')
  const publicEnd = load.indexOf('\n      return\n    }\n')
  assert.ok(publicEnd > 0, 'loadPortal still returns from its public branch')
  assert.doesNotMatch(load.slice(0, publicEnd), /loadPrivateAiSettings/, 'the public website never reads staff settings')
  const editorBranch = load.slice(publicEnd)
  const readAt = editorBranch.indexOf('if (canEditConfig) void loadPrivateAiSettings()')
  assert.ok(readAt > 0, 'every editor load reads them')
  assert.ok(readAt < editorBranch.indexOf('getCatalogApi().getPortalBootstrap()'), 'beside the bootstrap, so a failed bootstrap never leaves them loading')
})

await runTest('the editor saves only after the read settles, sends only changed values, and names the ones cleared', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  const save = between(page, 'async function savePortalDraft(', '\n  async function ')
  const guard = save.indexOf('if (canEditConfig && privateAiBlocksSave(privateAi)) {')
  assert.ok(guard > 0, 'savePortalDraft refuses to save while the values load')
  assert.ok(guard < save.indexOf('setEditorSaving(true)'), 'before anything is sent')
  assert.match(save.slice(guard), /^if \(canEditConfig && privateAiBlocksSave\(privateAi\)\) \{\n\s*return refuseSave\('portalSettingsLoading', [^\n]*\n/)
  assert.match(between(page, 'function refuseSave(', '\n  }\n'), /notify\(copy\(messageKey, fallback\), 'error'\)/, 'the refusal is shown in the admin language')
  const payload = between(save, 'const fullSavePayload', 'const privateAiChanges = privateAiSaveChanges(privateAi)')
  assert.doesNotMatch(payload, /customer_portal_ai_(?:prompt|provider_id)\s*:/, 'the whole-website payload leaves them out')
  assert.match(save, /Object\.entries\(\{ \.\.\.fullSavePayload, \.\.\.privateAiChanges\.updates \}\)\.filter\(\(\[key\]\) => canWriteSettingKey\(key, hasPermission\)\)/)
  assert.match(save, /const clearKeys = privateAiChanges\.clearKeys\.filter\(\(key\) => Object\.prototype\.hasOwnProperty\.call\(savePayload, key\)\)/)
  const call = save.indexOf('const result = await saveSettings(savePayload, { baselineSettings, clearKeys })')
  assert.ok(call > 0, 'the clear list rides with the save')
  const settle = save.indexOf('setPrivateAi((current) => settlePrivateAiSave(current, savePayload))')
  assert.ok(settle > save.indexOf('if (result?.success === false) return'), 'only a save that landed settles the values')
  assert.ok(save.lastIndexOf('invalidateTrackedRequest(privateAiReadRef)', settle) > call, 'a read older than the save is dropped')
  const setDraft = between(page, 'function setDraft(key: string, value: unknown) {', '\n  }\n')
  assert.match(setDraft, /if \(isPrivateAiKey\(key\)\) \{\n\s*setPrivateAi\(\(current\) => editPrivateAi\(current, key, value\)\)\n\s*return\n\s*\}/)
  assert.match(page, /editorDraft: \{ \.\.\.editorDraft, \.\.\.privateAiFormValues\(privateAi\) \},/)
  assert.match(page, /privateAiStatus: privateAi\.status,/)
})

await runTest('the editor surface locks both fields until the values have loaded and says why', () => {
  const surface = code(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  assert.match(surface, /const privateAiLocked = privateAiStatus !== 'loaded'/)
  assert.match(surface, /const privateAiNotice = privateAiStatus === 'failed' \? copy\('failed_to_load_data', [^)]*\) : copy\('loading', [^)]*\)/)
  const provider = between(surface, '<AppSelect\n                    id="portal-ai-provider"', '/>')
  assert.match(provider, /disabled=\{privateAiLocked\}/)
  assert.match(surface, /\{privateAiLocked \? <p className="[^"]*">\{privateAiNotice\}<\/p> : null\}/, 'the provider field says why it is locked')
  const prompt = between(surface, '<textarea id="portal-ai-prompt"', '/>')
  assert.match(prompt, /disabled=\{privateAiLocked\} placeholder=\{privateAiLocked \? privateAiNotice : undefined\}/, 'the prompt field says why it is locked')
})

await runTest('the Worker keeps a blank for exactly these keys and reads the same clearKeys field', () => {
  const route = read('../../cloudflare/src/routes/settings.ts')
  const listed = /const CLEAR_ONLY_ON_REQUEST_SETTING_KEYS = new Set\(\[([^\]]*)\]\)/.exec(route)
  assert.ok(listed, 'the Worker list is readable')
  const workerKeys = [...listed[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  assert.deepEqual(workerKeys, [...need().PRIVATE_AI_SETTING_KEYS])
  assert.match(route, /const METADATA_KEYS = new Set\(\[[^\]]*'clearKeys'[^\]]*\]\)/, 'clearKeys is request metadata, never a stored setting')
  assert.match(route, /Array\.isArray\(body\.clearKeys\)/)
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.equal(typeof en.portalSettingsLoading, 'string')
  assert.match(km.portalSettingsLoading || '', /[ក-៿]/, 'the Khmer message is Khmer')
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
