export type StockAdjustReviewItem = { label: string; value: string }

type TranslateWithFallback = (key: string, fallbackEn: string, fallbackKm?: string) => string

/** ISO 'YYYY-MM-DD' -> 'DD/MM/YYYY' for review display; anything else passes
 * through untouched (string surgery only, matches utils/dateEntry.ts's own
 * isoToDisplayDate -- kept as a tiny local copy so this pure review module
 * has no dependency on the field's own implementation file). */
function displayIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso
}

function displayQuantity(value: unknown): string {
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : '0'
}

function signedQuantity(value: number): string {
  if (value > 0) return `+${displayQuantity(value)}`
  if (value < 0) return `−${displayQuantity(Math.abs(value))}`
  return '0'
}

/** Human review rows only. The request sent to inventory stays separate. */
export function buildStockAdjustQuantityReview(input: {
  type: unknown
  quantity: unknown
  beforeQuantity: unknown
  /** Scoped Set: 'lot' (beforeQuantity is the received date's) or 'branch'. Omitted = legacy total. */
  setScope?: unknown
  unit: unknown
  tr: TranslateWithFallback
}): StockAdjustReviewItem[] {
  const action = input.type === 'remove' || input.type === 'set' ? input.type : 'add'
  const quantity = Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : 0
  const before = Number.isFinite(Number(input.beforeQuantity)) ? Number(input.beforeQuantity) : 0
  const unit = String(input.unit || input.tr('unit', 'unit', 'ឯកតា')).trim()
  const withUnit = (value: string) => `${value} ${unit}`

  if (action === 'remove') {
    return [{
      label: input.tr('stock_adjust_remove_quantity', 'Remove quantity', 'ដកចំនួន'),
      value: withUnit(`−${displayQuantity(Math.abs(quantity))}`),
    }]
  }
  if (action === 'set') {
    return [
      {
        label: input.setScope === 'lot'
          ? input.tr('stock_adjust_set_lot_quantity', 'Set received-date quantity', 'កំណត់ចំនួនតាមថ្ងៃចូល')
          : input.tr('stock_adjust_set_total_quantity', 'Set total quantity', 'កំណត់ចំនួនសរុប'),
        value: `${withUnit(displayQuantity(before))} → ${withUnit(displayQuantity(quantity))}`,
      },
      {
        label: input.tr('stock_adjust_difference', 'Difference', 'ភាពខុសគ្នា'),
        value: withUnit(signedQuantity(quantity - before)),
      },
    ]
  }
  return [{
    label: input.tr('stock_adjust_add_quantity', 'Add quantity', 'បន្ថែមចំនួន'),
    value: withUnit(`+${displayQuantity(Math.abs(quantity))}`),
  }]
}

// P10-19: the confirm step is the LAST thing the operator sees before a
// receipt commits, and it used to say nothing about Payment/Due date at all
// -- on the Inventory page's own adjust flow it used to be a bare native
// "Add this quantity to stock?" with no values whatsoever (not even the
// quantity). A typed "Not Yet Paid" due date that never gets reflected back
// here is indistinguishable, to the person who typed it, from a due date
// that "isn't working": they have no way to see it was recorded before they
// commit. This is the one place all three receipt surfaces (Inventory.tsx,
// StockAdjustModal.tsx, ReceiveBatchModal.tsx) build that row from, so the
// three can never show it differently again.
export function buildStockReceiptPaymentReview(input: {
  /** Whether this submission is a receipt at all -- a remove or a set-down
   * carries no payment fact even though the form's payment_status still
   * defaults to 'paid' underneath, so this must gate the row, not the
   * caller remembering to omit it. */
  isStockIn: boolean
  // unknown, not string: callers hand these straight through from a wire
  // payload (Record<string, unknown>) or a form field, and re-deriving a
  // narrower type at every call site is exactly the second copy of this
  // rule that lets the surfaces drift.
  paymentStatus?: unknown
  creditDueDate?: unknown
  tr: TranslateWithFallback
}): StockAdjustReviewItem[] {
  if (!input.isStockIn) return []
  const status = input.paymentStatus === 'credit' || input.paymentStatus === 'paid' ? input.paymentStatus : ''
  if (!status) return []
  const due = String(input.creditDueDate ?? '').trim()
  const value = status === 'credit'
    ? `${input.tr('on_credit', 'Not Yet Paid', 'មិនទាន់បង់')}${due ? ` · ${displayIsoDate(due)}` : ''}`
    : input.tr('paid', 'Paid', 'បានបង់')
  return [{ label: input.tr('payment', 'Payment', 'ការទូទាត់'), value }]
}
