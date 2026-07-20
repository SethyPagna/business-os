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

class D1CompatStatement {
  constructor(private readonly db: D1Database, private readonly sql: string) {}

  private bound(params: BindParams) {
    const { sql, values } = translate(this.sql, params)
    return this.db.prepare(sql).bind(...values)
  }

  async get<T = Record<string, unknown>>(params?: BindParams): Promise<T | undefined> {
    const row = await this.bound(params).first<T>()
    return row ?? undefined
  }

  async all<T = Record<string, unknown>>(params?: BindParams): Promise<T[]> {
    const result = await this.bound(params).all<T>()
    return result.results ?? []
  }

  async run(params?: BindParams): Promise<{ changes: number; lastInsertRowid: number }> {
    const result = await this.bound(params).run()
    return {
      changes: result.meta?.changes ?? 0,
      lastInsertRowid: Number(result.meta?.last_row_id ?? 0),
    }
  }
}

export class D1Compat {
  constructor(private readonly d1: D1Database) {}

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
    return this.d1.batch(prepared)
  }

  async transaction<T>(fn: (db: D1Compat) => Promise<T>): Promise<T> {
    // See batch() above for the real atomic primitive. This pass-through
    // exists only for read-only call sites that don't need atomicity;
    // anywhere writes must be atomic, use batch() directly and design the
    // validate-then-batch-write shape, not this method.
    return fn(this)
  }
}

export function getDb(env: { DB: D1Database }): D1Compat {
  return new D1Compat(env.DB)
}
