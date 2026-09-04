#!/usr/bin/env node
/*
 * Pure guards for import-sep02-legacy-reports.mjs.  Makes no D1, network or
 * filesystem-write call, so it can run anywhere in the fleet.
 *
 * All paths resolve from __dirname, never the cwd -- the backend sweep bug
 * recorded in progress.md Part 585 made a cwd-relative read look like a lane
 * error from cloudflare/scripts/ and pass from cloudflare/.
 */
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const here = __dirname
const repo = path.resolve(here, '../../..')
const legacyRoot = path.join(repo, 'Migration from old system')
const planner = path.join(here, 'import-sep02-legacy-reports.mjs')

const decode = (html) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

function tableRows(file) {
  const html = fs.readFileSync(file, 'utf8')
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => decode(td[1])))
}

let failures = 0
function check(label, fn) {
  try { fn(); console.log(`ok   ${label}`) } catch (error) {
    failures += 1
    console.log(`FAIL ${label}\n     ${error.message}`)
  }
}

// The four dated exports are archived under -sep02-04 names on purpose: the
// archive already holds an unrelated near-empty `report-invoice-detail.xls`,
// so resolving by the bare report name would silently pick the wrong file.
const sources = {
  invoice: 'report-invoice-detail-sep02-04.xls',
  receivable: 'account-receivable-report-sep02-04.xls',
  payable: 'account-payable-report-supplier-sep02-04.xls',
  item: 'report-item-new-sep02-04.xls',
}
check('all four dated source exports are archived in the repo', () => {
  for (const [label, name] of Object.entries(sources)) {
    assert.ok(fs.existsSync(path.join(legacyRoot, name)), `missing ${label}: ${name}`)
  }
})

check('the bare-named archive report is NOT this batch (name-collision guard)', () => {
  const bare = path.join(legacyRoot, 'report-invoice-detail.xls')
  if (!fs.existsSync(bare)) return
  const bareRows = tableRows(bare).length
  const datedRows = tableRows(path.join(legacyRoot, sources.invoice)).length
  assert.notStrictEqual(bareRows, datedRows, 'bare and dated invoice reports look identical -- check which one is the Sep 2-4 export')
})

check('invoice detail parses to 37 invoices, 004420..004456', () => {
  const rows = tableRows(path.join(legacyRoot, sources.invoice))
  const header = rows[0]
  const invoiceIndex = header.indexOf('Invoice No')
  assert.ok(invoiceIndex >= 0, 'no "Invoice No" column')
  const numbers = rows.slice(1, -1).map((row) => row[invoiceIndex]).filter(Boolean)
  assert.strictEqual(numbers.length, 37, `expected 37 invoices, got ${numbers.length}`)
  assert.strictEqual(numbers[numbers.length - 1], '004420')
  assert.strictEqual(numbers[0], '004456')
})

check('AP export carries the 5 all-paid supplier rows totalling 3,002.00', () => {
  const rows = tableRows(path.join(legacyRoot, sources.payable)).slice(5, -1).filter((row) => row.length > 5)
  assert.strictEqual(rows.length, 5, `expected 5 AP rows, got ${rows.length}`)
  for (const row of rows) assert.strictEqual(row[12], 'Paid', `AP row ${row[0]} is not Paid`)
  const total = rows.reduce((sum, row) => sum + Number(row[9].replaceAll(',', '')), 0)
  assert.strictEqual(Number(total.toFixed(2)), 3002)
})

check('AR export carries 35 rows over the same invoice range', () => {
  const rows = tableRows(path.join(legacyRoot, sources.receivable)).slice(5, -1).filter((row) => row.length > 5)
  assert.strictEqual(rows.length, 35, `expected 35 AR rows, got ${rows.length}`)
})

const source = fs.readFileSync(planner, 'utf8')

// The user's instruction for this batch was "don't affect stock quantity, no
// deduction".  A planner that ever emits a write to one of these is a defect,
// not a preference -- routes/sales.ts and lib/importEngine.ts move stock for a
// stock-deducted status, which is exactly why this batch bypasses them.
check('planner emits no write to any stock-bearing table', () => {
  const forbidden = [
    'branch_stock', 'branch_batch_stock', 'inventory_movements', 'product_batches',
    'sale_item_batch_allocations', 'legacy_inventory_effects', 'damaged_stock_lots',
  ]
  for (const table of forbidden) {
    const written = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i')
    assert.ok(!written.test(source), `planner writes to ${table}`)
  }
  assert.ok(!/UPDATE\s+products\s+SET/i.test(source), 'planner updates products')
  assert.ok(!/INSERT\s+INTO\s+products\b/i.test(source), 'planner creates products')
  assert.ok(!/INSERT\s+INTO\s+customers\b/i.test(source), 'planner creates customers')
  assert.ok(!/stock_quantity\s*=/.test(source), 'planner assigns stock_quantity')
})

check('historical sales are imported with loyalty accrual off', () => {
  assert.ok(/loyalty_accrual/.test(source), 'loyalty_accrual is not set at all')
  const insert = source.slice(source.indexOf('INSERT INTO sales'))
  assert.ok(/loyalty_accrual, is_delivery[\s\S]{0,400}?,\s*0,\s*\$\{/.test(insert)
    || /,\s*0,\s*\$\{sale\.deliveryService/.test(insert), 'loyalty_accrual is not the literal 0')
})

// The first run of this import wrote total_usd and amount_paid_usd but never
// subtotal_usd, so 22 sales stored a 0 subtotal. Canonical revenue is built on
// subtotal_usd (salesAnalytics.ts, netSaleExpr) and never reads total_usd, so
// $3,462 of real, paid trade was invisible to every revenue, profit, dashboard
// and report figure -- while the Sales list, which renders total_usd, showed it
// correctly. Nothing errored; the money simply was not there.
//
// The expected column set is READ OUT OF the revenue definition rather than
// spelled out here, so the guard tracks the kernel instead of a snapshot of it.
check('the sales INSERT lists every column the revenue definition reads', () => {
  const analytics = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'cloudflare', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  const def = analytics.match(/export function netSaleExpr\(p: string\): string \{([\s\S]*?)\n\}/)
  assert.ok(def, 'netSaleExpr is gone or has been reshaped -- re-derive this guard against the new revenue definition')
  const needed = [...new Set([...def[1].matchAll(/\$\{p\}([a-z_]+)/g)].map((m) => m[1]))]
  assert.ok(needed.includes('subtotal_usd'), 'revenue no longer reads subtotal_usd; this guard needs rewriting')

  const insert = source.slice(source.indexOf('INSERT INTO sales'))
  const columns = insert.slice(insert.indexOf('(') + 1, insert.indexOf(')'))
  for (const column of needed) {
    assert.ok(new RegExp('\\b' + column + '\\b').test(columns),
      `the sales INSERT omits ${column}, which the revenue definition reads -- ` +
      'an omitted money column defaults to 0 and the sale is silently worth less than it is')
  }
})

check('every ambiguous barcode carries an explicit reviewed ruling', () => {
  const block = source.slice(source.indexOf('AMBIGUOUS_BARCODE_RULINGS = Object.freeze({'))
  const body = block.slice(0, block.indexOf('})'))
  const expected = ['079625042856', '041554502015', '693667330100', '041554554502', '5060696176040', '3348901770569']
  for (const code of expected) {
    assert.ok(new RegExp(`^\\s*'${code}':\\s*\\d+`, 'm').test(body), `no ruling for ${code}`)
  }
  const ruled = [...body.matchAll(/^\s*'(\d+)':\s*(\d+)/gm)]
  assert.strictEqual(ruled.length, expected.length, `expected ${expected.length} rulings, found ${ruled.length}`)
})

// Regression guard for the mis-attribution hazard found in pre-write review.
// barcodeKey() strips non-digits, so "Libre10ml" becomes "10" -- and 44 live
// products carry the literal barcode "10" (the 10ml perfume placeholder),
// three of them active. Feeding a SKU-style code into the barcode index would
// book a line against an unrelated product and look correct forever.
check('a non-numeric source code never reaches the barcode index', () => {
  assert.ok(/isNumericCode\s*=\s*\(code\)\s*=>\s*\/\^\[0-9\]\+\$\//.test(source),
    'isNumericCode gate is missing or no longer anchors the whole string')
  assert.ok(/const key = isNumericCode\(code\) \? barcodeKey\(code\) : ''/.test(source),
    'resolveProduct no longer gates the barcode lookup on a fully numeric code')
  const gate = /^\[0-9\]\+$/
  for (const code of ['Libre10ml', 'CompletelyClean45g', 'ABCpure', '45g']) {
    assert.ok(!new RegExp('^[0-9]+$').test(code), `${code} should not be treated as a barcode`)
  }
  assert.ok(new RegExp('^[0-9]+$').test('773602685608'), 'a real barcode must still take the barcode path')
  assert.ok(gate.source.length > 0)
})

check('the planner never applies anything itself', () => {
  assert.ok(!/--apply/.test(source), 'planner advertises an --apply flag')
  assert.ok(!/d1\(\s*['"`](INSERT|UPDATE|DELETE)/i.test(source), 'planner sends a write through d1()')
})

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
