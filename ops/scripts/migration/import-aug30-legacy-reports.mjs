#!/usr/bin/env node
/*
 * Reconciles the Aug 27-30 legacy reports with the Aug 28 Business OS pack.
 *
 * Default: read-only audit and SQL generation.
 *   node ops/scripts/migration/import-aug30-legacy-reports.mjs
 * Apply (after migration 0088):
 *   node ops/scripts/migration/import-aug30-legacy-reports.mjs --apply
 *
 * The generated SQL is intentionally idempotent. Stock changes enter through
 * legacy_inventory_effects, whose primary key + trigger make each source event
 * apply at most once. Summary reports never become transactions.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const cloudflare = path.join(repo, 'cloudflare')
const downloads = path.resolve(repo, '..')
const pack = path.join(downloads, 'businessos-migration-aug28')
const require = createRequire(import.meta.url)
const XLSX = require(path.join(repo, 'frontend/node_modules/xlsx'))

// The report files originally sat loose in Downloads; they are archived in
// Downloads/27th-30th now. Accept either location so source-level reruns work.
const reportFile = (name) => {
  const loose = path.join(downloads, name)
  return fs.existsSync(loose) ? loose : path.join(downloads, '27th-30th', name)
}
const files = {
  invoice: reportFile('report-invoice-detail 27th-30th.xls'),
  invoiceFull: reportFile('report-invoice-detail.xls'),
  transfer: reportFile('stock branch transfer.xls'),
  stockIn: reportFile('stock-in-report-stockin-27th-30th.xlsx'),
  stockReport: reportFile('stock-report-27th-30.xlsx'),
  expense: reportFile('report-expense-income-27th-30th.xls'),
  payableWarehouse: reportFile('warehouse-account-payable-report-all.xls'),
  payableShop: reportFile('shop-account-payable-report-all.xls'),
  deleted: reportFile('deleted items-all time.xls'),
  mapping: path.join(pack, 'reference/product_mapping.csv'),
  mappingReview: path.join(pack, 'reference/product_mapping_review_VERIFIED.csv'),
  sales2024: path.join(pack, 'sales-import-2024.csv'),
  sales2025: path.join(pack, 'sales-import-2025.csv'),
  sales2026: path.join(pack, 'sales-import-2026.csv'),
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

// Legacy reports contain Bangkok wall-clock timestamps. Business OS stores
// instants as UTC and applies the organization timezone when rendering them.
function bangkokToUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`Unrecognized Bangkok timestamp: ${value}`)
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 7, Number(match[5]), Number(match[6]))
  return new Date(utc).toISOString()
}

function sameInstant(left, right) {
  const instant = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return NaN
    return Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
  }
  return instant(left) === instant(right)
}

function bangkokDateFromStorage(value) {
  const raw = String(value || '').trim()
  const parsed = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function d1Query(command) {
  const result = spawnSync(process.execPath, [
    'scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os',
    '--remote', '--json', '--command', command,
  ], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'D1 query failed')
  return JSON.parse(result.stdout)
}

function d1File(filename) {
  const result = spawnSync(process.execPath, [
    'scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os',
    '--remote', '--file', filename,
  ], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `D1 file failed: ${filename}`)
  process.stdout.write(result.stdout)
}

function queryRows(command) {
  return d1Query(command).flatMap((result) => result.results || [])
}

const productRows = queryRows(`
  SELECT p.id, p.name, p.sku, p.barcode, p.stock_quantity,
    (SELECT pb.id FROM product_batches pb
     WHERE pb.variant_product_id=p.id AND pb.is_active=1
       AND pb.notes='Received via product import'
     ORDER BY pb.id LIMIT 1) AS opening_batch_id,
    COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id=p.id AND bs.branch_id=1),0) AS warehouse_qty,
    COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id=p.id AND bs.branch_id=2),0) AS shop_qty
  FROM products p WHERE p.is_active=1 ORDER BY p.id
`)
const suppliers = queryRows('SELECT id,name FROM suppliers ORDER BY id')
const customers = queryRows('SELECT id,name,phone FROM customers ORDER BY id')
const deliveryContacts = queryRows('SELECT id,name FROM delivery_contacts ORDER BY id')
const users = queryRows('SELECT id,username,name FROM users ORDER BY id')
const currentPeriodSales = queryRows(`
  SELECT id,receipt_number,created_at,cashier_name,client_request_id
  FROM sales WHERE created_at >= '2026-08-27' OR receipt_number LIKE '%@2026-08-27' OR receipt_number LIKE '%@2026-08-28'
`)
const allSales = queryRows('SELECT id,receipt_number,created_at FROM sales ORDER BY id')
const saleIdBounds = queryRows('SELECT COALESCE(MIN(id),0) min_id, COALESCE(MAX(id),0) max_id FROM sales')[0]
const remoteCorrectionCount = Number(queryRows('SELECT COUNT(*) count FROM legacy_sale_item_corrections')[0]?.count || 0)
const existingDateCorrectionReceipts = new Set(queryRows('SELECT receipt_number FROM legacy_sale_date_corrections').map((row) => String(row.receipt_number)))

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

const mappingRows = workbookRows(files.mapping, 0, true)
const reviewRows = workbookRows(files.mappingReview, 0, true)
const mappingByOldName = new Map()
const mappingByOldBarcode = new Map()
for (const row of mappingRows) {
  const mapped = { oldName: row.old_name, oldBarcode: String(row.old_barcode || ''), targetName: row.template_name, targetBarcode: String(row.template_barcode || '') }
  const key = norm(row.old_name)
  if (!mappingByOldName.has(key)) mappingByOldName.set(key, [])
  mappingByOldName.get(key).push(mapped)
  if (mapped.oldBarcode) mappingByOldBarcode.set(mapped.oldBarcode, mapped)
}
for (const row of reviewRows) {
  const targetName = row.merge_into_template_product || row.verified_official_name
  const mapped = { oldName: row.old_name, oldBarcode: String(row.old_barcode || ''), targetName, targetBarcode: '' }
  const key = norm(row.old_name)
  if (!mappingByOldName.has(key)) mappingByOldName.set(key, [])
  mappingByOldName.get(key).push(mapped)
  if (mapped.oldBarcode) mappingByOldBarcode.set(mapped.oldBarcode, mapped)
}

// The pack only appends @YYYY-MM-DD when the old invoice number collides.
// Source reports themselves do not say which identifiers needed that suffix,
// so use the exact three imported CSVs as the identifier authority.
const importedReceiptCandidates = new Map()
for (const filename of [files.sales2024, files.sales2025, files.sales2026]) {
  let current = null
  for (const row of workbookRows(filename, 0, true)) {
    if (String(row.receipt_number || '').trim()) {
      const actualReceipt = String(row.receipt_number).trim()
      const sourceNumber = actualReceipt.split('@')[0]
      current = { actualReceipt, sourceNumber, date: parseLegacyDate(row.sale_date, false), lines: [] }
      if (!importedReceiptCandidates.has(sourceNumber)) importedReceiptCandidates.set(sourceNumber, [])
      importedReceiptCandidates.get(sourceNumber).push(current)
    }
    if (current && String(row.name || '').trim()) {
      current.lines.push({ quantity: num(row.quantity), total: round(num(row.unit_price_usd) * num(row.quantity)) })
    }
  }
}
const receiptSignature = (lines) => `${lines.length}|${round(lines.reduce((sum, line) => sum + num(line.quantity), 0))}|${round(lines.reduce((sum, line) => sum + num(line.total), 0))}`
function matchImportedReceipt(sourceNumber, sourceDate, lines) {
  const candidates = importedReceiptCandidates.get(String(sourceNumber)) || []
  if (!candidates.length) return `${sourceNumber}@${sourceDate}`
  const signature = receiptSignature(lines)
  const signatureMatches = candidates.filter((candidate) => receiptSignature(candidate.lines) === signature)
  if (signatureMatches.length === 1) return signatureMatches[0].actualReceipt
  const pool = signatureMatches.length ? signatureMatches : candidates
  const sourceTime = Date.parse(`${sourceDate}T00:00:00Z`)
  pool.sort((a, b) => Math.abs(Date.parse(`${a.date}T00:00:00Z`) - sourceTime) - Math.abs(Date.parse(`${b.date}T00:00:00Z`) - sourceTime))
  return pool[0].actualReceipt
}

const stockReport = workbookRows(files.stockReport, 0, true)
const stockRowsByName = new Map()
for (const row of stockReport) {
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

// The legacy reports print Cambodian numbers without the leading 0 that the
// contact book stores ('70856070' vs '070856070'), so compare zero-stripped
// keys — and only link a key that identifies exactly one customer.
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

// Detailed invoice report: 14 existing receipts overlap the prior pack; 26
// receipts (4351-4376) are genuinely new. Delivery is a fee, never an item.
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
const newReceipts = [...invoiceGroups.entries()].filter(([receipt]) => Number(receipt.split('@')[0]) >= 4351)
const overlapReceipts = [...invoiceGroups.entries()].filter(([receipt]) => {
  const number = Number(receipt.split('@')[0])
  return number >= 4337 && number <= 4350
})
const existingSaleByReceipt = new Map(currentPeriodSales.map((row) => [row.receipt_number, row]))
const existingReceipts = new Set(existingSaleByReceipt.keys())
const unexpectedExisting = newReceipts.filter(([receipt]) => {
  const existing = existingSaleByReceipt.get(receipt)
  return existing && existing.client_request_id !== `legacy-sale:${receipt}`
}).map(([receipt]) => receipt)
if (unexpectedExisting.length) throw new Error(`New-period receipts already exist: ${unexpectedExisting.join(', ')}`)
const missingOverlap = overlapReceipts.filter(([receipt]) => !existingReceipts.has(receipt)).map(([receipt]) => receipt)
if (missingOverlap.length) throw new Error(`Expected overlap receipts are missing: ${missingOverlap.join(', ')}`)

// Canonical cashier resolution (username -> name -> alias), matching
// importEngine. The legacy report's cashier is the nickname "Aza", which equals
// NO username ("aza" != username "Za") and no name, so it resolves only through
// the user_aliases table (alias aza -> user "Za", id 3). Resolving by id keeps
// it correct even if that account is later renamed. user_aliases may be absent
// on an un-migrated DB, so its lookup is guarded.
const cashierAliases = (() => {
  try { return queryRows('SELECT user_id, alias FROM user_aliases') } catch { return [] }
})()
const cashierKey = 'aza'
const cashierAliasUserId = cashierAliases.find((row) => norm(row.alias) === cashierKey)?.user_id ?? null
const cashier = users.find((row) => norm(row.username) === cashierKey || norm(row.name) === cashierKey)
  || (cashierAliasUserId != null ? users.find((row) => row.id === cashierAliasUserId) : null)
  || null
if (!cashier) throw new Error('Aug-30 cashier "Aza" did not resolve to a user (expected alias aza -> "Za")')
const driver = deliveryContacts.find((row) => norm(row.name) === 'driver 1') || null
if (!driver) throw new Error('Production delivery contact "driver 1" is missing')

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
      receipt, lineOrdinal, product, quantity,
      applied: round(total / quantity), total: round(total), base: round(num(row.Price)),
      discount: round(num(row.Discount)), cost: round(num(row.Cost)),
      sourceRow: invoiceRows.indexOf(row) + 2,
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
    notes,
  }
}
const newSaleModels = newReceipts.map(([receipt, rows]) => receiptModel(receipt, rows)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
const overlapModels = overlapReceipts.map(([receipt, rows]) => receiptModel(receipt, rows))

const newProductUnits = round(newSaleModels.flatMap((sale) => sale.items).reduce((sum, item) => sum + item.quantity, 0))
const newProductRevenue = round(newSaleModels.reduce((sum, sale) => sum + sale.subtotal, 0))
const newDeliveryRevenue = round(newSaleModels.reduce((sum, sale) => sum + sale.deliveryFee, 0))
if (newSaleModels.length !== 26 || newProductUnits !== 59 || newProductRevenue !== 2083 || newDeliveryRevenue !== 21.1) {
  throw new Error(`New-sales gate failed: ${JSON.stringify({ receipts: newSaleModels.length, newProductUnits, newProductRevenue, newDeliveryRevenue })}`)
}

// Source-backed corrections for every historical product line. The newer
// detailed report overrides its overlapping receipt keys and adds 4348-4376.
const sourceCreatedAtByReceipt = new Map()
const sourceFileByReceipt = new Map()
function correctionGroupsFromFullReport() {
  const rows = workbookRows(files.invoiceFull)
  const rawGroups = new Map()
  for (let index = 1; index < rows.length - 1; index += 1) {
    const row = rows[index]
    if (!row[1] || !row[6] || norm(row[6]) === 'delivery service') continue
    const sourceDate = parseLegacyDate(row[0], false)
    const sourceReceiptKey = `${row[1]}@${sourceDate}`
    if (!rawGroups.has(sourceReceiptKey)) rawGroups.set(sourceReceiptKey, { sourceNumber: String(row[1]), sourceDate, lines: [] })
    const group = rawGroups.get(sourceReceiptKey)
    group.lines.push({
      lineOrdinal: group.lines.length,
      product: null, quantity: num(row[7]), applied: round(num(row[11]) / num(row[7])),
      total: round(num(row[11])), base: round(num(row[8])), discount: round(num(row[9])),
      cost: round(num(row[24])), sourceFile: path.basename(files.invoiceFull), sourceRow: index + 1,
    })
  }
  const groups = new Map()
  for (const group of rawGroups.values()) {
    const receipt = matchImportedReceipt(group.sourceNumber, group.sourceDate, group.lines)
    groups.set(receipt, group.lines.map((line) => ({ ...line, receipt })))
    sourceCreatedAtByReceipt.set(receipt, {
      storage: bangkokToUtc(`${group.sourceDate} 00:00:00`), localDate: group.sourceDate, exactTime: false,
    })
    sourceFileByReceipt.set(receipt, path.basename(files.invoiceFull))
  }
  for (const [receipt, rowsForReceipt] of invoiceGroups) {
    const detailed = receiptModel(receipt, rowsForReceipt)
    groups.set(receipt, detailed.items.map((item) => ({
      ...item, sourceFile: path.basename(files.invoice), sourceRow: item.sourceRow,
    })))
    sourceCreatedAtByReceipt.set(receipt, { storage: detailed.createdAt, localDate: receipt.split('@').at(-1), exactTime: true })
    sourceFileByReceipt.set(receipt, path.basename(files.invoice))
  }
  return groups
}
const correctionGroups = correctionGroupsFromFullReport()
const corrections = [...correctionGroups.values()].flat()
const saleDateCorrections = allSales.flatMap((sale) => {
  const receipt = String(sale.receipt_number)
  const source = sourceCreatedAtByReceipt.get(receipt)
  if (!source) return []
  const equal = source.exactTime || existingDateCorrectionReceipts.has(receipt)
    ? sameInstant(sale.created_at, source.storage)
    : bangkokDateFromStorage(sale.created_at) === source.localDate
  return equal ? [] : [{
    receipt: String(sale.receipt_number), previousCreatedAt: String(sale.created_at || ''),
    sourceCreatedAt: source.storage,
    sourceFile: sourceFileByReceipt.get(String(sale.receipt_number)) || path.basename(files.invoiceFull),
  }]
})

// Branch transfers: all 12 groups/20 item lines are retained as history, but
// only transfer 2608001722 is after the stock snapshot cutoff and changes live
// branch allocation. Older transfer rows get movement history with delta 0.
const transferRows = workbookRows(files.transfer)
const transfers = []
let transferMeta = null
for (let index = 1; index < transferRows.length; index += 1) {
  const row = transferRows[index]
  const first = String(row[0] || '')
  if (first.startsWith('Created By:')) {
    const match = first.match(/^Created By:(.*?)Date:(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})From Branch:(.*?)Done By:(.*?)Done Date:(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})To Branch:(.*?)Transfer #:(\d+)$/)
    if (!match) throw new Error(`Unparsed transfer header on row ${index + 1}`)
    transferMeta = { createdBy: match[1], from: match[4], doneBy: match[5], occurredAt: bangkokToUtc(`${match[6]} ${match[7]}:00`), to: match[8], number: match[9], itemOrdinal: 0 }
    continue
  }
  if (!transferMeta || !row[1] || num(row[2]) <= 0) continue
  const product = resolveProduct(row[1], row[0])
  if (!product) throw new Error(`Unmapped transfer product: ${row[1]}`)
  transfers.push({ ...transferMeta, itemOrdinal: transferMeta.itemOrdinal++, product, sourceName: row[1], quantity: num(row[2]), sourceRow: index + 1 })
}
if (new Set(transfers.map((row) => row.number)).size !== 12 || transfers.length !== 20 || transfers.reduce((sum, row) => sum + row.quantity, 0) !== 117) {
  throw new Error('Transfer reconciliation failed')
}

// Expense report: Aug 27 is already migration 0064; only eight later rows are
// new. Exact value/date/label checks in the INSERT prevent duplicates.
const expenseRows = workbookRows(files.expense, 1, true)
const newExpenses = expenseRows.filter((row) => {
  if (!String(row.Date || '').match(/^\d{4}-\d{2}-\d{2}/) || num(row['Riel (KHR)']) <= 0) return false
  const date = parseLegacyDate(row.Date, false)
  return date && date > '2026-08-27'
}).map((row, index) => {
  const parts = String(row.Category || '').split('/').map((value) => value.trim()).filter(Boolean)
  return {
    date: parseLegacyDate(row.Date, false), createdAt: bangkokToUtc(parseLegacyDate(row.Date)),
    label: parts.at(-1) || 'no_category', notes: String(row.Description || '').trim() || null,
    amountKhr: num(row['Riel (KHR)']), sourceRow: index + 2,
  }
})
if (newExpenses.length !== 8 || newExpenses.reduce((sum, row) => sum + row.amountKhr, 0) !== 195500) throw new Error('Expense reconciliation failed')

function payableRows(filename, sourceBranch, branchId) {
  return workbookRows(filename, 1, true).filter((row) => /^\d+$/.test(String(row.ID || ''))).map((row, index) => {
    const supplier = suppliers.find((candidate) => norm(candidate.name) === norm(row['Supplier Name'])) || null
    return {
      sourceBranch, branchId, legacyId: Number(row.ID), supplier, supplierCode: row['Supplier code'] || null,
      supplierName: String(row['Supplier Name'] || '').trim(), invoiceNo: row['Invoice No'] || null,
      invoiceDate: bangkokToUtc(parseLegacyDate(row['Invoice Date'])), dueDate: bangkokToUtc(parseLegacyDate(row['Due Date'])),
      termDays: num(row['Term Days']), taxable: num(row['Taxable Amount']), vat: num(row['VAT Amount (10%)']),
      total: num(row['Taxable Amount + VAT Amount (10%)']), paid: num(row['Amount Paid']),
      outstanding: num(row['Outstanding Balance']), status: String(row.Status || '').trim(),
      sourceFile: path.basename(filename), sourceRow: index + 2,
    }
  })
}
const payables = [
  ...payableRows(files.payableWarehouse, 'warehouse', 1),
  ...payableRows(files.payableShop, 'shop', 2),
]
if (payables.length !== 1591 || round(payables.reduce((sum, row) => sum + row.total, 0), 4) !== 1311701.4626 || round(payables.reduce((sum, row) => sum + row.outstanding, 0), 4) !== 489) {
  throw new Error('Payables reconciliation failed')
}

function parseDeletedItems() {
  const rows = workbookRows(files.deleted, 1)
  const result = []
  let event = null
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const first = String(row[0] || '')
    if (first.startsWith('Date:')) {
      const dates = first.slice(5).match(/^(\d{4}-\d{2}-\d{2}\d{2}:\d{2})-(\d{4}-\d{2}-\d{2}\d{2}:\d{2})$/)
      event = {
        startedAt: dates ? bangkokToUtc(parseLegacyDate(dates[1])) : null,
        endedAt: dates ? bangkokToUtc(parseLegacyDate(dates[2])) : null,
        invoiceNo: String(row[4] || '').replace(/^Inv #:\s*/, '').trim() || null,
        referenceNo: null, cashier: null, billReason: null,
      }
      continue
    }
    if (!event) continue
    if (first.startsWith('Table:')) { event.referenceNo = String(row[4] || '').replace(/^Ref #:\s*/, '').trim() || null; continue }
    if (first.startsWith('Cashier:')) {
      event.cashier = first.replace(/^Cashier:\s*/, '').trim() || null
      event.billReason = String(row[4] || '').trim() || null
      continue
    }
    if (!row[3] || row[3] === 'Item name' || !String(row[5] || '').trim() || !Number.isFinite(Number(row[5]))) continue
    const product = resolveProduct(row[3], row[4])
    result.push({
      eventKey: event.referenceNo || `${event.startedAt}|${event.invoiceNo || ''}`,
      ...event, deletedAt: String(row[0] || '').trim() ? bangkokToUtc(parseLegacyDate(row[0])) : null,
      deletedBy: String(row[1] || '').trim() || null, deletionReason: String(row[2] || '').replace(/^,/, '').trim() || null,
      product, sourceName: String(row[3]).trim(), sourceCode: String(row[4] || '').trim() || null,
      quantity: num(row[5]), unitPrice: num(row[6]), discountRaw: String(row[7] || '').trim() || null,
      total: num(row[8]), sourceRow: index + 1,
    })
  }
  return result
}
const deletedItems = parseDeletedItems()
if (deletedItems.length !== 2234 || deletedItems.reduce((sum, row) => sum + row.quantity, 0) !== 4630 || round(deletedItems.reduce((sum, row) => sum + row.total, 0), 2) !== 10156840.41) {
  throw new Error('Deleted-item reconciliation failed')
}

const statements = []
const correctionInserts = []
for (const item of corrections) {
  const product = item.product || null
  correctionInserts.push(`(${sql(`${item.receipt}:${item.lineOrdinal}`)},${sql(item.receipt)},${item.lineOrdinal},${product?.id || 'NULL'},${sql(product?.name)},${sql(product?.sku)},${sqlNum(item.quantity)},${product ? 2 : 'NULL'},${product?.opening_batch_id || 'NULL'},${sqlNum(item.applied)},${sqlNum(item.total)},${sqlNum(item.base)},${sqlNum(item.discount)},${sqlNum(item.cost)},${sql(item.sourceFile)},${item.sourceRow})`)
}
for (let offset = 0; offset < correctionInserts.length; offset += 400) {
  statements.push(`INSERT OR IGNORE INTO legacy_sale_item_corrections
    (source_key,receipt_number,line_ordinal,product_id,product_name,sku,quantity,branch_id,batch_id,applied_price_usd,total_usd,base_price_usd,manual_discount_usd,cost_price_usd,source_file,source_row)
    VALUES\n${correctionInserts.slice(offset, offset + 400).join(',\n')};`)
}

// Repair exact check-out times/cashier on the 14 already-imported overlap receipts.
for (const sale of overlapModels) {
  statements.push(`UPDATE sales SET created_at=${sql(sale.createdAt)}, updated_at=CURRENT_TIMESTAMP, cashier_id=${cashier.id}, cashier_name=${sql(cashier.username)} WHERE receipt_number=${sql(sale.receipt)};`)
}

for (const sale of newSaleModels) {
  const clientRequestId = `legacy-sale:${sale.receipt}`
  statements.push(`INSERT OR IGNORE INTO sales (
    receipt_number,cashier_id,cashier_name,branch_id,branch_name,customer_id,customer_name,customer_phone,customer_address,
    payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
    total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,is_delivery,delivery_contact_id,
    delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_fee_usd,delivery_fee_khr,delivery_fee_paid_by,
    sale_status,notes,items,loyalty_accrual,created_at,updated_at,client_request_id
  ) VALUES (
    ${sql(sale.receipt)},${cashier.id},${sql(cashier.username)},2,'Leang Cosmetic Shop',${sale.customer?.id || 'NULL'},${sql(sale.customerName)},${sql(sale.customerPhone)},NULL,
    ${sql(sale.paymentMethod)},'USD',${sqlNum(sale.exchangeRate)},${sqlNum(sale.subtotal)},0,0,0,0,0,
    ${sqlNum(sale.subtotal)},${Math.round(sale.subtotal * sale.exchangeRate)},${sqlNum(sale.amountPaid)},0,0,0,${sale.isDelivery},${sale.isDelivery ? driver.id : 'NULL'},
    ${sale.isDelivery ? sql(driver.name) : 'NULL'},NULL,NULL,${sqlNum(sale.deliveryFee)},0,'customer','completed',${sql(sale.notes)},'[]',0,
    ${sql(sale.createdAt)},${sql(sale.createdAt)},${sql(clientRequestId)}
  );`)
}

const newReceiptList = newSaleModels.map((sale) => sql(sale.receipt)).join(',')
statements.push(`INSERT INTO sale_items (
  sale_id,product_id,product_name,sku,quantity,applied_price_usd,applied_price_khr,total_usd,total_khr,
  cost_price_usd,cost_price_khr,base_price_usd,base_price_khr,product_discount_type,product_discount_label,
  product_discount_usd,product_discount_khr,manual_discount_type,manual_discount_value,manual_discount_usd,
  manual_discount_khr,branch_id,batch_id,batch_label,batch_expiry_date,returned_quantity
)
SELECT s.id,c.product_id,c.product_name,c.sku,c.quantity,c.applied_price_usd,0,c.total_usd,0,
  c.cost_price_usd,0,c.base_price_usd,0,NULL,NULL,0,0,
  CASE WHEN c.manual_discount_usd>0 THEN 'fixed' ELSE NULL END,c.manual_discount_usd,c.manual_discount_usd,0,
  2,c.batch_id,NULL,NULL,0
FROM legacy_sale_item_corrections c
JOIN sales s ON s.receipt_number=c.receipt_number
WHERE c.receipt_number IN (${newReceiptList})
  AND NOT EXISTS (SELECT 1 FROM sale_items existing WHERE existing.sale_id=s.id)
ORDER BY s.created_at,c.line_ordinal;`)

// AP ledger.
const payableValues = payables.map((row) => `(${sql(row.sourceBranch)},${row.branchId},${row.legacyId},${row.supplier?.id || 'NULL'},${sql(row.supplierCode)},${sql(row.supplierName)},${sql(row.invoiceNo)},${sql(row.invoiceDate)},${sql(row.dueDate)},${sqlNum(row.termDays)},${sqlNum(row.taxable)},${sqlNum(row.vat)},${sqlNum(row.total)},${sqlNum(row.paid)},${sqlNum(row.outstanding)},${sql(row.status)},${sql(row.sourceFile)},${row.sourceRow})`)
for (let offset = 0; offset < payableValues.length; offset += 400) {
  statements.push(`INSERT INTO supplier_invoices
    (source_branch,branch_id,legacy_id,supplier_id,supplier_code,supplier_name,invoice_no,invoice_date,due_date,term_days,taxable_amount_usd,vat_amount_usd,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row)
    VALUES\n${payableValues.slice(offset, offset + 400).join(',\n')}
    ON CONFLICT(source_branch,legacy_id) DO UPDATE SET
      branch_id=excluded.branch_id,supplier_id=excluded.supplier_id,supplier_code=excluded.supplier_code,
      supplier_name=excluded.supplier_name,invoice_no=excluded.invoice_no,invoice_date=excluded.invoice_date,
      due_date=excluded.due_date,term_days=excluded.term_days,taxable_amount_usd=excluded.taxable_amount_usd,
      vat_amount_usd=excluded.vat_amount_usd,total_amount_usd=excluded.total_amount_usd,
      amount_paid_usd=excluded.amount_paid_usd,outstanding_balance_usd=excluded.outstanding_balance_usd,
      status=excluded.status,source_file=excluded.source_file,source_row=excluded.source_row;`)
}

// Deleted/abandoned sale audit. No sales or stock effects are written.
const deletedValues = deletedItems.map((row) => `(${sql(row.eventKey)},${sql(row.startedAt)},${sql(row.endedAt)},${sql(row.invoiceNo)},${sql(row.referenceNo)},${sql(row.cashier)},${sql(row.billReason)},${sql(row.deletedAt)},${sql(row.deletedBy)},${sql(row.deletionReason)},${row.product?.id || 'NULL'},${sql(row.sourceName)},${sql(row.product?.name)},${sql(row.sourceCode)},${sqlNum(row.quantity)},${sqlNum(row.unitPrice)},${sql(row.discountRaw)},${sqlNum(row.total)},${sql(path.basename(files.deleted))},${row.sourceRow})`)
for (let offset = 0; offset < deletedValues.length; offset += 300) {
  statements.push(`INSERT INTO legacy_deleted_sale_items
    (event_key,event_started_at,event_ended_at,invoice_no,reference_no,cashier_name,bill_delete_reason,deleted_at,deleted_by,deletion_reason,product_id,source_product_name,product_name,source_code,quantity,unit_price_usd,discount_raw,total_usd,source_file,source_row)
    VALUES\n${deletedValues.slice(offset, offset + 300).join(',\n')}
    ON CONFLICT(source_file,source_row) DO UPDATE SET
      event_key=excluded.event_key,event_started_at=excluded.event_started_at,event_ended_at=excluded.event_ended_at,
      invoice_no=excluded.invoice_no,reference_no=excluded.reference_no,cashier_name=excluded.cashier_name,
      bill_delete_reason=excluded.bill_delete_reason,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,
      deletion_reason=excluded.deletion_reason,product_id=excluded.product_id,source_product_name=excluded.source_product_name,
      product_name=excluded.product_name,source_code=excluded.source_code,quantity=excluded.quantity,
      unit_price_usd=excluded.unit_price_usd,discount_raw=excluded.discount_raw,total_usd=excluded.total_usd;`)
}

// New expenses only; exact natural-key check protects against a rerun.
for (const row of newExpenses) {
  statements.push(`INSERT INTO fees (fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,notes,created_by,created_by_name,created_at,updated_at)
    SELECT 'expense',${sql(row.label)},0,${sqlNum(row.amountKhr)},${sql(row.date)},NULL,2,${sql(row.notes)},NULL,'Old system',${sql(row.createdAt)},${sql(row.createdAt)}
    WHERE NOT EXISTS (SELECT 1 FROM fees WHERE fee_date=${sql(row.date)} AND label=${sql(row.label)} AND amount_khr=${sqlNum(row.amountKhr)} AND COALESCE(notes,'')=COALESCE(${sql(row.notes)},''));`)
  statements.push(`UPDATE fees SET created_at=${sql(row.createdAt)},updated_at=${sql(row.createdAt)}
    WHERE fee_date=${sql(row.date)} AND label=${sql(row.label)} AND amount_khr=${sqlNum(row.amountKhr)}
      AND COALESCE(notes,'')=COALESCE(${sql(row.notes)},'') AND created_by_name='Old system';`)
}

// Transfer records and movement/effect pairs. Only #1722 mutates live stock.
for (const row of transfers.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.itemOrdinal - b.itemOrdinal)) {
  const fromBranch = norm(row.from).includes('warehouse') ? 1 : 2
  const toBranch = norm(row.to).includes('warehouse') ? 1 : 2
  const transferKey = `legacy-transfer:${row.number}:${row.itemOrdinal}`
  const isPostSnapshot = row.number === '2608001722'
  const batchId = isPostSnapshot ? row.product.opening_batch_id : null
  statements.push(`INSERT OR IGNORE INTO stock_transfers (from_branch_id,to_branch_id,product_id,product_name,quantity,notes,user_id,user_name,created_at,client_request_id)
    VALUES (${fromBranch},${toBranch},${row.product.id},${sql(row.product.name)},${sqlNum(row.quantity)},${sql(`Old-system transfer #${row.number}`)},NULL,${sql(row.doneBy || row.createdBy)},${sql(row.occurredAt)},${sql(transferKey)});`)
  statements.push(`UPDATE stock_transfers SET created_at=${sql(row.occurredAt)} WHERE client_request_id=${sql(transferKey)};`)
  statements.push(`INSERT OR IGNORE INTO legacy_inventory_effects (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at)
    VALUES (${sql(`${transferKey}:out`)},${row.product.id},${fromBranch},${batchId || 'NULL'},${isPostSnapshot ? -row.quantity : 0},${row.quantity},'transfer_out',${sql(`Old-system transfer #${row.number}`)},(SELECT id FROM stock_transfers WHERE client_request_id=${sql(transferKey)}),${sql(row.occurredAt)});`)
  statements.push(`INSERT OR IGNORE INTO legacy_inventory_effects (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at)
    VALUES (${sql(`${transferKey}:in`)},${row.product.id},${toBranch},${batchId || 'NULL'},${isPostSnapshot ? row.quantity : 0},${row.quantity},'transfer_in',${sql(`Old-system transfer #${row.number}`)},(SELECT id FROM stock_transfers WHERE client_request_id=${sql(transferKey)}),${sql(row.occurredAt)});`)
  statements.push(`UPDATE legacy_inventory_effects SET occurred_at=${sql(row.occurredAt)} WHERE source_key IN (${sql(`${transferKey}:out`)},${sql(`${transferKey}:in`)});`)
  statements.push(`UPDATE inventory_movements SET created_at=${sql(row.occurredAt)}
    WHERE reference_id=(SELECT id FROM stock_transfers WHERE client_request_id=${sql(transferKey)})
      AND movement_type IN ('transfer_out','transfer_in') AND reason=${sql(`Old-system transfer #${row.number}`)} AND user_name='Old system';`)
}

// The snapshot cutoff is receipt 4350 (Aug 28 01:46). Apply only the 59
// product units from receipts 4351-4376; delivery lines never touch stock.
for (const sale of newSaleModels) {
  for (const item of sale.items) {
    statements.push(`INSERT OR IGNORE INTO legacy_inventory_effects (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at)
      VALUES (${sql(`legacy-sale:${sale.receipt}:${item.lineOrdinal}`)},${item.product.id},2,${item.product.opening_batch_id || 'NULL'},${-item.quantity},${item.quantity},'sale',${sql(`Old-system sale ${sale.receipt}`)},(SELECT id FROM sales WHERE client_request_id=${sql(`legacy-sale:${sale.receipt}`)}),${sql(sale.createdAt)});`)
  }
  statements.push(`UPDATE legacy_inventory_effects SET occurred_at=${sql(sale.createdAt)} WHERE source_key LIKE ${sql(`legacy-sale:${sale.receipt}:%`)};`)
  statements.push(`UPDATE inventory_movements SET created_at=${sql(sale.createdAt)}
    WHERE reference_id=(SELECT id FROM sales WHERE client_request_id=${sql(`legacy-sale:${sale.receipt}`)})
      AND movement_type='sale' AND reason=${sql(`Old-system sale ${sale.receipt}`)} AND user_name='Old system';`)
}

// Apply source-backed item corrections in bounded sale-id windows. Keeping the
// window inside the ranked CTE avoids rescanning all 36k lines for every pass.
const correctionUpdateStatements = []
const jsonRefreshStatements = []
const maximumSaleId = Number(saleIdBounds.max_id || 0) + newSaleModels.length + 10
for (let low = Math.max(1, Number(saleIdBounds.min_id || 1)); low <= maximumSaleId; low += 500) {
  const high = low + 499
  correctionUpdateStatements.push(`WITH ranked AS (
    SELECT si.id, s.receipt_number,
      ROW_NUMBER() OVER (PARTITION BY si.sale_id ORDER BY si.id)-1 AS line_ordinal
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE si.sale_id BETWEEN ${low} AND ${high}
  ), patch AS (
    SELECT ranked.id,c.quantity,c.applied_price_usd,c.total_usd,c.base_price_usd,c.manual_discount_usd,c.cost_price_usd
    FROM ranked JOIN legacy_sale_item_corrections c
      ON c.receipt_number=ranked.receipt_number AND c.line_ordinal=ranked.line_ordinal
  )
  UPDATE sale_items SET
    quantity=(SELECT quantity FROM patch WHERE patch.id=sale_items.id),
    applied_price_usd=(SELECT applied_price_usd FROM patch WHERE patch.id=sale_items.id),
    total_usd=(SELECT total_usd FROM patch WHERE patch.id=sale_items.id),
    base_price_usd=(SELECT base_price_usd FROM patch WHERE patch.id=sale_items.id),
    manual_discount_type=CASE WHEN (SELECT manual_discount_usd FROM patch WHERE patch.id=sale_items.id)>0 THEN 'fixed' ELSE NULL END,
    manual_discount_value=(SELECT manual_discount_usd FROM patch WHERE patch.id=sale_items.id),
    manual_discount_usd=(SELECT manual_discount_usd FROM patch WHERE patch.id=sale_items.id),
    cost_price_usd=(SELECT cost_price_usd FROM patch WHERE patch.id=sale_items.id)
  WHERE id IN (SELECT id FROM patch);`)

  jsonRefreshStatements.push(`UPDATE sales SET items=(
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
  )
  WHERE id BETWEEN ${low} AND ${high}
    AND receipt_number IN (SELECT DISTINCT receipt_number FROM legacy_sale_item_corrections);`)
}

const outputDir = path.join(cloudflare, '.wrangler', 'tmp', 'legacy-aug30-import')
fs.mkdirSync(outputDir, { recursive: true })
for (const filename of fs.readdirSync(outputDir)) {
  if (/^(?:01-corrections|02-operational|0[2-5]-.+-\d+)\.sql$/.test(filename)) {
    fs.unlinkSync(path.join(outputDir, filename))
  }
}
// Keep each file comfortably below D1's import chunk limits. Corrections are
// idempotent staging inserts; operational statements run only after all data.
const correctionStatements = statements.filter((statement) => statement.startsWith('INSERT OR IGNORE INTO legacy_sale_item_corrections'))
const operationalStatements = statements.filter((statement) => !statement.startsWith('INSERT OR IGNORE INTO legacy_sale_item_corrections'))
const saleDateStatements = saleDateCorrections.flatMap((row) => [
  `INSERT INTO legacy_sale_date_corrections (receipt_number,previous_created_at,source_created_at,source_file) VALUES (${sql(row.receipt)},${sql(row.previousCreatedAt)},${sql(row.sourceCreatedAt)},${sql(row.sourceFile)})
    ON CONFLICT(receipt_number) DO UPDATE SET source_created_at=excluded.source_created_at,source_file=excluded.source_file,corrected_at=CURRENT_TIMESTAMP;`,
  `UPDATE sales SET created_at=${sql(row.sourceCreatedAt)},updated_at=CURRENT_TIMESTAMP WHERE receipt_number=${sql(row.receipt)};`,
])
const correctionFile = path.join(outputDir, '01-corrections.sql')
const operationalFile = path.join(outputDir, '02-operational.sql')
fs.writeFileSync(correctionFile, `${correctionStatements.join('\n\n')}\n`, 'utf8')
fs.writeFileSync(operationalFile, `${operationalStatements.join('\n\n')}\n`, 'utf8')
const phaseFiles = []
function writePhases(prefix, sourceStatements, perFile) {
  for (let offset = 0; offset < sourceStatements.length; offset += perFile) {
    const filename = path.join(outputDir, `${prefix}-${String(offset / perFile + 1).padStart(2, '0')}.sql`)
    fs.writeFileSync(filename, `${sourceStatements.slice(offset, offset + perFile).join('\n\n')}\n`, 'utf8')
    phaseFiles.push(filename)
  }
}
writePhases('02-operational', operationalStatements, 25)
writePhases('03-item-corrections', correctionUpdateStatements, 4)
writePhases('04-items-json', jsonRefreshStatements, 4)
writePhases('05-sale-dates', saleDateStatements, 30)

const summary = {
  source: {
    newReceipts: newSaleModels.length,
    newSaleLines: newSaleModels.reduce((sum, sale) => sum + sale.items.length, 0),
    newProductUnits, newProductRevenue, newDeliveryRevenue,
    overlapReceipts: overlapModels.length,
    saleItemCorrectionRows: corrections.length,
    saleDateCorrections: saleDateCorrections.length,
    transferGroups: new Set(transfers.map((row) => row.number)).size,
    transferItems: transfers.length,
    transferUnits: transfers.reduce((sum, row) => sum + row.quantity, 0),
    newExpenses: newExpenses.length,
    newExpenseKhr: newExpenses.reduce((sum, row) => sum + row.amountKhr, 0),
    payables: payables.length,
    payableTotalUsd: round(payables.reduce((sum, row) => sum + row.total, 0), 4),
    payableOutstandingUsd: round(payables.reduce((sum, row) => sum + row.outstanding, 0), 4),
    deletedEvents: new Set(deletedItems.map((row) => row.eventKey)).size,
    deletedLines: deletedItems.length,
    deletedUnits: deletedItems.reduce((sum, row) => sum + row.quantity, 0),
    deletedValueUsd: round(deletedItems.reduce((sum, row) => sum + row.total, 0), 2),
    deletedProductLinks: deletedItems.filter((row) => row.product).length,
  },
  generated: { correctionFile, operationalFile, phaseFiles },
}
console.log(JSON.stringify(summary, null, 2))

if (process.argv.includes('--apply')) {
  if (remoteCorrectionCount < corrections.length) d1File(correctionFile)
  for (const filename of phaseFiles) d1File(filename)
  const verification = queryRows(`
    SELECT 'sales_new' metric, COUNT(*) value, ROUND(COALESCE(SUM(total_usd),0),2) value2 FROM sales WHERE client_request_id LIKE 'legacy-sale:%';
    SELECT 'sale_lines_new' metric, COUNT(*) value, ROUND(COALESCE(SUM(si.quantity),0),2) value2 FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.client_request_id LIKE 'legacy-sale:%';
    SELECT 'supplier_invoices' metric, COUNT(*) value, ROUND(COALESCE(SUM(total_amount_usd),0),4) value2 FROM supplier_invoices;
    SELECT 'supplier_outstanding' metric, COUNT(*) value, ROUND(COALESCE(SUM(outstanding_balance_usd),0),4) value2 FROM supplier_invoices WHERE outstanding_balance_usd>0;
    SELECT 'deleted_events' metric, COUNT(DISTINCT event_key) value, ROUND(COALESCE(SUM(quantity),0),2) value2 FROM legacy_deleted_sale_items;
    SELECT 'deleted_lines' metric, COUNT(*) value, ROUND(COALESCE(SUM(quantity),0),2) value2 FROM legacy_deleted_sale_items;
    SELECT 'transfers' metric, COUNT(*) value, ROUND(COALESCE(SUM(quantity),0),2) value2 FROM stock_transfers WHERE client_request_id LIKE 'legacy-transfer:%';
    SELECT 'inventory_effects' metric, COUNT(*) value, ROUND(COALESCE(SUM(quantity_delta),0),2) value2 FROM legacy_inventory_effects;
    SELECT 'period_expenses' metric, COUNT(*) value, ROUND(COALESCE(SUM(amount_khr),0),2) value2 FROM fees WHERE fee_date BETWEEN '2026-08-28' AND '2026-08-30' AND created_by_name='Old system';
    SELECT 'product_stock' metric, COUNT(*) value, ROUND(COALESCE(SUM(stock_quantity),0),2) value2 FROM products WHERE is_active=1;
    SELECT 'branch_stock' metric, COUNT(*) value, ROUND(COALESCE(SUM(quantity),0),2) value2 FROM branch_stock;
    SELECT 'lot_stock' metric, COUNT(*) value, ROUND(COALESCE(SUM(bbs.quantity),0),2) value2 FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id AND pb.is_active=1;
  `)
  console.log(JSON.stringify({ verification }, null, 2))
}
