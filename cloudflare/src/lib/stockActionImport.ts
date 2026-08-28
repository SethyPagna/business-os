// Row parsing and catalog resolution for the unified §12 stock import.
// DB access stays outside this file: the queue engine passes only the
// targeted catalog/branch/stock rows needed for one bounded window.

import { normalizeToIsoDate } from './batchCode'
import { parseImportNumericValue, normalizeImportMoney } from './importNumbers'
import {
  resolveStockActions,
  type StockActionMode,
  type StockActionPlan,
  type StockActionRow,
} from './stockActionResolver'

export const UNIFIED_STOCK_COLUMNS = [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'vip_price', 'cost_price', 'batch',
  // Optional (blank is fine, and files with only the original ten columns
  // still import): which supplier this row's stock was bought from. The
  // same product may carry different suppliers across batches — supplier
  // is stored on the BATCH the add creates (migration 0062).
  'supplier',
] as const

export interface UnifiedStockCatalogProduct {
  id: number
  name: string
  barcode?: string | null
  selling_price_usd?: number | null
  special_price_usd?: number | null
  cost_price_usd?: number | null
}

export interface UnifiedStockBranch {
  id: number
  name: string
}

export interface UnifiedStockCurrent {
  productId: number
  branchId: number
  quantity: number
}

export interface UnifiedStockResolvedRow {
  rowNumber: number
  identifier: string
  productId: number | null
  productName: string
  barcode: string
  identityKey: string
  date: string
  action: string
  sellingPriceUsd: number | null
  vipPriceUsd: number | null
  costPriceUsd: number | null
  batchLabel: string | null
  /** As-entered supplier for this row's batch; '' when the column is absent/blank. */
  supplier: string
  branchRefs: Array<{ slot: 'shop' | 'warehouse'; branchId: number; branchName: string; pending: boolean; value: number }>
  plan: StockActionPlan | null
  conflicts: string[]
  errors: string[]
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function key(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, ' ')
}

function optionalNumber(value: unknown, field: string): { value: number | null; error: string | null } {
  if (!text(value)) return { value: null, error: null }
  try {
    const parsed = parseImportNumericValue(value, 0, { strict: true, field })
    return { value: parsed, error: null }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : `Invalid ${field}` }
  }
}

function optionalMoney(value: unknown, field: string): { value: number | null; error: string | null } {
  if (!text(value)) return { value: null, error: null }
  const parsed = optionalNumber(value, field)
  return parsed.error ? parsed : { value: normalizeImportMoney(parsed.value), error: null }
}

export function getUnifiedStockMode(policyJson: string | null | undefined): StockActionMode {
  try {
    const parsed = policyJson ? JSON.parse(policyJson) as { stock_action_mode?: unknown } : null
    return parsed?.stock_action_mode === 'reconcile' ? 'reconcile' : 'direct'
  } catch {
    return 'direct'
  }
}

function matchProduct(
  name: string,
  barcode: string,
  products: UnifiedStockCatalogProduct[],
): { product: UnifiedStockCatalogProduct | null; conflict: string | null } {
  const barcodeMatches = barcode ? products.filter((product) => key(product.barcode) === key(barcode)) : []
  if (barcodeMatches.length) {
    // Identity rule: same name + same barcode = the SAME product; same
    // barcode + a DIFFERENT name = a separate product (shared/promo
    // barcodes are real). So a named row only ever attaches to a
    // name-compatible barcode match -- when none is compatible this is NOT
    // a match at all and the row proceeds as a create of its own product
    // (identityKey `new:name|barcode`), exactly what classifyProducts does
    // for the same collision. The old fallback here attached the row to a
    // lone different-name product, putting its stock on the wrong item.
    if (name) {
      const sameName = barcodeMatches.filter((product) => key(product.name) === key(name))
      if (sameName.length === 1) return { product: sameName[0], conflict: null }
      if (sameName.length > 1) return { product: null, conflict: `Barcode ${barcode} + name "${name}" match ${sameName.length} products (duplicate rows in the catalog); merge them before importing.` }
      return { product: null, conflict: null }
    }
    if (barcodeMatches.length === 1) return { product: barcodeMatches[0], conflict: null }
    return { product: null, conflict: `Barcode ${barcode} matches ${barcodeMatches.length} products; add the product name so the right one is chosen.` }
  }
  // A row that CARRIES a barcode nothing in the catalog has is a new
  // name+barcode identity pair: same name + different barcode = child row
  // (a separate product) under the identity rule, so it must NOT attach to
  // a same-name product that has some other (or no) barcode -- it creates
  // its own product instead, same as classifyProducts' detail-signature
  // fallback decides for the identical situation.
  if (barcode) return { product: null, conflict: null }
  const nameMatches = name ? products.filter((product) => key(product.name) === key(name)) : []
  if (nameMatches.length === 1) return { product: nameMatches[0], conflict: null }
  if (nameMatches.length > 1) return { product: null, conflict: `Name "${name}" matches ${nameMatches.length} products; add a barcode or choose the exact product.` }
  return { product: null, conflict: null }
}

export function resolveUnifiedStockImportRows(
  rawRows: Array<Record<string, unknown> & { _rowNumber?: number }>,
  mode: StockActionMode,
  products: UnifiedStockCatalogProduct[],
  branches: UnifiedStockBranch[],
  currentStock: UnifiedStockCurrent[],
): UnifiedStockResolvedRow[] {
  const branchByName = new Map(branches.map((branch) => [key(branch.name), branch]))
  const branchForSlot = (slot: 'shop' | 'warehouse') => branchByName.get(slot) || null
  const stockRows: StockActionRow[] = []
  const provisional: UnifiedStockResolvedRow[] = []
  const current = currentStock.map((entry) => ({
    branchId: entry.branchId,
    productKey: `product:${entry.productId}`,
    quantity: Number(entry.quantity) || 0,
  }))

  rawRows.forEach((raw, index) => {
    const rowNumber = Number(raw._rowNumber) > 0 ? Number(raw._rowNumber) : index + 2
    const name = text(raw.name)
    const barcode = text(raw.barcode)
    const date = normalizeToIsoDate(text(raw.date)) || ''
    const action = text(raw.action)
    const shop = optionalNumber(raw.shop, 'shop quantity')
    const warehouse = optionalNumber(raw.warehouse, 'warehouse quantity')
    const selling = optionalMoney(raw.selling_price, 'selling price')
    const vip = optionalMoney(raw.vip_price, 'VIP price')
    const cost = optionalMoney(raw.cost_price, 'cost price')
    const errors = [shop.error, warehouse.error, selling.error, vip.error, cost.error].filter((value): value is string => !!value)
    if (!name && !barcode) errors.push('Name or barcode is required.')
    if (!date) errors.push('Date must be mm/dd/yyyy or yyyy-mm-dd.')
    if (shop.value == null && warehouse.value == null) errors.push('Enter a shop or warehouse quantity.')

    const matched = matchProduct(name, barcode, products)
    const productName = matched.product?.name || name
    const identityKey = matched.product ? `product:${matched.product.id}` : `new:${key(productName)}|${key(barcode)}`
    const conflicts = matched.conflict ? [matched.conflict] : []
    const branchRefs: UnifiedStockResolvedRow['branchRefs'] = []
    ;(['shop', 'warehouse'] as const).forEach((slot, slotIndex) => {
      const parsed = slot === 'shop' ? shop.value : warehouse.value
      if (parsed == null) return
      const branch = branchForSlot(slot)
      branchRefs.push({
        slot,
        branchId: branch?.id ?? -(slotIndex + 1),
        branchName: branch?.name || (slot === 'shop' ? 'Shop' : 'Warehouse'),
        pending: !branch,
        value: parsed,
      })
    })

    const resolved: UnifiedStockResolvedRow = {
      rowNumber,
      identifier: barcode || name,
      productId: matched.product?.id ?? null,
      productName,
      barcode,
      identityKey,
      date,
      action,
      sellingPriceUsd: selling.value ?? matched.product?.selling_price_usd ?? null,
      vipPriceUsd: vip.value ?? matched.product?.special_price_usd ?? null,
      costPriceUsd: cost.value ?? matched.product?.cost_price_usd ?? null,
      batchLabel: text(raw.batch) || null,
      supplier: text(raw.supplier).replace(/\s{2,}/g, ' ').slice(0, 120),
      branchRefs,
      plan: null,
      conflicts,
      errors,
    }
    provisional.push(resolved)
    stockRows.push({
      rowNumber,
      branchValues: branchRefs.map((branch) => ({ branchId: branch.branchId, value: branch.value })),
      date,
      action,
      sellingPriceUsd: resolved.sellingPriceUsd,
      vipPriceUsd: resolved.vipPriceUsd,
      costPriceUsd: resolved.costPriceUsd,
      batchLabel: resolved.batchLabel,
      isNewProduct: !matched.product,
    })
  })

  const resolution = resolveStockActions(stockRows, current, mode, (row) => provisional.find((item) => item.rowNumber === row.rowNumber)?.identityKey || `row:${row.rowNumber}`)
  const planByRow = new Map(resolution.plans.map((plan) => [plan.rowNumber, plan]))
  return provisional.map((row) => {
    // An ambiguous catalog identity is reviewable, but never actionable.
    // Treating it as a new product would duplicate an existing item merely
    // because two candidates shared a barcode/name. A later reviewer choice
    // can provide the exact product; until then apply must have no plan.
    const unresolvedIdentity = row.productId == null && row.conflicts.length > 0
    const plan = row.errors.length || unresolvedIdentity ? null : planByRow.get(row.rowNumber) || null
    return { ...row, plan, conflicts: [...row.conflicts, ...(plan?.conflicts || [])] }
  })
}
