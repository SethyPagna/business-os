// D1 database adapter.
//
// The original backend (backend/src/postgresDatabase.ts) exposes a
// synchronous db.prepare(sql).get(params)/.all(params)/.run(params) API,
// built to keep route code written against better-sqlite3's synchronous
// interface working after moving to Postgres via a native sync bridge.
//
// D1 has no synchronous mode -- everything is async, which is the
// Workers-native and correct way to do it. Route handlers in this codebase
// are already async (wrapped in asyncRoute), so porting a route is
// mechanical: change `db.prepare(sql).get(params)` to
// `await db.prepare(sql).get(params)`, keep the SQL as-is.
//
// D1's bind() is positional (`?`), not named. The existing SQL throughout
// the backend uses SQLite-native named placeholders (`@paramName`) --
// D1 IS SQLite, so nothing else about the SQL needs to change. This adapter
// only translates `@paramName` -> positional `?` and reorders a params
// object into a positional bind array, in the same spirit as (but much
// simpler than) backend/src/db/postgresQueryCompat.ts, which additionally
// had to work around Postgres syntax differences that don't apply here.

export type BindParams = Record<string, unknown> | unknown[] | undefined

function translate(sql: string, params: BindParams): { sql: string; values: unknown[] } {
  if (Array.isArray(params)) {
    return { sql, values: params }
  }
  const map = params || {}
  const values: unknown[] = []
  // @name -> positional ?, in the order they appear (D1/SQLite requires
  // this order to match .bind() argument order for plain `?` placeholders).
  const translatedSql = sql.replace(/@(\w+)/g, (_match, name: string) => {
    values.push((map as Record<string, unknown>)[name] ?? null)
    return '?'
  })
  return { sql: translatedSql, values }
}

// D1 (like any networked database) occasionally throws a transient error
// that has nothing to do with the query itself -- a dropped connection to
// the storage backend, a momentary internal error, etc. This was showing up
// to users as e.g. "Write failed - data not saved: Internal Server Error
// (operation: actionHistory:create)", which then worked fine on a page
// refresh (i.e. the *same* query, retried, succeeded) -- the textbook
// signature of a transient fault with no retry, not a real/permanent one.
// Real errors (a bad column name, a constraint violation, a malformed
// query) are deterministic and will fail again identically on retry, so
// this only retries errors whose message looks infrastructure-related, and
// only once, after a short delay.
const TRANSIENT_D1_ERROR_PATTERN = /network|timeout|timed out|internal error|too many requests|busy|reset|ECONNRESET|fetch failed|D1_ERROR/i

// Checked BEFORE the transient pattern, because D1 prefixes essentially
// every error it surfaces with `D1_ERROR:` -- which the pattern above
// matches -- so without this list a bad column name, a constraint
// violation or an over-long parameter list was retried once, doubling its
// CPU cost inside a Worker that is already fighting a CPU limit, and
// arriving at the identical failure. These messages come from SQLite
// itself and are deterministic by definition: the same statement with the
// same bindings fails the same way every time.
//
// `too many SQL variables` is the specific one that motivated this: it is
// D1's 100-bound-parameter limit (see lib/sqlBinding.ts), and the old
// bare `too many` alternative in the pattern above classified it as
// transient. `too many requests` -- rate limiting -- really is transient
// and is kept.
// A CPU-limit reset is not a transient transport failure. Replaying the same
// statement immediately consumes the same budget again and can fan one bad
// request out into failures in unrelated reads (health/import tracker/etc.).
// Callers that can safely adapt work (for example the chunked import writer)
// already handle this class explicitly; ordinary requests must fail once.
const DETERMINISTIC_SQL_ERROR_PATTERN = /CPU time limit|exceeded its CPU time limit|too many SQL variables|no such (table|column|function)|constraint failed|syntax error|datatype mismatch|ambiguous column|incomplete input/i

async function withD1Retry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (DETERMINISTIC_SQL_ERROR_PATTERN.test(message)) throw error
    if (!TRANSIENT_D1_ERROR_PATTERN.test(message)) throw error
    await new Promise((resolve) => setTimeout(resolve, 200))
    return run()
  }
}

class D1CompatStatement {
  constructor(private readonly db: D1Database, private readonly sql: string) {}

  private bound(params: BindParams) {
    const { sql, values } = translate(this.sql, params)
    return this.db.prepare(sql).bind(...values)
  }

  async get<T = Record<string, unknown>>(params?: BindParams): Promise<T | undefined> {
    const row = await withD1Retry(() => this.bound(params).first<T>())
    return row ?? undefined
  }

  async all<T = Record<string, unknown>>(params?: BindParams): Promise<T[]> {
    const result = await withD1Retry(() => this.bound(params).all<T>())
    return result.results ?? []
  }

  async run(params?: BindParams): Promise<{ changes: number; lastInsertRowid: number }> {
    const result = await withD1Retry(() => this.bound(params).run())
    return {
      changes: result.meta?.changes ?? 0,
      lastInsertRowid: Number(result.meta?.last_row_id ?? 0),
    }
  }
}

export class D1Compat {
  // The database that holds the bulk import STAGING tables
  // (import_job_rows, import_job_source_rows). Defaults to THIS database, so
  // every single-DB environment -- local dev, the pure-test harnesses, and
  // any deployment without the optional IMPORT_DB binding -- behaves exactly
  // as it did before the split. getDb() below points it at a separate D1
  // (IMPORT_DB) when that binding exists, which is what keeps the hundreds of
  // MB of regenerable per-row import staging out of the operational database.
  // Only the handful of code paths that touch those two staging tables use
  // db.staging; every other table keeps using db directly, because a
  // db.batch() is atomic only WITHIN one database and there are no cross-DB
  // JOINs -- so nothing that must be atomic with, or joined to, operational
  // data may live here (the import_*_commits/guards idempotency ledgers and
  // import_auto_merges deliberately stay on the main DB for that reason).
  staging: D1Compat

  constructor(private readonly d1: D1Database) {
    this.staging = this
  }

  prepare(sql: string): D1CompatStatement {
    return new D1CompatStatement(this.d1, sql)
  }

  // Real atomic multi-statement write, using D1's actual db.batch() API.
  // Confirmed behavior (Cloudflare docs + independent verification): batched
  // statements execute as a single SQLite transaction -- if any statement
  // throws, the whole batch rolls back, nothing is partially written.
  //
  // Real constraint to design around, not paper over: batch() only rolls
  // back on a thrown exception (e.g. a constraint violation) -- NOT on
  // "zero rows affected" or other application-level conditions, and you
  // cannot branch on one statement's result before building the next
  // statement in the same batch (no interleaving reads and writes
  // atomically). This is exactly why callers like routes/sales.ts validate
  // (e.g. check stock availability) as a separate read *before* building
  // the batch, then send every write as one atomic unit -- same shape the
  // original backend/src/routes/sales.ts already uses.
  async batch(statements: Array<{ sql: string; params?: BindParams }>): Promise<D1Result[]> {
    const prepared = statements.map(({ sql, params }) => {
      const { sql: translatedSql, values } = translate(sql, params)
      return this.d1.prepare(translatedSql).bind(...values)
    })
    return withD1Retry(() => this.d1.batch(prepared))
  }

  async transaction<T>(fn: (db: D1Compat) => Promise<T>): Promise<T> {
    // See batch() above for the real atomic primitive. This pass-through
    // exists only for read-only call sites that don't need atomicity;
    // anywhere writes must be atomic, use batch() directly and design the
    // validate-then-batch-write shape, not this method.
    return fn(this)
  }
}

export function getDb(env: { DB: D1Database; IMPORT_DB?: D1Database }): D1Compat {
  const db = new D1Compat(env.DB)
  // Route the bulk import staging tables to their own D1 when the optional
  // IMPORT_DB binding is present (production). Without it, db.staging stays
  // pointed at the main DB (see the field's comment) and everything works
  // against a single database exactly as before.
  if (env.IMPORT_DB) db.staging = new D1Compat(env.IMPORT_DB)
  return db
}

// Shared boolean-coercion for DB columns that store 0/1 but can be sent as
// a real JS boolean, a number, or a string (form/URL-encoded inputs, or a
// value round-tripped through JSON as text) -- "false"/"0"/"no"/"off" must
// resolve to 0, not to JS's own truthiness (which treats every non-empty
// string, including the literal string "false", as truthy). Moved here
// (previously a private, non-exported copy inside routes/branches.ts) so
// lib/reviewApply.ts's branch appliers can share the exact same coercion
// instead of re-approximating it with plain `value ? 1 : 0`, which silently
// disagreed with this on a string "false"/"0" input -- caught while
// auditing direct-write vs. review-apply paths for drift this session (the
// same class of bug as the products/create/product branch_stock fix
// logged in progress.md).
export function toDbBool(value: unknown, fallback: 0 | 1 = 1): 0 | 1 {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}
