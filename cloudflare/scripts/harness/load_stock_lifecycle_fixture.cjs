const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { sqliteD1Call } = require('./sqlite_d1_bindings.cjs')
const sourceRoot = path.resolve(__dirname, '../../src')
const modules = new Map()

function loadStockLifecycleFixture(relativeFile = 'lib/stockLifecycle.ts') {
  const normalized = path.posix.normalize(relativeFile.replaceAll('\\', '/'))
  if (!/^lib\/[A-Za-z0-9_-]+\.ts$/.test(normalized)) throw new Error('Unexpected stock fixture source: ' + relativeFile)
  if (modules.has(normalized)) return modules.get(normalized).exports
  const filename = path.join(sourceRoot, normalized)
  const loaded = { exports: {} }
  modules.set(normalized, loaded)
  const request = name => {
    if (name === 'hono/http-exception') return require(name)
    if (!name.startsWith('.')) throw new Error('Unexpected stock fixture external: ' + name)
    const next = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), name))
    return loadStockLifecycleFixture(next.endsWith('.ts') ? next : next + '.ts')
  }
  try {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
    }).outputText
    new Function('exports', 'require', 'module', output)(loaded.exports, request, loaded)
  } catch (error) { modules.delete(normalized); throw error }
  return loaded.exports
}

function nativeStockFixtureBinding(sqlite, batch) {
  const execute = ({ sql, values }) => {
    const prepared = sqlite.prepare(sql)
    if (prepared.reader) return { results: sqliteD1Call(prepared, 'all', values), meta: { changes: 0 } }
    const result = sqliteD1Call(prepared, 'run', values)
    return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  }
  return {
    prepare(sql) {
      return { bind(...values) {
        return { sql, values,
          async all() { return { results: sqliteD1Call(sqlite.prepare(sql), 'all', values) } },
          async run() { return execute({ sql, values }) },
        }
      } }
    },
    async batch(statements) {
      if (batch) return batch(statements.map(({ sql, values }) => ({ sql, params: values })))
      return sqlite.transaction(() => statements.map(execute))()
    },
  }
}

module.exports = { loadStockLifecycleFixture, nativeStockFixtureBinding }