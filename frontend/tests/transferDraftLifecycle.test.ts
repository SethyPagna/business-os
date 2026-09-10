import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const memory = new Map<string, string>()
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } }
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: { dispatchEvent: () => true } })
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
  assert.equal(entry.anchor, kind === 'branch_transfer' ? 'hub:branches:transfers' : 'hub:branches:products')
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
console.log('PASS transfer draft minimize/navigation/reload, actor/permission, pending/discard, availability and close lifecycle')
