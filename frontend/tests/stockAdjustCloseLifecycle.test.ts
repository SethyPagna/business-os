import assert from 'node:assert/strict'
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useCloseGuard, type CloseGuard } from '../src/utils/useCloseGuard.ts'
import { useRestoredStockAdjustDirty } from '../src/utils/useRestoredStockAdjustDirty.ts'

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

// React-level regression for the actual failure: the restored draft is
// applied once, then the async product refresh clears that hydration ref.
// Dirtiness must remain latched until the modal really unmounts.
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
  private attributes = new Map<string, string>()
  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
  }
  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode {
    child.parentNode = this
    const index = this.childNodes.indexOf(before)
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child)
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
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get nextSibling(): MemoryNode | null {
    if (!this.parentNode) return null
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null
  }
  set textContent(value: string) { this.ownText = value; this.childNodes = [] }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText }
}

type MemoryDocument = {
  nodeType: number
  nodeName: string
  documentElement: MemoryNode
  body: MemoryNode
  activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null
  createElement: (name: string) => MemoryNode
  createElementNS: (namespaceURI: string, name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode
  addEventListener: () => void
  removeEventListener: () => void
}

const memoryDocument = {} as MemoryDocument
memoryDocument.nodeType = 9
memoryDocument.nodeName = '#document'
memoryDocument.defaultView = null
memoryDocument.createElement = (name) => new MemoryNode(1, name.toUpperCase(), memoryDocument)
memoryDocument.createElementNS = (_namespaceURI, name) => new MemoryNode(1, name, memoryDocument)
memoryDocument.createTextNode = (text) => {
  const node = new MemoryNode(3, '#text', memoryDocument)
  node.nodeValue = text
  return node
}
memoryDocument.addEventListener = () => {}
memoryDocument.removeEventListener = () => {}
memoryDocument.documentElement = memoryDocument.createElement('html')
memoryDocument.body = memoryDocument.createElement('body')
memoryDocument.documentElement.appendChild(memoryDocument.body)
memoryDocument.activeElement = memoryDocument.documentElement
const memoryWindow = {
  document: memoryDocument,
  HTMLElement: MemoryNode,
  HTMLIFrameElement: class {},
  addEventListener() {},
  removeEventListener() {},
  getSelection() { return null },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}
memoryDocument.defaultView = memoryWindow
Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

let reactGuard: CloseGuard | null = null
let reactCloseCount = 0
let reactMinimizeCount = 0
function currentReactGuard(): CloseGuard {
  if (!reactGuard) throw new Error('React close guard did not commit')
  return reactGuard
}
function RestoredCloseHarness({ restored }: { restored: boolean }) {
  const dirty = useRestoredStockAdjustDirty(restored)
  const guard = useCloseGuard(
    { dirty },
    () => { reactCloseCount += 1 },
    () => { reactMinimizeCount += 1; reactCloseCount += 1 },
  )
  useEffect(() => { reactGuard = guard })
  return React.createElement('div')
}

const container = memoryDocument.createElement('div')
memoryDocument.body.appendChild(container)
const root = createRoot(container as unknown as Element)
await act(async () => {
  root.render(React.createElement(RestoredCloseHarness, { restored: true }))
  await Promise.resolve()
})
await act(async () => {
  root.render(React.createElement(RestoredCloseHarness, { restored: false }))
  await Promise.resolve()
})

await act(async () => { currentReactGuard().requestClose() })
assert.equal(currentReactGuard().promptOpen, true, 'async hydration consumption must not make restored work clean')
assert.equal(reactCloseCount, 0)
await act(async () => { currentReactGuard().dismissPrompt() })
assert.equal(currentReactGuard().promptOpen, false, 'Back keeps the restored modal mounted')
await act(async () => { currentReactGuard().requestClose() })
await act(async () => { currentReactGuard().preserveAndMinimize?.() })
assert.equal(reactMinimizeCount, 1)
assert.equal(reactCloseCount, 1, 'Minimize preserves and closes through its explicit capability')
await act(async () => { currentReactGuard().requestClose() })
await act(async () => { currentReactGuard().discardAndClose() })
assert.equal(reactCloseCount, 2, 'Discard closes only after the restored dirty prompt')

await act(async () => {
  root.render(React.createElement(RestoredCloseHarness, { key: 'completed-new-mount', restored: false }))
})
await act(async () => { currentReactGuard().requestClose() })
assert.equal(reactCloseCount, 3, 'a new clean mount closes directly after the prior save/discard lifecycle unmounted')
await act(async () => root.unmount())

console.log('PASS restored stock-adjust dirtiness survives async hydration consumption')
