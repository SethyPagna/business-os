#!/usr/bin/env node
/*
 * Incremental Aug-31 2026 legacy import + all-time customer AR ledger.
 *
 * Rolls the Aug-27→30 reconciliation (import-aug30-legacy-reports.mjs, already
 * applied, receipts <= 4376) forward by one day and captures the customer
 * accounts-receivable report that the earlier passes had no home for.
 *
 * Default: read-only audit + SQL generation (writes local .sql files only).
 *   node ops/scripts/migration/import-aug31-legacy-reports.mjs
 * Apply (only after migration 0094 is applied, and after human review):
 *   node ops/scripts/migration/import-aug31-legacy-reports.mjs --apply
 *
 * What it does, and the guarantees:
 *  - Books the 14 genuinely-new Aug-31 sales (invoices 4377-4390) exactly the
 *    way the Aug-30 pass booked 4351-4376: branch 2 (shop), amount_paid = grand
 *    total, credit kept in notes, one signed legacy_inventory_effects row per
 *    unit so stock + movements move once and only once (INSERT OR IGNORE on the
 *    source_key is the idempotency guard). Verified pre-flight: 0 sales exist on
 *    2026-08-31 in the DB, so there is no double-count risk.
 *  - Books the 2 new Aug-31 expenses (delivery fees, 17,200 KHR) into `fees`
 *    with an exact natural-key guard, matching the Aug-30 pass.
 *  - Loads the ENTIRE customer AR report (13,243 invoices) into the
 *    customer_receivables ledger. AR rows never rewrite sale.amount_paid and
 *    never move stock; they are a faithful record of outstanding balances.
 *
 * Every source total is asserted before any SQL is emitted; a mismatch aborts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveArchivedReport } from './legacy-preflight.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const cloudflare = path.join(repo, 'cloudflare')
const downloads = path.resolve(repo, '..')
const legacyRoot = path.join(repo, 'Migration from old system')
const pack = fs.existsSync(path.join(legacyRoot, 'businessos-migration-aug28'))
  ? path.join(legacyRoot, 'businessos-migration-aug28')
  : path.join(downloads, 'businessos-migration-aug28')
const require = createRequire(import.meta.url)
const XLSX = require(path.join(repo, 'frontend/node_modules/xlsx'))

// Prefer the preserved in-repository archive. Loose Downloads copies are only
// a compatibility fallback for older worktrees that predate that archive.
const reportFile = (name) => {
  if (fs.existsSync(legacyRoot)) return resolveArchivedReport(legacyRoot, name)
  const loose = path.join(downloads, name)
  return fs.existsSync(loose) ? loose : path.join(downloads, '27th-30th', name)
}
const files = {
  invoice: reportFile('report-invoice-detail-31st.xls'),
  expense: reportFile('report-expense-income-31st.xls'),
  stockReport: reportFile('stock-report-31st.xlsx'),
  receivable: reportFile('account-receivable-report all time.xls'),
  mapping: path.join(pack, 'reference/product_mapping.csv'),
  mappingReview: path.join(pack, 'reference/product_mapping_review_VERIFIED.csv'),
}
for (const [label, filename] of Object.entries(files)) {
  if (!fs.existsSync(filename)) throw new Error(`Missing ${label}: ${filename}`)
}

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const num = (value) => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}
const sql = (value) => value == null || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const sqlNum = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : '0'
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const round = (value, places = 8) => Number(Number(value).toFixed(places))

function workbookRows(filename, sheet = 0, objects = false) {
  const workbook = XLSX.readFile(filename, { raw: false, cellDates: false })
  const worksheet = workbook.Sheets[workbook.SheetNames[sheet]]
  return XLSX.utils.sheet_to_json(worksheet, objects
    ? { defval: '', raw: false }
    : { header: 1, defval: '', raw: false })
}

function parseLegacyDate(value, withTime = true) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]?)(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}${withTime ? ` ${match[4]}:${match[5]}:${match[6] || '00'}` : ''}`
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    const date = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
    return withTime && match[4] ? `${date} ${match[4].padStart(2, '0')}:${match[5]}:00` : date
  }
  throw new Error(`Unrecognized legacy date: ${raw}`)
}

// Legacy reports carry Bangkok wall-clock time; Business OS stores UTC instants.
function bangkokToUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`Unrecognized Bangkok timestamp: ${value}`)
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 7, Number(match[5]), Number(match[6]))
  return new Date(utc).toISOString()
}

function d1Query(command) {
  const result = spawnSync(process.execPath, [
    'scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os',
    '--remote', '--json', '--command', command,
  ], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 160 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'D1 query failed')
  return JSON.parse(result.stdout)
}
function d1File(filename) {
  const result = spawnSync(process.execPath, [
    'scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os',
    '--remote', '--file', filename,
  ], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 160 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `D1 file failed: ${filename}`)
  process.stdout.write(result.stdout)
}
const queryRows = (command) => d1Query(command).flatMap((result) => result.results || [])

// ---- Live state (read-only) -------------------------------------------------
const productRows = queryRows(`
  SELECT p.id, p.name, p.sku, p.barcode,
    (SELECT pb.id FROM product_batches pb
     WHERE pb.variant_product_id=p.id AND pb.is_active=1
       AND pb.notes='Received via product import'
     ORDER BY pb.id LIMIT 1) AS opening_batch_id
  FROM products p WHERE p.is_active=1 ORDER BY p.id
`)
const customers = queryRows('SELECT id,name,phone FROM customers ORDER BY id')
const deliveryContacts = queryRows('SELECT id,name FROM delivery_contacts ORDER BY id')
const existing0831Rows = queryRows(
  "SELECT receipt_number,cashier_id,cashier_name,created_at,total_usd,client_request_id FROM sales WHERE client_request_id LIKE 'legacy-sale:43__@2026-08-31'"
)
const existing0831 = new Map(existing0831Rows.map((row) => [String(row.receipt_number), row]))
const arTableExists = Number(queryRows(
  "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='customer_receivables'"
)[0]?.c || 0) > 0

const productsByBarcode = new Map()
for (const row of productRows.filter((candidate) => candidate.barcode)) {
  const key = String(row.barcode)
  if (!productsByBarcode.has(key)) productsByBarcode.set(key, [])
  productsByBarcode.get(key).push(row)
}
const productsByName = new Map()
for (const row of productRows) {
  const key = norm(row.name)
  if (!productsByName.has(key)) productsByName.set(key, [])
  productsByName.get(key).push(row)
}

// ---- Product mapping (shared with the Aug-30 pass) --------------------------
const mappingByOldName = new Map()
const mappingByOldBarcode = new Map()
function loadMapping(filename, nameKey, barcodeKey, targetKeys) {
  for (const row of workbookRows(filename, 0, true)) {
    const targetName = targetKeys.map((key) => row[key]).find(Boolean)
    const mapped = { oldName: row[nameKey], oldBarcode: String(row[barcodeKey] || ''), targetName, targetBarcode: String(row.template_barcode || '') }
    const key = norm(row[nameKey])
    if (!mappingByOldName.has(key)) mappingByOldName.set(key, [])
    mappingByOldName.get(key).push(mapped)
    if (mapped.oldBarcode) mappingByOldBarcode.set(mapped.oldBarcode, mapped)
  }
}
loadMapping(files.mapping, 'old_name', 'old_barcode', ['template_name'])
loadMapping(files.mappingReview, 'old_name', 'old_barcode', ['merge_into_template_product', 'verified_official_name'])

const stockRowsByName = new Map()
for (const row of workbookRows(files.stockReport, 0, true)) {
  const key = norm(row['Item Name'])
  if (!stockRowsByName.has(key)) stockRowsByName.set(key, [])
  stockRowsByName.get(key).push(row)
}

function resolveProduct(sourceName, sourceCode = '', { preferSold = false } = {}) {
  if (norm(sourceName) === 'delivery service') return null
  const code = String(sourceCode || '').trim()
  const exactMapping = /^\d{8,}$/.test(code) ? mappingByOldBarcode.get(code) : null
  let candidates = exactMapping ? [exactMapping] : (mappingByOldName.get(norm(sourceName)) || [])
  if (candidates.length > 1 && preferSold) {
    const reportIdentity = (stockRowsByName.get(norm(sourceName)) || []).find((row) => num(row.Sold) > 0)
    const byIdentity = reportIdentity ? mappingByOldBarcode.get(String(reportIdentity.Code || '')) : null
    if (byIdentity) candidates = [byIdentity]
  }
  for (const candidate of candidates) {
    if (candidate.targetBarcode && productsByBarcode.has(candidate.targetBarcode)) {
      const barcodeProducts = productsByBarcode.get(candidate.targetBarcode)
      const nameAndBarcode = barcodeProducts.find((row) => norm(row.name) === norm(candidate.targetName))
      if (nameAndBarcode) return nameAndBarcode
      if (barcodeProducts.length === 1) return barcodeProducts[0]
    }
    const named = productsByName.get(norm(candidate.targetName)) || []
    if (named.length === 1) return named[0]
    if (named.length > 1 && candidate.targetBarcode) {
      const barcodeMatch = named.find((row) => String(row.barcode || '') === candidate.targetBarcode)
      if (barcodeMatch) return barcodeMatch
    }
  }
  const direct = productsByName.get(norm(sourceName)) || []
  return direct.length === 1 ? direct[0] : null
}

const phoneKey = (value) => digits(value).replace(/^0+/, '')
const customersByPhone = new Map()
for (const row of customers.filter((candidate) => phoneKey(candidate.phone))) {
  const key = phoneKey(row.phone)
  if (!customersByPhone.has(key)) customersByPhone.set(key, [])
  customersByPhone.get(key).push(row)
}
const customersByName = new Map()
for (const row of customers) {
  const key = norm(row.name)
  if (!customersByName.has(key)) customersByName.set(key, [])
  customersByName.get(key).push(row)
}
function resolveCustomer(name, phone) {
  const byPhone = phoneKey(phone) ? customersByPhone.get(phoneKey(phone)) || [] : []
  if (byPhone.length === 1) return byPhone[0]
  const named = customersByName.get(norm(name)) || []
  return named.length === 1 ? named[0] : null
}

// ---- Aug-31 sales (invoices 4377-4390) --------------------------------------
const invoiceRows = workbookRows(files.invoice, 0, true)
const invoiceGroups = new Map()
for (const row of invoiceRows) {
  const invoiceNo = Number(row['Invoice No'])
  if (!String(row['Invoice No'] || '').trim() || !Number.isFinite(invoiceNo) || invoiceNo <= 0) continue
  const date = parseLegacyDate(row.Date, false)
  const receipt = `${invoiceNo}@${date}`
  if (!invoiceGroups.has(receipt)) invoiceGroups.set(receipt, [])
  invoiceGroups.get(receipt).push(row)
}
const driver = deliveryContacts.find((row) => norm(row.name) === 'driver 1') || null
if (!driver) throw new Error('Production delivery contact "driver 1" is missing')

// report-user-31st is a per-user summary, not an all-day cashier roster. Its
// $146 gross sale reconciles exactly to receipts 4377..4381 (13.5 + 28.5 + 22
// + 47 + 35). It therefore proves Rath only for those five receipts. The nine
// later receipts have no cashier evidence in the supplied reports and must stay
// unlinked/"Old system" instead of inheriting Rath from the calendar date.
const RATH_PROVEN_RECEIPTS = new Set([4377, 4378, 4379, 4380, 4381])
const users = queryRows('SELECT id,username,name FROM users ORDER BY id')
const cashierRath = users.find((row) => norm(row.username) === 'rath')
  || users.find((row) => norm(row.name) === 'roune rath')
  || null
if (!cashierRath) throw new Error('Aug-31 cashier "Rath" (username rath) is missing from users -- cannot attribute sales')

function receiptModel(receipt, rows) {
  const first = rows[0]
  const productLines = rows.filter((row) => norm(row.Product) !== 'delivery service')
  const deliveryLines = rows.filter((row) => norm(row.Product) === 'delivery service')
  const items = productLines.map((row, lineOrdinal) => {
    const product = resolveProduct(row.Product, row.Code, { preferSold: true })
    if (!product) throw new Error(`Unmapped sale product: ${row.Product} (${receipt})`)
    const quantity = num(row.Qty)
    const total = num(row.Total)
    return {
      lineOrdinal, product, quantity,
      applied: round(total / quantity), total: round(total), base: round(num(row.Price)),
      discount: round(num(row.Discount)), cost: round(num(row.Cost)),
    }
  })
  const createdAt = bangkokToUtc(parseLegacyDate(first['Check-out Time'] || first['Check-in Time']))
  const deliveryFee = round(deliveryLines.reduce((sum, row) => sum + num(row.Total), 0))
  const subtotal = round(items.reduce((sum, item) => sum + item.total, 0))
  const customer = resolveCustomer(first.Customer, first.Phone)
  const credit = num(first.Credit)
  const commission = num(first.Commission)
  const notes = [credit ? `credit ${credit}` : '', commission ? `commission ${commission}` : ''].filter(Boolean).join('; ') || null
  return {
    receipt, sourceInvoice: Number(first['Invoice No']), createdAt, items,
    customer, customerName: String(first.Customer || '').trim() || null,
    customerPhone: String(first.Phone || '').trim() || null,
    paymentMethod: String(first['Payment method'] || 'Cash').trim() || 'Cash',
    exchangeRate: num(first['Exchange - KHR']) || 4050,
    subtotal, amountPaid: num(first['Grand Total']) || round(subtotal + deliveryFee),
    deliveryFee, isDelivery: norm(first['Delivery Service']) !== 'walk-in' ? 1 : 0,
    credit, notes, cashier: RATH_PROVEN_RECEIPTS.has(Number(first['Invoice No'])) ? cashierRath : null,
  }
}
const saleModels = [...invoiceGroups.entries()]
  .map(([receipt, rows]) => receiptModel(receipt, rows))
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

const productUnits = round(saleModels.flatMap((s) => s.items).reduce((sum, i) => sum + i.quantity, 0))
const productRevenue = round(saleModels.reduce((sum, s) => sum + s.subtotal, 0))
const deliveryRevenue = round(saleModels.reduce((sum, s) => sum + s.deliveryFee, 0))
const creditTotal = round(saleModels.reduce((sum, s) => sum + s.credit, 0))
const rathSales = saleModels.filter((sale) => sale.cashier)
const rathGross = round(rathSales.reduce((sum, sale) => sum + sale.amountPaid, 0))
const invoiceLow = Math.min(...saleModels.map((s) => s.sourceInvoice))
const invoiceHigh = Math.max(...saleModels.map((s) => s.sourceInvoice))
if (saleModels.length !== 14 || invoiceLow !== 4377 || invoiceHigh !== 4390 ||
    productUnits !== 24 || productRevenue !== 530 || deliveryRevenue !== 17.5 || creditTotal !== 147 ||
    rathSales.length !== 5 || rathGross !== 146) {
  throw new Error(`Aug-31 sales gate failed: ${JSON.stringify({ n: saleModels.length, invoiceLow, invoiceHigh, productUnits, productRevenue, deliveryRevenue, creditTotal, rathSales: rathSales.length, rathGross })}`)
}
const existingTargetRows = saleModels.map((sale) => existing0831.get(sale.receipt)).filter(Boolean)
if (existingTargetRows.length !== 0 && existingTargetRows.length !== saleModels.length) {
  throw new Error(`Aug-31 receipts are only partly present (${existingTargetRows.length}/${saleModels.length}); refusing mixed create/correction SQL`)
}
for (const sale of saleModels) {
  const existing = existing0831.get(sale.receipt)
  if (!existing) continue
  const requestId = `legacy-sale:${sale.receipt}`
  const legacyCashierState = (existing.cashier_id == null && String(existing.cashier_name || '') === 'Old system')
    || (Number(existing.cashier_id) === Number(cashierRath.id) && norm(existing.cashier_name) === norm(cashierRath.username))
  if (String(existing.client_request_id || '') !== requestId
      || String(existing.created_at || '') !== sale.createdAt
      || Math.abs(num(existing.total_usd) - sale.subtotal) > 0.00001
      || !legacyCashierState) {
    throw new Error(`Existing Aug-31 receipt identity drifted; refusing correction: ${sale.receipt}`)
  }
}

// ---- Aug-31 expenses --------------------------------------------------------
const expenseRows = workbookRows(files.expense, 1, true)
const newExpenses = expenseRows.filter((row) => {
  if (!String(row.Date || '').match(/^\d{4}-\d{2}-\d{2}/) || num(row['Riel (KHR)']) <= 0) return false
  return parseLegacyDate(row.Date, false) === '2026-08-31'
}).map((row, index) => {
  const parts = String(row.Category || '').split('/').map((value) => value.trim()).filter(Boolean)
  return {
    date: parseLegacyDate(row.Date, false), createdAt: bangkokToUtc(parseLegacyDate(row.Date)),
    label: parts.at(-1) || 'no_category', notes: String(row.Description || '').trim() || null,
    amountKhr: num(row['Riel (KHR)']), sourceRow: index + 2,
  }
})
if (newExpenses.length !== 2 || newExpenses.reduce((sum, row) => sum + row.amountKhr, 0) !== 17200) {
  throw new Error(`Aug-31 expense gate failed: ${JSON.stringify(newExpenses)}`)
}

// ---- Customer accounts-receivable ledger (all time) -------------------------
const arSheet = workbookRows(files.receivable, 1, true)
const arRows = arSheet.filter((row) => /^\d+$/.test(String(row.ID || '')) && String(row['Invoice No'] || '').trim())
const receivables = arRows.map((row) => {
  const customer = resolveCustomer(row['Customer Name'], '')
  return {
    legacyId: Number(row.ID),
    customer,
    customerCode: String(row['Customer Code'] || '').trim() || null,
    customerName: String(row['Customer Name'] || '').trim() || '(unnamed)',
    invoiceNo: String(row['Invoice No'] || '').trim() || null,
    invoiceDate: bangkokToUtc(parseLegacyDate(row['Invoice Date'])),
    taxable: num(row['Taxable Amount']),
    vat: num(row['VAT Amount (10%)']),
    total: num(row['Taxable Amount + VAT Amount (10%)']),
    paid: num(row['Amount Paid']),
    outstanding: num(row['Outstanding Balance']),
    status: String(row.Status || '').trim() || 'Unknown',
    sourceRow: arSheet.indexOf(row) + 2,
  }
})
const arTotal = round(receivables.reduce((sum, r) => sum + r.total, 0), 4)
const arPaid = round(receivables.reduce((sum, r) => sum + r.paid, 0), 4)
const arOutstanding = round(receivables.reduce((sum, r) => sum + r.outstanding, 0), 4)
if (receivables.length !== 13243 || arTotal !== 1730636.803 || arPaid !== 1821982.2188 || arOutstanding !== -91345.4158) {
  throw new Error(`AR ledger gate failed: ${JSON.stringify({ n: receivables.length, arTotal, arPaid, arOutstanding })}`)
}
if (new Set(receivables.map((r) => r.legacyId)).size !== receivables.length) {
  throw new Error('AR legacy_id (report row ID) is not unique -- idempotency key would collide')
}
const arSourceFile = path.basename(files.receivable)
const arLinked = receivables.filter((r) => r.customer).length
const arUnpaidCount = receivables.filter((r) => r.outstanding > 0).length
const arUnpaidSum = round(receivables.filter((r) => r.outstanding > 0).reduce((s, r) => s + r.outstanding, 0), 2)
const arOverpaidCount = receivables.filter((r) => r.outstanding < 0).length
const arOverpaidSum = round(receivables.filter((r) => r.outstanding < 0).reduce((s, r) => s + r.outstanding, 0), 2)

// ---- SQL generation ---------------------------------------------------------
const saleStatements = []
for (const sale of saleModels) {
  const clientRequestId = `legacy-sale:${sale.receipt}`
  saleStatements.push(`INSERT OR IGNORE INTO sales (
    receipt_number,cashier_id,cashier_name,branch_id,branch_name,customer_id,customer_name,customer_phone,customer_address,
    payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
    total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,is_delivery,delivery_contact_id,
    delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_fee_usd,delivery_fee_khr,delivery_fee_paid_by,
    sale_status,notes,items,loyalty_accrual,created_at,updated_at,client_request_id
  ) VALUES (
    ${sql(sale.receipt)},${sale.cashier ? sale.cashier.id : 'NULL'},${sql(sale.cashier?.username || 'Old system')},2,'Leang Cosmetic Shop',${sale.customer?.id || 'NULL'},${sql(sale.customerName)},${sql(sale.customerPhone)},NULL,
    ${sql(sale.paymentMethod)},'USD',${sqlNum(sale.exchangeRate)},${sqlNum(sale.subtotal)},0,0,0,0,0,
    ${sqlNum(sale.subtotal)},${Math.round(sale.subtotal * sale.exchangeRate)},${sqlNum(sale.amountPaid)},0,0,0,${sale.isDelivery},${sale.isDelivery ? driver.id : 'NULL'},
    ${sale.isDelivery ? sql(driver.name) : 'NULL'},NULL,NULL,${sqlNum(sale.deliveryFee)},0,'customer','completed',${sql(sale.notes)},'[]',0,
    ${sql(sale.createdAt)},${sql(sale.createdAt)},${sql(clientRequestId)}
  );`)
  // Existing Aug-31 rows are accepted only after the exact receipt/request/
  // timestamp/total preflight above. Limit the correction to the two known
  // legacy states so a later human attribution can never be overwritten.
  saleStatements.push(`UPDATE sales SET cashier_id=${sale.cashier ? sale.cashier.id : 'NULL'},cashier_name=${sql(sale.cashier?.username || 'Old system')}
    WHERE receipt_number=${sql(sale.receipt)} AND client_request_id=${sql(clientRequestId)}
      AND created_at=${sql(sale.createdAt)} AND total_usd=${sqlNum(sale.subtotal)}
      AND ((cashier_id IS NULL AND cashier_name='Old system') OR (cashier_id=${cashierRath.id} AND lower(cashier_name)=lower(${sql(cashierRath.username)})));`)
  // sale_items -- ALL of this sale's lines in ONE statement. The sale-level
  // NOT EXISTS guard is evaluated against the pre-insert state (SQLite buffers a
  // SELECT that reads the table it writes), so every line lands on the first run
  // and none duplicate on a rerun. A per-line guard would wrongly block line 2+
  // of a multi-line sale once line 1 exists.
  const lineValues = sale.items.map((item) =>
    `(${item.lineOrdinal},${item.product.id},${sql(item.product.name)},${sql(item.product.sku)},${sqlNum(item.quantity)},${sqlNum(item.applied)},${sqlNum(item.total)},${sqlNum(item.cost)},${sqlNum(item.base)},${sqlNum(item.discount)},${item.product.opening_batch_id || 'NULL'})`
  ).join(',\n      ')
  saleStatements.push(`WITH lines(ord,product_id,product_name,sku,quantity,applied_price_usd,total_usd,cost_price_usd,base_price_usd,manual_discount_usd,batch_id) AS (
    VALUES
      ${lineValues}
  )
  INSERT INTO sale_items (
    sale_id,product_id,product_name,sku,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,
    cost_price_usd,cost_price_khr,base_price_usd,base_price_khr,product_discount_type,product_discount_label,
    product_discount_usd,product_discount_khr,manual_discount_type,manual_discount_value,manual_discount_usd,
    manual_discount_khr,branch_id,batch_id,batch_label,batch_expiry_date,returned_quantity
  )
  SELECT s.id,l.product_id,l.product_name,l.sku,l.quantity,l.applied_price_usd,0,l.total_usd,0,
    l.cost_price_usd,0,l.base_price_usd,0,NULL,NULL,0,0,
    CASE WHEN l.manual_discount_usd>0 THEN 'fixed' ELSE NULL END,l.manual_discount_usd,l.manual_discount_usd,0,
    2,l.batch_id,NULL,NULL,0
  FROM sales s CROSS JOIN lines l
  WHERE s.client_request_id=${sql(clientRequestId)}
    AND NOT EXISTS (SELECT 1 FROM sale_items existing WHERE existing.sale_id=s.id)
  ORDER BY l.ord;`)
  // Materialize the sale.items JSON snapshot from the freshly-inserted lines.
  saleStatements.push(`UPDATE sales SET items=(
    SELECT json_group_array(json_object(
      'product_id',si.product_id,'product_name',si.product_name,'sku',si.sku,
      'quantity',si.quantity,'returned_quantity',si.returned_quantity,
      'applied_price_usd',si.applied_price_usd,'applied_price_khr',si.applied_price_khr,
      'total_usd',si.total_usd,'total_khr',si.total_khr,
      'cost_price_usd',si.cost_price_usd,'cost_price_khr',si.cost_price_khr,
      'base_price_usd',si.base_price_usd,'base_price_khr',si.base_price_khr,
      'product_discount_type',si.product_discount_type,'product_discount_label',si.product_discount_label,
      'product_discount_usd',si.product_discount_usd,'product_discount_khr',si.product_discount_khr,
      'manual_discount_type',si.manual_discount_type,'manual_discount_value',si.manual_discount_value,
      'manual_discount_usd',si.manual_discount_usd,'manual_discount_khr',si.manual_discount_khr,
      'branch_id',si.branch_id,'batch_id',si.batch_id,'batch_label',si.batch_label,
      'batch_expiry_date',si.batch_expiry_date
    )) FROM sale_items si WHERE si.sale_id=sales.id ORDER BY si.id
  ) WHERE client_request_id=${sql(clientRequestId)};`)
  // Stock deduction: one signed effect per line (branch 2 = shop). The AFTER
  // trigger moves product/branch/lot stock and writes the inventory movement.
  for (const item of sale.items) {
    saleStatements.push(`INSERT OR IGNORE INTO legacy_inventory_effects (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at)
      VALUES (${sql(`legacy-sale:${sale.receipt}:${item.lineOrdinal}`)},${item.product.id},2,${item.product.opening_batch_id || 'NULL'},${-item.quantity},${item.quantity},'sale',${sql(`Old-system sale ${sale.receipt}`)},(SELECT id FROM sales WHERE client_request_id=${sql(clientRequestId)}),${sql(sale.createdAt)});`)
  }
  saleStatements.push(`UPDATE legacy_inventory_effects SET occurred_at=${sql(sale.createdAt)} WHERE source_key LIKE ${sql(`legacy-sale:${sale.receipt}:%`)};`)
  saleStatements.push(`UPDATE inventory_movements SET created_at=${sql(sale.createdAt)},user_id=${sale.cashier ? sale.cashier.id : 'NULL'},user_name=${sql(sale.cashier?.username || 'Old system')}
    WHERE reference_id=(SELECT id FROM sales WHERE client_request_id=${sql(clientRequestId)})
      AND movement_type='sale' AND reason=${sql(`Old-system sale ${sale.receipt}`)}
      AND ((user_id IS NULL AND user_name='Old system') OR (user_id=${cashierRath.id} AND lower(user_name)=lower(${sql(cashierRath.username)})));`)
}

const expenseStatements = []
for (const row of newExpenses) {
  expenseStatements.push(`INSERT INTO fees (fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,notes,created_by,created_by_name,created_at,updated_at)
    SELECT 'expense',${sql(row.label)},0,${sqlNum(row.amountKhr)},${sql(row.date)},NULL,2,${sql(row.notes)},NULL,'Old system',${sql(row.createdAt)},${sql(row.createdAt)}
    WHERE NOT EXISTS (SELECT 1 FROM fees WHERE fee_date=${sql(row.date)} AND label=${sql(row.label)} AND amount_khr=${sqlNum(row.amountKhr)} AND COALESCE(notes,'')=COALESCE(${sql(row.notes)},''));`)
  expenseStatements.push(`UPDATE fees SET created_at=${sql(row.createdAt)},updated_at=${sql(row.createdAt)}
    WHERE fee_date=${sql(row.date)} AND label=${sql(row.label)} AND amount_khr=${sqlNum(row.amountKhr)}
      AND COALESCE(notes,'')=COALESCE(${sql(row.notes)},'') AND created_by_name='Old system';`)
}

const receivableValues = receivables.map((r) => `(${r.legacyId},${r.customer?.id || 'NULL'},${sql(r.customerCode)},${sql(r.customerName)},${sql(r.invoiceNo)},${sql(r.invoiceDate)},${sqlNum(r.taxable)},${sqlNum(r.vat)},${sqlNum(r.total)},${sqlNum(r.paid)},${sqlNum(r.outstanding)},${sql(r.status)},${sql(arSourceFile)},${r.sourceRow})`)
const receivableStatements = []
for (let offset = 0; offset < receivableValues.length; offset += 400) {
  receivableStatements.push(`INSERT INTO customer_receivables
    (legacy_id,customer_id,customer_code,customer_name,invoice_no,invoice_date,taxable_amount_usd,vat_amount_usd,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row)
    VALUES\n${receivableValues.slice(offset, offset + 400).join(',\n')}
    ON CONFLICT(source_file,legacy_id) DO UPDATE SET
      customer_id=excluded.customer_id,customer_code=excluded.customer_code,customer_name=excluded.customer_name,
      invoice_no=excluded.invoice_no,invoice_date=excluded.invoice_date,taxable_amount_usd=excluded.taxable_amount_usd,
      vat_amount_usd=excluded.vat_amount_usd,total_amount_usd=excluded.total_amount_usd,
      amount_paid_usd=excluded.amount_paid_usd,outstanding_balance_usd=excluded.outstanding_balance_usd,
      status=excluded.status,source_row=excluded.source_row;`)
}

// ---- Write phase files ------------------------------------------------------
const outputDir = path.join(cloudflare, '.wrangler', 'tmp', 'legacy-aug31-import')
fs.mkdirSync(outputDir, { recursive: true })
for (const filename of fs.readdirSync(outputDir)) {
  if (/\.sql$/.test(filename)) fs.unlinkSync(path.join(outputDir, filename))
}
const phaseFiles = []
function writePhase(name, statements) {
  const filename = path.join(outputDir, name)
  fs.writeFileSync(filename, `${statements.join('\n\n')}\n`, 'utf8')
  phaseFiles.push(filename)
}
writePhase('01-sales.sql', saleStatements)
writePhase('02-expenses.sql', expenseStatements)
for (let i = 0; i < receivableStatements.length; i += 8) {
  writePhase(`03-receivables-${String(i / 8 + 1).padStart(2, '0')}.sql`, receivableStatements.slice(i, i + 8))
}

const summary = {
  preflight: { existingAug31Sales: existing0831.size, arTableExists },
  sales: {
    receipts: saleModels.length, invoiceRange: [invoiceLow, invoiceHigh],
    lines: saleModels.reduce((sum, s) => sum + s.items.length, 0),
    productUnits, productRevenue, deliveryRevenue, creditKeptInNotes: creditTotal,
    customersLinked: saleModels.filter((s) => s.customer).length,
  },
  expenses: { rows: newExpenses.length, khr: newExpenses.reduce((sum, r) => sum + r.amountKhr, 0) },
  receivables: {
    rows: receivables.length, totalUsd: arTotal, paidUsd: arPaid, outstandingUsd: arOutstanding,
    customersLinked: arLinked, unpaidInvoices: arUnpaidCount, unpaidUsd: arUnpaidSum,
    overpaidInvoices: arOverpaidCount, overpaidUsd: arOverpaidSum,
  },
  generated: { outputDir, phaseFiles: phaseFiles.map((f) => path.basename(f)) },
}
console.log(JSON.stringify(summary, null, 2))

if (process.argv.includes('--apply')) {
  if (!arTableExists) throw new Error('Refusing to apply: migration 0094 (customer_receivables) is not applied yet')
  for (const filename of phaseFiles) d1File(filename)
  const verification = queryRows(`
    SELECT 'sales_0831' metric, COUNT(*) value, ROUND(COALESCE(SUM(total_usd),0),2) value2 FROM sales WHERE receipt_number LIKE '43__@2026-08-31';
    SELECT 'sale_lines_0831' metric, COUNT(*) value, ROUND(COALESCE(SUM(si.quantity),0),2) value2 FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.receipt_number LIKE '43__@2026-08-31';
    SELECT 'inv_effects_0831' metric, COUNT(*) value, ROUND(COALESCE(SUM(quantity_delta),0),2) value2 FROM legacy_inventory_effects WHERE source_key LIKE 'legacy-sale:43%@2026-08-31:%';
    SELECT 'expenses_0831' metric, COUNT(*) value, ROUND(COALESCE(SUM(amount_khr),0),2) value2 FROM fees WHERE fee_date='2026-08-31' AND created_by_name='Old system';
    SELECT 'receivables' metric, COUNT(*) value, ROUND(COALESCE(SUM(total_amount_usd),0),4) value2 FROM customer_receivables;
    SELECT 'receivables_outstanding' metric, COUNT(*) value, ROUND(COALESCE(SUM(outstanding_balance_usd),0),4) value2 FROM customer_receivables;
    SELECT 'receivables_unpaid' metric, COUNT(*) value, ROUND(COALESCE(SUM(outstanding_balance_usd),0),2) value2 FROM customer_receivables WHERE outstanding_balance_usd>0;
  `)
  console.log(JSON.stringify({ verification }, null, 2))
}
