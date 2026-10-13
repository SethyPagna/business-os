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

  // The write-owner generation is kept by every reset and never rolled back by a
  // snapshot; receiving product attempts are kept, in place, exactly when drafts are.
  const owner = 'businessos_write_owner_v1'
  const attempt = 'businessos_receiving_product_attempt_v1:%5B%22a%22%5D'
  for (const preserveUiDrafts of [false, true]) {
    local.setItem(owner, '4:0123456789abcdef')
    local.setItem(attempt, '{"state":"prepared"}')
    local.setItem('businessos_draft_stock', 'draft')
    duringMirrorReset = () => {
      local.setItem(owner, '5:fedcba9876543210')
      if (local.getItem(attempt) !== null) local.setItem(attempt, '{"state":"confirmed"}')
    }
    await runtimeModule.exports.resetClientRuntimeState({ preserveServiceWorker: true, preserveOfflineWork: true, preserveUiDrafts })
    assert.equal(local.getItem(owner), '5:fedcba9876543210', 'a generation raised during cleanup is not rolled back')
    assert.equal(local.getItem(attempt), preserveUiDrafts ? '{"state":"confirmed"}' : null, `attempts follow the drafts (preserveUiDrafts ${preserveUiDrafts})`)
    assert.equal(local.getItem('businessos_draft_stock'), preserveUiDrafts ? 'draft' : null)
  }
  console.log('PASS the write-owner generation survives every reset unrolled; receiving attempts stay in place with the drafts and go without them')

  // A same-user reset keeps the signed-in account in place and never writes it
  // back from a snapshot: whatever another tab stores meanwhile is what stays.
  const { USER, USER_EXPIRY } = STORAGE_KEYS
  const account = (id: number | null, expiry: string) => { for (const store of [local, session]) {
    if (id === null) { store.removeItem(USER); store.removeItem(USER_EXPIRY) } else { store.setItem(USER, `{"id":${id}}`); store.setItem(USER_EXPIRY, expiry) }
  } }
  const stored = () => [local, session].map((store) => [store.getItem(USER), store.getItem(USER_EXPIRY)])
  const sameUserReset = () => runtimeModule.exports.resetClientRuntimeState({ clearAuth: false, preserveServiceWorker: true, preserveOfflineWork: true, preserveUiDrafts: true })
  account(7, '111'); duringMirrorReset = () => account(8, '222')
  await sameUserReset()
  assert.deepEqual(stored(), [['{"id":8}', '222'], ['{"id":8}', '222']], 'another tab signed B in during the cleanup: B stays, A is not written back')
  account(7, '111'); duringMirrorReset = () => account(null, '')
  await sameUserReset()
  assert.deepEqual(stored(), [[null, null], [null, null]], 'another tab signed out during the cleanup: it stays signed out')
  account(7, '111'); duringMirrorReset = () => {}
  await sameUserReset()
  assert.deepEqual(stored(), [['{"id":7}', '111'], ['{"id":7}', '111']], 'nobody else wrote: the same account stays')
  await runtimeModule.exports.resetClientRuntimeState({ preserveServiceWorker: true, preserveOfflineWork: true })
  assert.deepEqual(stored(), [[null, null], [null, null]], 'a reset that clears auth still clears it')
  console.log('PASS a same-user reset keeps the signed-in account in place and never restores an older one over a newer sign-in or sign-out')
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
