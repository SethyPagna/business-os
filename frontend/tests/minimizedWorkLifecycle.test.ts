import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const memory = new Map<string, string>()
const events: Array<{ type: string; detail?: unknown }> = []

;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
}
;(globalThis as Record<string, unknown>).sessionStorage = (globalThis as Record<string, unknown>).localStorage
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).addEventListener = () => undefined
;(globalThis as Record<string, unknown>).dispatchEvent = (event: Event & { detail?: unknown }) => {
  events.push({ type: event.type, detail: event.detail })
  return true
}
;(globalThis as Record<string, unknown>).document = {
  visibilityState: 'visible',
  addEventListener: () => undefined,
}
if (typeof globalThis.CustomEvent === 'undefined') {
  ;(globalThis as Record<string, unknown>).CustomEvent = class CustomEvent<T> extends Event {
    detail: T
    constructor(type: string, init?: { detail?: T }) {
      super(type)
      this.detail = init?.detail as T
    }
  }
}

const { STORAGE_KEYS } = await import('../src/constants.ts')
const {
  RESTORE_WORK_EVENT,
  canRestoreMinimizedWork,
  consumePendingRestore,
  dispatchRestore,
  getMinimizedWork,
  markRestoreHandled,
  minimizeWork,
  reparkDeniedRestore,
  removeMinimizedWork,
} = await import('../src/utils/minimizedWork.ts')
const { readWorkDraft, scopedWorkDraftKey, writeWorkDraft } = await import('../src/utils/workDrafts.ts')

function signIn(id: number, organization: string): void {
  memory.set(STORAGE_KEYS.USER, JSON.stringify({ id, organization_public_id: organization }))
}

signIn(11, 'shop-a')
const receiveDraftKey = scopedWorkDraftKey('receive_401')
writeWorkDraft(receiveDraftKey, { quantity: '7', notes: 'blue cartons' })
minimizeWork({
  key: 'receive-batch-401',
  kind: 'receive_batch',
  pageId: 'branches',
  label: 'Receive Stock — Product 401',
  payload: { productId: 401, branchId: '2' },
  draftKey: receiveDraftKey,
})

assert.equal(getMinimizedWork().length, 1)
assert.equal(getMinimizedWork()[0]?.draftKey, receiveDraftKey)
assert.ok(memory.has(scopedWorkDraftKey('minimized_work')), 'the registry must use the current user/org scope')
assert.equal(memory.has('bos_minimized_work'), false, 'the registry must not persist labels in the old global key')

// Switching operators in the same JS session must switch registries. A label,
// payload or pending restore from shop A must never appear in shop B.
signIn(22, 'shop-b')
assert.deepEqual(getMinimizedWork(), [])
minimizeWork({
  key: 'fast-stockin',
  kind: 'fast_stockin',
  pageId: 'branches',
  label: 'Fast stock-in',
  draftKey: scopedWorkDraftKey('fast_stockin'),
})
assert.equal(getMinimizedWork()[0]?.kind, 'fast_stockin')

signIn(11, 'shop-a')
assert.equal(getMinimizedWork()[0]?.key, 'receive-batch-401')

const parkedReceive = getMinimizedWork()[0]!
parkedReceive.requiredPermission = { permissionKey: 'inventory', actionKey: 'adjust' }
assert.equal(canRestoreMinimizedWork(parkedReceive, () => false), false, 'revoked permission blocks restore')
assert.equal(getMinimizedWork()[0]?.key, 'receive-batch-401', 'a denied restore leaves the chip and exact draft parked')
assert.equal(canRestoreMinimizedWork(parkedReceive, (permission, action) => permission === 'inventory' && action === 'adjust'), true)

// Restore removes the chip, dispatches its declarative payload, and remains a
// one-shot pending restore for a host that mounts after navigation.
const receiveEntry = getMinimizedWork()[0]!
dispatchRestore(receiveEntry)
assert.deepEqual(getMinimizedWork(), [])
assert.equal(events.at(-1)?.type, RESTORE_WORK_EVENT)
const restoreDetail = events.at(-1)?.detail as { kind?: string; payload?: unknown; entry?: { key?: string; draftKey?: string } }
assert.equal(restoreDetail.kind, 'receive_batch')
assert.deepEqual(restoreDetail.payload, { productId: 401, branchId: '2' })
assert.equal(restoreDetail.entry?.key, 'receive-batch-401')
assert.equal(restoreDetail.entry?.draftKey, receiveDraftKey)
assert.equal(consumePendingRestore('fast_stockin'), null)
assert.equal(consumePendingRestore('receive_batch')?.key, 'receive-batch-401')
assert.equal(consumePendingRestore('receive_batch'), null)
assert.equal(readWorkDraft<{ quantity: string }>(receiveDraftKey)?.data.quantity, '7', 'restore keeps the exact draft')

// The grant can change after the tray's check but before a mounted host handles
// the synchronous restore event. Denial must restore the exact chip and consume
// its pending replay so permission later returning cannot auto-open the form.
reparkDeniedRestore(receiveEntry)
assert.equal(getMinimizedWork()[0]?.draftKey, receiveDraftKey)
assert.equal(consumePendingRestore('receive_batch'), null)
removeMinimizedWork(receiveEntry.key)

// Product edits are an exact-entity contract. Even if a legacy chip is missing
// explicit permission metadata, the registry must enforce products:edit.
const productEditDraftKey = scopedWorkDraftKey('product_edit_777')
writeWorkDraft(productEditDraftKey, { name: 'Khmer edit', price: '12.50' })
minimizeWork({
  key: 'edit-product-777',
  kind: 'edit_product',
  pageId: 'products',
  label: 'Edit product — Khmer edit',
  payload: { productId: 777 },
  draftKey: productEditDraftKey,
})
const productEdit = getMinimizedWork()[0]!
assert.equal(productEdit.kind, 'edit_product')
assert.equal(productEdit.draftKey, productEditDraftKey)
assert.deepEqual(productEdit.payload, { productId: 777 })
assert.equal(canRestoreMinimizedWork(productEdit, () => false), false, 'product edit fallback blocks a revoked grant')
assert.equal(canRestoreMinimizedWork(productEdit, (permission, action) => permission === 'products' && action === 'edit'), true)
dispatchRestore(productEdit)
reparkDeniedRestore(productEdit)
assert.equal(getMinimizedWork()[0]?.draftKey, productEditDraftKey, 'a denied host restore reparks the exact product draft')
assert.equal(readWorkDraft<{ name: string }>(productEditDraftKey)?.data.name, 'Khmer edit')
removeMinimizedWork(productEdit.key)

// A handled event also consumes the pending replay, and removing a chip does
// not itself make a broad family-draft decision.
minimizeWork({ key: 'session', kind: 'create_products_session', pageId: 'products', label: 'Create products', draftKey: scopedWorkDraftKey('create_products_session') })
const session = getMinimizedWork()[0]!
dispatchRestore(session)
markRestoreHandled('create_products_session')
assert.equal(consumePendingRestore('create_products_session'), null)
minimizeWork({ key: 'session', kind: 'create_products_session', pageId: 'products', label: 'Create products', draftKey: scopedWorkDraftKey('create_products_session') })
removeMinimizedWork('session')
assert.deepEqual(getMinimizedWork(), [])

const traySource = readFileSync(new URL('../src/components/shared/MinimizedWorkTray.tsx', import.meta.url), 'utf8')
const receiveSource = readFileSync(new URL('../src/components/inventory/ReceiveBatchModal.tsx', import.meta.url), 'utf8')
const branchesSource = readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const branchFormSource = readFileSync(new URL('../src/components/branches/BranchForm.tsx', import.meta.url), 'utf8')
const feeFormSource = readFileSync(new URL('../src/components/fees/FeeForm.tsx', import.meta.url), 'utf8')
const feesPageSource = readFileSync(new URL('../src/components/fees/FeesPage.tsx', import.meta.url), 'utf8')
assert.match(traySource, /entry\.draftKey \|\| \(legacyDraftBase \? scopedWorkDraftKey\(legacyDraftBase\) : null\)/)
assert.match(traySource, /aria-label=\{tr\('minimized_dismiss_hint', 'Dismiss and discard this draft'/)
assert.match(traySource, /receive_batch: null/, 'per-product receive drafts must never use a family-wide fallback clear')
assert.match(traySource, /if \(!canRestoreMinimizedWork\(entry, can\)\) \{[\s\S]*?return[\s\S]*?\}\s*navigateTo\(entry\.pageId, entry\.anchor\)/, 'permission must be rechecked before exact page/section navigation and dispatch')
assert.match(traySource, /edit_product: null/, 'per-product edit drafts must never use a family-wide fallback clear')
assert.match(receiveSource, /writeWorkDraft\(draftKey, currentDraft\(\)\)[\s\S]*?onMinimize\(\{[\s\S]*?draftKey,[\s\S]*?\}\)[\s\S]*?onClose\(\)/, 'receive minimize must persist before parking and unmounting')
assert.match(receiveSource, /useCloseGuard\(\{ workKey: product \? `receive-batch-\$\{product\.id\}` : '' \}, onClose, preserveAndMinimize\)/, 'receive X, Cancel and backdrop must retain the shared guard while its prompt can preserve')
assert.match(receiveSource, /<MinimizeButton disabled=\{saving\} tr=\{tr\} onMinimize=\{preserveAndMinimize\} \/>/, 'receive must show the shared minus beside Close')
assert.match(branchesSource, /if \(!canReceiveStock\) return false[\s\S]*?setReceiveTarget/, 'the host must recheck current permission before reopening')
assert.match(branchesSource, /requiredPermission: \{ permissionKey: 'inventory', actionKey: 'adjust' \}/, 'the parked entry must carry the existing action grant')
assert.match(branchesSource, /if \(!canReceiveStock\) \{[\s\S]*?reparkDeniedRestore\(entry\)[\s\S]*?return/, 'a host-side permission race must put the exact chip back')
assert.match(branchFormSource, /readWorkDraft<Partial<BranchFormState>>\(draftKey, \{[\s\S]*?notOlderThanMs: branch\?\.updated_at \? Date\.parse\(branch\.updated_at\)/, 'branch edit restore must reject a draft older than the current server row')
assert.match(branchFormSource, /discard: \(\) => clearWorkDraft\(draftKey\)/, 'branch discard must clear the exact scoped draft')
assert.match(branchFormSource, /flushPendingWorkDraft\(draftKey\)[\s\S]*?scheduleWorkDraftWrite\(draftKey, form\)/, 'branch minimize/unmount must flush its pending draft writer')
assert.match(branchesSource, /kind: 'branch_form'[\s\S]*?draftKey: branchDraftKey,[\s\S]*?requiredPermission: \{ permissionKey: 'branches', actionKey: isEdit \? 'edit' : 'add' \}/, 'branch chips must identify the exact draft and current add/edit grant')
assert.match(branchesSource, /const result = await branchApi\.getBranches\(\)[\s\S]*?currentBranch = Array\.isArray\(result\)[\s\S]*?setSelected\(currentBranch\)/, 'branch edit restore must fetch the current server row before mounting the draft')
assert.match(branchesSource, /onMinimize=\{canMinimizeBranchForm \? preserveBranchForm : undefined\}[\s\S]*?<MinimizeButton/, 'branch form must show a permission-aware minus beside Close')
assert.match(feeFormSource, /readWorkDraft<Partial<FeeFormState>>\(draftKey, \{[\s\S]*?notOlderThanMs: fee\?\.updated_at \? Date\.parse\(fee\.updated_at\)/, 'fee edit restore must reject a draft older than the current server row')
assert.match(feeFormSource, /discard: \(\) => clearWorkDraft\(draftKey\)[\s\S]*?flushPendingWorkDraft\(draftKey\)[\s\S]*?scheduleWorkDraftWrite\(draftKey, form\)/, 'fee discard and minimize must act on the exact scoped draft')
assert.match(feeFormSource, /const saleId = form\.sale_id\.trim\(\)/, 'a restored fee draft must resolve and show the sale it will submit')
assert.match(feesPageSource, /const result = await getFeeRequest\(feeId\)[\s\S]*?setSelected\(result\.fee\)/, 'fee edit restore must fetch the current server row before mounting the draft')
assert.match(feesPageSource, /kind: 'fee_form'[\s\S]*?pageId: 'sales',[\s\S]*?anchor: 'hub:sales:fees',[\s\S]*?requiredPermission: \{ permissionKey: 'fees', actionKey: isEdit \? 'edit' : 'add' \}/, 'fee chips must restore the exact Sales section with the current add/edit grant')
assert.match(feesPageSource, /onMinimize=\{canMinimizeFeeForm \? preserveFeeForm : undefined\}[\s\S]*?<MinimizeButton/, 'fee form must show a permission-aware minus beside Close')

console.log('PASS minimized work is actor-scoped, exact-draft, one-shot and accessible')
