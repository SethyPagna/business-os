#!/usr/bin/env node
// A date window the page sends must narrow what the route returns. The parameter names are read from the frontend source
// that sends them (not retyped here), so a transport that sends startDate/endDate to a route that reads from/to, or the
// reverse, returns the unfiltered report and fails: a page that fetches every row for a one-day window was a live read
// cost (suppliers stock-in invoices) before this guard existed.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { bootWorld } = require('./read-budget/world.cjs')

const ROOT = path.resolve(__dirname, '..', '..')

// route; the frontend file that names the two window parameters and how to read them; fixed parameters the route needs.
const REPORTS = [
  { route: '/api/suppliers/reports/stock-in-invoices', file: 'frontend/src/components/contacts/useStockInInvoiceReport.ts', names: /(\w+):\s*fromDate,\s*(\w+):\s*toDate/, query: 'page=1&page_size=50', ignoresOther: ['startDate', 'endDate'] },
  { route: '/api/customers/reports/ar-invoices', file: 'frontend/src/utils/invoiceRangeParams.ts', names: /return \{ (\w+), (\w+) \}/, query: 'page=1&page_size=50' },
  { route: '/api/sales/customer-report', file: 'frontend/src/components/contacts/CustomerPurchasesReportModal.tsx', names: [/params\.(\w+) = fromDate/, /params\.(\w+) = toDate/], query: 'customerId=2&page=1&page_size=50' },
]

function windowNames(report) {
  const text = fs.readFileSync(path.join(ROOT, report.file), 'utf8')
  const found = Array.isArray(report.names) ? report.names.map((rx) => (rx.exec(text) || [])[1]) : (report.names.exec(text) || []).slice(1, 3)
  assert.ok(found.length === 2 && found.every(Boolean), `${report.file}: cannot find the window parameter names the page sends`)
  return found
}

async function main() {
  const world = await bootWorld({ tier: 'free' })
  let checks = 0
  try {
    const get = async (route, params) => (await world.send('GET', `${route}?${params}`, undefined, { miss: true }))
    for (const report of REPORTS) {
      const [fromName, toName] = windowNames(report)
      const all = await get(report.route, report.query)
      const window = `${fromName}=${world.ctx.today}&${toName}=${world.ctx.today}`
      const narrowed = await get(report.route, `${report.query}&${window}`)
      assert.strictEqual(all.status, 200, `${report.route}: unfiltered answered ${all.status}`)
      assert.strictEqual(narrowed.status, 200, `${report.route}: windowed answered ${narrowed.status}`)
      assert.ok(all.text.length > 200, `${report.route}: the unfiltered report is empty, the fixture cannot discriminate`)
      assert.ok(narrowed.text !== all.text && narrowed.text.length < all.text.length,
        `${report.route}: ${fromName}/${toName} (the names ${report.file} sends) returned ${narrowed.text.length} bytes against ${all.text.length} unfiltered: the route does not read them`)
      checks += 1
      if (report.ignoresOther) {
        const [a, b] = report.ignoresOther
        const wrong = await get(report.route, `${report.query}&${a}=${world.ctx.today}&${b}=${world.ctx.today}`)
        assert.strictEqual(wrong.text, all.text, `${report.route}: control failed, ${a}/${b} narrowed the report after all`)
        checks += 1
      }
    }
  } finally { await world.dispose() }
  console.log(`test-report-date-filter-honoured: ${checks} checks passed`)
}

main().catch((e) => { console.error(`test-report-date-filter-honoured: FAILED: ${e && e.message}`); process.exitCode = 1 })
