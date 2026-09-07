// Row parsing and catalog resolution for the unified §12 stock import.
// DB access stays outside this file: the queue engine passes only the
// targeted catalog/branch/stock rows needed for one bounded window.

import { dateToBatchCode, normalizeToIsoDate } from './batchCode'
import { parseImportNumericValue, normalizeImportMoney } from './importNumbers'
// The ONE fold. Imported from the rule module both packages carry verbatim, so
// this path cannot reach a different verdict from the create/edit guard, the
// Conflicts sweep, the merge tool or the client's own sheet review.
import { identityBarcodeKey } from './productDetailRule'
import {
  resolveStockActions,
  type StockActionMode,
  type StockActionPlan,
  type StockActionRow,
} from './stockActionResolver'

export const UNIFIED_STOCK_COLUMNS = [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'wholesale_price', 'cost_price', 'batch',
  // Optional (blank is fine, and files with only the original ten columns
  // still import): which supplier this row's stock was bought from. The
  // same product may carry different suppliers across batches — supplier
  // is stored on the BATCH the add creates (migration 0062).
  'supplier',
  // Optional (N14-D): the operator's explicit "these goods were free"
  // declaration. Without it, a $0.00 cost_price on an add row is refused --
  // the gate's free_goods_required message used to point the operator at a
  // control this sheet had no column for.
  'free_goods',
] as const

export interface UnifiedStockCatalogProduct {
  id: number
  name: string
  barcode?: string | null
  selling_price_usd?: number | null
  wholesale_price_usd?: number | null
  cost_price_usd?: number | null
  /** Active normalized lot/batch keys for the same-batch receipt exception. */
  batch_keys?: string[]
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
  wholesalePriceUsd: number | null
  costPriceUsd: number | null
  /**
   * The sheet's OWN cost_price cell, with no catalog fallback (unlike
   * costPriceUsd, which inherits an existing product's cost_price_usd so the
   * product-price columns stay filled). The receipt gate must see what the
   * operator actually typed on THIS row -- an existing product's catalog
   * cost is not a cost this receipt states, and feeding it to the gate let a
   * sheet with a supplier column but no cost_price column mint a real
   * receipt cost the operator never typed (sibling:F13 verifier round 2).
   */
  sheetCostPriceUsd: number | null
  batchLabel: string | null
  /** As-entered supplier for this row's batch; '' when the column is absent/blank. */
  supplier: string
  /** The sheet's optional free_goods column, parsed to a boolean (N14-D). */
  freeGoods: boolean
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

// ONE alias table for every unified-stock column, copied verbatim (spelling
// for spelling) from the client's HEADER_ALIASES (unifiedStockImport.ts).
// Before this table there were TWO independently-maintained lists and only
// the client's was ever consulted for most columns: a sheet the client
// blessed as clean (e.g. a "Vendor Name" or "Unit Cost" header) came back
// refused on every row because the Worker read only the one literal key
// (`supplier`, `cost_price`) it was written against (sibling:F13 verifier
// wave 9). Adding the missing spellings one column at a time (as free_goods
// was) only proves the NEXT column is still exposed to the same bug.
//
// The two sides normalize a header differently -- the client's
// normalizeUnifiedStockHeader strips every non-alphanumeric character
// ("Cost Price (USD)" -> "costpriceusd"), while normalizeCsvKey (importCsv.ts)
// only turns whitespace into underscores ("Cost Price (USD)" ->
// "cost_price_(usd)"). readAliased below closes that gap by applying the
// SAME non-alphanumeric strip to the raw row's own keys before comparing,
// so this table can hold the identical spelling list the client checks
// against, rather than a hand-translated (and inevitably incomplete)
// underscored twin of it.
export const COLUMN_ALIASES: Record<string, readonly string[]> = {
  name: ['name', 'product', 'productname', 'item', 'itemname'],
  barcode: ['barcode', 'upc', 'ean'],
  shop: ['shop', 'shopquantity', 'shopqty', 'store', 'storequantity', 'storeqty'],
  warehouse: ['warehouse', 'warehousequantity', 'warehouseqty'],
  date: ['date', 'transactiondate', 'stockdate', 'receiveddate', 'saledate'],
  action: ['action', 'stockaction', 'movement', 'movementtype', 'salegroup'],
  selling_price: ['sellingprice', 'sellingpriceusd', 'price', 'priceusd'],
  wholesale_price: ['wholesaleprice', 'wholesalepriceusd', 'vipprice', 'vippriceusd', 'specialprice', 'specialpriceusd'],
  cost_price: ['costprice', 'costpriceusd', 'cost', 'unitcost'],
  batch: ['batch', 'batchlabel', 'batchcode', 'lot', 'lotcode'],
  supplier: ['supplier', 'suppliername', 'vendor', 'vendorname'],
  free_goods: ['freegoods', 'free', 'isfree', 'freeitem'],
}

function normalizeAliasKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Reads one column's cell off a raw import row, accepting any header
 *  spelling COLUMN_ALIASES lists for that column (plus the canonical column
 *  name itself), matched the same way the client's mapUnifiedStockHeaders
 *  matches a header -- every non-alphanumeric character stripped, so
 *  "Vendor Name" and "VendorName" both reach 'vendorname'. A present-but-
 *  blank aliased column is treated as absent, so an earlier blank canonical
 *  column never shadows a later filled alias column. */
function readAliased(raw: Record<string, unknown>, field: keyof typeof COLUMN_ALIASES): unknown {
  const wanted = new Set([normalizeAliasKey(field), ...COLUMN_ALIASES[field].map(normalizeAliasKey)])
  for (const rawKey of Object.keys(raw)) {
    if (!wanted.has(normalizeAliasKey(rawKey))) continue
    const value = raw[rawKey]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

/** The sheet's free_goods cell, read the way a spreadsheet checkbox column
 *  is actually typed -- '1'/'true'/'yes'/'y', case-insensitive; anything
 *  else (blank included) is "not declared free". */
function parseFreeGoodsFlag(value: unknown): boolean {
  const normalized = text(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y'
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

// THE identity question, asked the way every other surface asks it (the Sep-4
// cost ruling and N15's fold): same collapsed name + same FOLDED barcode is the
// same product. Two things used to make this path disagree with the rest of the
// app, and each one minted exactly the rows the merge tool then has to clean up:
//
//   * the barcode was compared RAW, so a sheet written in the GTIN-14 form of a
//     code the catalog stores as EAN-13 (one extra leading zero) matched
//     nothing and the import CREATED the leading-zero twin itself;
//   * a different COST forked a new product. That is the pre-Sep-4 rule -- it
//     left products.ts and stockSession.ts when the owner ruled "only a
//     different barcode creates a new child row" -- so a restock at a new price
//     silently became a second product row.
//
// Cost is still read and carried onto the row (costPriceUsd below); it simply
// no longer decides identity.
function matchProduct(
  name: string,
  barcode: string,
  batchLabel: string,
  products: UnifiedStockCatalogProduct[],
): { product: UnifiedStockCatalogProduct | null; conflict: string | null } {
  const nameKey = key(name)
  const barcodeKey = identityBarcodeKey(barcode)
  const candidates = products.filter((product) => (
    (!nameKey || key(product.name) === nameKey) && identityBarcodeKey(product.barcode) === barcodeKey
  ))
  if (candidates.length === 1) return { product: candidates[0], conflict: null }
  if (candidates.length > 1) {
    // More than one row IS this identity, i.e. the catalog already holds
    // duplicates. An explicitly named batch owned by exactly one of them still
    // settles it (another receipt may share that lot option while its event
    // cost stays on the movement/received-cost ledger, never on
    // products.cost_price_usd); otherwise the row is reviewable, never
    // actionable.
    const batchKey = key(batchLabel)
    const sameBatch = batchKey
      ? candidates.filter((product) => (product.batch_keys || []).some((value) => key(value) === batchKey))
      : []
    if (sameBatch.length === 1) return { product: sameBatch[0], conflict: null }
    if (sameBatch.length > 1) return { product: null, conflict: `Received date "${batchLabel}" belongs to ${sameBatch.length} matching product rows; choose the exact row.` }
    return {
      product: null,
      conflict: nameKey
        ? `Name/barcode match ${candidates.length} product rows; merge the exact duplicates before importing.`
        : `Barcode ${barcode} matches ${candidates.length} products; add the product name so the right row is chosen.`,
    }
  }
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
  const newBatchIdentityByKey = new Map<string, string>()
  const current = currentStock.map((entry) => ({
    branchId: entry.branchId,
    productKey: `product:${entry.productId}`,
    quantity: Number(entry.quantity) || 0,
  }))

  rawRows.forEach((raw, index) => {
    const rowNumber = Number(raw._rowNumber) > 0 ? Number(raw._rowNumber) : index + 2
    const name = text(readAliased(raw, 'name'))
    const barcode = text(readAliased(raw, 'barcode'))
    const date = normalizeToIsoDate(text(readAliased(raw, 'date'))) || ''
    const action = text(readAliased(raw, 'action'))
    const shop = optionalNumber(readAliased(raw, 'shop'), 'shop quantity')
    const warehouse = optionalNumber(readAliased(raw, 'warehouse'), 'warehouse quantity')
    const selling = optionalMoney(readAliased(raw, 'selling_price'), 'selling price')
    // Wholesale price -- the sheet column renamed from vip_price by migration
    // 0111. The legacy vip_price / special_price spellings (and their _usd
    // twins) still resolve here via COLUMN_ALIASES: per the owner's ruling
    // that column always carried wholesale numbers, so an old sheet headed
    // "VIP price" IS a wholesale sheet and reading it as absent would
    // silently drop the operator's real prices on every re-import of a file
    // exported before the rename.
    const wholesale = optionalMoney(readAliased(raw, 'wholesale_price'), 'Wholesale price')
    const cost = optionalMoney(readAliased(raw, 'cost_price'), 'cost price')
    const errors = [shop.error, warehouse.error, selling.error, wholesale.error, cost.error].filter((value): value is string => !!value)
    if (!name && !barcode) errors.push('Name or barcode is required.')
    if (!date) errors.push('Date must be mm/dd/yyyy or yyyy-mm-dd.')
    if (shop.value == null && warehouse.value == null) errors.push('Enter a shop or warehouse quantity.')

    const batchLabel = text(readAliased(raw, 'batch'))
    const effectiveBatchLabel = batchLabel || (date ? String(dateToBatchCode(date)) : '')
    const matched = matchProduct(name, barcode, effectiveBatchLabel, products)
    const productName = matched.product?.name || name
    // The identity a row that must CREATE will get, and the key sibling rows in
    // the same file group on. It is the same question matchProduct asks of the
    // catalog: name group + folded barcode. Cost used to be part of it, so one
    // file listing the same article at two prices minted two products, and the
    // raw barcode used to be part of it, so '0601' and '601' in one file minted
    // the twin pair N15 exists to remove.
    let identityKey = matched.product
      ? `product:${matched.product.id}`
      : `new:${key(productName)}|${identityBarcodeKey(barcode)}`
    if (!matched.product && key(productName) && identityBarcodeKey(barcode) && key(effectiveBatchLabel)) {
      const batchOwnerKey = `${key(productName)}|${identityBarcodeKey(barcode)}|batch:${key(effectiveBatchLabel)}`
      const earlierIdentity = newBatchIdentityByKey.get(batchOwnerKey)
      if (earlierIdentity) identityKey = earlierIdentity
      else newBatchIdentityByKey.set(batchOwnerKey, identityKey)
    }
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
      wholesalePriceUsd: wholesale.value ?? matched.product?.wholesale_price_usd ?? null,
      costPriceUsd: cost.value ?? matched.product?.cost_price_usd ?? null,
      sheetCostPriceUsd: cost.value,
      batchLabel: batchLabel || null,
      supplier: text(readAliased(raw, 'supplier')).replace(/\s{2,}/g, ' ').slice(0, 120),
      // Every spelling COLUMN_ALIASES.free_goods lists (the client's own
      // header-alias map for this column) -- otherwise a sheet headed
      // "Free" / "FreeGoods" / "Is Free" / "Free Item" passes the client
      // mirror clean and is refused free_goods_required by the server for a
      // box the operator already ticked (sibling:F13 verifier wave 9).
      freeGoods: parseFreeGoodsFlag(readAliased(raw, 'free_goods')),
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
      wholesalePriceUsd: resolved.wholesalePriceUsd,
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
