import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { createHarness } from './mountedComponentHarness.ts'
function load(file: string, dependencies: Record<string, unknown>) {
  const source = process.env.DATED_COUNT_APPLY_BASELINE && file === 'api/inventoryWriteTransport.ts'
    ? execFileSync('git', ['show', 'ebb1ba946:frontend/src/api/inventoryWriteTransport.ts'], { encoding: 'utf8' })
    : fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', output)((name: string) => { if (!(name in dependencies)) throw Error(`Missing ${name}`); return dependencies[name] }, module, module.exports)
  return module.exports
}
let actor = 7, organization: number | null = null, authority = 'https://dated.example'
const values = new Map<string, string>()
const store = { getItem: (key: string) => key === 'user' ? JSON.stringify({ id: actor, organization_id: organization }) : values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
Object.assign(globalThis, { window: { location: { origin: authority }, sessionStorage: store, localStorage: store } })
const ownership = load('api/offlineQueueOwnership.ts', { '../constants.ts': { STORAGE_KEYS: { USER: 'user' } }, './httpState.ts': { getSyncServerUrl: () => authority } })
const sent: any[] = []
let afterFirst = () => {}
const transport = load('api/inventoryWriteTransport.ts', {
  './http.ts': { route: async (_name: string, run: () => Promise<unknown>) => { await run(); afterFirst(); return run() }, apiFetch: async (_method: string, _path: string, body: unknown) => { sent.push(JSON.parse(JSON.stringify(body))); return { success: true } } },
  './requestIds.ts': load('api/requestIds.ts', {}), './offlineQueueOwnership.ts': ownership,
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_name: 'Fixture' }) }, './branchTransport.ts': {}, './transferRunRecovery.ts': {}, './batchesTransport.ts': {},
})
const entries = [{ date: '2026-10-09', productId: 12, branchId: 1, addressedBranchId: 3, count: 2 }]
const supplied = { entries: structuredClone(entries), client_request_id: 'dated_apply_fixed_001', offline_owner: ownership.stampOfflineSaleOwner({}).offline_owner }
afterFirst = () => { supplied.entries[0].count = 99 }
await transport.applyDatedStockCount(supplied)
assert.equal(sent[0].client_request_id, 'dated_apply_fixed_001', 'actual APPLY transport carries original request ID')
assert.deepEqual(sent[0], sent[1], 'route retry freezes body before network')
assert.equal(sent[1].entries[0].count, 2); assert.equal(sent[1].entries[0].addressedBranchId, 3)
assert.deepEqual(Object.keys(sent[0]).sort(), ['client_request_id', 'entries', 'offline_owner'])
assert.throws(() => transport.applyDatedStockCount({ entries }), /dated_count_invalid_id/)
assert.throws(() => transport.applyDatedStockCount({ ...supplied, client_request_id: 123456789 }), /dated_count_invalid_id/)
assert.throws(() => transport.applyDatedStockCount({ entries, client_request_id: 'dated_apply_fixed_001' }), /dated_count_owner_mismatch/)
actor = 8; assert.throws(() => transport.applyDatedStockCount(supplied), /dated_count_owner_mismatch/); actor = 7
const intent = transport.prepareDatedCountApplyIntent(entries)
assert.equal(transport.loadDatedCountApplyIntent(), null, 'caller captures intent before synchronous durable save')
transport.saveDatedCountApplyIntent(intent)
assert.deepEqual(transport.prepareDatedCountApplyIntent(entries), intent)
assert.throws(() => transport.prepareDatedCountApplyIntent([{ ...entries[0], count: 3 }]), /dated_count_pending_review/)
const key = [...values.keys()][0], raw = values.get(key)!
for (const change of [() => { actor = 8 }, () => { organization = 2 }, () => { authority = 'https://other.example' }]) {
  change(); assert.equal(transport.loadDatedCountApplyIntent(), null)
  assert.throws(() => transport.saveDatedCountApplyIntent(intent))
  assert.equal(values.get(key), raw); actor = 7; organization = null; authority = 'https://dated.example'
}
const reset = { code: 'dated_count_reset_conflict', success: false }
for (const changed of [null, '{corrupt', JSON.stringify({ ...intent, canonical: 'corrupt' }), JSON.stringify({ ...intent, body: { ...intent.body, client_request_id: 'newer_identity_002' } }), JSON.stringify({ ...intent, body: { ...intent.body, offline_owner: { ...supplied.offline_owner, actor_id: 8 } } })]) {
  if (changed === null) values.delete(key); else values.set(key, changed)
  assert.throws(() => transport.retireResetDatedCountApplyIntent(intent, reset))
  assert.equal(values.get(key) ?? null, changed)
}
values.set(key, raw)
assert.throws(() => transport.retireResetDatedCountApplyIntent(intent, Error('Network unknown')))
assert.equal(values.get(key), raw)
const originalRemove = store.removeItem
for (const remove of [() => { throw Error('Denied') }, () => {}]) {
  store.removeItem = remove; assert.throws(() => transport.retireResetDatedCountApplyIntent(intent, reset), /dated_count_retirement_failed/); assert.equal(values.get(key), raw)
}
store.removeItem = originalRemove
transport.retireResetDatedCountApplyIntent(intent, Object.assign(Error('Raw reset'), reset))
assert.equal(transport.loadDatedCountApplyIntent(), null); assert.equal(sent.length, 2)
transport.saveDatedCountApplyIntent(intent)
transport.saveDatedCountApplyIntent({ ...intent, completed: true })
const identicalReview = transport.prepareDatedCountApplyIntent(entries)
assert.notEqual(identicalReview.body.client_request_id, intent.body.client_request_id)
transport.saveDatedCountApplyIntent(identicalReview, true)
assert.throws(() => transport.saveDatedCountApplyIntent(intent), /dated_count_pending_review/)
console.log('PASS actual immutable transport, original-ID storage, owner/server isolation, exact reset retirement, corrupt/newer refusal and explicit identical new review')
const packs = Object.fromEntries(['en', 'km'].map(lang => [lang, JSON.parse(fs.readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))]))
const harness = await createHarness({ observe: ['api/browserDialogs.ts', 'api/methods.ts'] })
try {
  const browser = window as unknown as { innerWidth: number; localStorage: Storage; sessionStorage: Storage }
  browser.sessionStorage.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: null }))
  const calls: any[] = []
  let response: () => Promise<unknown>
  const row = { rowNumber: 1, date: '2026-10-09', productId: 12, branchId: 1, addressedBranchId: 3, count: 2 }
  const options = (lang: string) => ({
    component: 'components/products/import/DatedStockReconciliationModal.tsx', app: { t: (key: string) => packs[lang][key] || key }, props: { t: (key: string) => packs[lang][key] || key, onClose() {}, onDone() {} },
    doubles: {
      'api/browserDialogs.ts': { openCSVDialog: async () => ({ name: 'dated.csv', content: 'Date,Branch,Qty,Product Name\n2026-10-09,Shop,2,Product' }) },
      'api/methods.ts': {
        resolveDatedStockCountRows: async () => ({ success: true, resolved: [row], unresolved: [] }),
        applyDatedStockCountDecisions: async () => ({ success: true, complete: true, resolved: [row], errors: [] }),
        previewDatedStockCount: async () => ({ success: true, plan: { movementsToCreate: [] } }),
        applyDatedStockCount: async (body: any) => { calls.push(structuredClone(body)); return response() },
      },
    },
  })
  const review = async (surface: any, lang: string) => {
    await surface.click(surface.button(packs[lang].dated_count_choose_file))
    await surface.click(surface.button(packs[lang].continue))
    await surface.click(surface.button(packs[lang].dated_count_build_preview))
    await surface.click(surface.button(packs[lang].dated_count_confirm_import))
  }
  const saved = () => {
    const key = Array.from({ length: browser.localStorage.length }, (_, i) => browser.localStorage.key(i)!).find(key => key.startsWith('dated-count-apply-intent:'))!
    return { key, raw: browser.localStorage.getItem(key)! }
  }
  for (const [lang, width] of [['en', 1280], ['km', 375]] as const) {
    browser.innerWidth = width; browser.localStorage.clear(); calls.length = 0
    response = async () => { throw Error('Lost acknowledgement') }
    let surface = await harness.mount(options(lang)); await review(surface, lang)
    assert.equal(calls.length, 1); assert.ok(surface.text().includes(packs[lang].dated_count_outcome_unknown))
    assert.equal(calls[0].entries[0].addressedBranchId, 3)
    const pending = saved(); await surface.unmount(); surface = await harness.mount(options(lang))
    const resume = surface.button(packs[lang].dated_count_resume)
    assert.equal(resume.children[0].tagName.toLowerCase(), 'svg'); assert.ok(resume.className.includes('max-w-full'))
    response = async () => ({ success: true, movementsCreated: 1, replayed: true })
    await surface.click(resume); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].offline_owner.actor_id, 7)
    await surface.unmount(); surface = await harness.mount(options(lang)); await review(surface, lang)
    assert.notEqual(calls[2].client_request_id, calls[0].client_request_id, 'explicit identical reviewed next count is a new intent')
    await surface.unmount()
    for (const thrown of [false, true]) {
      browser.localStorage.setItem(pending.key, pending.raw)
      response = async () => { if (thrown) throw Object.assign(Error('Raw reset'), reset); return reset }
      surface = await harness.mount(options(lang)); const before: number = calls.length
      await surface.click(surface.button(packs[lang].dated_count_resume))
      assert.equal(calls.length, before + 1); assert.equal(browser.localStorage.getItem(pending.key), null)
      assert.ok(surface.text().includes(packs[lang].dated_count_reset_conflict))
      response = async () => ({ success: true }); await review(surface, lang)
      assert.notEqual(calls.at(-1).client_request_id, calls[before].client_request_id)
      await surface.unmount()
    }
    browser.localStorage.setItem(pending.key, pending.raw)
    const remove = browser.localStorage.removeItem
    browser.localStorage.removeItem = () => { throw Error('Denied') }
    response = async () => reset; surface = await harness.mount(options(lang))
    await surface.click(surface.button(packs[lang].dated_count_resume))
    assert.equal(browser.localStorage.getItem(pending.key), pending.raw)
    assert.ok(surface.text().includes(packs[lang].dated_count_retirement_failed)); assert.ok(surface.button(packs[lang].dated_count_resume))
    browser.localStorage.removeItem = remove; await surface.unmount()
    for (const [code, flag, allowed] of [['dated_count_over_plan_budget', false, false], ['dated_count_outcome_unknown', true, false], ['dated_count_over_plan_budget', true, true]] as const) {
      browser.localStorage.setItem(pending.key, pending.raw); response = async () => ({ success: false, code, can_review_again: flag })
      surface = await harness.mount(options(lang)); await surface.click(surface.button(packs[lang].dated_count_resume))
      const smaller = surface.findAll((node: any) => node.tagName === 'BUTTON' && node.textContent.includes(packs[lang].dated_count_review_smaller))
      assert.equal(smaller.length, allowed ? 1 : 0)
      if (allowed) {
        response = async () => { throw Error('Retry acknowledgement lost') }
        await surface.click(surface.button(packs[lang].dated_count_resume))
        assert.equal(JSON.parse(browser.localStorage.getItem(pending.key)!).canReviewAgain, false, 'dispatch retires prior safe-review permission before an uncertain retry')
        assert.equal(surface.findAll((node: any) => node.tagName === 'BUTTON' && node.textContent.includes(packs[lang].dated_count_review_smaller)).length, 0)
        response = async () => ({ success: false, code, can_review_again: true })
        await surface.click(surface.button(packs[lang].dated_count_resume))
        await surface.click(surface.button(packs[lang].dated_count_review_smaller)); response = async () => ({ success: true }); await review(surface, lang); assert.notEqual(calls.at(-1).client_request_id, JSON.parse(pending.raw).body.client_request_id) }
      else assert.equal(JSON.parse(browser.localStorage.getItem(pending.key)!).body.client_request_id, JSON.parse(pending.raw).body.client_request_id)
      await surface.unmount()
    }
    browser.localStorage.clear()
    const set = browser.localStorage.setItem
    let deniedId = ''
    browser.localStorage.setItem = (key, value) => { if (key.startsWith('dated-count-apply-intent:')) { deniedId = JSON.parse(value).body.client_request_id; throw Error('Denied') } set.call(browser.localStorage, key, value) }
    surface = await harness.mount(options(lang)); const before: number = calls.length; await review(surface, lang)
    assert.equal(calls.length, before, 'no first send without verified durable storage')
    assert.ok(surface.text().includes(packs[lang].dated_count_storage_save_failed)); assert.ok(surface.button(packs[lang].dated_count_resume))
    browser.localStorage.setItem = set; response = async () => ({ success: true }); await surface.click(surface.button(packs[lang].dated_count_resume)); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).client_request_id, deniedId, 'storage denial retains exact captured memory identity')
    await surface.unmount()
    browser.localStorage.clear()
    response = async () => {
      browser.localStorage.setItem = (key, value) => { if (key.startsWith('dated-count-apply-intent:')) throw Error('Completion storage denied'); set.call(browser.localStorage, key, value) }
      return { success: true }
    }
    surface = await harness.mount(options(lang)); await review(surface, lang)
    const acknowledged = calls.at(-1).client_request_id
    assert.ok(surface.button(packs[lang].dated_count_resume), 'completion checkpoint failure retains original pending identity')
    assert.equal(JSON.parse(saved().raw).completed, false)
    browser.localStorage.setItem = set; response = async () => ({ success: true, replayed: true })
    await surface.click(surface.button(packs[lang].dated_count_resume)); assert.equal(calls.at(-1).client_request_id, acknowledged)
    await surface.unmount()
    browser.localStorage.setItem(pending.key, pending.raw)
    surface = await harness.mount(options(lang))
    browser.sessionStorage.setItem('businessos_user', JSON.stringify({ id: 8, organization_id: null }))
    const otherBefore: number = calls.length
    await surface.click(surface.button(packs[lang].dated_count_resume)); assert.equal(calls.length, otherBefore)
    assert.equal(browser.localStorage.getItem(pending.key), pending.raw)
    assert.ok(surface.text().includes(packs[lang].dated_count_owner_mismatch))
    await surface.unmount()
    surface = await harness.mount(options(lang))
    assert.equal(surface.findAll((node: any) => node.tagName === 'BUTTON' && node.textContent.includes(packs[lang].dated_count_resume)).length, 0, 'account switch does not expose another owner intent')
    await surface.unmount()
    browser.sessionStorage.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: null }))
    browser.localStorage.setItem(pending.key, '{corrupt'); surface = await harness.mount(options(lang))
    assert.ok(surface.text().includes(packs[lang].dated_count_storage_unreadable)); assert.equal(browser.localStorage.getItem(pending.key), '{corrupt')
    await surface.unmount()
  }
  console.log('PASS mounted desktop EN/narrow KM: lost ACK/remount, explicit identical review, returned/thrown reset, removal/storage denial, typed predispatch smaller review, unknown retention')
} finally { await harness.close() }
