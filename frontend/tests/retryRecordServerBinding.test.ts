import assert from 'node:assert/strict'
import fs from 'node:fs'

// A retry record belongs to the server (and organization) it was saved against:
// the same user id on another server never loads it, so it is never sent
// there, and one account loads it under every stored shape of that account.
// Every family is written and read through its real transport.

const memory = () => {
  const rows = new Map<string, string>()
  return { rows, get length() { return rows.size }, key: (index: number) => [...rows.keys()][index] ?? null, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, String(value)) }, removeItem: (key: string) => { rows.delete(key) }, clear: () => rows.clear() }
}
const local = memory(), session = memory()
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: local, sessionStorage: session, location: { origin: 'https://shop.test', hostname: 'shop.test' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, setTimeout, clearTimeout,
} })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local })
const { setSyncServerUrl } = await import('../src/api/httpState.ts')
const { prepareTransferRun, saveTransferRun, loadTransferRun } = await import('../src/api/branchTransport.ts')
const { prepareInventoryTransfer, saveInventoryTransfer, loadInventoryTransfer } = await import('../src/api/inventoryWriteTransport.ts')
const { prepareFeeCreatePayload, getPendingFeeCreate } = await import('../src/api/feesTransport.ts')
const { pendingShiftMutation, cancelShift } = await import('../src/api/shiftTransport.ts')
const { __resetApiHealthForTests, __resetApiWriteDedupeForTests } = await import('../src/api/http.ts')
const direct = await import('../src/utils/directMutationRequest.ts')
const { hasUnresolvedTransfer } = await import('../src/utils/minimizedWork.ts')
const { noteRetryRecordServer } = await import('../src/api/retryRecordScope.ts')

const X = 'https://x.example.test', Y = 'https://y.example.test'
const on = (server: string, organization = 3) => { setSyncServerUrl(server); local.setItem('businessos_user', JSON.stringify({ id: 7, organization_id: organization })) }
const transferBody = { product_id: 1, from_branch_id: 1, to_branch_id: 2, quantity: 1 }
function saveAll() {
  const transfer = prepareTransferRun(7, [{ bulk: false, body: transferBody }])
  saveTransferRun(7, transfer, session)
  const inventory = prepareInventoryTransfer(7, transferBody, { kind: 'submit', original: transferBody, productName: 'Soap' })
  saveInventoryTransfer(7, inventory, session as unknown as Storage)
  const fee = prepareFeeCreatePayload({ fee_type: 'expense', label: 'Rent', amount_usd: 10 }, 7, session)
  const status = direct.savePendingDirectMutationSlot('sale-status', 7, 55, { client_request_id: 'req-status' }, session)
  const edit = direct.savePendingDirectMutation('return-edit', 7, 56, { client_request_id: 'req-edit' }, session)
  const history = direct.savePendingDirectMutationSlot('return-history', 7, 57, { client_request_id: 'req-history' }, session)
  return {
    transfer: transfer.requests[0].body.client_request_id, inventory: inventory.requests[0].body.client_request_id, fee: fee.client_request_id,
    status: status?.body.client_request_id, edit: edit?.body.client_request_id, history: history?.body.client_request_id,
  }
}
const loadAll = () => ({
  transfer: loadTransferRun(7, session)?.requests[0].body.client_request_id,
  inventory: loadInventoryTransfer(7, session as unknown as Storage)?.requests[0].body.client_request_id,
  fee: getPendingFeeCreate(7, session)?.client_request_id,
  status: direct.loadPendingDirectMutationSlot('sale-status', 7, session)?.body.client_request_id,
  edit: direct.loadPendingDirectMutation('return-edit', 7, 56, session)?.body.client_request_id,
  history: direct.loadPendingDirectMutationSlot('return-history', 7, session)?.body.client_request_id,
})
const none = { transfer: undefined, inventory: undefined, fee: undefined, status: undefined, edit: undefined, history: undefined }
// A shift cancel whose answer is lost keeps its exact request for a retry.
async function saveShiftCancel(): Promise<string> {
  __resetApiHealthForTests(); __resetApiWriteDedupeForTests()
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  try { await assert.rejects(cancelShift(9, 1, 'opened by mistake', 7)) } finally { globalThis.fetch = realFetch }
  const requestId = pendingShiftMutation(7, 9)?.body.client_request_id
  assert.equal(typeof requestId, 'string', 'the shift request is kept')
  return String(requestId)
}
const SHIFT_KEY = 'businessos_shift_request_v1:7:POST:/api/shifts/9/close'
// Rewrites the records the tab saved on X into the keys builds before 6.0.148
// used (no scope), as a tab reloading into this build finds them: with no
// server noted yet.
function asSavedBeforeScopes(): string[] {
  const scope = encodeURIComponent(JSON.stringify(['https://shop.test', X, '3'])) + ':'
  const records = [...session.rows].filter(([key]) => key !== 'businessos_pending_retry_server_v1')
  const legacy = new Map(records.map(([key, value]) => [key.replace(scope, ''), value]))
  session.clear()
  for (const [key, value] of legacy) session.setItem(key, value)
  session.setItem(SHIFT_KEY, '{"client_request_id":"req-shift"}')
  return [...legacy.keys(), SHIFT_KEY]
}

let failed = 0
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await check('user 7 on server X and user 7 on server Y never see each other\'s retry records', async () => {
  local.clear(); session.clear()
  on(X); const onX = saveAll(); const shiftOnX = await saveShiftCancel()
  assert.deepEqual(loadAll(), onX)
  on(Y)
  assert.deepEqual(loadAll(), none, 'server Y loads none of server X\'s transfer, stock transfer, expense, sale-status or return records')
  assert.equal(pendingShiftMutation(7, 9), null, 'nor its shift request')
  assert.equal(hasUnresolvedTransfer('branch_transfer', 7), false)
  const onY = saveAll()
  assert.deepEqual(loadAll(), onY, 'server Y keeps its own')
  on(X)
  assert.deepEqual(loadAll(), onX, 'and server X still has exactly its own')
  assert.equal(pendingShiftMutation(7, 9)?.body.client_request_id, shiftOnX)
  assert.equal(hasUnresolvedTransfer('branch_transfer', 7), true)
  assert.equal(hasUnresolvedTransfer('inventory_transfer', 7), true)
  on(X, 4)
  assert.deepEqual(loadAll(), none, 'nor does the same id in another organization on the same server')
})

await check('records saved before keys carried the server load once for the same user, then only on that server', () => {
  local.clear(); session.clear()
  on(X); const ids = saveAll()
  const oldKeys = asSavedBeforeScopes()
  on(X)
  assert.deepEqual(loadAll(), ids, 'the same user on the same server loads every old record')
  assert.deepEqual(pendingShiftMutation(7, 9)?.body, { client_request_id: 'req-shift' })
  on(Y)
  assert.deepEqual(loadAll(), none, 'from then on another server never loads them')
  assert.equal(pendingShiftMutation(7, 9), null)
  assert.deepEqual(oldKeys.map((key) => session.getItem(key)), oldKeys.map(() => null), 'the old keys are gone: moved once, not copied')
})

await check('an old record is never read on a server the tab moved to before reading it, and still loads on the server it started with', () => {
  local.clear(); session.clear()
  on(X); const ids = saveAll()
  const oldKeys = asSavedBeforeScopes()
  noteRetryRecordServer()
  on(Y)
  assert.equal(hasUnresolvedTransfer('branch_transfer', 7), false, 'server Y does not count a transfer this tab saved against server X')
  assert.deepEqual(loadAll(), none, 'server Y never loads a record this tab saved against server X')
  assert.equal(pendingShiftMutation(7, 9), null)
  assert.deepEqual(oldKeys.map((key) => session.getItem(key) != null), oldKeys.map(() => true), 'and leaves it where it was')
  on(X)
  assert.equal(hasUnresolvedTransfer('branch_transfer', 7), true, 'server X still does')
  assert.deepEqual(loadAll(), ids, 'back on server X the same user loads every one')
  assert.deepEqual(pendingShiftMutation(7, 9)?.body, { client_request_id: 'req-shift' })
  const webApi = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(webApi, /if \(url\) \{\n\s+setSyncServerUrl\(url\)\n(?:\s*\/\/.*\n)*\s+noteRetryRecordServer\(\)/, 'bootstrap notes the server the tab starts with')
})

await check('one account loads its records under every stored shape of it: sign-in, bootstrap and own-profile save', async () => {
  // Sign-in answers carry organizationId, bootstrap organization_id, and an own
  // profile save merges the organization's public id in as well.
  const shapes: Record<string, Record<string, unknown>> = {
    'sign-in': { id: 7, username: 'owner', organizationId: 3 },
    bootstrap: { id: 7, username: 'owner', organization_id: 3 },
    'profile save': { id: 7, username: 'owner', organizationId: 3, organization_id: 3, organization_public_id: 'leang-cosmetics' },
  }
  const signedInAs = (user: Record<string, unknown>) => local.setItem('businessos_user', JSON.stringify(user))
  for (const [savedAs, saved] of Object.entries(shapes)) {
    local.clear(); session.clear(); setSyncServerUrl(X); signedInAs(saved)
    const ids = saveAll(), shift = await saveShiftCancel()
    for (const [readAs, read] of Object.entries(shapes)) {
      signedInAs(read)
      assert.deepEqual(loadAll(), ids, `saved as ${savedAs}, read as ${readAs}: every record loads`)
      assert.equal(pendingShiftMutation(7, 9)?.body.client_request_id, shift, `saved as ${savedAs}, read as ${readAs}: the shift request too`)
      assert.equal(hasUnresolvedTransfer('branch_transfer', 7), true, `saved as ${savedAs}, read as ${readAs}: the transfer still locks its draft`)
    }
  }
})

await check('an unscoped record never replaces a scoped one, and is removed only once its move reads back', () => {
  local.clear(); session.clear(); on(X)
  const scoped = prepareTransferRun(7, [{ bulk: false, body: transferBody }])
  saveTransferRun(7, scoped, session)
  const unscoped = JSON.stringify(prepareTransferRun(7, [{ bulk: false, body: { ...transferBody, quantity: 2 } }]))
  session.setItem('businessos_pending_transfer_v1:7', unscoped)
  assert.equal(loadTransferRun(7, session)?.requests[0].body.client_request_id, scoped.requests[0].body.client_request_id, 'the scoped record is the one loaded')
  assert.equal(session.getItem('businessos_pending_transfer_v1:7'), unscoped, 'the unscoped one is left as it was')

  local.clear(); session.clear(); on(X)
  const rows = new Map([['businessos_pending_transfer_v1:7', unscoped]])
  const writesDoNotStick = { getItem: (key: string) => rows.get(key) ?? null, setItem: () => {}, removeItem: (key: string) => { rows.delete(key) } }
  assert.equal(loadTransferRun(7, writesDoNotStick), null)
  assert.equal(rows.get('businessos_pending_transfer_v1:7'), unscoped, 'a move that did not stick leaves the record where it was')
})

if (failed) process.exit(1)
