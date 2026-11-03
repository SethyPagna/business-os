import { isAcquisitionCostKey, projectAcquisitionCosts } from '../../../cloudflare/src/lib/acquisitionCostAccess.ts'

/**
 * e2e/support/costRedaction.ts -- the Worker's own cost rules, loaded rather than copied.
 *
 *   projectAcquisitionCosts(value, user)  what the Worker does to a JSON payload for an account without
 *                                         product_cost_view (cloudflare/src/lib/acquisitionCostAccess.ts)
 *   isAcquisitionCostKey(key)             which keys that function treats as acquisition cost
 *
 * The fixture server serves one set of admin-shaped bodies to everybody, so the app tier has no server that redacts. The
 * role-matrix spec layers `projectAcquisitionCosts` over the fixture's GET bodies with page.route(), which makes the bodies the
 * browser receives the ones the real Worker would send to that role. That is what lets "no cost key in any response body"
 * be a claim about the app (does it ever ask for, or receive, a cost-bearing shape?) instead of a claim about the fixture.
 * It does NOT prove the Worker itself redacts every route; that is the system-tier lane's job.
 */
export { projectAcquisitionCosts }

/** JSON paths (`$.items[0].cost_price_usd`) of every key the Worker classes as acquisition cost. */
export function costKeysIn(value: unknown, path = '$', out: string[] = [], depth = 0): string[] {
  if (depth > 40 || value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach((item, index) => costKeysIn(item, `${path}[${index}]`, out, depth + 1))
    return out
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isAcquisitionCostKey(key)) out.push(`${path}.${key}`)
    costKeysIn(child, `${path}.${key}`, out, depth + 1)
  }
  return out
}
