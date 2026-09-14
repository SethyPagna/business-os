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
    { key: 'rpt_removal_loss', usd: figures.removal_loss_usd, hintKey: 'rpt_hint_removal_loss' },
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
