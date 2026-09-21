// Append this as the final statement of an ordinary business D1 batch. D1
// rolls back the entire batch if maintenance arrived after route admission.
// Maintenance-owned restore/reset operations must not use this assertion.
export const ordinaryBusinessMaintenanceGuard = {
  sql: `SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM system_flags WHERE key = 'maintenance'
  ) THEN 1 ELSE json_extract('[1]', '$[ordinary_business_maintenance_active]') END AS ordinary_business_maintenance_guard`,
  params: {},
} as const

export async function ordinaryBusinessBatch(
  db: import('./db').D1Compat,
  statements: Array<{ sql: string; params?: import('./db').BindParams }>,
): ReturnType<import('./db').D1Compat['batch']> {
  const results = await db.batch([...statements, ordinaryBusinessMaintenanceGuard])
  return results.slice(0, statements.length)
}

// A one-statement ordinary write must share the transaction with its guard;
// a separate flag read before prepare().run() would reintroduce the race.
export async function runOrdinaryBusinessWrite(
  db: import('./db').D1Compat,
  sql: string,
  params?: import('./db').BindParams,
): Promise<{ changes: number; lastInsertRowid: number }> {
  const [result] = await db.batch([{ sql, params }, ordinaryBusinessMaintenanceGuard])
  return {
    changes: Number(result?.meta?.changes ?? 0),
    lastInsertRowid: Number(result?.meta?.last_row_id ?? 0),
  }
}
