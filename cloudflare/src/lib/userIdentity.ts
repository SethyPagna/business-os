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

export type UserRenameStatement = { sql: string; params: { name: string; id: number } }

export function buildUserRenameStatements(userId: number, newUsername: string): UserRenameStatement[] {
  if (!Number.isFinite(userId)) return []
  const name = String(newUsername ?? '').trim()
  if (!name) return []
  return USER_NAME_SNAPSHOTS.map((snapshot) => ({
    sql: `UPDATE ${snapshot.table} SET ${snapshot.nameColumn} = @name
          WHERE ${snapshot.idColumn} = @id
            AND (${snapshot.nameColumn} IS NULL OR ${snapshot.nameColumn} != @name)`,
    params: { name, id: userId },
  }))
}

// Propagate a username change to every denormalized snapshot listed above.
// Returns the number of snapshot rows updated. Each table is updated
// as one D1 batch. D1 batches are transactional: a missing table or schema drift
// fails the whole rename instead of silently committing a partly-updated user
// identity. The `!= @name` guard skips rows already correct.
//
// The table/column names come only from the hardcoded USER_NAME_SNAPSHOTS list
// (never user input), so interpolating them into the SQL is safe.
export async function cascadeUserRename(db: D1Compat, userId: number, newUsername: string): Promise<number> {
  const statements = buildUserRenameStatements(userId, newUsername)
  if (!statements.length) return 0
  const results = await db.batch(statements)
  return results.reduce((sum, result) => {
    const shaped = result as unknown as { changes?: number; meta?: { changes?: number } }
    return sum + Number(shaped.meta?.changes ?? shaped.changes ?? 0)
  }, 0)
}
