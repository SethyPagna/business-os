// Canonical file contract for progress.md §12. This is the only frontend
// definition of the ten-column Add / Sale / Reconciliation sheet; the
// upload screen, review screen and template download all consume it.

export type UnifiedStockMode = 'direct' | 'reconcile'

export const UNIFIED_STOCK_HEADERS = [
  'name',
  'barcode',
  'shop',
  'warehouse',
  'date',
  'action',
  'selling_price',
  'vip_price',
  'cost_price',
  'batch',
  // Optional: which supplier this row's stock was bought from. Stored on
  // the BATCH the add creates (same product, different suppliers across
  // batches — migration 0062). Blank is fine; ten-column files still work.
  'supplier',
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
  vipPrice: number | null
  costPrice: number | null
  batch: string
  supplier: string
}

export interface UnifiedStockRowIssue {
  rowNumber: number
  code: 'missing_identity' | 'missing_quantity' | 'invalid_quantity' | 'invalid_date' | 'invalid_price'
  message: string
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
  vip_price: ['vipprice', 'vippriceusd', 'specialprice', 'specialpriceusd'],
  cost_price: ['costprice', 'costpriceusd', 'cost', 'unitcost'],
  batch: ['batch', 'batchlabel', 'batchcode', 'lot', 'lotcode'],
  supplier: ['supplier', 'suppliername', 'vendor', 'vendorname'],
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

function parseOptionalNumber(value: unknown): number | null | 'invalid' {
  const text = clean(value)
  if (!text) return null
  const parsed = Number(text.replace(/[$៛,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 'invalid'
}

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

export function parseUnifiedStockRows(sourceRows: readonly UnifiedStockSourceRow[]): UnifiedStockParseResult {
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
    const vipPrice = parseOptionalNumber(read('vip_price'))
    const costPrice = parseOptionalNumber(read('cost_price'))

    if (!name && !barcode) issues.push({ rowNumber, code: 'missing_identity', message: 'Name or barcode is required.' })
    if (shop === null && warehouse === null) issues.push({ rowNumber, code: 'missing_quantity', message: 'Enter a shop or warehouse quantity.' })
    if (shop === 'invalid' || warehouse === 'invalid' || (typeof shop === 'number' && shop < 0) || (typeof warehouse === 'number' && warehouse < 0)) {
      issues.push({ rowNumber, code: 'invalid_quantity', message: 'Shop and warehouse must be non-negative numbers.' })
    }
    if (!date) issues.push({ rowNumber, code: 'invalid_date', message: 'Date must be mm/dd/yyyy or yyyy-mm-dd.' })
    if ([sellingPrice, vipPrice, costPrice].some((value) => value === 'invalid' || (typeof value === 'number' && value < 0))) {
      issues.push({ rowNumber, code: 'invalid_price', message: 'Prices must be non-negative numbers.' })
    }

    rows.push({
      rowNumber,
      name,
      barcode,
      shop: typeof shop === 'number' && shop >= 0 ? shop : null,
      warehouse: typeof warehouse === 'number' && warehouse >= 0 ? warehouse : null,
      date: date || '',
      action: clean(read('action')),
      sellingPrice: typeof sellingPrice === 'number' && sellingPrice >= 0 ? sellingPrice : null,
      vipPrice: typeof vipPrice === 'number' && vipPrice >= 0 ? vipPrice : null,
      costPrice: typeof costPrice === 'number' && costPrice >= 0 ? costPrice : null,
      batch: clean(read('batch')),
      supplier: clean(read('supplier')),
    })
  })
  return { rows, issues, headerMap }
}

export function buildUnifiedStockTemplateCsv(): string {
  return `\uFEFF${UNIFIED_STOCK_HEADERS.join(',')}\r\n`
}

// Selling/VIP differences are deliberately absent: only multiple batches
// at multiple costs require the explicit Confirm Action gate.
export function findUnifiedStockCostBatchConflicts(rows: readonly UnifiedStockParsedRow[]): Map<number, string> {
  const groups = new Map<string, UnifiedStockParsedRow[]>()
  for (const row of rows) {
    const key = `${row.name.trim().toLowerCase().replace(/\s+/g, ' ')}|${row.barcode.trim().toLowerCase()}`
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
