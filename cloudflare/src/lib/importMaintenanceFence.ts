import { getDb, type BindParams, type D1Compat } from './db'

type Statement = { sql: string; params?: BindParams }

// An error from the first statement aborts the entire D1 batch. Checking the
// flag in a separate request would leave a restore-vs-import TOCTOU window.
const maintenanceGuard: Statement = {
  sql: `SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM system_flags WHERE key = 'maintenance'
  ) THEN 1 ELSE abs(-9223372036854775808) END AS import_maintenance_guard`,
}

export class ImportMaintenanceFenceError extends Error {
  readonly code = 'import_maintenance_active'

  constructor() {
    super('Dataset maintenance is active. Retry this import operation after maintenance ends.')
    this.name = 'ImportMaintenanceFenceError'
  }
}

export function isImportMaintenanceFenceError(error: unknown): error is ImportMaintenanceFenceError {
  return error instanceof ImportMaintenanceFenceError
}

/**
 * Fence only this import/bulk workflow's main-D1 writes. A missing flag table
 * means the legacy database cannot start a restore; other lookup errors fail
 * closed. The capability lookup happens once per entry invocation, not once
 * per chunk or statement.
 */
export async function getImportFencedDb(env: { DB: D1Database; IMPORT_DB?: D1Database }): Promise<D1Compat> {
  const db = getDb(env)
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'system_flags'").get<{ name: string }>()
  if (!table) return db
  const fenced = withImportMaintenanceWriteFence(db)
  if (db.staging === db) fenced.staging = fenced
  return fenced
}

export function withImportMaintenanceWriteFence(db: D1Compat): D1Compat {
  const fenced = Object.create(db) as D1Compat
  const execute = async (statements: Statement[], once: boolean) => {
    try {
      const results = await (once ? db.batchOnce([maintenanceGuard, ...statements]) : db.batch([maintenanceGuard, ...statements]))
      return results.slice(1)
    } catch (error) {
      // The branch-authority guard also uses integer overflow. Attribute it
      // to maintenance only when the flag actually exists; preserve other
      // failures and their retry semantics.
      if (/integer overflow/i.test(error instanceof Error ? error.message : String(error))) {
        const held = await db.prepare("SELECT 1 AS held FROM system_flags WHERE key = 'maintenance'").get<{ held: number }>()
        if (held) throw new ImportMaintenanceFenceError()
      }
      throw error
    }
  }
  fenced.batch = (statements) => execute(statements, false)
  fenced.batchOnce = (statements) => execute(statements, true)
  fenced.prepare = ((sql: string) => {
    const prepared = db.prepare(sql)
    return {
      get: prepared.get.bind(prepared),
      all: prepared.all.bind(prepared),
      run: async (params?: BindParams) => {
        const results = await execute([{ sql, params }], false)
        return {
          changes: results[0].meta?.changes ?? 0,
          lastInsertRowid: Number(results[0].meta?.last_row_id ?? 0),
        }
      },
    }
  }) as D1Compat['prepare']
  return fenced
}
