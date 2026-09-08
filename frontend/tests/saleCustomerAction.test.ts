import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import ts from 'typescript'
import { updateSalesBulkField, type BulkSaleUpdatePayload } from '../src/api/salesTransport.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const sales = readFileSync(resolve(frontendRoot, 'src/components/sales/Sales.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const detail = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleDetailModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const modalSource = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleCustomerActionModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const nameModalSource = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleCustomerNameModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')

assert.match(sales, /const canBrowseCustomers = can\('contacts', 'view'\)/)
assert.match(sales, /const canCreateCustomer = can\('contacts', 'add'\)/)
assert.match(sales, /const canEditCustomerName = can\('contacts', 'edit'\)/)
assert.match(sales, /setSaleCustomerPrompt\(\{ sale: \{ \.\.\.sale \}, choices: \[\] \}\)[\s\S]{0,180}if \(canBrowseCustomers\)/, 'remove-link opens before the optional Contacts read')
assert.match(sales, /readContactDuplicateDecisionError\(error\)[\s\S]{0,120}duplicateDecisionRequired/, 'create duplicate races return the form recovery contract')
assert.match(sales, /updateCustomer\(String\(form\.id\), \{ name: after, __rename_cascade:/, 'Edit current sends a name-only profile payload')
assert.doesNotMatch(nameModalSource, /name="[^"]*(?:phone|membership|address|notes)|onSave\(\{/, 'the name editor must not render or submit other profile fields')
assert.match(detail, /t\('sale_customer_actions'\)/, 'the Sale Detail entry point is localized')
assert.doesNotMatch(modalSource, /choices\.filter/, 'server phone or membership matches must not be hidden by a second name-only filter')
assert.match(modalSource, /SALE_CUSTOMER_SEARCH_DEBOUNCE_MS = 300/, 'server search is debounced')

const zeroStart = sales.indexOf('if (result.changedCount === 0)')
const zeroEnd = sales.indexOf('return false', zeroStart)
const zeroBlock = sales.slice(zeroStart, zeroEnd)
assert.ok(zeroStart >= 0)
assert.ok(zeroBlock.indexOf('savePendingBulkFieldRequest(null)') < zeroBlock.indexOf('refreshSaleCustomerViews()'), 'known zero-change receipts clear the retry before refreshing')
assert.match(zeroBlock, /setSaleCustomerPrompt\(null\)/)
assert.match(sales, /if \(pendingBulkFieldRequest && !retryRequest\)[\s\S]{0,500}const payload: BulkSaleUpdatePayload = retryRequest \|\|/, 'a new link body cannot overwrite an unknown frozen request')

const classifierStart = sales.indexOf('export function isKnownUncommittedCustomerCreateError')
const classifierEnd = sales.indexOf('\n\nexport default function Sales', classifierStart)
assert.ok(classifierStart >= 0 && classifierEnd > classifierStart)
const classifierCode = ts.transpileModule(`${sales.slice(classifierStart, classifierEnd).replace('export ', '')}; return isKnownUncommittedCustomerCreateError`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const isKnownUncommittedCustomerCreateError = new Function(classifierCode)() as (error: unknown) => boolean
assert.equal(isKnownUncommittedCustomerCreateError({ status: 403 }), true)
assert.equal(isKnownUncommittedCustomerCreateError({ reason: 'server_offline' }), true)
assert.equal(isKnownUncommittedCustomerCreateError({ reason: 'server_unreachable' }), false)
assert.equal(isKnownUncommittedCustomerCreateError({ code: 'request_timeout' }), false)
assert.equal(isKnownUncommittedCustomerCreateError({ status: 503 }), false)
console.log('PASS create recovery distinguishes known rejection from an honestly unknown outcome')

// Exercise the real transport: the one-sale body and receipt id must arrive
// unchanged at the durable bulk endpoint.
__resetApiWriteDedupeForTests()
__resetApiHealthForTests()
setSyncServerUrl('https://sync.example.test')
setSyncToken('sale-customer-token')
const originalFetch = globalThis.fetch
const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  calls.push([input, init])
  return Promise.resolve(new Response(JSON.stringify({ actionHistoryId: 91, changedCount: 1, unchangedCount: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}) as typeof fetch
const request: BulkSaleUpdatePayload = {
  client_request_id: 'f72-link-exact-request',
  items: [{ id: 72, expected_updated_at: '2026-09-08 11:00:00' }],
  action: { kind: 'customer', source_id: 4, target_id: 9 },
}
try {
  const result = await updateSalesBulkField(request)
  assert.deepEqual(result, { actionHistoryId: 91, changedCount: 1, unchangedCount: 0 })
  assert.equal(calls.length, 1)
  assert.equal(String(calls[0][0]), 'https://sync.example.test/api/sales/bulk-update')
  assert.equal(calls[0][1]?.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0][1]?.body)), request)
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  setSyncToken('')
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
}
console.log('PASS real sales transport preserves the exact one-sale customer request')

class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style: Record<string, string> = {}
  namespaceURI: string
  nodeValue = ''
  private ownText = ''
  private attributes = new Map<string, string>()

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
  }
  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; const index = this.childNodes.indexOf(before); if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child }
  removeChild(child: MemoryNode): MemoryNode { const index = this.childNodes.indexOf(child); if (index >= 0) this.childNodes.splice(index, 1); child.parentNode = null; return child }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  focus(): void { this.ownerDocument.activeElement = this }
  contains(target: MemoryNode | null): boolean { return target === this || this.childNodes.some((child) => child.contains(target)) }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling(): MemoryNode | null { if (!this.parentNode) return null; const index = this.parentNode.childNodes.indexOf(this); return this.parentNode.childNodes[index + 1] ?? null }
  set textContent(value: string) { this.ownText = String(value); this.childNodes = [] }
  get textContent(): string { if (this.nodeType === 3) return this.nodeValue; return this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText }
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
memoryDocument.createElementNS = (namespaceURI, name) => new MemoryNode(1, name, memoryDocument, namespaceURI)
memoryDocument.createTextNode = (value) => { const node = new MemoryNode(3, '#text', memoryDocument); node.nodeValue = String(value); return node }
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

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  plugins: [
    {
      name: 'sale-customer-action-test-modal',
      enforce: 'pre',
      resolveId(id) { return id.includes('/shared/Modal') || id.includes('..\\shared\\Modal') ? '\0sale-customer-test-modal' : null },
      load(id) {
        if (id !== '\0sale-customer-test-modal') return null
        return `import React from 'react'; export default function Modal({ title, children }) { return React.createElement('section', { 'data-testid': 'modal' }, React.createElement('h2', null, title), children) }`
      },
    },
    react(),
  ],
})

try {
  const actionModule = await vite.ssrLoadModule('/src/components/sales/SaleCustomerActionModal.tsx') as {
    default: React.ComponentType<Record<string, unknown>>
    useDebouncedSaleCustomerSearch: (query: string, onSearch?: (query: string) => void) => void
  }
  const nameModule = await vite.ssrLoadModule('/src/components/sales/SaleCustomerNameModal.tsx') as { default: React.ComponentType<Record<string, unknown>> }
  const translate = (_key: string, fallback: string) => fallback
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  const common = { saleLabel: 'S-72', currentName: 'Old customer', hasCurrentCustomer: true, choices: [], saving: false, translate, onClose() {}, onReplace() {}, onRemove() {} }

  await act(async () => root.render(React.createElement(actionModule.default, { ...common, key: 'remove-only' })))
  assert.match(container.textContent, /Remove link/)
  assert.match(container.textContent, /Customer search needs Contacts view permission/)
  assert.doesNotMatch(container.textContent, /Create customer|Edit current name|Find by name/)

  await act(async () => root.render(React.createElement(actionModule.default, {
    ...common,
    key: 'independent-grants',
    choices: [{ id: 9, name: 'Alice', phone: '012 345 678' }],
    onSearch() {},
    onCreate() {},
  })))
  assert.match(container.textContent, /Alice/, 'a server-returned phone or membership hit remains visible even when its name does not match the query')
  assert.match(container.textContent, /Create customer/)
  assert.doesNotMatch(container.textContent, /Edit current name/)

  await act(async () => root.render(React.createElement(actionModule.default, {
    ...common,
    key: 'unknown-create',
    choices: [{ id: 9, name: 'Alice', phone: '012 345 678' }],
    createRecovery: { name: 'Unknown customer', query: 'LC-900' },
    onSearch() {},
    onCreate() {},
    onClearCreateRecovery() {},
  })))
  assert.match(container.textContent, /Do not create it again/)
  assert.match(container.textContent, /I checked Contacts/)
  assert.doesNotMatch(container.textContent, /Create customer/, 'an unknown create cannot be repeated until the operator explicitly reconciles it')
  assert.match(container.textContent, /Alice/, 'server results remain selectable for reconciliation')

  await act(async () => root.render(React.createElement(actionModule.default, { ...common, key: 'edit-grant', onEdit() {} })))
  assert.match(container.textContent, /Edit current name/)
  assert.doesNotMatch(container.textContent, /Create customer/)

  const searchCalls: string[] = []
  const recordSearch = (query: string) => searchCalls.push(query)
  function SearchHarness({ query }: { query: string }) {
    actionModule.useDebouncedSaleCustomerSearch(query, recordSearch)
    return React.createElement('span', null, query)
  }
  await act(async () => root.render(React.createElement(SearchHarness, { query: 'a' })))
  await act(async () => root.render(React.createElement(SearchHarness, { query: 'alice' })))
  await act(async () => root.render(React.createElement(SearchHarness, { query: '012345' })))
  assert.deepEqual(searchCalls, [])
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 360)) })
  assert.deepEqual(searchCalls, ['012345'], 'mounted typing issues one server search for the latest query')

  await act(async () => root.render(React.createElement(nameModule.default, { currentName: 'Old customer', translate, onSave: async () => true, onClose() {} })))
  assert.match(container.textContent, /edits only the customer profile name/)
  assert.match(container.textContent, /Phone, membership number, addresses, and notes stay unchanged/)
  await act(async () => root.unmount())
} finally {
  await vite.close()
}
console.log('PASS mounted customer UI enforces independent grants, durable remove access, truthful name scope, unfiltered results, and debounced search')

for (const language of ['en', 'km']) {
  const labels = JSON.parse(readFileSync(resolve(frontendRoot, `src/lang/${language}.json`), 'utf8')) as Record<string, string>
  const keys = new Set([
    ...[modalSource, nameModalSource].flatMap((source) => [...source.matchAll(/translate\('(sale_customer_[a-z0-9_]+)'/g)].map((match) => match[1])),
    'sale_customer_actions',
    'sale_customer_conflict',
    'sale_customer_choices_load_failed',
    'sale_customer_create_failed',
    'sale_customer_create_id_missing',
    'sale_customer_name_exists',
    'sale_customer_name_updated',
    'sale_customer_current_unavailable',
    'sale_customer_current_load_failed',
  ])
  for (const key of keys) assert.ok(labels[key], `missing ${language} ${key}`)
}
console.log('PASS every F72 customer-action label exists in English and Khmer')
