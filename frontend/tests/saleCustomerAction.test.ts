import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { updateSalesBulkField, type BulkSaleUpdatePayload } from '../src/api/salesTransport.ts'
import { updateCustomer } from '../src/api/contactWriteTransport.ts'
import { resolveSaleCustomerEditorRoute } from '../src/utils/customerIdentity.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const sales = readFileSync(resolve(frontendRoot, 'src/components/sales/Sales.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const detail = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleDetailModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const modalSource = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleCustomerActionModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const nameModalSource = readFileSync(resolve(frontendRoot, 'src/components/sales/SaleCustomerNameModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')

assert.match(sales, /const canBrowseCustomers = can\('contacts', 'view'\)/)
assert.match(sales, /const canEditCustomerName = can\('contacts', 'edit'\)/)
assert.match(sales, /const canEditCustomerMembership = canEditCustomerName && getPermissionTier\('contacts'\) === 'full'/)
assert.match(sales, /const initialRoute = resolveSaleCustomerEditorRoute\(sale\)/)
assert.match(sales, /getCustomerIdentityById\(customerId\)[\s\S]*resolveSaleCustomerEditorRoute\(sale, customer\) === 'assignment'[\s\S]*setSaleCustomerPrompt/)
assert.match(sales, /resolveSaleCustomerEditorRoute\(sale, customer\) === 'assignment'[\s\S]*if \(!canEditCustomerName\)/, 'a marked current customer routes to assignment before profile edit permission is required')
assert.match(sales, /setSaleCustomerPrompt\(\{ sale: \{ \.\.\.sale \}, choices: \[\] \}\)/, 'General opens the existing-contact assignment flow')
assert.match(sales, /getCustomerIdentityById\(customerId\)/, 'the current linked identity is loaded without exposing anonymous rows to pickers')
assert.match(sales, /const updatedAt = String\(customer\.updated_at \|\| ''\)\.trim\(\)[\s\S]{0,160}if \(!updatedAt\) throw/, 'a profile edit refuses to open without the exact server version')
assert.match(sales, /const payload: Record<string, unknown> = \{ expectedUpdatedAt: form\.updatedAt \}/, 'the reviewed customer version is frozen into the profile PUT')
assert.match(sales, /payload\.membership_number = afterMembership/, 'membership association is a scoped profile update')
assert.match(sales, /payload\.__rename_cascade = renameChoice === 'carry' \? 'carry' : 'record_only'/, 'name edits preserve the explicit linked-record choice')
assert.doesNotMatch(sales, /createCustomer|CustomerFormModal|saleCustomerCreateRecovery/, 'the sale flow cannot create a customer')
assert.doesNotMatch(sales, /attachSaleCustomer|handleAttachMembership|runSaleMembershipMutation/, 'the removed direct membership writer has no mounted or dead caller')
assert.doesNotMatch(modalSource, /Replace customer|Create customer|Remove link|onReplace|onCreate|onRemove/, 'the anonymous editor has no replace, create, or remove action')
assert.match(detail, /t\('sale_customer_edit_entry'\)/, 'the Sale Detail entry point is one localized Edit customer action')
assert.doesNotMatch(modalSource, /customer\.name[^\n]*includes/, 'server phone results are not hidden by a secondary name filter')
assert.match(modalSource, /name\.includes\(normalizedQuery\)/, 'name search is available alongside phone matching')
assert.match(modalSource, /phone\.includes\(queryDigits\)/, 'phone search uses canonical digits')
assert.match(modalSource, /SALE_CUSTOMER_SEARCH_DEBOUNCE_MS = 300/, 'server search is debounced')
assert.match(nameModalSource, /readOnly=\{!membershipCanChange\}/, 'existing membership and non-Full membership access remain read-only')
assert.match(nameModalSource, /Phone is this customer’s primary identity/, 'the real-customer form states the phone identity boundary')
assert.match(sales, /The refreshed sale can leave the active search\/page[\s\S]{0,220}setDetailSale\(null\)/, 'assignment closes an unrefreshable detail instead of showing stale contact snapshots')

const zeroStart = sales.indexOf('if (result.changedCount === 0)')
const zeroEnd = sales.indexOf('return false', zeroStart)
const zeroBlock = sales.slice(zeroStart, zeroEnd)
assert.ok(zeroStart >= 0)
assert.ok(zeroBlock.indexOf('savePendingBulkFieldRequest(null)') < zeroBlock.indexOf('refreshSaleCustomerViews()'), 'known zero-change receipts clear the retry before refreshing')
assert.match(zeroBlock, /setSaleCustomerPrompt\(null\)/)
assert.match(sales, /if \(pendingBulkFieldRequest && !retryRequest\)[\s\S]{0,500}const payload: BulkSaleUpdatePayload = retryRequest \|\|/, 'a new link body cannot overwrite an unknown frozen request')

assert.match(sales, /export function isKnownUncommittedSaleCustomerChangeError/)
console.log('PASS one customer edit entry separates anonymous assignment from scoped real-customer edits')

assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 24969, customer_is_anonymous: 1 }), 'assignment', 'a marked positive customer id uses the assignment editor')
assert.equal(resolveSaleCustomerEditorRoute({ customer_id: 22305, customer_is_anonymous: 0 }, { is_anonymous: 0 }), 'profile', 'an unmarked real customer named General remains profile-editable')
console.log('PASS explicit markers route the sale customer editor without name inference')

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
  action: { kind: 'customer', source_id: null, target_id: 9 },
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

// The customer profile write must use the version returned by the exact
// stable-id server read. No local Dexie customer is seeded in this process;
// the explicit token must reach the real PUT unchanged and a stale response
// must surface without a second write.
__resetApiWriteDedupeForTests()
__resetApiHealthForTests()
setSyncServerUrl('https://sync.example.test')
setSyncToken('sale-customer-token')
const profileCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  profileCalls.push([input, init])
  return Promise.resolve(new Response(JSON.stringify({
    error: 'Customer changed on another device',
    code: 'write_conflict',
    conflict: true,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
}) as typeof fetch
try {
  const conflict = await updateCustomer(9, {
    name: 'Alice Revised',
    expectedUpdatedAt: '2026-09-08 12:34:56',
  }).then(() => null, (error) => error as { status?: number; code?: string; conflict?: boolean })
  assert.equal(profileCalls.length, 1)
  assert.equal(String(profileCalls[0][0]), 'https://sync.example.test/api/customers/9')
  assert.equal(profileCalls[0][1]?.method, 'PUT')
  assert.deepEqual(JSON.parse(String(profileCalls[0][1]?.body)), {
    name: 'Alice Revised',
    expectedUpdatedAt: '2026-09-08 12:34:56',
  })
  assert.equal(conflict?.status, 409)
  assert.equal(conflict?.code, 'write_conflict')
  assert.equal(conflict?.conflict, true)
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
  setSyncToken('')
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
}
console.log('PASS exact customer version reaches the real PUT and stale conflict does not retry')

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
    canonicalizeSaleCustomerPhone: (phone: unknown) => string
  }
  const nameModule = await vite.ssrLoadModule('/src/components/sales/SaleCustomerNameModal.tsx') as { default: React.ComponentType<Record<string, unknown>> }
  const translate = (_key: string, fallback: string) => fallback
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  const common = { saleLabel: 'S-72', choices: [], saving: false, translate, onClose() {}, onAssign() {} }

  function RoutedCustomerEditor({ sale, currentCustomer }: { sale: Record<string, unknown>; currentCustomer?: Record<string, unknown> }) {
    const route = resolveSaleCustomerEditorRoute(sale, currentCustomer)
    if (route === 'assignment') return React.createElement(actionModule.default, { ...common, key: 'routed-assignment' })
    return React.createElement(nameModule.default, {
      key: 'routed-profile',
      currentName: String(currentCustomer?.name || ''),
      currentPhone: String(currentCustomer?.phone || ''),
      currentMembershipNumber: '',
      canAssignMembership: false,
      translate,
      onSave: async () => true,
      onClose() {},
    })
  }

  await act(async () => root.render(React.createElement(RoutedCustomerEditor, {
    sale: { id: 72, customer_id: 24969, customer_name: 'General', customer_is_anonymous: 1 },
  })))
  assert.match(container.textContent, /General/, 'a mounted positive-id marked sale opens assignment with the unified General label')
  assert.doesNotMatch(container.textContent, /Walk-in|General \(anonymous\)/)
  await act(async () => root.render(React.createElement(RoutedCustomerEditor, {
    sale: { id: 73, customer_id: 22305, customer_name: 'General', customer_is_anonymous: 0 },
    currentCustomer: { id: 22305, name: 'General', phone: '086897171', is_anonymous: 0 },
  })))
  assert.match(container.textContent, /Phone is this customer’s primary identity/, 'a mounted unmarked real General opens profile editing')

  await act(async () => root.render(React.createElement(actionModule.default, { ...common, key: 'no-contacts-view' })))
  assert.match(container.textContent, /General/)
  assert.doesNotMatch(container.textContent, /Walk-in|General \(anonymous\)/)
  assert.match(container.textContent, /Assigning an existing customer needs Contacts view permission/)
  assert.doesNotMatch(container.textContent, /Replace customer|Create customer|Remove link/)

  await act(async () => root.render(React.createElement(actionModule.default, {
    ...common,
    key: 'phone-first-match',
    choices: [{ id: 9, name: 'Alice', phone: '012 345 678', membershipNumber: 'LC-009' }],
    onSearch() {},
  })))
  assert.match(container.textContent, /Phone is the primary match/)
  assert.doesNotMatch(container.textContent, /Replace customer|Create customer|Remove link/)
  assert.equal(actionModule.canonicalizeSaleCustomerPhone('+855 12 345 678'), '012345678')
  assert.equal(actionModule.canonicalizeSaleCustomerPhone('012 345 678'), '012345678')

  await act(async () => root.render(React.createElement(actionModule.default, {
    ...common,
    key: 'unknown-assignment',
    pendingOutcome: true,
    onSearch() {},
    onRetryPending() {},
    onDiscardPending() {},
  })))
  assert.match(container.textContent, /previous assignment has an unknown outcome/)
  assert.match(container.textContent, /Retry original request/)
  assert.match(container.textContent, /Discard retry/)

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

  await act(async () => root.render(React.createElement(nameModule.default, {
    currentName: 'Old customer',
    currentPhone: '012 345 678',
    currentMembershipNumber: 'LC-009',
    canAssignMembership: true,
    translate,
    onSave: async () => true,
    onClose() {},
  })))
  assert.match(container.textContent, /Phone is this customer’s primary identity/)
  assert.match(container.textContent, /Name is the secondary display identity/)
  assert.match(container.textContent, /existing membership number is preserved and cannot be changed here/)
  await act(async () => root.render(React.createElement(nameModule.default, {
    currentName: 'No membership yet',
    currentPhone: '098 765 432',
    currentMembershipNumber: '',
    canAssignMembership: false,
    translate,
    onSave: async () => true,
    onClose() {},
  })))
  assert.match(container.textContent, /Assigning membership needs Full Contacts permission/)
  await act(async () => root.unmount())
} finally {
  await vite.close()
}
console.log('PASS mounted customer UI enforces one phone-first anonymous assignment and scoped real-customer editing')

for (const language of ['en', 'km']) {
  const labels = JSON.parse(readFileSync(resolve(frontendRoot, `src/lang/${language}.json`), 'utf8')) as Record<string, string>
  const keys = new Set([
    ...[modalSource, nameModalSource].flatMap((source) => [...source.matchAll(/translate\('(sale_customer_[a-z0-9_]+)'/g)].map((match) => match[1])),
    'sale_customer_edit_entry',
    'sale_customer_conflict',
    'sale_customer_choices_load_failed',
    'sale_customer_name_exists',
    'sale_customer_profile_updated',
    'sale_customer_current_unavailable',
    'sale_customer_current_load_failed',
  ])
  for (const key of keys) assert.ok(labels[key], `missing ${language} ${key}`)
}
console.log('PASS every F72 customer-action label exists in English and Khmer')
