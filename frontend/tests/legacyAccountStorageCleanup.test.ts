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

  // A Stock Session writes its request ids into its draft, and reads it back,
  // before sending. A draft written or removed while a drafts-keeping reset
  // awaits its cleanup stays exactly as written.
  const draft = 'businessos_draft_v2_%5B%22a%22%5D_fast_stockin'
  const before = '{"lines":[{"key":"l1","requestId":"r-1"}]}'
  const submitted = '{"lines":[{"key":"l1","requestId":"r-1"},{"key":"l2","requestId":"r-2"}],"receivingSubmissions":{"requests":{"l2":{"client_request_id":"r-2"}}}}'
  account(7, '111')
  local.setItem(draft, before); duringMirrorReset = () => local.setItem(draft, submitted)
  await sameUserReset()
  assert.equal(local.getItem(draft), submitted, 'the draft submitted during the cleanup keeps its request ids; the older one is not written back')
  local.setItem(draft, before); duringMirrorReset = () => local.removeItem(draft)
  await sameUserReset()
  assert.equal(local.getItem(draft), null, 'a session finished during the cleanup is not brought back')
  local.setItem(draft, before); duringMirrorReset = () => {}
  await sameUserReset()
  assert.equal(local.getItem(draft), before, 'nobody wrote: the draft stays')
  // The admin resets (data reset, factory reset, data path) pass these exact
  // options (api/methods.ts): drafts are still cleared, the account and the
  // device's settings stay.
  const methods = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
  const adminLiteral = /async function invalidateClientRuntimeState[\s\S]*?resetClientRuntimeState\((\{[\s\S]*?\})\)\.catch/.exec(methods)?.[1]
  assert.ok(adminLiteral, 'invalidateClientRuntimeState options')
  const adminOptions = new Function('mirrorTables', `return (${adminLiteral})`)(undefined) as Record<string, unknown>
  local.setItem(draft, before); local.setItem(STORAGE_KEYS.DEVICE_SETTINGS, '{"language":"km"}'); duringMirrorReset = () => {}
  await runtimeModule.exports.resetClientRuntimeState(adminOptions)
  assert.equal(local.getItem(draft), null, 'an admin reset still clears drafts')
  assert.deepEqual(stored(), [['{"id":7}', '111'], ['{"id":7}', '111']], 'and keeps the signed-in account')
  assert.equal(local.getItem(STORAGE_KEYS.DEVICE_SETTINGS), '{"language":"km"}', 'and the device settings')
  console.log('PASS a drafts-keeping reset keeps drafts in place, as written during the cleanup; the admin resets still clear them')

  // The kept device keys stay in place too: another tab's newer language,
  // server or login duration is never reverted by this tab's cleanup.
  const device = [STORAGE_KEYS.DEVICE_SETTINGS, STORAGE_KEYS.SYNC_SERVER, STORAGE_KEYS.SESSION_DURATION]
  const deviceValues = () => device.map((key) => local.getItem(key))
  const older = ['{"language":"en"}', 'https://old.example.test', '30d'], newer = ['{"language":"km"}', 'https://new.example.test', '7d']
  const resets: Array<[string, Record<string, unknown>]> = [
    ['same-user refresh', { clearAuth: false, preserveServiceWorker: true, preserveOfflineWork: true, preserveUiDrafts: true }],
    ['session expiry', { clearAuth: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: true, preserveServiceWorker: true, preserveOfflineWork: true, preserveUiDrafts: true }],
    ['admin reset', adminOptions],
  ]
  for (const [name, options] of resets) {
    device.forEach((key, index) => local.setItem(key, older[index]))
    duringMirrorReset = () => device.forEach((key, index) => local.setItem(key, newer[index]))
    await runtimeModule.exports.resetClientRuntimeState(options)
    assert.deepEqual(deviceValues(), newer, `${name}: another tab's newer language, server and login duration are not reverted`)
    device.forEach((key, index) => local.setItem(key, older[index])); duringMirrorReset = () => {}
    await runtimeModule.exports.resetClientRuntimeState(options)
    assert.deepEqual(deviceValues(), older, `${name}: nobody wrote, they stay`)
  }
  device.forEach((key, index) => local.setItem(key, older[index])); duringMirrorReset = () => {}
  await runtimeModule.exports.resetClientRuntimeState({ preserveDeviceSettings: false, preserveSyncServer: false, preserveSessionDuration: false, preserveServiceWorker: true, preserveOfflineWork: true })
  assert.deepEqual(deviceValues(), [null, null, null], 'a reset that does not keep them still clears them')
  console.log('PASS the kept device keys stay in place: language, server and login duration written during the cleanup are not reverted')

  // Records of writes that may already have reached the server survive every
  // reset, in place, and stay bound to their account: written by the real
  // transports for A (7), loaded back by the real loaders for A, never for B (8).
  Object.assign((globalThis as unknown as { window: object }).window, {
    location: { origin: 'https://shop.test', hostname: 'shop.test' }, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, setTimeout, clearTimeout,
  })
  const { prepareTransferRun, saveTransferRun, loadTransferRun } = await import('../src/api/branchTransport.ts')
  const { savePendingDirectMutationSlot, loadPendingDirectMutationSlot } = await import('../src/utils/directMutationRequest.ts')
  const { prepareFeeCreatePayload, getPendingFeeCreate } = await import('../src/api/feesTransport.ts')
  const { pendingShiftMutation } = await import('../src/api/shiftTransport.ts')
  const sentWrites = () => {
    const status = savePendingDirectMutationSlot('sale-status', 7, 55, { client_request_id: 'req-status', status: 'completed' }, session)
    const transfer = prepareTransferRun(7, [{ bulk: false, body: { product_id: 1, from_branch_id: 1, to_branch_id: 2, quantity: 1 } }])
    saveTransferRun(7, transfer, session)
    const fee = prepareFeeCreatePayload({ fee_type: 'rent', label: 'Rent', amount_usd: 10 }, 7, session)
    session.setItem('businessos_shift_request_v1:7:POST:/api/shifts/9/close', '{"client_request_id":"req-shift"}')
    session.setItem('businessos_sale_line_sent_v1:sale-add-items:7:55', '{"request":"req-line","at":1}')
    return { transfer: transfer.requests[0].body.client_request_id, status: status?.body.client_request_id, fee: fee.client_request_id }
  }
  const loaded = (actor: number) => ({
    transfer: loadTransferRun(actor, session)?.requests[0].body.client_request_id,
    status: loadPendingDirectMutationSlot('sale-status', actor, session)?.body.client_request_id,
    fee: getPendingFeeCreate(actor, session)?.client_request_id,
  })
  const everyReset: Array<[string, Record<string, unknown>]> = [
    ['same-user refresh', { clearAuth: false, preserveSyncServer: true, preserveSessionDuration: true, preserveOfflineWork: true, preserveUiDrafts: true }],
    ['session expiry', { clearAuth: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: true, preserveOfflineWork: true, preserveUiDrafts: true }],
    ['confirmed sign-out', { clearAuth: true, preserveSyncServer: true, preserveSessionDuration: true, preserveRuntimeMeta: true, preserveOfflineWork: true }],
    ['dataset change', { clearAuth: false, preserveSyncServer: true, preserveSessionDuration: true }],
    ['admin reset', adminOptions],
  ]
  for (const [name, options] of everyReset) {
    for (const store of [local, session]) for (let index = store.length - 1; index >= 0; index -= 1) { const key = store.key(index); if (['businessos_pending_', 'businessos_shift_request_v1:', 'businessos_sale_line_sent_v1:'].some((prefix) => key?.startsWith(prefix))) store.removeItem(String(key)) }
    const ids = sentWrites()
    duringMirrorReset = () => {}
    await runtimeModule.exports.resetClientRuntimeState({ preserveServiceWorker: true, ...options })
    assert.deepEqual(loaded(7), ids, `${name}: A's transfer, sale-status and expense requests load back with their request ids`)
    assert.deepEqual(pendingShiftMutation(7, 9)?.body, { client_request_id: 'req-shift' }, `${name}: A's shift request too`)
    assert.equal(session.getItem('businessos_sale_line_sent_v1:sale-add-items:7:55'), '{"request":"req-line","at":1}', `${name}: and when A's sale-line request was last sent`)
    assert.deepEqual(loaded(8), { transfer: undefined, status: undefined, fee: undefined }, `${name}: B never loads A's records`)
    assert.equal(pendingShiftMutation(8, 9), null, `${name}: nor A's shift request`)
  }
  // A newer record written by another request during the cleanup stays as written.
  duringMirrorReset = () => session.setItem('businessos_pending_fee_create_v2:7', 'newer{')
  await runtimeModule.exports.resetClientRuntimeState(everyReset[0][1])
  assert.equal(session.getItem('businessos_pending_fee_create_v2:7'), 'newer{')
  console.log('PASS sent-write records (transfer, expense, sale status, shift, sale-line send) survive every reset in place and load only for their own account')

  // POS orders hold a checkout's request id until its receipt is confirmed:
  // kept in place with the drafts (either store), cleared with them.
  const pos = ['businessos_pos_orders_7', 'businessos_pos_active_7', 'businessos_pos_counter_7']
  const sessionDraft = 'businessos_draft_v2_%5B%22a%22%5D_transfer_history_pending'
  const seedPos = () => { for (const store of [local, session]) pos.forEach((key) => store.setItem(key, `${key}:old`)); session.setItem(sessionDraft, 'replay') }
  seedPos(); duringMirrorReset = () => local.setItem(pos[0], '[{"checkoutRequestId":"req-sale"}]')
  await runtimeModule.exports.resetClientRuntimeState(everyReset[0][1])
  assert.equal(local.getItem(pos[0]), '[{"checkoutRequestId":"req-sale"}]', 'a checkout started during the cleanup keeps its request id')
  assert.deepEqual([...pos.slice(1).map((key) => local.getItem(key)), ...pos.map((key) => session.getItem(key))], [...pos.slice(1).map((key) => `${key}:old`), ...pos.map((key) => `${key}:old`)], 'the open orders, the active order and the counter stay, in both stores')
  assert.equal(session.getItem(sessionDraft), 'replay', 'a draft kept in sessionStorage stays too')
  seedPos(); duringMirrorReset = () => {}
  await runtimeModule.exports.resetClientRuntimeState(everyReset[2][1])
  assert.deepEqual([...pos.map((key) => local.getItem(key)), ...pos.map((key) => session.getItem(key)), session.getItem(sessionDraft)], Array(7).fill(null), 'a confirmed sign-out still clears them, as before')
  console.log('PASS POS orders and session-stored drafts stay in place on a drafts-keeping reset and are cleared with the drafts otherwise')
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
