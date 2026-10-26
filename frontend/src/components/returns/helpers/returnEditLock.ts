// Why the Edit Return form cannot edit this return, or null when it can. Mirrors the Worker's PUT /api/returns/:id refusals
// (routes/returns.ts) so the form never offers an edit that is certain to be refused:
//   exact_return                -- the return itself is v1 (customer_return_edit_v1_not_supported).
//   legacy_return_on_exact_sale -- a v0 return row on a v1 sale (money_precision_review_needed): the legacy edit path would
//                                  restate exact money as legacy money. GET /api/returns/:id carries the sale's version as
//                                  sale_money_precision_version for this check.
export type ReturnEditLock = 'exact_return' | 'legacy_return_on_exact_sale' | null

export function returnEditLock(ret: { money_precision_version?: unknown; sale_money_precision_version?: unknown } | null | undefined): ReturnEditLock {
  if (Number(ret?.money_precision_version) === 1) return 'exact_return'
  if (Number(ret?.sale_money_precision_version) === 1) return 'legacy_return_on_exact_sale'
  return null
}
