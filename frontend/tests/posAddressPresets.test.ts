import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { transformSync } from 'esbuild'

import {
  addressPrefixBeforePreset,
  cartTotalQuantity,
  composeAddress,
  normalizeAddressPresets,
  validateAddressPresets,
} from '../src/utils/addressPresets.ts'
import {
  normalizeAddressPresets as normalizeWorkerAddressPresets,
  validateAddressPresets as validateWorkerAddressPresets,
} from '../../cloudflare/src/lib/addressPresets.ts'
import { invalidateActorReadChannel } from '../src/api/actorReadScope.ts'

const pos = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../src/components/pos/AddressPresetPicker.tsx', import.meta.url), 'utf8')
const quickAdd = readFileSync(new URL('../src/components/pos/POSQuickAddModals.tsx', import.meta.url), 'utf8')
const transport = readFileSync(new URL('../src/api/posAddressPresetsTransport.ts', import.meta.url), 'utf8')
const settingsSensitive = readFileSync(new URL('../../cloudflare/src/lib/settingsSensitive.ts', import.meta.url), 'utf8')

const raw = {
  province: [' Phnom Penh ', 'phnom   penh', 'Kandal'],
  district: ['Chamkar Mon'],
  subdistrict: [' Tonle Bassac '],
}
assert.deepEqual(normalizeAddressPresets(raw), normalizeWorkerAddressPresets(raw), 'frontend and Worker normalization must match')
assert.deepEqual(validateAddressPresets(raw), validateWorkerAddressPresets(raw), 'frontend and Worker validation must match')
assert.deepEqual(normalizeAddressPresets(raw), {
  province: ['Phnom Penh', 'Kandal'],
  district: ['Chamkar Mon'],
  subdistrict: ['Tonle Bassac'],
})

const first = composeAddress('ផ្ទះ 12 ផ្លូវ 3', {
  province: 'ភ្នំពេញ',
  district: 'ខណ្ឌចំការមន',
  subdistrict: 'សង្កាត់ទន្លេបាសាក់',
})
assert.equal(first.address, 'ផ្ទះ 12 ផ្លូវ 3, សង្កាត់ទន្លេបាសាក់, ខណ្ឌចំការមន, ភ្នំពេញ')
assert.equal(addressPrefixBeforePreset(first.address, first.suffix), 'ផ្ទះ 12 ផ្លូវ 3', 'reopening replaces only the exact previously applied suffix')
assert.equal(addressPrefixBeforePreset('House 12, manually changed', first.suffix), 'House 12, manually changed', 'manual free text is never stripped by a stale suffix')
assert.equal(composeAddress('House  12 / Street  3', { province: 'Phnom Penh' }).address, 'House  12 / Street  3, Phnom Penh', 'applying presets retains deliberately typed prefix spacing')

assert.equal(cartTotalQuantity([{ quantity: 2 }, { quantity: '3' }, { quantity: 0.5 }, { quantity: -1 }, { quantity: 'bad' }]), 5.5)
assert.match(pos, /pos_item_line[\s\S]{0,300}pos_item_lines[\s\S]{0,240}pos_total_quantity/, 'singular/plural line count and total quantity share the cart summary row')
assert.match(pos, /cartTotalQuantity\(active\.cart\)/)
assert.match(pos, /pos-customer-address-inline[^]*?onClick=\{\(\) => setAddressPresetTarget\('order'\)\}/, 'clicking the order Address opens its target without removing free-text onChange')
assert.match(pos, /onApply=\{\(\{ address, suffix \}\) => \{[^]*?patchActive\(\{ customer: \{ \.\.\.active\.customer, address \} \}\)/)
assert.match(pos, /actorKey=\{captureActorReadScope\('pos:address-presets'\)\.authority\}/, 'same-account relogin uses the opaque session authority, not an id/org cache key')
assert.match(quickAdd, /pos-quick-customer-address[^]*?onChange=[^]*?onClick=\{onOpenCustomerAddressPresets\}[^]*?aria-haspopup="dialog"/, 'quick-add address remains free text and opens the shared picker explicitly')
assert.match(pos, /addressPresetTarget === 'quick-customer' \? newCustomerForm\.address : \(active\.customer\.address \|\| ''\)/)
assert.match(pos, /quickCustomerAddressSuffixRef\.current = suffix[^]*?setNewCustomerForm\(\(form\) => \(\{ \.\.\.form, address \}\)\)[^]*?appliedAddressSuffixRef\.current\[String\(active\.id\)\] = suffix/s, 'quick and order Apply paths update only their own address and suffix')
assert.equal((pos.match(/resetQuickCustomerAddressPreset\(\)/g) || []).length, 4, 'new draft, cancel, successful create, and use-existing resolution clear the quick suffix')
assert.match(pos, /if \(duplicateCheck\) \{ setCustomerDuplicateCheck\(duplicateCheck\); return \}/, 'duplicate review keeps the current quick draft and suffix until the flow resolves')

const require = createRequire(import.meta.url)
const quickModule = { exports: {} as any }
const compiledQuickAdd = transformSync(quickAdd, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', compiledQuickAdd)((id: string) => {
  if (id === 'react/jsx-runtime') return require(id)
  if (id.includes('QuickAddModal')) return { __esModule: true, default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }
  if (id.includes('phoneInput')) return { formatPhoneInputElement: () => '', handlePhoneInputBeforeInput() {}, handlePhoneInputKeyDown() {} }
  throw new Error(`Unexpected quick-add dependency ${id}`)
}, quickModule, quickModule.exports)
let quickAddressOpened = 0
let normalQuickCreate = 0
let quickForm = { name: 'Dara', phone: '', address: 'House 12', membership_number: '' }
const quickTree = quickModule.exports.default({
  closeAddCustomerModal() {}, closeAddDeliveryModal() {}, customerDuplicateCheck: null, deliveryDuplicateCheck: null,
  clearCustomerDuplicateCheck() {}, clearDeliveryDuplicateCheck() {}, handleAddCustomer() { normalQuickCreate++ }, handleAddDelivery() {},
  handleCreateSeparateCustomer() {}, handleCreateSeparateDelivery() {}, handleUseExistingCustomer() {}, handleUseExistingDelivery() {},
  onOpenCustomerAddressPresets() { quickAddressOpened++ }, newCustomerForm: quickForm, newDeliveryForm: { name: '', phone: '', area: '' },
  posCopy: (value: string) => value, savingCustomer: false, savingDelivery: false,
  setNewCustomerForm(update: typeof quickForm | ((form: typeof quickForm) => typeof quickForm)) { quickForm = typeof update === 'function' ? update(quickForm) : update },
  setNewDeliveryForm() {}, showAddCustomer: true, showAddDelivery: false, t: (key: string) => key,
})
function findElement(node: any, predicate: (element: any) => boolean): any {
  if (Array.isArray(node)) return node.map((child) => findElement(child, predicate)).find(Boolean)
  if (!React.isValidElement(node)) return null
  if (predicate(node)) return node
  return findElement((node.props as { children?: React.ReactNode }).children, predicate)
}
const quickAddressInput = findElement(quickTree, (element) => element.props?.id === 'pos-quick-customer-address')
assert.ok(quickAddressInput, 'actual quick-add component retains its customer Address input')
quickAddressInput.props.onClick()
quickAddressInput.props.onChange({ target: { value: 'House 14' } })
assert.equal(quickAddressOpened, 1)
assert.equal(quickForm.address, 'House 14', 'picker access does not replace ordinary free-text editing')
findElement(quickTree, (element) => typeof element.props?.onSave === 'function').props.onSave()
assert.equal(normalQuickCreate, 1, 'normal quick customer creation remains wired')

assert.match(picker, /captureActorReadScope\('pos:address-presets'\)/)
assert.match(picker, /isActorReadScopeCurrent\(actorScope, false\)/, 'late reads guard actor authority while ignoring unrelated data revision invalidation')
assert.match(picker, /const persist = async[^]*?const requestId = \+\+requestRef\.current[^]*?const actorScope = captureActorReadScope\('pos:address-presets'\)[^]*?savePosAddressPresets[^]*?requestRef\.current !== requestId \|\| !isActorReadScopeCurrent\(actorScope, false\)[^]*?return false[^]*?setPresets\(response\.presets\)/, 'a deferred save cannot publish an earlier actor result')
assert.match(picker, /catch \(saveError\) \{\s*if \(requestRef\.current !== requestId \|\| !isActorReadScopeCurrent\(actorScope, false\)\) return false/, 'an earlier actor save failure is also silent')
assert.equal((picker.match(/requestRef\.current === completedRequestId && isActorReadScopeCurrent\(callerScope, false\)/g) || []).length, 3, 'add, rename, and remove recheck both generation and actor in their own post-await continuation')
assert.match(picker, /setPendingRemove\(''\)\s*setSaving\(false\)\s*void load\(\)/, 'a new actor generation clears the old actor saving state')
assert.match(picker, /address_house_street/, 'the full field label avoids the reserved i18n *_prefix suffix')
assert.doesNotMatch(picker, /tr\('address_prefix'/)
assert.match(picker, /response\.can_manage === true/)
assert.match(picker, /disabled=\{!canManage\}/, 'read-only POS access cannot open management controls')
assert.match(picker, /onApply\(preview\)/, 'selection changes only a preview until explicit Apply')
assert.match(transport, /apiFetch\('GET', '\/api\/pos\/address-presets'\)/)
assert.match(transport, /apiFetch\('PUT', '\/api\/pos\/address-presets'/)
assert.doesNotMatch(transport, /localDb|localStorage|routeMirrored/, 'shared presets never fall back to another actor\'s local cache')
assert.match(settingsSensitive, /'pos_address_presets_v1'/, 'the dedicated row is excluded from broad settings/bootstrap reads')

// Execute the actual transport module: GET is a direct private apiFetch while
// PUT retains route()'s write handling. This catches the original accidental
// `route(..., true)` GET classification rather than merely source-matching it.
const transportModule = { exports: {} as any }
let routeCalls = 0
const apiCalls: string[] = []
const compiledTransport = transformSync(transport, { loader: 'ts', format: 'cjs' }).code
new Function('require', 'module', 'exports', compiledTransport)((id: string) => {
  if (id === './http.ts') return {
    apiFetch: async (method: string) => { apiCalls.push(method); return { can_manage: true, configured: false, revision: null, presets: { province: [], district: [], subdistrict: [] } } },
    route: async (_channel: string, server: () => Promise<unknown>) => { routeCalls++; return server() },
  }
  throw new Error(`Unexpected transport dependency ${id}`)
}, transportModule, transportModule.exports)
await transportModule.exports.getPosAddressPresets()
assert.deepEqual(apiCalls, ['GET'])
assert.equal(routeCalls, 0, 'private GET bypasses route cache/write invalidation entirely')
await transportModule.exports.savePosAddressPresets({ province: [], district: [], subdistrict: [] }, null)
assert.deepEqual(apiCalls, ['GET', 'PUT'])
assert.equal(routeCalls, 1, 'PUT retains the established write dispatcher')

// Mount the actual picker component (only Modal/icons/HTTP are substituted).
// Its successful GET deliberately invalidates `pos`, reproducing the browser
// failure that previously left Loading visible forever. Actor authority is
// unchanged, so the mounted picker must publish the returned Province.
class MemoryNode {
  nodeType: number; nodeName: string; tagName: string; ownerDocument: any
  namespaceURI = 'http://www.w3.org/1999/xhtml'; parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []; style = {}; nodeValue = ''; ownText = ''
  constructor(type: number, name: string, doc: any) { this.nodeType = type; this.nodeName = name; this.tagName = name; this.ownerDocument = doc }
  appendChild(child: MemoryNode) { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode) { child.parentNode = this; this.childNodes.splice(Math.max(0, this.childNodes.indexOf(before)), 0, child); return child }
  removeChild(child: MemoryNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child }
  addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {}
  get firstChild() { return this.childNodes[0] || null }
  set textContent(text: string) { this.ownText = text; this.childNodes = [] }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.length ? this.childNodes.map((node) => node.textContent).join('') : this.ownText }
}
const doc: any = { nodeType: 9, addEventListener() {}, removeEventListener() {}, cookie: '' }
doc.createElement = (name: string) => new MemoryNode(1, name.toUpperCase(), doc)
doc.createElementNS = (_ns: string, name: string) => doc.createElement(name)
doc.createTextNode = (text: string) => { const node = new MemoryNode(3, '#text', doc); node.nodeValue = text; return node }
doc.documentElement = doc.createElement('html'); doc.body = doc.createElement('body'); doc.activeElement = doc.body
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
const win: any = { document: doc, HTMLElement: MemoryNode, HTMLIFrameElement: class {}, localStorage: storage, sessionStorage: storage, addEventListener() {}, removeEventListener() {} }
doc.defaultView = win
Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

const pickerModule = { exports: {} as any }
const compiledPicker = transformSync(picker, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', compiledPicker)((id: string) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return require(id)
  if (id.startsWith('lucide-react/')) return { __esModule: true, default: () => null }
  if (id.includes('../shared/Modal')) return { __esModule: true, default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }
  if (id.includes('posAddressPresetsTransport')) return {
    getPosAddressPresets: async () => {
      invalidateActorReadChannel('pos')
      return { can_manage: true, configured: true, revision: 'r1', presets: { province: ['Phnom Penh'], district: [], subdistrict: [] } }
    },
    savePosAddressPresets: async () => { throw new Error('not used') },
  }
  if (id.includes('actorReadScope')) return require('../src/api/actorReadScope.ts')
  if (id.includes('addressPresets')) return require('../src/utils/addressPresets.ts')
  throw new Error(`Unexpected picker dependency ${id}`)
}, pickerModule, pickerModule.exports)
const container = doc.createElement('div')
const root = createRoot(container as unknown as Element)
try {
  await act(async () => {
    root.render(React.createElement(pickerModule.exports.default, { actorKey: 'actor-a', currentAddress: '', onApply() {}, onClose() {}, t: (key: string) => key }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert.match(container.textContent, /Phnom Penh/, 'mounted picker publishes a successful private GET despite expected pos data invalidation')
  assert.doesNotMatch(container.textContent, /Loading\.\.\./, 'mounted picker leaves loading state after the successful GET')
} finally {
  await act(async () => root.unmount())
}

console.log('PASS POS item quantity and actor-scoped address preset contract')
