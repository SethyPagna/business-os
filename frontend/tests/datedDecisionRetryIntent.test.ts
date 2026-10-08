import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createHarness } from './mountedComponentHarness.ts'
function load(file: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', output)((name: string) => { if (!(name in dependencies)) throw Error(`Missing ${name}`); return dependencies[name] }, module, module.exports)
  return module.exports
}
let actor = 7
let organization: number | null = null
let authority = 'https://dated.example'
const owner = () => ({ version: 1, actor_id: actor, organization_id: organization, authority, runtime: 'cloudflare-workers' })
const values = new Map<string, string>()
const authStore = { getItem: (key: string) => key === 'user' ? JSON.stringify({ id: actor, organization_id: organization }) : values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
Object.assign(globalThis, { window: { location: { origin: 'https://dated.example' }, sessionStorage: authStore, localStorage: authStore } })
const ownership = load('api/offlineQueueOwnership.ts', { '../constants.ts': { STORAGE_KEYS: { USER: 'user' } }, './httpState.ts': { getSyncServerUrl: () => authority } })
const requestIds = load('api/requestIds.ts', {})
const sent: Record<string, any>[] = []
const transport = load('api/inventoryWriteTransport.ts', {
  './http.ts': { route: async (_name: string, run: () => Promise<unknown>) => { await run(); return run() }, apiFetch: async (_method: string, _path: string, body: Record<string, unknown>) => { sent.push(JSON.parse(JSON.stringify(body))); return { success: true } } },
  './requestIds.ts': requestIds, './offlineQueueOwnership.ts': ownership,
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_name: 'Fixture' }) },
  './branchTransport.ts': {}, './transferRunRecovery.ts': {}, './batchesTransport.ts': {},
})
const supplied = { client_request_id: 'dated_transport_fixed_001', offline_owner: owner(), resolved: [], unresolved: [], decisions: [] }
await transport.applyDatedStockCountDecisions(supplied)
assert.deepEqual(sent[0], sent[1]); assert.equal(sent[0].client_request_id, supplied.client_request_id)
actor = 8
assert.throws(() => transport.applyDatedStockCountDecisions(supplied), /original account|pending sale/)
assert.equal(sent.length, 2); actor = 7
const frozen = transport.prepareDatedDecisionIntent({ resolved: [], unresolved: [], decisions: [] })
assert.deepEqual(transport.loadDatedDecisionIntent(), frozen)
assert.throws(() => transport.prepareDatedDecisionIntent({ resolved: [1], unresolved: [], decisions: [] }), /dated_decision_pending_choices/)
actor = 8; assert.equal(transport.loadDatedDecisionIntent(), null); actor = 7
assert.deepEqual(transport.loadDatedDecisionIntent(), frozen)
actor = 9
const oldSet = authStore.setItem
authStore.setItem = () => { throw Error('Storage blocked') }
assert.throws(() => transport.prepareDatedDecisionIntent({ resolved: [], unresolved: [], decisions: [] }), /dated_decision_storage_save_failed/)
assert.equal(sent.length, 2)
authStore.setItem = oldSet; actor = 7
const resetFailure = { success: false, code: 'dated_decision_reset_conflict', error: 'Raw English reset' }
const originalKey = [...values.keys()][0]
const originalRaw = values.get(originalKey)!
function refuseRetirement(change: () => void) {
  values.set(originalKey, originalRaw)
  change()
  const before = new Map(values)
  assert.throws(() => transport.retireResetDatedDecisionIntent(frozen, resetFailure))
  assert.deepEqual(values, before)
  actor = 7; organization = null; authority = 'https://dated.example'
}
refuseRetirement(() => values.delete(originalKey))
refuseRetirement(() => values.set(originalKey, '{corrupt'))
refuseRetirement(() => values.set(originalKey, JSON.stringify({ ...frozen, body: { ...frozen.body, client_request_id: '' } })))
refuseRetirement(() => values.set(originalKey, JSON.stringify({ ...frozen, body: { ...frozen.body, offline_owner: undefined } })))
refuseRetirement(() => values.set(originalKey, JSON.stringify({ ...frozen, body: { ...frozen.body, client_request_id: 'newer_request_001' } })))
refuseRetirement(() => values.set(originalKey, JSON.stringify({ ...frozen, canonical: 'different choices' })))
refuseRetirement(() => values.set(originalKey, JSON.stringify({ ...frozen, body: { ...frozen.body, offline_owner: { ...owner(), actor_id: 8 } } })))
refuseRetirement(() => { actor = 8 })
refuseRetirement(() => { organization = 2 })
refuseRetirement(() => { authority = 'https://other.example' })
values.set(originalKey, originalRaw)
assert.throws(() => transport.retireResetDatedDecisionIntent(frozen, new Error('Unknown network error')))
assert.equal(values.get(originalKey), originalRaw)
const oldGet = authStore.getItem
authStore.getItem = (key: string) => { if (key.startsWith('dated-decision-intent:')) throw Error('Read denied'); return oldGet(key) }
assert.throws(() => transport.retireResetDatedDecisionIntent(frozen, resetFailure), /dated_decision_retirement_failed/)
assert.equal(values.get(originalKey), originalRaw)
authStore.getItem = oldGet
for (const completed of [false, true]) {
  const newer = JSON.stringify({ ...frozen, completed, body: { ...frozen.body, client_request_id: 'newer_request_001' } })
  values.set(originalKey, newer)
  assert.throws(() => transport.saveDatedDecisionIntent(frozen), /dated_decision_pending_choices/)
  assert.equal(values.get(originalKey), newer, 'saving the old identity never replaces a newer one')
}
values.set(originalKey, originalRaw)
const oldRemove = authStore.removeItem
for (const remove of [() => { throw Error('Removal denied') }, () => {}]) {
  authStore.removeItem = remove
  assert.throws(() => transport.retireResetDatedDecisionIntent(frozen, resetFailure), /dated_decision_retirement_failed/)
  assert.equal(values.get(originalKey), originalRaw)
}
authStore.removeItem = oldRemove
transport.retireResetDatedDecisionIntent(frozen, resetFailure)
assert.equal(transport.loadDatedDecisionIntent(), null)
assert.equal(sent.length, 2, 'retirement never sends a replacement request')
const reviewedAgain = transport.prepareDatedDecisionIntent({ resolved: [1], unresolved: [], decisions: [] })
assert.notEqual(reviewedAgain.body.client_request_id, frozen.body.client_request_id)
console.log('PASS exact stored identity/owner/reset retirement, denied or ineffective removal, missing/corrupt/foreign/newer refusal, explicit fresh review')
console.log('PASS real transport freezes request/owner across retries and rejects reassignment')
const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))]))
const harness = await createHarness({ observe: ['api/browserDialogs.ts', 'api/methods.ts'] })
try {
  const browser = window as unknown as { innerWidth: number; localStorage: Storage; sessionStorage: Storage }
  browser.sessionStorage.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: null }))
  const calls: Record<string, any>[] = []
  let response: (payload: Record<string, any>) => Promise<unknown>
  const row = { rowNumber: 1, branchId: 1, reason: 'product_not_found', suggestedActions: ['create_new'], raw: { rowNumber: 1, date: '2026-10-09', branchName: 'Shop', productName: 'New product', count: 1 } }
  const mountOptions = (lang: string) => ({
    component: 'components/products/import/DatedStockReconciliationModal.tsx', app: { t: (key: string) => packs[lang][key] || key }, props: { t: (key: string) => packs[lang][key] || key, onClose() {}, onDone() {} },
    doubles: {
      'api/browserDialogs.ts': { openCSVDialog: async () => ({ name: 'dated.csv', content: 'Date,Branch,Qty,Product Name\n2026-10-09,Shop,1,New product' }) },
      'api/methods.ts': {
        resolveDatedStockCountRows: async () => ({ success: true, resolved: [], unresolved: [row] }),
        applyDatedStockCountDecisions: async (payload: Record<string, any>) => { calls.push(JSON.parse(JSON.stringify(payload))); return response(payload) },
        previewDatedStockCount: async () => ({ success: true, plan: { movementsToCreate: [] } }), applyDatedStockCount: async () => ({ success: true }),
      },
    },
  })
  const review = async (surface: any, lang: string) => {
    await surface.click(surface.button(packs[lang].dated_count_choose_file))
    await surface.click(surface.button(packs[lang].continue))
    await surface.click(surface.button(packs[lang].dated_count_build_preview))
  }
  const stored = () => {
    const key = Array.from({ length: browser.localStorage.length }, (_, i) => browser.localStorage.key(i)!).find(key => key.startsWith('dated-decision-intent:'))!
    return { key, raw: browser.localStorage.getItem(key)! }
  }
  const complete = { success: true, complete: true, next: 2, total: 2, resolved: [{ rowNumber: 1, date: row.raw.date, productId: 12, branchId: 1, count: 1 }], errors: [] }
  for (const [lang, width] of [['en', 1280], ['km', 375]] as const) {
    browser.innerWidth = width
    browser.localStorage.clear()
    calls.length = 0
    response = async () => { throw Error('Synthetic acknowledgement lost') }
    let surface = await harness.mount(mountOptions(lang))
    await review(surface, lang)
    assert.equal(calls.length, 1)
    assert.ok(surface.text().includes(packs[lang].dated_decision_outcome_unknown))
    const saved = stored()
    await surface.unmount()
    surface = await harness.mount(mountOptions(lang))
    const resume = surface.button(packs[lang].dated_decision_resume)
    assert.equal(resume.children[0].tagName.toLowerCase(), 'svg', 'resume starts with icon')
    assert.ok(resume.className.includes('max-w-full'))
    let continueProgress!: () => void
    response = async () => {
      if (calls.length === 2) return { success: true, complete: false, next: 1, total: 2, resolved: [], errors: [] }
      await new Promise<void>(resolve => { continueProgress = resolve })
      return complete
    }
    await surface.click(resume, { until: () => Boolean(continueProgress) })
    assert.ok(surface.text().includes(packs[lang].dated_decision_progress.replace('{next}', '1').replace('{total}', '2')))
    continueProgress(); await surface.settle()
    assert.equal(calls.length, 3); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2])
    assert.equal(calls[0].offline_owner.actor_id, 7); assert.equal(calls[0].offline_owner.authority, 'https://admin.example.test')
    await surface.unmount()
    for (const thrown of [false, true]) {
      browser.localStorage.setItem(saved.key, saved.raw)
      response = async () => { if (thrown) throw Object.assign(new Error('Raw reset'), { code: resetFailure.code, status: 409 }); return resetFailure }
      surface = await harness.mount(mountOptions(lang))
      const count: number = calls.length
      await surface.click(surface.button(packs[lang].dated_decision_resume))
      assert.equal(calls.length, count + 1)
      assert.equal(browser.localStorage.getItem(saved.key), null)
      assert.ok(surface.text().includes(packs[lang].dated_decision_reset_conflict))
      assert.equal(surface.findAll(node => node.tagName === 'BUTTON' && node.textContent.includes(packs[lang].dated_decision_resume)).length, 0)
      response = async () => complete
      await review(surface, lang)
      assert.notEqual(calls.at(-1)!.client_request_id, calls[count].client_request_id, 'only explicit new review creates new identity')
      await surface.unmount()
    }
    browser.localStorage.setItem(saved.key, saved.raw)
    const remove = browser.localStorage.removeItem
    browser.localStorage.removeItem = () => { throw Error('Denied') }
    response = async () => resetFailure
    surface = await harness.mount(mountOptions(lang))
    await surface.click(surface.button(packs[lang].dated_decision_resume))
    assert.equal(browser.localStorage.getItem(saved.key), saved.raw)
    assert.ok(surface.text().includes(packs[lang].dated_decision_retirement_failed))
    assert.ok(surface.button(packs[lang].dated_decision_resume))
    browser.localStorage.removeItem = remove
    await surface.unmount()
    browser.localStorage.setItem(saved.key, '{corrupt')
    surface = await harness.mount(mountOptions(lang))
    assert.ok(surface.text().includes(packs[lang].dated_decision_storage_unreadable))
    assert.equal(browser.localStorage.getItem(saved.key), '{corrupt')
    await surface.unmount()
    const readStorage = browser.localStorage.getItem
    browser.localStorage.getItem = (key: string) => { if (key.startsWith('dated-decision-intent:')) throw Error('Read denied'); return readStorage(key) }
    const beforeDeniedRead = calls.length
    surface = await harness.mount(mountOptions(lang))
    assert.ok(surface.text().includes(packs[lang].dated_decision_storage_unreadable))
    assert.equal(calls.length, beforeDeniedRead)
    browser.localStorage.getItem = readStorage
    await surface.unmount()
    console.log(`PASS mounted ${lang} width ${width}: actual ownership/storage, localized icon-first lostACK remount/progress/reset, explicit fresh review, denied removal and corrupt storage`)
  }
} finally { await harness.close() }
