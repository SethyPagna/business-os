// Which returns move a customer's points. ONE predicate, applied by every reader of the returns term of the balance
// (routes/contacts.ts customer membership balance, routes/notifications.ts loyalty notification, and the raw balance the
// checkout redemption and the customer reassignment guard use in lib/saleCustomerAssignmentGuard.ts), so the till, the
// customer card and checkout can never disagree. All three read the unaliased `returns` table; the sale subquery is
// correlated to it by name.
//
//   * a supplier return is not a customer's;
//   * a return of a sale that EARNED nothing takes nothing back. `sales.loyalty_accrual = 0` marks a sale that earns no
//     points: migrated old-system history (the owner's standing rule 13 Oct 2026: historical sales never accrue loyalty;
//     salesImportCommit.ts writes 0 unless the importer opts in) and a POS opt-out. Its points redeemed still count as
//     spent on the sale side; only the refund of an unearned sale is ignored. A return that names no sale keeps
//     deducting, and the flag is read at the time of the question, so opting a sale in restores its refund's effect.
export const customerPointsReturnSql = "(COALESCE(return_scope,'customer') <> 'supplier' AND NOT EXISTS (SELECT 1 FROM sales points_sale WHERE points_sale.id = returns.sale_id AND COALESCE(points_sale.loyalty_accrual,1) = 0))"
