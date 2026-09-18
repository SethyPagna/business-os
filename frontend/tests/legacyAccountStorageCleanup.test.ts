import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import { STORAGE_KEYS } from '../src/constants.ts'

// Execute the whole production module, exposing its private cleanup only in
// this fixture. The async mirror boundary is stubbed; storage behavior is real.
const source = fs.readFileSync(new URL('../src/platform/runtime/clientRuntime.ts', import.meta.url), 'utf8')
const withMirrorStub = source.replaceAll("import('../../api/localDb.ts')", "Promise.resolve(require('../../api/localDb.ts'))")
const compiled = transformSync(`${withMirrorStub}\nexport { clearStorage };`, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const localDbCalls: string[] = []
let duringMirrorReset = () => {}
const localDb = {
  async resetLocalMirrorDbPreservingOfflineWork() { localDbCalls.push('preserve'); duringMirrorReset() },
  async resetLocalMirrorDb() { localDbCalls.push('reset'); duringMirrorReset() },
  async clearLocalMirrorTables() { localDbCalls.push('scoped'); duringMirrorReset() },
}
const runtimeModule = { exports: {} as {
  clearStorage(storage: Storage | null, preserve: Set<string>): void
  resetClientRuntimeState(options: Record<string, unknown>): Promise<void>
} }
new Function('require', 'module', 'exports', compiled)((request: string) => {
  if (request === '../../constants.ts') return { STORAGE_KEYS }
  if (request === '../../api/localDb.ts') return localDb
  throw new Error(`Unexpected production dependency: ${request}`)
}, runtimeModule, runtimeModule.exports)

function memoryStorage(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries))
  return {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.get(key) ?? null },
    key(index) { return [...values.keys()][index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, String(value)) },
  }
}
const legacy = [
  'pos_search', 'pos_cat', 'pos_brand', 'pos_branch', 'pos_stock', 'pos_group',
  'pos_supplier', 'pos_initial', 'bos_pos_orders', 'bos_pos_active', 'bos_pos_counter',
  'bos_dashboard_filters:11', 'bos_dashboard_filters:cashier_a', 'bos_dashboard_filters:a@example.test',
]
const unrelated = ['pos_cart_view', 'pos_search_backup', 'pos_other_app', 'bos_other_app', 'bos_pos_orders_backup', 'bos_dashboard_filters_backup:11', 'bos_dashboard_filters:', 'unrelated']
const pending = ['businessos_pending_sale-add-items_v2:a', 'businessos_pending_sale-amendment_v2:a', 'businessos_pending_return_create_v1:a']
const values = Object.fromEntries([...legacy, ...unrelated, ...pending, 'businessos_user', 'business_os_old'].map(key => [key, `${key}:malformed{`]))

const direct = memoryStorage(values)
runtimeModule.exports.clearStorage(direct, new Set(['pos_search', 'bos_dashboard_filters:11', 'businessos_user']))
for (const key of legacy) assert.equal(direct.getItem(key), ['pos_search', 'bos_dashboard_filters:11'].includes(key) ? values[key] : null, key)
for (const key of [...unrelated, ...pending, 'businessos_user']) assert.equal(direct.getItem(key), values[key], key)
assert.equal(direct.getItem('business_os_old'), null)
console.log('PASS real cleanup removes explicit legacy keys, honors preserveKeys, and preserves unrelated keys and malformed pending attempts')

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const local = memoryStorage({ ...values, [STORAGE_KEYS.DEVICE_SETTINGS]: 'device', [STORAGE_KEYS.DEVICE_ID]: 'device-id', businessos_read_session: 'old-marker', businessos_auth_cookie_pending: 'old-owner' })
const session = memoryStorage(values)
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: local, sessionStorage: session } })
try {
  duringMirrorReset = () => {
    local.setItem('businessos_read_session', 'new-marker')
    local.setItem('businessos_auth_cookie_pending', 'new-owner')
    local.setItem(pending[0], 'newer malformed evidence{')
  }
  await runtimeModule.exports.resetClientRuntimeState({ preserveServiceWorker: true, preserveOfflineWork: true })
  for (const storage of [local, session]) {
    for (const key of legacy) assert.equal(storage.getItem(key), null, key)
    for (const key of unrelated) assert.equal(storage.getItem(key), values[key], key)
    assert.equal(storage.getItem('businessos_user'), null)
    assert.equal(storage.getItem('business_os_old'), null)
    for (const key of pending) assert.equal(storage.getItem(key), storage === local && key === pending[0] ? 'newer malformed evidence{' : values[key], key)
  }
  assert.equal(local.getItem(STORAGE_KEYS.DEVICE_SETTINGS), 'device')
  assert.equal(local.getItem(STORAGE_KEYS.DEVICE_ID), 'device-id')
  assert.equal(local.getItem('businessos_read_session'), 'new-marker')
  assert.equal(local.getItem('businessos_auth_cookie_pending'), 'new-owner')
  assert.deepEqual(localDbCalls, ['preserve'])
  console.log('PASS full runtime reset clears both stores without changing device, coordination, newer financial evidence, or offline-work policy')
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
