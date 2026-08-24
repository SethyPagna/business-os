// Part 330: closes the one remaining "not decided" gap in the Add/Sale
// import pipeline's own notes (progress.md, "CSV-import mode selector"
// item) -- which existing product-creation endpoint a 'needs_new_product'
// row's product should be created through. Same reuse decision
// addSaleImportApply.ts already made for sale creation: no new backend
// route, no duplicated stock/pricing logic. `api/productWriteTransport.ts`'s
// createProduct() already does exactly what a brand-new product from an
// Add/Sale row needs (seeds branch_stock/product_batches across every
// active branch, same as a manual Add Product) -- inventing a second,
// import-specific product-creation path would be exactly the "duplicate
// parallel implementation" bug class this project's Golden Rules warn
// against.
//
// This module is the missing link between resolveAddSaleRows' existing
// 'needs_new_product' status and a real 'ready' plan: create the product,
// then feed the result back into resolveAddSaleRows as a `use_product`
// review decision (rather than re-deriving a second, parallel "row is now
// ready" path) so the exact same resolution logic that already handles a
// human's manual "use this product" pick also handles "the product this
// session just created." One function, one behavior, whichever way a
// row's productId got decided.

import type { AddSaleImportRow } from './addSaleImportResolve.ts'
import { resolveAddSaleRows, buildAddSaleGroupPlans, type ResolvedSaleRow, type RowReviewDecision, type AddSaleGroupPlan } from './addSaleImportPlan.ts'
import type { AddSaleGroup, CostPriceResolution, ProductMatchResolution } from './addSaleImportResolve.ts'

export interface NewProductPayload {
  name: string
  barcode?: string
  sku?: string
  branch_id: number
  cost_price_usd?: number
  cost_price_khr?: number
  selling_price_usd?: number
  selling_price_khr?: number
}

// A brand-new product needs a real initial price of its own (distinct
// from the sale line item's applied_price_* override, which only ever
// applies to that one sale) -- the row's own selling price is the only
// sensible default available and is always present here, since
// resolveAddSaleRows already blocks a row with no selling price before
// it can ever reach 'needs_new_product'.
export function buildNewProductPayloadsForRows(
  rows: AddSaleImportRow[],
  resolvedRows: ResolvedSaleRow[],
): Map<number, NewProductPayload> {
  const payloads = new Map<number, NewProductPayload>()
  for (const resolved of resolvedRows) {
    if (resolved.status !== 'needs_new_product') continue
    const row = rows[resolved.rowIndex]
    const name = String(row?.name ?? '').trim()
    if (!name || resolved.branchId == null) continue
    payloads.set(resolved.rowIndex, {
      name,
      ...(row?.barcode ? { barcode: String(row.barcode).trim() } : {}),
      ...(row?.sku ? { sku: String(row.sku).trim() } : {}),
      branch_id: resolved.branchId,
      ...(resolved.costPriceUsd != null ? { cost_price_usd: resolved.costPriceUsd } : {}),
      ...(resolved.costPriceKhr != null ? { cost_price_khr: resolved.costPriceKhr } : {}),
      ...(resolved.sellingPriceUsd != null ? { selling_price_usd: resolved.sellingPriceUsd } : {}),
      ...(resolved.sellingPriceKhr != null ? { selling_price_khr: resolved.sellingPriceKhr } : {}),
    })
  }
  return payloads
}

export type CreateProductFn = (payload: Record<string, unknown>) => Promise<unknown>

export interface ProductCreationOutcome {
  rowIndex: number
  status: 'created' | 'pending' | 'failed'
  productId?: number
  pendingActionId?: string
  error?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const withMessage = error as { message?: unknown } | null
  if (withMessage && typeof withMessage.message === 'string' && withMessage.message) return withMessage.message
  return String(error ?? 'Unknown error')
}

// Real product ids come back on POST /api/products' normal 200 response
// (`{ item, id, success: true }`, routes/products.ts) -- but a Review
// Required tier user instead gets a 202 `{ success: true, pending: true,
// pendingActionId }` (the same review-gate every other write in this app
// already goes through, see lib/reviewGate.ts). Both are read here
// defensively by shape rather than assuming one or the other, since which
// one comes back depends on the calling user's own permission tier, not
// on anything this import layer controls.
function readCreateProductResult(result: unknown): { productId?: number; pendingActionId?: string } {
  const r = result as { id?: unknown; pendingActionId?: unknown; pending?: unknown } | null
  const productId = typeof r?.id === 'number' ? r.id : (typeof r?.id === 'string' && r.id ? Number(r.id) : undefined)
  const pendingActionId = typeof r?.pendingActionId === 'string' ? r.pendingActionId : undefined
  return {
    ...(productId != null && Number.isFinite(productId) ? { productId } : {}),
    ...(pendingActionId ? { pendingActionId } : {}),
  }
}

// Creates a product for every 'needs_new_product' row, sequentially (same
// file-order-is-debuggable reasoning as applyAddSaleGroupPlans -- an
// import batch creating several new products isn't a hot path worth
// Promise.all-ing at the cost of a harder-to-read partial failure).
// `createProductFn` defaults to the real transport, injectable for tests.
export async function createMissingProductsForRows(
  rows: AddSaleImportRow[],
  resolvedRows: ResolvedSaleRow[],
  createProductFn?: CreateProductFn,
): Promise<ProductCreationOutcome[]> {
  let createProduct = createProductFn
  if (!createProduct) {
    const mod = await import('../../../api/productWriteTransport.ts')
    createProduct = mod.createProduct as CreateProductFn
  }

  const payloads = buildNewProductPayloadsForRows(rows, resolvedRows)
  const outcomes: ProductCreationOutcome[] = []
  for (const [rowIndex, payload] of payloads) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design, see comment above
      const result = await createProduct(payload as unknown as Record<string, unknown>)
      const { productId, pendingActionId } = readCreateProductResult(result)
      if (productId != null) {
        outcomes.push({ rowIndex, status: 'created', productId })
      } else if (pendingActionId) {
        outcomes.push({ rowIndex, status: 'pending', pendingActionId })
      } else {
        outcomes.push({ rowIndex, status: 'failed', error: 'Product creation did not return an id' })
      }
    } catch (error) {
      outcomes.push({ rowIndex, status: 'failed', error: errorMessage(error) })
    }
  }
  return outcomes
}

// Re-resolves every successfully-created row to 'ready' by feeding its
// new productId back through resolveAddSaleRows as a `use_product`
// review decision -- reuses that function's existing resolution logic
// rather than hand-building a second "mark as ready" path (see file
// header). A row whose creation is still pending review, or failed
// outright, is deliberately left as 'needs_new_product'/unresolved here
// -- it isn't ready, and re-resolving it as ready would be wrong; the
// caller's own outcome list (from createMissingProductsForRows) is what
// surfaces the pending/failed reason to a review screen.
export function applyProductCreationOutcomes(
  outcomes: ProductCreationOutcome[],
  existingReviewDecisions?: Map<number, RowReviewDecision>,
): Map<number, RowReviewDecision> {
  const decisions = new Map(existingReviewDecisions ?? [])
  for (const outcome of outcomes) {
    if (outcome.status === 'created' && outcome.productId != null) {
      decisions.set(outcome.rowIndex, { type: 'use_product', productId: outcome.productId })
    }
  }
  return decisions
}

// End-to-end convenience for the (still unbuilt) review/apply UI: create
// every 'needs_new_product' row's product, fold the results back into a
// fresh resolve + group-plan pass, and hand back both the group plans
// (ready to feed straight into applyAddSaleGroupPlans) and the raw
// creation outcomes (for the UI to explain any pending/failed row).
export async function createMissingProductsAndReplan(
  rows: AddSaleImportRow[],
  groups: AddSaleGroup[],
  costResolutions: CostPriceResolution[],
  matchResolutions: ProductMatchResolution[],
  branchIdByName: Map<string, number>,
  resolvedRows: ResolvedSaleRow[],
  customerIdByName?: Map<string, number>,
  existingReviewDecisions?: Map<number, RowReviewDecision>,
  createProductFn?: CreateProductFn,
): Promise<{ plans: AddSaleGroupPlan[]; resolvedRows: ResolvedSaleRow[]; creationOutcomes: ProductCreationOutcome[] }> {
  const creationOutcomes = await createMissingProductsForRows(rows, resolvedRows, createProductFn)
  const decisions = applyProductCreationOutcomes(creationOutcomes, existingReviewDecisions)
  const nextResolvedRows = resolveAddSaleRows(rows, costResolutions, matchResolutions, branchIdByName, decisions)
  const plans = buildAddSaleGroupPlans(rows, groups, nextResolvedRows, customerIdByName)
  return { plans, resolvedRows: nextResolvedRows, creationOutcomes }
}
