import type { D1Compat } from './db'

// Every operational table that caches a user's display name alongside a stable
// user-id FK. The account id is the source of truth; these columns are only a
// denormalized snapshot. Renaming a username therefore has to update all of them
// so the new name propagates through the whole system (sales, returns, stock
// movements, transfers, "created by" audit-style trails, etc.) rather than
// leaving stale copies behind.
//
// `audit_logs` (user_id / user_name) is deliberately EXCLUDED: an audit row is a
// point-in-time record of who performed an action and must never be rewritten,
// even on a rename.
export const USER_NAME_SNAPSHOTS: ReadonlyArray<{ table: string; idColumn: string; nameColumn: string }> = [
  { table: 'sales', idColumn: 'cashier_id', nameColumn: 'cashier_name' },
  { table: 'returns', idColumn: 'cashier_id', nameColumn: 'cashier_name' },
  { table: 'inventory_movements', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'stock_row_moves', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'stock_transfers', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'damaged_stock_lots', idColumn: 'created_by_user_id', nameColumn: 'created_by_user_name' },
  { table: 'action_history', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'ai_provider_configs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'ai_response_logs', idColumn: 'actor_user_id', nameColumn: 'actor_user_name' },
  { table: 'bulk_delete_jobs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'file_assets', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'import_jobs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'loyalty_point_adjustments', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'undo_snapshots', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
]

// Propagate a username change to every denormalized snapshot listed above.
// Returns the number of snapshot rows updated. Each table is updated
// independently so a table that does not exist in a given environment (e.g. a
// pared-down test DB) is skipped rather than aborting the whole cascade; in
// production every table is present. The `!= @name` guard skips rows already
// correct so a rename never churns rows needlessly.
//
// The table/column names come only from the hardcoded USER_NAME_SNAPSHOTS list
// (never user input), so interpolating them into the SQL is safe.
export async function cascadeUserRename(db: D1Compat, userId: number, newUsername: string): Promise<number> {
  if (!Number.isFinite(userId)) return 0
  const name = String(newUsername ?? '').trim()
  if (!name) return 0
  let updated = 0
  for (const snapshot of USER_NAME_SNAPSHOTS) {
    try {
      const result = await db.prepare(
        `UPDATE ${snapshot.table} SET ${snapshot.nameColumn} = @name
         WHERE ${snapshot.idColumn} = @id
           AND (${snapshot.nameColumn} IS NULL OR ${snapshot.nameColumn} != @name)`,
      ).run({ name, id: userId })
      updated += result.changes
    } catch {
      // Table absent in this environment -- skip it, keep cascading the rest.
    }
  }
  return updated
}
