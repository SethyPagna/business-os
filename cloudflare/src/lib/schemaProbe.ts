// Shared per-isolate cache for `PRAGMA table_info(...)` column probes.
//
// Several routes ask "does table X have column Y" to stay compatible with a
// database that predates a migration adding that column (money-precision
// columns, portal consent columns, the legacy receipt column, etc.). Each
// probe used to fire its own PRAGMA on every request that needed the
// answer -- e.g. GET /api/sales asked `PRAGMA table_info(returns)` on every
// cache miss just to learn whether money_precision_version exists, even
// though a warm isolate answers that identically request after request.
// This app's migrations only ADD columns, never drop them (see the same
// reasoning already inline at routes/returns.ts's salesHasLegacyReceiptColumn
// and lib/portalAccounts.ts's portalAccountsHaveConsentColumns), so once a
// table's column set is read here it is correct for the rest of the
// isolate's life -- cached forever, not re-probed on a timer. A PRAGMA that
// throws is not cached, so the next call retries instead of getting stuck on
// a bad answer.
const tableColumnCache = new Map<string, Set<string>>()

type SchemaProbeDb = { prepare: (sql: string) => { all: <T = unknown>() => Promise<T[]> } }

function quoteIdentifier(table: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : `"${table}"`
}

async function loadTableColumns(db: SchemaProbeDb, table: string): Promise<Set<string>> {
  const rows = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all<{ name?: string }>()
  const list = Array.isArray(rows) ? rows : ((rows as unknown as { results?: Array<{ name?: string }> })?.results ?? [])
  return new Set(list.map((row) => String(row?.name || '')))
}

// The full column-name set for one table, memoized per isolate.
export async function tableColumnSet(db: SchemaProbeDb, table: string): Promise<Set<string>> {
  const cached = tableColumnCache.get(table)
  if (cached) return cached
  const columns = await loadTableColumns(db, table)
  tableColumnCache.set(table, columns)
  return columns
}

// Whether `table` currently has `column`, memoized per isolate.
export async function hasColumn(db: SchemaProbeDb, table: string, column: string): Promise<boolean> {
  const columns = await tableColumnSet(db, table)
  return columns.has(column)
}

// Exported for pure tests only -- lets a test exercise "first call probes,
// second call is cached" from a clean slate instead of depending on module
// load order across the whole suite.
export function __resetSchemaProbeCacheForTests(): void {
  tableColumnCache.clear()
}
