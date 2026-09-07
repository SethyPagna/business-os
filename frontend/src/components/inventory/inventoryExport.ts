import { formatPriceNumber } from '../../utils/pricing.ts'
// N13: the movement CSV names the RECORD a group belongs to, through the same
// two functions the drill header above it uses. A spreadsheet that carries
// Branch / Reason / User but not the receipt cannot be matched back to a sale,
// which is the owner's "did not show details for sales" one surface along.
import { formatHistoryReference, historyGroupReference } from '../../utils/historyRowModel.ts'

type AnyRecord = Record<string, any>

// What is left here after Part 562. That commit removed the Inventory page's
// products slice and its export menu, which took away the only callers of the
// summary/stats/package exports; the products-side export capability now lives
// on the Products page, which owns its own row builders. The functions stayed
// behind anyway -- exportInventorySummary, exportInventoryStats,
// exportInventoryMovementGroups, collectInventorySummaryRows,
// collectInventoryStatsRows and exportInventoryPackage, plus the ~300 lines of
// private scope builders (stats rows, formula rows, branch comparison, top
// stock value, movement volume, the standalone HTML report and the zip package
// assembly) that only they reached. Nothing imported them, and the one thing
// keeping exportInventoryPackage nominally "used" was a regex assertion in
// performanceLoadingUx.test.ts, so the chunk kept paying for an assembly no UI
// could ask for. All of it is deleted; the movements export is the whole live
// surface of this module.
//
// Inventory.tsx still lazy-loads this file (loadInventoryExportModule) and
// vite.config keeps its named 'inventory-export' chunk out of eager
// modulepreload, so the movement export still costs nothing until requested.

function priceCsv(value: unknown): string {
  return formatPriceNumber(value || 0)
}

// Every header in this file is English (Date, Activity, Branch, Reason, User),
// so the receipt is composed with the English words too. The COMPOSITION is
// still the shared one -- what differs between a CSV cell and the drill header
// is only which dictionary the caller hands it, exactly as
// formatHistoryReference's contract intends.
const MOVEMENT_EXPORT_REFERENCE_WORDS = { sale: 'Sale', return: 'Return' }

function buildMovementRows(groups: AnyRecord[]): AnyRecord[] {
  return groups.map((group) => ({
    Date: group.latest_at || '',
    Activity: group.movementLabel || '',
    Products: group.productSummary || '',
    Records: group.items?.length || 0,
    Qty: group.totalQuantity || 0,
    Total_Cost_USD: priceCsv(group.totalCostUsd || 0),
    Branch: group.branchSummary || '',
    // The record the group belongs to -- "Sale 20260901-193100" -- and the raw
    // reference_id only for the groups that name no record (stock-in session
    // tokens, 'revert:<id>'), which is what the drill header falls back to.
    Receipt: formatHistoryReference(historyGroupReference(group.items), MOVEMENT_EXPORT_REFERENCE_WORDS)
      || String(group.reference_id || ''),
    Reason: group.reasonSummary || '',
    User: group.userSummary || '',
  }))
}

// H1+X5 (Part 405): the export exposes its ROW builder so Inventory.tsx can
// feed the shared options dialog (column chooser + CSV/Excel/PDF) rather than
// downloading a fixed file, which is why there is no download function beside
// it -- there is exactly one row shape for the movements export.
export function collectInventoryMovementRows(groups: AnyRecord[]): AnyRecord[] {
  return buildMovementRows(groups)
}
