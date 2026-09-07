// Canonical file contract for progress.md §12. This is the only frontend
// definition of the ten-column Add / Sale / Reconciliation sheet; the
// upload screen, review screen and template download all consume it.

// THE fold, from the rule module the Worker carries verbatim. The in-sheet
// grouping below must reach the same verdict the server's matchProduct does, or
// the review screen reads a leading-zero pair as two products while the import
// that follows treats them as one.
import { identityBarcodeKey } from '../../../utils/productDetailRule.ts'
// The pre-submit half of the stock-in receipt gate (N14-D) -- the same kernel
// FastStockInModal, ReceiveBatchModal and the adjust forms run. The Worker's
// lib/stockActionCommit.ts enforces it on the wire; this only lets the operator
// see the refusal before the upload instead of in the report afterwards.
import { stockReceiptGateCode, STOCK_RECEIPT_GATE_FALLBACKS, type StockReceiptGateCode } from '../../../utils/stockReceiptFields.ts'

export type UnifiedStockMode = 'direct' | 'reconcile'

export const UNIFIED_STOCK_HEADERS = [
  'name',
  'barcode',
  'shop',
  'warehouse',
  'date',
  'action',
  'selling_price',
  // Renamed from 'vip_price' by migration 0111: the tier this app called
  // "VIP" always held the WHOLESALE number, so the sheet column now says so.
  // Old sheets still import -- HEADER_ALIASES below still accepts the legacy
  // vip/special spellings and maps them here.
  'wholesale_price',
  'cost_price',
  'batch',
  // Optional: which supplier this row's stock was bought from. Stored on
  // the BATCH the add creates (same product, different suppliers across
  // batches — migration 0062). Blank is fine; ten-column files still work.
  'supplier',
  // Optional (N14-D): the operator's explicit "these goods were free"
  // declaration. Before this column existed, a $0.00 cost_price on an add
  // row was refused with a message asking to "tick Free goods" -- a control
  // that lived nowhere on this sheet, so the row could never be corrected.
  'free_goods',
] as const

export type UnifiedStockHeader = typeof UNIFIED_STOCK_HEADERS[number]
export type UnifiedStockSourceRow = Record<string, unknown>

export interface UnifiedStockParsedRow {
  rowNumber: number
  name: string
  barcode: string
  shop: number | null
  warehouse: number | null
  date: string
  action: string
  sellingPrice: number | null
  wholesalePrice: number | null
  costPrice: number | null
  batch: string
  supplier: string
  freeGoods: boolean
}

export interface UnifiedStockRowIssue {
  rowNumber: number
  code: 'missing_identity' | 'missing_quantity' | 'invalid_quantity' | 'invalid_date' | 'invalid_price' | 'receipt_gate'
  message: string
  /** Set on a 'receipt_gate' issue: the shared refusal code, so a renderer can
   *  translate it through STOCK_RECEIPT_GATE_KEYS instead of the English text. */
  gateCode?: StockReceiptGateCode
}

export interface UnifiedStockParseResult {
  rows: UnifiedStockParsedRow[]
  issues: UnifiedStockRowIssue[]
  headerMap: Record<UnifiedStockHeader, string | null>
}

const HEADER_ALIASES: Record<UnifiedStockHeader, readonly string[]> = {
  name: ['name', 'product', 'productname', 'item', 'itemname'],
  barcode: ['barcode', 'upc', 'ean'],
  shop: ['shop', 'shopquantity', 'shopqty', 'store', 'storequantity', 'storeqty'],
  warehouse: ['warehouse', 'warehousequantity', 'warehouseqty'],
  date: ['date', 'transactiondate', 'stockdate', 'receiveddate', 'saledate'],
  action: ['action', 'stockaction', 'movement', 'movementtype', 'salegroup'],
  selling_price: ['sellingprice', 'sellingpriceusd', 'price', 'priceusd'],
  // Legacy vip*/special* spellings stay accepted: per the owner's ruling that
  // column always carried wholesale numbers, so an old sheet headed "VIP
  // price" is a wholesale sheet and must not be silently dropped.
  wholesale_price: ['wholesaleprice', 'wholesalepriceusd', 'vipprice', 'vippriceusd', 'specialprice', 'specialpriceusd'],
  cost_price: ['costprice', 'costpriceusd', 'cost', 'unitcost'],
  batch: ['batch', 'batchlabel', 'batchcode', 'lot', 'lotcode'],
  supplier: ['supplier', 'suppliername', 'vendor', 'vendorname'],
  free_goods: ['free', 'freegoods', 'isfree', 'freeitem'],
}

export function normalizeUnifiedStockHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function mapUnifiedStockHeaders(headers: readonly string[]): Record<UnifiedStockHeader, string | null> {
  const normalized = headers.map((raw) => ({ raw, normalized: normalizeUnifiedStockHeader(raw) }))
  return Object.fromEntries(UNIFIED_STOCK_HEADERS.map((target) => {
    const source = normalized.find((entry) => HEADER_ALIASES[target].includes(entry.normalized))?.raw || null
    return [target, source]
  })) as Record<UnifiedStockHeader, string | null>
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

/** The sheet's free_goods cell, read the way a checkbox column is actually
 *  typed -- '1'/'true'/'yes'/'y', case-insensitive; blank or anything else
 *  is "not declared free". Mirrors stockActionImport.ts's parseFreeGoodsFlag. */
function parseFreeGoodsFlag(value: unknown): boolean {
  const normalized = clean(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y'
}

function parseOptionalNumber(value: unknown): number | null | 'invalid' {
  const text = clean(value)
  if (!text) return null
  const parsed = Number(text.replace(/[$៛,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 'invalid'
}

/**
 * MONTH-FIRST, deliberately, and it must stay that way.
 *
 * This reads the sheet's bare `date` column. Per the standing rule, a date
 * cell's reading order comes from its column header: `batch(dd/mm/yyyy)` is
 * day-first, `batch(mm/dd/yyyy)` is month-first, and a bare header that names
 * no format keeps the meaning it has always had -- otherwise every sheet the
 * shop already owns would silently change meaning the day the app went
 * day-first. ISO is accepted here too and is the form that can never be
 * misread. Do NOT "finish the job" by flipping this to match the display
 * convention; see lib/batchCode.ts readBatchDateCell for the same rule.
 */
export function normalizeUnifiedStockDate(value: unknown): string | null {
  const text = clean(value)
  if (!text) return null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : us ? [Number(us[3]), Number(us[1]), Number(us[2])] : null
  if (!parts) return null
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Mirrors the resolver's SALE_ACTION_RE: 'sale', 'sale2', 'Sale 3'. */
const SHEET_SALE_ACTION = /^sale\s*\d*$/i
/** Mirrors the resolver's CREATE_ACTION_RE: 'create', 'new'. */
const SHEET_CREATE_ACTION = /^(create|new)$/i

export function parseUnifiedStockRows(
  sourceRows: readonly UnifiedStockSourceRow[],
  mode: UnifiedStockMode = 'direct',
): UnifiedStockParseResult {
  const headers = sourceRows.length ? Object.keys(sourceRows[0]) : []
  const headerMap = mapUnifiedStockHeaders(headers)
  const rows: UnifiedStockParsedRow[] = []
  const issues: UnifiedStockRowIssue[] = []

  sourceRows.forEach((source, index) => {
    const rowNumber = index + 2
    const read = (key: UnifiedStockHeader) => headerMap[key] ? source[headerMap[key] as string] : undefined
    const name = clean(read('name'))
    const barcode = clean(read('barcode'))
    const shop = parseOptionalNumber(read('shop'))
    const warehouse = parseOptionalNumber(read('warehouse'))
    const date = normalizeUnifiedStockDate(read('date'))
    const sellingPrice = parseOptionalNumber(read('selling_price'))
    const wholesalePrice = parseOptionalNumber(read('wholesale_price'))
    const costPrice = parseOptionalNumber(read('cost_price'))

    if (!name && !barcode) issues.push({ rowNumber, code: 'missing_identity', message: 'Name or barcode is required.' })
    if (shop === null && warehouse === null) issues.push({ rowNumber, code: 'missing_quantity', message: 'Enter a shop or warehouse quantity.' })
    if (shop === 'invalid' || warehouse === 'invalid' || (typeof shop === 'number' && shop < 0) || (typeof warehouse === 'number' && warehouse < 0)) {
      issues.push({ rowNumber, code: 'invalid_quantity', message: 'Shop and warehouse must be non-negative numbers.' })
    }
    if (!date) issues.push({ rowNumber, code: 'invalid_date', message: 'Date must be mm/dd/yyyy (month first, as this column has always been) or yyyy-mm-dd.' })
    const priceInvalid = [sellingPrice, wholesalePrice, costPrice].some((value) => value === 'invalid' || (typeof value === 'number' && value < 0))
    if (priceInvalid) {
      issues.push({ rowNumber, code: 'invalid_price', message: 'Prices must be non-negative numbers.' })
    }

    // The receipt gate, DIRECT mode only. A reconcile row's number is a
    // counted TOTAL, so whether it puts stock in is a function of live stock
    // this screen has not read -- guessing would flag rows the server accepts.
    // The Worker gates every mode; this half only warns early, and it defers
    // the SUPPLIER question for most rows because they may top up a lot that
    // is already attributed -- applyUnifiedStockAdd reads that lot's supplier
    // and decides, and this screen has no catalog to read it from. The one
    // row this screen CAN settle deterministically is an explicit CREATE/NEW
    // action (below): a new product has no lot yet, so nothing can be
    // inherited and a blank supplier is certain to be refused. Nor can it
    // settle the cost for an EXISTING product, whose blank cost column
    // resolves to the product's catalog cost server-side; what it can say is
    // that the sheet itself states no cost, which is why the note asks for
    // the column rather than promising a refusal.
    // An unreadable price is already reported above; re-reporting it as a gate
    // refusal would count one bad cell as two rows needing attention.
    const action = clean(read('action'))
    const freeGoods = parseFreeGoodsFlag(read('free_goods'))
    const putsStockIn = mode === 'direct' && !priceInvalid && !SHEET_SALE_ACTION.test(action)
      && ((typeof shop === 'number' && shop > 0) || (typeof warehouse === 'number' && warehouse > 0))
    if (putsStockIn) {
      // An explicit CREATE/NEW action has no lot to inherit a supplier from --
      // there is nothing on the catalog for it yet, so a blank supplier cell
      // is certain to be refused server-side and the deferral below would
      // hide that from the operator until after the upload. Every other row
      // MAY be topping up an already-attributed lot this screen cannot see,
      // so the supplier half stays deferred there.
      const isCreateAction = SHEET_CREATE_ACTION.test(action)
      const gate = stockReceiptGateCode({
        isStockIn: true,
        // A CREATE row's own supplier cell decides supplier_required, same
        // as every other surface: an actual value here must pass, and only
        // a genuinely blank cell is certain to be refused. Before this, the
        // check never read the cell at all, so a CREATE row with a filled
        // supplier was wrongly flagged supplier_required client-side.
        supplierName: clean(read('supplier')),
        lotAttributionDeferred: !isCreateAction,
        unitCostUsd: costPrice,
        freeGoods,
        attribution: 'receipt',
      })
      if (gate) issues.push({ rowNumber, code: 'receipt_gate', message: STOCK_RECEIPT_GATE_FALLBACKS[gate], gateCode: gate })
    }

    rows.push({
      rowNumber,
      name,
      barcode,
      shop: typeof shop === 'number' && shop >= 0 ? shop : null,
      warehouse: typeof warehouse === 'number' && warehouse >= 0 ? warehouse : null,
      date: date || '',
      action,
      sellingPrice: typeof sellingPrice === 'number' && sellingPrice >= 0 ? sellingPrice : null,
      wholesalePrice: typeof wholesalePrice === 'number' && wholesalePrice >= 0 ? wholesalePrice : null,
      costPrice: typeof costPrice === 'number' && costPrice >= 0 ? costPrice : null,
      batch: clean(read('batch')),
      supplier: clean(read('supplier')),
      freeGoods,
    })
  })
  return { rows, issues, headerMap }
}

export function buildUnifiedStockTemplateCsv(): string {
  return `\uFEFF${UNIFIED_STOCK_HEADERS.join(',')}\r\n`
}

// Selling/wholesale differences are deliberately absent: only multiple batches
// at multiple costs require the explicit Confirm Action gate.
export function findUnifiedStockCostBatchConflicts(rows: readonly UnifiedStockParsedRow[]): Map<number, string> {
  const groups = new Map<string, UnifiedStockParsedRow[]>()
  for (const row of rows) {
    // Same key the server groups by: collapsed name + FOLDED barcode. Keyed on
    // the raw barcode, one sheet listing '0601' and '601' looked like two
    // products here and the cost/batch gate below never fired for the pair.
    const key = `${row.name.trim().toLowerCase().replace(/\s+/g, ' ')}|${identityBarcodeKey(row.barcode)}`
    const group = groups.get(key) || []
    group.push(row)
    groups.set(key, group)
  }
  const conflicts = new Map<number, string>()
  for (const group of groups.values()) {
    const costs = new Set(group.map((row) => row.costPrice).filter((value): value is number => value != null && value !== 0))
    const batches = new Set(group.map((row) => row.batch.trim()).filter(Boolean))
    if (costs.size <= 1 || batches.size <= 1) continue
    const message = `Same product has ${batches.size} batches at ${costs.size} different cost prices.`
    group.forEach((row) => conflicts.set(row.rowNumber, message))
  }
  return conflicts
}
