#!/usr/bin/env node
/*
 * September 2-3, 2026 old-system reconciliation planner (invoices 004420-004456).
 *
 * Fourth in the dated series after import-aug30/aug31/sep01-legacy-reports.mjs
 * and it keeps their contract: the default run is READ-ONLY.  It emits a
 * reconciliation report and refuses to emit SQL while any product barcode,
 * customer identity or supplier name is ambiguous.  Nothing here applies
 * anything to D1; `--sql` prints statements for a human to review and run.
 *
 * Identity policy (matches legacy-preflight.mjs and productDetailRule.ts): a
 * unique ACTIVE barcode is the first signal; a name is a fallback only when it
 * has exactly one exact active match.  This tool never creates, merges or
 * edits a product, and never edits a product cost -- so a report line whose
 * barcode resolves to a duplicate pair is quarantined, not guessed.
 *
 * STOCK IS DELIBERATELY UNTOUCHED.  The user's instruction for this batch was
 * "don't affect stock quantity, no deduction".  Consequently this planner
 * writes nothing to products.stock_quantity, branch_stock, branch_batch_stock,
 * inventory_movements, product_batches, sale_item_batch_allocations or
 * legacy_inventory_effects.  Sales rows are inserted directly rather than
 * through routes/sales.ts or lib/importEngine.ts precisely because those two
 * paths DO move stock for a stock-deducted status (see
 * cloudflare/src/lib/salesStatus.ts::STOCK_DEDUCTED_STATUSES, which contains
 * 'completed').  A direct INSERT carries the status without the movement.
 *
 * The four source exports are HTML documents with an .xls extension (the old
 * system's "Excel" export).  They are parsed as HTML tables on purpose; do not
 * swap in XLSX.readFile without re-checking, and note the archive already
 * holds an unrelated near-empty `report-invoice-detail.xls`, which is why this
 * batch is archived under explicit -sep02-04 names.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  barcodeKey,
  canonicalLegacyPhone,
  normalizeLegacyText as norm,
  resolveLegacyCashier,
} from './legacy-preflight.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const cloudflare = path.join(repo, 'cloudflare')
const legacyRoot = path.join(repo, 'Migration from old system')

const args = new Set(process.argv.slice(2))
const wantSql = args.has('--sql')

// ---------------------------------------------------------------- decisions
// Every entry below is a REVIEW DECISION, not a matching rule.  An empty table
// means "still unresolved" and the planner blocks on it.  Do not add an entry
// to silence a report line; add one only after a human has confirmed the pair.

// Six barcodes resolve to two live products each -- the Sep-2 reconciliation's
// twin-product defect (progress.md: ~3,900 twin groups).  Three pairs differ
// only by a leading zero on the stored barcode (1024/6796, 2585/7878 and the
// name-drifted 5158/9631), three are same-barcode cost splits both minted at
// 2026-09-02T15:30 (9092/9093, 7231/7232).
//
// USER RULING (Sep 4 2026): point the imported line at the OLDEST row -- the
// product that existed before the reconciliation -- so the sale lands on the
// established record and nothing new is created.  Each id below was read from
// live D1, not inferred; if one stops matching its barcode the planner blocks
// rather than falling back to a guess.
export const AMBIGUOUS_BARCODE_RULINGS = Object.freeze({
  '079625042856': 5158,  // vs 9631  RT Brush Mini Kit 10 / Real Techniques Brush Mini Kit 10
  '041554502015': 4209,  // vs 9075  Maybelline Loose Powder 10
  '693667330100': 2585,  // vs 7878  Girlactik Matte Liquid Blushing
  '041554554502': 9092,  // vs 9093  Maybelline Matte Liquid Lipstick New 130
  '5060696176040': 1024, // vs 6796  Charlotte Tilbury Hollywood Flawless Foundation 1 Fair
  '3348901770569': 7231, // vs 7232  Dior Backstage Highlighter New 002
})

// USER RULING (Sep 4 2026): a customer that does not resolve to exactly one
// live record is NOT created and the invoice is NOT skipped.  The sale keeps
// the reported name and phone and links to no customer row, so the receipt and
// the reports still read correctly while the duplicate risk stays at zero.
// 'leap leap' matches three live records (19747, 24859, 24935); the user's
// instruction was that it "can be in conflict", i.e. left unlinked like the
// rest rather than arbitrarily bound to one of the three.
const UNRESOLVED_CUSTOMER_POLICY = 'keep_reported_name_unlinked'

// USER RULING (Sep 4 2026): "status all paid" covers the fifteen invoices that
// are already in production as awaiting_payment, so they are flipped too.
const FLIP_EXISTING_TO_PAID = true

// Two already-live invoices are short a line each because the Sep-2
// reconciliation extracted digits from a SKU-style code and then matched
// nothing: 004430 is missing "YSL Libre 10ml" ($25, live 54 vs report 79) and
// 004434 is missing "Clinical Completely Clean 45g" x2 ($26, live 105 vs
// report 131).  They are excluded from the paid flip until the user rules on
// restoring the lines -- marking a short invoice settled hides the defect.
const SHORT_LIVE_INVOICES = Object.freeze(['004430', '004434'])

// The source reports carry no cashier column.  The fifteen Sep-2 invoices
// already in production (004420-004434) were all imported as 'Za', so that is
// the only value consistent with the rest of the batch.  Overridden with
// --cashier=<name>.
const DEFAULT_CASHIER = 'Za'
const cashierArg = [...args].find((a) => a.startsWith('--cashier='))
const CASHIER = cashierArg ? cashierArg.slice('--cashier='.length) : DEFAULT_CASHIER

// The user's instruction for this batch: "make it status all paid".
const TARGET_STATUS = 'completed'

const files = {
  invoice: path.join(legacyRoot, 'report-invoice-detail-sep02-04.xls'),
  receivable: path.join(legacyRoot, 'account-receivable-report-sep02-04.xls'),
  payable: path.join(legacyRoot, 'account-payable-report-supplier-sep02-04.xls'),
  item: path.join(legacyRoot, 'report-item-new-sep02-04.xls'),
}
for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label} report: ${file}`)
}

// ------------------------------------------------------------------ parsing
const decode = (html) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .split('').join('').replace(/\s+/g, ' ').trim()

function tableRows(file) {
  const html = fs.readFileSync(file, 'utf8')
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => decode(td[1])))
}

const number = (value) => {
  const n = Number(String(value ?? '').replaceAll(',', '').trim())
  return Number.isFinite(n) ? n : 0
}
const money = (value) => Number(number(value).toFixed(6))
const sqlText = (value) => (value == null || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`)
const sqlNum = (value) => (Number.isFinite(Number(value)) ? String(Number(value)) : '0')

/** The old system prints Indochina local time; sales.created_at is UTC. */
function ictToUtc(value) {
  const raw = String(value ?? '').trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) throw new Error(`Unsupported legacy time: ${raw}`)
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] || 0))).toISOString()
}
/** Receipt id shape ruled by the user in Part 540: bare YYYYMMDD-HHMMSS. */
const receiptFor = (ictStamp) =>
  `${ictStamp.slice(0, 10).replaceAll('-', '')}-${ictStamp.slice(11).replaceAll(':', '')}`

/** Group the invoice-detail export: a row carrying an Invoice No opens a sale. */
function readInvoices() {
  const rows = tableRows(files.invoice)
  const header = rows[0]
  const invoices = []
  let current = null
  for (const row of rows.slice(1, -1)) {
    const record = {}
    header.forEach((name, i) => { record[name] = row[i] ?? '' })
    if (record['Invoice No']) { current = { head: record, lines: [] }; invoices.push(current) }
    if (current) current.lines.push(record)
  }
  return invoices
}

// --------------------------------------------------------------- live reads
function d1(command) {
  const result = spawnSync(process.execPath,
    ['scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os', '--remote', '--json', '--command', command],
    { cwd: cloudflare, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'D1 query failed')
  const text = result.stdout
  return JSON.parse(text.slice(text.indexOf('['))).flatMap((entry) => entry.results || [])
}

const products = d1('SELECT id,name,barcode,sku,is_active FROM products')
const customers = d1('SELECT id,name,phone,phone_normalized FROM customers')
const suppliers = d1('SELECT id,name FROM suppliers')
const users = d1('SELECT id,username,name FROM users')
const liveSales = d1(`SELECT id,receipt_number,created_at,customer_name,total_usd,amount_paid_usd,
  COALESCE(sale_status,'') AS sale_status FROM sales
  WHERE created_at >= '2026-09-01' AND created_at < '2026-09-05'`)
const liveReceivables = d1(`SELECT legacy_id,invoice_no,source_file FROM customer_receivables
  WHERE invoice_date >= '2026-09-02'`)
const livePayables = d1(`SELECT source_branch, MAX(legacy_id) AS max_legacy_id, COUNT(*) AS n
  FROM supplier_invoices GROUP BY source_branch`)

// ------------------------------------------------------------- index builds
const activeByBarcode = new Map()
const anyByBarcode = new Map()
const activeByName = new Map()
const activeBySku = new Map()
for (const product of products) {
  const key = barcodeKey(product.barcode)
  if (key && key !== '0') {
    ;(anyByBarcode.get(key) || anyByBarcode.set(key, []).get(key)).push(product)
    if (product.is_active === 1) (activeByBarcode.get(key) || activeByBarcode.set(key, []).get(key)).push(product)
  }
  if (product.is_active === 1) {
    const name = norm(product.name)
    if (name) (activeByName.get(name) || activeByName.set(name, []).get(name)).push(product)
    const sku = norm(product.sku)
    if (sku) (activeBySku.get(sku) || activeBySku.set(sku, []).get(sku)).push(product)
  }
}
const customersByPhone = new Map()
const customersByName = new Map()
for (const customer of customers) {
  const key = canonicalLegacyPhone(customer.phone_normalized || customer.phone)
  if (key) (customersByPhone.get(key) || customersByPhone.set(key, []).get(key)).push(customer)
  const name = norm(customer.name)
  if (name) (customersByName.get(name) || customersByName.set(name, []).get(name)).push(customer)
}
const suppliersByName = new Map()
for (const supplier of suppliers) {
  const name = norm(supplier.name)
  if (name) (suppliersByName.get(name) || suppliersByName.set(name, []).get(name)).push(supplier)
}
const liveByReceipt = new Map(liveSales.map((sale) => [String(sale.receipt_number), sale]))

// ------------------------------------------------------------- resolutions
/**
 * A source code is only a BARCODE when it is entirely digits.
 *
 * legacy-preflight.mjs's barcodeKey() strips non-digits, which silently turns
 * a SKU-style code into a short numeric key: "Libre10ml" -> "10" and
 * "CompletelyClean45g" -> "45".  That is not a near-miss: 44 live products
 * carry the literal barcode "10" (the placeholder used for 10ml perfumes),
 * three of them active, so feeding "10" into the barcode index would book a
 * YSL Libre line against an unrelated perfume and look correct forever.  A
 * dropped line is visibly short and recoverable; a mis-booked one is not.
 *
 * Caught by peer session business-os-v1-4a during the pre-write review.
 */
const isNumericCode = (code) => /^[0-9]+$/.test(String(code ?? '').trim())

/** Barcode first, then SKU, then an exact single active name. Never guesses. */
function resolveProduct(code, name) {
  const key = isNumericCode(code) ? barcodeKey(code) : ''
  if (key && key !== '0') {
    const ruled = AMBIGUOUS_BARCODE_RULINGS[String(code).trim()]
    const active = activeByBarcode.get(key) || []
    if (ruled) {
      const chosen = active.find((p) => Number(p.id) === Number(ruled))
      if (!chosen) return { status: 'ruling_no_longer_matches', product: null, candidates: active }
      return { status: 'resolved_by_ruling', product: chosen }
    }
    if (active.length === 1) return { status: 'resolved_barcode', product: active[0] }
    if (active.length > 1) return { status: 'quarantined_duplicate_barcode', product: null, candidates: active }
    const any = anyByBarcode.get(key) || []
    if (any.length) return { status: 'inactive_barcode_only', product: null, candidates: any }
  }
  const bySku = activeBySku.get(norm(code)) || []
  if (bySku.length === 1) return { status: 'resolved_sku', product: bySku[0] }
  const byName = activeByName.get(norm(name)) || []
  if (byName.length === 1) return { status: 'resolved_name', product: byName[0] }
  if (byName.length > 1) return { status: 'quarantined_duplicate_name', product: null, candidates: byName }
  return { status: 'unmatched', product: null, candidates: [] }
}

/** Phone is the strong signal; an exact single name match is the fallback. */
function resolveCustomer(name, phone) {
  const clean = String(name ?? '').trim()
  if (!clean && !String(phone ?? '').trim()) return { status: 'walk_in', customer: null }
  const key = canonicalLegacyPhone(phone)
  const byPhone = key ? (customersByPhone.get(key) || []) : []
  if (byPhone.length === 1) return { status: 'resolved_phone', customer: byPhone[0] }
  if (byPhone.length > 1) return { status: 'quarantined_duplicate_phone', customer: null, candidates: byPhone }
  const byName = customersByName.get(norm(clean)) || []
  if (byName.length === 1) return { status: key ? 'resolved_name_phone_absent' : 'resolved_name', customer: byName[0] }
  if (byName.length > 1) return { status: 'quarantined_duplicate_name', customer: null, candidates: byName }
  return { status: 'unmatched', customer: null, candidates: [] }
}

// ------------------------------------------------------------------- report
const invoices = readInvoices()
const cashier = resolveLegacyCashier(CASHIER, users)

const plan = []
for (const invoice of invoices) {
  const stamp = String(invoice.head['Date']).trim()
  const receipt = receiptFor(stamp)
  const existing = liveByReceipt.get(receipt) || null
  const customer = resolveCustomer(invoice.head['Customer'], invoice.head['Phone'])
  const lines = invoice.lines
    .filter((line) => String(line['Product'] || '').trim())
    .map((line) => {
      const isDelivery = !String(line['Code'] || '').trim() && norm(line['Product']) === 'delivery service'
      return {
        code: String(line['Code'] || '').trim(),
        name: String(line['Product'] || '').trim(),
        quantity: number(line['Qty']),
        unitPrice: money(line['Price']),
        discount: money(line['Discount']),
        total: money(line['Total']),
        cost: money(line['Cost']),
        isDelivery,
        resolution: isDelivery ? { status: 'delivery_line', product: null } : resolveProduct(line['Code'], line['Product']),
      }
    })
  plan.push({
    invoiceNo: String(invoice.head['Invoice No']).trim(),
    stampIct: stamp,
    createdAtUtc: ictToUtc(stamp),
    receipt,
    existing,
    customerName: String(invoice.head['Customer'] || '').trim(),
    customerPhone: String(invoice.head['Phone'] || '').trim(),
    customer,
    paymentMethod: String(invoice.head['Payment method'] || '').trim(),
    deliveryService: String(invoice.head['Delivery Service'] || '').trim(),
    grandTotal: money(invoice.head['Grand Total']),
    lines,
  })
}

const missing = plan.filter((sale) => !sale.existing)
const present = plan.filter((sale) => sale.existing)
const blockedLines = missing.flatMap((sale) => sale.lines
  .filter((line) => !line.isDelivery && !line.resolution.product)
  .map((line) => ({ sale, line })))
const RESOLVED_CUSTOMER_STATUSES = ['resolved_phone', 'resolved_name', 'resolved_name_phone_absent', 'walk_in']
// Under the ruling above an unresolved customer is carried, not blocked: the
// sale keeps its reported name/phone and links to nothing.
const unlinkedCustomers = missing.filter((sale) => !RESOLVED_CUSTOMER_STATUSES.includes(sale.customer.status))
const blockedCustomers = UNRESOLVED_CUSTOMER_POLICY === 'keep_reported_name_unlinked' ? [] : unlinkedCustomers

console.log('=== September 2-3 2026 legacy report reconciliation (read-only) ===')
console.log(`source invoices          : ${plan.length} (${plan[plan.length - 1]?.invoiceNo} .. ${plan[0]?.invoiceNo})`)
console.log(`already in production    : ${present.length}`)
console.log(`to insert                : ${missing.length}`)
console.log(`cashier                  : ${CASHIER} -> ${cashier.status}${cashier.user ? ` (user id ${cashier.user.id})` : ''}`)
console.log(`target sale_status       : ${TARGET_STATUS} (amount_paid set to total; stock untouched)`)
console.log('')

console.log('--- sales already present (status shown is what production holds now) ---')
for (const sale of present) {
  const totalsAgree = Math.abs(Number(sale.existing.total_usd) - sale.grandTotal) < 0.005
  console.log([sale.invoiceNo, sale.receipt, sale.customerName || '(walk-in)',
    `report=${sale.grandTotal}`, `live=${sale.existing.total_usd}`,
    totalsAgree ? 'totals-agree' : 'TOTAL MISMATCH',
    sale.existing.sale_status].join(' | '))
}
console.log('')

console.log('--- sales to insert ---')
for (const sale of missing) {
  console.log([sale.invoiceNo, sale.receipt, sale.customerName || '(walk-in)',
    `total=${sale.grandTotal}`, sale.paymentMethod,
    `customer:${sale.customer.status}${sale.customer.customer ? `#${sale.customer.customer.id}` : ''}`,
    `${sale.lines.length} lines`].join(' | '))
}
console.log('')

if (blockedLines.length) {
  console.log('--- BLOCKING: product lines that do not resolve to exactly one active product ---')
  for (const { sale, line } of blockedLines) {
    const ids = (line.resolution.candidates || []).map((c) => `${c.id}:${c.name}`).join(' | ')
    console.log(`${sale.invoiceNo} | ${line.code || '(no code)'} | ${line.name} | ${line.resolution.status}${ids ? ` -> ${ids}` : ''}`)
  }
  console.log('')
}
if (unlinkedCustomers.length) {
  const heading = blockedCustomers.length
    ? '--- BLOCKING: customers that do not resolve ---'
    : '--- carried unlinked (name + phone kept on the sale, customer_id NULL, nothing created) ---'
  console.log(heading)
  for (const sale of unlinkedCustomers) {
    const ids = (sale.customer.candidates || []).map((c) => `${c.id}:${c.name}`).join(' | ')
    console.log(`${sale.invoiceNo} | ${sale.customerName} | ${sale.customerPhone || '(no phone)'} | ${sale.customer.status}${ids ? ` -> ${ids}` : ''}`)
  }
  console.log('')
}

// A sale whose line totals do not add up to its printed grand total would
// import a wrong number silently, so prove the arithmetic per invoice rather
// than trusting the report's own footer.
const totalMismatches = missing.filter((sale) => {
  const lineSum = Number(sale.lines.reduce((sum, line) => sum + line.total, 0).toFixed(2))
  return Math.abs(lineSum - sale.grandTotal) >= 0.005
})
console.log('--- totals integrity (sum of line totals vs printed grand total) ---')
if (!totalMismatches.length) {
  console.log(`all ${missing.length} invoices to insert reconcile exactly`)
} else {
  for (const sale of totalMismatches) {
    const lineSum = Number(sale.lines.reduce((sum, line) => sum + line.total, 0).toFixed(2))
    console.log(`${sale.invoiceNo} | lines=${lineSum} | grand total=${sale.grandTotal} | diff=${(lineSum - sale.grandTotal).toFixed(2)}`)
  }
}
console.log('')

// ------------------------------------------------------- supplier payables
const payableRows = tableRows(files.payable).slice(5, -1).filter((row) => row.length > 5)
const shopMaxLegacyId = Number(livePayables.find((row) => row.source_branch === 'shop')?.max_legacy_id || 0)
const payables = payableRows.map((row, index) => {
  const name = row[2].trim()
  const matches = suppliersByName.get(norm(name)) || []
  return {
    sourceRow: index + 1,
    legacyId: shopMaxLegacyId + index + 1,
    supplierCode: row[1].trim(),
    supplierName: name,
    supplier: matches.length === 1 ? matches[0] : null,
    supplierStatus: matches.length === 1 ? 'resolved' : (matches.length ? 'ambiguous' : 'unmatched'),
    invoiceDate: ictToUtc(row[4].trim().replace(/^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})$/, '$1 $2')),
    dueDate: ictToUtc(row[5].trim().replace(/^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})$/, '$1 $2')),
    termDays: number(row[6]),
    taxable: money(row[7]),
    vat: money(row[8]),
    total: money(row[9]),
    paid: money(row[10]),
    outstanding: money(row[11]),
    status: row[12].trim(),
  }
})
console.log('--- supplier payables (AP) ---')
console.log(`existing shop legacy_id high-water mark: ${shopMaxLegacyId} (new rows continue from ${shopMaxLegacyId + 1})`)
for (const row of payables) {
  console.log([row.legacyId, row.supplierCode, row.supplierName,
    row.supplier ? `-> supplier_id ${row.supplier.id}` : `!! ${row.supplierStatus}`,
    `total=${row.total}`, `paid=${row.paid}`, row.status].join(' | '))
}
const blockedSuppliers = payables.filter((row) => !row.supplier)
console.log('')

// ------------------------------------------------------ customer receivables
// The AR ledger stops at the same invoice the sales did (004434), so it
// carries the identical 22-invoice gap.  Rows are emitted as settled: the
// user's ruling for this batch is that every one of these invoices is paid.
const receivableRows = tableRows(files.receivable).slice(5, -1).filter((row) => row.length > 5)
const missingInvoiceNumbers = new Set(missing.map((sale) => sale.invoiceNo))
const receivables = receivableRows
  .map((row, index) => ({ row, sourceRow: index + 1 }))
  .filter(({ row }) => missingInvoiceNumbers.has(row[3]))
  .map(({ row, sourceRow }) => {
    const sale = missing.find((entry) => entry.invoiceNo === row[3])
    return {
      legacyId: Number(row[0]),
      sourceRow,
      customerCode: row[1].trim(),
      customerName: row[2].trim(),
      invoiceNo: row[3].trim(),
      invoiceDate: sale.createdAtUtc,
      customerId: sale.customer.customer ? sale.customer.customer.id : null,
      taxable: money(row[5]),
      vat: money(row[6]),
      total: money(row[7]),
    }
  })
console.log('--- customer receivables (AR) to add ---')
console.log(`${receivables.length} of ${missing.length} inserted sales have an AR row in the export`)
const receivableGap = missing.filter((sale) => !receivables.some((r) => r.invoiceNo === sale.invoiceNo))
if (receivableGap.length) console.log(`no AR row in export for: ${receivableGap.map((s) => s.invoiceNo).join(', ')}`)
console.log('')

// ------------------------------------------------------------------- verdict
const blockers = []
if (blockedLines.length) blockers.push(`${blockedLines.length} unresolved product line(s)`)
if (blockedCustomers.length) blockers.push(`${blockedCustomers.length} unresolved customer(s)`)
if (blockedSuppliers.length) blockers.push(`${blockedSuppliers.length} unresolved supplier(s)`)
if (cashier.status !== 'resolved') blockers.push(`cashier "${CASHIER}" is ${cashier.status}`)
if (totalMismatches.length) blockers.push(`${totalMismatches.length} invoice(s) whose lines do not sum to the printed total`)

if (blockers.length) {
  console.log(`VERDICT: BLOCKED -- ${blockers.join('; ')}.`)
  console.log('No SQL is emitted while anything above is unresolved. Record a ruling in')
  console.log('AMBIGUOUS_BARCODE_RULINGS (or resolve the row upstream) and re-run.')
  if (wantSql) process.exitCode = 1
} else {
  console.log('VERDICT: CLEAN -- every product, customer and supplier resolves to exactly one live row.')
  if (!wantSql) console.log('Re-run with --sql to print the review SQL (still applies nothing).')
}

// ----------------------------------------------------------------- SQL out
if (wantSql && !blockers.length) {
  const out = []
  out.push('-- Sep 2-3 2026 legacy import. Review before running. Applies NO stock movement.')
  // No BEGIN/COMMIT: D1 rejects explicit SQL transactions and already runs a
  // --file batch atomically, so an explicit one is both refused and redundant.
  for (const sale of missing) {
    const itemsJson = JSON.stringify(sale.lines.map((line) => ({
      product_id: line.resolution.product ? line.resolution.product.id : null,
      product_name: line.resolution.product ? line.resolution.product.name : line.name,
      quantity: line.quantity,
      applied_price_usd: line.unitPrice,
      total_usd: line.total,
    })))
    // subtotal_usd is NOT optional. Canonical revenue is
    // subtotal_usd - discount_usd - membership_discount_usd (salesAnalytics.ts,
    // netSaleExpr) -- total_usd is never read for revenue. The first run of this
    // script omitted subtotal_usd, so 22 imported sales defaulted it to 0 and
    // $3,462 of real trade was invisible to every revenue, profit and dashboard
    // figure while the Sales list showed it correctly from total_usd. Every money
    // column is now listed explicitly, including the two that are legitimately 0
    // here, so the next report shape cannot reintroduce the same silence.
    out.push(`INSERT INTO sales (receipt_number, cashier_name, cashier_id, customer_id, customer_name, customer_phone,
  payment_method, sale_status, subtotal_usd, discount_usd, membership_discount_usd, tax_usd, total_usd, amount_paid_usd,
  loyalty_accrual, is_delivery, items, notes, created_at, updated_at)
VALUES (${sqlText(sale.receipt)}, ${sqlText(CASHIER)}, ${sqlNum(cashier.user.id)}, ${sale.customer.customer ? sqlNum(sale.customer.customer.id) : 'NULL'},
  ${sqlText(sale.customerName)}, ${sqlText(sale.customerPhone)}, ${sqlText(sale.paymentMethod)}, ${sqlText(TARGET_STATUS)},
  ${sqlNum(sale.grandTotal)}, 0, 0, 0, ${sqlNum(sale.grandTotal)}, ${sqlNum(sale.grandTotal)}, 0, ${sale.deliveryService && sale.deliveryService !== 'Walk-In' ? '1' : '0'},
  ${sqlText(itemsJson)}, ${sqlText(`Legacy import ${sale.invoiceNo} (Sep 2-3 batch); stock intentionally unaffected`)},
  ${sqlText(sale.createdAtUtc)}, ${sqlText(sale.createdAtUtc)});`)
    for (const line of sale.lines) {
      out.push(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, total_usd, product_discount_usd)
VALUES ((SELECT id FROM sales WHERE receipt_number = ${sqlText(sale.receipt)}), ${line.resolution.product ? sqlNum(line.resolution.product.id) : 'NULL'},
  ${sqlText(line.resolution.product ? line.resolution.product.name : line.name)}, ${sqlNum(line.quantity)},
  ${sqlNum(line.unitPrice)}, ${sqlNum(line.cost)}, ${sqlNum(line.total)}, ${sqlNum(line.discount)});`)
    }
  }
  if (FLIP_EXISTING_TO_PAID) {
    const toFlip = present.filter((sale) => (sale.existing.sale_status !== TARGET_STATUS
      || Math.abs(Number(sale.existing.amount_paid_usd) - Number(sale.existing.total_usd)) >= 0.005)
      // Held back deliberately: these two live rows are SHORT a line each
      // (the reconciliation's digit-extraction drop), so their live total is
      // not the invoice's real total. Marking a short invoice paid turns a
      // visible exception into a closed record -- raised by peer session
      // business-os-v1-ba. They flip only once the lines are restored.
      && !SHORT_LIVE_INVOICES.includes(sale.invoiceNo))
    for (const invoiceNo of SHORT_LIVE_INVOICES) {
      const sale = present.find((entry) => entry.invoiceNo === invoiceNo)
      if (sale) out.push(`-- HELD: ${invoiceNo} (${sale.receipt}) not flipped -- live total ${sale.existing.total_usd} vs report ${sale.grandTotal}, missing a line.`)
    }
    out.push(`-- Flip the ${toFlip.length} already-imported invoices to paid. Matched on the exact`)
    out.push('-- receipt id, and total_usd is left alone: amount_paid follows what the row')
    out.push('-- already holds, so the two TOTAL MISMATCH rows are not silently rewritten.')
    for (const sale of toFlip) {
      out.push(`UPDATE sales SET sale_status = ${sqlText(TARGET_STATUS)}, amount_paid_usd = total_usd,
  updated_at = CURRENT_TIMESTAMP WHERE receipt_number = ${sqlText(sale.receipt)};`)
    }
  }
  for (const row of payables) {
    out.push(`INSERT INTO supplier_invoices (source_branch, legacy_id, supplier_id, supplier_code, supplier_name, invoice_no,
  invoice_date, due_date, term_days, taxable_amount_usd, vat_amount_usd, total_amount_usd, amount_paid_usd,
  outstanding_balance_usd, status, source_file, source_row)
VALUES ('shop', ${sqlNum(row.legacyId)}, ${sqlNum(row.supplier.id)}, ${sqlText(row.supplierCode)}, ${sqlText(row.supplierName)}, NULL,
  ${sqlText(row.invoiceDate)}, ${sqlText(row.dueDate)}, ${sqlNum(row.termDays)}, ${sqlNum(row.taxable)}, ${sqlNum(row.vat)},
  ${sqlNum(row.total)}, ${sqlNum(row.paid)}, ${sqlNum(row.outstanding)}, ${sqlText(row.status)},
  ${sqlText('account-payable-report-supplier-sep02-04.xls')}, ${sqlNum(row.sourceRow)});`)
  }
  for (const row of receivables) {
    out.push(`INSERT INTO customer_receivables (legacy_id, customer_id, customer_code, customer_name, invoice_no,
  invoice_date, taxable_amount_usd, vat_amount_usd, total_amount_usd, amount_paid_usd, outstanding_balance_usd,
  status, source_file, source_row)
VALUES (${sqlNum(row.legacyId)}, ${row.customerId ? sqlNum(row.customerId) : 'NULL'}, ${sqlText(row.customerCode)},
  ${sqlText(row.customerName)}, ${sqlText(row.invoiceNo)}, ${sqlText(row.invoiceDate)}, ${sqlNum(row.taxable)},
  ${sqlNum(row.vat)}, ${sqlNum(row.total)}, ${sqlNum(row.total)}, 0, 'Paid',
  ${sqlText('account-receivable-report-sep02-04.xls')}, ${sqlNum(row.sourceRow)});`)
  }
  console.log('')
  console.log(out.join('\n'))
}
