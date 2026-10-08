import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import ts from 'typescript'
import { act } from 'react'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import { scopedWorkDraftKey, writeWorkDraft, readWorkDraft, clearWorkDraft } from '../src/utils/workDrafts.ts'
import { STORAGE_KEYS } from '../src/constants.ts'
import { resetClientRuntimeState, shouldResetForRuntimeChange, sanitizeSyncServerUrl } from '../src/platform/runtime/clientRuntime.ts'

const nativeFetch = globalThis.fetch
Object.assign(globalThis, { alert: (message: unknown) => console.log('ALERT', message) })
const submissions: Array<{ authority: string; name: string }> = []
async function origin(authority: string) {
  const server = createServer(async (req, res) => {
    if (req.headers.cookie !== `session=${authority}-own-session`) { res.writeHead(401); res.end(); return }
    let raw = ''; for await (const part of req) raw += part
    if (req.method === 'POST') submissions.push({ authority, name: JSON.parse(raw).name })
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, user: { id: 42, organization_id: 1 } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}
const A = await origin('A'), B = await origin('B')
assert.equal((await nativeFetch(`${A.url}/api/me`, { headers: { Cookie: 'session=A-own-session' } })).status, 200)
assert.equal((await nativeFetch(`${B.url}/api/me`, { headers: { Cookie: 'session=B-own-session' } })).status, 200)
assert.equal((await nativeFetch(`${B.url}/api/me`, { headers: { Cookie: 'session=A-own-session' } })).status, 401, 'A credentials do not authorize B')
const harness = await createHarness({ observe: ['api/methods.ts'] })
const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
let syncUrl = A.url
let healthChecks = 0
const app: Record<string, unknown> = { user, page: 'server', t: () => '', notify() {}, syncUrl, settings: {}, formatDateTime: String }
const source = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const callback = source.match(/const updateSyncUrl = useCallback\((\(url: unknown\) => \{[\s\S]*?\n  \}), \[\]\)/)?.[1]
assert.ok(callback, 'execute the actual bounded AppContext callback, never a copied implementation')
const expression = ts.transpileModule(`const callback = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const updateSyncUrl = new Function('sanitizeSyncServerUrl', 'STORAGE_KEYS', '_setSyncUrl', 'getAppApi', 'startHealthCheck', `${expression}; return callback`)(
  sanitizeSyncServerUrl, STORAGE_KEYS, (url: string) => { syncUrl = url; app.syncUrl = url },
  () => ({ setSyncServerUrl() {} }), () => { healthChecks++ },
) as (url: string | null) => void
app.updateSyncUrl = updateSyncUrl
const browser = window as unknown as { api: Record<string, unknown> }
browser.api = { getSystemConfig: async () => ({}), getSystemDebugLog: async () => [], getOnlineClients: async () => ({ clients: 1 }), getSuppliers: async () => [], getBranches: async () => [], getCategories: async () => [], getUnits: async () => [] }
localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)); sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)); updateSyncUrl(A.url)
const doubles = { 'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) } }
const props: Record<string, unknown> = {
  product: null, categories: [], units: [], branches: [], user, t: (key: string) => key === 'save' ? 'Save' : key === 'cancel' ? 'Cancel' : '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
  onClose() {}, onSave: async (payload: Record<string, unknown>) => {
    const authority = syncUrl === A.url ? 'A' : 'B'
    const response = await nativeFetch(`${syncUrl}/api/products`, { method: 'POST', headers: { Cookie: `session=${authority}-own-session`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(response.status, 200, 'the selected authority accepts its own authenticated session')
  },
}
async function switchServer(url: string) {
  const server = await harness.mount({ component: 'components/server/ServerPage.tsx', app, doubles })
  await server.click(server.button(/Advanced/))
  await server.type(server.find(node => node.id === 'server-manual-url', 'manual URL'), url)
  await server.click(server.button('Save and Reconnect'))
  await server.unmount()
  assert.equal(syncUrl, url)
}
try {
  const aForm = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
  await act(async () => { (propsOf(aForm.find(node => node.id === 'product-name', 'name')).onChange as (event: unknown) => void)({ target: { value: 'A private product' } }) })
  await aForm.unmount()
  await switchServer(B.url)
  const bForm = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
  const bName = String(propsOf(bForm.find(node => node.id === 'product-name', 'B name')).value || '')
  console.log(`MEASURE same actor/org B restored name=${JSON.stringify(bName)}`)
  if (process.env.ACCOUNT_DRAFT_BASELINE === '1') {
    assert.equal(bName, 'A private product')
    await bForm.click(bForm.button('Save'))
    await bForm.click(bForm.button('Create Products'))
    assert.deepEqual(submissions, [{ authority: 'B', name: 'A private product' }])
    console.log('BASELINE proven: actual mounted Save/Reconnect restores A and explicit confirmed Save reaches B own accepted session')
  } else {
    assert.equal(bName, '', 'B must never restore A product')
    await bForm.type(bForm.find(node => node.id === 'product-name', 'B name'), 'B own product')
    await bForm.click(bForm.button('Save'))
    await bForm.click(bForm.button('Create Products'))
    assert.deepEqual(submissions, [{ authority: 'B', name: 'B own product' }], 'a valid B draft saves with B own accepted session')
  }
  await bForm.unmount()
  await switchServer(A.url)
  const returned = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
  if (process.env.ACCOUNT_DRAFT_BASELINE !== '1') assert.equal(propsOf(returned.find(node => node.id === 'product-name', 'A return name')).value, 'A private product')
  await returned.unmount()
  if (process.env.ACCOUNT_DRAFT_BASELINE !== '1') {
    const waiting = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    await waiting.click(waiting.button('Save'))
    await switchServer(B.url)
    await waiting.click(waiting.button('Create Products'))
    assert.equal(submissions.length, 1, 'a pending A confirmation cannot submit its frozen payload to B')
    await waiting.unmount()
  }
  if (process.env.ACCOUNT_DRAFT_BASELINE !== '1') {
    await switchServer(A.url)
    const live = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    assert.equal(propsOf(live.find(node => node.id === 'product-name', 'live A name')).value, 'A private product')
    await switchServer(B.url)
    await live.render(props)
    assert.equal(propsOf(live.find(node => node.id === 'product-name', 'live B name')).value, '')
    await live.type(live.find(node => node.id === 'product-name', 'live B edit'), 'B live unsaved')
    await switchServer(A.url)
    await live.render(props)
    assert.equal(propsOf(live.find(node => node.id === 'product-name', 'live return A')).value, 'A private product')
    await live.unmount()
    let brandWrites = 0
    const brandDoubles = { ...doubles, 'api/renameCascadeTransport.ts': {
      getRenameImpact: async () => ({ kind: 'brand', products_primary: 2, products_secondary: 0, group_rows: 0, batches: 0 }),
      renameBrandEverywhere: async () => { brandWrites++ },
    } }
    const brand = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props: { ...props, product: { id: 991, name: 'Stable product', brand: 'Old brand' } }, app, doubles: brandDoubles })
    await brand.type(brand.find(node => node.id === 'product-brand', 'brand'), 'New brand')
    await brand.click(brand.button('Save'))
    await switchServer(B.url)
    await brand.click(brand.button(/rename_choice_carry/))
    assert.equal(brandWrites, 0, 'late A brand choice never starts a B rename write')
    await brand.unmount()
    await switchServer(A.url)
    let resolveSaved: (() => void) | undefined
    const saved = new Promise<void>(resolve => { resolveSaved = resolve })
    let closed = 0
    const lateProps = { ...props, onClose: () => { closed++ }, onSave: async (payload: Record<string, unknown>) => { await (props.onSave as (value: Record<string, unknown>) => Promise<void>)(payload); await saved } }
    const late = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props: lateProps, app, doubles })
    await late.click(late.button('Save')); await late.click(late.button('Create Products'))
    const aSubmitted = scopedWorkDraftKey('product_new_standalone-create')
    await switchServer(B.url)
    const bOwned = scopedWorkDraftKey('product_new_standalone-create')
    writeWorkDraft(bOwned, { form: { name: 'B owned draft' }, imageList: [] })
    await late.render(lateProps)
    assert.equal(propsOf(late.find(node => node.id === 'product-name', 'new B owned form')).value, 'B owned draft')
    await act(async () => { resolveSaved?.(); await saved })
    await late.settle()
    assert.equal(closed, 0, 'a stale A completion cannot close the newly B-owned form')
    assert.equal(readWorkDraft<{ form: { name: string } }>(bOwned)?.data.form.name, 'B owned draft')
    assert.equal(readWorkDraft(aSubmitted), null, 'definitively saved unchanged A intent is cleared without touching B')
    await late.unmount()
    await switchServer(A.url)
    const successReturn = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    assert.equal(propsOf(successReturn.find(node => node.id === 'product-name', 'success return A name')).value, '', 'switching back cannot resubmit an already successful A create draft')
    await successReturn.unmount()
    await switchServer(B.url)
    console.log('PASS mounted live rerender, delayed brand choice, and stale committed completion preserve owned drafts')
    clearWorkDraft(bOwned)
    const legacyKey = 'businessos_draft_org-1_42_product_new'
    const legacyBytes = JSON.stringify({ at: Date.now(), data: { name: 'UNKNOWN PRIVATE LEGACY' } })
    localStorage.setItem(legacyKey, legacyBytes)
    const legacy = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    assert.equal(propsOf(legacy.find(node => node.id === 'product-name', 'legacy name')).value, '')
    assert.ok(legacy.text().includes('Its server cannot be verified'))
    assert.ok(!legacy.text().includes('UNKNOWN PRIVATE LEGACY'))
    await legacy.unmount()
    assert.equal(localStorage.getItem(legacyKey), legacyBytes)
    const otherUser = { ...user, organization_public_id: 'org-2' }
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(otherUser)); sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(otherUser))
    const otherOrg = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props: { ...props, user: otherUser }, app, doubles })
    assert.equal(propsOf(otherOrg.find(node => node.id === 'product-name', 'other org name')).value, '')
    await otherOrg.unmount()
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)); sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
    await resetClientRuntimeState({ clearAuth: true, mirrorTables: [], preserveServiceWorker: true })
    assert.equal(localStorage.getItem(legacyKey), null, 'completed logout keeps explicit clearing policy')
    assert.equal(localStorage.getItem(STORAGE_KEYS.USER), null)
    assert.equal(sessionStorage.getItem(STORAGE_KEYS.USER), null)
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user)); sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
    const beforeReset = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    await beforeReset.type(beforeReset.find(node => node.id === 'product-name', 'before root reset name'), 'B before data-root reset')
    await beforeReset.unmount()
    assert.equal(shouldResetForRuntimeChange({ dataRootKey: 'root-a' }, { dataRootKey: 'root-b' }), true)
    await resetClientRuntimeState({ preserveAuth: true, mirrorTables: [], preserveServiceWorker: true })
    const afterReset = await harness.mount({ component: 'components/products/forms/ProductForm.tsx', props, app, doubles })
    assert.equal(propsOf(afterReset.find(node => node.id === 'product-name', 'after root reset name')).value, '')
    await afterReset.unmount()
    console.log('PASS legacy bytes/neutral notice, distinct organization, actual completed logout and data-root runtime reset')
  }
  assert.ok(healthChecks >= 3)
  console.log('PASS mounted draft authority round-trip; synthetic authenticated HTTP origins, no physical cookie/device certificate')
} finally { await harness.close(); await A.close(); await B.close() }


