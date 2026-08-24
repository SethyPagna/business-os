// Minimal D1Compat shim over node:sqlite, matching the .prepare().bind().all()/
// .get()/.run() and .batch() shape importEngine.ts's D1Compat type expects.
// Named (@param) placeholders are rewritten to node:sqlite's positional/named
// support (better-sqlite3-style :param is what node:sqlite actually wants, so
// @param -> $param, which node:sqlite's DatabaseSync also accepts via bind object keys
// prefixed with $). We normalize by stripping the sigil and passing a plain object
// with matching keys using node:sqlite's named-parameter support ($ prefix).
const { DatabaseSync } = require('node:sqlite')

function rewriteSql(sql) {
  // node:sqlite supports $name / :name / @name natively for named params,
  // and the source already uses @name -- no rewrite needed, keep as-is.
  return sql
}

// node:sqlite's DatabaseSync requires the bind object to contain EXACTLY the
// named parameters referenced in the SQL text (extra keys throw "Unknown
// named parameter"). The real D1Compat (lib/db.ts's translate()) is
// permissive -- it scans the SQL for @name placeholders and looks each one
// up in the params object, silently ignoring anything the object has that
// the SQL doesn't reference (callers routinely spread a whole `data` object
// with extra bookkeeping keys like branch_id_explicit at call sites).
// Filtering down to just the placeholders the SQL actually contains
// reproduces that same permissive behavior on top of node:sqlite's stricter
// one.
function extractParamNames(sql) {
  const names = new Set()
  const re = /@(\w+)/g
  let m
  while ((m = re.exec(sql))) names.add(m[1])
  return names
}

class Stmt {
  constructor(db, sql) {
    this.db = db
    this.sql = rewriteSql(sql)
    this._stmt = db.prepare(this.sql)
    this._params = undefined
    this._paramNames = extractParamNames(this.sql)
  }
  bind(params) {
    this._params = params
    return this
  }
  _filter(params) {
    const out = {}
    for (const name of this._paramNames) out[name] = params[name] ?? null
    return out
  }
  // Real lib/db.ts's translate() accepts BOTH shapes (Record<string,
  // unknown> | unknown[]) -- an array is bound positionally, matching the
  // codebase's small number of genuinely `?`-placeholder queries (e.g.
  // routes/returns.ts's sale/sale_item lookups), while an object goes
  // through the existing @name filtering above for the far more common
  // named-placeholder style. Previously this harness only implemented the
  // object branch, so any query using `?` + an array silently got bound
  // against an empty `{}` (node:sqlite's DatabaseSync tolerates a bind
  // object with no matching positional params instead of throwing,
  // meaning this failed quietly by returning no/wrong rows rather than an
  // obvious error) -- caught by test-returns-batch-restock-pure.cjs, the
  // first harness test to exercise a full route through `?`-based sale
  // lookups end-to-end rather than just a table's own migrations/pure
  // helpers. node:sqlite's StatementSync takes positional params as
  // separate arguments, not as an array, hence the spread below.
  _args(params) {
    const p = params ?? this._params ?? {}
    return Array.isArray(p) ? p : [this._filter(p)]
  }
  all(params) {
    return this._stmt.all(...this._args(params))
  }
  get(params) {
    return this._stmt.get(...this._args(params))
  }
  run(params) {
    const info = this._stmt.run(...this._args(params))
    return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } }
  }
}

class D1Compat {
  constructor(db) {
    this.db = db
  }
  prepare(sql) {
    return new Stmt(this.db, sql)
  }
  async batch(items) {
    const results = []
    const tx = this.db.exec ? null : null
    for (const item of items) {
      const stmt = this.db.prepare(item.sql)
      const info = stmt.run(item.params || {})
      results.push({ success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } })
    }
    return results
  }
  exec(sql) {
    this.db.exec(sql)
  }
}

function openDb(migrationSqls) {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of migrationSqls) {
    raw.exec(sql)
  }
  return new D1Compat(raw)
}

module.exports = { openDb, D1Compat }
