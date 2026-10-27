// A D1 binding (prepare().bind().all/first/run/raw, batch, exec) over a node:sqlite database, counting calls the way
// Cloudflare counts them against a Worker invocation: every prepared-statement all/first/run/raw is one call and every
// batch is ONE call whatever it holds. `log` has one entry per call: [kind, sql] or ['batch', [sql, ...]].
// Options: failOn (substring: a statement holding it throws), refuseBatchWhen (RegExp: a batch holding a match throws).
function d1Binding(raw, { failOn = null, refuseBatchWhen = null } = {}) {
  const log = []
  const run = (sql, values, kind) => {
    if (failOn && sql.includes(failOn)) throw new Error('D1_ERROR: no such column: forced failure')
    const statement = raw.prepare(sql)
    if (kind === 'run') { const info = statement.run(...values); return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } } }
    return { success: true, results: statement.all(...values), meta: {} }
  }
  const statement = (sql, values = []) => ({
    _sql: sql, _values: values,
    bind: (...v) => statement(sql, v),
    async all() { log.push(['all', sql]); return run(sql, values, 'all') },
    async first(column) { log.push(['first', sql]); const row = run(sql, values, 'all').results[0] ?? null; return column ? row?.[column] ?? null : row },
    async run() { log.push(['run', sql]); return run(sql, values, 'run') },
    async raw() { log.push(['raw', sql]); return run(sql, values, 'all').results.map((row) => Object.values(row)) },
  })
  const d1 = {
    prepare: (sql) => statement(sql),
    exec: async () => ({ count: 0 }),
    async batch(list) {
      log.push(['batch', list.map((item) => item._sql)])
      if (refuseBatchWhen && list.some((item) => refuseBatchWhen.test(item._sql))) throw new Error('D1_ERROR: no such function: not allowed in a batch')
      return list.map((item) => run(item._sql, item._values, item._sql.trim().toUpperCase().startsWith('SELECT') || item._sql.trim().toUpperCase().startsWith('WITH') || item._sql.trim().toUpperCase().startsWith('PRAGMA') ? 'all' : 'run'))
    },
  }
  return { d1, log }
}

module.exports = { d1Binding }
