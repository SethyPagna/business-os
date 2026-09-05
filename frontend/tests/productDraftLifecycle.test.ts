import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const productFormSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const fastStockInSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const createSessionSource = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')
const productsSource = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

assert.match(productFormSource, /draftScope\?: string/, 'ProductForm needs an explicit create-flow draft scope')
assert.match(productFormSource, /useStableHydratedState/, 'form hydration must be guarded by a stable entity/session key')
assert.match(productFormSource, /useStableHydratedState<ProductFormState>\(hydratedInitialForm, draftKey\)/, 'unstable caller seeds must be insulated by the scoped hydration key')
assert.match(fastStockInSource, /draftScope=\{`fast-stock-in-/, 'scanner creation needs a session/barcode-specific draft')
assert.match(createSessionSource, /draftScope=\{`create-products-session-/, 'each create-session item needs an isolated draft')
assert.match(createSessionSource, /useState\(\(\) => draft\?\.rows\?\.length \|\| 0\)/, 'a restored session must reopen the current item draft key')
assert.match(productsSource, /draftScope="standalone-create"/, 'standalone creation needs its own draft namespace')
assert.match(productsSource, /if \(!res\?\.success\) throw new Error/, 'failed product creates must reject back to ProductForm')
assert.match(productFormSource, /clearAfterSuccessfulProductSave/, 'draft clearing must be gated by a resolved save')

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

const { scopedWorkDraftKey } = await import('../src/utils/workDrafts.ts')
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
const draftKeyEnd = productFormSource.indexOf('\n\n// ProductForm receives', draftKeyStart)
assert.ok(draftKeyStart >= 0 && draftKeyEnd > draftKeyStart, 'draft-key helper source must be extractable')
const draftKeySource = productFormSource.slice(draftKeyStart, draftKeyEnd)
  .replace(
    /export function productFormDraftBaseKey\(productId: unknown, draftScope = 'standalone-create'\): string \{/,
    "return function productFormDraftBaseKey(productId, draftScope = 'standalone-create') {",
  )
const productFormDraftBaseKey = Function(draftKeySource)() as (productId: unknown, draftScope?: string) => string

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
