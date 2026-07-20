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

  async transaction<T>(fn: (db: D1Compat) => Promise<T>): Promise<T> {
    // D1 does not yet expose interactive multi-statement transactions to
    // Workers bindings the way a direct Postgres/SQLite connection does.
    // Batch writes via db.batch() where atomicity matters; for read-then-write
    // sequences, this just runs them in order (D1 statements are individually
    // atomic, which covers the large majority of this codebase's usage).
    return fn(this)
  }
}

export function getDb(env: { DB: D1Database }): D1Compat {
  return new D1Compat(env.DB)
}
