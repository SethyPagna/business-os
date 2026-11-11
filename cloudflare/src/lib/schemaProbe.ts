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

type SchemaProbeDb = { prepare: (sql: string) => { all: <T = unknown>(params?: Record<string, unknown>) => Promise<T[]> } }

function quoteIdentifier(table: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : `"${table}"`
}

async function loadTableColumns(db: SchemaProbeDb, table: string): Promise<Set<string>> {
  const rows = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all<{ name?: string }>()
  const list = Array.isArray(rows) ? rows : ((rows as unknown as { results?: Array<{ name?: string }> })?.results ?? [])
  return new Set(list.map((row) => String(row?.name || '')))
}

// One round trip for the column sets of several tables (json_each x pragma_table_info, the shape lib/stockSession.ts already runs in production)
// instead of one PRAGMA per table. Only tables the result NAMES are cached: a table the combined query returns no column for (it does not exist, or
// the database cannot run the table-valued form) stays uncached and falls back to its own PRAGMA in tableColumnSet, so the answer is always the one
// the single probe gives. A failing combined probe is swallowed for the same reason: the per-table path still answers, as before.
export async function prefetchTableColumns(db: SchemaProbeDb, tables: readonly string[]): Promise<void> {
  const missing = [...new Set(tables)].filter((table) => !tableColumnCache.has(table))
  if (missing.length < 2) return
  let rows: Array<{ table_name?: string; name?: string }>
  try {
    const result = await db.prepare('SELECT t.value AS table_name, p.name AS name FROM json_each(@tables) t JOIN pragma_table_info(t.value) p ORDER BY t.value, p.cid')
      .all<{ table_name?: string; name?: string }>({ tables: JSON.stringify(missing) })
    rows = Array.isArray(result) ? result : ((result as unknown as { results?: Array<{ table_name?: string; name?: string }> })?.results ?? [])
  } catch { return }
  const found = new Map<string, Set<string>>()
  for (const row of rows) {
    const table = String(row?.table_name || '')
    if (!missing.includes(table)) continue
    if (!found.has(table)) found.set(table, new Set())
    found.get(table)!.add(String(row?.name || ''))
  }
  for (const [table, columns] of found) if (!tableColumnCache.has(table)) tableColumnCache.set(table, columns)
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
