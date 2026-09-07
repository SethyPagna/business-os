// The shift REPORT, as data.
//
// Owner ruling, Sep 6 2026: "closing shift is only a breakdown for admins in
// reports and so on for you to know ... the registration is just a more
// detailed breakdown for shift to keep track how much is spent ... and the
// actual calculations is without this ... just the COGS, profit, sales,
// expenses, delivery etc.", and "for reports of shift, you didn't mention the
// registered cash dollar and khr in open vs end. it should".
//
// The report therefore has two blocks, and this module is the ONE definition
// of what is in each and in which order. It lives in a .ts file rather than
// inside the component so the shape is executed by a test instead of being
// pattern-matched out of JSX, and so the three surfaces that print a counted
// drawer (the summary header, the cash breakdown, the report block) share one
// rule for a half-counted pair instead of three.
//
// No arithmetic happens here. Every number is the server's
// (cloudflare/src/lib/shiftReconciliation.ts); this module only says which
// number goes on which line.
import type { Shift, ShiftFigures } from '../api/shiftTransport.ts'

export type ShiftCountPairValue = { usd: number | null; khr: number | null }

/**
 * Registered cash at OPEN and at END, per currency.
 *
 * Read off the shift row, with the server's report copy preferred when it is
 * there: the four numbers are true of a list row and an old record too, so the
 * block never disappears just because a caller was not entitled to the money
 * figures.
 */
export function shiftRegisteredCash(shift: Shift): { open: ShiftCountPairValue; end: ShiftCountPairValue } {
  const figures = shift.figures
  return {
    open: {
      usd: figures?.opening.usd ?? shift.opening_float_usd ?? null,
      khr: figures?.opening.khr ?? shift.opening_float_khr ?? null,
    },
    end: {
      usd: figures?.closing.usd ?? shift.closing_counted_usd ?? null,
      khr: figures?.closing.khr ?? shift.closing_counted_khr ?? null,
    },
  }
}

/** One counted currency: a dash when nobody counted it, never a fake zero. */
export function shiftCountText(value: number | null | undefined, format: (input: unknown) => string): string {
  return value == null ? '—' : format(value)
}

/**
 * A counted PAIR as one line.
 *
 * Each currency independently: a cashier who counts the dollars and leaves the
 * riel blank recorded a real number, and printing a single "—" for the pair
 * threw it away on screen. Only a wholly uncounted drawer is one dash.
 */
export function shiftCountedPairText(
  usd: number | null | undefined,
  khr: number | null | undefined,
  fmtUSD: (input: unknown) => string,
  fmtKHR: (input: unknown) => string,
): string {
  if (usd == null && khr == null) return '—'
  return `${shiftCountText(usd, fmtUSD)} · ${shiftCountText(khr, fmtKHR)}`
}

/**
 * A money line of the report. `khr` is present only for the figures the shop
 * records natively in both currencies (the two expense halves); the sales
 * kernel's basis is dollars and inventing a riel half for it would mean
 * applying an exchange rate to a number nobody counted in riel.
 */
export type ShiftFigureRow = {
  /** The pack key for the label -- also the row's identity. */
  key: string
  usd: number
  khr?: number
  hintKey?: string
}

/**
 * The money block, in the owner's reading order: what was sold, what it cost,
 * what was made, then what went out, then the notes.
 *
 * REFUNDS ARE ONE LINE. No per-return breakdown was asked for and none is
 * built. CREDIT is last and is a note: it is an amount owed that already
 * counts inside sales and profit, so it is added to nothing and subtracted
 * from nothing here.
 */
export function shiftFigureRows(figures: ShiftFigures | null | undefined): ShiftFigureRow[] {
  if (!figures) return []
  return [
    { key: 'sales', usd: figures.sales_usd },
    { key: 'cogs', usd: figures.cogs_usd },
    { key: 'profit', usd: figures.profit_usd },
    { key: 'delivery_fees', usd: figures.delivery_fee_usd },
    { key: 'delivery_actual_cost', usd: figures.delivery_cost.usd, khr: figures.delivery_cost.khr },
    { key: 'shift_other_expenses', usd: figures.other_expenses.usd, khr: figures.other_expenses.khr },
    { key: 'refunds', usd: figures.refunds_usd },
    // Never negative: an amount owed cannot be less than nothing. The server
    // floors it too; this is the same rule stated where it is rendered, so a
    // stale cached payload cannot print negative money owed either.
    { key: 'credit_awaiting_payment', usd: Math.max(0, figures.credit_usd), hintKey: 'shift_credit_hint' },
  ]
}
