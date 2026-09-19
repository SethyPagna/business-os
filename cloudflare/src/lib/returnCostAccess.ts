type CostIdentity = { id?: unknown; sale_item_id?: unknown; product_id?: unknown; branch_id?: unknown; cost_price_usd?: unknown; cost_price_khr?: unknown; unit_cost_usd?: unknown; unit_cost_khr?: unknown }

/** Authorization is enforced by the route. Omission means retain recorded
 * economics for every role; explicit null/zero remain explicit overrides. */
export function fillOmittedReturnCosts(item: CostIdentity, rows: CostIdentity[], source: 'sale' | 'return' | 'catalog') {
  const usd = item.cost_price_usd !== undefined ? item.cost_price_usd : item.unit_cost_usd
  const khr = item.cost_price_khr !== undefined ? item.cost_price_khr : item.unit_cost_khr
  const recorded = usd === undefined || khr === undefined ? recordedReturnCosts(item, rows, source) : null
  return {
    cost_price_usd: usd === undefined ? recorded!.cost_price_usd : usd == null ? null : Number(usd),
    cost_price_khr: khr === undefined ? recorded!.cost_price_khr : khr == null ? null : Number(khr),
  }
}

/** Pick recorded costs, never client defaults. Ambiguous historical lines must
 * be selected explicitly; a missing/unknown cost remains null, never zero. */
export function recordedReturnCosts(item: CostIdentity, rows: CostIdentity[], source: 'sale' | 'return' | 'catalog') {
  let candidates: CostIdentity[]
  if (source === 'sale' && Number(item.sale_item_id) > 0) {
    candidates = rows.filter(row => Number(row.id) === Number(item.sale_item_id))
  } else if (source === 'return' && Number(item.sale_item_id) > 0) {
    candidates = rows.filter(row => Number(row.sale_item_id) === Number(item.sale_item_id))
  } else {
    candidates = rows.filter(row => Number(source === 'catalog' ? row.id : row.product_id) === Number(item.product_id))
    if (source !== 'catalog' && Number(item.branch_id) > 0) candidates = candidates.filter(row => row.branch_id == null || Number(row.branch_id) === Number(item.branch_id))
  }
  if (!candidates.length) {
    if (Number(item.product_id) > 0 || Number(item.sale_item_id) > 0) throw new Error('Recorded return cost source is unavailable. Select the original sale item or review the product.')
    return { cost_price_usd: null, cost_price_khr: null }
  }
  const money = (value: unknown): number | null => {
    if (value == null) return null
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) throw new Error('Recorded return cost requires review.')
    return number
  }
  const costs = candidates.map(row => ({ cost_price_usd: money(row.cost_price_usd), cost_price_khr: money(row.cost_price_khr) }))
  if (costs.some(cost => cost.cost_price_usd !== costs[0].cost_price_usd || cost.cost_price_khr !== costs[0].cost_price_khr)) {
    throw new Error('This product has different recorded costs. Select the original sale item before returning it.')
  }
  return costs[0]
}
