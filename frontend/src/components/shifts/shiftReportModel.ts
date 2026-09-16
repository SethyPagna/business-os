import type { Shift } from '../../api/shiftTransport.ts'

export type ShiftCountPairValue = { usd: number | null; khr: number | null }

export type ShiftFiguresShape = {
  opening: ShiftCountPairValue
  additional_cash?: { usd: number; khr: number }
  closing: ShiftCountPairValue
  sales_usd: number
  cogs_usd: number
  profit_usd: number
  delivery_fee_usd: number
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

export type ShiftRegisteredRow = { key: string; fallback: string; usd: number | null; khr: number | null; added?: true }

/**
 * The extra change actually put into the drawer during a shift, or NULL when
 * none was -- the ONE rule for "was there a top-up".
 *
 * Every surface that prints this figure must agree on when the line exists:
 * the report figures block, the Reports CSV/print export and the POS close
 * summary strip. The strip used to print `?? 0` unconditionally, so a shift
 * that never needed more change showed "+ $0.00 · 0៛" on the till while the
 * report beside it showed no such row at all.
 *
 * Reads the admin `figures` when the response carries them and the shift row
 * otherwise: a cashier's close response has no figures block (admin only) but
 * does carry the amount they just typed.
 */
export function shiftAdditionalCash(shift: Shift): { usd: number; khr: number } | null {
  const figures = shiftFiguresOf(shift)?.additional_cash
  const usd = figures?.usd ?? shift.additional_cash_usd ?? 0
  const khr = figures?.khr ?? shift.additional_cash_khr ?? 0
  return usd || khr ? { usd, khr } : null
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
 * The additional row appears only when some was actually added: a shift that
 * never needed more change has nothing to say on that line.
 */
export function shiftRegisteredRows(shift: Shift): ShiftRegisteredRow[] {
  const registered = shiftRegisteredCash(shift)
  const additional = shiftAdditionalCash(shift)
  return [
    { key: 'shift_registered_open', fallback: 'OPEN', usd: registered.open.usd, khr: registered.open.khr },
    ...(additional
      ? [{ key: 'shift_recon_additional_cash', fallback: 'Additional change used', usd: additional.usd, khr: additional.khr, added: true as const }]
      : []),
    { key: 'shift_registered_end', fallback: 'END', usd: registered.end.usd, khr: registered.end.khr },
  ]
}

/** An uncounted currency stays unknown instead of being printed as zero. */
export function shiftCountText(value: number | null | undefined, format: (input: unknown) => string): string {
  return value == null ? '—' : format(value)
}

export function shiftCountedPairText(
  usd: number | null | undefined,
  khr: number | null | undefined,
  fmtUSD: (input: unknown) => string,
  fmtKHR: (input: unknown) => string,
): string {
  if (usd == null && khr == null) return '—'
  return `${shiftCountText(usd, fmtUSD)} · ${shiftCountText(khr, fmtKHR)}`
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

/** Business results in reading order. Credit is a positive memo already inside sales/profit. */
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
  return [
    { key: 'sales', usd: figures.sales_usd },
    { key: 'cogs', usd: figures.cogs_usd },
    { key: 'profit', usd: figures.profit_usd, tone: figures.profit_usd > 0 ? 'positive' : figures.profit_usd < 0 ? 'negative' : undefined },
    { key: 'delivery_fees', usd: figures.delivery_fee_usd },
    { key: 'delivery_actual_cost', usd: figures.delivery_cost.usd, khr: figures.delivery_cost.khr },
    { key: 'shift_other_expenses', usd: figures.other_expenses.usd, khr: figures.other_expenses.khr },
    { key: 'refunds', usd: figures.refunds_usd },
    { key: 'credit_awaiting_payment', usd: Math.max(0, figures.credit_usd), hintKey: 'shift_credit_hint' },
    ...losses,
  ]
}
