'use strict'
// INV-B S8: the Stock Changes list paged by cursor (read switch ledger_keyset) must be the offset list, page for page.
//
// Runs the REAL SQL of lib/stockLedgerQuery.ts and lib/stockLedgerKeyset.ts (bundled, no stubs) on the real migration chain, over a ledger built to
// break every plausible wrong implementation:
//   - created_at in BOTH stored forms ('YYYY-MM-DD HH:MM:SS' and ISO 'YYYY-MM-DDTHH:MM:SS.sssZ') on the same days, so the raw string order differs from the
//     instant order ("a keyset on the raw column" skips and repeats rows);
//   - runs of rows at ONE instant (written in the two forms, with consecutive ids) that straddle every page boundary ("a keyset on the instant alone" drops
//     the tie or repeats it; "a keyset on id alone" follows the wrong order);
//   - rows with a NULL created_at (they sort last);
//   - rows either side of business midnight (17:00 UTC) and of a day's UTC edge, under startDate/endDate/startTime/endTime in Phnom Penh time;
//   - several products, branches, in/out types, so branch, product, view and search filters change the set.
// For every filter set and page size the cursor walk must return the same rows, in the same order, page by page, with the same before/after, as the offset
// walk; page 1 must also carry the same total, totalPages and summary; a cursor page must carry none of them (no COUNT) unless it asks; and a cursor must
// stay valid while newer rows arrive (the offset walk would shift).
//
// Run (from cloudflare/): node scripts/test-stock-ledger-keyset-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const load = (file) => {
  const result = buildSync({ entryPoints: [path.join(root, 'src', 'lib', file)], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}
const kernel = load('stockLedgerQuery.ts')
const keyset = load('stockLedgerKeyset.ts')

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log('PASS', name) }

const db = openDb(loadAll())
const stockWrite = (fn) => {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    fn()
    db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

// ---- the fixture -------------------------------------------------------------------------------------------------------------------------------
const PRODUCTS = [[9101, 'Keyset Serum', '8801000000011'], [9102, 'Keyset Cream', '8801000000028'], [9103, 'Keyset Balm', '8801000000035']]
stockWrite(() => {
  for (const [id, name, barcode] of PRODUCTS) db.prepare('INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (@id, @name, @barcode, @unit, @stock, 1)').bind({ id, name, barcode, unit: 'pcs', stock: 40 }).run()
})
let seed = 20261104
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 10) % n }
const OUT_TYPES = ['sale', 'remove', 'transfer_out', 'damage_out']
const IN_TYPES = ['add', 'return', 'transfer_in', 'stock_in']
const pad = (n, w = 2) => String(n).padStart(w, '0')
const space = (day, h, m, s) => `2026-10-${pad(day)} ${pad(h)}:${pad(m)}:${pad(s)}`
const iso = (day, h, m, s) => `2026-10-${pad(day)}T${pad(h)}:${pad(m)}:${pad(s)}.000Z`
let nextId = 1
const insert = (createdAt, over = {}) => {
  const pick = rnd(8)
  const type = over.type || (pick < 4 ? OUT_TYPES[rnd(4)] : IN_TYPES[rnd(4)])
  const [pid, pname] = PRODUCTS[over.product ?? rnd(3)]
  db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_name, created_at)
    VALUES (@id, @pid, @pname, @branch, @bname, @type, @qty, @reason, 'tester', @createdAt)`)
    .bind({ id: nextId++, pid, pname, branch: over.branch ?? 1 + rnd(2), bname: 'Branch', type, qty: 1 + rnd(5), reason: 'fixture', createdAt }).run()
}
// Ten days. Each day: rows in both forms, deliberately interleaved so raw order and instant order disagree.
for (let day = 1; day <= 10; day += 1) {
  for (let k = 0; k < 14; k += 1) {
    const h = rnd(24), m = rnd(60), s = rnd(60)
    insert(rnd(2) ? space(day, h, m, s) : iso(day, h, m, s))
  }
  // Ties: the SAME instant in both forms, consecutive ids, several rows -- at an hour that moves with the day so the run lands on different page offsets.
  const th = 3 + day, tm = 15, ts = day
  insert(space(day, th, tm, ts)); insert(iso(day, th, tm, ts)); insert(space(day, th, tm, ts)); insert(iso(day, th, tm, ts)); insert(space(day, th, tm, ts))
}
// Business midnight is 17:00 UTC: rows either side of it, on both days, in both forms, and at the UTC day's own edges.
for (const [day, h, m, s] of [[3, 16, 59, 59], [3, 17, 0, 0], [3, 17, 0, 1], [4, 16, 59, 59], [4, 17, 0, 0], [5, 0, 0, 0], [5, 23, 59, 59], [6, 0, 0, 0]]) {
  insert(space(day, h, m, s)); insert(iso(day, h, m, s))
}
// Rows with no created_at: they sort last in both orders.
for (let k = 0; k < 4; k += 1) insert(null)
const TOTAL = db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n

// ---- the two walks -----------------------------------------------------------------------------------------------------------------------------
const run = (sql, params) => db.prepare(sql).bind(params).all()
const offsetPage = (filters, page, pageSize) => {
  const q = kernel.buildStockLedgerQuery(filters)
  return kernel.attachBeforeQty(run(q.rowsSql, { ...q.params, limit: pageSize, offset: (page - 1) * pageSize }))
}
const offsetTotals = (filters) => {
  const q = kernel.buildStockLedgerQuery(filters)
  const summary = db.prepare(q.summarySql).bind(q.params).get()
  return { total: db.prepare(q.countSql).bind(q.params).get().total, summary: { inCount: Number(summary.in_count || 0), outCount: Number(summary.out_count || 0), inQty: Number(summary.in_qty || 0), outQty: Number(summary.out_qty || 0), total: Number(summary.total || 0) } }
}
const asyncDb = { prepare: (sql) => ({ all: async (params) => db.prepare(sql).bind(params).all(), get: async (params) => db.prepare(sql).bind(params).get() }) }
const cursorPage = (filters, page, pageSize, cursor, totals = false) => keyset.readStockLedgerKeyset(asyncDb, kernel.buildStockLedgerQuery(filters), { page, pageSize, cursor, totals, view: filters.view || 'all' })

async function walkOffset(filters, pageSize) {
  const pages = []
  for (let page = 1; page < 400; page += 1) {
    const items = offsetPage(filters, page, pageSize)
    if (!items.length) break
    pages.push(items)
  }
  return pages
}
async function walkCursor(filters, pageSize) {
  const pages = []
  const bodies = []
  let cursor = null
  for (let page = 1; page < 400; page += 1) {
    const body = await cursorPage(filters, page, pageSize, cursor)
    bodies.push(body)
    if (!body.items.length) break
    pages.push(body.items)
    if (body.next_cursor === null) break
    cursor = keyset_decode(body.next_cursor)
    assert.ok(cursor, `page ${page}: the cursor decodes`)
  }
  return { pages, bodies }
}
const keyset_decode = (token) => kernel.decodeStockLedgerCursor(token)

const FILTERS = {
  'everything': {},
  'view in': { view: 'in' },
  'view out': { view: 'out' },
  'branch 1': { branchId: 1 },
  'branch 2, view out': { branchId: 2, view: 'out' },
  'product 9101': { productId: 9101 },
  'product 9102 at branch 1': { productId: 9102, branchId: 1 },
  'search by name': { search: 'Cream' },
  'search by barcode': { search: '8801000000035' },
  'dates 3..5 (Phnom Penh)': { startDate: '2026-10-03', endDate: '2026-10-05' },
  'one Phnom Penh day across UTC midnight': { startDate: '2026-10-04', endDate: '2026-10-04' },
  'date and clock window': { startDate: '2026-10-02', endDate: '2026-10-08', startTime: '09:00', endTime: '18:00' },
  'clock window only': { startTime: '00:00', endTime: '06:00' },
  'dates, branch and view': { startDate: '2026-10-02', endDate: '2026-10-09', branchId: 1, view: 'in' },
}

async function main() {
  await check('fixture: both stored forms, ties at one instant, business-midnight rows and NULL created_at are all present', async () => {
    assert.ok(TOTAL > 150, `ledger holds ${TOTAL} rows`)
    const q = (sql) => db.prepare(sql).get().n
    assert.ok(q("SELECT COUNT(*) AS n FROM inventory_movements WHERE created_at LIKE '%T%'") > 40, 'ISO rows')
    assert.ok(q("SELECT COUNT(*) AS n FROM inventory_movements WHERE created_at LIKE '% %'") > 40, 'space-form rows')
    assert.equal(q('SELECT COUNT(*) AS n FROM inventory_movements WHERE created_at IS NULL'), 4)
    assert.ok(q(`SELECT COUNT(*) AS n FROM (SELECT ${kernel.movementInstantSql('m')} AS i FROM inventory_movements m WHERE created_at IS NOT NULL GROUP BY i HAVING COUNT(*) >= 3)`) >= 10, 'runs of rows at one instant')
    // The control: raw order and instant order DO disagree on this ledger, so a keyset on the raw column would be caught below.
    const raw = db.prepare('SELECT id FROM inventory_movements ORDER BY created_at DESC, id DESC').all().map((r) => r.id)
    const byInstant = db.prepare(`SELECT id FROM inventory_movements m ORDER BY ${kernel.movementInstantSql('m')} DESC, id DESC`).all().map((r) => r.id)
    assert.notDeepEqual(raw, byInstant, 'raw string order differs from instant order here')
  })

  for (const [name, filters] of Object.entries(FILTERS)) {
    await check(`cursor walk equals offset walk, page by page, at page sizes 1, 2, 3, 7, 25: ${name}`, async () => {
      const expectedTotals = offsetTotals(filters)
      let rowsSeen = 0
      for (const pageSize of [1, 2, 3, 7, 25]) {
        if (pageSize === 1 && expectedTotals.total > 120) continue
        const offset = await walkOffset(filters, pageSize)
        const { pages, bodies } = await walkCursor(filters, pageSize)
        assert.equal(pages.length, offset.length, `${name}, size ${pageSize}: same number of pages`)
        for (let index = 0; index < offset.length; index += 1) {
          assert.deepEqual(pages[index].map((r) => r.id), offset[index].map((r) => r.id), `${name}, size ${pageSize}, page ${index + 1}: same rows in the same order`)
          assert.deepEqual(pages[index], offset[index], `${name}, size ${pageSize}, page ${index + 1}: same fields, before/after included`)
        }
        rowsSeen = offset.flat().length
        assert.equal(rowsSeen, expectedTotals.total, `${name}, size ${pageSize}: the walk visits every row once`)
        assert.equal(new Set(offset.flat().map((r) => r.id)).size, rowsSeen, 'no row repeated')
        // page 1 carries what the offset list carries; no later page carries a total, a count or a summary
        const first = bodies[0]
        assert.equal(first.total, expectedTotals.total); assert.deepEqual(first.summary, expectedTotals.summary)
        assert.equal(first.totalPages, Math.max(1, Math.ceil(expectedTotals.total / pageSize)))
        for (const later of bodies.slice(1)) for (const key of ['total', 'totalPages', 'summary']) assert.equal(key in later, false, `${name}: a cursor page has no ${key}`)
        if (offset.length) assert.equal(bodies[offset.length - 1].next_cursor === null, offset[offset.length - 1].length < pageSize || bodies.length === offset.length, 'the last page ends the walk')
      }
    })
  }

  await check('a cursor page may ask for the totals again (after a write) and then carries exactly the offset list totals', async () => {
    const filters = { branchId: 1 }
    const first = await cursorPage(filters, 1, 10, null)
    const second = await cursorPage(filters, 2, 10, kernel.decodeStockLedgerCursor(first.next_cursor), true)
    const expected = offsetTotals(filters)
    assert.equal(second.total, expected.total); assert.deepEqual(second.summary, expected.summary)
    assert.equal(second.totalPages, Math.ceil(expected.total / 10))
    assert.deepEqual(second.items, offsetPage(filters, 2, 10))
  })

  await check('page 1 spends one statement on the count and the summary when there is no In/Out view (the summary already counts the same rows), and both when there is', async () => {
    for (const [filters, spared] of [[{}, true], [{ branchId: 1 }, true], [{ view: 'in' }, false], [{ view: 'out', branchId: 2 }, false]]) {
      const prepared = []
      const spy = { prepare: (sql) => { prepared.push(sql); return asyncDb.prepare(sql) } }
      const query = kernel.buildStockLedgerQuery(filters)
      const body = await keyset.readStockLedgerKeyset(spy, query, { page: 1, pageSize: 10, cursor: null, totals: false, view: filters.view || 'all' })
      assert.equal(prepared.includes(query.countSql), !spared, JSON.stringify(filters) + (spared ? ': no separate count' : ': the count runs'))
      assert.equal(prepared.includes(query.summarySql), true)
      assert.equal(body.total, offsetTotals(filters).total, JSON.stringify(filters) + ': the same total either way')
    }
  })

  await check('the first request with a page number past 1 (a deep link) answers the offset page and hands out the cursor', async () => {
    const body = await cursorPage({}, 4, 10, null)
    assert.deepEqual(body.items, offsetPage({}, 4, 10))
    assert.equal(body.page, 4)
    const next = await cursorPage({}, 5, 10, kernel.decodeStockLedgerCursor(body.next_cursor))
    assert.deepEqual(next.items, offsetPage({}, 5, 10), 'and the cursor continues at page 5')
  })

  await check('the tail of the ledger: dated rows run out into the rows with no date, and the walk ends exactly at the last row', async () => {
    const all = (await walkCursor({}, 7)).pages.flat().map((r) => r.id)
    const nullIds = db.prepare('SELECT id FROM inventory_movements WHERE created_at IS NULL ORDER BY id DESC').all().map((r) => r.id)
    assert.deepEqual(all.slice(-4), nullIds, 'the four NULL rows come last, newest id first')
    assert.equal(all.length, TOTAL)
    // a cursor that IS a NULL row continues with the older NULL rows only
    const page = await cursorPage({}, 1, 2, { d: null, i: null, id: nullIds[0] })
    assert.deepEqual(page.items.map((r) => r.id), nullIds.slice(1, 3))
  })

  await check('a cursor is a position: rows that arrive newer do not move the next page (the offset page would shift)', async () => {
    const filters = { branchId: 1 }
    const first = await cursorPage(filters, 1, 10, null)
    const before = await cursorPage(filters, 2, 10, kernel.decodeStockLedgerCursor(first.next_cursor))
    const offsetBefore = offsetPage(filters, 2, 10).map((r) => r.id)
    for (let k = 0; k < 3; k += 1) insert(space(10, 23, 59, 50 + k), { branch: 1 })
    const after = await cursorPage(filters, 2, 10, kernel.decodeStockLedgerCursor(first.next_cursor))
    assert.deepEqual(after.items.map((r) => r.id), before.items.map((r) => r.id), 'the cursor page is unchanged')
    assert.notDeepEqual(offsetPage(filters, 2, 10).map((r) => r.id), offsetBefore, 'control: the offset page did shift')
  })

  await check('a row that ties with the cursor row at the same instant is neither repeated nor skipped, on every boundary of a run of ties', async () => {
    const tied = db.prepare(`SELECT id FROM inventory_movements m WHERE ${kernel.movementInstantSql('m')} = '2026-10-05 08:15:05.000' ORDER BY id DESC`).all().map((r) => r.id)
    assert.ok(tied.length >= 5, `a run of ${tied.length} rows at one instant`)
    const whole = (await walkCursor({}, 1)).pages.flat().map((r) => r.id)
    const at = whole.indexOf(tied[0])
    assert.deepEqual(whole.slice(at, at + tied.length), tied, 'the run keeps its id order and sits together')
  })

  await check('cursors: round trip, and everything that is not one of ours is refused', async () => {
    for (const cursor of [{ d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 77 }, { d: null, i: null, id: 5 }]) assert.deepEqual(kernel.decodeStockLedgerCursor(kernel.encodeStockLedgerCursor(cursor)), cursor)
    const good = kernel.encodeStockLedgerCursor({ d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 77 })
    const forged = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    for (const bad of [undefined, null, '', 'x', 'not a cursor', good.slice(0, -3), good + 'AAAA', '%%%%%%%%%%', forged({ v: 2, d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 1 }),
      forged({ v: 1, d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 0 }), forged({ v: 1, d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 'x' }),
      forged({ v: 1, d: "2026-10-05'; DROP TABLE x;--", i: '2026-10-05 08:15:05.000', id: 1 }), forged({ v: 1, d: '2026-10-05', i: 'x'.repeat(80), id: 1 }),
      forged({ v: 1, d: null, i: '2026-10-05 08:15:05.000', id: 1 }), forged([]), forged(7), 'A'.repeat(300)]) {
      assert.equal(kernel.decodeStockLedgerCursor(bad), null, `refused: ${String(bad).slice(0, 40)}`)
    }
  })

  await check('the offset list SQL is untouched: rowsSqlWith with nothing extra is exactly rowsSql, and carries no cursor columns', async () => {
    for (const filters of Object.values(FILTERS)) {
      const q = kernel.buildStockLedgerQuery(filters)
      assert.equal(q.rowsSqlWith('', 'offset', false), q.rowsSql)
      assert.doesNotMatch(q.rowsSql, /keyset_/)
      assert.match(q.rowsSql, /LIMIT @limit OFFSET @offset/)
      const plan = kernel.planStockLedgerKeyset(q, { d: '2026-10-05', i: '2026-10-05 08:15:05.000', id: 77 })
      assert.doesNotMatch(plan.rowsSql, /OFFSET/, 'the cursor statement has no OFFSET and no skip count')
      assert.doesNotMatch(plan.rowsSql, /COUNT\(\*\)\s+FROM inventory_movements m/, 'and no count of the rows before it')
      assert.match(plan.rowsSql, /m\.created_at < @cursorDayEnd/, 'it is bounded by the cursor day on the raw column (a seek)')
    }
  })

  console.log(`\n${passed} stock ledger keyset checks passed (${TOTAL} movements)`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
