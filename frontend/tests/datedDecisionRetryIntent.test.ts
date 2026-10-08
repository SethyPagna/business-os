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
const owner = () => ({ version: 1, actor_id: actor, organization_id: null, authority: 'https://dated.example', runtime: 'cloudflare-workers' })
const values = new Map<string, string>()
const authStore = { getItem: (key: string) => key === 'user' ? JSON.stringify({ id: actor, organization_id: null }) : values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
Object.assign(globalThis, { window: { location: { origin: 'https://dated.example' }, sessionStorage: authStore, localStorage: authStore } })
const ownership = load('api/offlineQueueOwnership.ts', { '../constants.ts': { STORAGE_KEYS: { USER: 'user' } }, './httpState.ts': { getSyncServerUrl: () => 'https://dated.example' } })
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
assert.throws(() => transport.prepareDatedDecisionIntent({ resolved: [1], unresolved: [], decisions: [] }), /Resume/)
actor = 8; assert.equal(transport.loadDatedDecisionIntent(), null); actor = 7
assert.deepEqual(transport.loadDatedDecisionIntent(), frozen)
actor = 9
const oldSet = authStore.setItem
authStore.setItem = () => { throw Error('Storage blocked') }
assert.throws(() => transport.prepareDatedDecisionIntent({ resolved: [], unresolved: [], decisions: [] }), /Storage blocked/)
assert.equal(sent.length, 2)
authStore.setItem = oldSet; actor = 7
console.log('PASS durable owner-scoped intent survives reload and refuses changed pending choices')
console.log('PASS real transport freezes request/owner across retries and rejects reassignment')
const harness = await createHarness({ observe: ["api/browserDialogs.ts", "api/offlineQueueOwnership.ts", "api/methods.ts"] })
try {
  const calls: Record<string, any>[] = []; let lost = true
  const row = { rowNumber: 1, branchId: 1, reason: 'product_not_found', suggestedActions: ['create_new'], raw: { rowNumber: 1, date: '2026-10-09', branchName: 'Shop', productName: 'New product', count: 1 } }
  const mountOptions = {
    component: 'components/products/import/DatedStockReconciliationModal.tsx', app: { t: (key: string) => key }, props: { t: (_key: string, fallback: string) => fallback, onClose() {}, onDone() {} },
    doubles: {
      'api/browserDialogs.ts': { openCSVDialog: async () => ({ name: 'dated.csv', content: 'Date,Branch,Qty,Product Name\n2026-10-09,Shop,1,New product' }) },
      'api/offlineQueueOwnership.ts': { stampOfflineSaleOwner: (payload: Record<string, unknown>) => ({ ...payload, offline_owner: owner() }) },
      'api/methods.ts': {
        resolveDatedStockCountRows: async () => ({ success: true, resolved: [], unresolved: [row] }),
        applyDatedStockCountDecisions: async (payload: Record<string, any>) => {
          calls.push(JSON.parse(JSON.stringify(payload)))
          if (lost) { lost = false; throw Error('Synthetic acknowledgement lost') }
          if (calls.length === 2) return { success: true, complete: false, next: 1, total: 2, resolved: [], errors: [] }
          return { success: true, complete: true, next: 2, total: 2, resolved: [{ rowNumber: 1, date: row.raw.date, productId: 12, branchId: 1, count: 1 }], errors: [] }
        },
        previewDatedStockCount: async () => ({ success: true, plan: { movementsToCreate: [] } }), applyDatedStockCount: async () => ({ success: true }),
      },
    },
  }
  let surface = await harness.mount(mountOptions)
  await surface.click(surface.button(/Choose File/)); await surface.waitFor(() => !surface.text().includes('Reading file...'), 'file mapping'); await surface.click(surface.button(/Analyze|Resolve|Continue/)); await surface.waitFor(() => surface.text().includes('New product'), 'review')
  await surface.click(surface.button(/Apply.*Decision|Continue/))
  assert.equal(calls.length, 1); assert.ok(surface.text().includes('Synthetic acknowledgement lost'))
  await surface.unmount()
  surface = await harness.mount(mountOptions)
  assert.ok(surface.text().includes('Resume saved decisions'))
  await surface.click(surface.button('Resume saved decisions'))
  assert.equal(calls.length, 3); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2])
  assert.match(calls[0].client_request_id, /^[A-Za-z0-9_-]{8,120}$/); assert.equal(calls[0].offline_owner.actor_id, 7)
  console.log('PASS mounted modal resumes frozen identity after remount and continues saved progress')
} finally { await harness.close() }




