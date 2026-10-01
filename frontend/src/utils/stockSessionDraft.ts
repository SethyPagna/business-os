// The Stock Session model (UI-STOCK spec sections 4, 5): the persisted draft,
// the mode a reopened float starts in, and the pure rules the float and its
// tests share. React-free on purpose.
import { adjustBranchQuantity, receiptDeclaresFree, scopedSetPreview, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS, stockReceiptGateCode, type StockReceiptGateCode } from './stockReceiptFields.ts'
import { multiplyMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4 } from './moneyPrecision.ts'
import { effectiveUnitCost, estimateCatalogCostAfter, matchCostsToPaid, paidItemsTotal, supplierTotalMatches } from './stockSessionMath.ts'
import { formatBatchReceivedDate, lotCodeAsDate } from './batchLabel.ts'
import type { ProductRecord } from './productGrouping.ts'
import type { FastStockInCommitLine } from '../api/inventoryWriteTransport.ts'

export type StockMode = 'add' | 'remove' | 'set'
export const STOCK_MODES: readonly StockMode[] = ['add', 'remove', 'set']
export type StockSessionStep = 'items' | 'payment' | 'review'
export type StockLineStatus = 'queued' | 'saving' | 'saved' | 'error'
/** 'new' = a new received date (Add); 'none' = no dated lot, the branch total; a number = that lot. */
export type LotChoice = 'new' | 'none' | number
export type SessionSupplier = { supplierId: number | null; supplierName: string }
export type PaymentStatus = 'paid' | 'credit'

export interface StockSessionProduct extends ProductRecord {
  id: number | string
  name?: string | null
  barcode?: string | null
  brand?: string | null
  stock_quantity?: number | string | null
  cost_price_usd?: number | string | null
  purchase_price_usd?: number | string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  branch_stock?: Array<{ branch_id?: number | string | null; branch_name?: string | null; quantity?: number | string | null }>
}

export type StockSessionLine = {
  key: string
  // Migration 0192 per-line dedup id: minted once when queued, never regenerated.
  requestId: string
  // A 0192 guard refusal this line cannot recover from under its own id.
  needsRemoval?: boolean
  product: StockSessionProduct
  productName: string
  mode: StockMode
  /** Add: paid units. Remove: units out. Set: the target. */
  quantity: number
  /** Add only: units the supplier gave at no cost. */
  freeQuantity: number
  /** Add only: the unit cost PAID (4 dp), before free units dilute it. */
  unitCost: string
  /** The cost as typed on the Items step, so Payment's reset can restore it. */
  typedUnitCost?: string
  /** Add only: the selling price for the product; equal to the current one = unchanged. */
  sellingPrice: string
  /** v1 lines carried an explicit $0 declaration; kept so an old draft commits as queued. */
  freeGoods: boolean
  expiryDate: string
  batchChoice: LotChoice
  batchLabel: string
  /** Add onto an existing lot: the supplier it already names (first attribution sticks). */
  lotSupplierName?: string
  setScope?: 'lot' | 'branch'
  /** The lot figure the line was previewed against (Set guard, Remove/Set review). */
  expectedLotQuantity?: number
  reason: string
  conditionTag: string
  createdProduct: boolean
  /** Add of a product created in this session: the held ProductForm payload. */
  createPayload?: Record<string, unknown> | null
  createRequestId?: string
  status: StockLineStatus
  detail: string
}

export type StockSessionDraft = {
  version: 2
  sessionId: number
  mode: StockMode
  step: StockSessionStep
  brand: string
  branchId: string
  receivedDate: string
  supplier: SessionSupplier
  paymentStatus: PaymentStatus
  creditDueDate: string
  /** '' follows the items total; anything else is what the operator typed. */
  paidAmount: string
  query: string
  picked: StockSessionProduct | null
  quantity: string
  unitCost: string
  sellingPrice: string
  expiryDate: string
  reason: string
  conditionTag: string
  batchChoice: LotChoice
  createPayload: Record<string, unknown> | null
  createRequestId: string
  scannedBarcode: string
  createdProductIds: string[]
  lines: StockSessionLine[]
}

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const isMode = (value: unknown): value is StockMode => value === 'add' || value === 'remove' || value === 'set'
const isStep = (value: unknown): value is StockSessionStep => value === 'items' || value === 'payment' || value === 'review'

function normalizeLotChoice(value: unknown): LotChoice {
  if (value === 'none') return 'none'
  const id = Number(value)
  return typeof value === 'number' && Number.isSafeInteger(id) && id > 0 ? id : 'new'
}

function normalizeLine(raw: unknown, mintRequestId: () => string): StockSessionLine | null {
  if (!raw || typeof raw !== 'object') return null
  const line = raw as Partial<StockSessionLine> & Record<string, unknown>
  if (!line.product || typeof line.product !== 'object') return null
  const mode = isMode(line.mode) ? line.mode : 'add'
  const status: StockLineStatus = line.status === 'saved' || line.status === 'error' ? line.status : 'queued'
  const quantity = Number(line.quantity)
  const free = Number(line.freeQuantity)
  return {
    key: asString(line.key) || `${String(line.product.id)}-${mintRequestId()}`,
    requestId: asString(line.requestId) || mintRequestId(),
    ...(line.needsRemoval ? { needsRemoval: true } : {}),
    product: line.product as StockSessionProduct,
    productName: asString(line.productName) || String(line.product.name || `#${line.product.id}`),
    mode,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    freeQuantity: mode === 'add' && Number.isSafeInteger(free) && free > 0 ? free : 0,
    unitCost: mode === 'add' ? asString(line.unitCost) : '',
    ...(typeof line.typedUnitCost === 'string' ? { typedUnitCost: line.typedUnitCost } : {}),
    sellingPrice: mode === 'add' ? asString(line.sellingPrice) : '',
    freeGoods: mode === 'add' && line.freeGoods === true,
    expiryDate: mode === 'add' ? asString(line.expiryDate) : '',
    batchChoice: normalizeLotChoice(line.batchChoice),
    batchLabel: asString(line.batchLabel),
    ...(asString(line.lotSupplierName).trim() ? { lotSupplierName: asString(line.lotSupplierName).trim() } : {}),
    ...(line.setScope === 'lot' || line.setScope === 'branch' ? { setScope: line.setScope } : {}),
    ...(Number.isFinite(Number(line.expectedLotQuantity)) && line.expectedLotQuantity != null ? { expectedLotQuantity: Number(line.expectedLotQuantity) } : {}),
    reason: asString(line.reason),
    conditionTag: asString(line.conditionTag),
    createdProduct: Boolean(line.createdProduct),
    ...(line.createPayload && typeof line.createPayload === 'object' ? { createPayload: line.createPayload } : {}),
    ...(typeof line.createRequestId === 'string' && line.createRequestId ? { createRequestId: line.createRequestId } : {}),
    // A line caught mid-save by a reload was never answered; it is queued again.
    status: line.status === 'saving' ? 'queued' : status,
    detail: asString(line.detail),
  }
}

/** Every field a fresh session starts with; the caller's header seeds branch/date/supplier/payment. */
export function emptyStockSessionDraft(seed: {
  sessionId: number
  mode: StockMode
  branchId: string
  receivedDate: string
  supplier?: SessionSupplier
  paymentStatus?: PaymentStatus
  creditDueDate?: string
}): StockSessionDraft {
  return {
    version: 2,
    sessionId: seed.sessionId,
    mode: seed.mode,
    step: 'items',
    brand: '',
    branchId: seed.branchId,
    receivedDate: seed.receivedDate,
    supplier: seed.supplier || { supplierId: null, supplierName: '' },
    paymentStatus: seed.paymentStatus || 'paid',
    creditDueDate: seed.creditDueDate || '',
    paidAmount: '',
    query: '',
    picked: null,
    quantity: '1',
    unitCost: '',
    sellingPrice: '',
    expiryDate: '',
    reason: '',
    conditionTag: '',
    batchChoice: seed.mode === 'add' ? 'new' : 'none',
    createPayload: null,
    createRequestId: '',
    scannedBarcode: '',
    createdProductIds: [],
    lines: [],
  }
}

/**
 * A stored fast_stockin draft (v1 from before the Stock Session, or v2) as a
 * v2 draft, or null when it is not one. v1 lines keep their frozen mode and
 * gain the v2 fields at their neutral defaults.
 */
export function normalizeStockSessionDraft(raw: unknown, mintRequestId: () => string): StockSessionDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const draft = raw as Record<string, unknown>
  const supplier = draft.supplier && typeof draft.supplier === 'object' ? draft.supplier as Partial<SessionSupplier> : {}
  const lines = Array.isArray(draft.lines)
    ? draft.lines.flatMap((line) => { const normalized = normalizeLine(line, mintRequestId); return normalized ? [normalized] : [] })
    : []
  const mode = isMode(draft.mode) ? draft.mode : (lines[0]?.mode || 'add')
  const picked = draft.picked && typeof draft.picked === 'object' ? draft.picked as StockSessionProduct : null
  return {
    version: 2,
    sessionId: Number.isSafeInteger(Number(draft.sessionId)) && Number(draft.sessionId) > 0 ? Number(draft.sessionId) : Date.now(),
    mode,
    step: isStep(draft.step) ? draft.step : 'items',
    brand: asString(draft.brand),
    branchId: draft.branchId == null ? '' : String(draft.branchId),
    receivedDate: asString(draft.receivedDate),
    supplier: {
      supplierId: supplier.supplierId == null || !Number.isFinite(Number(supplier.supplierId)) ? null : Number(supplier.supplierId),
      supplierName: asString(supplier.supplierName),
    },
    paymentStatus: draft.paymentStatus === 'credit' ? 'credit' : 'paid',
    creditDueDate: asString(draft.creditDueDate),
    paidAmount: asString(draft.paidAmount),
    query: asString(draft.query),
    picked,
    quantity: asString(draft.quantity, '1'),
    unitCost: asString(draft.unitCost),
    sellingPrice: asString(draft.sellingPrice),
    expiryDate: asString(draft.expiryDate),
    reason: asString(draft.reason),
    conditionTag: asString(draft.conditionTag),
    batchChoice: normalizeLotChoice(draft.batchChoice),
    createPayload: draft.createPayload && typeof draft.createPayload === 'object' ? draft.createPayload as Record<string, unknown> : null,
    createRequestId: asString(draft.createRequestId),
    scannedBarcode: asString(draft.scannedBarcode),
    createdProductIds: Array.isArray(draft.createdProductIds) ? draft.createdProductIds.map(String) : [],
    lines,
  }
}

/**
 * The mode the float opens in (S1). A draft that holds Items is that session,
 * so it keeps its own mode; otherwise the caller's choice wins and a leftover
 * draft mode is ignored.
 */
export function resolveOpeningMode(draft: Pick<StockSessionDraft, 'mode' | 'lines'> | null | undefined, initialMode?: StockMode | null): StockMode {
  if (draft && draft.lines.length > 0) return isMode(draft.mode) ? draft.mode : (draft.lines[0]?.mode || 'add')
  return isMode(initialMode) ? initialMode : 'add'
}

/**
 * The draft the float actually opens with. Without Items, an entry row typed
 * for another mode (a Set target, a Remove lot) means nothing in the resolved
 * mode, so it is dropped; the shared details stay.
 */
export function openingDraft(draft: StockSessionDraft, initialMode?: StockMode | null): StockSessionDraft {
  const mode = resolveOpeningMode(draft, initialMode)
  if (mode === draft.mode) return draft
  const fresh = emptyStockSessionDraft({
    sessionId: draft.sessionId, mode, branchId: draft.branchId, receivedDate: draft.receivedDate,
    supplier: draft.supplier, paymentStatus: draft.paymentStatus, creditDueDate: draft.creditDueDate,
  })
  return { ...fresh, brand: draft.brand, createdProductIds: draft.createdProductIds }
}

/** Mode is session-level: once Items holds a line the other modes wait (owner Q1 default). */
export function modeSwitchBlocked(lines: readonly unknown[]): boolean {
  return lines.length > 0
}

export function sessionSteps(mode: StockMode, lines: readonly Pick<StockSessionLine, 'mode'>[]): StockSessionStep[] {
  return mode === 'add' || lines.some((line) => line.mode === 'add') ? ['items', 'payment', 'review'] : ['items', 'review']
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** A product created in this session that has not been written yet. */
export function lineNeedsCreate(line: Pick<StockSessionLine, 'createPayload' | 'product'>): boolean {
  return Boolean(line.createPayload) && !(Number(line.product.id) > 0)
}

/** Owner "qty 0 + free = declared free": the gate reads it as the $0 declaration. */
export function lineDeclaresFree(line: Pick<StockSessionLine, 'quantity' | 'freeQuantity' | 'freeGoods'>): boolean {
  return receiptDeclaresFree({ freeGoods: line.freeGoods, quantity: line.quantity, freeQuantity: line.freeQuantity })
}

/** The unit cost the wire carries for an Add line: the paid cost, 0 for a fully free line. */
export function lineWireUnitCost(line: Pick<StockSessionLine, 'quantity' | 'freeQuantity' | 'unitCost'>): number | null {
  if (toNumber(line.quantity) === 0 && toNumber(line.freeQuantity) > 0) return 0
  const typed = String(line.unitCost ?? '').trim()
  if (typed === '') return null
  const cost = Number(typed)
  return Number.isFinite(cost) && cost >= 0 ? roundMoney4(cost) : null
}

/** What the supplier is paid for this line: paid units x paid cost; free units cost nothing. */
export function linePaidTotal(line: Pick<StockSessionLine, 'mode' | 'quantity' | 'unitCost'>): number {
  if (line.mode !== 'add') return 0
  return multiplyMoney4(Math.max(0, toNumber(line.unitCost)), Math.max(0, toNumber(line.quantity)))
}

export function sessionItemsTotal(lines: readonly Pick<StockSessionLine, 'mode' | 'quantity' | 'unitCost'>[]): number {
  return paidItemsTotal(lines.filter((line) => line.mode === 'add').map((line) => ({ qty: Math.max(0, toNumber(line.quantity)), unitCost: Math.max(0, toNumber(line.unitCost)) })))
}

/** The selling price a line would write, or null when it leaves the product's price alone. */
export function lineSellingPriceChange(line: Pick<StockSessionLine, 'mode' | 'sellingPrice' | 'product'>): number | null {
  if (line.mode !== 'add') return null
  const typed = String(line.sellingPrice ?? '').trim()
  if (typed === '') return null
  const next = Number(typed)
  if (!Number.isFinite(next) || next < 0) return null
  const entered = sellingPriceCeilCent(next)
  const current = line.product.selling_price_usd == null || String(line.product.selling_price_usd).trim() === ''
    ? null
    : sellingPriceCeilCent(toNumber(line.product.selling_price_usd))
  return current === entered ? null : entered
}

export type LineRequestContext = {
  branchId: string
  receivedDate: string
  supplier: SessionSupplier
  paymentStatus: PaymentStatus
  creditDueDate: string
  sessionId: number
  canEditPrice: boolean
  /** The movement reason: typed text, else the session label (utils/stockLineReason.ts). */
  reasonFor: (line: StockSessionLine) => string
}

/**
 * One line's wire request. The frozen mode decides the writer: Add goes to the
 * batch-receipt kernel (POST /api/batches), a tagged Add, Remove and Set to
 * POST /api/inventory/adjust. Fields that only some lines use are left off
 * rather than sent empty, so an older line's retry keeps its 0192 fingerprint.
 */
export function buildStockLineRequest(line: StockSessionLine, ctx: LineRequestContext): FastStockInCommitLine {
  const productId = Number(line.product.id)
  const branchId = Number(ctx.branchId)
  const batchId = typeof line.batchChoice === 'number' ? line.batchChoice : null
  if (line.mode === 'remove') {
    return { key: line.key, wire: 'adjust', body: {
      productId, type: 'remove', quantity: line.quantity,
      conditionTag: line.conditionTag || undefined,
      reason: ctx.reasonFor(line), branchId,
      batchId,
      sessionId: ctx.sessionId,
      client_request_id: line.requestId,
    } }
  }
  if (line.mode === 'set') {
    return { key: line.key, wire: 'adjust', body: {
      productId, type: 'set', quantity: line.quantity,
      reason: ctx.reasonFor(line), branchId,
      // A lot-scoped count correction; without a dated lot, the branch total.
      ...(batchId != null ? { setScope: line.setScope || 'lot', batchId, expectedLotQuantity: line.expectedLotQuantity } : {}),
      conditionTag: line.conditionTag || undefined,
      sessionId: ctx.sessionId,
      client_request_id: line.requestId,
    } }
  }
  const free = line.freeQuantity > 0 ? { freeQuantity: line.freeQuantity } : {}
  const price = ctx.canEditPrice ? lineSellingPriceChange(line) : null
  const newPrice = price != null ? { sellingPriceUsd: price } : {}
  const supplierName = ctx.supplier.supplierName.trim() || null
  const creditDueDate = ctx.paymentStatus === 'credit' ? ctx.creditDueDate.trim() : null
  if (line.conditionTag) {
    return { key: line.key, wire: 'adjust', body: {
      productId, type: 'add', quantity: line.quantity,
      reason: ctx.reasonFor(line), branchId,
      conditionTag: line.conditionTag,
      batchId,
      receivedDate: ctx.receivedDate.trim() || null, expiryDate: line.expiryDate.trim() || null,
      supplierId: ctx.supplier.supplierId, supplierName,
      unitCostUsd: lineWireUnitCost(line),
      freeGoods: lineDeclaresFree(line), paymentStatus: ctx.paymentStatus,
      creditDueDate,
      ...free,
      ...newPrice,
      sessionId: ctx.sessionId,
      client_request_id: line.requestId,
    } }
  }
  return { key: line.key, wire: 'receive', body: {
    clientRequestId: line.requestId,
    productId, branchId, quantity: line.quantity,
    // A chosen lot is topped up by id and keeps its own date; only 'new' takes the session date.
    batchId,
    receivedDate: line.batchChoice === 'new' ? (ctx.receivedDate.trim() || null) : null,
    expiryDate: line.expiryDate.trim() || null,
    supplierId: ctx.supplier.supplierId, supplierName,
    unitCostUsd: lineWireUnitCost(line),
    freeGoods: lineDeclaresFree(line),
    // Typed text or null: a blank keeps the Worker's own "Stock received (<lot>)" label.
    reason: line.reason.trim() || null,
    paymentStatus: ctx.paymentStatus, creditDueDate,
    sessionId: ctx.sessionId,
    ...free,
    ...newPrice,
  } }
}

/** The pack key for a session-level refusal the Worker names by code (spec 11). */
export const STOCK_SESSION_FAILURE_KEYS: Record<string, string> = {
  supplier_total_mismatch: 'supplier_total_mismatch',
  price_edit_required: 'price_edit_required',
  free_quantity_not_receipt: 'free_quantity_not_receipt',
}

export type SessionBlock = { supplierTotalUsd: number; paymentStatus: PaymentStatus; creditDueDate?: string }

/**
 * The commit's session block (spec 11.3): what the supplier was paid for the
 * lines THIS attempt sends. Lines saved by an earlier attempt already hold
 * their share of the paid amount, so it is taken off. Null when there is no
 * receipt to check or the operator cannot see costs.
 */
export function commitSessionBlock(input: {
  lines: readonly StockSessionLine[]
  paidAmount: string
  paymentStatus: PaymentStatus
  creditDueDate: string
  canViewCosts: boolean
}): SessionBlock | null {
  if (!input.canViewCosts) return null
  const pendingAdds = input.lines.filter((line) => line.status !== 'saved' && line.mode === 'add' && (line.quantity > 0 || line.freeQuantity > 0))
  if (!pendingAdds.length) return null
  const all = sessionItemsTotal(input.lines)
  const typed = String(input.paidAmount ?? '').trim()
  const paid = typed === '' || !Number.isFinite(Number(typed)) ? all : roundMoney4(Number(typed))
  const saved = sessionItemsTotal(input.lines.filter((line) => line.status === 'saved'))
  return {
    supplierTotalUsd: roundMoney4(subtractMoney4(paid, saved)),
    paymentStatus: input.paymentStatus,
    ...(input.paymentStatus === 'credit' && input.creditDueDate.trim() ? { creditDueDate: input.creditDueDate.trim() } : {}),
  }
}

/** The Add lines Payment may reprice: not yet saved, with paid units. */
function repriceable(line: StockSessionLine): boolean {
  return line.mode === 'add' && line.status !== 'saved' && line.quantity > 0
}

const costText = (value: number): string => String(roundMoney4(value))

/**
 * Payment's auto-adjust (spec 5.4): rescale the unit costs of the lines still
 * to be written so they add up to what was paid, less what saved lines already
 * account for. The cost typed on the Items step is kept for reset.
 */
export function applyPaidToLines(lines: readonly StockSessionLine[], paidAmount: string): { ok: true; lines: StockSessionLine[] } | { ok: false; code: 'items_total_zero' | 'paid_zero' } {
  const typed = String(paidAmount ?? '').trim()
  if (typed === '' || !Number.isFinite(Number(typed))) return { ok: true, lines: [...lines] }
  const targets = lines.filter(repriceable)
  const saved = sessionItemsTotal(lines.filter((line) => line.status === 'saved'))
  const result = matchCostsToPaid(targets.map((line) => ({ qty: line.quantity, unitCost: Math.max(0, toNumber(line.unitCost)) })), roundMoney4(subtractMoney4(Number(typed), saved)))
  if (!result.ok) return result
  const costByKey = new Map(targets.map((line, index) => [line.key, result.costs[index]]))
  return {
    ok: true,
    lines: lines.map((line) => {
      const cost = costByKey.get(line.key)
      if (cost == null) return line
      return { ...line, typedUnitCost: line.typedUnitCost ?? line.unitCost, unitCost: costText(cost) }
    }),
  }
}

/** Payment's reset: every repriced line back to the cost typed on the Items step. */
export function resetLineCosts(lines: readonly StockSessionLine[]): StockSessionLine[] {
  return lines.map((line) => {
    if (line.typedUnitCost == null || line.status === 'saved') return line
    const { typedUnitCost, ...rest } = line
    return { ...rest, unitCost: typedUnitCost }
  })
}

export function paymentDifference(itemsTotal: number, paidAmount: string): number {
  const typed = String(paidAmount ?? '').trim()
  if (typed === '' || !Number.isFinite(Number(typed))) return 0
  return roundMoney4(subtractMoney4(Number(typed), itemsTotal))
}

/** Payment's Next: the due date when Not Yet Paid, and the paid amount within half a cent. */
export function paymentStepRefusal(input: {
  itemsTotal: number
  paidAmount: string
  paymentStatus: PaymentStatus
  creditDueDate: string
  canViewCosts: boolean
}): '' | 'fast_stockin_credit_due' | 'supplier_total_mismatch' {
  if (input.paymentStatus === 'credit' && !input.creditDueDate.trim()) return 'fast_stockin_credit_due'
  if (!input.canViewCosts) return ''
  const typed = String(input.paidAmount ?? '').trim()
  if (typed === '') return ''
  const paid = Number(typed)
  if (!Number.isFinite(paid) || paid < 0) return 'supplier_total_mismatch'
  return supplierTotalMatches(input.itemsTotal, paid) ? '' : 'supplier_total_mismatch'
}

// ---- received dates (lots) ----

export type SessionLot = {
  id: number | string
  quantity: number | string
  received_at?: string | null
  lot_code?: string | null
  batch_number?: number | null
  supplier_id?: number | null
  supplier_name?: string | null
}

/** The lot's received date as ISO, read the way it is displayed (business day). */
export function lotIsoDate(lot: SessionLot): string {
  const shown = formatBatchReceivedDate(lot.received_at) || lotCodeAsDate(lot.lot_code)
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(shown || ''))
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

const supplierKey = (name: unknown): string => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Remove and Set: the shared Supplier narrows the lots to that supplier's (blank = all). */
export function lotMatchesSupplier(lot: SessionLot, supplier: SessionSupplier): boolean {
  const typed = supplierKey(supplier.supplierName)
  if (!typed) return true
  if (supplier.supplierId != null && lot.supplier_id != null) return Number(lot.supplier_id) === Number(supplier.supplierId)
  return supplierKey(lot.supplier_name) === typed
}

/** The lots a line may name, oldest first: Remove only lots holding stock; Set every lot. */
export function sessionLotChoices<T extends SessionLot>(mode: StockMode, lots: readonly T[], supplier: SessionSupplier): T[] {
  const offered = mode === 'remove' ? lots.filter((lot) => toNumber(lot.quantity) > 0) : [...lots]
  const narrowed = mode === 'add' ? offered : offered.filter((lot) => lotMatchesSupplier(lot, supplier))
  return narrowed
    .map((lot, index) => ({ lot, index, date: lotIsoDate(lot) }))
    .sort((a, b) => (a.date && b.date && a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.index - b.index))
    .map(({ lot }) => lot)
}

/**
 * The lot a freshly picked line starts on (S3): the option sheet's pick, else
 * the lot with the shared received date, else the oldest (Remove) or newest
 * (Set). Add starts on a new received date. No lot at all = the branch total.
 */
export function defaultLotChoice(input: {
  mode: StockMode
  choices: readonly SessionLot[]
  sheetBatchId?: number | null
  sharedDate?: string
}): LotChoice {
  const { mode, choices } = input
  if (mode === 'add') {
    const sheet = input.sheetBatchId != null ? choices.find((lot) => Number(lot.id) === Number(input.sheetBatchId)) : null
    return sheet ? Number(sheet.id) : 'new'
  }
  if (!choices.length) return 'none'
  const sheet = input.sheetBatchId != null ? choices.find((lot) => Number(lot.id) === Number(input.sheetBatchId)) : null
  if (sheet) return Number(sheet.id)
  const dated = input.sharedDate ? choices.find((lot) => lotIsoDate(lot) === input.sharedDate) : null
  if (dated) return Number(dated.id)
  return Number((mode === 'set' ? choices[choices.length - 1] : choices[0]).id)
}

/** The lot-scope Set preview for the entry row, or null while the target is not a count. */
export function scopedSetPreviewForLot(quantity: string, lot: SessionLot, branchQuantity: number) {
  const raw = String(quantity ?? '').trim()
  if (raw === '' || !Number.isFinite(Number(raw))) return null
  return scopedSetPreview({ scope: 'lot', targetQuantity: Number(raw), lotQuantity: lot.quantity, branchQuantity })
}

// ---- line entry ----

export type LineEntryField = 'product' | 'branch' | 'qty' | 'cost' | 'supplier' | 'lot' | 'price'
export type LineEntryRefusal = { key: string; fallback: string; field: LineEntryField; gate?: StockReceiptGateCode; params?: Record<string, string | number> }

/**
 * Why the entry row cannot become an item yet, or null. One reading, used both
 * to mark the offending control and to refuse the Add; the Worker re-checks all
 * of it (routes/inventory.ts, routes/batches.ts, lib/stockReceiptGate.ts).
 */
export function lineEntryRefusal(input: {
  mode: StockMode
  hasProduct: boolean
  branchId: string
  quantity: string
  unitCost: string
  supplierName: string
  lotChoice: LotChoice
  lot: SessionLot | null
  canReceive: boolean
  canEditCosts: boolean
  branchQuantity: number
}): LineEntryRefusal | null {
  if (!input.hasProduct) return { key: 'fast_stockin_pick_product', fallback: 'Pick a product first', field: 'product' }
  if (!(Number(input.branchId) > 0)) return { key: 'fast_stockin_pick_branch', fallback: 'Pick a branch', field: 'branch' }
  const rawQty = String(input.quantity ?? '').trim()
  const qty = rawQty === '' ? Number.NaN : Number(rawQty)
  if (input.mode === 'set') {
    if (!Number.isSafeInteger(qty) || qty < 0) return { key: 'fast_stockin_set_qty', fallback: 'Quantity must be 0 or more', field: 'qty' }
    if (input.lot) {
      const preview = scopedSetPreview({ scope: 'lot', targetQuantity: qty, lotQuantity: input.lot.quantity, branchQuantity: input.branchQuantity })
      if (!preview.valid) return { key: 'stock_set_lot_negative', fallback: 'The selected received date does not have enough stock for this branch total.', field: 'qty' }
    }
    return null
  }
  if (input.mode === 'remove') {
    if (!Number.isSafeInteger(qty) || qty <= 0) return { key: 'fast_stockin_qty', fallback: 'Quantity must be at least 1', field: 'qty' }
    const available = input.lot ? toNumber(input.lot.quantity) : input.branchQuantity
    if (qty > available) return { key: 'transfer_only_available', fallback: 'Only {n} available', field: 'qty', params: { n: available } }
    return null
  }
  // products.add without inventory.adjust: a create-only item that receives nothing.
  if (!input.canReceive) {
    return Number.isSafeInteger(qty) && qty === 0
      ? null
      : { key: 'product_cost_edit_required', fallback: 'Cost edit permission is required to receive stock.', field: 'qty' }
  }
  if (!Number.isSafeInteger(qty) || qty < 0) return { key: 'fast_stockin_qty', fallback: 'Quantity must be at least 1', field: 'qty' }
  if (!input.canEditCosts) return { key: 'product_cost_edit_required', fallback: 'Cost edit permission is required to receive stock.', field: 'cost' }
  const lotSupplier = typeof input.lotChoice === 'number' ? String(input.lot?.supplier_name || '').trim() : ''
  // Qty 0: every unit of this item comes from its free row, which is the free declaration.
  const gate = stockReceiptGateCode(qty === 0
    ? { isStockIn: true, supplierName: input.supplierName, lotSupplierName: lotSupplier, unitCostUsd: 0, freeGoods: true }
    : { isStockIn: true, supplierName: input.supplierName, lotSupplierName: lotSupplier, unitCostUsd: input.unitCost, quantity: qty })
  if (!gate) return null
  return { key: gate, fallback: gate, field: gate === 'supplier_required' ? 'supplier' : 'cost', gate }
}

export type SessionLinesRefusal = { key: string; messageKey: string; fallback: string; field: 'qty' | 'supplier' | 'cost' }

/**
 * Next (Items and Payment): an Add item with no units has nothing to receive,
 * and every Add item passes the receipt gate with the shared Supplier as it is
 * now -- it can be cleared after the items were added (spec 4.1).
 */
export function sessionLinesRefusal(lines: readonly StockSessionLine[], shared: { supplierName: string }): SessionLinesRefusal | null {
  const pending = lines.filter((line) => line.status !== 'saved' && line.mode === 'add')
  const empty = pending.find((line) => !line.createPayload && line.quantity + line.freeQuantity <= 0)
  if (empty) return { key: empty.key, messageKey: 'fast_stockin_qty', fallback: 'Quantity must be at least 1', field: 'qty' }
  for (const line of pending) {
    if (line.quantity + line.freeQuantity <= 0) continue
    const gate = stockReceiptGateCode({
      isStockIn: true,
      supplierName: shared.supplierName,
      lotSupplierName: typeof line.batchChoice === 'number' ? line.lotSupplierName : '',
      unitCostUsd: lineWireUnitCost(line) ?? '',
      freeGoods: line.freeGoods,
      quantity: line.quantity,
      freeQuantity: line.freeQuantity,
    })
    if (gate) return { key: line.key, messageKey: STOCK_RECEIPT_GATE_KEYS[gate], fallback: STOCK_RECEIPT_GATE_FALLBACKS[gate], field: gate === 'supplier_required' ? 'supplier' : 'cost' }
  }
  return null
}

/** The free row of an Add item (owner, 30 Sep): only its quantity is typed. */
export function setLineFreeQuantity(lines: readonly StockSessionLine[], key: string, value: string): StockSessionLine[] {
  return lines.map((line) => {
    if (line.key !== key || line.mode !== 'add' || line.status === 'saved' || line.needsRemoval) return line
    const parsed = Math.floor(Number(String(value ?? '').trim() || 0))
    return { ...line, freeQuantity: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0 }
  })
}

/** "2 × $3.50 (−$3.50) = $0.00": the free units as a fully discounted line. */
export function freeRowText(line: Pick<StockSessionLine, 'freeQuantity' | 'unitCost'>, usdSymbol: string): string {
  const cost = Math.max(0, toNumber(line.unitCost)).toFixed(2)
  return `${line.freeQuantity} × ${usdSymbol}${cost} (−${usdSymbol}${cost}) = ${usdSymbol}0.00`
}

// ---- review (before -> after) ----

export type StockLineReview = {
  key: string
  name: string
  barcode: string
  mode: StockMode
  stockBefore: number
  stockAfter: number
  lotLabel: string
  lotBefore: number | null
  lotAfter: number | null
  costBefore: number | null
  costAfter: number | null
  priceBefore: number | null
  priceAfter: number | null
  tag: string
  reason: string
  freeQuantity: number
}

export function catalogCostOf(product: StockSessionProduct): number | null {
  const raw = product.cost_price_usd ?? product.purchase_price_usd
  if (raw == null || String(raw).trim() === '') return null
  const cost = Number(raw)
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}

/**
 * Before and after for one line, from what the float read when the line was
 * picked. An estimate for the review only: the Worker recomputes the catalog
 * cost from the lots (catalogCostRecompute.ts) and its value is the one kept.
 */
export function reviewStockLine(line: StockSessionLine, branchId: string): StockLineReview {
  const stockBefore = adjustBranchQuantity(line.product.branch_stock, branchId, line.product.stock_quantity)
  const base = {
    key: line.key, name: line.productName, barcode: String(line.product.barcode || ''), mode: line.mode, stockBefore, lotLabel: line.batchLabel,
    tag: line.conditionTag, reason: line.reason, freeQuantity: line.freeQuantity,
    costBefore: null, costAfter: null, priceBefore: null, priceAfter: null,
  }
  if (line.mode === 'add') {
    const added = Math.max(0, line.quantity) + Math.max(0, line.freeQuantity)
    const currentCost = catalogCostOf(line.product)
    const wireCost = lineWireUnitCost(line)
    const addedCost = wireCost == null ? null : effectiveUnitCost(line.quantity, line.freeQuantity, wireCost)
    const price = lineSellingPriceChange(line)
    return {
      ...base,
      stockAfter: stockBefore + added,
      lotBefore: null,
      lotAfter: null,
      costBefore: currentCost,
      costAfter: addedCost == null ? currentCost : estimateCatalogCostAfter(toNumber(line.product.stock_quantity), currentCost ?? 0, added, addedCost),
      priceBefore: price == null ? null : (line.product.selling_price_usd == null ? null : toNumber(line.product.selling_price_usd)),
      priceAfter: price,
    }
  }
  const lotBefore = typeof line.batchChoice === 'number' && line.expectedLotQuantity != null ? line.expectedLotQuantity : null
  if (line.mode === 'remove') {
    return {
      ...base,
      stockAfter: Math.max(0, stockBefore - line.quantity),
      lotBefore,
      lotAfter: lotBefore == null ? null : Math.max(0, lotBefore - line.quantity),
    }
  }
  if (lotBefore == null) return { ...base, stockAfter: line.quantity, lotBefore: null, lotAfter: null }
  const preview = scopedSetPreview({ scope: 'lot', targetQuantity: line.quantity, lotQuantity: lotBefore, branchQuantity: stockBefore })
  return { ...base, stockAfter: preview.afterBranchQuantity, lotBefore, lotAfter: preview.afterLotQuantity }
}
