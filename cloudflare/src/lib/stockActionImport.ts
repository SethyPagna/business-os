// Row parsing and catalog resolution for the unified §12 stock import.
// DB access stays outside this file: the queue engine passes only the
// targeted catalog/branch/stock rows needed for one bounded window.

import { dateToBatchCode, normalizeToIsoDate } from './batchCode'
import { parseImportNumericValue, normalizeImportCost4, normalizeImportSellingPrice } from './importNumbers'
// The ONE fold. Imported from the rule module both packages carry verbatim, so
// this path cannot reach a different verdict from the create/edit guard, the
// Conflicts sweep, the merge tool or the client's own sheet review.
import { identityBarcodeKey, identityBarcodeClassKey, barcodeIdentityMatches } from './productDetailRule'
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
  // Optional: the surviving branch after the Shop/Warehouse consolidation,
  // by its own name. Before a Store exists it reads as Shop (the sheets'
  // long-standing 'store' alias); after, it is the Store. Old sheets with
  // only shop/warehouse keep working -- see UnifiedStockSlotResolver. Last,
  // so every existing column keeps its position. Mirrors
  // frontend unifiedStockImport.ts UNIFIED_STOCK_HEADERS.
  'store',
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

export type UnifiedStockSlot = 'shop' | 'warehouse' | 'store'

/**
 * Which branch a sheet column lands on. `origin` is the retired branch the
 * column addressed when its stock now lands at that branch's successor.
 * The DB-backed resolver (stockActionCatalog.ts) answers through
 * importBranchAuthority's canonical identity + successor rule.
 */
export type UnifiedStockSlotResolver = (slot: UnifiedStockSlot) => {
  branch: UnifiedStockBranch
  origin: UnifiedStockBranch | null
} | null

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
  /**
   * One entry per EFFECTIVE branch. Sheet columns that land on the same
   * branch (shop + warehouse after the consolidation, or shop + store before
   * it) are summed into one entry; `slots` lists them, and
   * originBranchId/Name records a retired branch a column addressed.
   */
  branchRefs: Array<{
    slot: UnifiedStockSlot
    branchId: number
    branchName: string
    pending: boolean
    value: number
    slots?: UnifiedStockSlot[]
    originBranchId?: number | null
    originBranchName?: string | null
  }>
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

function optionalMoney(value: unknown, field: string, selling = false): { value: number | null; error: string | null } {
  if (!text(value)) return { value: null, error: null }
  const parsed = optionalNumber(value, field)
  return parsed.error ? parsed : { value: selling ? normalizeImportSellingPrice(parsed.value) : normalizeImportCost4(parsed.value), error: null }
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
  // Wildcard-aware (Sep 15 2026 ruling): a real-vs-broken barcode pair
  // within the same name is the SAME identity. When more than one candidate
  // still matches -- only reachable when the sheet's barcode is broken/
  // empty and the catalog already holds two-plus real barcodes under this
  // name -- the ambiguity is surfaced for manual review below rather than
  // silently guessed at, same as an already-duplicated catalog today.
  //
  // The wildcard half of the rule is scoped to "same name" (the owner's
  // ruling opens "for same name 100% products"); with NO name at all on the
  // sheet there is no group to scope it to, so a nameless row only ever
  // matches an EXACT real-barcode candidate, never wildcards onto every
  // broken-barcode product in the whole catalog regardless of name.
  const candidates = nameKey
    ? products.filter((product) => key(product.name) === nameKey && barcodeIdentityMatches(product.barcode, barcode))
    : products.filter((product) => identityBarcodeKey(product.barcode) === identityBarcodeKey(barcode) && identityBarcodeKey(barcode))
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
  slotResolver?: UnifiedStockSlotResolver,
): UnifiedStockResolvedRow[] {
  const branchByName = new Map(branches.map((branch) => [key(branch.name), branch]))
  // Without a resolver: the exact-name rule this file always used, plus the
  // 'store' column reading as Shop until a branch named Store exists.
  const resolveSlot: UnifiedStockSlotResolver = slotResolver || ((slot) => {
    const branch = branchByName.get(slot) || (slot === 'store' ? branchByName.get('shop') || null : null)
    return branch ? { branch, origin: null } : null
  })
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
    const name = text(raw.name)
    const barcode = text(raw.barcode)
    // The sheet's bare `date` header names no format, so it keeps the only
    // meaning it has ever had -- month-first -- and says so explicitly rather
    // than leaning on a default. This is a FILE the shop already owns, not a
    // field anyone types into the app; see unifiedStockImport.ts for the
    // client-side mirror of the same ruling.
    const date = normalizeToIsoDate(text(raw.date), 'month-first') || ''
    const action = text(raw.action)
    const shop = optionalNumber(raw.shop, 'shop quantity')
    const warehouse = optionalNumber(raw.warehouse, 'warehouse quantity')
    const store = optionalNumber(raw.store, 'store quantity')
    const selling = optionalMoney(raw.selling_price, 'selling price', true)
    // Wholesale price -- the sheet column renamed from vip_price by migration
    // 0111. The legacy vip_price / special_price spellings still resolve here:
    // per the owner's ruling that column always carried wholesale numbers, so
    // an old sheet headed "VIP price" IS a wholesale sheet and reading it as
    // absent would silently drop the operator's real prices on every re-import
    // of a file exported before the rename. An explicit wholesale_price wins,
    // being the one header that unambiguously names the tier it means. Mirrors
    // unifiedStockImport.ts's HEADER_ALIASES on the frontend side.
    const wholesale = optionalMoney(raw.wholesale_price ?? raw.vip_price ?? raw.special_price, 'Wholesale price', true)
    const cost = optionalMoney(raw.cost_price, 'cost price')
    const errors = [shop.error, warehouse.error, store.error, selling.error, wholesale.error, cost.error].filter((value): value is string => !!value)
    if (!name && !barcode) errors.push('Name or barcode is required.')
    if (!date) errors.push('Date must be mm/dd/yyyy (month first, as this column has always been) or yyyy-mm-dd.')
    if (shop.value == null && warehouse.value == null && store.value == null) errors.push('Enter a shop or warehouse quantity.')

    const batchLabel = text(raw.batch)
    const effectiveBatchLabel = batchLabel || (date ? String(dateToBatchCode(date)) : '')
    const matched = matchProduct(name, barcode, effectiveBatchLabel, products)
    const productName = matched.product?.name || name
    // The identity a row that must CREATE will get, and the key sibling rows in
    // the same file group on. It is the same question matchProduct asks of the
    // catalog: name group + folded barcode. Cost used to be part of it, so one
    // file listing the same article at two prices minted two products, and the
    // raw barcode used to be part of it, so '0601' and '601' in one file minted
    // the twin pair N15 exists to remove.
    // The class-folded key, not the raw leading-zero-only fold: a broken/
    // short/word barcode folds to '' here, same as an empty one, so two
    // sheet rows for one NEW same-name product that both lack a real
    // barcode collapse to one identity ("if both is empty merge into one
    // empty"). A real-vs-broken pair across two would-be-new rows is a
    // narrower remaining gap (this key alone cannot express the wildcard
    // when one row IS real and the other is not); matchProduct's wildcard
    // already covers the common case of matching against the EXISTING
    // catalog, which is where the barcode-omitted sheet row usually lands.
    let identityKey = matched.product
      ? `product:${matched.product.id}`
      : `new:${key(productName)}|${identityBarcodeClassKey(barcode)}`
    if (!matched.product && key(productName) && identityBarcodeKey(barcode) && key(effectiveBatchLabel)) {
      const batchOwnerKey = `${key(productName)}|${identityBarcodeKey(barcode)}|batch:${key(effectiveBatchLabel)}`
      const earlierIdentity = newBatchIdentityByKey.get(batchOwnerKey)
      if (earlierIdentity) identityKey = earlierIdentity
      else newBatchIdentityByKey.set(batchOwnerKey, identityKey)
    }
    const conflicts = matched.conflict ? [matched.conflict] : []
    const branchRefs: UnifiedStockResolvedRow['branchRefs'] = []
    // Every column lands on its EFFECTIVE branch; columns that land on the
    // same branch are summed into one entry, because the resolver below
    // plans one action per (product, branch) and two entries for one branch
    // would apply two deltas (or, when counting, two conflicting targets).
    const redirectedOnly = new Map<number, boolean>()
    ;(['shop', 'warehouse', 'store'] as const).forEach((slot, slotIndex) => {
      const parsed = slot === 'shop' ? shop.value : slot === 'warehouse' ? warehouse.value : store.value
      if (parsed == null) return
      const resolvedSlot = resolveSlot(slot)
      const branch = resolvedSlot?.branch || null
      const branchId = branch?.id ?? -(slotIndex + 1)
      const existing = branch ? branchRefs.find((ref) => ref.branchId === branchId) : undefined
      const origin = resolvedSlot?.origin || null
      if (existing) {
        existing.value += parsed
        existing.slots = [...(existing.slots || [existing.slot]), slot]
        if (origin && existing.originBranchId == null) {
          existing.originBranchId = origin.id
          existing.originBranchName = origin.name
        }
        redirectedOnly.set(branchId, (redirectedOnly.get(branchId) ?? true) && !!origin)
        return
      }
      branchRefs.push({
        slot,
        branchId,
        branchName: branch?.name || (slot === 'warehouse' ? 'Warehouse' : slot === 'store' ? 'Store' : 'Shop'),
        pending: !branch,
        value: parsed,
        ...(origin ? { originBranchId: origin.id, originBranchName: origin.name } : {}),
      })
      if (branch) redirectedOnly.set(branchId, !!origin)
    })
    // A counting (reconcile) sheet states the figure a branch should hold. A
    // column addressed to a retired branch is not the figure of the branch
    // its stock moved into, so a count carried ONLY by such a column is
    // refused rather than allowed to overwrite the survivor's quantity.
    if (mode === 'reconcile') {
      for (const ref of branchRefs) {
        if (ref.originBranchId != null && redirectedOnly.get(ref.branchId)) {
          errors.push(`${ref.originBranchName || 'That branch'} has moved into ${ref.branchName}. This sheet sets counts, so enter the ${ref.branchName} count in the store or warehouse column.`)
        }
      }
    }

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
      supplier: text(raw.supplier).replace(/\s{2,}/g, ' ').slice(0, 120),
      freeGoods: parseFreeGoodsFlag(raw.free_goods),
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
