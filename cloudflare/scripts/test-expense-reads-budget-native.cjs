'use strict'
// E1-F at the seed's full size: the real Worker under Miniflare (counting D1 proxy, production-sized seed from read-budget/seed.cjs: 8,695 expenses,
// the courier sales, 15,848 sales) with the read switch `expense_reads` OFF and ON.
//   - the answers are identical: every report shape byte for byte (Free and Paid); the whole export (every row, every order) row for row;
//   - OFF is the 6.0.1053 code: the statements it runs are the base's (fingerprints committed by P0.1, plus the switch row read);
//   - ON reads far fewer rows where it is allowed to: the report in one grouped pass for a window of at most the plan's fold cap (Free 1,500 expense rows,
//     Paid 50,000), the export by cursor so a page reads its own rows. A window over the Free cap is turned away after about cap rows and costs only
//     that attempt more than OFF (bounded below); Paid folds it. All figures are printed, per route.
//   - a month's export (one page today) costs no more by cursor than it does today (E1-F review N2).
// The export is the whole loop a user runs ("Export all expenses"), 500 rows asked per page; Free and Paid both serve 500 per cursor page.
//
// Run (from cloudflare/): node scripts/test-expense-reads-budget-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld, fingerprintOf } = require('./read-budget/world.cjs')
const { seedContext } = require('./read-budget/seed.cjs')

// lib/planTier.ts, Free expenseReportFoldMaxRows (pinned by test-plan-tier-pure.cjs and, on the route, by test-expense-reads-native.cjs)
const FREE_FOLD_ROWS = 1500

const ctx = seedContext()
const R = `startDate=${ctx.month}&endDate=${ctx.today}`
const REPORTS = [
  ['report, month', `/api/fees/report?${R}`],
  ['report, month + branch', `/api/fees/report?${R}&branchId=1`],
  ['report, all time', '/api/fees/report'],
  ['report, all time + branch', '/api/fees/report?branchId=1'],
  ['report, month with the sale block', `/api/fees/report?${R}&include=sales`],
  ['report, all time with the sale block', '/api/fees/report?include=sales'],
]
const EXPORTS = [
  ['export, all time', 'source=all'],
  ['export, month', `source=all&${R}`],
  ['export, all time + branch', 'source=all&branch_id=1'],
]

// The statements the 6.0.1053 report ran against the expense table, as P0.1 fingerprinted them for the month shape (fingerprints/api_fees_report.json at b6ebf551d).
const BASE_REPORT_STATEMENTS = ['23b5ef6272bc', 'b5863f84be44', 'ce4ec237f102', '81a7fc9cf696']

async function measureAll(switches, tier = 'free', withExports = true) {
  const world = await bootWorld({ tier, switches })
  const out = { reports: {}, exports: {}, fingerprints: null }
  try {
    await world.send('GET', '/api/fees/types', undefined, { miss: true }) // warm: session, permissions
    for (const [label, url] of REPORTS) {
      const r = await world.send('GET', url, undefined, { miss: true })
      assert.equal(r.status, 200, `${label}: ${r.text.slice(0, 200)}`)
      out.reports[label] = { rows: r.rr, calls: r.calls, body: r.text }
    }
    // The statements of the month report (the last request is the sale block one; run the plain month again for its list)
    await world.send('GET', REPORTS[0][1], undefined, { miss: true })
    // the switch row is read at most once per 15 s per isolate, so it may or may not be in this request: leave it out of the comparison
    out.fingerprints = fingerprintOf((await world.last()).stmts).filter((f) => !/^SELECT key, value FROM system_flags WHERE key IN/.test(f.head)).map((f) => f.h)
    if (!withExports) return out
    for (const [label, qs] of EXPORTS) {
      const rows = []
      const per = []
      let cursor = 'start'
      let total = null
      for (let guard = 0; guard < 400; guard += 1) {
        const r = await world.send('GET', `/api/fees?${qs}&limit=500&offset=${rows.length}&cursor=${encodeURIComponent(cursor)}`, undefined, { miss: true })
        assert.equal(r.status, 200, `${label}: ${r.text.slice(0, 200)}`)
        per.push(r.rr)
        rows.push(...r.json.fees)
        if (total === null) total = r.json.total
        if (r.json.next_cursor === undefined) {
          // an offset answer (the switch is off): this is today's loop
          cursor = null
          if (r.json.fees.length < 500 || rows.length >= total) break
          continue
        }
        if (!r.json.next_cursor) break
        cursor = r.json.next_cursor
      }
      out.exports[label] = { rows: rows.map((row) => JSON.stringify(row)), total, pages: per.length, rowsRead: per.reduce((a, b) => a + b, 0), perPage: per }
    }
  } finally { await world.dispose() }
  return out
}

;(async () => {
  const off = await measureAll(undefined)
  const on = await measureAll({ expense_reads: 'on' })
  const paid = await measureAll({ expense_reads: 'on' }, 'paid', false)

  // 1. identical answers
  for (const [label] of REPORTS) {
    assert.equal(on.reports[label].body, off.reports[label].body, `${label}: the report body differs between OFF and ON (Free)`)
    assert.equal(paid.reports[label].body, off.reports[label].body, `${label}: the report body differs between OFF and ON (Paid)`)
  }
  for (const [label] of EXPORTS) {
    assert.deepEqual(on.exports[label].rows, off.exports[label].rows, `${label}: the exported rows differ between OFF and ON`)
    assert.equal(on.exports[label].total, off.exports[label].total, `${label}: total`)
  }
  console.log(`PASS identical answers at full size: ${REPORTS.length} report bodies byte for byte on Free and on Paid, ${EXPORTS.map(([l]) => `${l} ${on.exports[l].rows.length} rows`).join(', ')}`)

  // 2. OFF is the base
  const offStatements = off.fingerprints.filter((h) => BASE_REPORT_STATEMENTS.includes(h))
  assert.deepEqual(offStatements, BASE_REPORT_STATEMENTS, `OFF runs the four base report statements in the base order: ${off.fingerprints.join(' ')}`)
  assert.equal(on.fingerprints.filter((h) => BASE_REPORT_STATEMENTS.includes(h)).length, 0, 'ON does not run the four statements for a month')
  assert.equal(on.fingerprints.length, off.fingerprints.length - 3, 'ON: one grouped statement instead of four')
  assert.ok(on.fingerprints.every((h) => off.fingerprints.includes(h) || !BASE_REPORT_STATEMENTS.includes(h)))
  console.log('PASS OFF runs the four base report statements (fingerprints from P0.1); ON runs one grouped statement instead for a window the plan lets it fold')

  // 3. rows read, before -> after
  const windowRows = (label) => JSON.parse(off.reports[label].body).totals.count
  const table = []
  for (const [label] of REPORTS) table.push([label, off.reports[label].rows, on.reports[label].rows, `${off.reports[label].rows}->${on.reports[label].rows} (Paid ${paid.reports[label].rows}; ${windowRows(label)} expense rows)`])
  for (const [label] of EXPORTS) table.push([label, off.exports[label].rowsRead, on.exports[label].rowsRead, `${off.exports[label].rowsRead}->${on.exports[label].rowsRead} over ${off.exports[label].pages}->${on.exports[label].pages} pages`])
  console.log('\nrows read, OFF -> ON (Free tier, seed full size)')
  for (const [label, , , text] of table) console.log(`  ${label.padEnd(40)} ${text}`)
  console.log('\nexport rows read per page')
  for (const [label] of EXPORTS) console.log(`  ${label.padEnd(28)} OFF ${off.exports[label].perPage.join(' ')}\n  ${''.padEnd(28)} ON  ${on.exports[label].perPage.join(' ')}`)

  // The report. A window of at most the Free fold cap is read once instead of four times: less than half. A window over it is folded only on Paid: Free is turned away after about
  // cap rows, which costs at most the attempt (the scan of cap + 1 rows through an index, a sorter pass over them, and the switch row) more than OFF.
  const under = REPORTS.filter(([label]) => windowRows(label) <= FREE_FOLD_ROWS).map(([label]) => label)
  const over = REPORTS.filter(([label]) => windowRows(label) > FREE_FOLD_ROWS).map(([label]) => label)
  assert.ok(under.length >= 3 && over.length >= 2, `control: the shapes fall on both sides of the Free cap (under ${under.join(' | ')}; over ${over.join(' | ')})`)
  const ATTEMPT_ROWS = 3 * (FREE_FOLD_ROWS + 1) + 4
  for (const label of under) assert.ok(on.reports[label].rows * 2 < off.reports[label].rows, `${label}: ${off.reports[label].rows} -> ${on.reports[label].rows} is not the cut this change is for`)
  for (const label of over) {
    const extra = on.reports[label].rows - off.reports[label].rows
    assert.ok(extra <= ATTEMPT_ROWS, `${label}: a window over the Free cap cost ${extra} rows more than OFF, more than the attempt (${ATTEMPT_ROWS})`)
    assert.ok(paid.reports[label].rows * 2 < off.reports[label].rows, `${label}: Paid folds it: ${off.reports[label].rows} -> ${paid.reports[label].rows}`)
  }
  console.log(`\nPASS report rows read: ${under.length} windows under the Free cap read less than half; ${over.length} over it cost at most ${ATTEMPT_ROWS} rows more on Free (${over.map((label) => `${on.reports[label].rows - off.reports[label].rows}`).join(', ')} measured) and less than half on Paid`)

  // The export. A large export reads each page's rows instead of the rows before them (a third or less). A small one (a month's, one request today) must cost no more than today.
  for (const [label] of EXPORTS) {
    const offRows = off.exports[label].rowsRead, onRows = on.exports[label].rowsRead
    if (on.exports[label].rows.length <= 500) assert.ok(onRows <= offRows, `${label}: ${offRows} -> ${onRows}: an export that fits one page costs more than today's`)
    else assert.ok(onRows * 3 < offRows, `${label}: ${offRows} -> ${onRows} is not the cut this change is for`)
  }
  const month = on.exports['export, month']
  assert.ok(month.pages === 1 && month.rows.length > 300, `control: the month export is one request of ${month.rows.length} rows`)
  // a cursor page reads its own rows: no later page reads much more than a typical later page, whatever its position in the list (the offset loop grows with it)
  for (const [label] of EXPORTS) {
    const later = on.exports[label].perPage.slice(1).sort((a, b) => a - b)
    if (later.length < 3) continue
    const median = later[Math.floor(later.length / 2)]
    assert.ok(later[later.length - 1] <= median * 3, `${label}: the dearest later cursor page read ${later[later.length - 1]} rows, a typical one ${median}`)
  }
  for (const [label] of EXPORTS) {
    const per = off.exports[label].perPage
    if (per.length >= 4) assert.ok(per[per.length - 2] > per[1], `control: the offset export gets dearer with the page (${per.join(' ')})`)
  }
  const result = {
    reports: Object.fromEntries(table.filter(([l]) => l.startsWith('report')).map(([l, a, b]) => [l, [a, b, paid.reports[l].rows]])),
    exports: Object.fromEntries(table.filter(([l]) => l.startsWith('export')).map(([l, a, b]) => [l, [a, b]])),
  }
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP || require('node:os').tmpdir(), 'expense-reads-budget.json'), JSON.stringify(result, null, 1))
  console.log(`\nPASS export rows read: a large export reads a third or less; the month export (${month.rows.length} rows, one request) is ${off.exports['export, month'].rowsRead} -> ${month.rowsRead}, no dearer than today`)
})().catch((error) => { console.error(error); process.exit(1) })
