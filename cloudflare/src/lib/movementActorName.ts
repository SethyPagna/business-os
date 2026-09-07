// N13 -- resolving WHO a movement row was written by.
//
// inventory_movements carries the durable relationship (user_id) and a
// denormalized snapshot (user_name). lib/actorSnapshot.ts made every WRITER
// stamp the account USERNAME, and userIdentity.ts's rename cascade rewrites
// the snapshots when an account is renamed -- but neither reaches the rows
// that were written BEFORE that rule existed. Those hold the full name
// ("ung sethy pagna" for the account whose username is "james", "Admin" for
// "admin"), so the Stock Change ledger, the /movements drill and the stock-in
// session detail still print a full name on every historical row, against the
// standing rule that every history surface names the account USERNAME.
//
// Fixed on the READ side, same reasoning as movementBranchName.ts: the id is
// what the system trusts (the rename cascade already re-derives the snapshot
// from it), so reading through the id corrects every historical row at once,
// needs no backfill, and cannot fight the cascade.
//
// Precedence is the OPPOSITE of the branch rule, deliberately. A branch
// snapshot is the historical fact (a rename must not rewrite what the history
// says happened), so there the snapshot wins. An actor snapshot is only ever a
// copy of the account's username -- the account id is the source of truth and
// a rename is supposed to cascade -- so here the ACCOUNT wins and the snapshot
// is the fallback for rows that have no user_id at all ('Old system' imports,
// unattributed legacy rows) or whose account has since been deleted.

/**
 * The SQL expression for a movement row's actor, given the table alias the
 * surrounding statement uses for inventory_movements.
 *
 * A correlated sub-select rather than a LEFT JOIN, for the same reason
 * movementBranchNameSql() is one: the ledger kernel aliases its tables while
 * the /movements route selects from a bare, unaliased inventory_movements and
 * writes unqualified predicates a joined `users` would make ambiguous.
 */
export function movementActorNameSql(alias: string): string {
  return `COALESCE((SELECT username FROM users WHERE id = ${alias}.user_id), ${alias}.user_name)`
}

/**
 * The alias used where a statement cannot name the column `user_name`
 * directly (a `SELECT *` already produces that name, and two columns of one
 * name in a result row is undefined behaviour).
 */
export const RESOLVED_ACTOR_NAME_COLUMN = 'resolved_user_name'

/**
 * Fold the resolved value back onto `user_name` and drop the helper column, so
 * every consumer of a movement row sees ONE field. Account-first, matching
 * movementActorNameSql().
 */
export function withResolvedActorName<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const rest: Record<string, unknown> = { ...row }
  const resolved = rest[RESOLVED_ACTOR_NAME_COLUMN]
  delete rest[RESOLVED_ACTOR_NAME_COLUMN]
  const account = typeof resolved === 'string' && resolved.trim() ? resolved : null
  const snapshot = typeof rest.user_name === 'string' && rest.user_name.trim() ? (rest.user_name as string) : null
  rest.user_name = account ?? snapshot
  return rest as T
}
