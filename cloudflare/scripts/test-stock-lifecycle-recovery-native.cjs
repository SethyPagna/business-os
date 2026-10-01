const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const file = path.join(__dirname, '../src', rel)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }; cache.set(rel, mod)
  const local = name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)).replace(/(?:\.ts)?$/, '.ts')) : require(name)
  new Function('require', 'module', 'exports', output)(local, mod, mod.exports)
  return mod.exports
}
function fixture() {
  const db = openDb(loadAll()).db
  db.limits.variableNumber = 100
  const calls = [], hooks = {}
  function prepare(sql, values = []) {
    const execute = () => {
      calls.push(sql); hooks.before?.(sql, db)
      const stmt = db.prepare(sql)
      if (stmt.columns().length) return { success: true, results: sqliteD1Call(stmt, 'all', values), meta: { changes: 0 } }
      const result = sqliteD1Call(stmt, 'run', values)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { sql, execute, bind: (...params) => prepare(sql, params), all: async () => execute(), run: async () => execute(), first: async key => { const row = execute().results[0]; return key ? row?.[key] ?? null : row ?? null } }
  }
  const d1 = { prepare, batch: async items => { db.exec('BEGIN IMMEDIATE'); try { const result = items.map(item => item.execute()); db.exec('COMMIT'); return result } catch (e) { db.exec('ROLLBACK'); throw e } } }
  const objects = new Map(); let version = 0
  const put = async (key, value, options = {}) => { objects.set(key, { bytes: typeof value === 'string' ? Buffer.from(value) : Buffer.from(value), version: String(++version), options }); return {} }
  const assets = {
    put, delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key) },
    list: async ({ prefix = '' } = {}) => ({ objects: [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, uploaded: new Date(), customMetadata: o.options.customMetadata })), truncated: false }),
    get: async (key, options) => { const o = objects.get(key); if (!o) return null; const identity = { key, version: o.version, etag: o.version, size: o.bytes.length, customMetadata: o.options.customMetadata }; if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== o.version) return identity; return { ...identity, body: new Blob([o.bytes]).stream(), text: async () => o.bytes.toString(), json: async () => JSON.parse(o.bytes.toString()) } },
    createMultipartUpload: async (key, options) => { const parts = []; return { uploadPart: async (n, bytes) => { parts[n - 1] = Buffer.from(bytes); return { partNumber: n, etag: String(n) } }, complete: async () => put(key, Buffer.concat(parts), options), abort: async () => {} } },
  }
  const kv = new Map()
  return { db, calls, hooks, objects, env: { DB: d1, ASSETS: assets, CACHE: { get: async key => kv.get(key) ?? null, put: async (key, value) => kv.set(key, value), delete: async key => kv.delete(key) }, PLAN_TIER: 'paid' } }
}
const durable = ['stock_disposition_sources','stock_disposition_allocations','stock_disposition_events','stock_disposition_fees','stock_disposition_receipts','stock_funding_invoice_openings','stock_funding_sources','stock_funding_claims','stock_funding_events','stock_funding_receipts']
async function main() {
  const backup = load('lib/backup.ts')
  const f = fixture()
  const result = await backup.createCloudflareBackup(f.env)
  const document = await (await f.env.ASSETS.get(result.key)).json()
  const missing = durable.filter(table => !Object.hasOwn(document.tables, table))
  assert.deepEqual(missing, [], 'actual createCloudflareBackup manifest must retain all ten durable stock finance tables')
  assert(!Object.hasOwn(document.tables, 'stock_disposition_guards'))
  assert(!Object.hasOwn(document.tables, 'stock_funding_guards'))
  f.db.close()
  console.log('PASS actual native SQLite/in-memory R2 backup includes ten durable ledgers and excludes transient guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
