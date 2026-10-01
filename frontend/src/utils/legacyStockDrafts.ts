// Chips parked by the retired stock surfaces restore into the Stock Session
// (UI-STOCK 5.9): a one-by-one Adjust stock draft (utils/stockAdjustDraft.ts,
// v1) becomes the entry row, an Add/Create Products Session draft becomes Add
// lines. Hosts call this when a legacy chip is restored.
import { emptyStockSessionDraft, type LotChoice, type StockMode, type StockSessionDraft, type StockSessionLine, type StockSessionProduct } from './stockSessionDraft.ts'
import { todayStr } from './dateHelpers.ts'

export type LegacyStockDraft = { kind: 'stock_adjust' | 'create_products_session'; data: unknown }
export type LegacyStockDraftResult =
  | { draft: StockSessionDraft; blocked?: undefined }
  | { draft: null; blocked: 'unreadable' | 'submission_unknown' }

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string => (value == null ? '' : String(value))
const isMode = (value: unknown): value is StockMode => value === 'add' || value === 'remove' || value === 'set'

function lotChoice(value: unknown, mode: StockMode): LotChoice {
  const id = Number(value)
  if (value !== '' && value != null && Number.isSafeInteger(id) && id > 0) return id
  return mode === 'add' ? 'new' : 'none'
}

function supplierId(value: unknown): number | null {
  const id = Number(value)
  return value !== '' && value != null && Number.isSafeInteger(id) && id > 0 ? id : null
}

function fromStockAdjust(data: unknown): LegacyStockDraftResult {
  if (!isRow(data) || data.version !== 1 || !isRow(data.product) || !isRow(data.form)) return { draft: null, blocked: 'unreadable' }
  const product = data.product as StockSessionProduct
  if (product.id == null || text(product.id).trim() === '') return { draft: null, blocked: 'unreadable' }
  const form = data.form
  const mode: StockMode = isMode(form.type) ? form.type : isMode(data.initialType) ? data.initialType : 'add'
  const sessionId = Number(data.receiptSessionId)
  const base = emptyStockSessionDraft({
    sessionId: Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : Date.now(),
    mode,
    branchId: text(form.branch_id),
    receivedDate: text(form.received_date) || todayStr(),
    supplier: { supplierId: supplierId(form.supplier_id), supplierName: text(form.supplier_name) },
    paymentStatus: form.payment_status === 'credit' ? 'credit' : 'paid',
    creditDueDate: text(form.credit_due_date),
  })
  return {
    draft: {
      ...base,
      query: text(product.name),
      picked: product,
      quantity: text(form.quantity) || '1',
      unitCost: mode === 'add' ? text(form.unit_cost_usd) : '',
      sellingPrice: mode === 'add' && product.selling_price_usd != null ? text(product.selling_price_usd) : '',
      reason: text(form.reason),
      conditionTag: text(form.condition_tag),
      batchChoice: lotChoice(form.batch_id, mode),
    },
  }
}

function fromCreateProductsSession(data: unknown, mintRequestId: () => string): LegacyStockDraftResult {
  if (!isRow(data)) return { draft: null, blocked: 'unreadable' }
  // That session committed as ONE idempotent request. Once it was sent its
  // outcome may be applied server-side; re-sending its lines through the line
  // writers could post the stock twice.
  if (Array.isArray(data.submittedItems) && data.submittedItems.length) return { draft: null, blocked: 'submission_unknown' }
  const header = isRow(data.header) ? data.header : {}
  const sessionId = Number(data.sessionId)
  const base = emptyStockSessionDraft({
    sessionId: Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : Date.now(),
    mode: 'add',
    branchId: text(header.branchId),
    receivedDate: text(data.receivedDate) || todayStr(),
    supplier: { supplierId: supplierId(header.supplierId), supplierName: text(header.supplierName) },
    paymentStatus: data.paymentStatus === 'credit' ? 'credit' : 'paid',
    creditDueDate: text(data.creditDueDate),
  })
  const rows = Array.isArray(data.lines) ? data.lines.filter(isRow) : []
  const lines: StockSessionLine[] = rows.flatMap((row, index) => {
    if (row.status !== 'queued') return []
    const isCreate = row.kind === 'create_receive'
    if (!isCreate && row.kind !== 'receive') return []
    const productId = Number(row.productId)
    if (!isCreate && !(productId > 0)) return []
    const payload = isCreate && isRow(row.product) ? row.product : null
    if (isCreate && !payload) return []
    const name = text(row.name) || text(payload?.name)
    const product: StockSessionProduct = {
      id: isCreate ? '' : productId,
      name,
      barcode: text(row.barcode) || null,
      brand: text(row.brand) || null,
      ...(payload ? { selling_price_usd: payload.selling_price_usd as number | undefined, cost_price_usd: payload.cost_price_usd as number | undefined } : {}),
      stock_quantity: isCreate ? 0 : undefined,
    }
    const quantity = Number(row.quantity)
    return [{
      key: `${text(row.lineId) || 'legacy'}-${index}`,
      requestId: mintRequestId(),
      product,
      productName: name || `#${productId}`,
      mode: 'add' as const,
      quantity: Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : 0,
      freeQuantity: 0,
      unitCost: row.unitCostUsd == null ? '' : text(row.unitCostUsd),
      sellingPrice: payload?.selling_price_usd != null ? text(payload.selling_price_usd) : '',
      freeGoods: row.freeGoods === true,
      expiryDate: text(row.expiryDate),
      batchChoice: lotChoice(row.batchId, 'add'),
      batchLabel: text(row.batchLabel),
      reason: text(row.reason),
      conditionTag: '',
      createdProduct: isCreate,
      ...(payload ? { createPayload: { ...payload }, createRequestId: `product_${mintRequestId()}` } : {}),
      status: 'queued' as const,
      detail: '',
    }]
  })
  return { draft: { ...base, brand: text(header.brand), reason: text(data.reason), lines } }
}

export function convertLegacyStockDraft(legacy: LegacyStockDraft, mintRequestId: () => string): LegacyStockDraftResult {
  if (legacy.kind === 'stock_adjust') return fromStockAdjust(legacy.data)
  if (legacy.kind === 'create_products_session') return fromCreateProductsSession(legacy.data, mintRequestId)
  return { draft: null, blocked: 'unreadable' }
}
