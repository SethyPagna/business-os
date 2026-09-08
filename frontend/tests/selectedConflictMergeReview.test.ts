import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'components', 'products', 'SelectedConflictMergeReviewModal.tsx'), 'utf8')

assert.match(source, /item\.before\.keeper\.name[\s\S]*item\.before\.discarded\.name/, 'the keeper and discarded identities are visible together')
assert.match(source, /item\.before\.keeper\.barcode[\s\S]*item\.before\.discarded\.barcode/, 'both exact identity barcodes remain visible')
assert.match(source, /item\.before\.keeper\.is_active[\s\S]*item\.before\.discarded\.is_active/, 'authoritative active state is not hidden')
for (const field of ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr']) {
  assert.ok(source.includes(field), `before/after review must render ${field}`)
}
for (const field of ['keeper_quantity', 'discarded_quantity', 'keeper_lot_count', 'discarded_lot_count']) {
  assert.ok(source.includes(field), `before review must show ${field}`)
}
assert.match(source, /const resolvedChoice = choice \|\| \(!item\.needs_stock_choice \? 'merge' : null\)/, 'an unstocked pair can show its deterministic After state without inventing a stock choice')
assert.match(source, /after_by_stock_choice\[resolvedChoice\]/, 'the visible After state follows the explicit stock decision')
assert.match(source, /\(\['merge', 'write_off'\] as const\)\.map/, 'both stock outcomes are offered')
assert.match(source, /checked=\{choice === value\}/)
assert.match(source, /disabled=\{choiceDisabled\}/, 'stock decisions are frozen after confirmation so the visible projection matches the retained request body')
assert.doesNotMatch(source, /useState<SelectedConflictStockChoice>/, 'the component must not preselect a destructive stock outcome')
assert.match(source, /selectedConflictChoicesComplete\(preview\.cases, choices\)/, 'confirmation waits for every required stock choice')
assert.match(source, /&& !needsRefresh/, 'a stale preview cannot be reconfirmed')
assert.match(source, /onClick=\{onRefresh\}/, 'the operator can explicitly reload a stale manifest')
assert.match(source, /<ConfirmDialog[\s\S]*layer="nested"/, 'one explicit final confirmation sits above the combined review')
assert.match(source, /committedCases\.map/, 'committed pairs remain visible while a conflicted remainder is reviewed again')
assert.match(source, /result\.refusals\.map/)
assert.match(source, /result\.pendingCaseKeys\.map/, 'pending cases remain named separately from committed and refused work')
assert.match(source, /result\.remainingCaseCount == null \? tr\('unknown'/, 'unknown remaining work is never rendered as zero')
assert.match(source, /item\.undoReady[\s\S]*item\.actionHistoryId[\s\S]*item\.undoAvailability === 'pending'[\s\S]*item\.operationId/, 'each committed pair exposes ready, pending, or terminally unavailable Undo truth')
assert.match(source, /unknownOutcome[\s\S]*selected_conflict_unknown_outcome/, 'an uncertain write outcome has a distinct reconciliation message')
assert.match(source, /canResume[\s\S]*onClick=\{onResume\}/, 'timeout and retryable interruptions expose a same-request resume action')
assert.match(source, /canRepreview[\s\S]*onClick=\{onRefresh\}/, 'state conflicts re-preview the remaining pairs instead of retrying stale state')
assert.match(source, /previousReview[\s\S]*selected_conflict_changed_since_review[\s\S]*selected_conflict_previous_review_values/, 'a changed fingerprint shows the previous reviewed values beside the fresh review')
assert.match(source, /gallery\.slice\(0, 4\)[\s\S]*gallery\.length > 4[\s\S]*setExpanded/, 'large galleries show their full count and an explicit expansion action')
assert.match(source, /tr\('primary', 'Primary'\)/, 'image projections label the primary image independently from the gallery')
assert.match(source, /onClick=\{onClose\}>\{working \? tr\('selected_conflict_cancel_and_refresh'/, 'Cancel remains available during the request and refreshes through the owner')

assert.match(source, /export function SelectedConflictGroupReviewModal/, 'the N-row workflow has a distinct review-only surface')
for (const field of ['category', 'brand', 'unit']) {
  assert.match(source, new RegExp(`field="${field}_source_id"`), `the resolved ${field} must come from an explicit member source`)
}
for (const mode of ['canonical', 'member', 'clear']) {
  assert.ok(source.slice(source.indexOf('function GroupBarcodeSelect'), source.indexOf('function GroupReviewCard')).includes(`mode: '${mode}'`), `barcode resolution includes ${mode}`)
}
assert.doesNotMatch(source.slice(source.indexOf('function GroupBarcodeSelect'), source.indexOf('function GroupReviewCard')), /<input/, 'barcode cannot be manually edited inside the conflict review')
for (const field of ['supplier_name', 'received_at', 'expiry_date', 'lot_code', 'batch_key', 'received_quantity', 'received_cost_usd', 'unit_cost_usd', 'payment_status', 'credit_due_date']) {
  assert.ok(source.includes(field), `member lot history must expose ${field}`)
}
assert.match(source, /group\.stock\.rows\.filter\(\(row\) => row\.product_id === member\.id\)/, 'before stock stays attributed to each member')
assert.match(source, /group\.stock\.projected_by_branch\.map/, 'resolved stock is shown by branch')
assert.match(source, /group\.lots\.projected_quantity/, 'resolved lot quantity is visible')
assert.match(source, /group\.economics\.merged/, 'server-computed original-group economics drive the After display')
assert.match(source, /distinct non-zero values from the original group/, 'the immutable group-wide cost rule is explained')
assert.match(source, /function RemovalReviewCard[\s\S]*removal\.reason[\s\S]*removal\.branch_stock[\s\S]*removal\.batches/, 'independent removals show reason, stock, and lot evidence before apply')
assert.match(source, /clears current stock and deactivates the product while preserving transaction and history records/, 'removal effects and same-identity Undo are explained')
assert.match(source, /selectedConflictGroupChoicesComplete\(allGroups, choices\)/, 'finalization waits for every actionable group choice across every loaded page')
assert.match(source, /review\.counts\.actionable_groups \+ review\.counts\.blocked_groups \+ review\.counts\.requested_removals/, 'page completion uses canonical stored groups plus every independent removal, not the larger pre-dedup request count')
assert.match(source, /onFinalize\(\)[\s\S]*setConfirmOpen\(true\)/, 'the server freezes the complete review before the one confirmation opens')
assert.match(source, /<ConfirmDialog[\s\S]*onConfirm=\{\(\) => \{ setConfirmOpen\(false\); onApply\(\) \}\}/, 'one confirmation starts the already frozen apply request')
assert.match(source, /applyResult\.approval_required[\s\S]*not reported as completed/, 'approval-pending removals remain distinct from completed actions')
assert.match(source, /review_reversed[\s\S]*Redo the visible group action/, 'a reversed prefix is not silently replayed')
assert.match(source, /applyError\?\.code !== 'review_reversed'/, 'a reversed review cannot expose a misleading same-request Resume action')
assert.match(source, /unknownOutcome[\s\S]*same review receipt and request ID/, 'unknown outcomes explicitly resume the immutable request')
assert.match(source, /choicesFrozen=\{Boolean\(finalized\)\}/, 'choices freeze after finalization')
assert.match(source, /onPreviousPage[\s\S]*onNextPage/, 'one modal pages through the durable global review')
assert.match(source.slice(source.indexOf('export function SelectedConflictGroupReviewModal')), /ModalCloseContext\.Consumer[\s\S]*requestClose \|\| onClose/, 'the footer Close preserves locally selected sources through the same unsaved guard as the header X')

console.log('PASS selected conflict reviews show exact before/after, global choices, independent removal, one confirmation, and resumable receipts')

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
    this.nodeType = nodeType; this.nodeName = nodeName; this.tagName = nodeName; this.ownerDocument = ownerDocument
  }
  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode { child.parentNode = this; const index = this.childNodes.indexOf(before); if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child }
  removeChild(child: MemoryNode): MemoryNode { this.childNodes = this.childNodes.filter((item) => item !== child); child.parentNode = null; return child }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(): void {}
  removeAttribute(): void {}
  focus(): void { this.ownerDocument.activeElement = this }
  contains(target: MemoryNode | null): boolean { return target === this || this.childNodes.some((child) => child.contains(target)) }
  get firstChild(): MemoryNode | null { return this.childNodes[0] || null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] || null }
  get nextSibling(): MemoryNode | null { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  set textContent(value: string) { this.ownText = String(value); this.childNodes = [] }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : (this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText) }
}

type MemoryDocument = {
  nodeType: number; nodeName: string; documentElement: MemoryNode; body: MemoryNode; activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null; createElement: (name: string) => MemoryNode; createElementNS: (_namespace: string, name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode; addEventListener: () => void; removeEventListener: () => void
}

const memoryDocument = {} as MemoryDocument
memoryDocument.nodeType = 9; memoryDocument.nodeName = '#document'; memoryDocument.defaultView = null
memoryDocument.createElement = (name) => new MemoryNode(1, name.toUpperCase(), memoryDocument)
memoryDocument.createElementNS = (_namespace, name) => new MemoryNode(1, name, memoryDocument)
memoryDocument.createTextNode = (text) => { const node = new MemoryNode(3, '#text', memoryDocument); node.nodeValue = text; return node }
memoryDocument.addEventListener = () => {}; memoryDocument.removeEventListener = () => {}
memoryDocument.documentElement = memoryDocument.createElement('html'); memoryDocument.body = memoryDocument.createElement('body')
memoryDocument.documentElement.appendChild(memoryDocument.body); memoryDocument.activeElement = memoryDocument.documentElement
const memoryWindow = { document: memoryDocument, HTMLElement: MemoryNode, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, getSelection() { return null }, setTimeout, clearTimeout }
memoryDocument.defaultView = memoryWindow
Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

type CapturedProps = Record<string, unknown> & { children?: React.ReactNode }
let modalProps: CapturedProps | null = null
let confirmProps: CapturedProps | null = null
const vite = await createServer({
  root: join(here, '..'), configFile: false, appType: 'custom', server: { middlewareMode: true },
  plugins: [{
    name: 'selected-conflict-mounted-mocks', enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/shared/Modal.tsx')) return '\0f65-modal'
      if (id.endsWith('/shared/ConfirmDialog.tsx')) return '\0f65-confirm'
      if (id.includes('/AppContext.tsx')) return '\0f65-app'
      if (id.endsWith('/products/shared/primitives.tsx')) return '\0f65-primitives'
      return null
    },
    load(id) {
      if (id === '\0f65-modal') return `export default function Modal(props) { globalThis.__f65ModalProps = props; return null }`
      if (id === '\0f65-confirm') return `export default function ConfirmDialog(props) { globalThis.__f65ConfirmProps = props; return null }`
      if (id === '\0f65-app') return `export const useApp = () => ({ fmtUSD: (value) => '$' + Number(value).toFixed(2), fmtKHR: (value) => Number(value).toFixed(0) + ' KHR' })`
      if (id === '\0f65-primitives') return `export function ProductImg() { return null }`
      return null
    },
  }, react()],
})

function textOf(value: React.ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (React.isValidElement(value)) return textOf((value.props as { children?: React.ReactNode }).children)
  return ''
}

function findButton(value: React.ReactNode, label: string): React.ReactElement<{ disabled?: boolean; onClick?: () => void }> | null {
  if (Array.isArray(value)) {
    for (const child of value) { const found = findButton(child, label); if (found) return found }
    return null
  }
  if (!React.isValidElement(value)) return null
  if (value.type === 'button' && textOf((value.props as { children?: React.ReactNode }).children).includes(label)) return value as React.ReactElement<{ disabled?: boolean; onClick?: () => void }>
  return findButton((value.props as { children?: React.ReactNode }).children, label)
}

try {
  const module = await vite.ssrLoadModule('/src/components/products/SelectedConflictMergeReviewModal.tsx') as { SelectedConflictGroupReviewModal: React.ComponentType<Record<string, unknown>> }
  const review = {
    success: true, manifest_version: 1, resolution_version: 2, review_id: 'review-1', draft_digest: 'draft-1', manifest_digest: null, status: 'draft', expires_at: '2099-01-01',
    counts: { requested_actions: 2, requested_groups: 1, requested_removals: 1, actionable_groups: 1, blocked_groups: 0, total_members: 3 },
    page: { cursor: '0', next_cursor: null, limit: 50, groups: [{
      ordinal: 0, group_key: 'name:serum', source_group_keys: ['name:serum'], member_ids: [1, 2, 3], eligibility_basis: 'name', eligibility_value: 'Serum',
      members: [1, 2, 3].map((id) => ({ id, name: `Serum ${id}`, barcode: `B${id}`, category: 'Skin', brand: 'Brand', unit: 'pcs', image_path: null, updated_at: 'v1', cost_price_usd: id, cost_price_khr: id * 4000, selling_price_usd: id + 10, selling_price_khr: (id + 10) * 4000, wholesale_price_usd: id + 8, wholesale_price_khr: (id + 8) * 4000 })),
      options: { barcode_source_ids: [1, 2, 3], category_source_ids: [1, 2, 3], brand_source_ids: [1, 2, 3], unit_source_ids: [1, 2, 3] },
      economics: { merged: { cost_price_usd: 2, selling_price_usd: 13 }, distinctCosts: { cost_price_usd: [1, 2, 3] }, issues: [] },
      stock: { rows: [], projected_by_branch: [] }, lots: { rows: [], projected_quantity: 0, count: 0 }, state_digest: 'state-1', blocked: null,
    }], removals: [{ action_ordinal: 1, product_id: 9, reason: 'Discontinued duplicate', status: 'reviewed', operation_id: 'remove-9', state_digest: 'state-9', plan_digest: 'plan-9', blocker: null, product: { name: 'Old serum', barcode: 'OLD' }, branch_stock: [{ branch_id: 1, branch_name: 'Shop', quantity: 4 }], batches: [{ lot_code: 'LOT-9', supplier_name: 'Supplier', received_at: '2026-01-01', expiry_date: '2027-01-01' }], branch_batch_stock: [], source_bytes: 10 }] },
  }
  let finalized = 0
  let applied = 0
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(React.createElement(module.SelectedConflictGroupReviewModal, {
      pages: [review], pageIndex: 0, working: false,
      choices: { 'name:serum': { keeper_id: 1, barcode: { mode: 'member', source_product_id: 2 }, category_source_id: 1, brand_source_id: 2, unit_source_id: 3 } },
      finalized: null, applyResult: null, appliedGroups: [], appliedRemovals: [], applyError: null, unknownOutcome: false,
      onChoice() {}, onPreviousPage() {}, onNextPage() {}, onFinalize: async () => { finalized += 1; return true }, onApply: () => { applied += 1 }, onResume() {}, onClose() {}, t: (key: string) => key,
    }))
    await Promise.resolve()
  })
  modalProps = (globalThis as typeof globalThis & { __f65ModalProps?: CapturedProps }).__f65ModalProps || null
  assert.ok(modalProps, 'the combined review mounts through the shared Modal')
  const continueButton = findButton(modalProps.children, 'Continue to confirmation')
  assert.ok(continueButton && !continueButton.props.disabled, 'complete loaded choices enable the one confirmation transition')
  await act(async () => { await continueButton.props.onClick?.(); await Promise.resolve() })
  confirmProps = (globalThis as typeof globalThis & { __f65ConfirmProps?: CapturedProps }).__f65ConfirmProps || null
  assert.equal(finalized, 1, 'the mounted transition finalizes the global server review once')
  assert.ok(confirmProps, 'one nested confirmation mounts after finalization succeeds')
  await act(async () => { (confirmProps?.onConfirm as (() => void) | undefined)?.(); await Promise.resolve() })
  assert.equal(applied, 1, 'the single confirmation invokes one frozen apply start')
  await act(async () => root.unmount())
} finally {
  await vite.close()
}

console.log('PASS mounted global conflict review finalizes once before one apply confirmation')
