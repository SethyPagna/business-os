// SCAN2 PP-2: a product's discount dates are compared by SQL date() and by the
// till's Date parsing. Stored as raw text, "05/10/2026" meant 10 May to the
// till and nothing to SQL, and "31/12/2026" never expired at the till. Both
// writers that take these dates from outside the app's own date picker -- the
// product import and the stock-in session -- must store YYYY-MM-DD or refuse
// the row with a reason that names the cell.
//
// Run (from cloudflare/): node scripts/test-discount-date-import-normalise-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const asyncNoop = async () => {}
const STUBS = {
  './cache': new Proxy({}, { get: () => asyncNoop }),
  '../durable-objects/broadcastHub': new Proxy({}, { get: () => asyncNoop }),
  '../index': {},
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText
  const req = (request) => {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request]
    if (!request.startsWith('.')) return require(request)
    return load(path.resolve(path.dirname(file), `${request}.ts`))
  }
  new Function('exports', 'require', 'module', output)(mod.exports, req, mod)
  return mod.exports
}
const { classifyProducts } = load(path.join(root, 'src', 'lib', 'importEngine.ts'))
const { commitStockSession } = load(path.join(root, 'src', 'lib', 'stockSession.ts'))

let checks = 0
async function check(name, fn) {
  try { await fn(); checks += 1; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

const READABLE = [
  ['2026-10-05', '2026-10-05'],
  ['2026-10-05 00:00:00', '2026-10-05'],
  ['31/12/2026', '2026-12-31'],
  ['12/31/2026', '2026-12-31'],
  ['05/05/2026', '2026-05-05'],
  ['', null],
]

function importDb() {
  const database = openDb(loadAll())
  database.db.prepare("INSERT INTO branches(id, name, is_default, is_active) VALUES (1, 'Shop', 1, 1)").run()
  database.db.prepare("INSERT INTO products(name, barcode, selling_price_usd, is_active) VALUES ('Existing Mask', '8850002000016', 5, 1)").run()
  return database
}
const importRow = (rowNumber, name, starts, ends) => ({
  _rowNumber: rowNumber, name, barcode: name === 'Existing Mask' ? '8850002000016' : `88500030000${rowNumber}`,
  selling_price_usd: '5', discount_enabled: 'Yes', discount_percent: '10', discount_starts_at: starts, discount_ends_at: ends,
})

async function main() {
  await check('product import stores every readable discount date as YYYY-MM-DD, on create and on update', async () => {
    const database = importDb()
    const rows = READABLE.flatMap(([raw], index) => [
      importRow(index * 2 + 2, `New Serum ${index}`, raw, raw),
      importRow(index * 2 + 3, 'Existing Mask', raw, raw),
    ])
    const results = await classifyProducts(database, rows, 'job-discount-dates', null, new Map())
    READABLE.forEach(([raw, iso], index) => {
      for (const result of [results[index * 2], results[index * 2 + 1]]) {
        assert.notEqual(result.action, 'error', `"${raw}" is readable: ${result.message}`)
        assert.equal(result.data.discount_starts_at, iso, `start "${raw}"`)
        assert.equal(result.data.discount_ends_at, iso, `end "${raw}"`)
      }
    })
    assert.deepEqual(results.map((r) => r.action), READABLE.flatMap(() => ['create', 'update']))
    for (const result of results) {
      const stored = result.data.discount_ends_at
      if (stored) assert.equal(database.db.prepare('SELECT date(?) AS d').get(stored).d, stored, 'SQL reads the stored value as the same day')
    }
  })

  await check('product import refuses an ambiguous or unreadable discount date with a reason naming the cell', async () => {
    const database = importDb()
    const results = await classifyProducts(database, [
      importRow(2, 'Ambiguous End', '2026-10-01', '05/10/2026'),
      importRow(3, 'Garbage Start', 'next friday', '2026-12-31'),
      importRow(4, 'No Such Day', '2026-01-01', '30/02/2026'),
      importRow(5, 'Existing Mask', '2026-10-01', '05/10/2026'),
    ], 'job-bad-discount-dates', null, new Map())
    assert.deepEqual(results.map((r) => r.action), ['error', 'error', 'error', 'error'])
    assert.match(results[0].message, /Discount end date "05\/10\/2026"/)
    assert.match(results[0].message, /2026-10-05/)
    assert.match(results[0].message, /2026-05-10/)
    assert.match(results[0].message, /YYYY-MM-DD/)
    assert.match(results[1].message, /Discount start date "next friday" is not a date/)
    assert.match(results[2].message, /Discount end date "30\/02\/2026" is not a date/)
    assert.equal(results[3].existingId, null, 'a refused row never reaches the matched product')
  })

  await check('stock-in session stores discount dates as YYYY-MM-DD and refuses an unreadable one', async () => {
    const sql = new Database(':memory:')
    sql.pragma('foreign_keys = OFF')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
    }
    sql.pragma('foreign_keys = ON')
    sql.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
    const wrap = (text, params = []) => ({
      text, params,
      async first() { return sql.prepare(text).get(...params) || null },
      async all() { return { results: sql.prepare(text).all(...params) } },
      async run() {
        const result = sql.prepare(text).run(...params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      },
    })
    const env = { DB: {
      prepare(text) {
        const bare = wrap(text)
        return { bind(...params) { return wrap(text, params) }, first: () => bare.first(), all: () => bare.all(), run: () => bare.run() }
      },
      async batch(statements) {
        return sql.transaction(() => statements.map((statement) => {
          const result = sql.prepare(statement.text).run(...statement.params)
          return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
        }))()
      },
    } }
    const user = { id: 7, username: 'admin', name: 'Stock User', organization_id: null, role_id: null, permissions: JSON.stringify({ all: true }), is_active: 1 }
    const session = (requestId, barcode, starts, ends) => commitStockSession(env, user, {
      client_request_id: requestId, mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-29' },
      items: [{ line_id: `${requestId}-line`, kind: 'create_receive', quantity: 0, product: {
        name: `Session ${barcode}`, barcode, cost_price_usd: 1, selling_price_usd: 2, stock_quantity: 0, branch_id: 1,
        discount_enabled: 1, discount_percent: 10, discount_starts_at: starts, discount_ends_at: ends,
      } }],
    })
    await session('discount-session-iso', 'SESSION-ISO', '2026-10-05', '2026-12-31')
    await session('discount-session-typed', 'SESSION-TYPED', '05/10/2026', '31/12/2026')
    const stored = (barcode) => sql.prepare('SELECT discount_starts_at s, discount_ends_at e FROM products WHERE barcode = ?').get(barcode)
    assert.deepEqual({ ...stored('SESSION-ISO') }, { s: '2026-10-05', e: '2026-12-31' })
    assert.deepEqual({ ...stored('SESSION-TYPED') }, { s: '2026-10-05', e: '2026-12-31' }, 'a typed date is read day-first, as the app types it')
    await assert.rejects(session('discount-session-bad', 'SESSION-BAD', '2026-10-05', 'soon'),
      (error) => error.statusCode === 400 && error.code === 'invalid_request' && /discount_ends_at/.test(error.message))
    assert.equal(stored('SESSION-BAD'), undefined, 'nothing was written for the refused session')
  })

  console.log(`\n${checks} discount date checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
