const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { applyMigrations } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const source = path.join(__dirname, '..', '..', 'src')
const cache = new Map()
function loadLib(relative) {
  const file = path.resolve(source, relative.endsWith('.ts') ? relative : `${relative}.ts`)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText
  const req = name => name.startsWith('.') ? loadLib(path.relative(source, path.resolve(path.dirname(file), name))) : require(name)
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

function paramsFor(sql, params = {}) {
  if (Array.isArray(params)) return params
  return Object.fromEntries([...sql.matchAll(/@(\w+)/g)].map(match => [match[1], params[match[1]] ?? null]))
}

function fixture(seed, username, hooks = {}) {
  const sqlite = new Database(':memory:')
  applyMigrations({ db: sqlite }, loadAll(), { seedBeforeFence() {
    seed(sqlite)
    sqlite.prepare('INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(41,?,?,\'fixture\',NULL,1)').run(username, username)
  } })
  const stockChange = mutate => sqlite.transaction(() => {
    sqlite.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    mutate(sqlite)
    sqlite.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  })()
  let beforeBatch
  const db = {
    prepare(sql) {
      return Object.fromEntries(['get', 'all', 'run'].map(method => [method,
        async params => sqlite.prepare(sql)[method](paramsFor(sql, params))]))
    },
    async batchOnce(statements) {
      if (beforeBatch) {
        const mutate = beforeBatch
        beforeBatch = null
        stockChange(sql => mutate(sql, statements))
      }
      if (hooks.beforeBatch) stockChange(sql => hooks.beforeBatch(sql, statements))
      const results = sqlite.transaction(() => statements.map(({ sql, params }) => {
        const statement = sqlite.prepare(sql)
        if (statement.reader) return { success: true, results: statement.all(paramsFor(sql, params)) }
        const info = statement.run(paramsFor(sql, params))
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
      }))()
      if (hooks.loseAcknowledgementOnce) {
        hooks.loseAcknowledgementOnce = false
        throw new Error('D1_ERROR: network reset after commit')
      }
      return results
    },
  }
  db.batch = db.batchOnce
  db.staging = db
  return { sqlite, db, stockChange, setBeforeBatch(mutate) { beforeBatch = mutate } }
}

module.exports = { fixture, loadLib }
