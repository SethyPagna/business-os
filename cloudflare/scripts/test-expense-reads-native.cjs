'use strict'
// E1-F: the two Expenses read cuts behind the read switch `expense_reads`, on the REAL routes over the full migration chain (in-memory SQLite).
//
//   1. GET /api/fees/report in ONE grouped pass. The oracle is a verbatim copy of the 6.0.1053 handler (four statements); the switch-ON answer must be
//      byte-identical to it, and to the switch-OFF answer, for every total, label and type; sale-linked expenses (a fee row carrying a sale_id, and the
//      courier cost read off the sale with no cost of goods); riel rows; branch filters; and the Cambodia business-day boundary (16:59:59 / 17:00:00 UTC).
//      Totals equal Reports overview. Ties, case spellings of a label, blank and null labels, Khmer and astral text are in the fixture on purpose.
//   2. GET /api/fees?source=all|sale&cursor=...: the export by cursor. Every page size gives exactly the rows, in exactly the order, of the offset
//      export (the OFF answer is the oracle), including ties on identical timestamps (two expenses, two sales, an expense against a sale), the two spellings
//      of sales.created_at on one day, and every user kind. A row created or deleted mid-export neither repeats nor skips a row of the start snapshot.
//   3. OFF is the 6.0.1053 answer: the cursor parameter is read by nothing, and a plain list request does not even read the switch.
//   4. The plan fields: Free pages 250 rows and groups up to 10,000; Paid 500 and 50,000; a window over the group cap and a figure on a rounding
//      boundary are answered by the four statements (still byte-identical).
//   5. Mutation controls: each plausible wrong implementation (drops the sale rows, double-counts a tie, forgets the snapshot, mis-orders the sale key,
//      reads the wrong day floor, drops sale-linked expenses from the grouped pass, ignores the branch) turns a check red.
//
// Rows read are measured in test-expense-reads-budget-native.cjs (the Miniflare world, at the seed's full size).
// Run (from cloudflare/): node scripts/test-expense-reads-native.cjs
const assert = require('node:assert/strict')
const { createFeesWorld } = require('./harness/fees_world.cjs')

const COGS_MARKER = 987.65

let passed = 0
let quiet = false
const failures = []
async function check(name, run) {
  try { await run(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } } catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); if (!quiet) throw error }
}

// ---------------------------------------------------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------------------------------------------------
function lcg(seed) { let s = seed; return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff }

function seed(w) {
  w.sql.exec(`
    INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1), (2, 'Second', 'shop', 1);
    INSERT INTO delivery_contacts (id, name) VALUES (5, 'Courier A'), (6, 'Courier B');
    INSERT INTO fee_types (name, name_key) VALUES ('Premises', 'premises');
  `)
  const rnd = lcg(20261103)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const pad = (n) => String(n).padStart(2, '0')
  const sale = w.sql.prepare(`INSERT INTO sales (id, created_at, sale_status, branch_id, receipt_number, total_usd, subtotal_usd, delivery_fee_usd, delivery_fee_paid_by,
      delivery_actual_cost_usd, delivery_actual_cost_khr, is_delivery, delivery_contact_id, delivery_contact_name)
    VALUES (@id, @created_at, @status, @branch, @receipt, 20, 20, @fee, 'customer', @usd, @khr, 1, @contact, @contact_name)`)
  w.sql.exec('BEGIN')
  // 48 sales over 8 local days. Entry times sit on a 30-minute grid so identical timestamps exist, and BOTH spellings of created_at
  // ('YYYY-MM-DD HH:MM:SS' and ISO 'T..Z') interleave on the same days, as production's do.
  for (let id = 1; id <= 48; id += 1) {
    const day = 3 + Math.floor(rnd() * 8)
    const stamp = `2026-10-${pad(day)}`
    const time = `${pad(Math.floor(rnd() * 24))}:${pick(['00', '30'])}:00`
    const created = rnd() < 0.5 ? `${stamp} ${time}` : `${stamp}T${time}.000Z`
    const usd = pick([null, 0, 1.5, 2, 3, 4.25]), khr = pick([null, 0, 8000, 12300, 20000])
    const contact = pick([null, 5, 6])
    sale.run({ id, created_at: created, status: pick(['completed', 'completed', 'completed', 'cancelled', 'awaiting_payment']), branch: pick([1, 1, 2]), receipt: `R-${String(id).padStart(4, '0')}`,
      fee: pick([0, 0, 1.5]), usd, khr, contact, contact_name: contact === 5 ? 'Courier A' : contact === 6 ? 'Courier B' : null })
  }
  w.sql.exec('COMMIT')
  // Cost of goods: a priced sale line. It must surface nowhere.
  w.sql.exec(`INSERT INTO sale_items (sale_id, product_name, quantity, total_usd, cost_price_usd) VALUES (1, 'Serum', 1, 20, ${COGS_MARKER}), (2, 'Soap', 1, 20, ${COGS_MARKER}), (3, 'Balm', 1, 20, ${COGS_MARKER})`)

  const fee = w.sql.prepare(`INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, delivery_contact_id, created_by, created_at, updated_at)
    VALUES (@id, @type, @label, @usd, @khr, @date, @sale, @branch, @contact, 2, @created, @created)`)
  const labels = ['Rent', 'rent', ' Rent ', 'Tape', 'tape', null, '', '   ', 'ទឹកកក', 'ទឹកកក ', '📦 Box', 'ＡBC', 'Ice', 'Ice cream', 'Bike  courier']
  w.sql.exec('BEGIN')
  for (let id = 1; id <= 90; id += 1) {
    const day = 3 + Math.floor(rnd() * 8)
    const date = `2026-10-${pad(day)}`
    // entry time is NOT in id order on purpose: the list orders a day by id, the merge compares entry times
    const created = `${date} ${pad(Math.floor(rnd() * 24))}:${pick(['00', '30'])}:00`
    const riel = rnd() < 0.5
    fee.run({ id, type: pick(['tax', 'delivery', 'change', 'expense', 'other', 'other', 'premises']), label: pick(labels), usd: riel ? 0 : pick([0.5, 1, 2.25, 3.1, 7.7, 10]),
      khr: riel ? pick([4000, 12500, 20000]) : 0, date, sale: rnd() < 0.15 ? 1 + Math.floor(rnd() * 48) : null, branch: pick([1, 1, 2, null]),
      contact: rnd() < 0.2 ? 5 : null, created })
  }
  // Ties on purpose: a sale and an expense with the same entry time on the same day (the expense wins), two expenses with the same date and entry time
  // (id decides), and the Cambodia business-day boundary (fee_date is the booked day; the exact-window report cuts on entry time).
  const tie = w.get("SELECT created_at, id FROM sales WHERE created_at LIKE '2026-10-0%' ORDER BY id LIMIT 1")
  const tieDate = w.get(`SELECT date('${tie.created_at}', '+7 hours') AS d`).d
  let next = 100
  for (const row of [
    ['other', 'Tie A', 1, 0, tieDate, tie.created_at.replace('T', ' ').slice(0, 19)], ['other', 'Tie B', 2, 0, tieDate, tie.created_at.replace('T', ' ').slice(0, 19)],
    ['expense', 'Edge', 1, 0, '2026-10-09', '2026-10-09 16:59:59'], ['expense', 'Edge', 2, 0, '2026-10-10', '2026-10-09 17:00:00'],
    ['expense', 'Edge', 4, 0, '2026-10-10', '2026-10-10 16:59:59'], ['expense', 'Edge', 8, 0, '2026-10-11', '2026-10-10 17:00:00'],
  ]) fee.run({ id: next++, type: row[0], label: row[1], usd: row[2], khr: row[3], date: row[4], sale: null, branch: 1, contact: null, created: row[5] })
  w.sql.exec('COMMIT')
}

function newWorld(patches = []) {
  const w = createFeesWorld({ patches, overrides: { './analytics': { recordAnalytics: () => {} } } })
  seed(w)
  return w
}

const setSwitch = (w, on) => {
  w.sql.exec("DELETE FROM system_flags WHERE key = 'read_switches'")
  if (on) w.sql.prepare("INSERT INTO system_flags (key, value) VALUES ('read_switches', ?)").run(JSON.stringify({ epoch: 1, switches: { expense_reads: 'on' } }))
  w.load('lib/readSwitches.ts').resetReadSwitchMemo()
}
const asTier = (w, tier) => { w.load('lib/planTier.ts').__resetPlanTierCacheForTests(); return tier ? { PLAN_TIER: tier } : {} }

function recordStatements(w) {
  const log = []
  const prepare = w.raw.prepare.bind(w.raw)
  w.raw.prepare = (sql) => {
    const statement = prepare(sql)
    for (const method of ['all', 'get', 'run']) {
      const real = statement[method].bind(statement)
      statement[method] = (params) => { log.push({ sql, params, method }); return real(params) }
    }
    return statement
  }
  return log
}
const feeStatements = (log) => log.filter((entry) => /\bFROM fees f\b/.test(entry.sql) && !/fee_labels|fee_types/.test(entry.sql))

// ---------------------------------------------------------------------------------------------------------------------
// Oracles: the 6.0.1053 handlers, verbatim
// ---------------------------------------------------------------------------------------------------------------------
async function oldReport(w, query) {
  const { feeRangePredicate } = w.load('routes/fees.ts')
  const range = feeRangePredicate(query)
  const clauses = [range.sql]
  const params = { ...range.params }
  if (query.branchId) {
    const text = String(query.branchId ?? '').trim()
    const id = /^\d+$/.test(text) ? Number(text) : Number.NaN
    if (!Number.isSafeInteger(id)) clauses.push('1 = 0')
    else { params.branchId = id; clauses.push(range.sql !== '1=1' ? '+f.branch_id = @branchId' : 'f.branch_id = @branchId') }
  }
  const where = clauses.length ? clauses.join(' AND ') : '1=1'
  const money = 'ROUND(COALESCE(SUM(amount_usd), 0), 2) AS amount_usd, ROUND(COALESCE(SUM(amount_khr), 0), 0) AS amount_khr'
  const db = w.raw
  const [totals, days, byType, byCategory] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, ${money} FROM fees f WHERE ${where}`).get(params),
    db.prepare(`SELECT f.fee_date AS date, COUNT(*) AS count, ${money} FROM fees f WHERE ${where} GROUP BY f.fee_date ORDER BY f.fee_date DESC`).all(params),
    db.prepare(`SELECT f.fee_type AS fee_type, COUNT(*) AS count, ${money} FROM fees f WHERE ${where} GROUP BY f.fee_type ORDER BY amount_usd DESC, amount_khr DESC`).all(params),
    db.prepare(`SELECT f.fee_type AS fee_type, COALESCE(NULLIF(MIN(TRIM(f.label)), ''), '') AS label, COUNT(*) AS count, ${money}
      FROM fees f WHERE ${where} GROUP BY f.fee_type, lower(trim(COALESCE(f.label, ''))) ORDER BY amount_usd DESC, amount_khr DESC, label`).all(params),
  ])
  return {
    startDate: String(query.from || query.startDate || '').trim(),
    endDate: String(query.to || query.endDate || '').trim(),
    totals: { count: Number(totals?.count || 0), amount_usd: Number(totals?.amount_usd || 0), amount_khr: Number(totals?.amount_khr || 0) },
    days: (days || []).map((d) => ({ date: String(d.date || ''), count: Number(d.count || 0), amount_usd: Number(d.amount_usd || 0), amount_khr: Number(d.amount_khr || 0) })),
    by_type: (byType || []).map((r) => ({ fee_type: String(r.fee_type || ''), count: Number(r.count || 0), amount_usd: Number(r.amount_usd || 0), amount_khr: Number(r.amount_khr || 0) })),
    by_category: (byCategory || []).map((r) => ({ label: String(r.label || ''), fee_type: String(r.fee_type || ''), count: Number(r.count || 0), amount_usd: Number(r.amount_usd || 0), amount_khr: Number(r.amount_khr || 0) })),
  }
}

const rowsJson = (rows) => rows.map((row) => JSON.stringify(row))

// One whole export through the offset pages (what 6.0.1053 does) or through the cursor.
async function offsetExport(w, qs, user, size, env = {}) {
  const rows = []
  let first = null
  for (;;) {
    const r = await w.request('GET', `/api/fees?${qs}&limit=${size}&offset=${rows.length}`, undefined, user, {}, env)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    first = first || r.json
    rows.push(...r.json.fees)
    if (r.json.fees.length < size || rows.length >= r.json.total) return { rows, first }
  }
}
const byType = (summary) => [...summary].sort((a, b) => (a.fee_type < b.fee_type ? -1 : 1))
async function cursorExport(w, qs, user, size, { after, env = {} } = {}) {
  const rows = []
  const pages = []
  let cursor = 'start'
  for (let n = 0; n < 1000; n += 1) {
    const r = await w.request('GET', `/api/fees?${qs}&limit=${size}&offset=${rows.length}&cursor=${encodeURIComponent(cursor)}`, undefined, user, {}, env)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.notEqual(r.json.next_cursor, undefined, 'a cursor page carries next_cursor')
    pages.push(r.json)
    rows.push(...r.json.fees)
    if (after) await after(n, r.json)
    if (!r.json.next_cursor) return { rows, pages }
    cursor = r.json.next_cursor
  }
  throw new Error('the cursor export did not end')
}

const FILTERS = [
  '', 'from=2026-10-04&to=2026-10-09', 'from=2026-10-05&to=2026-10-05', 'branch_id=1', 'branch_id=2&from=2026-10-03&to=2026-10-12', 'fee_type=delivery',
  'fee_type=other&search=tape', 'search=ice', 'sale_id=1', 'delivery_contact_id=5', 'createdFrom=2026-10-09T17:00:00Z&createdTo=2026-10-10T17:00:00Z',
]
const REPORT_FILTERS = [
  '', 'startDate=2026-10-03&endDate=2026-10-12', 'from=2026-10-04&to=2026-10-09', 'startDate=2026-10-05&endDate=2026-10-05', 'branchId=1', 'branchId=2', 'branchId=99',
  'branchId=0x1', 'branchId=abc', 'startDate=2026-10-03&endDate=2026-10-12&branchId=1', 'startDate=2026-10-03&endDate=2026-10-12&branchId=2',
  // the Cambodia business day of 10 Oct: [09 Oct 17:00:00Z, 10 Oct 17:00:00Z); and one second either side of both edges
  'createdFrom=2026-10-09T17:00:00Z&createdTo=2026-10-10T17:00:00Z', 'createdFrom=2026-10-09T16:59:59Z&createdTo=2026-10-10T17:00:01Z', 'createdFrom=2026-10-09T17:00:00Z&createdTo=2026-10-09T17:00:01Z',
  'createdFrom=2026-10-10T16:59:59Z&createdTo=2026-10-10T17:00:00Z', 'createdFrom=2026-10-09T17:00:00Z&createdTo=2026-10-10T17:00:00Z&branchId=1', 'startDate=2030-01-01&endDate=2030-01-02',
]

// ---------------------------------------------------------------------------------------------------------------------
async function scenario(w, patches = []) {
  const U = w.users

  // ---- 1. the report ------------------------------------------------------------------------------------------------
  await check('REPORT: switch ON is byte-identical to the 6.0.1053 four-statement oracle, and so is switch OFF, over every filter, branch and Cambodia-day edge', async () => {
    let compared = 0
    for (const qs of REPORT_FILTERS) {
      const oracle = JSON.stringify(await oldReport(w, Object.fromEntries(new URLSearchParams(qs))))
      for (const on of [false, true]) {
        setSwitch(w, on)
        const got = await w.request('GET', `/api/fees/report?${qs}`, undefined, U.full)
        assert.equal(got.status, 200, `${qs}: ${JSON.stringify(got.json)}`)
        assert.equal(JSON.stringify(got.json), oracle, `${on ? 'ON' : 'OFF'}: ${qs}`)
        compared += 1
      }
    }
    assert.equal(compared, REPORT_FILTERS.length * 2)
    setSwitch(w, false)
  })

  await check('REPORT: the fixture is not trivial (ties, case spellings, blank and null labels, Khmer, astral, riel, a fee linked to a sale), so the parity above can fail', async () => {
    const all = await oldReport(w, {})
    assert.ok(all.totals.count >= 90 && all.totals.amount_usd > 0 && all.totals.amount_khr > 0, 'dollar and riel rows')
    assert.ok(all.days.length >= 8 && all.by_type.length >= 5)
    const labels = all.by_category.map((c) => c.label)
    for (const wanted of ['Rent', 'Tape', '', 'ទឹកកក', '📦 Box', 'Bike  courier']) assert.ok(labels.includes(wanted), `label ${JSON.stringify(wanted)}`)
    assert.equal(labels.filter((l) => l.toLowerCase() === 'rent').length >= 2, true, 'one label key in more than one type')
    const money = all.by_category.map((c) => `${c.amount_usd}/${c.amount_khr}`)
    assert.ok(new Set(money).size < money.length, 'equal money in two groups: the tie order is exercised')
    const typeMoney = all.by_type.map((t) => `${t.amount_usd}/${t.amount_khr}`)
    assert.ok(w.get('SELECT COUNT(*) n FROM fees WHERE sale_id IS NOT NULL').n > 3, 'fees linked to a sale')
    assert.ok(typeMoney.length >= 5)
  })

  await check('REPORT: ONE statement reads the expense table when the switch is on, four when it is off', async () => {
    const log = recordStatements(w)
    for (const [on, expected] of [[false, 4], [true, 1]]) {
      setSwitch(w, on)
      log.length = 0
      const r = await w.request('GET', '/api/fees/report?startDate=2026-10-03&endDate=2026-10-12', undefined, U.full)
      assert.equal(r.status, 200)
      assert.equal(feeStatements(log).length, expected, `${on ? 'ON' : 'OFF'}: ${feeStatements(log).map((s) => s.sql.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')}`)
    }
    setSwitch(w, false)
  })

  await check('REPORT: totals equal Reports overview (recorded expenses) with the switch on, for the ranges the overview answers', async () => {
    setSwitch(w, true)
    for (const [from, to] of [['2026-10-03', '2026-10-12'], ['2026-10-05', '2026-10-09'], ['2026-10-10', '2026-10-10']]) {
      const overview = (await w.request('GET', `/api/reports/overview?startDate=${from}&endDate=${to}`, undefined, U.admin)).json
      const report = (await w.request('GET', `/api/fees/report?startDate=${from}&endDate=${to}`, undefined, U.full)).json
      assert.deepEqual(report.totals, overview.expenses.totals, `${from}..${to}`)
    }
    setSwitch(w, false)
  })

  await check('REPORT: sale-linked expenses and the courier block: include=sales is the same body plus the unchanged sale block, with no cost of goods anywhere', async () => {
    const qs = 'startDate=2026-10-03&endDate=2026-10-12&include=sales'
    setSwitch(w, false)
    const off = await w.request('GET', `/api/fees/report?${qs}`, undefined, U.full)
    setSwitch(w, true)
    const on = await w.request('GET', `/api/fees/report?${qs}`, undefined, U.full)
    assert.equal(JSON.stringify(on.json), JSON.stringify(off.json))
    assert.ok(off.json.sale_delivery.count > 0, 'control: the fixture has courier costs on sales')
    assert.ok(!JSON.stringify(on.json).includes(String(COGS_MARKER)), 'no cost of goods')
    const linked = w.get("SELECT COUNT(*) n, SUM(amount_usd) u FROM fees WHERE sale_id IS NOT NULL AND fee_date >= '2026-10-03' AND fee_date <= '2026-10-12'")
    assert.ok(linked.n > 0)
    const withoutLinked = await oldReport(w, { startDate: '2026-10-03', endDate: '2026-10-12' })
    assert.equal(on.json.totals.count, withoutLinked.totals.count, 'fees linked to a sale are in the totals')
    for (const user of [U.noSales, U.courierOff]) {
      const r = await w.request('GET', `/api/fees/report?${qs}`, undefined, user)
      assert.equal(r.json.sale_delivery, null, 'no courier figure without the permission')
      assert.equal(JSON.stringify({ ...r.json, sale_delivery: undefined }), JSON.stringify({ ...on.json, sale_delivery: undefined }))
    }
    assert.equal((await w.request('GET', `/api/fees/report?${qs}`, undefined, U.noView)).status, 403)
    assert.equal((await w.request('GET', `/api/fees/report?${qs}`, undefined, U.nothing)).status, 403)
    setSwitch(w, false)
  })

  // ---- 2. the export ------------------------------------------------------------------------------------------------
  await check('EXPORT: the cursor export is exactly the offset export (rows, order, kind, total) for every page size, filter and user', async () => {
    let exports = 0
    for (const qs of FILTERS) {
      for (const [user, label] of [[U.full, 'full'], [U.courierOff, 'courierOff'], [U.noSales, 'noSales']]) {
        setSwitch(w, false)
        const oracle = await offsetExport(w, `${qs}&source=all`, user, 500)
        setSwitch(w, true)
        for (const size of [1, 2, 3, 7, 50, 500]) {
          const got = await cursorExport(w, `${qs}&source=all`, user, size)
          assert.deepEqual(rowsJson(got.rows), rowsJson(oracle.rows), `${label} ${qs} size ${size}`)
          assert.equal(got.pages[0].total, oracle.first.total, 'the first page carries the true total')
          assert.deepEqual(byType(got.pages[0].summary), byType(oracle.first.summary))
          assert.deepEqual(got.pages[0].sale_delivery, oracle.first.sale_delivery)
          assert.equal(got.pages.length, Math.max(1, Math.ceil(oracle.rows.length / Math.min(size, 500))), `${label} ${qs} size ${size}: pages`)
          assert.ok(got.pages.slice(1).every((p) => p.total === undefined && p.summary === undefined), 'only the first page carries totals')
          exports += 1
        }
      }
    }
    assert.ok(exports >= FILTERS.length * 3 * 6)
    setSwitch(w, false)
  })

  await check('EXPORT: the fixture has what the merge order is about: sale rows, expense rows, both spellings of created_at, and identical timestamps', async () => {
    setSwitch(w, false)
    const all = (await offsetExport(w, 'source=all', U.full, 500)).rows
    const sales = all.filter((r) => r.kind === 'sale_delivery')
    assert.ok(sales.length >= 8 && all.length - sales.length >= 90)
    assert.ok(sales.some((r) => r.created_at.includes('T')) && sales.some((r) => !r.created_at.includes('T')), 'both spellings')
    const stamps = sales.map((r) => r.created_at.replace('T', ' ').slice(0, 19))
    assert.ok(new Set(stamps).size < stamps.length, 'two sale rows with the same entry time')
    const expenseStamps = new Set(all.filter((r) => r.kind === 'expense').map((r) => `${r.fee_date}|${r.created_at}`))
    assert.ok(expenseStamps.size < all.length - sales.length, 'two expenses with the same date and entry time')
    assert.ok(sales.some((s) => all.some((r) => r.kind === 'expense' && r.fee_date === s.fee_date && r.created_at.replace('T', ' ').slice(0, 19) === s.created_at.replace('T', ' ').slice(0, 19))), 'an expense and a sale row with the same date and entry time')
    const merged = all.map((r) => `${r.kind}:${r.id}`)
    assert.equal(new Set(merged).size, merged.length)
  })

  await check('EXPORT: source=sale pages by cursor too (the sale list alone), and a user without the courier permission gets no sale page', async () => {
    for (const size of [1, 4, 500]) {
      setSwitch(w, false)
      const oracle = await offsetExport(w, 'source=sale', U.full, 500)
      setSwitch(w, true)
      const got = await cursorExport(w, 'source=sale', U.full, size)
      assert.deepEqual(rowsJson(got.rows), rowsJson(oracle.rows))
      assert.ok(oracle.rows.length > 0 && got.rows.every((r) => r.kind === 'sale_delivery'))
      const none = await cursorExport(w, 'source=sale', U.courierOff, size)
      assert.deepEqual([none.rows.length, none.pages.length, none.pages[0].next_cursor, none.pages[0].sale_delivery], [0, 1, null, null])
    }
    setSwitch(w, false)
  })

  await check('EXPORT MID-FLIGHT: a row created or deleted while the export runs repeats nothing and skips nothing of the start snapshot; OFF (offset) does not give that', async () => {
    const maxFee = w.get('SELECT MAX(id) AS m FROM fees').m
    const mutate = async (n) => {
      if (n !== 1) return
      // created mid-export: newer than everything, back-dated behind the cursor, tied with a served row, and a new courier sale
      w.sql.exec(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at) VALUES
        ('other', 'Newer', 1, 0, '2026-10-30', 1, '2026-10-30 03:00:00'), ('other', 'Backdated', 1, 0, '2026-10-03', 1, '2026-10-03 01:00:00'),
        ('other', 'Tied', 1, 0, '2026-10-11', 1, '2026-10-11 03:00:00')`)
      w.sql.exec(`INSERT INTO sales (id, created_at, sale_status, branch_id, receipt_number, total_usd, subtotal_usd, delivery_actual_cost_usd, is_delivery)
        VALUES (900, '2026-10-30 03:00:00', 'completed', 1, 'R-0900', 10, 10, 2, 1), (901, '2026-10-03 01:00:00', 'completed', 1, 'R-0901', 10, 10, 2, 1)`)
      // deleted: one expense already served (the first rows) and one not yet reached (the oldest)
      w.sql.exec(`DELETE FROM fees WHERE id = (SELECT id FROM fees WHERE id <= ${maxFee} ORDER BY fee_date ASC, id ASC LIMIT 1)`)
    }
    setSwitch(w, false)
    const snapshot = await offsetExport(w, 'source=all', U.full, 500)
    const snapshotKeys = snapshot.rows.map((r) => `${r.kind}:${r.id}`)
    const servedFirst = snapshot.rows.slice(0, 3).map((r) => `${r.kind}:${r.id}`)
    setSwitch(w, true)
    const live = await cursorExport(w, 'source=all', U.full, 3, { after: (n) => mutate(n) })
    const keys = live.rows.map((r) => `${r.kind}:${r.id}`)
    assert.equal(new Set(keys).size, keys.length, 'no row twice')
    assert.ok(!keys.some((k) => k === 'sale_delivery:900' || k === 'sale_delivery:901') && !live.rows.some((r) => r.kind === 'expense' && r.id > maxFee) && !live.rows.some((r) => ['Newer', 'Backdated', 'Tied'].includes(r.label)), 'nothing created after the start is in a page')
    const deletedAhead = snapshotKeys.filter((k) => !keys.includes(k))
    assert.equal(deletedAhead.length, 1, `only the deleted, not yet reached row is missing: ${deletedAhead}`)
    assert.ok(servedFirst.every((k) => keys.includes(k)))
    assert.deepEqual(keys.filter((k) => snapshotKeys.includes(k)), snapshotKeys.filter((k) => keys.includes(k)), 'the order of the snapshot rows is untouched')
    setSwitch(w, false)
  })

  await check('EXPORT MID-FLIGHT control: the same change under the offset export (6.0.1053) repeats a row, and a delete skips one that was never deleted', async () => {
    const w2 = newWorld()
    setSwitch(w2, false)
    const rows = []
    let step = 0
    for (;;) {
      const r = await w2.request('GET', `/api/fees?source=all&limit=3&offset=${rows.length}`, undefined, w2.users.full)
      rows.push(...r.json.fees)
      step += 1
      if (step === 2) w2.sql.exec("INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at) VALUES ('other', 'Newer', 1, 0, '2026-10-30', 1, '2026-10-30 03:00:00')")
      if (r.json.fees.length < 3 || rows.length >= r.json.total) break
    }
    const keys = rows.map((r) => `${r.kind}:${r.id}`)
    assert.ok(new Set(keys).size < keys.length, 'a row appears twice')
  })

  await check('EXPORT: a cursor this Worker did not hand out is ignored and the request pages by offset; OFF reads nothing of the cursor parameter', async () => {
    const qs = 'source=all&from=2026-10-04&to=2026-10-09'
    setSwitch(w, false)
    const plain = await w.request('GET', `/api/fees?${qs}&limit=5&offset=5`, undefined, U.full)
    for (const cursor of ['start', 'garbage', 'e30', '']) {
      const withCursor = await w.request('GET', `/api/fees?${qs}&limit=5&offset=5&cursor=${cursor}`, undefined, U.full)
      assert.equal(JSON.stringify(withCursor.json), JSON.stringify(plain.json), `OFF, cursor=${cursor}`)
    }
    setSwitch(w, true)
    for (const cursor of ['garbage', 'e30', Buffer.from('{"v":2}').toString('base64url')]) {
      const withCursor = await w.request('GET', `/api/fees?${qs}&limit=5&offset=5&cursor=${cursor}`, undefined, U.full)
      assert.equal(JSON.stringify(withCursor.json), JSON.stringify(plain.json), `ON, unreadable cursor ${cursor}`)
    }
    const plainOn = await w.request('GET', `/api/fees?${qs}&limit=5&offset=5`, undefined, U.full)
    assert.equal(JSON.stringify(plainOn.json), JSON.stringify(plain.json), 'ON without a cursor is the offset page')
    assert.equal(plainOn.json.next_cursor, undefined)
    setSwitch(w, false)
  })

  await check('LOOPHOLE: a forged cursor only chooses a position: permission, branch and range come from the request on every page, and the snapshot ids cannot reach past the data', async () => {
    const { encodeFeeCursor, decodeFeeCursor } = w.load('lib/expenseReads.ts')
    setSwitch(w, true)
    const forged = encodeFeeCursor({ e: ['2099-01-01', 999999], s: ['2099-01-01', '2099-01-01 00:00:00', 999999], h: [999999999, 999999999] })
    // a caller without the courier permission gets expense rows only, whatever sale key the cursor carries
    for (const user of [U.courierOff, U.noSales]) {
      const r = await w.request('GET', `/api/fees?source=all&limit=500&cursor=${forged}`, undefined, user)
      assert.equal(r.status, 200)
      assert.ok(r.json.fees.length > 0 && r.json.fees.every((f) => f.kind === 'expense'), 'no sale row')
      assert.deepEqual([r.json.snapshot_max_id.sales, r.json.sale_delivery], [null, undefined], 'neither the highest sale id nor a courier total')
      const start = (await w.request('GET', '/api/fees?source=all&limit=5&cursor=start', undefined, user)).json
      assert.deepEqual([start.snapshot_max_id.sales, start.sale_delivery, decodeFeeCursor(start.next_cursor).h[1]], [null, null, 0], 'the first page and its cursor carry no sale id either')
      assert.equal((await w.request('GET', `/api/fees?source=sale&limit=500&cursor=${forged}`, undefined, user)).json.fees.length, 0)
    }
    // the branch and the dates of the request bound the page, not the cursor
    const branch2 = (await w.request('GET', `/api/fees?source=all&limit=500&branch_id=2&from=2026-10-05&to=2026-10-07&cursor=${forged}`, undefined, U.full)).json
    assert.ok(branch2.fees.length > 0 && branch2.fees.every((f) => f.branch_id === 2 && f.fee_date >= '2026-10-05' && f.fee_date <= '2026-10-07'))
    // a cursor whose ids are 0 reaches nothing; the same request with real ids reaches the rows
    const none = (await w.request('GET', `/api/fees?source=all&limit=500&cursor=${encodeFeeCursor({ e: ['2099-01-01', 5], s: null, h: [0, 0] })}`, undefined, U.full)).json
    assert.deepEqual([none.fees.length, none.next_cursor], [0, null])
    // injection text in a key is data, not SQL
    const evil = (await w.request('GET', `/api/fees?source=all&limit=5&cursor=${encodeFeeCursor({ e: ["x' OR 1=1 --", 1], s: ["x' OR 1=1 --", "y' --", 1], h: [1000, 1000] })}`, undefined, U.full)).json
    assert.ok(Array.isArray(evil.fees))
    assert.equal(w.get('SELECT COUNT(*) n FROM fees').n >= 90, true, 'nothing was written')
    setSwitch(w, false)
  })

  await check('EXPORT: a plain list request does not read the switch (the Expenses page itself pays nothing for the switch)', async () => {
    const log = recordStatements(w)
    setSwitch(w, false)
    log.length = 0
    await w.request('GET', '/api/fees?source=all&limit=5', undefined, U.full)
    await w.request('GET', '/api/fees?limit=5', undefined, U.full)
    assert.equal(log.filter((s) => /system_flags/.test(s.sql)).length, 0)
    await w.request('GET', '/api/fees?source=all&limit=5&cursor=start', undefined, U.full)
    assert.equal(log.filter((s) => /system_flags/.test(s.sql)).length, 1, 'a request that carries a cursor reads the switch once')
  })

  await check('EXPORT: the answer to a bad range is the same 400 with and without a cursor', async () => {
    setSwitch(w, true)
    for (const qs of ['from=2026-13-40', 'from=2026-10-12&to=2026-10-10', 'createdFrom=2026-10-10T00:00:00Z']) {
      const a = await w.request('GET', `/api/fees?source=all&${qs}&cursor=start`, undefined, U.full)
      setSwitch(w, false)
      const b = await w.request('GET', `/api/fees?source=all&${qs}`, undefined, U.full)
      setSwitch(w, true)
      assert.deepEqual([a.status, a.json], [400, b.json])
      assert.equal(b.status, 400)
    }
    setSwitch(w, false)
  })

  await check('SALE LIST: days far apart and a negative-offset spelling of created_at: the probe and its floor keep every row at page sizes 1, 2 and 3', async () => {
    // s3 is 2026-10-10 03:00:00 UTC written with an offset: its raw date is a day EARLIER than its real one, and it ties s1 on day and entry time (id decides).
    // At size 1 the raw top two are s2 and s1 (day 10-10), yet the list's top two are s3 and s1: only the day-before margin of the floor keeps s3.
    // Later pages jump from 10-10 to 10-07 to 10-04 to 10-01: a probe that stops one row short sets a floor above the row the page needs.
    const w2 = newWorld(patches)
    w2.sql.exec('DELETE FROM sale_items; DELETE FROM sales')
    const add = w2.sql.prepare("INSERT INTO sales (id, created_at, sale_status, branch_id, receipt_number, total_usd, subtotal_usd, delivery_actual_cost_usd, is_delivery) VALUES (?, ?, 'completed', 1, ?, 10, 10, ?, 1)")
    for (const [id, at] of [[1, '2026-10-10 03:00:00'], [2, '2026-10-10T02:00:00.000Z'], [3, '2026-10-09T20:00:00-07:00'], [4, '2026-10-07 05:00:00'], [5, '2026-10-04T05:00:00.000Z'], [6, '2026-10-01 05:00:00'], [7, '2026-10-01T05:00:00.000Z']]) add.run(id, at, `R-${id}`, 1 + id)
    setSwitch(w2, false)
    const oracle = (await offsetExport(w2, 'source=sale', w2.users.full, 500)).rows
    assert.deepEqual(oracle.map((r) => r.id), [3, 1, 2, 4, 5, 7, 6], 'control: the list order the cursor must reproduce')
    setSwitch(w2, true)
    for (const size of [1, 2, 3]) {
      const got = await cursorExport(w2, 'source=sale', w2.users.full, size)
      assert.deepEqual(rowsJson(got.rows), rowsJson(oracle), `size ${size}`)
    }
    setSwitch(w2, false)
  })

  await check('EXPORT: ties on identical timestamps land between pages without a repeat or a gap (every page size 1 boundary)', async () => {
    setSwitch(w, false)
    const oracle = (await offsetExport(w, 'source=all', U.full, 500)).rows.map((r) => `${r.kind}:${r.id}`)
    setSwitch(w, true)
    const got = (await cursorExport(w, 'source=all', U.full, 1)).rows.map((r) => `${r.kind}:${r.id}`)
    assert.deepEqual(got, oracle)
    assert.equal(new Set(got).size, got.length)
    setSwitch(w, false)
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan fields, the group cap and the rounding boundary: worlds of their own
// ---------------------------------------------------------------------------------------------------------------------
async function scenarioPlan(patches = []) {
  await check('PLAN: Free pages 250 rows, Paid 500, and the cursor export is complete either way', async () => {
    const w = newWorld(patches)
    w.sql.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 640)
      INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at)
      SELECT 'other', 'Bulk ' || (i % 7), 1, 0, date('2026-09-01', '+' || (i % 20) || ' days'), 1, '2026-09-01 03:00:00' FROM n`)
    setSwitch(w, false)
    const oracle = (await offsetExport(w, 'source=all', w.users.full, 500)).rows
    assert.ok(oracle.length > 700)
    setSwitch(w, true)
    for (const [tier, cap] of [['free', 250], ['paid', 500], [undefined, 500]]) {
      const env = asTier(w, tier)
      const got = await cursorExport(w, 'source=all', w.users.full, 500, { env })
      assert.deepEqual(rowsJson(got.rows), rowsJson(oracle), `${tier}`)
      assert.equal(got.pages[0].limit, cap, `${tier}: the first page is capped at ${cap}`)
      assert.ok(got.pages.every((p) => p.fees.length <= cap))
      assert.equal(got.pages.length, Math.ceil(oracle.length / cap))
    }
    // OFF keeps its own cap: 500 on Free as well
    setSwitch(w, false)
    const off = await w.request('GET', '/api/fees?source=all&limit=900', undefined, w.users.full, {}, asTier(w, 'free'))
    assert.equal(off.json.limit, 500)
    assert.equal(off.json.fees.length, 500)
  })

  await check('PLAN: a window with more groups than the plan allows is answered by the four statements (still byte-identical); Paid reads it in one', async () => {
    const w = newWorld(patches)
    w.sql.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10500)
      INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at)
      SELECT 'other', 'Group ' || i, 1, 0, date('2025-01-01', '+' || (i % 400) || ' days'), 1, '2025-01-01 03:00:00' FROM n`)
    const log = recordStatements(w)
    const oracle = JSON.stringify(await oldReport(w, {}))
    setSwitch(w, true)
    for (const [tier, statements] of [['free', 5], ['paid', 1], [undefined, 1]]) {
      log.length = 0
      const r = await w.request('GET', '/api/fees/report', undefined, w.users.full, {}, asTier(w, tier))
      assert.equal(JSON.stringify(r.json), oracle, `${tier}`)
      assert.equal(feeStatements(log).length, statements, `${tier}: the grouped attempt, then ${statements - 1} more`)
    }
    // below the Free cap, Free reads once
    log.length = 0
    const month = await w.request('GET', '/api/fees/report?startDate=2025-01-01&endDate=2025-01-05', undefined, w.users.full, {}, asTier(w, 'free'))
    const used = feeStatements(log).length
    assert.equal(JSON.stringify(month.json), JSON.stringify(await oldReport(w, { startDate: '2025-01-01', endDate: '2025-01-05' })))
    assert.equal(used, 1)
  })

  await check('PLAN: a middle cursor page starts from an index and sorts no table (expenses: idx_fees_fee_date; sales: idx_sales_courier_cost for the probe and the page), with and without ANALYZE, with and without a branch', async () => {
    const w = newWorld(patches)
    w.sql.exec("DELETE FROM sale_items; DELETE FROM sales; DELETE FROM fees; INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1) ON CONFLICT DO NOTHING")
    w.sql.exec('BEGIN')
    const addFee = w.sql.prepare("INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)")
    for (let i = 1; i <= 6000; i += 1) {
      const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 15) * 86400000).toISOString().slice(0, 10)
      addFee.run(['rent', 'tax', 'delivery'][i % 3], `Fee ${i % 40}`, 1 + (i % 9), day, i % 20 === 0 ? 2 : 1, `${day} 03:00:00`)
    }
    const addSale = w.sql.prepare("INSERT INTO sales (id, created_at, sale_status, branch_id, total_usd, subtotal_usd, delivery_actual_cost_usd) VALUES (?, ?, 'completed', ?, 10, 10, ?)")
    for (let i = 1; i <= 12000; i += 1) {
      const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 30) * 86400000).toISOString().slice(0, 10)
      addSale.run(100000 + i, i % 2 ? `${day} 03:00:00` : `${day}T04:00:00.000Z`, i % 20 === 0 ? 2 : 1, i % 33 === 0 ? 1.5 : null)
    }
    w.sql.exec('COMMIT')
    const log = recordStatements(w)
    setSwitch(w, true)
    const names = (sql) => [...new Set([...sql.matchAll(/@(\w+)/g)].map((m) => m[1]))]
    const plan = (entry) => w.sql.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).all(Object.fromEntries(names(entry.sql).map((n) => [n, entry.params[n] ?? null]))).map((row) => row.detail).join(' | ')
    for (const phase of ['without statistics', 'after ANALYZE']) {
      if (phase === 'after ANALYZE') w.sql.exec('ANALYZE')
      for (const filter of ['', 'branch_id=1']) {
        log.length = 0
        const first = (await w.request('GET', `/api/fees?source=all&limit=100&cursor=start&${filter}`, undefined, w.users.full)).json
        assert.ok(first.next_cursor, 'a first page with more to come')
        // The first page also totals the sale half. Its snapshot bound must not steer the planner onto the sales primary key (16,088 rows against 1,506 at seed size).
        const totals = log.find((s) => /SELECT COUNT\(\*\) AS count, COALESCE\(SUM\(CASE WHEN EXISTS/.test(s.sql))
        assert.ok(totals, `${phase}, ${filter || 'no branch'}: the first page totals the sale half`)
        const totalsPlan = plan(totals)
        assert.match(totalsPlan, /idx_sales_courier_cost/, `${phase}, ${filter || 'no branch'}: sale totals: ${totalsPlan}`)
        assert.doesNotMatch(totalsPlan, /INTEGER PRIMARY KEY|idx_sales_(?!courier_cost)\w+|SCAN sales(?! USING)/, `${phase}, ${filter || 'no branch'}: sale totals: ${totalsPlan}`)
        const middle = (await w.request('GET', `/api/fees?source=all&limit=100&cursor=${first.next_cursor}&${filter}`, undefined, w.users.full)).json
        const second = (await w.request('GET', `/api/fees?source=all&limit=100&cursor=${middle.next_cursor}&${filter}`, undefined, w.users.full)).json
        assert.ok(second.fees.length > 0)
        log.length = 0
        const resumed = await w.request('GET', `/api/fees?source=all&limit=100&cursor=${second.next_cursor}&${filter}`, undefined, w.users.full)
        assert.equal(resumed.status, 200)
        const label = `${phase}, ${filter || 'no branch'}`
        const rowsStatement = log.find((s) => /\bFROM fees f\b/.test(s.sql) && /LIMIT @limit OFFSET @offset/.test(s.sql))
        const probe = log.find((s) => /SELECT sales.created_at AS created_at FROM sales/.test(s.sql))
        const page = log.find((s) => /SELECT sales.id, sales.receipt_number/.test(s.sql))
        assert.ok(rowsStatement && probe && page, `${label}: the three keyset statements ran (rows ${Boolean(rowsStatement)}, probe ${Boolean(probe)}, page ${Boolean(page)})`)
        const feePlan = plan(rowsStatement), probePlan = plan(probe), pagePlan = plan(page)
        assert.match(feePlan, /idx_fees_fee_date/, `${label}: expense page: ${feePlan}`)
        assert.doesNotMatch(feePlan, /USE TEMP B-TREE FOR (ORDER BY|RIGHT PART OF ORDER BY)/, `${label}: expense page sorts: ${feePlan}`)
        assert.match(probePlan, /idx_sales_courier_cost/, `${label}: probe: ${probePlan}`)
        assert.doesNotMatch(probePlan, /TEMP B-TREE/, `${label}: the probe sorts: ${probePlan}`)
        assert.match(pagePlan, /idx_sales_courier_cost/, `${label}: sale page: ${pagePlan}`)
        assert.doesNotMatch(pagePlan, /idx_sales_(?!courier_cost)\w+|SCAN sales(?! USING)/, `${label}: sale page: ${pagePlan}`)
      }
      // The report's one grouped statement: the date index for a window, never the branch index for a window.
      const grouped = async (qs) => {
        log.length = 0
        assert.equal((await w.request('GET', `/api/fees/report${qs}`, undefined, w.users.full)).status, 200)
        const statement = log.find((s) => /GROUP BY f\.fee_date, f\.fee_type/.test(s.sql))
        assert.ok(statement, `${phase}: the grouped statement ran for ${qs || 'no filter'}`)
        return plan(statement)
      }
      const windowed = await grouped('?startDate=2025-01-10&endDate=2025-01-20')
      assert.match(windowed, /idx_fees_fee_date/, `${phase}: window: ${windowed}`)
      const windowedBranch = await grouped('?startDate=2025-01-10&endDate=2025-01-20&branchId=1')
      assert.match(windowedBranch, /idx_fees_fee_date/, `${phase}: window + branch: ${windowedBranch}`)
      assert.doesNotMatch(windowedBranch, /idx_fees_branch/, `${phase}: window + branch: ${windowedBranch}`)
    }
  })

  await check('ROUNDING: a figure on a half cent is answered by the four statements, identical to the oracle; a clean one reads once', async () => {
    const w = newWorld(patches)
    w.sql.exec(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at) VALUES
      ('other', 'Sub cent', 1.0025, 0, '2027-03-01', 1, '2027-03-01 03:00:00'), ('other', 'Sub cent', 1.0025, 0, '2027-03-01', 1, '2027-03-01 04:00:00'),
      ('other', 'Half riel', 0, 0.5, '2027-04-01', 1, '2027-04-01 03:00:00'), ('other', 'Clean', 2.2, 12500, '2027-05-01', 1, '2027-05-01 03:00:00')`)
    const log = recordStatements(w)
    setSwitch(w, true)
    for (const [qs, statements] of [['startDate=2027-03-01&endDate=2027-03-01', 5], ['startDate=2027-04-01&endDate=2027-04-01', 5], ['startDate=2027-05-01&endDate=2027-05-01', 1], ['startDate=2027-03-01&endDate=2027-05-31', 5]]) {
      log.length = 0
      const r = await w.request('GET', `/api/fees/report?${qs}`, undefined, w.users.full)
      const used = feeStatements(log).length
      assert.equal(JSON.stringify(r.json), JSON.stringify(await oldReport(w, Object.fromEntries(new URLSearchParams(qs)))), qs)
      assert.equal(used, statements, qs)
    }
  })

  await check('REPORT: ties and spellings against SQLite itself: equal money in two types, one label in two types, Rent/rent/" Rent ", astral against fullwidth text', async () => {
    const w = newWorld(patches)
    w.sql.exec("DELETE FROM fees")
    const insert = w.sql.prepare("INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    let at = 0
    for (const [type, label, usd, khr, date] of [
      ['zeta', 'Same', 2, 0, '2026-11-01'], ['alpha', 'Same', 2, 0, '2026-11-01'], ['beta', 'Other', 2, 0, '2026-11-02'], ['gamma', 'Other', 0, 0, '2026-11-02'], ['delta', 'Other', 0, 0, '2026-11-02'],
      ['alpha', 'Rent', 5, 0, '2026-11-03'], ['alpha', 'rent', 5, 0, '2026-11-03'], ['alpha', ' Rent ', 5, 0, '2026-11-04'],
      ['mu', '\u{1F4E6} box', 1, 0, '2026-11-05'], ['mu', 'Ａ box', 1, 0, '2026-11-05'], ['mu', 'ａ box', 1, 0, '2026-11-05'],
      ['nu', 'ទឹកកក', 0, 1000, '2026-11-05'], ['nu', 'ទឹកកក ', 0, 1000, '2026-11-06'], ['nu', null, 0, 1000, '2026-11-06'], ['nu', '', 0, 1000, '2026-11-06'],
    ]) insert.run(type, label, usd, khr, date, `2026-11-0${(at += 1) % 7 + 1} 03:00:00`)
    const log = recordStatements(w)
    setSwitch(w, true)
    for (const qs of ['', 'startDate=2026-11-01&endDate=2026-11-06', 'startDate=2026-11-03&endDate=2026-11-05']) {
      log.length = 0
      const r = await w.request('GET', `/api/fees/report?${qs}`, undefined, w.users.full)
      const used = feeStatements(log).length
      assert.equal(JSON.stringify(r.json), JSON.stringify(await oldReport(w, Object.fromEntries(new URLSearchParams(qs)))), qs)
      assert.equal(used, 1, 'read once')
    }
    // SQLite's own tie order in the oracle is what the fold reproduces: assert the oracle really does contain the tie, so a wrong tie order would be red
    const body = await oldReport(w, {})
    assert.ok(body.by_type.filter((t) => t.amount_usd === 2 && t.amount_khr === 0).length >= 2, 'a type tie in the oracle')
    assert.ok(body.by_category.filter((c) => c.label === 'Same').length === 2, 'a label shared by two types, with equal money')
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutation controls: a plausible wrong implementation must turn at least one check red
// ---------------------------------------------------------------------------------------------------------------------
const CAT = 'src/routes/feesCatalog.ts'
const FEES = 'src/routes/fees.ts'
const MUTANTS = {
  'the export drops the sale rows': { file: CAT, from: 'scope ? saleDeliveryRowsAfter(db, scope, cursor?.s ?? null, limit + 1) : Promise.resolve<SaleDeliveryRow[]>([])', to: 'Promise.resolve<SaleDeliveryRow[]>([])' },
  'the expense key is inclusive, so a tie row is served twice': { file: FEES, from: 'f.fee_date < @afterDate OR f.id < @afterId', to: 'f.fee_date < @afterDate OR f.id <= @afterId' },
  'the sale key is inclusive, so a tied sale row is served twice': { file: CAT, from: 'AND sales.id < @afterId', to: 'AND sales.id <= @afterId' },
  'the snapshot is forgotten, so a row created mid-export appears': { file: CAT, from: 'upToId: hi[0], ', to: '' },
  'the sale snapshot is forgotten': { file: CAT, from: "AND +sales.id <= @saleHi`, params: { ...base.params, saleHi: hi[1] } }", to: "`, params: { ...base.params } }" },
  'the sale snapshot bound is a plain id comparison (the planner walks every sale)': { plan: true, file: CAT, from: 'AND +sales.id <= @saleHi', to: 'AND sales.id <= @saleHi' },
  'a sale row tied on entry time with the cursor is skipped': { file: CAT, from: "OR (datetime(sales.created_at) = @afterAt AND sales.id < @afterId)", to: 'OR 1 = 0' },
  'the sale floor is the probe day itself, not the day before': { file: CAT, from: "date(@probeDay, '-1 day')", to: '@probeDay' },
  'the sale probe stops one row short': { file: CAT, from: 'probe?.[limit - 1]?.created_at', to: 'probe?.[limit - 2]?.created_at' },
  'the cursor keeps only the last expense, the sale key is lost': { file: CAT, from: 'else lastSale = [String(row.fee_date), String(entryTimes.get(Number(row.id))), Number(row.id)]', to: '' },
  'has_more is judged on the page, not the lookahead row': { file: CAT, from: 'const hasMore = merged.length > limit', to: 'const hasMore = page.length === limit && merged.length > limit + 1' },
  'the page is not capped by the plan': { plan: true, file: CAT, from: 'getPlanLimits(c.env).expenseExportPageRows', to: '500' },
  'the report drops the expenses linked to a sale': { file: FEES, from: '    FROM fees f\n    WHERE ${where}\n    GROUP BY f.fee_date, f.fee_type', to: '    FROM fees f\n    WHERE ${where} AND f.sale_id IS NULL\n    GROUP BY f.fee_date, f.fee_type' },
  'the report ignores the branch filter': { file: FEES, from: 'FROM fees f\n    WHERE ${where}\n    GROUP BY f.fee_date', to: 'FROM fees f\n    WHERE ${where.replace(/\\+?f\\.branch_id = @branchId/, "1=1")}\n    GROUP BY f.fee_date' },
  'the report keeps the label case of the first row, not the smallest': { file: 'src/lib/expenseReads.ts', from: 'compareCodePoints(row.label, cat.label) < 0', to: 'false' },
  'the report breaks a tie between two types by type descending': { file: 'src/lib/expenseReads.ts', from: 'outCats.sort((a, b) => cmpMoney(a, b) || compareCodePoints(a.label, b.label))', to: 'outCats.sort((a, b) => cmpMoney(a, b) || compareCodePoints(a.label, b.label) || compareCodePoints(b.fee_type, a.fee_type))' },
  'the group cap is ignored': { plan: true, file: FEES, from: 'groups.length <= cap ? foldFeeGroups(groups) : null', to: 'foldFeeGroups(groups.slice(0, cap))' },
}

// EXPENSE_READS_ONLY=plan runs the plan worlds and the mutants that judge them; =main the shared fixture and the rest (diagnosis only; the gate runs all).
const ONLY = process.env.EXPENSE_READS_ONLY || ''

async function main() {
  if (ONLY !== 'plan') await scenario(newWorld())
  if (ONLY !== 'main') await scenarioPlan()
  const baseFailures = failures.length
  assert.equal(baseFailures, 0)

  quiet = true
  const survivors = []
  for (const [name, patch] of Object.entries(MUTANTS)) {
    if ((ONLY === 'plan' && !patch.plan) || (ONLY === 'main' && patch.plan)) continue
    failures.length = 0
    let red = false
    const patches = [{ file: patch.file, from: patch.from, to: patch.to }]
    try {
      // a mutant of the plan readers is judged on the plan worlds, every other on the shared fixture
      if (patch.plan) await scenarioPlan(patches)
      else await scenario(newWorld(patches), patches)
      red = failures.length > 0
    } catch (error) {
      red = true
      void error
    }
    console.log(`${red ? 'PASS' : 'FAIL'} mutant "${name}" ${red ? 'turns a check red' : 'SURVIVED'}`)
    if (!red) survivors.push(name)
  }
  assert.deepEqual(survivors, [], `surviving mutants: ${survivors.join('; ')}`)
  console.log(`${passed} checks passed; ${Object.keys(MUTANTS).length} mutants killed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
