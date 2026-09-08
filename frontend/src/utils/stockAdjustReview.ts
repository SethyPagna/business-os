export type StockAdjustReviewItem = { label: string; value: string }

type TranslateWithFallback = (key: string, fallbackEn: string, fallbackKm?: string) => string

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
        label: input.tr('stock_adjust_set_total_quantity', 'Set total quantity', 'កំណត់ចំនួនសរុប'),
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
