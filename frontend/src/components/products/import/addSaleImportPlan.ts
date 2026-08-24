// Pure plan-builder for the General mode "Add/Sale" import sub-option
// (see progress.md's "CSV-import mode selector" open item). This is the
// layer between resolution (addSaleImportResolve.ts's cost/product-match
// functions) and the real sales-write route -- it turns fully-resolved
// rows into the exact payload shape POST /sales already accepts
// (cloudflare/src/routes/sales.ts's SaleItemInput), so the eventual
// route handler can be a thin wrapper: build the plan, then POST/insert
// each 'ready' group's payload. Nothing here touches the DB or renders
// UI, same as every other *Resolve.ts/*Planner.ts file in this app's
// import system.
//
// A whole receipt (AddSaleGroup) is deliberately all-or-nothing: if any
// row bundled into the same sale is still blocked or needs a new
// product created first, the ENTIRE group is reported blocked/pending
// rather than committing the rows that happen to be ready -- partially
// writing a multi-item receipt is exactly the kind of silent data
// inconsistency the review-before-commit step across this app's import
// system exists to prevent.

import type {
  AddSaleImportRow,
  AddSaleGroup,
  CostPriceResolution,
  ProductMatchResolution,
} from './addSaleImportResolve.ts'

// A human's answer from the (not yet built) review screen for a row
// that resolveAddSaleProductMatches() couldn't resolve on its own --
// either "use this specific existing product anyway" (picking one of
// its reported conflictingCandidateIds, or any other product id) or
// "create a new product for this row." Not needed for a row that
// already auto-matched.
export type RowReviewDecision = { type: 'use_product'; productId: number } | { type: 'create_new' }

export type ResolvedSaleRowStatus = 'ready' | 'needs_new_product' | 'blocked'

export interface ResolvedSaleRow {
  rowIndex: number
  status: ResolvedSaleRowStatus
  productId?: number
  branchId?: number
  quantity?: number
  sellingPriceUsd?: number
  sellingPriceKhr?: number
  costPriceUsd?: number
  costPriceKhr?: number
  // Present only when status is 'blocked'. Reuses
  // resolveAddSaleProductMatches()'s ProductMatchBlockReason values
  // where the block came from there, plus a few plan-level reasons
  // ('unknown_branch', 'invalid_quantity', 'missing_selling_price',
  // 'missing_cost_price') for gaps this layer itself checks.
  blockedReason?: string
}

function parsePositiveNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(num) && num > 0 ? num : null
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(num) ? num : null
}

function normalizeKey(value: unknown): string | null {
  const trimmed = String(value ?? '').trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

// Resolves each row independently into exactly what the eventual sale
// line item needs (product, branch, quantity, price) or why it can't
// proceed yet. `branchIdByName` and an optional per-row
// `reviewDecisions` map are the only DB-shaped inputs this pure
// function needs -- the caller looks up branch ids (and, in
// buildAddSaleGroupPlans below, customer ids) once and passes the
// lookup in, same as resolveAddSaleCostPrices/resolveAddSaleProductMatches
// take an already-fetched existingProducts array rather than querying
// themselves.
export function resolveAddSaleRows(
  rows: AddSaleImportRow[],
  costResolutions: CostPriceResolution[],
  matchResolutions: ProductMatchResolution[],
  branchIdByName: Map<string, number>,
  reviewDecisions?: Map<number, RowReviewDecision>,
): ResolvedSaleRow[] {
  return rows.map((row, rowIndex): ResolvedSaleRow => {
    const branchKey = normalizeKey(row.branch)
    const branchId = branchKey ? branchIdByName.get(branchKey) : undefined
    if (!branchId) {
      return { rowIndex, status: 'blocked', blockedReason: 'unknown_branch' }
    }

    const quantity = parsePositiveNumber(row.quantity)
    if (quantity == null) {
      return { rowIndex, status: 'blocked', blockedReason: 'invalid_quantity' }
    }

    // Selling price is read from the row for the SALE only -- never
    // used as a match key (see resolveAddSaleProductMatches) and never
    // written back to the product record (see buildAddSaleGroupPlans'
    // payload below, which only ever emits applied_price_*, the
    // sale-item field, not a product-update instruction).
    const sellingPriceUsd = parseOptionalNumber(row.selling_price_usd)
    const sellingPriceKhr = parseOptionalNumber(row.selling_price_khr)
    if (sellingPriceUsd == null && sellingPriceKhr == null) {
      return { rowIndex, status: 'blocked', blockedReason: 'missing_selling_price' }
    }

    const costResolution = costResolutions[rowIndex]
    if (!costResolution || !costResolution.resolved || costResolution.costPriceUsd == null) {
      return { rowIndex, status: 'blocked', blockedReason: 'missing_cost_price' }
    }

    const decision = reviewDecisions?.get(rowIndex)
    if (decision?.type === 'create_new') {
      return {
        rowIndex,
        status: 'needs_new_product',
        branchId,
        quantity,
        ...(sellingPriceUsd != null ? { sellingPriceUsd } : {}),
        ...(sellingPriceKhr != null ? { sellingPriceKhr } : {}),
        costPriceUsd: costResolution.costPriceUsd,
        ...(costResolution.costPriceKhr != null ? { costPriceKhr: costResolution.costPriceKhr } : {}),
      }
    }
    if (decision?.type === 'use_product') {
      return {
        rowIndex,
        status: 'ready',
        productId: decision.productId,
        branchId,
        quantity,
        ...(sellingPriceUsd != null ? { sellingPriceUsd } : {}),
        ...(sellingPriceKhr != null ? { sellingPriceKhr } : {}),
      }
    }

    const match = matchResolutions[rowIndex]
    if (!match || !match.matched || match.matchedProductId == null) {
      // No auto-match and no manual review decision yet -- stays
      // blocked until a human resolves it on the review screen.
      return { rowIndex, status: 'blocked', blockedReason: match?.reason ?? 'no_identity_match' }
    }

    return {
      rowIndex,
      status: 'ready',
      productId: match.matchedProductId,
      branchId,
      quantity,
      ...(sellingPriceUsd != null ? { sellingPriceUsd } : {}),
      ...(sellingPriceKhr != null ? { sellingPriceKhr } : {}),
    }
  })
}

// ---- Group-level: turn resolved rows into real sale payloads ----

export interface SaleCreateItemPayload {
  product_id: number
  quantity: number
  branch_id: number
  applied_price_usd?: number
  applied_price_khr?: number
}

export interface SaleCreatePayload {
  items: SaleCreateItemPayload[]
  branch_id: number
  customer_id?: number
}

export type AddSaleGroupPlan =
  | { actionLabel: string | null; rowIndexes: number[]; status: 'ready'; payload: SaleCreatePayload }
  | { actionLabel: string | null; rowIndexes: number[]; status: 'blocked'; blockedRowIndexes: number[] }
  | { actionLabel: string | null; rowIndexes: number[]; status: 'needs_new_product'; newProductRowIndexes: number[] }

export function buildAddSaleGroupPlans(
  rows: AddSaleImportRow[],
  groups: AddSaleGroup[],
  resolvedRows: ResolvedSaleRow[],
  customerIdByName?: Map<string, number>,
): AddSaleGroupPlan[] {
  const resolvedByIndex = new Map(resolvedRows.map((r) => [r.rowIndex, r]))

  return groups.map((group): AddSaleGroupPlan => {
    // All-or-nothing per group -- see file header. Blocked rows take
    // priority over needs-new-product rows in the reported status,
    // since a review screen should surface an outright block before a
    // "confirm creating this product" prompt.
    const blockedRowIndexes = group.rowIndexes.filter((i) => resolvedByIndex.get(i)?.status === 'blocked')
    if (blockedRowIndexes.length > 0) {
      return { actionLabel: group.actionLabel, rowIndexes: group.rowIndexes, status: 'blocked', blockedRowIndexes }
    }
    const newProductRowIndexes = group.rowIndexes.filter((i) => resolvedByIndex.get(i)?.status === 'needs_new_product')
    if (newProductRowIndexes.length > 0) {
      return { actionLabel: group.actionLabel, rowIndexes: group.rowIndexes, status: 'needs_new_product', newProductRowIndexes }
    }

    // Every row in this group is 'ready' -- bundle them as line items
    // of one sale, per the sale-grouping spec.
    const items: SaleCreateItemPayload[] = group.rowIndexes.map((i) => {
      const r = resolvedByIndex.get(i) as ResolvedSaleRow
      return {
        product_id: r.productId as number,
        quantity: r.quantity as number,
        branch_id: r.branchId as number,
        ...(r.sellingPriceUsd != null ? { applied_price_usd: r.sellingPriceUsd } : {}),
        ...(r.sellingPriceKhr != null ? { applied_price_khr: r.sellingPriceKhr } : {}),
      }
    })
    const branchId = items[0].branch_id

    const customerRowIndex = group.rowIndexes.find((i) => normalizeKey(rows[i]?.customer))
    const customerKey = customerRowIndex != null ? normalizeKey(rows[customerRowIndex]?.customer) : null
    const customerId = customerKey ? customerIdByName?.get(customerKey) : undefined

    return {
      actionLabel: group.actionLabel,
      rowIndexes: group.rowIndexes,
      status: 'ready',
      payload: {
        items,
        branch_id: branchId,
        ...(customerId != null ? { customer_id: customerId } : {}),
      },
    }
  })
}
