// A counting wrapper over the shared node:sqlite D1 shim. It answers exactly
// what a reads-cut change is judged on: how many D1 statements ran, how many
// rows they handed back, and which of them SCAN a whole table (from
// EXPLAIN QUERY PLAN, the only row-read signal node:sqlite exposes -- it has
// no rows_read meta, so scanned-row totals are a plan MODEL, not a D1 meter).
'use strict'

function countingDb(d1) {
  const stats = { statements: 0, rowsReturned: 0, log: [] }

  function record(sql, rows) {
    stats.statements += 1
    stats.rowsReturned += rows
    stats.log.push(String(sql).replace(/\s+/g, ' ').trim())
  }

  function wrapStatement(stmt, sql) {
    const api = {
      bind(params) { stmt.bind(params); return api },
      get(params) { const row = stmt.get(params); record(sql, row ? 1 : 0); return row },
      all(params) { const rows = stmt.all(params); record(sql, rows.length); return rows },
      run(params) { const info = stmt.run(params); record(sql, 0); return info },
    }
    return api
  }

  function wrap(target) {
    return {
      prepare(sql) { return wrapStatement(target.prepare(sql), sql) },
      async batch(items) {
        for (const item of items) record(item.sql, 0)
        return target.batch(items)
      },
      exec(sql) { return target.exec(sql) },
      get db() { return target.db },
    }
  }

  const main = wrap(d1)
  main.staging = d1.staging === d1 ? main : wrap(d1.staging)
  return {
    db: main,
    stats,
    reset() { stats.statements = 0; stats.rowsReturned = 0; stats.log.length = 0 },
    // Tables a statement reads end to end, per EXPLAIN QUERY PLAN.
    fullScans(sql) {
      const plan = d1.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
      return plan.map((row) => /^SCAN (\w+)/.exec(String(row.detail))?.[1]).filter(Boolean)
    },
    // Rows a statement walks when every SCAN reads its whole table (a model).
    scanModelRows(sql) {
      return this.fullScans(sql).reduce((sum, table) => sum + Number(d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n), 0)
    },
  }
}

module.exports = { countingDb }
