import assert from 'node:assert/strict'

const memory = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
}
;(globalThis as Record<string, unknown>).sessionStorage = (globalThis as Record<string, unknown>).localStorage
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).addEventListener = () => undefined
;(globalThis as Record<string, unknown>).document = { visibilityState: 'visible', addEventListener: () => undefined }

const { applyCloseGuardEvent, applyPreserveAndMinimize } = await import('../src/utils/closeGuard.ts')
const { clearWorkDraft, readWorkDraft, writeWorkDraft } = await import('../src/utils/workDrafts.ts')
const { readStockAdjustDraft, stockAdjustDraftKey } = await import('../src/utils/stockAdjustDraft.ts')

const draftKey = stockAdjustDraftKey(77)
const draft = {
  version: 1 as const,
  product: { id: 77, name: 'Serum' },
  form: { product_id: 77, type: 'set', quantity: 4, reason: 'Counted shelf' },
  initialType: 'set' as const,
  search: '',
  receiptSessionId: 9001,
  attemptId: 'attempt-77',
  rows: [],
}
writeWorkDraft(draftKey, draft)

let promptOpen = false
let closeCount = 0
let minimizeCount = 0
const setPromptOpen = (open: boolean) => { promptOpen = open }
const close = () => { closeCount += 1 }

assert.equal(applyCloseGuardEvent({ event: 'close-requested', declaration: { dirty: true }, setPromptOpen, onClose: close }), 'prompted')
assert.equal(promptOpen, true)
assert.equal(closeCount, 0, 'dirty X must not close or discard')
assert.equal(minimizeCount, 0, 'dirty X must not silently minimize')
assert.equal(readStockAdjustDraft(draftKey)?.form.quantity, 4)

assert.equal(applyCloseGuardEvent({ event: 'back', declaration: { dirty: true }, setPromptOpen, onClose: close }), 'dismissed')
assert.equal(promptOpen, false)
assert.equal(closeCount, 0)
assert.ok(readWorkDraft(draftKey), 'Back keeps the exact draft')

promptOpen = true
assert.equal(applyPreserveAndMinimize({
  setPromptOpen,
  onMinimize: () => { minimizeCount += 1; close() },
}), 'minimized')
assert.equal(promptOpen, false)
assert.equal(minimizeCount, 1)
assert.equal(closeCount, 1)
assert.ok(readWorkDraft(draftKey), 'Minimize preserves the exact draft')

promptOpen = true
assert.equal(applyCloseGuardEvent({
  event: 'discard-confirmed',
  declaration: { dirty: true },
  setPromptOpen,
  onClose: () => { clearWorkDraft(draftKey); close() },
}), 'closed')
assert.equal(promptOpen, false)
assert.equal(minimizeCount, 1, 'Discard must not park another chip')
assert.equal(closeCount, 2)
assert.equal(readWorkDraft(draftKey), null, 'Discard clears the exact local draft')

console.log('PASS stock adjust X, Back, Minimize and Discard lifecycle')
