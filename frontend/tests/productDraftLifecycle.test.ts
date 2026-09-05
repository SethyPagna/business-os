import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const readSource = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const productFormSource = readSource('../src/components/products/forms/ProductForm.tsx')
const fastStockInSource = readSource('../src/components/inventory/FastStockInModal.tsx')
const createSessionSource = readSource('../src/components/products/CreateProductsSessionModal.tsx')
const productsSource = readSource('../src/components/products/Products.tsx')
const confirmDialogSource = readSource('../src/components/shared/ConfirmDialog.tsx')
const filePickerSource = readSource('../src/components/files/FilePickerModal.tsx')
const renameCascadeSource = readSource('../src/components/shared/RenameCascadeModal.tsx')

assert.match(productFormSource, /draftScope\?: string/, 'ProductForm needs an explicit create-flow draft scope')
assert.match(productFormSource, /useStableHydratedState/, 'form hydration must be guarded by a stable entity/session key')
assert.match(productFormSource, /useStableHydratedState<ProductFormState>\(hydratedInitialForm, draftKey\)/, 'unstable caller seeds must be insulated by the scoped hydration key')
assert.match(fastStockInSource, /draftScope=\{`fast-stock-in-/, 'scanner creation needs a session/barcode-specific draft')
assert.match(createSessionSource, /draftScope=\{editingNewLine \? `create-products-session-/, 'each create-session item and queued-line editor needs an isolated draft')
assert.match(createSessionSource, /useState\(\(\) => rows\.length\)/, 'a restored unified session must reopen the current item draft key')
assert.match(productsSource, /draftScope="standalone-create"/, 'standalone creation needs its own draft namespace')
assert.match(productsSource, /if \(!res\?\.success\) throw new Error/, 'failed product creates must reject back to ProductForm')
assert.match(productFormSource, /clearAfterSuccessfulProductSave/, 'draft clearing must be gated by a resolved save')
assert.match(productFormSource, /const legacyDraft = !draft && legacyDraftKey/, 'legacy fallback must run only when the new scoped draft is absent')
assert.match(productFormSource, /restoredLegacyDraftKeyRef\.current = legacyDraft\?\.data \? legacyDraftKey : null/, 'legacy clearing must be armed only by an actual fallback restore')
assert.match(productFormSource, /useEffect\(\(\) => \(\) => \{[\s\S]*?flushPendingWorkDraft\(draftKey\)[\s\S]*?\}, \[draftKey\]\)/, 'unmount/key change must flush only this form pending draft')
assert.match(productFormSource, /const preserveAndMinimize = isCreateMode && onMinimize \? \(\) => \{[\s\S]*?flushPendingWorkDraft\(draftKey\)[\s\S]*?onMinimize\(/, 'standalone prompt minimize must synchronously finish its own draft before parking')
assert.match(productFormSource, /<Modal[\s\S]*?onMinimize=\{preserveAndMinimize\}/, 'ProductForm must expose its proven preservation capability to the shared close prompt')
assert.match(productFormSource, /<ConfirmDialogLayerContext\.Provider value=\{modalLayer\}>/, 'nested ProductForm must propagate its layer to indirect confirmation dialogs')
assert.match(productFormSource, /<Modal[\s\S]*?layer=\{modalLayer\}/, 'ProductForm must retain its requested layer while a child is open')
assert.doesNotMatch(productFormSource, /effectiveModalLayer|nestedChildSurfaceOpen/, 'the parent layer must never be lowered behind its own parent session')
assert.match(productFormSource, /dialog\.setAttribute\('inert', ''\)[\s\S]*?dialog\.setAttribute\('aria-hidden', 'true'\)/, 'a ProductForm must be inert while its latest child surface is active')
assert.match(confirmDialogSource, /layer\?: ConfirmDialogLayer/)
assert.match(confirmDialogSource, /const resolvedLayer = layer \|\| inheritedLayer/)
assert.match(confirmDialogSource, /layer=\{resolvedLayer\}/)
assert.match(filePickerSource, /layer\?: 'default' \| 'nested'/)
assert.match(filePickerSource, /<Modal title=\{title\} onClose=\{onClose\} wide layer=\{layer\} unsavedChanges="read-only">/)
assert.match(renameCascadeSource, /layer === 'nested' \? 'z-\[1080\]' : 'z-\[1060\]'/)
assert.match(productFormSource, /function canManageProductImages/, 'product image controls need the products:image action gate')
assert.match(productFormSource, /actionAllowed\([\s\S]*?'products',[\s\S]*?'image'/, 'the image gate must use the same action contract as the permission editor/backend')
assert.match(productFormSource, /canManageImages \? \([\s\S]*?onClick=\{addImages\}/, 'upload controls must stay hidden when products:image is blocked')
assert.match(productFormSource, /<MinimizeButton[\s\S]*?onMinimize=\{preserveAndMinimize\}/, 'header and close-prompt minimize must use the same preservation path')
assert.match(productsSource, /onMinimize=\{!modalProduct \?/, 'only standalone create receives the minimized-chip callback')
const sessionProductForm = createSessionSource.match(/<ProductForm[\s\S]*?\/>/)?.[0] || ''
const stockInProductForm = fastStockInSource.match(/<ProductForm[\s\S]*?\/>/)?.[0] || ''
assert.doesNotMatch(sessionProductForm, /onMinimize=/, 'create session must not fake a restorable minimized item')
assert.doesNotMatch(stockInProductForm, /onMinimize=/, 'scanner-created stock-in item must not fake a separate minimized form')

console.log('PASS product draft lifecycle source contracts')

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style: Record<string, string> = {}
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  nodeValue = ''
  private ownText = ''

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
  }

  appendChild(child: MemoryNode): MemoryNode {
    child.parentNode = this
    this.ownText = ''
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode {
    child.parentNode = this
    this.ownText = ''
    const index = this.childNodes.indexOf(before)
    if (index < 0) this.childNodes.push(child)
    else this.childNodes.splice(index, 0, child)
    return child
  }

  removeChild(child: MemoryNode): MemoryNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}

  set textContent(value: string) {
    this.ownText = String(value)
    this.childNodes = []
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue
    if (this.childNodes.length) return this.childNodes.map((child) => child.textContent).join('')
    return this.ownText
  }
}

type MemoryDocument = {
  nodeType: number
  nodeName: string
  documentElement: MemoryNode | null
  activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null
  createElement: (name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode
  addEventListener: () => void
  removeEventListener: () => void
}

const memoryDocument: MemoryDocument = {
  nodeType: 9,
  nodeName: '#document',
  documentElement: null,
  activeElement: null,
  defaultView: null,
  createElement(name: string): MemoryNode { return new MemoryNode(1, name.toUpperCase(), memoryDocument) },
  createTextNode(text: string): MemoryNode {
    const node = new MemoryNode(3, '#text', memoryDocument)
    node.nodeValue = String(text)
    return node
  },
  addEventListener() {},
  removeEventListener() {},
}

const localStorage = new MemoryStorage()
const sessionStorage = new MemoryStorage()
const memoryWindow = {
  document: memoryDocument,
  localStorage,
  sessionStorage,
  HTMLElement: MemoryNode,
  HTMLIFrameElement: class {},
  addEventListener() {},
  removeEventListener() {},
  getSelection() { return null },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}
memoryDocument.defaultView = memoryWindow
memoryDocument.documentElement = memoryDocument.createElement('html')
memoryDocument.activeElement = memoryDocument.documentElement
Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorage })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

const {
  clearWorkDraft,
  flushPendingWorkDraft,
  readWorkDraft,
  scheduleWorkDraftWrite,
  scopedWorkDraftKey,
  writeWorkDraft,
} = await import('../src/utils/workDrafts.ts')
const { STORAGE_KEYS } = await import('../src/constants.ts')

// Node executes this repository's .ts helpers directly but does not load JSX
// modules. Execute the exact hook/helper bodies from ProductForm.tsx with the
// installed React runtime, matching the established lifecycle-test pattern.
const hydrationHookStart = productFormSource.indexOf('export function useStableHydratedState')
const hydrationHookEnd = productFormSource.indexOf('\n\nexport async function clearAfterSuccessfulProductSave', hydrationHookStart)
assert.ok(hydrationHookStart >= 0 && hydrationHookEnd > hydrationHookStart, 'hydration hook source must be extractable')
const hydrationHookSource = productFormSource.slice(hydrationHookStart, hydrationHookEnd)
  .replace(
    /export function useStableHydratedState<T>\(initialState: T, hydrationKey: string\): \[T, Dispatch<SetStateAction<T>>\] \{/,
    'return function useStableHydratedState(initialState, hydrationKey) {',
  )
  .replace(/useState<T>/g, 'useState')
const useStableHydratedState = Function(
  'useState',
  'useRef',
  'useEffect',
  hydrationHookSource,
)(React.useState, React.useRef, React.useEffect) as <T>(initialState: T, hydrationKey: string) => [T, React.Dispatch<React.SetStateAction<T>>]

const draftKeyStart = productFormSource.indexOf('export function productFormDraftBaseKey')
const draftKeyEnd = productFormSource.indexOf('\n\n// Before create flows were isolated', draftKeyStart)
assert.ok(draftKeyStart >= 0 && draftKeyEnd > draftKeyStart, 'draft-key helper source must be extractable')
const draftKeySource = productFormSource.slice(draftKeyStart, draftKeyEnd)
  .replace(
    /export function productFormDraftBaseKey\(productId: unknown, draftScope = 'standalone-create'\): string \{/,
    "return function productFormDraftBaseKey(productId, draftScope = 'standalone-create') {",
  )
const productFormDraftBaseKey = Function(draftKeySource)() as (productId: unknown, draftScope?: string) => string

const legacyKeyStart = productFormSource.indexOf('export function legacyStandaloneProductDraftBaseKey')
const legacyKeyEnd = productFormSource.indexOf('\n\n// ProductForm receives', legacyKeyStart)
assert.ok(legacyKeyStart >= 0 && legacyKeyEnd > legacyKeyStart, 'legacy-key helper source must be extractable on LF and CRLF checkouts')
const legacyKeySource = productFormSource.slice(legacyKeyStart, legacyKeyEnd)
  .replace(
    /export function legacyStandaloneProductDraftBaseKey\(productId: unknown, draftScope = 'standalone-create'\): string \| null \{/,
    "return function legacyStandaloneProductDraftBaseKey(productId, draftScope = 'standalone-create') {",
  )
const legacyStandaloneProductDraftBaseKey = Function(legacyKeySource)() as (productId: unknown, draftScope?: string) => string | null

const saveGateStart = productFormSource.indexOf('export async function clearAfterSuccessfulProductSave')
const saveGateEnd = productFormSource.indexOf('\n\nfunction editableInitialForm', saveGateStart)
assert.ok(saveGateStart >= 0 && saveGateEnd > saveGateStart, 'successful-save gate source must be extractable')
const saveGateSource = productFormSource.slice(saveGateStart, saveGateEnd)
  .replace(
    /export async function clearAfterSuccessfulProductSave[\s\S]*?\): Promise<void> \{/,
    'return async function clearAfterSuccessfulProductSave(save, clear) {',
  )
const clearAfterSuccessfulProductSave = Function(saveGateSource)() as (
  save: () => unknown | Promise<unknown>,
  clear: () => void,
) => Promise<void>

type HarnessState = {
  name: string
  barcode: string
  selling_price_usd: string
  cost_price_usd: string
  unit: string
  branch_id: string
}
let updateHarness: React.Dispatch<React.SetStateAction<HarnessState>> | null = null
let updateHarnessTab: React.Dispatch<React.SetStateAction<'basic' | 'pricing'>> | null = null
function HydrationHarness({ seed, hydrationKey }: { seed: HarnessState; hydrationKey: string }) {
  const [state, setState] = useStableHydratedState(seed, hydrationKey)
  const [activeTab, setActiveTab] = React.useState<'basic' | 'pricing'>('basic')
  updateHarness = setState
  updateHarnessTab = setActiveTab
  return React.createElement('span', null, [
    activeTab,
    state.barcode,
    state.name,
    state.cost_price_usd,
    state.selling_price_usd,
    state.unit,
    state.branch_id,
  ].join('|'))
}

const blankSeed = (barcode: string): HarnessState => ({
  barcode,
  name: '',
  selling_price_usd: '0',
  cost_price_usd: '0',
  unit: 'pcs',
  branch_id: 'qa-shop',
})

const container = memoryDocument.createElement('div')
const root = createRoot(container as unknown as Element)
await act(async () => {
  root.render(React.createElement(HydrationHarness, {
    seed: blankSeed('8850001'),
    hydrationKey: 'actor-1:fast-stock-in:session-7:item-8850001',
  }))
})
assert.equal(container.textContent, 'basic|8850001||0|0|pcs|qa-shop')

await act(async () => {
  updateHarness?.((current) => ({
    ...current,
    name: 'QA Draft Persistence',
    cost_price_usd: '10',
    selling_price_usd: '15',
  }))
  updateHarnessTab?.('pricing')
})
assert.equal(container.textContent, 'pricing|8850001|QA Draft Persistence|10|15|pcs|qa-shop')

await act(async () => {
  // A real parent rerender with a newly allocated seed object must not erase
  // the live name while the actor/session/item identity is unchanged.
  root.render(React.createElement(HydrationHarness, {
    seed: blankSeed('8850001'),
    hydrationKey: 'actor-1:fast-stock-in:session-7:item-8850001',
  }))
})
assert.equal(container.textContent, 'pricing|8850001|QA Draft Persistence|10|15|pcs|qa-shop')

await act(async () => {
  // Moving to another item is intentional hydration, not a background rerender.
  root.render(React.createElement(HydrationHarness, {
    seed: blankSeed('8850002'),
    hydrationKey: 'actor-1:fast-stock-in:session-7:item-8850002',
  }))
})
assert.equal(container.textContent, 'pricing|8850002||0|0|pcs|qa-shop')
await act(async () => root.unmount())
console.log('PASS mounted React keeps session name/barcode/prices/defaults/tab through a parent rerender and resets only for a new item')

sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 41, organization_public_id: 'org-a' }))
const actorOneStandalone = scopedWorkDraftKey(productFormDraftBaseKey(null, 'standalone-create'))
const actorOneFast = scopedWorkDraftKey(productFormDraftBaseKey(null, 'fast-stock-in-7-8850001'))
const actorOneSessionItem = scopedWorkDraftKey(productFormDraftBaseKey(null, 'create-products-session-7-item-0'))
assert.equal(new Set([actorOneStandalone, actorOneFast, actorOneSessionItem]).size, 3, 'separate create flows must not share drafts')

sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 42, organization_public_id: 'org-a' }))
const actorTwoStandalone = scopedWorkDraftKey(productFormDraftBaseKey(null, 'standalone-create'))
assert.notEqual(actorTwoStandalone, actorOneStandalone, 'different users must not share a standalone draft')
assert.equal(productFormDraftBaseKey(123, 'ignored-flow'), 'product_123', 'existing-product drafts remain entity keyed')
console.log('PASS product draft keys isolate actor, workflow, session item, and edit entity')

sessionStorage.clear()
localStorage.clear()
sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 51, organization_public_id: 'org-upgrade' }))
const upgradedStandaloneKey = scopedWorkDraftKey(productFormDraftBaseKey(null, 'standalone-create'))
const actorOneLegacyKey = scopedWorkDraftKey(legacyStandaloneProductDraftBaseKey(null, 'standalone-create')!)
writeWorkDraft(actorOneLegacyKey, { name: 'Existing deployed draft' })
assert.equal(readWorkDraft(upgradedStandaloneKey), null, 'upgrade starts without the new standalone key')
assert.equal(readWorkDraft<{ name: string }>(actorOneLegacyKey)?.data.name, 'Existing deployed draft', 'same actor can restore the deployed standalone draft')
assert.equal(legacyStandaloneProductDraftBaseKey(null, 'fast-stock-in-1-code'), null, 'fast stock-in must never inspect the ambiguous legacy draft')
assert.equal(legacyStandaloneProductDraftBaseKey(null, 'create-products-session-1-item-0'), null, 'create session must never inspect the ambiguous legacy draft')
assert.equal(legacyStandaloneProductDraftBaseKey(123, 'standalone-create'), null, 'editing an existing product must never inspect the create draft')

sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 52, organization_public_id: 'org-upgrade' }))
assert.equal(readWorkDraft(scopedWorkDraftKey('product_new')), null, 'another actor cannot see the deployed draft')
sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ id: 51, organization_public_id: 'org-upgrade' }))

// A pre-existing new-key draft wins and leaves the ambiguous legacy draft
// untouched. Only a fallback-selected legacy key is eligible for later clear.
writeWorkDraft(upgradedStandaloneKey, { name: 'New scoped draft wins' })
const primary = readWorkDraft<{ name: string }>(upgradedStandaloneKey)
const selectedLegacyKey = primary ? null : actorOneLegacyKey
clearWorkDraft(upgradedStandaloneKey)
if (selectedLegacyKey) clearWorkDraft(selectedLegacyKey)
assert.equal(readWorkDraft<{ name: string }>(actorOneLegacyKey)?.data.name, 'Existing deployed draft', 'saving a new-key draft must not silently delete unrelated legacy state')
const restoredLegacyKey = readWorkDraft(upgradedStandaloneKey) ? null : actorOneLegacyKey
clearWorkDraft(upgradedStandaloneKey)
if (restoredLegacyKey) clearWorkDraft(restoredLegacyKey)
assert.equal(readWorkDraft(actorOneLegacyKey), null, 'save/discard clears legacy only after fallback selected it')
console.log('PASS standalone-only legacy fallback survives upgrade, stays actor-isolated, and clears conditionally')

const pendingKey = scopedWorkDraftKey('product_new_unmount-test')
function DraftUnmountHarness({ draftKey, name }: { draftKey: string; name: string }) {
  React.useEffect(() => () => {
    flushPendingWorkDraft(draftKey)
  }, [draftKey])
  React.useEffect(() => scheduleWorkDraftWrite(draftKey, { name }, 60_000), [draftKey, name])
  return React.createElement('span', null, name)
}
const unmountContainer = memoryDocument.createElement('div')
const unmountRoot = createRoot(unmountContainer as unknown as Element)
await act(async () => {
  unmountRoot.render(React.createElement(DraftUnmountHarness, { draftKey: pendingKey, name: 'Initial value' }))
})
await act(async () => {
  unmountRoot.render(React.createElement(DraftUnmountHarness, { draftKey: pendingKey, name: 'Latest before minimize' }))
})
assert.equal(readWorkDraft(pendingKey), null, 'debounce remains asynchronous during typing')
await act(async () => unmountRoot.unmount())
assert.equal(readWorkDraft<{ name: string }>(pendingKey)?.data.name, 'Latest before minimize')

const clearedKey = scopedWorkDraftKey('product_new-cleared-unmount-test')
const clearedContainer = memoryDocument.createElement('div')
const clearedRoot = createRoot(clearedContainer as unknown as Element)
await act(async () => {
  clearedRoot.render(React.createElement(DraftUnmountHarness, { draftKey: clearedKey, name: 'Saved value' }))
})
clearWorkDraft(clearedKey)
await act(async () => clearedRoot.unmount())
assert.equal(flushPendingWorkDraft(clearedKey), false, 'cleared success/discard cannot be resurrected by later unmount cleanup')
assert.equal(readWorkDraft(clearedKey), null)
clearWorkDraft(pendingKey)
assert.equal(flushPendingWorkDraft(pendingKey), false, 'cleared success/discard cannot be resurrected by later unmount cleanup')
assert.equal(readWorkDraft(pendingKey), null)
console.log('PASS mounted React unmount/minimize flush preserves latest dirty state without resurrecting cleared work')

let clearCount = 0
await assert.rejects(
  clearAfterSuccessfulProductSave(
    async () => { throw new Error('server refused create') },
    () => { clearCount += 1 },
  ),
  /server refused create/,
)
assert.equal(clearCount, 0, 'a rejected create must leave its draft intact')
await clearAfterSuccessfulProductSave(async () => ({ success: true }), () => { clearCount += 1 })
assert.equal(clearCount, 1, 'only a resolved save clears its draft')
console.log('PASS failed saves preserve drafts and successful saves clear once')
