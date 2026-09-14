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
  const additional = shiftFiguresOf(shift)?.additional_cash
  return [
    { key: 'shift_registered_open', fallback: 'OPEN', usd: registered.open.usd, khr: registered.open.khr },
    ...(additional && (additional.usd || additional.khr)
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
}

/** Business results in reading order. Credit is a positive memo already inside sales/profit. */
export function shiftFigureRows(figures: ShiftFiguresShape | null | undefined): ShiftFigureRow[] {
  if (!figures) return []
  return [
    { key: 'sales', usd: figures.sales_usd },
    { key: 'cogs', usd: figures.cogs_usd },
    { key: 'profit', usd: figures.profit_usd, tone: figures.profit_usd > 0 ? 'positive' : figures.profit_usd < 0 ? 'negative' : undefined },
    { key: 'delivery_fees', usd: figures.delivery_fee_usd },
    { key: 'delivery_actual_cost', usd: figures.delivery_cost.usd, khr: figures.delivery_cost.khr },
    { key: 'shift_other_expenses', usd: figures.other_expenses.usd, khr: figures.other_expenses.khr },
    { key: 'refunds', usd: figures.refunds_usd },
    { key: 'credit_awaiting_payment', usd: Math.max(0, figures.credit_usd), hintKey: 'shift_credit_hint' },
  ]
}
