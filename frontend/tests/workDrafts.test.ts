import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// F3 slice 1 (Part 424): the ONE draft store. Behavior-tested under node
// with storage/window shims (the util's whole contract is that a missing
// or broken storage is non-fatal, so the shim also exercises that), plus
// the wiring pins that keep all three flows on the SAME store.

const memory = new Map<string, string>()
const eventListeners = new Map<string, Array<() => void>>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
}
;(globalThis as Record<string, unknown>).window = globalThis
;(globalThis as Record<string, unknown>).sessionStorage = (globalThis as Record<string, unknown>).localStorage
;(globalThis as Record<string, unknown>).addEventListener = (type: string, listener: () => void) => {
  eventListeners.set(type, [...(eventListeners.get(type) || []), listener])
}
;(globalThis as Record<string, unknown>).document = {
  visibilityState: 'visible',
  addEventListener: (type: string, listener: () => void) => {
    eventListeners.set(type, [...(eventListeners.get(type) || []), listener])
  },
}

const { flushPendingWorkDraft, flushPendingWorkDrafts, readWorkDraft, writeWorkDraft, clearWorkDraft, scheduleWorkDraftWrite, scopedWorkDraftKey } = await import('../src/utils/workDrafts.ts')

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('drafts round-trip with a timestamp and clear cleanly', () => {
  writeWorkDraft('k1', { name: 'Dior 999', qty: 3 })
  const draft = readWorkDraft<{ name: string; qty: number }>('k1')
  assert.equal(draft?.data.name, 'Dior 999')
  assert.ok((draft?.at || 0) > 0)
  clearWorkDraft('k1')
  assert.equal(readWorkDraft('k1'), null)
})

await runTest('a draft older than the server\'s own edit is dropped, never restored', () => {
  memory.set('k2', JSON.stringify({ at: 1000, data: { name: 'stale' } }))
  assert.equal(readWorkDraft('k2', { notOlderThanMs: 2000 }), null)
  assert.equal(memory.has('k2'), false) // removed, not just skipped
  memory.set('k3', JSON.stringify({ at: 3000, data: { name: 'fresh' } }))
  assert.equal(readWorkDraft<{ name: string }>('k3', { notOlderThanMs: 2000 })?.data.name, 'fresh')
})

await runTest('Part 388\'s original { form } field still reads (existing product drafts survive)', () => {
  memory.set('k4', JSON.stringify({ at: 5, form: { name: 'legacy draft' } }))
  assert.equal(readWorkDraft<{ name: string }>('k4')?.data.name, 'legacy draft')
  // garbage neither shape -> removed and null
  memory.set('k5', JSON.stringify({ at: 5 }))
  assert.equal(readWorkDraft('k5'), null)
  assert.equal(memory.has('k5'), false)
})

await runTest('the debounced write fires once and its cancel prevents it', async () => {
  const cancel = scheduleWorkDraftWrite('k6', { v: 1 }, 10)
  cancel()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(readWorkDraft('k6'), null)
  scheduleWorkDraftWrite('k7', { v: 2 }, 10)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(readWorkDraft<{ v: number }>('k7')?.data.v, 2)
})

await runTest('pending drafts flush synchronously when iOS backgrounds the page', () => {
  scheduleWorkDraftWrite('k8', { v: 'latest' }, 60_000)
  assert.equal(readWorkDraft('k8'), null)
  flushPendingWorkDrafts()
  assert.equal(readWorkDraft<{ v: string }>('k8')?.data.v, 'latest')
})

await runTest('one pending key can flush on form unmount without writing or clearing its siblings', () => {
  scheduleWorkDraftWrite('unmount-a', { v: 'latest' }, 60_000)
  scheduleWorkDraftWrite('unmount-b', { v: 'other flow' }, 60_000)
  assert.equal(flushPendingWorkDraft('unmount-a'), true)
  assert.equal(readWorkDraft<{ v: string }>('unmount-a')?.data.v, 'latest')
  assert.equal(readWorkDraft('unmount-b'), null)
  clearWorkDraft('unmount-b')
  assert.equal(flushPendingWorkDraft('unmount-b'), false)
  assert.equal(readWorkDraft('unmount-b'), null)
})

await runTest('draft keys are scoped to organization and user', () => {
  memory.set('businessos_user', JSON.stringify({ id: 42, organization_public_id: 'shop-a' }))
  assert.equal(scopedWorkDraftKey('product_new'), 'businessos_draft_shop-a_42_product_new')
  memory.delete('businessos_user')
})

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const productFormSource = readSource('../src/components/products/forms/ProductForm.tsx')
const fastStockInSource = readSource('../src/components/inventory/FastStockInModal.tsx')
const receiveBatchSource = readSource('../src/components/inventory/ReceiveBatchModal.tsx')

await runTest('all flows ride the ONE store -- no leftover hand-rolled localStorage dialects', () => {
  // ProductForm: restore honors server updated_at, save/discard clear
  assert.match(productFormSource, /readWorkDraft<Partial<ProductFormState>>\(draftKey, \{ notOlderThanMs: serverEditedAt \|\| 0 \}\)/)
  assert.match(productFormSource, /return scheduleWorkDraftWrite\(draftKey, form\)/)
  assert.match(productFormSource, /discard: clearCurrentProductDraft/)
  assert.match(productFormSource, /if \(restoredLegacyDraftKeyRef\.current\) \{\s+clearWorkDraft\(restoredLegacyDraftKeyRef\.current\)/)
  assert.match(productFormSource, /flushPendingWorkDraft\(draftKey\)/)
  assert.doesNotMatch(productFormSource, /localStorage\.(get|set|remove)Item\(draftKey/)
  // FastStockIn: header + in-progress line persist; Done (and only Done)
  // completes the batch and clears; X/backdrop keep the shipment
  assert.match(fastStockInSource, /scopedWorkDraftKey\('fast_stockin'\)/)
  assert.match(fastStockInSource, /readWorkDraft<FastStockInDraft>\(fastStockInDraftKey\)/)
  assert.match(fastStockInSource, /scheduleWorkDraftWrite<FastStockInDraft>\(fastStockInDraftKey/)
  assert.match(fastStockInSource, /clearWorkDraft\(fastStockInDraftKey\)\s+onClose\(\)/)
  // deliberately NO dirty-work guard for the draft-backed shipment
  assert.doesNotMatch(fastStockInSource, /registerDirtyWork/)
  assert.match(receiveBatchSource, /scheduleWorkDraftWrite\(draftKey/)
  assert.match(receiveBatchSource, /scopedWorkDraftKey\(`receive_\$\{product\.id\}`\)/)
})

await runTest('rider: ReceiveBatchModal\'s nav-guard dot points at the live Branches hub, not the retired inventory page', () => {
  assert.match(receiveBatchSource, /pageId: 'branches',/)
  assert.doesNotMatch(receiveBatchSource, /pageId: 'inventory',/)
})

if (failed > 0) {
  process.exitCode = 1
}
