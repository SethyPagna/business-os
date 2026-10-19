import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const memory = new Map<string, string>()
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } }
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} } })
const { STORAGE_KEYS } = await import('../src/constants.ts')
const draft = await import('../src/utils/minimizedWork.ts')
const signIn = (id: number) => storage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id, organization_public_id: 'store' }))
for (const kind of ['branch_transfer', 'inventory_transfer'] as const) {
  signIn(7)
  const key = draft.transferDraftKey(kind)
  const form = { fromBranch: '1', toBranch: '2', reason: 'restock', selectedQuantities: { 41: '2.5', 42: '7' }, search: 'tea', showSelectedOnly: true }
  assert.equal(draft.writeTransferDraft(kind, 7, key, form), true)
  draft.parkTransferDraft(kind, 7, key, 'Transfer tea')
  assert.deepEqual(draft.readTransferDraft(kind, 7), form, 'minimize/navigation/reload read the serialized fields')
  const entry = draft.getMinimizedWork().find((item) => item.key === key)!
  assert.equal(entry.pageId, 'branches')
  assert.equal(entry.anchor, kind === 'branch_transfer' ? 'hub:branches:transfers' : 'hub:branches:rfid')
  assert.equal(draft.canRestoreMinimizedWork(entry, () => false), false, 'permission revocation blocks restore')
  assert.equal(draft.canRestoreMinimizedWork(entry, (permission, action) => permission === (kind === 'branch_transfer' ? 'branches' : 'inventory') && action === 'transfer'), true)
  signIn(8)
  assert.equal(draft.readTransferDraft(kind, 8), null)
  assert.deepEqual(draft.getMinimizedWork(), [])
  draft.reparkDeniedRestore(entry)
  assert.deepEqual(draft.getMinimizedWork(), [], 'late denied restore never reparks another actor label')
  assert.equal(draft.writeTransferDraft(kind, 7, key, { reason: 'late response' }), false)
  assert.equal(draft.discardTransferDraft(kind, 8, key), false)
  signIn(7)
  assert.deepEqual(draft.readTransferDraft(kind, 7), form)
  const pendingKey = `${kind === 'inventory_transfer' ? 'inventory:' : ''}businessos_pending_transfer_v1:7`
  storage.setItem(pendingKey, JSON.stringify({ client_request_id: 'frozen' }))
  assert.equal(draft.discardTransferDraft(kind, 7, key), false, 'discard cannot erase unresolved network identity or its draft')
  assert.ok(draft.getMinimizedWork().some((item) => item.key === key))
  assert.deepEqual(draft.readTransferDraft(kind, 7), form)
  storage.removeItem(pendingKey)
  assert.equal(draft.discardTransferDraft(kind, 7, key), true, 'confirmed completion or explicit draft discard clears only its matching draft')
  assert.equal(draft.readTransferDraft(kind, 7), null)
  draft.writeTransferDraft(kind, 7, key, form)
  signIn(8)
  const nextKey = draft.transferDraftKey(kind)
  draft.writeTransferDraft(kind, 8, nextKey, { reason: 'another actor' })
  draft.completeTransferDraft(7, key)
  assert.deepEqual(draft.readTransferDraft(kind, 8), { reason: 'another actor' }, 'late confirmation never clears another actor draft')
  signIn(7)
  assert.equal(draft.readTransferDraft(kind, 7), null, 'late confirmed operation cannot resurrect as a new transfer')
  const originalWrite = storage.setItem
  storage.setItem = () => { throw new Error('Storage full') }
  assert.equal(draft.writeTransferDraft(kind, 7, key, form), false, 'failed persistence must keep the modal open')
  storage.setItem = originalWrite
}

const branch = readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
const inventory = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const modal = readFileSync(new URL('../src/components/inventory/InventoryStockModals.tsx', import.meta.url), 'utf8')
const workDrafts = await import('../src/utils/workDrafts.ts')
signIn(7)
const legacyKey = draft.transferDraftKey('inventory_transfer')
const legacyForm = { product: { id: 41, name: 'Tea' }, form: { fromBranchId: '1', toBranchId: '2', quantity: '3', reason: 'restock' } }
assert.equal(draft.writeTransferDraft('inventory_transfer', 7, legacyKey, legacyForm), true)
const legacyEntry = { key: legacyKey, draftKey: legacyKey, kind: 'inventory_transfer' as const, pageId: 'branches', anchor: 'hub:branches:products', label: 'Transfer tea', payload: { actorId: '7', savedMetadata: 'preserve' }, minimizedAt: 123, requiredPermission: { permissionKey: 'inventory', actionKey: 'transfer' } }
workDrafts.writeWorkDraft(workDrafts.scopedWorkDraftKey('minimized_work'), [legacyEntry])
signIn(8)
draft.getMinimizedWork()
signIn(7)
const restoredEntry = draft.getMinimizedWork().find(entry => entry.key === legacyKey)!
assert.deepEqual(restoredEntry, { ...legacyEntry, ...draft.INVENTORY_TRANSFER_RESTORE_HOST }, 'old saved chips change only their retired destination, preserving metadata and grants')
assert.equal(draft.canRestoreMinimizedWork(restoredEntry, (key, action) => key === 'inventory' && action === 'transfer'), true)
assert.equal(draft.canRestoreMinimizedWork(restoredEntry, () => false), false)
draft.dispatchRestore(restoredEntry)
assert.equal(draft.peekPendingRestore('inventory_transfer')?.anchor, 'hub:branches:rfid', 'the lazy RFID Inventory host can still claim the transfer')
const actual = (start: string, end: string, name: string, env: Record<string, unknown>) => {
  const begin = inventory.indexOf(start), stop = inventory.indexOf(end, begin)
  assert.ok(begin >= 0 && stop > begin)
  const code = transformSync(inventory.slice(begin, stop), { loader: 'tsx' }).code
  return new Function('env', `with(env){${code};return ${name}}`)(env)
}
let restoredProduct: unknown, restoredForm: unknown
const ownerRef = { current: { key: legacyKey, actorId: '7' } }
const snapshotRef = { current: legacyForm as unknown }
const restore = actual('  const restoreInventoryTransfer = useCallback(', '\n  useEffect(', 'restoreInventoryTransfer', {
  useCallback: (fn: unknown) => fn, user: { id: 7 }, canTransferStock: true,
  transferDraftKey: draft.transferDraftKey, readTransferDraft: draft.readTransferDraft,
  reparkDeniedRestore: draft.reparkDeniedRestore,
  getInventoryApi: () => ({ getProductsByIds: async (ids: unknown, options: unknown) => {
    assert.deepEqual(ids, [41]); assert.deepEqual(options, { include: 'branch_stock' })
    return { items: [{ id: 41, name: 'Tea', branch_stock: [{ branch_id: 1, quantity: 9 }] }] }
  } }),
  transferAuthorityRef: { current: { actorId: '7', allowed: true } }, transferDraftOwnerRef: ownerRef,
  setTransferRestoredDirty: (value: boolean) => assert.equal(value, true),
  setTransferForm: (value: unknown) => { restoredForm = value }, setTransferModal: (value: unknown) => { restoredProduct = value },
  tr: (_key: string, fallback: string) => fallback, notify: (message: string) => assert.fail(message),
})
await restore(draft.peekPendingRestore('inventory_transfer'))
assert.deepEqual(restoredForm, legacyForm.form, 'the actual Inventory restore handler keeps saved fields')
assert.equal((restoredProduct as { id: number }).id, 41)
assert.match(modal, /if \(transferModal\) markRestoreHandled\('inventory_transfer'\)/)
draft.markRestoreHandled('inventory_transfer')
assert.equal(draft.peekPendingRestore('inventory_transfer'), null)
const close = actual('  const closeTransferDraft = () =>', '\n  const minimizeTransferDraft', 'closeTransferDraft', {
  transferStockInFlightRef: { current: false }, transferSaving: false, pendingTransfer: null,
  discardTransferDraft: draft.discardTransferDraft, user: { id: 7 }, transferDraftOwnerRef: ownerRef,
  transferDraftSnapshotRef: snapshotRef, parkCurrentTransfer: () => assert.fail('a resolved close must discard only its draft'),
  setTransferModal: (value: unknown) => { restoredProduct = value },
})
close()
assert.equal(restoredProduct, null)
assert.equal(draft.readTransferDraft('inventory_transfer', 7), null)
assert.equal(draft.getMinimizedWork().some(entry => entry.key === legacyKey), false, 'closing the restored dialog leaves no stranded chip')
assert.equal(snapshotRef.current, null)
assert.match(branch, /previousSourceRef.current === fromBranch/, 'mount-time availability refresh preserves restored picks')
assert.doesNotMatch(branch, /setMultiProducts\(\[\]\)\s*setSelectedQuantities\(\{\}\)\s*setLoadingMultiProducts\(true\)/)
assert.match(branch, /onClick=\{\(\) => \{ if \(!saving && !savingBulk\) closeGuard.requestClose\(\)/, 'backdrop follows the busy-aware close guard')
assert.match(inventory, /getProductsByIds\(\[draft.product.id\], \{ include: 'branch_stock' \}\)/, 'restore reloads current availability')
assert.match(inventory, /setTransferForm\(draft.form\)/, 'availability refresh keeps entered fields')
assert.doesNotMatch(inventory, /undo: \(\) => runInventoryTransferIntent|updateActionHistory\(context.serverId/)
assert.match(modal, /<fieldset disabled=\{transferSaving \|\| transferPending\}/, 'all fields and reason management are locked while busy')
assert.match(modal, /useCloseGuard\(transferWorkKey \? \{ workKey: transferWorkKey \}/)
assert.match(branch, /useCloseGuard\(\{ workKey: draftKey \}/)
assert.match(branch, /registerDirtyWork\(/)
assert.match(inventory, /registerDirtyWork\(/)
console.log('PASS transfer draft minimize/navigation/reload, actor/permission, pending/discard, availability and close lifecycle; legacy RFID-host restoration preserves metadata and executes actual restore/close handlers')
