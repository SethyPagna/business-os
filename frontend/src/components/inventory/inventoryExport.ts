import { formatPriceNumber } from '../../utils/pricing.ts'

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

function buildMovementRows(groups: AnyRecord[]): AnyRecord[] {
  return groups.map((group) => ({
    Date: group.latest_at || '',
    Activity: group.movementLabel || '',
    Products: group.productSummary || '',
    Records: group.items?.length || 0,
    Qty: group.totalQuantity || 0,
    Total_Cost_USD: priceCsv(group.totalCostUsd || 0),
    Branch: group.branchSummary || '',
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
