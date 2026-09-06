// N13 -- resolving the BRANCH a movement row happened at.
//
// inventory_movements carries both the durable relationship (branch_id) and a
// denormalized snapshot (branch_name). The stock-side writers stamp both; the
// sale/return-family writers stamp only branch_id, so those rows reached the
// Stock Change ledger, the Inventory movement drill and the product history
// preview with a null branch and rendered as an empty column -- the "Sale rows
// show no branch" report.
//
// The fix is on the READ side on purpose. A second write path would be a
// second thing to keep in sync: branch names are already re-snapshotted from
// the id whenever a branch is renamed (branchWrites.ts's
// branchNameSnapshotStatements, which UPDATEs inventory_movements.branch_name
// from branches.name), so the id is what the system actually trusts. Reading
// through the id fills the gap for every historical row at once, needs no
// backfill to be correct, and cannot fight that existing path.
//
// Precedence is snapshot-first: COALESCE(NULLIF(m.branch_name,''), branches.name).
// A row that DOES carry a snapshot keeps it, so renaming or deleting a branch
// never silently rewrites what the history says happened; the lookup only ever
// fills a blank.

/**
 * The SQL expression for a movement row's branch name, given the table alias
 * the surrounding statement uses for inventory_movements.
 *
 * A correlated sub-select rather than a LEFT JOIN, deliberately: the two call
 * sites have incompatible FROM clauses (the ledger kernel aliases its tables,
 * the /movements route selects from a bare, unaliased inventory_movements and
 * writes unqualified predicates like `created_at` that a joined `branches`
 * would make ambiguous). One expression, no join, valid in both.
 */
export function movementBranchNameSql(alias: string): string {
  return `COALESCE(NULLIF(${alias}.branch_name, ''), (SELECT name FROM branches WHERE id = ${alias}.branch_id))`
}

/**
 * The alias used for the resolved value where a statement cannot name the
 * column `branch_name` directly (a `SELECT *` already produces that name, and
 * two columns of one name in a result row is undefined behaviour).
 */
export const RESOLVED_BRANCH_NAME_COLUMN = 'resolved_branch_name'

/**
 * Fold the resolved value back onto `branch_name` and drop the helper column,
 * so every consumer of a movement row sees ONE field. Snapshot-first, matching
 * movementBranchNameSql().
 */
export function withResolvedBranchName<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const rest: Record<string, unknown> = { ...row }
  const resolved = rest[RESOLVED_BRANCH_NAME_COLUMN]
  delete rest[RESOLVED_BRANCH_NAME_COLUMN]
  const snapshot = rest.branch_name
  const kept = typeof snapshot === 'string' && snapshot.trim() ? snapshot : null
  rest.branch_name = kept ?? (typeof resolved === 'string' && resolved.trim() ? resolved : null)
  return rest as T
}
