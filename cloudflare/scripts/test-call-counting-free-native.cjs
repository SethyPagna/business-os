#!/usr/bin/env node
// P1.1: the Free config (PLAN_TIER=free, the proxy throws on the 51st D1 call as Cloudflare does, a db.batch() is ONE call)
// carries what the statement count used to refuse once call_counting is ON, and still refuses everything else before it writes.
//
//   ON  world: stock sessions 1/5/20/25 lines succeed, 60 (and 1,000) refused with line_limit; returns 1/3/10 succeed with exact stock;
//              sale create/amend are unchanged; the switch is read once by a route that asks and never by one that does not.
//   OFF world: the same sessions of 5/20/25 lines and returns of 3/10 lines are refused with the old codes and write nothing.
//   Mutants:   a batch counted as N again (stock session charge, return create charge) turns the ON world red.
//
// Every refusal is judged by a row-count diff over the touched tables (measureWrite), never by the response alone.
'use strict'

const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { writeShapes, measureWrite, resetSequence, returnOf } = require('./read-budget/writes.cjs')

const LIMIT = 50
const ID = {
  session: (n) => `w-stock-session-${n}-lines`,
  ret: (n) => `w-return-${n}-lines`,
}

async function switchReads(world) {
  const stmts = ((await world.last()).stmts || [])
  return stmts.filter((s) => /system_flags/i.test(s.raw) && JSON.stringify(s.values || []).includes('read_switches')).length
}

async function measureAll(world, ids) {
  resetSequence()
  const shapes = writeShapes(world.ctx)
  const out = {}
  for (const id of ids) {
    const shape = shapes.find((s) => s.id === id)
    assert.ok(shape, `unknown shape ${id}`)
    const m = await measureWrite(world, shape)
    out[id] = { ...m, switchReads: await switchReads(world) }
  }
  return out
}

const delta = (m, key) => Number(m.countsAfter[key] || 0) - Number(m.countsBefore[key] || 0)

// The 86-line sale (the production maximum). Counting calls does not decide these: create answers 500 in the post-commit read
// (D1 SQLITE_TOOBIG, the pricing snapshot of every line embeds the whole basket: P2.1), cancel is refused by the 500-statement bound of
// assertSaleRecordBatchBounds (plan-independent), un-cancel makes ~114 reads (P1.2). Each is held to what must stay true whatever the
// switch says: the failure is never the call limit, a refusal writes nothing, and a request that succeeds fits 50 calls.
const SALE86 = ['w-sale-86-lines', 'w-sale-86-amend', 'w-sale-86-cancel', 'w-sale-86-uncancel']
function sale86Problems(id, m) {
  const out = []
  if (m.switchReads !== 0) out.push(`a sale route read call_counting ${m.switchReads} times: nothing is read unless a route asks`)
  if (m.bgError) out.push(`background error ${m.bgError}`)
  if (id === 'w-sale-86-amend') {
    if (m.status !== 200) out.push(`status ${m.status} ${m.code || ''}, the 86-line amendment is carried today`)
    if (m.calls > LIMIT) out.push(`${m.calls} calls`)
  } else if (m.status === 200) {
    if (m.calls > LIMIT) out.push(`answered 200 in ${m.calls} calls`)
  } else {
    if (id === 'w-sale-86-cancel' && m.changed.length) out.push(`a refused cancel wrote: ${m.changed.join(', ')}`)
    if (id === 'w-sale-86-uncancel' && m.changed.length) out.push(`an un-cancel that failed (${m.status} ${m.code || ''}, ${m.calls} calls) left a partial write: ${m.changed.join(', ')}`)
    if (id === 'w-sale-86-lines' && m.calls > LIMIT) out.push(`${m.calls} calls: the create must fail in the response read, not on the call limit`)
    if (id === 'w-sale-86-cancel' && m.calls > LIMIT) out.push(`${m.calls} calls: the cancel must be refused by its statement bound, not on the call limit`)
  }
  return out
}

// What each shape must do on the ON world. Returns the list of broken expectations.
function onProblems(id, m) {
  if (SALE86.includes(id)) return sale86Problems(id, m)
  const out = []
  const sessionN = /^w-stock-session-(\d+)-lines$/.exec(id)
  const returnN = /^w-return-(\d+)-lines$/.exec(id)
  const ok = () => {
    if (m.status !== 200) out.push(`status ${m.status} ${m.code || ''}`)
    if (m.calls > LIMIT) out.push(`${m.calls} calls`)
    if (m.bgError) out.push(`background error ${m.bgError}`)
  }
  if (sessionN) {
    const n = Number(sessionN[1])
    if (n > 25) {
      if (m.status !== 400 || m.code !== 'line_limit') out.push(`status ${m.status} ${m.code || ''}, expected the plan-independent line_limit`)
      if (m.changed.length) out.push(`a refused session wrote: ${m.changed.join(', ')}`)
      return out
    }
    ok()
    if (!m.changed.includes('stock_session_operations')) out.push('no stock_session_operations row')
    if (delta(m, 'branch_stock_qty') !== 3 * n) out.push(`branch stock moved ${delta(m, 'branch_stock_qty')}, expected ${3 * n}`)
    if (delta(m, 'lot_qty') !== 3 * n) out.push(`lots moved ${delta(m, 'lot_qty')}, expected ${3 * n}`)
    if (m.switchReads !== 1) out.push(`call_counting read ${m.switchReads} times, expected exactly 1`)
  } else if (returnN) {
    const n = Number(returnN[1])
    ok()
    if (delta(m, 'returns') !== 1) out.push(`${delta(m, 'returns')} return rows, expected 1`)
    if (delta(m, 'return_items') !== n) out.push(`${delta(m, 'return_items')} return_items, expected ${n}`)
    if (delta(m, 'branch_stock_qty') !== n) out.push(`branch stock moved ${delta(m, 'branch_stock_qty')}, expected ${n} (restock)`)
    if (m.switchReads !== 1) out.push(`call_counting read ${m.switchReads} times, expected exactly 1`)
  } else {
    ok()
    if (/^w-sale-/.test(id) && m.switchReads !== 0) out.push(`a sale route read call_counting ${m.switchReads} times: nothing is read unless a route asks`)
  }
  return out
}

// The OFF world must behave exactly like the base: the statement count refuses what call counting admits.
function offProblems(id, m, onResult) {
  const out = []
  if (SALE86.includes(id)) {
    // The sale routes never consult the switch, so the two worlds must agree on everything that is not a clock value.
    if (m.status !== onResult.status || m.code !== onResult.code) out.push(`answered ${m.status} ${m.code || ''}, ON answered ${onResult.status} ${onResult.code || ''}`)
    if (m.changed.join() !== onResult.changed.join()) out.push(`changed ${m.changed.join(',')}, ON changed ${onResult.changed.join(',')}`)
    if (m.calls !== onResult.calls) out.push(`${m.calls} calls, ON ${onResult.calls}`)
    return out
  }
  const sessionN = /^w-stock-session-(\d+)-lines$/.exec(id)
  const returnN = /^w-return-(\d+)-lines$/.exec(id)
  const n = Number((sessionN || returnN)[1])
  const refusedCode = sessionN ? 'stock_session_query_budget_exceeded' : 'customer_return_over_plan_budget'
  if (n === 1) {
    if (m.status !== 200) out.push(`status ${m.status} ${m.code || ''}, the one-line case is carried by both`)
  } else {
    if (m.code !== refusedCode) out.push(`code ${m.code}, expected the old ${refusedCode}`)
    if (m.changed.length) out.push(`a refused request wrote: ${m.changed.join(', ')}`)
  }
  return out
}

function report(label, problemsById) {
  const reds = []
  for (const [id, problems] of Object.entries(problemsById)) for (const p of problems) reds.push(`${label} ${id}: ${p}`)
  return reds
}

async function main() {
  const reds = []
  const notes = []

  // ---- ON ----------------------------------------------------------------------------------------------------------------------------
  const ON_IDS = [ID.session(1), ID.session(5), ID.session(20), ID.session(25), ID.session(60),
    ID.ret(1), ID.ret(3), ID.ret(10),
    'w-sale-1-lines', 'w-sale-10-lines', 'w-sale-30-lines', ...SALE86]
  const on = await bootWorld({ tier: 'free', switches: { call_counting: 'on' }, enforceCalls: true })
  let onResults
  try {
    const results = await measureAll(on, ON_IDS)
    onResults = results
    reds.push(...report('ON', Object.fromEntries(ON_IDS.map((id) => [id, onProblems(id, results[id])]))))
    for (const id of ON_IDS) notes.push(`ON  ${id}: ${results[id].status} ${results[id].code || ''} ${results[id].calls} calls, ${results[id].statements} statements${SALE86.includes(id) ? `, wrote ${results[id].changed.join(',') || 'nothing'}` : ''}`)

    // Loophole 1: a 1,000-line session is refused before the database is touched for it (the body guard or the 25-line cap, whichever answers first).
    resetSequence()
    const big = await measureWrite(on, { id: 'x-session-1000', method: 'POST', url: '/api/inventory/sessions',
      prepare: async () => ({ client_request_id: 'cc-1000-lines-0001', mode: 'stock_in', defaults: { supplier_name: 'Supplier 3', branch_id: 1, received_date: on.ctx.today.split('-').reverse().join('/') },
        items: Array.from({ length: 1000 }, (_, i) => ({ line_id: `l-${i}`, kind: 'receive', product_id: 1000 + (i % 400), quantity: 1, unit_cost_usd: 2 })) }),
      run: async (world, send, body) => send('POST', '/api/inventory/sessions', body) })
    if (big.status !== 400 || !['line_limit', 'request_too_large'].includes(big.code)) reds.push(`ON 1,000-line session: ${big.status} ${big.code || ''}, expected a 400 line_limit or request_too_large`)
    if (big.changed.length) reds.push(`ON 1,000-line session wrote: ${big.changed.join(', ')}`)
    notes.push(`ON  1,000-line session: ${big.status} ${big.code || ''} in ${big.calls} calls, wrote ${big.changed.length ? big.changed.join(',') : 'nothing'}`)

    // Loophole 2: a long return of a long sale is made whole inside 50 calls or refused whole; it is never half-applied.
    for (const [lines, offset] of [[30, 1200], [40, 1260]]) {
      const m = await measureWrite(on, { ...returnOf(lines, offset, lines), id: `x-return-${lines}-of-${lines}` })
      const wrote = m.changed.length > 0
      if (m.status === 200) {
        if (m.calls > LIMIT) reds.push(`ON ${lines}-line return: ${m.calls} calls`)
        if (delta(m, 'returns') !== 1 || delta(m, 'return_items') !== lines) reds.push(`ON ${lines}-line return answered 200 with ${delta(m, 'returns')} return rows and ${delta(m, 'return_items')} items`)
        if (delta(m, 'branch_stock_qty') !== lines || delta(m, 'lot_qty') !== lines) reds.push(`ON ${lines}-line return answered 200 but restocked ${delta(m, 'branch_stock_qty')} units / ${delta(m, 'lot_qty')} lot units`)
      } else if (wrote) reds.push(`ON ${lines}-line return answered ${m.status} ${m.code || ''} but wrote: ${m.changed.join(', ')}`)
      notes.push(`ON  ${lines}-line return of a ${lines}-line sale: ${m.status} ${m.code || ''} ${m.calls} calls, ${m.status === 200 ? 'made whole' : wrote ? 'WROTE ' + m.changed.join(',') : 'wrote nothing'}`)
    }
  } finally { await on.dispose() }

  // ---- OFF ---------------------------------------------------------------------------------------------------------------------------
  const OFF_IDS = [ID.session(1), ID.session(5), ID.session(20), ID.session(25), ID.ret(1), ID.ret(3), ID.ret(10), ...SALE86]
  const off = await bootWorld({ tier: 'free', switches: { call_counting: 'off' }, enforceCalls: true })
  try {
    const results = await measureAll(off, OFF_IDS)
    reds.push(...report('OFF', Object.fromEntries(OFF_IDS.map((id) => [id, offProblems(id, results[id], onResults[id])]))))
    for (const id of OFF_IDS) notes.push(`OFF ${id}: ${results[id].status} ${results[id].code || ''} ${results[id].calls} calls`)
  } finally { await off.dispose() }

  // ---- mutants: a batch counted as N statements again must turn the ON world red --------------------------------------------------------
  const MUTANTS = [
    { name: 'stock session charges the statement count', ids: [ID.session(5), ID.session(20)],
      patches: [{ name: 'session-charge', file: 'src/lib/stockSession.ts', from: 'const charge = budget?.callCounting ? 1 : stockTransactionStatementCount(statements.length)', to: 'const charge = stockTransactionStatementCount(statements.length)' }] },
    { name: 'return create charges the statement count', ids: [ID.ret(3), ID.ret(10)],
      patches: [{ name: 'return-charge', file: 'src/routes/returns.ts', from: 'const transactionStatementCount = callCounting ? 1 : hasStockWrite', to: 'const transactionStatementCount = hasStockWrite' }] },
  ]
  for (const mutant of MUTANTS) {
    const world = await bootWorld({ tier: 'free', switches: { call_counting: 'on' }, enforceCalls: true, patches: mutant.patches })
    try {
      const results = await measureAll(world, mutant.ids)
      const caught = mutant.ids.filter((id) => onProblems(id, results[id]).length)
      notes.push(`MUTANT ${mutant.name}: red on ${caught.length} of ${mutant.ids.length} shapes (${mutant.ids.map((id) => results[id].status + ' ' + (results[id].code || '')).join(', ')})`)
      if (caught.length !== mutant.ids.length) reds.push(`mutant "${mutant.name}" survived on ${mutant.ids.filter((id) => !caught.includes(id)).join(', ')}`)
    } finally { await world.dispose() }
  }

  console.log('call-counting Free native:')
  for (const line of notes) console.log('  ' + line)
  console.log(`call-counting Free native: ${reds.length} problems`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
}

main().catch((e) => { console.error(`test-call-counting-free-native: crashed: ${e && e.stack}`); process.exitCode = 1 })
