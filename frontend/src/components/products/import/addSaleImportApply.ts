// Apply layer for the General mode "Add/Sale" import sub-option (see
// progress.md's "CSV-import mode selector" open item). This is the "thin
// wrapper" piece that item's own note called out as the last remaining
// gap once resolveAddSaleCostPrices/resolveAddSaleProductMatches/
// resolveAddSaleRows/buildAddSaleGroupPlans existed (Parts 297-300):
// turning each 'ready' AddSaleGroupPlan's already-built SaleCreatePayload
// into a real sale, and leaving 'blocked'/'needs_new_product' groups
// untouched for the (still unbuilt) review screen to surface.
//
// Deliberately NOT a new backend route. buildAddSaleGroupPlans() already
// produces exactly the shape POST /sales accepts (SaleCreatePayload's
// items/branch_id/customer_id mirror cloudflare/src/routes/sales.ts's
// SaleItemInput), and this app already has a tested, offline-aware
// client for that endpoint -- api/saleWriteTransport.ts's createSale().
// Duplicating that endpoint's stock-check/pricing/membership logic here
// (or in a new backend file) would be exactly the "duplicate parallel
// implementation of something that already exists elsewhere" this
// project's Golden Rules call out as a bug class to avoid. The DB-backed
// route this item's own note anticipated turns out to already exist.
//
// Each group's payload is independently atomic (a single createSale()
// call either fully succeeds or fully fails server-side, per POST
// /sales' own all-or-nothing write) -- there is no cross-group
// transaction here, matching buildAddSaleGroupPlans' own scoping of
// "all-or-nothing" to one receipt's rows, not the whole import batch.
// One group failing (e.g. a stock check race lost between review and
// apply) does not block the rest of the batch from applying; every
// group's own real outcome is reported, never swallowed into an
// overall "success".

import type { AddSaleGroupPlan } from './addSaleImportPlan.ts'

// Matches createSale()'s real success shape closely enough for this
// layer's purposes (id + receipt number) without importing
// saleWriteTransport.ts's SalePayload/local-db types here -- this file
// stays a pure orchestrator, injecting the transport call rather than
// hard-importing it, so it can be unit-tested without hitting
// api/http.ts's real fetch/offline-queue machinery.
export interface CreatedSaleResult {
  id?: number
  receiptNumber?: string
  duplicate?: boolean
  [key: string]: unknown
}

export type CreateSaleFn = (payload: Record<string, unknown>) => Promise<unknown>

export type AddSaleGroupApplyResult =
  | { status: 'applied'; actionLabel: string | null; rowIndexes: number[]; result: CreatedSaleResult }
  | { status: 'failed'; actionLabel: string | null; rowIndexes: number[]; error: string }
  | { status: 'skipped_blocked'; actionLabel: string | null; rowIndexes: number[]; blockedRowIndexes: number[] }
  | { status: 'skipped_needs_new_product'; actionLabel: string | null; rowIndexes: number[]; newProductRowIndexes: number[] }

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const withMessage = error as { message?: unknown } | null
  if (withMessage && typeof withMessage.message === 'string' && withMessage.message) return withMessage.message
  return String(error ?? 'Unknown error')
}

// Applies every 'ready' group in `plans`, in file order, via `createSaleFn`
// (defaults to the real createSale() transport when omitted so callers in
// the app don't need to wire it themselves; tests pass a stub). Sequential,
// not Promise.all -- a bundled multi-item receipt going out of order
// against real stock isn't a concern this layer needs to solve, but
// keeping apply order == file order makes a partial-batch failure easy
// for a human to reason about ("groups 1-3 applied, group 4 failed,
// groups 5+ never attempted" is a coherent, debuggable position; an
// unordered Promise.all failure is not). 'blocked' and 'needs_new_product'
// groups are never sent anywhere -- they pass through unchanged for the
// review screen, exactly as this item's own note specified.
export async function applyAddSaleGroupPlans(
  plans: AddSaleGroupPlan[],
  createSaleFn?: CreateSaleFn,
): Promise<AddSaleGroupApplyResult[]> {
  let createSale = createSaleFn
  if (!createSale) {
    const mod = await import('../../../api/saleWriteTransport.ts')
    createSale = mod.createSale as CreateSaleFn
  }

  const results: AddSaleGroupApplyResult[] = []
  for (const plan of plans) {
    if (plan.status === 'blocked') {
      results.push({
        status: 'skipped_blocked',
        actionLabel: plan.actionLabel,
        rowIndexes: plan.rowIndexes,
        blockedRowIndexes: plan.blockedRowIndexes,
      })
      continue
    }
    if (plan.status === 'needs_new_product') {
      results.push({
        status: 'skipped_needs_new_product',
        actionLabel: plan.actionLabel,
        rowIndexes: plan.rowIndexes,
        newProductRowIndexes: plan.newProductRowIndexes,
      })
      continue
    }
    // plan.status === 'ready'
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design, see comment above
      const result = (await createSale(plan.payload as unknown as Record<string, unknown>)) as CreatedSaleResult
      results.push({ status: 'applied', actionLabel: plan.actionLabel, rowIndexes: plan.rowIndexes, result })
    } catch (error) {
      results.push({
        status: 'failed',
        actionLabel: plan.actionLabel,
        rowIndexes: plan.rowIndexes,
        error: errorMessage(error),
      })
    }
  }
  return results
}

// Convenience summary for the (still unbuilt) review/apply UI -- counts
// only, no row detail, since the UI's own job is to render each result's
// row indexes against the source rows it already has in state.
export function summarizeAddSaleApplyResults(results: AddSaleGroupApplyResult[]): {
  applied: number
  failed: number
  skippedBlocked: number
  skippedNeedsNewProduct: number
} {
  return {
    applied: results.filter((r) => r.status === 'applied').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skippedBlocked: results.filter((r) => r.status === 'skipped_blocked').length,
    skippedNeedsNewProduct: results.filter((r) => r.status === 'skipped_needs_new_product').length,
  }
}
