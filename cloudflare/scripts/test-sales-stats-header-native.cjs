#!/usr/bin/env node
// H2 (d1-money): GET /api/sales/stats reads sale HEADERS and returns only (Cut B), and passes no scope when the only list clauses are the
// date/time window the reader already applies (Cut A).
//
// The ORACLE is the same Worker with the route patched back to its old behaviour (always the list scope, the full kernel with sale lines):
// every shape's body must be byte-identical between oracle and build, with report_atomic OFF (live) and ON. Required reds, each a patched
// build that must be CAUGHT: the naive Cut A (scope kept, window dropped: row explosion), a header reader that drops returns (atomic plan
// and legacy pass), a scope dropped for a multi-status filter. Also the field list of the header type and that the public readers refuse it.
// Line independence and the added-later line live in test-sales-stats-header-lines-native.cjs.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld } = require('./read-budget/world.cjs')
const { seedContext } = require('./read-budget/seed.cjs')

const SALES = 'src/routes/sales.ts'
const KERNEL = 'src/lib/salesAnalytics.ts'
const SCOPE_NEW = 'const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(where, params)'
const SCOPE_OLD = 'const scope = salesListFilterReportScope(where, params)'
const HEADER_CALL = 'const totals = await readSalesHeaderTotals(c.env, windowFilter, scope)'
const IMPORT_FRAG = 'readSalesReportSnapshot, readSalesHeaderTotals,'
const WINDOW_NEW = 'const windowFilter={startDate:query.startDate||null,endDate:query.endDate||null,startTime:query.startTime||null,endTime:query.endTime||null}'
const OLD_HEADER = 'const totals = await (async () => { const r = await readSalesReportTotals(c.env, windowFilter, false, scope); return { revenue_usd: r.totals.revenue_usd, pending_revenue_usd: r.totals.pending_revenue_usd, revenue_without_not_paid_usd: r.totals.revenue_without_not_paid_usd, not_paid_owed_usd: r.totals.not_paid_owed_usd, sale_count: r.sale_count, cancelled_count: r.cancelled_count } })()'
const oldRoute = [
  { name: 'old-scope', file: SALES, from: SCOPE_NEW, to: SCOPE_OLD },
  { name: 'old-header', file: SALES, from: HEADER_CALL, to: OLD_HEADER },
  { name: 'old-import', file: SALES, from: IMPORT_FRAG, to: 'readSalesReportSnapshot, readSalesReportTotals,' },
]
const MUTANTS = {
  // the analyst's naive mutant: the list scope kept AND the window dropped from the reader
  naiveScopeWithoutWindow: [
    { name: 'm-scope', file: SALES, from: SCOPE_NEW, to: SCOPE_OLD },
    { name: 'm-window', file: SALES, from: WINDOW_NEW, to: 'const windowFilter={startDate:null,endDate:null,startTime:null,endTime:null}' }],
  // every request loses its scope, including a multi-status one ("window-only" decided wrongly)
  scopeDroppedForStatus: [{ name: 'm-scope-all', file: SALES, from: SCOPE_NEW, to: 'const scope = undefined' }],
  // review M3: one list clause removed from the scope at a time. Each must change the body on a shape that NARROWS the cohort (the seed's sales are all branch 1,
  // one cashier name, so branchId=1 / cashier=a narrow nothing and these mutants used to survive).
  scopeLosesBranch: [{ name: 'm-no-branch', file: SALES, from: SCOPE_NEW, to: "const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(where.filter((w) => !w.includes('@branchId')), params)" }],
  scopeLosesCashier: [{ name: 'm-no-cashier', file: SALES, from: SCOPE_NEW, to: "const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(where.filter((w) => !w.includes('@cashier')), params)" }],
  scopeLosesUser: [{ name: 'm-no-user', file: SALES, from: SCOPE_NEW, to: "const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(where.filter((w) => !w.includes('@userId')), params)" }],
  scopeLosesSearch: [{ name: 'm-no-search', file: SALES, from: SCOPE_NEW, to: "const scope = where.length - 1 === windowClauseCount && !openEndedStart ? undefined : salesListFilterReportScope(query.search || query.q ? where.slice(0, -1) : where, params)" }],
  dropsReturnsAtomic: [{ name: 'm-ret-a', file: KERNEL, from: "  groups.push({ kind: 'returns', sql:", to: "  if (!options.headerOnly) groups.push({ kind: 'returns', sql:" }],
  dropsReturnsLegacy: [{ name: 'm-ret-l', file: KERNEL, from: 'const returns = await reportKeysetRows(db, `SELECT r.id,r.sale_id,r.total_refund_usd,r.status,r.return_scope${returnDebt}${returnPrecision}', to: 'const returns = options.headerOnly ? [] : await reportKeysetRows(db, `SELECT r.id,r.sale_id,r.total_refund_usd,r.status,r.return_scope${returnDebt}${returnPrecision}' }],
}
// Every date is an offset back from the seed's own anchor day (world.ctx.anchorDate = today in the business timezone, from the same seedContext the
// seed uses), never a calendar literal. The seed hangs its sales off the real clock, so a fixed window stops containing any of them: the 'today' shape
// was literally 2026-11-10..11 and held no sales from 12 Nov on, which turns "expected fewer rows" into 0 < 0. The offsets are the ones the old
// literals had on 11 Nov (today = 1 day back .. 0, the 30-day shape = 38..9 days back, and so on), so every shape still narrows or spans what it did.
const shapesFor = (ctx) => {
  const d = (back) => new Date(Date.parse(ctx.anchorDate + 'T00:00:00Z') - back * 86400e3).toISOString().slice(0, 10)
  return {
  'all-time': '',
  'today': `startDate=${d(1)}&endDate=${d(0)}`,
  'range-30d': `startDate=${d(38)}&endDate=${d(9)}`,
  'start-only': `startDate=${d(22)}`,
  'end-only': `endDate=${d(284)}`,
  'dates+time': `startDate=${d(38)}&endDate=${d(9)}&startTime=08:00&endTime=18:00`,
  'time-only': 'startTime=08:00&endTime=18:00',
  'overnight': `startDate=${d(38)}&endDate=${d(9)}&startTime=22:00&endTime=02:00`,
  'end-24:00': `startDate=${d(38)}&endDate=${d(9)}&startTime=00:00&endTime=24:00`,
  'start-time-only': `startDate=${d(38)}&endDate=${d(9)}&startTime=08:00`,
  'multi-status': `startDate=${d(38)}&endDate=${d(9)}&status=completed,awaiting_payment`,
  'status-cancelled': `startDate=${d(38)}&endDate=${d(9)}&status=cancelled`,
  'branch': `startDate=${d(38)}&endDate=${d(9)}&branchId=1`,
  'cashier': `startDate=${d(38)}&endDate=${d(9)}&cashier=a`,
  // narrowing shapes (review M3): the cohort is a strict subset of the window
  'branch-2': `startDate=${d(38)}&endDate=${d(9)}&branchId=2`,
  'cashier-none': `startDate=${d(38)}&endDate=${d(9)}&cashier=zzzz-nobody`,
  'user-none': `startDate=${d(38)}&endDate=${d(9)}&userId=999999`,
  'search-subset': `startDate=${d(38)}&endDate=${d(9)}&search=Customer 1`,
  'search-subset-all-time': 'search=Customer 1',
  }
}
const SHAPE_NAMES = Object.keys(shapesFor(seedContext()))
const ATOMIC = { report_atomic: 'on', report_atomic_long: 'on' }

async function run({ patches = [], switches }) {
  const world = await bootWorld({ tier: 'free', patches, ...(switches ? { switches } : {}) })
  const out = {}
  try {
    for (const [name, qs] of Object.entries(shapesFor(world.ctx))) {
      const r = await world.send('GET', '/api/sales/stats' + (qs ? '?' + qs : ''), undefined, { miss: true })
      out[name] = { status: r.status, text: r.text, calls: r.calls, rr: r.rr }
    }
  } finally { await world.dispose() }
  return out
}

const problems = []
const log = (...a) => console.log(...a)
async function step(name, fn) {
  try { await fn(); log('ok    ' + name) } catch (e) {
    problems.push(name + ': ' + String(e.message).split('\n')[0])
    log('RED   ' + name + '\n      ' + String(e.message).split('\n').slice(0, 3).join('\n      '))
  }
}
const bodies = (res) => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.status + ' ' + v.text]))

;(async () => {
  await step('field list: the header type has exactly the six fields; public readers refuse headerOnly', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8').replace(/\r\n/g, '\n')
    const body = /export interface SalesHeaderTotals \{([^}]*)\}/.exec(src)[1]
    const fields = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
    assert.deepEqual(fields, ['revenue_usd', 'pending_revenue_usd', 'revenue_without_not_paid_usd', 'not_paid_owed_usd', 'sale_count', 'cancelled_count'])
    const fn = /export async function readSalesHeaderTotals[\s\S]*?\n}\n/.exec(src)[0]
    assert.ok(!/snapshot|items|cost|profit/i.test(fn.replace(/\/\/.*$/gm, '')), 'the header reader must not touch snapshots, items, cost or profit')
    assert.ok(/refuseHeaderOnly\(options\)/.test(/export async function readSalesReportTotals\([\s\S]*?\n}\n/.exec(src)[0]), 'public totals reader must refuse headerOnly')
    assert.ok(/refuseHeaderOnly\(options\)/.test(/export async function readSalesReportSnapshot\([\s\S]*?\n}\n/.exec(src)[0]), 'public snapshot reader must refuse headerOnly')
  })

  const oldOff = await run({ patches: oldRoute })
  const newOff = await run({})
  const oldOn = await run({ patches: oldRoute, switches: ATOMIC })
  const newOn = await run({ switches: ATOMIC })
  for (const [mode, o, n] of [['OFF', oldOff, newOff], ['ON', oldOn, newOn]]) {
    await step(`parity (report_atomic ${mode}): every shape answers byte-identically to the old route`, () => assert.deepEqual(bodies(n), bodies(o)))
    await step(`rows and calls (report_atomic ${mode}): never above the old route; below it for the dated and all-time windows`, () => {
      for (const name of SHAPE_NAMES) {
        assert.ok(n[name].rr <= o[name].rr, `${name}: rows ${n[name].rr} > old ${o[name].rr}`)
        assert.ok(n[name].calls <= o[name].calls, `${name}: calls ${n[name].calls} > old ${o[name].calls}`)
      }
      for (const name of ['all-time', 'today', 'range-30d', 'dates+time', 'multi-status', 'status-cancelled']) assert.ok(n[name].rr < o[name].rr, `${name}: expected fewer rows (${n[name].rr} vs ${o[name].rr})`)
    })
  }
  await step('the build answers the same on report_atomic OFF and ON', () => assert.deepEqual(bodies(newOn), bodies(newOff)))
  log('rows/calls old -> new:')
  for (const name of SHAPE_NAMES) log(`   ${name.padEnd(18)} OFF ${oldOff[name].rr}/${oldOff[name].calls} -> ${newOff[name].rr}/${newOff[name].calls}   ON ${oldOn[name].rr}/${oldOn[name].calls} -> ${newOn[name].rr}/${newOn[name].calls}`)

  const caught = async (name, patches, switches) => {
    const res = await run({ patches, switches })
    const base = switches ? oldOn : oldOff
    let red = false
    try { assert.deepEqual(bodies(res), bodies(base)) } catch { red = true }
    // the naive mutant still answers correctly; what it cannot do is stay cheap: a dated window must read about what the build reads
    const good = switches ? newOn : newOff
    if (!red) for (const shape of ['today', 'range-30d']) if (res[shape].rr > good[shape].rr * 1.5) red = true
    await step(`required red: ${name} is caught`, () => assert.ok(red, 'the mutant passed the parity and rows checks'))
  }
  await caught('naive Cut A (scope kept, window dropped)', MUTANTS.naiveScopeWithoutWindow)
  await caught('scope dropped for a multi-status filter', MUTANTS.scopeDroppedForStatus)
  // per-clause scope drops (review M3): required reds, on both switch states
  for (const [label, key] of [['branch', 'scopeLosesBranch'], ['cashier', 'scopeLosesCashier'], ['user', 'scopeLosesUser'], ['search', 'scopeLosesSearch']]) {
    await caught(`scope loses its ${label} clause`, MUTANTS[key])
    await caught(`scope loses its ${label} clause (report_atomic ON)`, MUTANTS[key], ATOMIC)
  }
  await caught('header reader without returns, atomic plan', MUTANTS.dropsReturnsAtomic, ATOMIC)
  await caught('header reader without returns, legacy pass', MUTANTS.dropsReturnsLegacy)

  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  log('\nall green')
})().catch((e) => { console.error(e); process.exit(1) })
