// Section 5 (Sep 2 2026 RC): the "Business summary" workbook export --
// Sales hub -> Reports -> Export. One .xlsx with Summary / Sales / Returns /
// Expenses / Reconciliation / Definitions sheets, plus an ADMIN-ONLY "COGS &
// Gross profit" sheet.
//
// Every figure in this file comes from cloudflare/src/routes/reports.ts,
// which itself is a thin wrapper around lib/salesAnalytics.ts's canonical
// revenue kernel (see that file's header comment / the Reports route's own
// header comment) -- nothing here recomputes revenue, COGS or profit from
// raw fields. That is deliberate: it is the only way this workbook can never
// disagree with the Sales page's own stats header or the Dashboard for the
// same range.
//
// Admin gating is SERVER-side and absolute: cloudflare/src/routes/reports.ts
// never assigns cost_usd/gross_profit_usd/margin_pct/cost_missing_snapshot_
// lines onto a non-admin response at all (not blanked, not hidden -- the key
// itself is absent from the JSON). This file trusts the server's own
// `is_admin` flag on the /business-summary response as the single source of
// truth for whether to build the COGS sheet -- it does NOT re-derive
// isAdmin from the logged-in user object, so a stale/mismatched client-side
// permission read can never cause an admin sheet to appear (or vanish) out
// of step with what the server actually sent.
import {
  getBusinessSummary,
  getBusinessSummaryExpensesPage,
  getBusinessSummaryReturnsPage,
  getBusinessSummarySalesPage,
} from '../../api/reportsTransport.ts'
import { downloadWorkbook, type WorkbookSheet } from '../../utils/xlsxExport.ts'

export interface BusinessWorkbookRange {
  startDate: string
  endDate: string
  branchId?: string
}

type Row = Record<string, unknown>

interface PagedResponse {
  rows?: Row[]
  snapshot_max_id?: number | null
  has_more?: boolean
  next_cursor?: { created_at?: string; id?: number } | null
}

interface DaySummaryRow extends Row {
  date: string
  sales_count?: number
  gross_sales_usd?: number
  store_discount_usd?: number
  membership_discount_usd?: number
  discount_usd?: number
  tax_usd?: number
  delivery_usd?: number
  refund_usd?: number
  net_revenue_usd?: number
  pending_revenue_usd?: number
  collected_total_usd?: number
  cost_usd?: number
  gross_profit_usd?: number
  margin_pct?: number
  cost_missing_snapshot_lines?: number
}

interface ReconciliationDay { date: string; net_revenue_usd: number; expenses_usd: number; reconciliation_usd: number }
interface MonthRollup { month: string; net_revenue_usd: number; expenses_usd: number; reconciliation_usd: number }
interface ReconciliationTotals { net_revenue_usd: number; expenses_usd: number; reconciliation_usd: number }

interface BusinessSummaryResponse {
  period?: { start?: string | null; end?: string | null }
  is_admin?: boolean
  summary?: DaySummaryRow[]
  reconciliation?: { days?: ReconciliationDay[]; months?: MonthRollup[]; grand_totals?: ReconciliationTotals }
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const str = (v: unknown): string => (v == null ? '' : String(v))

// Pulls one paginated endpoint to completion using the exact snapshot/cursor
// contract cloudflare/src/routes/reports.ts's /business-summary/sales,
// /returns and /expenses all share with routes/sales.ts's own GET /export
// (frozen snapshot_max_id on page 1, afterCreatedAt/afterId keyset cursor on
// every later page) -- same loop shape ExportModal.tsx's CSV export already
// uses for /api/sales/export, so a stalled/misbehaving cursor fails loudly
// here too instead of silently truncating the workbook.
async function collectAllPages(
  fetchPage: (params: Record<string, string>) => Promise<unknown>,
  range: BusinessWorkbookRange,
): Promise<Row[]> {
  const baseParams: Record<string, string> = { startDate: range.startDate, endDate: range.endDate, pageSize: '500' }
  if (range.branchId) baseParams.branchId = range.branchId

  const first = (await fetchPage(baseParams)) as PagedResponse
  const rows: Row[] = [...(first.rows || [])]
  let page = first
  while (page.has_more) {
    const cursor = page.next_cursor
    if (!cursor?.created_at || !cursor.id || !page.snapshot_max_id) {
      throw new Error('Business summary export could not advance to the next page safely.')
    }
    const next = (await fetchPage({
      ...baseParams,
      snapshotMaxId: String(page.snapshot_max_id),
      afterCreatedAt: cursor.created_at,
      afterId: String(cursor.id),
    })) as PagedResponse
    rows.push(...(next.rows || []))
    page = next
  }
  return rows
}

// ---- Per-sheet row shaping: server field -> friendly Title_Case header, ----
// ---- matching the convention dashboardExport.ts already uses. Exported  ----
// ---- (not just used internally) so tests/businessWorkbookExport.test.ts ----
// ---- can exercise the admin-gating/shape logic directly, without having ----
// ---- to mock the network calls collectAllPages/exportBusinessWorkbook   ----
// ---- make.                                                             ----

export function summarySheetRows(days: DaySummaryRow[]): Row[] {
  return days.map((d) => ({
    Date: d.date,
    Sales_Count: num(d.sales_count),
    Gross_Sales_USD: num(d.gross_sales_usd),
    Store_Discount_USD: num(d.store_discount_usd),
    Membership_Discount_USD: num(d.membership_discount_usd),
    Discount_USD: num(d.discount_usd),
    Tax_USD: num(d.tax_usd),
    Delivery_USD: num(d.delivery_usd),
    Refund_USD: num(d.refund_usd),
    Net_Revenue_USD: num(d.net_revenue_usd),
    Pending_Credit_USD: num(d.pending_revenue_usd),
    Collected_Total_USD: num(d.collected_total_usd),
  }))
}

// Admin-only sheet. Only ever called when the SERVER said is_admin -- see
// buildBusinessWorkbook below. cost_missing_snapshot_lines is a transparency
// counter (how many sold lines that day have no cost_price_usd snapshot,
// e.g. a pre-migration legacy sale); it never changes Cost_USD itself, which
// stays on the exact same COALESCE(...,0) basis the Dashboard/Sales page use.
export function cogsSheetRows(days: DaySummaryRow[]): Row[] {
  return days.map((d) => ({
    Date: d.date,
    Net_Revenue_USD: num(d.net_revenue_usd),
    Cost_USD: num(d.cost_usd),
    Gross_Profit_USD: num(d.gross_profit_usd),
    Margin_Pct: num(d.margin_pct),
    Cost_Missing_Snapshot_Lines: num(d.cost_missing_snapshot_lines),
  }))
}

export function salesSheetRows(rows: Row[], isAdmin: boolean): Row[] {
  return rows.map((r) => {
    const base: Row = {
      Receipt_Number: str(r.receipt_number),
      Date: str(r.date),
      Business_Date: str(r.business_date),
      Branch: str(r.branch),
      Cashier: str(r.cashier),
      Customer: str(r.customer),
      Customer_Phone: str(r.customer_phone),
      Payment_Method: str(r.payment_method),
      Status: str(r.status),
      Gross_Sales_USD: num(r.gross_sales_usd),
      Store_Discount_USD: num(r.store_discount_usd),
      Membership_Discount_USD: num(r.membership_discount_usd),
      Tax_USD: num(r.tax_usd),
      Delivery_USD: num(r.delivery_usd),
      Refund_USD: num(r.refund_usd),
      Net_Revenue_USD: num(r.net_revenue_usd),
      Pending_Credit_USD: num(r.pending_revenue_usd),
      Collected_Total_USD: num(r.collected_total_usd),
    }
    // "never assign the key" -- these three keys are only added when the
    // server actually sent them (admin caller); a non-admin row simply has
    // no cost_usd key on it at all, so `r.cost_usd` is undefined and this
    // branch is skipped, not falsy-displayed as 0.
    if (isAdmin && r.cost_usd !== undefined) {
      base.Cost_USD = num(r.cost_usd)
      base.Gross_Profit_USD = num(r.gross_profit_usd)
      base.Cost_Missing_Snapshot_Lines = num(r.cost_missing_snapshot_lines)
    }
    return base
  })
}

export function returnsSheetRows(rows: Row[]): Row[] {
  return rows.map((r) => ({
    Return_Number: str(r.return_number),
    Date: str(r.date),
    Business_Date: str(r.business_date),
    Sale_Receipt_Number: str(r.sale_receipt_number),
    Party: str(r.party),
    Scope: str(r.scope),
    Type: str(r.type),
    Reason: str(r.reason),
    Status: str(r.status),
    Refund_USD: num(r.refund_usd),
    Refund_KHR: num(r.refund_khr),
    Counts_Toward_Revenue: num(r.counts_toward_revenue) ? 'Yes' : 'No',
  }))
}

export function expensesSheetRows(rows: Row[]): Row[] {
  return rows.map((r) => ({
    Date: str(r.date),
    Recorded_At: str(r.created_at),
    Type: str(r.type),
    Label: str(r.label),
    Branch: str(r.branch),
    Linked_Sale_Receipt_Number: str(r.linked_sale_receipt_number),
    Notes: str(r.notes),
    Amount_USD: num(r.amount_usd),
    Amount_KHR: num(r.amount_khr),
  }))
}

// One uniform row shape across the three logical blocks (day rows -> month
// subtotals -> grand total) so they can share a single sheet/header row --
// Row_Type distinguishes them and is filterable in Excel.
export function reconciliationSheetRows(
  days: ReconciliationDay[],
  months: MonthRollup[],
  grandTotals: ReconciliationTotals | undefined,
): Row[] {
  const rows: Row[] = days.map((d) => ({
    Row_Type: 'Day',
    Period: d.date,
    Net_Revenue_USD: num(d.net_revenue_usd),
    Expenses_USD: num(d.expenses_usd),
    Reconciliation_USD: num(d.reconciliation_usd),
  }))
  for (const m of months) {
    rows.push({
      Row_Type: 'Month subtotal',
      Period: m.month,
      Net_Revenue_USD: num(m.net_revenue_usd),
      Expenses_USD: num(m.expenses_usd),
      Reconciliation_USD: num(m.reconciliation_usd),
    })
  }
  if (grandTotals) {
    rows.push({
      Row_Type: 'Grand total',
      Period: '',
      Net_Revenue_USD: num(grandTotals.net_revenue_usd),
      Expenses_USD: num(grandTotals.expenses_usd),
      Reconciliation_USD: num(grandTotals.reconciliation_usd),
    })
  }
  return rows
}

export function definitionsSheetRows(range: BusinessWorkbookRange, isAdmin: boolean): Row[] {
  const rows: Row[] = [
    { Term: 'Range', Definition: `${range.startDate} to ${range.endDate}${range.branchId ? ' (branch-filtered)' : ' (all branches)'}` },
    { Term: 'Business day', Definition: 'A calendar day in Cambodia local time (UTC+7, fixed offset). Every date in this workbook is bucketed by that boundary, not UTC and not the viewing device\'s own timezone.' },
    { Term: 'Net revenue', Definition: 'Gross sales, minus the store discount and the membership discount, minus customer refunds -- over RECOGNIZED sales only (status not "cancelled" and not "awaiting_payment"). Tax and delivery fees are excluded from revenue. This is the same figure the Sales page header and the Dashboard show for the same range.' },
    { Term: 'Pending credit', Definition: 'The same net-sales basis as Net revenue, but for "awaiting_payment" sales -- money not yet collected, held out of Net revenue until the sale is completed.' },
    { Term: 'Collected total', Definition: 'Net revenue + tax + customer-paid delivery fees. A secondary figure -- Net revenue stays the canonical one.' },
    { Term: 'Refunds', Definition: 'Customer-scope, non-cancelled returns only. Supplier-scope returns (stock sent back to a supplier) never reduce sales revenue and are excluded here -- see the Returns sheet\'s Counts_Toward_Revenue column.' },
    { Term: 'Reconciliation', Definition: 'Net revenue minus Expenses for each business day. A day with an expense but zero sales still appears (as a negative reconciliation line), and a day with sales but no expenses still appears -- the day list is the UNION of both, not just sales days.' },
    { Term: 'Frozen header rows', Definition: 'Not supported by this export: the bundled xlsx library (SheetJS Community Edition 0.18.5) cannot write Excel freeze-pane XML. Use Excel\'s own View > Freeze Panes after opening the file if you want the header row pinned while scrolling.' },
  ]
  if (isAdmin) {
    rows.push(
      { Term: 'Cost (COGS)', Definition: 'SUM(sale_items.cost_price_usd * quantity) over recognized sold lines. cost_price_usd is a snapshot of the product\'s cost captured at the moment the sale was created -- it does not change if the product\'s cost is edited later.' },
      { Term: 'Cost_Missing_Snapshot_Lines', Definition: 'How many recognized sold lines that day/sale have NO cost_price_usd snapshot (almost always a legacy/pre-migration sale). These lines contribute 0 to Cost_USD, exactly like every other COGS figure in this app -- this column is a transparency flag only, it never changes the Cost_USD number itself.' },
      { Term: 'Gross profit / Margin %', Definition: 'Gross profit = Net revenue - Cost. Margin % = Gross profit / Net revenue * 100 (0 when Net revenue is 0). "COGS & Gross Profit" sheet is admin-only and is omitted entirely (not blanked) from a non-admin export, along with every Cost_USD/Gross_Profit_USD/Margin_Pct/Cost_Missing_Snapshot_Lines column on every other sheet.' },
    )
  } else {
    rows.push({ Term: 'COGS & Gross profit', Definition: 'Omitted from this export -- cost and profit figures are visible to admin accounts only. This is enforced by the server (the figures are never sent), not just hidden in this file.' })
  }
  return rows
}

export interface BuildBusinessWorkbookResult {
  isAdmin: boolean
  sheetCount: number
  salesRowCount: number
  returnsRowCount: number
  expensesRowCount: number
}

export async function exportBusinessWorkbook(range: BusinessWorkbookRange): Promise<BuildBusinessWorkbookResult> {
  if (!range.startDate || !range.endDate) {
    throw new Error('Select a start and end date before exporting.')
  }

  const summaryParams: Record<string, string> = { startDate: range.startDate, endDate: range.endDate }
  if (range.branchId) summaryParams.branchId = range.branchId

  const [summaryResp, saleRows, returnRows, expenseRows] = await Promise.all([
    getBusinessSummary(summaryParams) as Promise<BusinessSummaryResponse>,
    collectAllPages(getBusinessSummarySalesPage, range),
    collectAllPages(getBusinessSummaryReturnsPage, range),
    collectAllPages(getBusinessSummaryExpensesPage, range),
  ])

  // Authoritative admin flag -- see this file's header comment. Never
  // re-derived from the client's own user object.
  const isAdmin = !!summaryResp?.is_admin
  const days = summaryResp?.summary || []
  const reconciliation = summaryResp?.reconciliation || {}

  const sheets: WorkbookSheet[] = [
    { name: 'Summary', rows: summarySheetRows(days) },
    { name: 'Sales', rows: salesSheetRows(saleRows, isAdmin) },
    { name: 'Returns', rows: returnsSheetRows(returnRows) },
    { name: 'Expenses', rows: expensesSheetRows(expenseRows) },
    { name: 'Reconciliation', rows: reconciliationSheetRows(reconciliation.days || [], reconciliation.months || [], reconciliation.grand_totals) },
    { name: 'Definitions', rows: definitionsSheetRows(range, isAdmin) },
  ]
  if (isAdmin) {
    sheets.splice(5, 0, { name: 'COGS & Gross profit', rows: cogsSheetRows(days) })
  }

  const stamp = `${range.startDate}_to_${range.endDate}`
  downloadWorkbook(`business-summary-${stamp}.xlsx`, sheets)

  return {
    isAdmin,
    sheetCount: sheets.length,
    salesRowCount: saleRows.length,
    returnsRowCount: returnRows.length,
    expensesRowCount: expenseRows.length,
  }
}
