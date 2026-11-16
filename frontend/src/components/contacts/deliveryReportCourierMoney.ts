// The delivery-contact report omits the courier's actual cost and the delivery margin (delivery fee charged minus that
// cost) for an account without sales:view_courier_cost. A missing figure is not a zero: the screen hides the line
// instead of printing "$0.00" next to a cost it cannot show. The margin is courier money (the courier grant), never
// product money (admin only), so it has its own key, delivery_margin_usd.
export interface CourierMoneyFields {
  actual_cost_usd?: number | null
  actual_cost_count?: number | null
  delivery_margin_usd?: number | null
}

export function showsCourierCost(row: CourierMoneyFields): boolean {
  return typeof row.actual_cost_usd === 'number'
}

export function showsDeliveryProfit(row: CourierMoneyFields): boolean {
  return typeof row.delivery_margin_usd === 'number'
}

export function deliveryProfitIsLoss(row: CourierMoneyFields): boolean {
  return showsDeliveryProfit(row) && (row.delivery_margin_usd as number) < 0
}
