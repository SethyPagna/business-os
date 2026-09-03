// GET /api/returns/receipt-lookup -- the server side of the new-return
// receipt typeahead, driven through the REAL Hono route against a real
// in-memory SQLite database with the real migration chain applied.
//
// What this pins:
//   - a partial bare `YYYYMMDD-HHMMSS` number matches (the typeahead's whole
//     point: you type four digits, you get candidates)
//   - a digits-only query matches across the format's separators, so
//     "202609031430" finds "20260903-143000"
//   - the legacy `NNNNNN@YYYY-MM-DD` numbers still in production history match
//   - sales.legacy_receipt_number is used WHEN IT EXISTS and the query still
//     answers (200, no "no such column") when it does not -- the receipt
//     lane's migration 0107 adds it, and this route ships before that lands
//   - cancelled sales never appear (a cancelled sale cannot be returned)
//   - the row cap holds at 20
//
// Run (from cloudflare/): node scripts/test-returns-receipt-lookup-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: (params) => stmt.get(params),
      all: (params) => stmt.all(params) ?? [],
      run: (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) {
    const results = []
    for (const item of items) {
      const stmt = rawDb.prepare(item.sql)
      const r = stmt.run(item.params || {})
      results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
    }
    return results
  },
  async transaction(fn) { return fn(this) },
}
const fakeEnv = { DB: db }

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const batchCode = loadReal('lib/batchCode.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': sqlBinding })
const permissions = loadReal('lib/permissions.ts')

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ returns: true }) }

const returnsRoute = loadReal('routes/returns.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/businessDateWindow': loadReal('lib/businessDateWindow.ts'),
  '../lib/sqlBinding': sqlBinding,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../lib/telegram': { sendReturnTelegramEvent: async () => false, sendTelegramEvent: async () => false, formatSaleTelegramLines: () => [] },
  '../lib/permissions': permissions,
  '../lib/conflictControl': {
    assertUpdatedAtMatch: () => {},
    getExpectedUpdatedAt: () => undefined,
    writeConflictResponse: (err) => ({ body: { error: String(err) }, status: 409 }),
    WriteConflictError: class WriteConflictError extends Error {},
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/searchMatch': { buildLikeAliasClause: () => '1=1', tokenizeSearchTermGroups: () => [], normalizeSearchText: (value) => String(value || '') },
  '../lib/productBatches': productBatches,
  '../lib/returnsStock': loadReal('lib/returnsStock.ts', { './db': { getDb: () => db }, './productBatches': productBatches, './sqlBinding': sqlBinding }),
  '../lib/receiptNumber': { uniqueBusinessDateTimeNumber: async (prefix) => `${prefix ? `${prefix}-` : ''}20260830-120000` },
})

const app = returnsRoute.default
const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function lookup(query, extra = '') {
  const res = await app.request(`/receipt-lookup?query=${encodeURIComponent(query)}${extra}`, { method: 'GET' }, fakeEnv, fakeExecutionCtx)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function seed() {
  rawDb.exec('DELETE FROM sale_items; DELETE FROM sales; DELETE FROM branches;')
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  const rows = [
    { id: 1, receipt: '20260903-143000', customer: 'Dara', total: 12.5, status: 'completed', created: '2026-09-03 14:30:00' },
    { id: 2, receipt: '20260903-091500', customer: 'Sophea', total: 4.25, status: 'completed', created: '2026-09-03 09:15:00' },
    { id: 3, receipt: '000123@2026-08-30', customer: 'Legacy Walk-in', total: 9, status: 'completed', created: '2026-08-30 10:00:00' },
    { id: 4, receipt: '20260902-101010', customer: 'Cancelled Sale', total: 7, status: 'cancelled', created: '2026-09-02 10:10:10' },
  ]
  for (const row of rows) {
    rawDb.prepare(`
      INSERT INTO sales (id, receipt_number, customer_name, branch_id, branch_name, total_usd, total_khr, sale_status, created_at)
      VALUES (@id, @receipt, @customer, 1, 'Shop', @total, 0, @status, @created)
    `).run(row)
  }
}

function receiptsOf(json) {
  return (Array.isArray(json) ? json : []).map((row) => row.receipt_number)
}

async function main() {
  await check('a partial bare receipt number lists every matching candidate, newest first', async () => {
    seed()
    const { status, json } = await lookup('20260903')
    assert.strictEqual(status, 200, JSON.stringify(json))
    assert.deepStrictEqual(receiptsOf(json), ['20260903-143000', '20260903-091500'])
    assert.strictEqual(json[0].customer_name, 'Dara', 'the row carries the customer for the typeahead line')
    assert.strictEqual(Number(json[0].total_usd), 12.5, 'the row carries the total for the typeahead line')
    assert.ok(json[0].created_at, 'the row carries the date for the typeahead line')
  })

  await check('a mid-string fragment spanning the separator still matches', async () => {
    seed()
    const { json } = await lookup('0903-1430')
    assert.deepStrictEqual(receiptsOf(json), ['20260903-143000'])
  })

  await check('a digits-only query matches across the format separators', async () => {
    seed()
    const { json } = await lookup('202609031430')
    assert.deepStrictEqual(receiptsOf(json), ['20260903-143000'], 'digits-only "202609031430" must find "20260903-143000"')
  })

  await check('a legacy NNNNNN@YYYY-MM-DD number in production history is findable', async () => {
    seed()
    const byNumber = await lookup('000123')
    assert.ok(receiptsOf(byNumber.json).includes('000123@2026-08-30'), 'legacy receipt should match on its number part')
    const byDate = await lookup('123@2026-08')
    assert.deepStrictEqual(receiptsOf(byDate.json), ['000123@2026-08-30'], 'legacy receipt should match on the whole string too')
  })

  await check('a cancelled sale never appears as a returnable receipt', async () => {
    seed()
    const { json } = await lookup('20260902')
    assert.deepStrictEqual(receiptsOf(json), [], 'a cancelled sale cannot be returned, so it is not offered')
  })

  await check('a query shorter than two characters returns nothing rather than the whole table', async () => {
    seed()
    const { status, json } = await lookup('2')
    assert.strictEqual(status, 200)
    assert.deepStrictEqual(json, [])
  })

  await check('the row cap holds at 20 even when more receipts match', async () => {
    seed()
    for (let i = 0; i < 30; i += 1) {
      const stamp = String(i).padStart(2, '0')
      rawDb.prepare(`
        INSERT INTO sales (receipt_number, customer_name, branch_id, branch_name, total_usd, total_khr, sale_status, created_at)
        VALUES (@receipt, 'Bulk', 1, 'Shop', 1, 0, 'completed', @created)
      `).run({ receipt: `20260901-1200${stamp}`, created: `2026-09-01 12:00:${stamp}` })
    }
    const { json } = await lookup('20260901')
    assert.strictEqual(json.length, 20, 'the typeahead must never stream more than 20 rows')
    const capped = await lookup('20260901', '&limit=100')
    assert.strictEqual(capped.json.length, 20, 'an oversized ?limit is clamped, not honored')
  })

  // The receipt lane's migration 0107 adds sales.legacy_receipt_number when
  // no such column exists. This route ships before that, so it must answer
  // correctly on BOTH shapes of the table -- that is the whole reason the
  // column is probed rather than assumed.
  await check('the lookup answers on a pre-0107 database (no legacy_receipt_number column)', async () => {
    seed()
    const columns = rawDb.prepare('PRAGMA table_info("sales")').all().map((row) => row.name)
    assert.ok(!columns.includes('legacy_receipt_number'), 'sanity: the base migration chain has no legacy column yet')
    const { status, json } = await lookup('20260903')
    assert.strictEqual(status, 200, 'a pre-0107 database must not 500 on "no such column"')
    assert.strictEqual(json.length, 2)
    assert.strictEqual(json[0].legacy_receipt_number, null, 'the field is still present in the payload, as NULL')
  })

  await check('once legacy_receipt_number exists it is matched and returned', async () => {
    seed()
    rawDb.exec('ALTER TABLE sales ADD COLUMN legacy_receipt_number TEXT')
    // Bound, not inlined: the @name translator in lib/db.ts (and this
    // harness) rewrites @word anywhere in the SQL text, literals included.
    rawDb.prepare('UPDATE sales SET legacy_receipt_number = @legacy WHERE id = 1').run({ legacy: '004488@2026-09-03' })
    // The route caches a negative probe for a minute; call the exported
    // builder directly so this assertion tests the SQL, not the cache clock.
    const built = returnsRoute.buildReceiptLookupQuery({ query: '004488', limit: 20, hasLegacyColumn: true })
    assert.ok(built, 'a three-character query builds a real statement')
    const rows = rawDb.prepare(built.sql).all(built.params)
    assert.deepStrictEqual(rows.map((row) => row.receipt_number), ['20260903-143000'], 'the sale is found through its legacy number')
    assert.strictEqual(rows[0].legacy_receipt_number, '004488@2026-09-03', 'the legacy number rides along for display')

    const digitsOnly = returnsRoute.buildReceiptLookupQuery({ query: '00448820260903', limit: 20, hasLegacyColumn: true })
    const digitRows = rawDb.prepare(digitsOnly.sql).all(digitsOnly.params)
    assert.deepStrictEqual(digitRows.map((row) => row.receipt_number), ['20260903-143000'], 'digits-only also folds the legacy separators')

    // And the same query built for a table WITHOUT the column must never
    // name it -- that is what keeps the pre-0107 path alive.
    const legacyFree = returnsRoute.buildReceiptLookupQuery({ query: '004488', limit: 20, hasLegacyColumn: false })
    assert.ok(!legacyFree.sql.includes('s.legacy_receipt_number'), 'the pre-0107 statement must not reference the column at all')
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
