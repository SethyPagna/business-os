#!/usr/bin/env node
// Fixture proof for the owner's late-payment list (lane late-pay-list):
//   ops/queries/report-late-payments.sql          one row per settlement event counted in the wrong shift/day/cashier
//   ops/queries/report-late-payments-summary.sql  the same set by Cambodia month plus an ALL row
// Each runs exactly as the ops workflow runs it (the guard's canonical text) on a fresh node:sqlite database built from every
// migration. Sales are seeded with the shift they were rung in; settlements are seeded as the Worker writes them
// (sale_record_events, source_kind sale_settlement, changes_json before/after). Two mutants are run on the same database and
// must disagree with the expected rows: one dates the taking by the sale's own created_at, one uses UTC dates.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const DETAIL = 'report-late-payments'
const SUMMARY = 'report-late-payments-summary'
const PERSONAL_COLUMN = /(^|_)(name|phone|address|email|note|notes)$/

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'late-payments-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const opened = []

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack}`)
    process.exitCode = 1
  }
}

function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}

function migratedDatabase() {
  const file = path.join(SCRATCH, `db-${opened.length + 1}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  opened.push(db)
  return db
}

function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}

const val = (value) => (value === null ? { state: 'known_none' } : { state: 'known_value', value })
const change = (field, before, after) => ({ field, before: val(before), after: val(after) })
let eventSeq = 0
function settlement(saleId, { kind = 'payment_settled', via = 'apply', generation = 0, actor, username, at, changes, source = 'sale_settlement', op }) {
  eventSeq += 1
  return {
    id: `00000000-0000-4000-8000-${String(eventSeq).padStart(12, '0')}`,
    sale_id: saleId, source_kind: source, source_id: op || `op-${saleId}`, generation, kind, via,
    actor_id: actor, actor_username: username, occurred_at: at, changes_json: JSON.stringify(changes),
  }
}
const details = (...rows) => rows.map(([method, usd, khr = 0]) => ({ method, amount_usd: usd, amount_khr: khr }))

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const sql = (name) => guard.loadQuery(name).sql
  const run = (db, text) => db.prepare(text).all().map((row) => ({ ...row }))

  await check('both queries pass the guard as bounded read-only lists, return no personal column, and run on the bare schema', () => {
    const db = migratedDatabase()
    for (const name of [DETAIL, SUMMARY]) {
      const q = guard.loadQuery(name)
      assert.ok(q.maxRowsRead > 0 && !q.refusedOnFree, `${name}: states a read budget`)
      assert.ok(q.sql.length <= 12000, `${name}: ${q.sql.length} canonical characters`)
      assert.ok((q.sql.match(/\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/gi) || []).length <= 5, `${name}: compound SELECT terms`)
      const statement = db.prepare(q.sql)
      const columns = statement.columns().map((c) => c.name)
      assert.deepEqual(columns.filter((c) => PERSONAL_COLUMN.test(c)), [], `${name}: personal column`)
      assert.ok(!columns.some((c) => /phone|customer/i.test(c)), `${name}: customer column`)
      assert.equal(new Set(columns).size, columns.length, `${name}: duplicate column names`)
    }
    const detail = guard.loadQuery(DETAIL)
    assert.equal(detail.rules.maxRows, 5000)
    assert.ok(/ LIMIT 5001$/.test(detail.sql), 'the cap is LIMIT max-rows + 1 so an over-long list trips max-rows instead of truncating')
    assert.deepEqual(run(db, detail.sql), [])
    assert.deepEqual(run(db, sql(SUMMARY)).map((r) => [r.taken_month, r.events]), [['ALL', 0]])
    for (const name of [DETAIL, SUMMARY]) {
      const file = fs.readFileSync(path.join(ROOT, 'ops', 'queries', `${name}.sql`), 'utf8')
      assert.ok(!file.includes('\r'), `${name}: LF only`)
    }
  })

  await check('both queries share one event-set definition (the summary cannot drift from the list)', () => {
    const cut = (text, tail) => text.slice(text.indexOf('WITH sh AS'), text.indexOf(tail))
    assert.equal(cut(sql(DETAIL), ' SELECT w.event_id'), cut(sql(SUMMARY), ' SELECT m.taken_month'))
  })

  // ---- fixture -----------------------------------------------------------------------------------------------------
  // Times are UTC; the Cambodia business date is UTC+7. Branch 1 per_account shifts unless noted.
  const seed = (db) => {
    const shift = (id, user, opened_at, closed_at, extra = {}) => ({
      id, shift_code: `S-${id}`, user_id: user, branch_id: 1, business_date: opened_at.slice(0, 10), opened_at, closed_at, ...extra,
    })
    insert(db, 'shift_sessions', [
      shift(1, 10, '2026-10-01 01:00:00', '2026-10-01 10:00:00'),                       // A: cashier 10, Oct 1
      shift(2, 20, '2026-10-02 01:00:00', '2026-10-02 10:00:00'),                       // B: cashier 20, Oct 2
      shift(3, 10, '2026-10-03 01:00:00', '2026-10-03 10:00:00'),                       // C: cashier 10, Oct 3
      shift(7, 40, '2026-10-01 07:00:00', '2026-10-01 10:00:00'),                       // cashier 40, Oct 1 afternoon
      shift(9, 10, '2026-10-05 15:00:00', '2026-10-06 03:00:00', { business_date: '2026-10-05' }), // spans Cambodia midnight
      shift(10, 10, '2026-10-07 19:00:00', '2026-10-08 12:00:00', { business_date: '2026-10-08' }), // spans UTC midnight
      shift(5, 30, '2026-10-01 01:00:00', '2026-10-01 10:00:00', { branch_id: 2, scope_mode: 'shop_wide' }), // branch 2 shop-wide
      shift(11, 10, '2026-10-09 01:00:00', null),                                       // cashier 10 open-ended
    ])
    const sale = (id, cashier, created_at, extra = {}) => ({
      id, receipt_number: `R-${id}`, cashier_id: cashier, branch_id: 1, total_usd: 50, subtotal_usd: 50, exchange_rate: 4100,
      amount_paid_usd: 50, created_at, ...extra,
    })
    insert(db, 'sales', [
      sale(101, 10, '2026-10-01 03:00:00'),                         // settled next day by another cashier
      sale(102, 10, '2026-10-01T03:30:00.000Z'),                    // ISO created_at; settled same day by cashier 40 in a later shift
      sale(104, 10, '2026-10-01 03:00:00'),                         // CONTROL: settled in the same shift by the same cashier
      sale(106, 10, '2026-10-01 04:00:00'),                         // settled after its shift closed, by someone with no shift
      sale(107, 10, '2026-10-05 16:00:00'),                         // 23:00 Oct 5 Cambodia; settled 01:00 Oct 6 in the same shift
      sale(108, 10, '2026-10-07 20:00:00'),                         // 03:00 Oct 8 Cambodia; settled 17:00 Oct 8: CONTROL (UTC days differ, Cambodia days equal)
      sale(109, 10, '2026-10-01 03:00:00', { payments_version: 1 }), // version 1: events are already dated by the taking
      sale(110, 10, '2026-10-01 05:00:00'),                         // payment CORRECTION on a later day
      sale(111, 31, '2026-10-01 02:00:00', { branch_id: 2 }),       // shop-wide shift: same shift, other cashier
      sale(112, 10, '2026-10-01 03:00:00'),                         // only a status event, no money
      sale(113, 10, '2026-10-09 02:00:00'),                         // open-ended shift; settled days later in the same shift, same cashier
      sale(114, 10, '2026-10-01 03:00:00'),                         // a bulk relabel is a different source, not a settlement
    ])
    const D = (usd) => [change('amount_paid_usd', 10, usd), change('payment_details', details(['Cash', 10]), details(['Cash', 10], ['ABA', usd - 10]))]
    insert(db, 'sale_record_events', [
      settlement(101, { actor: 20, username: 'cashier20', at: '2026-10-02T03:00:00.000Z', op: 'op-101', changes: D(50) }),
      settlement(101, { kind: 'payment_settled', via: 'undo', generation: 1, actor: 10, username: 'cashier10', at: '2026-10-03T04:00:00.000Z', op: 'op-101', changes: [change('amount_paid_usd', 50, 10), change('payment_details', details(['Cash', 10], ['ABA', 40]), details(['Cash', 10]))] }),
      settlement(101, { via: 'redo', generation: 2, actor: 10, username: 'cashier10', at: '2026-10-03T05:00:00.000Z', op: 'op-101', changes: D(50) }),
      settlement(102, { actor: 40, username: 'cashier40', at: '2026-10-01T08:00:00.000Z', changes: D(50), op: 'op-102' }),
      settlement(104, { actor: 10, username: 'cashier10', at: '2026-10-01T04:00:00.000Z', changes: D(50), op: 'op-104' }),
      settlement(106, { actor: 10, username: 'cashier10', at: '2026-10-01T12:00:00.000Z', changes: D(50), op: 'op-106' }),
      settlement(107, { actor: 10, username: 'cashier10', at: '2026-10-05T18:00:00.000Z', changes: D(50), op: 'op-107' }),
      settlement(108, { actor: 10, username: 'cashier10', at: '2026-10-08T10:00:00.000Z', changes: D(50), op: 'op-108' }),
      settlement(109, { actor: 20, username: 'cashier20', at: '2026-10-02T03:00:00.000Z', changes: D(50), op: 'op-109' }),
      settlement(110, { kind: 'payment_changed', actor: 20, username: 'cashier20', at: '2026-10-02T04:00:00.000Z', op: 'op-110',
        changes: [change('payment_method', 'Cash', 'ABA'), change('payment_details', details(['Cash', 50]), details(['ABA', 50]))] }),
      settlement(111, { actor: 32, username: 'cashier32', at: '2026-10-01T05:00:00.000Z', op: 'op-111', changes: [change('amount_paid_usd', 0, 50), change('amount_paid_khr', 0, 20500)] }),
      settlement(112, { actor: 20, username: 'cashier20', at: '2026-10-02T03:00:00.000Z', op: 'op-112', changes: [change('sale_status', 'completed', 'delivered')] }),
      settlement(113, { actor: 10, username: 'cashier10', at: '2026-10-10T03:00:00.000Z', changes: D(50), op: 'op-113' }),
      settlement(114, { source: 'sale_bulk_update', kind: 'payment_changed', actor: 20, username: 'cashier20', at: '2026-10-02T03:00:00.000Z', op: 'op-114',
        changes: [change('payment_method', 'Cash', 'ABA')] }),
    ])
  }

  const key = (r) => `${r.sale_id}:${r.via}:${r.generation}`
  const expected = {
    '101:apply:0': { flag_kind: 'different_day', sale_business_date: '2026-10-01', taken_business_date: '2026-10-02', sale_shift_id: 1, taking_shift_id: 2, sale_cashier_id: 10, taking_actor_id: 20, delta_usd: 40, methods_added: 'ABA', methods_removed: null, f: [1, 1, 1, 0] },
    '101:undo:1': { flag_kind: 'different_day', sale_business_date: '2026-10-01', taken_business_date: '2026-10-03', sale_shift_id: 1, taking_shift_id: 3, sale_cashier_id: 10, taking_actor_id: 10, delta_usd: -40, methods_added: null, methods_removed: 'ABA', f: [1, 1, 0, 0] },
    '101:redo:2': { flag_kind: 'different_day', taking_shift_id: 3, delta_usd: 40, methods_added: 'ABA', f: [1, 1, 0, 0] },
    '102:apply:0': { flag_kind: 'different_shift', sale_business_date: '2026-10-01', taken_business_date: '2026-10-01', sale_shift_id: 1, taking_shift_id: 7, sale_cashier_id: 10, taking_actor_id: 40, delta_usd: 40, f: [0, 1, 1, 0] },
    '106:apply:0': { flag_kind: 'no_shift_at_time', sale_shift_id: 1, taking_shift_id: null, taking_actor_id: 10, delta_usd: 40, f: [0, 0, 0, 1] },
    '107:apply:0': { flag_kind: 'different_day', sale_business_date: '2026-10-05', taken_business_date: '2026-10-06', sale_shift_id: 9, taking_shift_id: 9, delta_usd: 40, f: [1, 0, 0, 0] },
    '110:apply:0': { flag_kind: 'different_day', is_correction: 1, delta_usd: 0, delta_khr: 0, methods_added: 'ABA', methods_removed: 'Cash', sale_shift_id: 1, taking_shift_id: 2, f: [1, 1, 1, 0] },
    '111:apply:0': { flag_kind: 'different_cashier', sale_shift_id: 5, taking_shift_id: 5, sale_cashier_id: 31, taking_actor_id: 32, delta_usd: 50, delta_khr: 20500, f: [0, 0, 1, 0] },
    '113:apply:0': { flag_kind: 'different_day', sale_shift_id: 11, taking_shift_id: 11, taken_business_date: '2026-10-10', f: [1, 0, 0, 0] },
  }

  await check('the list is exactly the settlements counted in a different shift, day or cashier, with the right amounts', () => {
    const db = migratedDatabase()
    seed(db)
    const rows = run(db, sql(DETAIL))
    assert.deepEqual(rows.map(key).sort(), Object.keys(expected).sort(), 'row set')
    for (const row of rows) {
      const want = expected[key(row)]
      const { f, ...fields } = want
      for (const [k, v] of Object.entries(fields)) assert.equal(row[k], v, `${key(row)}.${k}`)
      assert.deepEqual([row.f_different_day, row.f_different_shift, row.f_different_cashier, row.f_no_shift_at_time], f, `${key(row)} flags [day, shift, cashier, no_shift]`)
      assert.equal(row.receipt_no, `R-${row.sale_id}`)
    }
    const r101 = rows.find((r) => key(r) === '101:apply:0')
    assert.deepEqual([r101.paid_usd_before, r101.paid_usd_after, r101.branch_id], [10, 50, 1])
    // 102's created_at is an ISO text; the controls are absent
    for (const absent of [104, 108, 109, 112, 114]) assert.ok(!rows.some((r) => r.sale_id === absent), `sale ${absent} must not be listed`)
    assert.equal(rows.find((r) => r.sale_id === 101 && r.via === 'apply').taking_actor_username, 'cashier20')
  })

  await check('the summary matches the list, by Cambodia month the money was taken, with an ALL row', () => {
    const db = migratedDatabase()
    seed(db)
    const rows = run(db, sql(DETAIL))
    const summary = run(db, sql(SUMMARY))
    assert.deepEqual(summary.map((r) => r.taken_month), ['2026-10', 'ALL'])
    const all = summary.find((r) => r.taken_month === 'ALL')
    assert.equal(all.events, rows.length)
    assert.equal(all.sales, new Set(rows.map((r) => r.sale_id)).size)
    assert.equal(all.different_day, rows.filter((r) => r.f_different_day).length)
    assert.equal(all.different_shift, rows.filter((r) => r.f_different_shift).length)
    assert.equal(all.different_cashier, rows.filter((r) => r.f_different_cashier).length)
    assert.equal(all.no_shift_at_time, rows.filter((r) => r.f_no_shift_at_time).length)
    assert.equal(all.undo_redo, 2)
    assert.equal(all.corrections, 1)
    assert.equal(all.settles, rows.length - 3)
    assert.equal(all.net_usd, rows.reduce((s, r) => s + r.delta_usd, 0))
    assert.equal(all.net_khr, 20500)
    const month = summary.find((r) => r.taken_month === '2026-10')
    assert.equal(month.events, all.events)
  })

  await check('mutants disagree: dating the taking by the sale\'s own created_at, or by UTC dates, changes the answer', () => {
    const db = migratedDatabase()
    seed(db)
    const good = run(db, sql(DETAIL)).map(key).sort()
    const text = sql(DETAIL)
    const self = text.replace('COALESCE(datetime(ev.occurred_at), ev.occurred_at) AS taken_at', 'COALESCE(datetime(s.created_at), s.created_at) AS taken_at')
    assert.notEqual(self, text, 'the mutation applied')
    const selfRows = run(db, self).map(key).sort()
    assert.notDeepEqual(selfRows, good, 'a query that compares created_at to itself must fail this fixture')
    assert.notEqual(run(db, self).find((r) => key(r) === '101:apply:0').flag_kind, 'different_day', 'the self-compared query cannot see the next-day settlement')
    const utc = text.split(", '+7 hours')").join(')')
    assert.notEqual(utc, text)
    assert.notDeepEqual(run(db, utc).map(key).sort(), good, 'UTC dates mis-date the midnight cases')
    const noVersion = text.replace(' WHERE s.payments_version = 0', '')
    assert.ok(run(db, noVersion).some((r) => r.sale_id === 109), 'without the version filter the version 1 sale leaks in')
  })

  if (process.exitCode) console.error(`test-report-late-payments-native: FAILED (${passed} passed)`)
  else console.log(`test-report-late-payments-native: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-report-late-payments-native: crashed: ${err && err.stack}`)
  process.exitCode = 1
}).finally(() => {
  for (const db of opened) db.close()
  fs.rmSync(SCRATCH, { recursive: true, force: true })
})
