/** What one planned line is sent with, stored before the write so a repeat is identical: the received date it lands on and the two figures the writer computes its target from. */
export type Plan = { lot: number; scope: 'lot' | 'branch'; counted: number; seen: number; was?: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const validPlan = (value: unknown): value is Plan => {
  const plan = value as Plan | null
  return !!plan && typeof plan === 'object' && finite(plan.lot) && (plan.scope === 'lot' || plan.scope === 'branch') && finite(plan.counted) && finite(plan.seen)
}
/** The planned lines of a claim: unit key -> plan. An entry that is not a whole plan is skipped, as everywhere the plan is read. */
export function plansOf(json: string): Record<string, Plan> {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, plan]) => validPlan(plan))) as Record<string, Plan>
  } catch { return {} }
}
/** The part-applied lines of products that have several: unit key -> what landed. */
export function appliedUnits<Entry>(json: string): Record<string, Entry> {
  try {
    const units = (JSON.parse(json) as { units?: unknown }).units
    return units && typeof units === 'object' && !Array.isArray(units) ? units as Record<string, Entry> : {}
  } catch { return {} }
}
/** The product of a unit key: "<product id>" for a product with a single line, "<product id>:<batch id>" for one with several. */
export const productOf = (unitKey: string): number => Number.parseInt(unitKey, 10)

/**
 * The products a claim holds: planned (a valid plan under a key of plan_json) or part-written (a key of applied_json.units). The Worker refuses a decision on exactly these lines
 * (inventory_check_line_in_progress), and the projection's planned_lines names exactly these, so the panel offers a decision on the lines the Worker accepts one on.
 */
export function productsInFlight(planJson: string | null | undefined, appliedJson: string): number[] {
  const keys = [...Object.keys(plansOf(planJson ?? '{}')), ...Object.keys(appliedUnits(appliedJson))]
  return [...new Set(keys.map(productOf).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)
}
