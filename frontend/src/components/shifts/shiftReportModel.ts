import type { Shift, ShiftAmendment } from '../../api/shiftTransport.ts'
import { holdsCostViewGrant } from '../../utils/acquisitionCostAccess.ts'
import { isAdminControlUser, type PermissionUser } from '../../utils/permissions.ts'

function jsonRecord(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

/**
 * The standing "closed late" review of one shift, from the history rows the screen already holds: the newest journal
 * row that evaluated the times names who closed it late and why. `at` is when the late close itself happened: the
 * entry's own time when it carries one, else the first row of the unbroken run of rows that carry the entry (the
 * Worker copies the entry into every later administrator time edit, so the newest row would show the edit's time).
 * The ONE reader of the closed_late entry: the shift card, the Shifts popup and the Reports shift report all go through it.
 */
export function lateCloseReview(rows: ShiftAmendment[]): { by: string; reason: string; at: string } | null {
  type Entry = { code?: unknown; by?: unknown; reason?: unknown; at?: unknown }
  const reviewed = rows.filter((row) => Array.isArray(jsonRecord(row.after_json).time_review)).sort((a, b) => b.id - a.id)
  const lateEntry = (row: ShiftAmendment) => (jsonRecord(row.after_json).time_review as Entry[]).find((item) => item?.code === 'closed_late')
  const entry = reviewed[0] ? lateEntry(reviewed[0]) : undefined
  if (!entry) return null
  let first = reviewed[0]
  for (const row of reviewed) { if (!lateEntry(row)) break; first = row }
  const own = lateEntry(first) ?? entry
  return {
    by: typeof entry.by === 'string' ? entry.by : '',
    reason: typeof entry.reason === 'string' ? entry.reason : '',
    at: typeof own.at === 'string' && own.at ? own.at : first.created_at || '',
  }
}

/** Is this registered row the END row of a shift closed late with no count? The one test every surface asks. */
export function shiftRowNotCounted(row: Pick<ShiftRegisteredRow, 'key'>, shift: Shift, closedLate: boolean): boolean {
  return row.key === 'shift_registered_end' && shiftNotCounted(shift, closedLate)
}

/** Is this breakdown row the closing count of a shift closed late with no count? Same rule as the END row, asked of the breakdown. */
export function shiftComparisonRowNotCounted(row: { key: string }, shift: Shift, closedLate: boolean): boolean {
  return row.key === 'shift_recon_counted' && shiftNotCounted(shift, closedLate)
}

/** True when a shift closed late has no closing count in either currency: it says "Not counted (closed late)", not a bare dash. */
export function shiftNotCounted(shift: Shift, closedLate: boolean): boolean {
  const end = shiftRegisteredCash(shift).end
  return closedLate && !!shift.closed_at && end.usd == null && end.khr == null
}

/** Server-authorized comparison values, without recalculating any money. */
export function shiftComparisonRows(shift: Pick<Shift, 'reconciliation'>): Array<{ key: string; usd: number | null; khr: number | null }> {
  const comparison = shift.reconciliation
  if (!comparison) return []
  return [
    { key: 'shift_recon_opening', ...comparison.opening },
    { key: 'shift_recon_additional_cash', usd: comparison.additional_cash?.usd ?? 0, khr: comparison.additional_cash?.khr ?? 0 },
    { key: 'shift_recon_cash_sales', ...comparison.cash_sales },
    { key: 'refunds', usd: -comparison.refunds.usd, khr: -comparison.refunds.khr },
    { key: 'fees', usd: -comparison.expenses.usd, khr: -comparison.expenses.khr },
    { key: 'courier', usd: -comparison.courier.usd, khr: -comparison.courier.khr },
    { key: 'shift_recon_expected', ...comparison.expected },
    { key: 'shift_recon_counted', ...comparison.counted },
    { key: 'shift_difference', ...comparison.difference },
  ]
}

/**
 * N4: the badge over a CLOSED shift's cash breakdown -- whether it shows the
 * figures stored at the close or a recomputation (a shift closed before the
 * figures were stored). Null on an open shift (it has no close to store) and
 * when the server did not say.
 */
export function shiftDrawerSourceBadge(shift: Pick<Shift, 'reconciliation' | 'reconciliation_source' | 'closed_at'>):
  { key: string; fallback: string; hintKey: string; source: 'stored' | 'computed' } | null {
  if (!shift.reconciliation || !shift.closed_at) return null
  if (shift.reconciliation_source === 'stored') return { key: 'shift_figures_stored', fallback: 'Stored at close', hintKey: 'shift_figures_stored_hint', source: 'stored' }
  if (shift.reconciliation_source === 'computed') return { key: 'shift_figures_computed', fallback: 'Computed', hintKey: 'shift_figures_computed_hint', source: 'computed' }
  return null
}

const DRIFT_COMPONENT_LABELS: Record<string, string> = {
  opening: 'shift_recon_opening',
  additional_cash: 'shift_recon_additional_cash',
  cash_sales: 'shift_recon_cash_sales',
  refunds: 'refunds',
  expenses: 'fees',
  courier: 'courier',
  expected: 'shift_recon_expected',
  counted: 'shift_recon_counted',
  other_tenders: 'shift_recon_other_tenders',
}
type DriftPair = { usd: number | null; khr: number | null }
export type ShiftDriftSaleView = {
  saleId: number
  receipt: string
  change: 'added' | 'removed' | 'changed'
  cancelled: boolean
  cash: { before: DriftPair | null; after: DriftPair | null }
  other: { before: DriftPair | null; after: DriftPair | null }
}
export type ShiftDriftView = {
  components: Array<{ key: string; labelKey: string; stored: DriftPair; current: DriftPair }>
  sales: ShiftDriftSaleView[]
  /** Drifted sales the server did not name (it names at most 20). */
  more: number
  salesUnavailable: boolean
}

/**
 * N4: the "changed after close" block, in display order, or null when nothing
 * moved. Shown BESIDE the stored breakdown, never instead of it: the drawer a
 * shift closed on does not change, and what changed since is listed here with
 * the sale it came from.
 */
export function shiftCloseDriftView(shift: Pick<Shift, 'close_drift' | 'reconciliation_source'>): ShiftDriftView | null {
  const drift = shift.close_drift
  if (!drift || shift.reconciliation_source !== 'stored') return null
  const pair = (values: [number, number, number, number] | null, offset: 0 | 2): DriftPair | null =>
    values ? { usd: values[offset], khr: values[offset + 1] } : null
  const components = drift.components
    .filter((component) => DRIFT_COMPONENT_LABELS[component.key])
    .map((component) => ({ key: component.key, labelKey: DRIFT_COMPONENT_LABELS[component.key], stored: component.stored, current: component.current }))
  const sales = drift.sales.map((sale) => ({
    saleId: sale.sale_id,
    receipt: sale.receipt_number || `#${sale.sale_id}`,
    change: sale.change,
    cancelled: sale.sale_status === 'cancelled',
    cash: { before: pair(sale.before, 0), after: pair(sale.after, 0) },
    other: { before: pair(sale.before, 2), after: pair(sale.after, 2) },
  }))
  if (!components.length && !sales.length && !drift.sales_unavailable) return null
  return { components, sales, more: Math.max(0, (drift.sales_total || 0) - sales.length), salesUnavailable: !!drift.sales_unavailable }
}

/** The export rows for the same block: today's value per moved line, and each sale's cash movement. */
export function shiftCloseDriftRows(shift: Pick<Shift, 'close_drift' | 'reconciliation_source'>): Array<{ labelKey: string; label?: string; usd: number | null; khr: number | null }> {
  const view = shiftCloseDriftView(shift)
  if (!view) return []
  const delta = (sale: ShiftDriftSaleView, currency: 'usd' | 'khr') =>
    Math.round(((sale.cash.after?.[currency] ?? 0) - (sale.cash.before?.[currency] ?? 0)) * 100) / 100
  return [
    ...view.components.map((component) => ({ labelKey: component.labelKey, usd: component.current.usd, khr: component.current.khr })),
    ...view.sales.map((sale) => ({ labelKey: 'shift_recon_cash_sales', label: sale.receipt, usd: delta(sale, 'usd'), khr: delta(sale, 'khr') })),
  ]
}

export type ShiftCountPairValue = { usd: number | null; khr: number | null }

export type ShiftFiguresShape = {
  opening: ShiftCountPairValue
  additional_cash?: { usd: number; khr: number }
  closing: ShiftCountPairValue
  sales_usd: number
  /** Absent (with profit and the removal-loss block) for a reader without View product costs. */
  cogs_usd?: number
  profit_usd?: number
  /** Owner, 20 Oct 2026: sales and profit without Not Paid sales. Optional: an older Worker sends none. */
  sales_without_not_paid_usd?: number
  profit_without_not_paid_usd?: number
  delivery_fee_usd: number
  /** What Not Paid sales still owe (owner, 21 Oct 2026). */
  credit_usd: number
  refunds_usd: number
  delivery_cost: { usd: number; khr: number }
  other_expenses: { usd: number; khr: number }
  /**
   * Stock removed entirely during the shift, priced at cost, plus the same
   * window's revenue and profit with it taken off (owner, Sep 14 2026: "also
   * add one row below unpaid in reports as well"). Optional: an older Worker,
   * or a window the kernel could not scope to stock movements, sends none and
   * the rows are omitted rather than printed as $0.00.
   */
  removal_loss_usd?: number
  revenue_after_losses_usd?: number
  profit_after_losses_usd?: number
  /** Of the rows above, how many carried no cost anywhere -- the loss is
   *  understated by whatever they were worth (p5/losses, Sep 15 2026, owner:
   *  "i see the report says row removed has 1 no cost price. this is
   *  impossible find issue and fix"). Never dropped silently. */
  removal_loss_unvalued_rows?: number
}

type ShiftWithFigures = Shift & { figures?: ShiftFiguresShape | null }

/** Registered drawer amounts are report-only and never enter business results. */
export function shiftRegisteredCash(shift: Shift): { open: ShiftCountPairValue; end: ShiftCountPairValue } {
  const figures = (shift as ShiftWithFigures).figures
  return {
    open: {
      usd: figures?.opening.usd ?? shift.opening_float_usd ?? null,
      khr: figures?.opening.khr ?? shift.opening_float_khr ?? null,
    },
    end: {
      usd: figures ? figures.closing.usd : shift.closing_counted_usd ?? null,
      khr: figures ? figures.closing.khr : shift.closing_counted_khr ?? null,
    },
  }
}

export function shiftFiguresOf(shift: Shift): ShiftFiguresShape | null {
  return (shift as ShiftWithFigures).figures ?? null
}

const SHIFT_FIGURE_COST_KEYS = [
  'cogs_usd', 'profit_usd', 'profit_without_not_paid_usd', 'cost_missing_snapshot_lines',
  'removal_loss_usd', 'revenue_after_losses_usd', 'profit_after_losses_usd', 'removal_loss_unvalued_rows',
] as const

/**
 * What one viewer may see of a shift answer, through ONE rule for every shift screen (the card, the detail, the POS close summary, the Reports shift report and
 * its print and CSV). Owner, A71 + Q4: employees see nothing new of shift results, and profit follows "View product costs".
 *   - The Business results block and the cash comparison (with what changed after close) are the administrator's, as the Worker sends them
 *     (routes/shifts.ts canManageShifts); everyone else keeps only the registered counts on the row, their own drawer.
 *   - Inside the block, COGS, profit and the removal-loss figures stay only for a holder of the View product costs grant (cloudflare/src/lib/shiftReconciliation.ts
 *     SHIFT_FIGURE_COST_KEYS): absent, never zero.
 * Pure; the received shift is returned itself when nothing is removed, and never mutated.
 */
export function shiftFiguresForViewer<T extends Shift | null | undefined>(shift: T, user: PermissionUser): T {
  if (!shift) return shift
  if (!isAdminControlUser(user)) return { ...shift, reconciliation: null, figures: null, close_drift: null }
  const figures = (shift as ShiftWithFigures).figures
  if (!figures || holdsCostViewGrant(user)) return shift
  return { ...shift, figures: shiftFiguresWithoutCosts(figures) }
}

/** The figures with the cost keys ABSENT (a screen cannot tell 0 from hidden), the mirror of the Worker's gateShiftFiguresCosts. */
export function shiftFiguresWithoutCosts(figures: ShiftFiguresShape): ShiftFiguresShape {
  const kept: Record<string, unknown> = { ...figures }
  for (const key of SHIFT_FIGURE_COST_KEYS) delete kept[key]
  return kept as ShiftFiguresShape
}

export type ShiftRegisteredRow = { key: string; fallback: string; usd: number | null; khr: number | null; added?: true }

/**
 * The extra change put into the drawer during a shift -- the ONE source of that
 * figure for every surface that prints it: the report figures block, the Reports
 * CSV/print export and the POS summary after a close.
 *
 * ALWAYS a figure, zero when nothing was added (owner, 13 Oct 2026, item 14:
 * Opening -> Additional change used -> Closing are shown everywhere, always,
 * $0 included), because a surface that skips a missing figure leaves Opening and
 * Closing with the middle line missing. None added is a fact, not an
 * unknown: the column is NOT NULL DEFAULT 0 (migration 0147), so a row that does
 * not carry it is a response from before the field existed, and the Worker's
 * Telegram report reads that the same way (`?? 0`). The opening and closing
 * counts are different: an uncounted drawer stays unknown (`—`).
 *
 * Reads the admin `figures` when the response carries them and the shift row
 * otherwise: a cashier's close response has no figures block (admin only) but
 * does carry the amount they just typed.
 */
export function shiftAdditionalCash(shift: Shift): { usd: number; khr: number } {
  const figures = shiftFiguresOf(shift)?.additional_cash
  return { usd: figures?.usd ?? shift.additional_cash_usd ?? 0, khr: figures?.khr ?? shift.additional_cash_khr ?? 0 }
}

/**
 * The expected drawer to SHOW before a close is written, when the cashier has
 * typed an additional the server has not recorded yet.
 *
 * The reconciliation formula is not reproduced here. It lives once, on the
 * server (cloudflare/src/lib/shiftReconciliation.ts: opening + additional +
 * cash sales - refunds - expenses - courier), and this adjusts the ONE term
 * that the open form can still change: expected - recorded additional + typed
 * additional. Every other component stays the server's.
 *
 * A currency the shift never registered comes back null (unknown stays
 * unknown, it does not become a number), and a blank field adds nothing.
 */
export function shiftExpectedWithTypedAdditional(
  reconciliation: { expected: ShiftCountPairValue; additional_cash?: { usd: number; khr: number } } | null | undefined,
  typed: ShiftCountPairValue,
): ShiftCountPairValue {
  const adjust = (currency: 'usd' | 'khr'): number | null => {
    const expected = reconciliation?.expected?.[currency] ?? null
    if (expected == null) return null
    const recorded = reconciliation?.additional_cash?.[currency] ?? 0
    return Math.round((expected - recorded + (typed[currency] ?? 0)) * 100) / 100
  }
  return { usd: adjust('usd'), khr: adjust('khr') }
}

/**
 * The registration block in the owner's reading order: the change float the
 * drawer opened with, the extra change put in mid-shift when that float ran
 * out, then what was left at the end. One order for every surface that prints
 * it (the report figures, the Reports CSV/print export), so the app cannot
 * show the additional after the closing count on one screen and before it on
 * another. Report-only, like every figure here.
 *
 * All three rows are ALWAYS there (owner, 13 Oct 2026, item 14), the additional
 * included when nothing was added: `0៛ · $0.00` (riel first; riel alone on a shift with no dollar), the same line the Telegram shift
 * report prints. `added` -- the (+) of an inflow -- is set only for an amount,
 * so a shift that needed no more change reads "0៛ · $0.00" and not "+ 0៛ · $0.00".
 */
export function shiftRegisteredRows(shift: Shift): ShiftRegisteredRow[] {
  const registered = shiftRegisteredCash(shift)
  const additional = shiftAdditionalCash(shift)
  return [
    { key: 'shift_registered_open', fallback: 'OPEN', usd: registered.open.usd, khr: registered.open.khr },
    {
      key: 'shift_recon_additional_cash', fallback: 'Added cash', usd: additional.usd, khr: additional.khr,
      ...(additional.usd || additional.khr ? { added: true as const } : {}),
    },
    { key: 'shift_registered_end', fallback: 'END', usd: registered.end.usd, khr: registered.end.khr },
  ]
}

/** An uncounted currency stays unknown instead of being printed as zero. */
export function shiftCountText(value: number | null | undefined, format: (input: unknown) => string): string {
  return value == null ? '—' : format(value)
}

const isDollar = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value !== 0

/**
 * Does this shift hold any dollar figure? Owner, A72 + Q3 (A78): riel is the shop's money, dollars appear on a shift's pair rows only when the SHIFT has any,
 * and then on every pair row (per shift, not per line: the rows keep their columns, and a missing dollar half never reads as "not counted").
 * Non-zero and not null, in the registered counts (opening, added cash, closing) and in every dollar half of what the answer carries: the cash comparison, the
 * delivery cost and other expenses of the figures, and what moved after close. An employee's answer carries only the counts, so an administrator may see the
 * dollar half where an employee does not: that employee has no dollar figure on screen. Business results are not cash and never decide it.
 * The Telegram twin is cloudflare/src/lib/telegram.ts shiftHasUsdCash.
 */
export function shiftHasUsd(shift: Shift): boolean {
  const registered = shiftRegisteredCash(shift)
  const additional = shiftAdditionalCash(shift)
  if ([registered.open.usd, additional.usd, registered.end.usd, shift.opening_float_usd, shift.additional_cash_usd, shift.closing_counted_usd].some(isDollar)) return true
  const reconciliation = shift.reconciliation
  if (reconciliation && [reconciliation.opening, reconciliation.additional_cash, reconciliation.cash_sales, reconciliation.refunds, reconciliation.expenses,
    reconciliation.courier, reconciliation.expected, reconciliation.counted, reconciliation.difference].some((pair) => isDollar(pair?.usd))) return true
  const figures = shiftFiguresOf(shift)
  if (figures && [figures.delivery_cost?.usd, figures.other_expenses?.usd].some(isDollar)) return true
  const drift = shift.close_drift
  if (drift) {
    if (drift.components.some((component) => isDollar(component.stored?.usd) || isDollar(component.current?.usd))) return true
    // A sale's [cash USD, cash KHR, other USD, other KHR] at the close and now.
    if (drift.sales.some((sale) => [sale.before, sale.after].some((values) => values && (isDollar(values[0]) || isDollar(values[2]))))) return true
  }
  return false
}

/**
 * One money pair on a shift surface: riel first, then dollars only when the shift has any (shiftHasUsd). An uncounted half is a dash, a wholly uncounted
 * pair is one dash. The ONE text for every shift surface that prints a pair (card, detail, breakdown, drift note, close summary), so no two disagree on order.
 */
export function shiftMoneyText(
  pair: { usd: number | null | undefined; khr: number | null | undefined },
  showUsd: boolean,
  fmtUSD: (input: unknown) => string,
  fmtKHR: (input: unknown) => string,
): string {
  if (pair.usd == null && pair.khr == null) return '—'
  const riel = shiftCountText(pair.khr, fmtKHR)
  return showUsd ? `${riel} · ${shiftCountText(pair.usd, fmtUSD)}` : riel
}

/** Typed (not yet saved) count text, as the close form holds it: does any of it name a dollar amount? Lets the form show the dollar half once one is typed. */
export function shiftTypedHasUsd(...typed: string[]): boolean {
  return typed.some((text) => text.trim() !== '' && isDollar(Number(text)))
}

/** The two money cells of one export row: KHR first, then USD (blank when the shift has no dollar, never a "0"). */
export function shiftMoneyColumns(pair: { usd: number | null | undefined; khr: number | null | undefined }, showUsd: boolean): { KHR: number | string; USD: number | string } {
  return { KHR: pair.khr ?? '', USD: showUsd ? pair.usd ?? '' : '' }
}

export type ShiftExportRow = { Section: string; Line: string; KHR: number | string; USD: number | string }

/**
 * The Reports print and CSV table: columns Section, Line, KHR, USD, the USD column left out when none of its cells holds a figure (a riel-only shift with no
 * business results). Business results are dollars and bring the column with them, with a blank dollar cell on the pair rows of a riel-only shift.
 */
export function shiftExportRows(rows: ShiftExportRow[]): { headers: string[]; rows: Array<Record<string, number | string>> } {
  const withUsd = rows.some((row) => row.USD !== '' && row.USD != null)
  return {
    headers: withUsd ? ['Section', 'Line', 'KHR', 'USD'] : ['Section', 'Line', 'KHR'],
    rows: rows.map((row): Record<string, number | string> => (withUsd ? { Section: row.Section, Line: row.Line, KHR: row.KHR, USD: row.USD } : { Section: row.Section, Line: row.Line, KHR: row.KHR })),
  }
}

export type ShiftFigureRow = {
  key: string
  usd: number
  khr?: number
  hintKey?: string
  tone?: 'positive' | 'negative'
  /** Set only on the removal-loss row when some of its rows had no
   *  recorded cost -- rendered as a count, never silently dropped. */
  unvaluedCount?: number
}

/** Business results in reading order. Still owed is a positive memo, subtracted from nothing. */
export function shiftFigureRows(figures: ShiftFiguresShape | null | undefined): ShiftFigureRow[] {
  if (!figures) return []
  // Stock removed entirely, at cost -- the owner's "one row below unpaid"
  // (Sep 14 2026), with the two after-losses figures beside it. Like credit it
  // is a POSITIVE amount and is never subtracted from sales/profit above:
  // those stay the canonical figures and these say what the same shift looks
  // like including the loss. Rendered only when the server sent the block.
  const losses: ShiftFigureRow[] = typeof figures.removal_loss_usd !== 'number' ? [] : [
    {
      key: 'rpt_removal_loss', usd: figures.removal_loss_usd, hintKey: 'rpt_hint_removal_loss',
      ...(figures.removal_loss_unvalued_rows ? { unvaluedCount: figures.removal_loss_unvalued_rows } : {}),
    },
    { key: 'rpt_revenue_after_losses', usd: figures.revenue_after_losses_usd ?? 0 },
    ...(typeof figures.profit_after_losses_usd === 'number' ? [{
      key: 'rpt_profit_after_losses',
      usd: figures.profit_after_losses_usd,
      // Unclamped on purpose: a shift that destroyed more than it earned is
      // exactly the case the owner asked to be able to see.
      tone: (figures.profit_after_losses_usd > 0 ? 'positive' : figures.profit_after_losses_usd < 0 ? 'negative' : undefined) as ShiftFigureRow['tone'],
    }] : []),
  ]
  // The paid-only pair prints only when Not Paid sales moved the figure.
  const paidOnly = typeof figures.sales_without_not_paid_usd === 'number' && figures.sales_without_not_paid_usd !== figures.sales_usd
  return [
    { key: 'sales', usd: figures.sales_usd },
    ...(paidOnly ? [{ key: 'revenue_paid_only', usd: figures.sales_without_not_paid_usd as number, hintKey: 'rpt_hint_revenue_paid_only' }] : []),
    ...(typeof figures.cogs_usd === 'number' ? [{ key: 'cogs', usd: figures.cogs_usd }] : []),
    ...(typeof figures.profit_usd === 'number' ? [{ key: 'profit', usd: figures.profit_usd, tone: (figures.profit_usd > 0 ? 'positive' : figures.profit_usd < 0 ? 'negative' : undefined) as ShiftFigureRow['tone'] }] : []),
    ...(paidOnly && typeof figures.profit_without_not_paid_usd === 'number' ? [{ key: 'profit_paid_only', usd: figures.profit_without_not_paid_usd }] : []),
    { key: 'delivery_fees', usd: figures.delivery_fee_usd },
    { key: 'delivery_actual_cost', usd: figures.delivery_cost.usd, khr: figures.delivery_cost.khr },
    { key: 'shift_other_expenses', usd: figures.other_expenses.usd, khr: figures.other_expenses.khr },
    { key: 'refunds', usd: figures.refunds_usd },
    { key: 'not_paid_owed', usd: Math.max(0, figures.credit_usd), hintKey: 'shift_credit_hint' },
    ...losses,
  ]
}
