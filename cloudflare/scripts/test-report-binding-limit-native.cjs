const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const dbFile = path.join(__dirname, '../src/lib/db.ts')
const dbModule = { exports: {} }
const output = ts.transpileModule(fs.readFileSync(dbFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('require', 'module', 'exports', output)(id => id === './importMaintenanceFence' ? {} : require(id), dbModule, dbModule.exports)
globalThis[Symbol.for('binding-limit-real-db')] = dbModule.exports
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace("'../lib/db': { getDb: (env) => env.DB },", "'../lib/db': globalThis[Symbol.for('binding-limit-real-db')], './db': globalThis[Symbol.for('binding-limit-real-db')],") + '\nmodule.exports={fixture,app,executionCtx,USER,setUser(value){currentUser=value}};', file)

function rawD1(sqlite, calls) {
  return {
    prepare(sql) {
      const slotCount = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map(match => Number(match[1])))
      if (slotCount > 100) console.error(`Report requires ${slotCount} distinct numbered slots`)
      const statement = sqlite.prepare(sql)
      return { bind(...values) {
        const numbered = [...sql.matchAll(/\?(\d+)/g)]
        const args = numbered.length ? [Object.fromEntries(numbered.map(match => [`?${match[1]}`, values[Number(match[1]) - 1]]))] : values
        calls.push({ sql, bindings: values.length })
        return {
          async all() { return { results: statement.all(...args), meta: {} } },
          async run() { const result = statement.run(...args); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
        }
      } }
    },
  }
}

async function main() {
  const h = harness.exports
  const f = h.fixture()
  try {
    f.raw.db.limits.variableNumber = 100
    f.raw.db.limits.exprDepth = 100
    const calls = []
    const raw = rawD1(f.raw.db, calls)
    h.setUser({ ...h.USER, permissions: '{"all":true}' })
    f.raw.prepare("INSERT INTO sales(receipt_number,sale_status,total_usd,created_at,branch_id) VALUES('nyx','cancelled',10,'2026-09-13 01:00:00',1)").run()
    const get = async (query, endpoint = '/stats') => {
      const response = await h.app.request(`${endpoint}?${query}`, {}, { DB: raw }, h.executionCtx)
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return JSON.parse(text)
    }
    for (const variant of ['ordinary', 'nyx', 'mixed-alias']) {
      const aliases = ['rt', 'realtechniques', 'nyx', 'nyxprofessionalmakeup', 'bh', 'bhcosmetics', 'ofra', 'ofracosmetics']
      const terms = Array.from({ length: 6 }, (_, group) => Array.from({ length: 8 }, (_, word) => variant === 'nyx' ? 'nyx' : variant === 'mixed-alias' && group === 0 ? aliases[word] : `nomatch${group}${word}`).join(' ')).join(', ')
      for (const range of ['', '&startDate=2026-09-13&endDate=2026-09-13']) {
        const query = `status=cancelled&cashier=nobody&search=${encodeURIComponent(terms)}${range}`
        const payload = await get(query)
        assert.equal(payload.total_count, 0)
        assert.deepEqual(await get(query, '/'), [])
      }
    }
    const found = await get('status=cancelled&search=nyx')
    assert.equal(found.total_count, 1)
    assert.equal(found.revenue_count, 0)
    assert.equal(found.revenue_usd, 0)
    assert.ok(calls.some(call => call.sql.includes('sale_items sis') && call.bindings >= 48))
    assert.ok(calls.every(call => call.bindings <= 100))
    console.log(`PASS real getDb/Hono widest ordinary+alias reports, date windows, result semantics at depth100/variableNumber100; maximum bound slots ${Math.max(...calls.map(call => call.bindings))}`)
  } finally {
    f.raw.db.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { delete globalThis[Symbol.for('binding-limit-real-db')] })
