#!/usr/bin/env node
/*
 * September 1, 2026 old-system reconciliation and correction planner.
 *
 * Default is deliberately read-only: it emits a reconciliation report and
 * refuses to generate SQL if a product barcode/name or customer phone is
 * ambiguous.  Pass --apply only after that report is clean.
 *
 * Identity policy (matches productDetailRule.ts): a unique barcode is the
 * first signal; a name is only a fallback when it has one exact active match.
 * Existing sale lines retain their historical cost -- this tool never edits a
 * product cost or creates/merges product rows from a sales report.  Independent
 * stock reconciliation proved the September 1 sale effects were missing, so
 * the review SQL plans the guarded -94 unit correction plus the one missing
 * transfer.  Nothing is applied by this module; `--apply` deliberately throws.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  buildSep1CorrectionManifest,
  canonicalLegacyPhone,
  officialNameFillGuardSql,
  planVerifiedBlankOfficialNameFill,
  resolveArchivedReport,
  resolveLegacyCashier,
  resolveReviewedSep1ItemOverride,
  resolveUniqueBarcode,
} from './legacy-preflight.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const cloudflare = path.join(repo, 'cloudflare')
// The preserved migration archive lives in the repository.  Resolve it before
// considering any loose Downloads copy: a stray re-export is not source proof.
const legacyRoot = path.join(repo, 'Migration from old system')
const migrationPack = path.join(legacyRoot, 'businessos-migration-aug28')
const require = createRequire(import.meta.url)
const XLSX = require(path.join(repo, 'frontend/node_modules/xlsx'))
const files = {
  invoice: resolveArchivedReport(legacyRoot, 'report-invoice-detail-1st.xls'),
  expense: resolveArchivedReport(legacyRoot, 'report-expense-income-1st.xls'),
  productSummary: resolveArchivedReport(legacyRoot, 'report-item-new-1st.xls'),
  categorySummary: resolveArchivedReport(legacyRoot, 'report-item-new-category -1st.xls'),
  transfers: resolveArchivedReport(legacyRoot, 'stock branch transfer.xls'),
  verifiedOfficialNames: path.join(migrationPack, 'products-import-NEW-from-review.csv'),
}
for (const [label, file] of Object.entries(files)) if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`)

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const barcodeKey = (value) => digits(value).replace(/^0+(?=\d)/, '')
const phoneKey = (value) => canonicalLegacyPhone(value) || ''
const number = (value) => { const n = Number(String(value ?? '').replaceAll(',', '').trim()); return Number.isFinite(n) ? n : 0 }
const money = (value) => Number(number(value).toFixed(6))
const sql = (value) => value == null || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const sqlNum = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : '0'

function rows(file, sheet = 0) {
  const workbook = XLSX.readFile(file, { raw: true, cellDates: false })
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[sheet]], { defval: '', raw: true })
}
function sourceBarcode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  return String(value ?? '').trim()
}
function legacyToUtc(value) {
  const raw = String(value ?? '').trim().replace('T', ' ')
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s*(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) throw new Error(`Unsupported legacy time: ${raw}`)
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4] - 7, +match[5], +(match[6] || 0))).toISOString()
}
function d1(command) {
  const result = spawnSync(process.execPath, ['scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', 'business-os', '--remote', '--json', '--command', command], { cwd: cloudflare, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'D1 query failed')
  return JSON.parse(result.stdout).flatMap((entry) => entry.results || [])
}
const legacyEffectColumns = new Set(d1('PRAGMA table_info(legacy_inventory_effects)').map((row) => String(row.name)))
const legacyEffectCostSelect = legacyEffectColumns.has('unit_cost_usd') && legacyEffectColumns.has('unit_cost_khr')
  ? 'unit_cost_usd,unit_cost_khr'
  : 'NULL AS unit_cost_usd,NULL AS unit_cost_khr'
const products = d1(`SELECT p.id,p.name,p.barcode,p.sku,p.category,p.brand,p.unit,p.supplier,p.stock_quantity,
  p.cost_price_usd,p.cost_price_khr,p.description,
  (SELECT pb.id FROM product_batches pb WHERE pb.variant_product_id=p.id AND pb.is_active=1
    AND pb.notes='Received via product import' ORDER BY pb.id LIMIT 1) AS opening_batch_id
  FROM products p WHERE p.is_active=1 ORDER BY p.id`)
const productSupplierLinks = d1(`SELECT pb.variant_product_id AS product_id,s.id AS supplier_id,s.name AS supplier_name
  FROM product_batches pb JOIN suppliers s ON s.id=pb.supplier_id
  WHERE pb.is_active=1 AND pb.supplier_id IS NOT NULL
  GROUP BY pb.variant_product_id,s.id,s.name ORDER BY pb.variant_product_id,s.id`)
const customers = d1('SELECT id,name,phone,phone_normalized FROM customers ORDER BY id')
const users = d1('SELECT id,username,name FROM users ORDER BY id')
const existingSep1Sales = d1(`SELECT id,receipt_number,client_request_id,payment_method,amount_paid_usd,total_usd,customer_id,customer_name,customer_phone,created_at,notes
  FROM sales WHERE receipt_number LIKE '004%@2026-09-01' ORDER BY receipt_number`)
const existingSep1SaleItems = d1(`SELECT s.receipt_number,si.product_id,si.product_name,si.quantity,si.cost_price_usd,si.applied_price_usd,si.total_usd
  FROM sales s JOIN sale_items si ON si.sale_id=s.id WHERE s.receipt_number LIKE '004%@2026-09-01'`)
const reviewedOverrideSaleItems = d1(`SELECT s.receipt_number,si.product_id,si.product_name,si.cost_price_usd
  FROM sales s JOIN sale_items si ON si.sale_id=s.id
  WHERE s.receipt_number IN ('004413@2026-09-01','004411@2026-09-01')`)
const existingTransfers = d1(`SELECT id,client_request_id,from_branch_id,to_branch_id,product_id,product_name,quantity,user_id,user_name,created_at,notes
  FROM stock_transfers WHERE id=43 OR client_request_id IN ('legacy-transfer:2608001722:0','legacy-transfer:2609001723:0','legacy-transfer:2609001724:0')`)
const existingTransferEffects = d1(`SELECT source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at,${legacyEffectCostSelect}
  FROM legacy_inventory_effects WHERE source_key LIKE 'legacy-transfer:2608001722:0:%'
    OR source_key LIKE 'legacy-transfer:2609001723:0:%' OR source_key LIKE 'legacy-transfer:2609001724:0:%' OR reference_id=43`)
const byBarcode = new Map(), byName = new Map(), byPhone = new Map()
const supplierOptionsByProduct = new Map()
for (const link of productSupplierLinks) {
  const productId = Number(link.product_id)
  ;(supplierOptionsByProduct.get(productId) || supplierOptionsByProduct.set(productId, []).get(productId))
    .push({ id: Number(link.supplier_id), name: String(link.supplier_name || '').trim() })
}
for (const product of products) {
  const key = barcodeKey(product.barcode)
  if (key && key !== '0') (byBarcode.get(key) || byBarcode.set(key, []).get(key)).push(product)
  const name = norm(product.name); if (name) (byName.get(name) || byName.set(name, []).get(name)).push(product)
}
for (const customer of customers) {
  const key = phoneKey(customer.phone_normalized || customer.phone)
  if (key) (byPhone.get(key) || byPhone.set(key, []).get(key)).push(customer)
}
const salesByReceipt = new Map(existingSep1Sales.map((sale) => [String(sale.receipt_number), sale]))
const saleItemsByReceipt = new Map()
for (const item of existingSep1SaleItems) {
  const key = String(item.receipt_number)
  ;(saleItemsByReceipt.get(key) || saleItemsByReceipt.set(key, []).get(key)).push(item)
}

const invoiceRows = rows(files.invoice).filter((row) => String(row['Invoice No'] || '').trim())
// The report title/filter occupies Sheet1; the actual tabular export is Sheet2.
const productSummaryRows = rows(files.productSummary, 1)
  .filter((row) => String(row.Product || '').trim())
const productSummaryByBarcode = new Map()
const productSummaryByName = new Map()
for (const row of productSummaryRows) {
  const code = barcodeKey(sourceBarcode(row.Code))
  const name = norm(row.Product)
  if (code) (productSummaryByBarcode.get(code) || productSummaryByBarcode.set(code, []).get(code)).push(row)
  if (name) (productSummaryByName.get(name) || productSummaryByName.set(name, []).get(name)).push(row)
}
const verifiedOfficialRows = rows(files.verifiedOfficialNames)
const officialNameFill = planVerifiedBlankOfficialNameFill(verifiedOfficialRows, products)
const grouped = new Map()
for (const row of invoiceRows) {
  const invoice = String(row['Invoice No']).trim()
  if (!grouped.has(invoice)) grouped.set(invoice, [])
  grouped.get(invoice).push(row)
}
const failures = []
const receipts = []
const reviewedOverrides = []
for (const [invoice, lines] of grouped) {
  const first = lines[0]
  // "Delivery service" is a charge, not inventory. Treating it as a
  // product would create a fake product/stock movement and make reconciliation
  // fail even though its amount is included in the invoice grand total.
  const deliveryLines = lines.filter((line) => norm(line.Product) === 'delivery service')
  const productLines = lines.filter((line) => norm(line.Product) !== 'delivery service')
  const items = productLines.map((line, ordinal) => {
    const code = sourceBarcode(line.Code)
    const barcodeMatches = barcodeKey(code) ? (byBarcode.get(barcodeKey(code)) || []) : []
    const nameMatches = byName.get(norm(line.Product)) || []
    // A shared barcode is evidence of a collision, not permission to choose
    // a candidate by cost or legacy spelling. Quarantine it for review.
    const barcodeResolution = resolveUniqueBarcode(code, barcodeMatches)
    const reviewedOverride = barcodeResolution.status === 'quarantined_duplicate_barcode'
      ? resolveReviewedSep1ItemOverride({
        invoice,
        barcode: code,
        sourceName: String(line.Product || '').trim(),
        sourceCostUsd: number(line.Cost),
        candidates: barcodeMatches,
        existingSaleItems: reviewedOverrideSaleItems,
      })
      : { status: 'not_needed', product: null }
    const product = barcodeResolution.status === 'resolved' ? barcodeResolution.product
      : reviewedOverride.status === 'reviewed_override_confirmed' ? reviewedOverride.product
      : (!barcodeMatches.length && nameMatches.length === 1 ? nameMatches[0] : null)
    if (reviewedOverride.status === 'reviewed_override_confirmed') reviewedOverrides.push({ invoice, code, productId: product.id, productName: product.name, sourceCostUsd: number(line.Cost), guard: 'invoice+barcode+exact-name+historical-cost+existing-live-sale' })
    if (!product) failures.push({
      type: barcodeResolution.status === 'quarantined_duplicate_barcode' ? reviewedOverride.status : 'unmatched_product',
      invoice,
      product: line.Product,
      code,
      barcodeCandidates: barcodeResolution.candidateIds || barcodeMatches.map((p) => p.id),
      nameCandidates: nameMatches.map((p) => p.id),
    })
    const quantity = number(line.Qty)
    // The product summary is older and its display name may legitimately differ.
    // Join it by barcode first, then use an exact normalized name only when the
    // sale line has no barcode. Never use a fuzzy name to infer a supplier.
    const summaryMatches = barcodeKey(code)
      ? (productSummaryByBarcode.get(barcodeKey(code)) || [])
      : (productSummaryByName.get(norm(line.Product)) || [])
    const summarySuppliers = [...new Set(summaryMatches.map((row) => String(row.Supplier || '').trim()).filter(Boolean))]
    return {
      ordinal,
      product,
      sourceName: String(line.Product || '').trim(),
      sourceCode: code,
      sourceCategory: String(line.Category || '').trim() || null,
      sourceSupplier: summarySuppliers.length === 1 ? summarySuppliers[0] : null,
      sourceSupplierCandidates: summarySuppliers.length > 1 ? summarySuppliers : [],
      currentSupplierOptions: product ? (supplierOptionsByProduct.get(Number(product.id)) || []) : [],
      quantity,
      total: money(line.Total),
      cost: money(line.Cost),
      base: money(line.Price),
      discount: money(line.Discount),
      applied: quantity ? money(number(line.Total) / quantity) : 0,
    }
  })
  const phoneMatches = phoneKey(first.Phone) ? (byPhone.get(phoneKey(first.Phone)) || []) : []
  if (phoneMatches.length > 1) failures.push({ type: 'ambiguous_customer_phone', invoice, phone: String(first.Phone), candidates: phoneMatches.map((c) => c.id) })
  const timestamp = first['Check-out Time'] || first['Check-in Time']
  const receipt = `${invoice}@2026-09-01`
  const total = money(first['Grand Total'])
  const creditUsd = money(first.Credit)
  if (creditUsd < 0 || creditUsd > total + 0.01) failures.push({ type: 'invalid_credit_amount', invoice, total, creditUsd })
  const rawPayment = String(first['Payment method'] || '').trim()
  const payment = creditUsd > 0 ? 'Credit' : 'ABA'
  if (creditUsd === 0 && rawPayment !== 'ABA') failures.push({ type: 'expected_aba_payment_missing', invoice, rawPayment })
  receipts.push({ invoice, receipt, createdAt: legacyToUtc(timestamp), items, customer: phoneMatches.length === 1 ? phoneMatches[0] : null, customerName: String(first.Customer || '').trim() || null, customerPhone: String(first.Phone || '').trim() || null, payment, rawPayment, rate: number(first['Exchange - KHR']) || 4050, delivery: String(first['Delivery Service'] || '').trim(), deliveryFee: money(deliveryLines.reduce((sum, line) => sum + number(line.Total), 0)), total, subtotal: money(items.reduce((sum, item) => sum + item.total, 0)), creditUsd, amountPaidUsd: money(total - creditUsd) })
}
// Reconciliation-only policy: every Sep-1 receipt and its items already
// exist. Refuse to generate an INSERT path, because INSERT OR IGNORE would
// preserve stale all-paid headers and could conceal a partial prior import.
for (const sale of receipts) {
  const existing = salesByReceipt.get(sale.receipt)
  const items = saleItemsByReceipt.get(sale.receipt) || []
  const expectedRequestId = `legacy-sale:${sale.receipt}`
  if (!existing || String(existing.client_request_id) !== expectedRequestId || String(existing.created_at) !== sale.createdAt || Math.abs(number(existing.total_usd) - sale.total) > 0.00001) {
    failures.push({ type: 'missing_or_changed_existing_sale', receipt: sale.receipt })
    continue
  }
  if (items.length !== sale.items.length || Math.abs(items.reduce((sum, item) => sum + number(item.quantity), 0) - sale.items.reduce((sum, item) => sum + item.quantity, 0)) > 0.00001) failures.push({ type: 'existing_sale_items_mismatch', receipt: sale.receipt })
  const sourceItemSignatures = sale.items.map((item) => `${item.product.id}|${money(item.quantity)}|${money(item.cost)}|${money(item.applied)}|${money(item.total)}`).sort()
  const liveItemSignatures = items.map((item) => `${Number(item.product_id)}|${money(item.quantity)}|${money(item.cost_price_usd)}|${money(item.applied_price_usd)}|${money(item.total_usd)}`).sort()
  if (JSON.stringify(sourceItemSignatures) !== JSON.stringify(liveItemSignatures)) failures.push({
    type: 'existing_sale_item_identity_cost_total_mismatch',
    receipt: sale.receipt,
    sourceItemSignatures,
    liveItemSignatures,
  })
  if (sale.creditUsd > 0 && Math.abs(number(existing.amount_paid_usd) - sale.total) > 0.00001) failures.push({ type: 'credit_sale_not_in_expected_all_paid_state', receipt: sale.receipt })
  if (sale.creditUsd === 0 && (String(existing.payment_method) !== 'ABA' || Math.abs(number(existing.amount_paid_usd) - sale.total) > 0.00001)) failures.push({ type: 'paid_aba_sale_changed', receipt: sale.receipt })
  sale.existing = existing
}
if (receipts.filter((sale) => sale.creditUsd === 0).length !== 3) failures.push({ type: 'expected_exactly_three_aba_sales', actual: receipts.filter((sale) => sale.creditUsd === 0).length })
const newCustomerPlans = []
for (const [phone, sales] of new Map(receipts.filter((sale) => sale.customerPhone && !sale.customer).map((sale) => [phoneKey(sale.customerPhone), receipts.filter((candidate) => phoneKey(candidate.customerPhone) === phoneKey(sale.customerPhone) && !candidate.customer)])).entries()) {
  if (!phone) continue
  const names = [...new Set(sales.map((sale) => norm(sale.customerName)).filter(Boolean))]
  if (names.length !== 1) { failures.push({ type: 'conflicting_customer_names_for_phone', phone, names }); continue }
  newCustomerPlans.push({ phone, name: sales[0].customerName, receipts: sales.map((sale) => sale.receipt) })
}
if (newCustomerPlans.length !== 7) failures.push({ type: 'expected_seven_unique_phone_customers', actual: newCustomerPlans.length })
const expenseRows = rows(files.expense, 1).filter((row) => /^2026-09-01/.test(String(row.Date)) && number(row['Riel (KHR)']) > 0).map((row) => {
  const category = String(row.Category || '').trim()
  return {
    date: '2026-09-01',
    createdAt: legacyToUtc(row.Date),
    label: category.split('/').map((s) => s.trim()).filter(Boolean).at(-1) || 'no_category',
    feeType: /^delivery(?:\s*\/|$)/i.test(category) ? 'delivery' : 'expense',
    notes: String(row.Description || '').trim() || null,
    khr: money(row['Riel (KHR)']),
  }
})
const transfers = []
let activeTransfer = null
for (const row of rows(files.transfers)) {
  const first = String(row['Item Code'] || '').trim()
  if (first.startsWith('Created By:')) {
    const match = first.match(/^Created By:(.*?)Date:(\d{4}-\d{2}-\d{2}\d{2}:\d{2})From Branch:(.*?)Done By:(.*?)Done Date:(\d{4}-\d{2}-\d{2}\d{2}:\d{2})To Branch:(.*?)Transfer #:(\S+)$/)
    if (!match) {
      failures.push({ type: 'unparseable_transfer_header', header: first })
      activeTransfer = null
      continue
    }
    const [, createdBy, , from, doneBy, doneAt, to, number] = match
    const cashier = resolveLegacyCashier(doneBy, users)
    if (cashier.status !== 'resolved') failures.push({ type: 'unresolved_transfer_cashier', transfer: number, cashier })
    const branchId = (value) => norm(value).includes('warehouse') ? 1 : (norm(value).includes('shop') ? 2 : null)
    const fromBranchId = branchId(from), toBranchId = branchId(to)
    if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) failures.push({ type: 'invalid_transfer_branches', transfer: number, from, to })
    activeTransfer = { number, createdBy, doneBy, cashier, from, to, fromBranchId, toBranchId, occurredAt: legacyToUtc(doneAt.replace(/^(\d{4}-\d{2}-\d{2})(\d{2}:)/, '$1 $2')), ordinal: 0 }
    continue
  }
  if (!activeTransfer || !first) continue
  const barcodeMatches = byBarcode.get(barcodeKey(first)) || []
  const resolved = resolveUniqueBarcode(first, barcodeMatches)
  if (resolved.status !== 'resolved') {
    failures.push({ type: 'quarantined_transfer_barcode', transfer: activeTransfer.number, code: first, candidates: resolved.candidateIds || [] })
    continue
  }
  const quantity = number(row.Qty)
  if (quantity <= 0) { failures.push({ type: 'invalid_transfer_quantity', transfer: activeTransfer.number, code: first, quantity }); continue }
  if (!resolved.product.opening_batch_id) failures.push({ type: 'missing_transfer_opening_batch', transfer: activeTransfer.number, productId: resolved.product.id })
  transfers.push({ ...activeTransfer, ordinal: activeTransfer.ordinal++, product: resolved.product, quantity })
}
const transferPlans = []
function hasExactTransferEffects(effects, transfer, sourceKey, referenceId) {
  const expected = [
    { key: `${sourceKey}:out`, branchId: transfer.fromBranchId, delta: -transfer.quantity, type: 'transfer_out' },
    { key: `${sourceKey}:in`, branchId: transfer.toBranchId, delta: transfer.quantity, type: 'transfer_in' },
  ]
  return effects.length === expected.length && expected.every((candidate) => effects.some((effect) =>
    String(effect.source_key) === candidate.key
    && Number(effect.product_id) === Number(transfer.product.id)
    && Number(effect.branch_id) === Number(candidate.branchId)
    && Number(effect.batch_id) === Number(transfer.product.opening_batch_id)
    && money(effect.quantity_delta) === money(candidate.delta)
    && money(effect.movement_quantity) === money(transfer.quantity)
    && String(effect.movement_type) === candidate.type
    && String(effect.reason || '') === `Old-system transfer #${transfer.number}`
    && effect.unit_cost_usd == null
    && effect.unit_cost_khr == null
    && Number(effect.reference_id) === Number(referenceId)
    && String(effect.occurred_at) === transfer.occurredAt
  ))
}
for (const transfer of transfers) {
  const sourceKey = `legacy-transfer:${transfer.number}:${transfer.ordinal}`
  if (transfer.number === '2608001722') {
    const existing = existingTransfers.find((row) => String(row.client_request_id) === sourceKey)
    const effects = existingTransferEffects.filter((effect) => String(effect.source_key).startsWith(`${sourceKey}:`))
    if (!existing || Number(existing.product_id) !== transfer.product.id || number(existing.quantity) !== transfer.quantity || !hasExactTransferEffects(effects, transfer, sourceKey, existing.id)) failures.push({ type: 'transfer_1722_not_already_applied_exactly_once', sourceKey })
    else transferPlans.push({ mode: 'already_applied_noop', transfer, existingId: existing.id, existingUserId: existing.user_id, existingUserName: existing.user_name, additionalStockDelta: 0 })
    continue
  }
  if (transfer.number === '2609001723') {
    const existing = existingTransfers.find((row) => Number(row.id) === 43 || String(row.client_request_id) === sourceKey)
    const effects = existingTransferEffects.filter((effect) => Number(effect.reference_id) === 43)
    const commonIdentity = existing && Number(existing.from_branch_id) === transfer.fromBranchId && Number(existing.to_branch_id) === transfer.toBranchId && Number(existing.product_id) === transfer.product.id && number(existing.quantity) === transfer.quantity && effects.length === 0
    const staleImportState = commonIdentity && existing.client_request_id == null && Number(existing.id) === 43 && Number(existing.user_id) === 2
    const linkedCanonicalState = commonIdentity && String(existing.client_request_id) === sourceKey && Number(existing.user_id) === Number(transfer.cashier.user.id) && norm(existing.user_name) === norm(transfer.cashier.user.name)
    if (!staleImportState && !linkedCanonicalState) failures.push({ type: 'transfer_1723_existing_identity_mismatch', sourceKey })
    else if (linkedCanonicalState) transferPlans.push({ mode: 'already_linked_no_stock_effect', transfer, existingId: existing.id, additionalStockDelta: 0 })
    else transferPlans.push({ mode: 'link_existing_no_stock_effect', transfer, existingId: existing.id, existingUserId: existing.user_id, existingUserName: existing.user_name, sourceActor: transfer.cashier.canonical, additionalStockDelta: 0 })
    continue
  }
  if (transfer.number === '2609001724') {
    const existing = existingTransfers.find((row) => String(row.client_request_id) === sourceKey)
    const effects = existingTransferEffects.filter((effect) => String(effect.source_key).startsWith(`${sourceKey}:`))
    if (!existing) transferPlans.push({ mode: 'create_with_effects', transfer, additionalStockDelta: 0 })
    else if (Number(existing.from_branch_id) === transfer.fromBranchId && Number(existing.to_branch_id) === transfer.toBranchId && Number(existing.product_id) === transfer.product.id && number(existing.quantity) === transfer.quantity && Number(existing.user_id) === Number(transfer.cashier.user.id) && norm(existing.user_name) === norm(transfer.cashier.user.name) && hasExactTransferEffects(effects, transfer, sourceKey, existing.id)) transferPlans.push({ mode: 'already_applied_noop', transfer, existingId: existing.id, existingUserId: existing.user_id, existingUserName: existing.user_name, additionalStockDelta: 0 })
    else failures.push({ type: 'transfer_1724_unexpected_existing', sourceKey, existingId: existing.id })
    continue
  }
  failures.push({ type: 'unexpected_transfer_number', sourceKey })
}
const inventoryEffectPlan = [
  ...receipts.flatMap((sale) => sale.items.map((item) => ({
    sourceKey: `legacy-sale:${sale.receipt}:${item.ordinal}`,
    productId: Number(item.product.id),
    branchId: 2,
    batchId: Number(item.product.opening_batch_id),
    quantityDelta: -item.quantity,
    movementQuantity: item.quantity,
    movementType: 'sale',
    reason: `Old-system sale ${sale.receipt}`,
    unitCostUsd: item.cost,
    unitCostKhr: 0,
    referenceId: Number(sale.existing.id),
    referenceTransferKey: null,
    occurredAt: sale.createdAt,
    sequence: 2,
  }))),
  ...transferPlans.filter((plan) => plan.mode === 'create_with_effects').flatMap((plan) => {
    const transfer = plan.transfer
    const transferKey = `legacy-transfer:${transfer.number}:${transfer.ordinal}`
    return [
      {
        sourceKey: `${transferKey}:out`, productId: Number(transfer.product.id), branchId: Number(transfer.fromBranchId), batchId: Number(transfer.product.opening_batch_id),
        quantityDelta: -transfer.quantity, movementQuantity: transfer.quantity, movementType: 'transfer_out', reason: `Old-system transfer #${transfer.number}`,
        unitCostUsd: null, unitCostKhr: null, referenceId: null, referenceTransferKey: transferKey, occurredAt: transfer.occurredAt, sequence: 0,
      },
      {
        sourceKey: `${transferKey}:in`, productId: Number(transfer.product.id), branchId: Number(transfer.toBranchId), batchId: Number(transfer.product.opening_batch_id),
        quantityDelta: transfer.quantity, movementQuantity: transfer.quantity, movementType: 'transfer_in', reason: `Old-system transfer #${transfer.number}`,
        unitCostUsd: null, unitCostKhr: null, referenceId: null, referenceTransferKey: transferKey, occurredAt: transfer.occurredAt, sequence: 1,
      },
    ]
  }),
].sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || a.sequence - b.sequence || a.sourceKey.localeCompare(b.sourceKey))

const effectProductIds = [...new Set(inventoryEffectPlan.map((effect) => effect.productId))]
const effectBatchIds = [...new Set(inventoryEffectPlan.map((effect) => effect.batchId).filter(Boolean))]
const effectSourceKeys = inventoryEffectPlan.map((effect) => effect.sourceKey)
const effectBranchStock = effectProductIds.length
  ? d1(`SELECT product_id,branch_id,quantity FROM branch_stock WHERE product_id IN (${effectProductIds.join(',')})`)
  : []
const effectBatchStock = effectBatchIds.length
  ? d1(`SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE batch_id IN (${effectBatchIds.join(',')})`)
  : []
const existingPlannedEffects = effectSourceKeys.length
  ? d1(`SELECT source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at,${legacyEffectCostSelect} FROM legacy_inventory_effects WHERE source_key IN (${effectSourceKeys.map(sql).join(',')})`)
  : []
const existingPlannedEffectByKey = new Map(existingPlannedEffects.map((row) => [String(row.source_key), row]))
const productQuantity = new Map(products.map((product) => [Number(product.id), number(product.stock_quantity)]))
const branchQuantity = new Map(effectBranchStock.map((row) => [`${row.product_id}:${row.branch_id}`, number(row.quantity)]))
const batchQuantity = new Map(effectBatchStock.map((row) => [`${row.batch_id}:${row.branch_id}`, number(row.quantity)]))
const stockAvailabilityEvents = []
for (const effect of inventoryEffectPlan) {
  const productKey = effect.productId
  const branchKey = `${effect.productId}:${effect.branchId}`
  const batchKey = `${effect.batchId}:${effect.branchId}`
  const before = {
    product: productQuantity.get(productKey) || 0,
    branch: branchQuantity.get(branchKey) || 0,
    batch: batchQuantity.get(batchKey) || 0,
  }
  const existingEffect = existingPlannedEffectByKey.get(effect.sourceKey)
  if (existingEffect) {
    const expectedReferenceId = effect.referenceTransferKey
      ? Number(existingTransfers.find((transfer) => String(transfer.client_request_id) === effect.referenceTransferKey)?.id || 0)
      : Number(effect.referenceId)
    const identityMatches = Number(existingEffect.product_id) === effect.productId
      && Number(existingEffect.branch_id) === effect.branchId
      && (existingEffect.batch_id == null ? null : Number(existingEffect.batch_id)) === (effect.batchId || null)
      && money(existingEffect.quantity_delta) === money(effect.quantityDelta)
      && money(existingEffect.movement_quantity) === money(effect.movementQuantity)
      && String(existingEffect.movement_type) === effect.movementType
      && String(existingEffect.reason || '') === effect.reason
      && (existingEffect.unit_cost_usd == null ? null : money(existingEffect.unit_cost_usd)) === (effect.unitCostUsd == null ? null : money(effect.unitCostUsd))
      && (existingEffect.unit_cost_khr == null ? null : money(existingEffect.unit_cost_khr)) === (effect.unitCostKhr == null ? null : money(effect.unitCostKhr))
      && Number(existingEffect.reference_id || 0) === expectedReferenceId
      && String(existingEffect.occurred_at) === effect.occurredAt
    if (!identityMatches) failures.push({ type: 'existing_inventory_effect_identity_mismatch', sourceKey: effect.sourceKey, expected: effect, actual: existingEffect })
    stockAvailabilityEvents.push({ sourceKey: effect.sourceKey, occurredAt: effect.occurredAt, status: identityMatches ? 'already_applied' : 'existing_identity_mismatch', before, after: before })
    continue
  }
  const after = {
    product: money(before.product + effect.quantityDelta),
    branch: money(before.branch + effect.quantityDelta),
    batch: money(before.batch + effect.quantityDelta),
  }
  const safe = effect.quantityDelta >= 0 || (after.product >= 0 && after.branch >= 0 && (!effect.batchId || after.batch >= 0))
  stockAvailabilityEvents.push({ sourceKey: effect.sourceKey, occurredAt: effect.occurredAt, status: safe ? 'safe' : 'would_go_negative', before, after })
  if (!safe) failures.push({ type: 'stock_effect_sequence_would_go_negative', sourceKey: effect.sourceKey, occurredAt: effect.occurredAt, before, quantityDelta: effect.quantityDelta, after })
  productQuantity.set(productKey, after.product)
  branchQuantity.set(branchKey, after.branch)
  if (effect.batchId) batchQuantity.set(batchKey, after.batch)
}
const stockAvailabilityPreflight = {
  basis: 'current remote product, branch and active opening-batch quantities; planned effects applied in occurred_at order',
  safe: stockAvailabilityEvents.every((event) => event.status !== 'would_go_negative' && event.status !== 'existing_identity_mismatch'),
  eventCount: stockAvailabilityEvents.length,
  alreadyAppliedCount: stockAvailabilityEvents.filter((event) => event.status === 'already_applied').length,
  events: stockAvailabilityEvents,
}
const source = { receipts: receipts.length, lines: receipts.reduce((sum, receipt) => sum + receipt.items.length, 0), units: money(receipts.flatMap((r) => r.items).reduce((sum, item) => sum + item.quantity, 0)), revenueUsd: money(receipts.reduce((sum, r) => sum + r.total, 0)), expenses: expenseRows.length, expenseKhr: money(expenseRows.reduce((sum, row) => sum + row.khr, 0)) }
if (source.receipts !== 29 || source.lines !== 56 || source.units !== 94 || source.revenueUsd !== 2699 || receipts.reduce((sum, sale) => sum + sale.amountPaidUsd, 0) !== 205 || receipts.reduce((sum, sale) => sum + sale.creditUsd, 0) !== 2494) failures.push({ type: 'sep1_source_totals_mismatch', source })
const correctionManifest = buildSep1CorrectionManifest({ receipts, transfers: transferPlans.filter((plan) => plan.mode === 'create_with_effects').map((plan) => plan.transfer), reviewedOverrides, sourceFiles: Object.values(files).map((file) => path.relative(repo, file)) })
correctionManifest.invariants.stockAvailabilitySequenceSafe = stockAvailabilityPreflight.safe
correctionManifest.invariants.historicalSaleMovementCostUsd = money(inventoryEffectPlan.filter((effect) => effect.movementType === 'sale').reduce((sum, effect) => sum + effect.movementQuantity * effect.unitCostUsd, 0))
correctionManifest.requiresMigrations = ['0101_legacy_inventory_effect_historical_cost.sql']
correctionManifest.inventoryEffectOrder = inventoryEffectPlan.map((effect) => ({ sourceKey: effect.sourceKey, occurredAt: effect.occurredAt, movementType: effect.movementType, quantityDelta: effect.quantityDelta }))
const mappedItems = receipts.flatMap((receipt) => receipt.items.map((item) => ({ receipt: receipt.receipt, ...item })))
function summarizeReferenceTransitions(fromField, toField) {
  const grouped = new Map()
  for (const item of mappedItems) {
    const sourceValue = String(item[fromField] || '').trim()
    const currentValue = String(item.product?.[toField] || '').trim()
    if (!sourceValue && !currentValue) continue
    const key = `${sourceValue}\u0000${currentValue}`
    const existing = grouped.get(key) || { source: sourceValue || null, current: currentValue || null, lines: 0, units: 0, productIds: new Set() }
    existing.lines += 1
    existing.units += item.quantity
    if (item.product?.id) existing.productIds.add(item.product.id)
    grouped.set(key, existing)
  }
  return [...grouped.values()]
    .map((entry) => ({ ...entry, units: money(entry.units), productIds: [...entry.productIds].sort((a, b) => a - b) }))
    .sort((a, b) => (b.lines - a.lines) || String(a.source).localeCompare(String(b.source)) || String(a.current).localeCompare(String(b.current)))
}
const referenceDataEvidence = {
  note: 'Evidence only. Source-to-current wording changes are derived from barcode-first resolved product links; they are not fuzzy merge instructions. A supplier transition requires a legacy product-summary supplier and a current active-batch supplier.',
  categories: summarizeReferenceTransitions('sourceCategory', 'category'),
  suppliers: (() => {
    const grouped = new Map()
    for (const item of mappedItems) {
      const sourceValue = String(item.sourceSupplier || '').trim()
      const options = Array.isArray(item.currentSupplierOptions) ? item.currentSupplierOptions : []
      const exact = options.find((option) => norm(option.name) === norm(sourceValue))
      const current = exact || (sourceValue && options.length === 1 ? options[0] : null)
      if (!sourceValue || !current) continue
      const key = `${sourceValue}\u0000${current?.id || ''}`
      const existing = grouped.get(key) || { source: sourceValue || null, current: current?.name || null, currentSupplierId: current?.id || null, lines: 0, units: 0, productIds: new Set() }
      existing.lines += 1
      existing.units += item.quantity
      if (item.product?.id) existing.productIds.add(item.product.id)
      grouped.set(key, existing)
    }
    return [...grouped.values()]
      .map((entry) => ({ ...entry, units: money(entry.units), productIds: [...entry.productIds].sort((a, b) => a - b) }))
      .sort((a, b) => (b.lines - a.lines) || String(a.source).localeCompare(String(b.source)))
  })(),
  currentBatchSupplierLinks: (() => {
    const grouped = new Map()
    for (const item of mappedItems) {
      if (item.sourceSupplier) continue
      const options = Array.isArray(item.currentSupplierOptions) ? item.currentSupplierOptions : []
      if (options.length !== 1) continue
      const current = options[0]
      const key = String(current.id)
      const existing = grouped.get(key) || { current: current.name, currentSupplierId: current.id, lines: 0, units: 0, productIds: new Set() }
      existing.lines += 1
      existing.units += item.quantity
      if (item.product?.id) existing.productIds.add(item.product.id)
      grouped.set(key, existing)
    }
    return [...grouped.values()]
      .map((entry) => ({ ...entry, units: money(entry.units), productIds: [...entry.productIds].sort((a, b) => a - b) }))
      .sort((a, b) => (b.lines - a.lines) || String(a.current).localeCompare(String(b.current)))
  })(),
  currentUnits: summarizeReferenceTransitions('__sourceUnitUnavailable', 'unit'),
  currentBrands: summarizeReferenceTransitions('__sourceBrandUnavailable', 'brand'),
  sourceSupplierAmbiguities: mappedItems
    .filter((item) => item.sourceSupplierCandidates.length || (item.currentSupplierOptions.length > 1 && !item.currentSupplierOptions.some((option) => norm(option.name) === norm(item.sourceSupplier))))
    .map((item) => ({ receipt: item.receipt, sourceCode: item.sourceCode, sourceName: item.sourceName, sourceSupplierCandidates: item.sourceSupplierCandidates, currentSupplierOptions: item.currentSupplierOptions })),
  supplierEvidenceGaps: mappedItems
    .filter((item) => !item.sourceSupplier || item.currentSupplierOptions.length === 0)
    .map((item) => ({
      receipt: item.receipt,
      sourceCode: item.sourceCode,
      sourceName: item.sourceName,
      productId: item.product?.id || null,
      status: !item.sourceSupplier && item.currentSupplierOptions.length === 0
        ? 'missing_legacy_and_current_supplier'
        : !item.sourceSupplier
          ? 'missing_legacy_supplier'
          : 'missing_current_active_batch_supplier',
      sourceSupplier: item.sourceSupplier,
      currentSupplierOptions: item.currentSupplierOptions,
    })),
}
const report = { source: { ...source, transfers: transfers.length, transferUnits: money(transfers.reduce((sum, transfer) => sum + transfer.quantity, 0)) }, failures, reviewedOverrides, transferPlans, newCustomerPlans, officialNameFill, correctionManifest, stockAvailabilityPreflight, referenceDataEvidence, customerLinks: receipts.filter((r) => r.customer).length, unmatchedCustomersWithPhone: receipts.filter((r) => r.customerPhone && !r.customer).length, receipts: receipts.map((r) => ({ invoice: r.invoice, receipt: r.receipt, items: r.items.length, total: r.total, creditUsd: r.creditUsd, amountPaidUsd: r.amountPaidUsd, customerId: r.customer?.id || null })) }
const outputDir = path.join(cloudflare, '.wrangler', 'tmp', 'legacy-sep01-import')
fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(path.join(outputDir, 'reconciliation.json'), JSON.stringify(report, null, 2))
if (failures.length) { console.log(JSON.stringify({ ...report, status: 'blocked', outputDir }, null, 2)); process.exitCode = 2; process.exit() }

if (!correctionManifest.invariants.uniqueIdempotencyKeys || !correctionManifest.invariants.stockAvailabilitySequenceSafe) {
  throw new Error('Refusing to generate correction SQL: manifest invariant failed')
}

const statements = []
// Link only unique phone evidence.  Phone-less invoices deliberately receive
// no generated customer update: a name is never an identity key here.
for (const plan of newCustomerPlans) {
  statements.push(`INSERT INTO customers (name,phone,phone_normalized,notes,created_at,updated_at) SELECT ${sql(plan.name)},${sql(plan.phone)},${sql(plan.phone)},${sql('Created by Sep-1 legacy reconciliation')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone_normalized=${sql(plan.phone)});`)
  for (const receipt of plan.receipts) {
    const sale = receipts.find((candidate) => candidate.receipt === receipt)
    statements.push(`UPDATE sales SET customer_id=(SELECT id FROM customers WHERE phone_normalized=${sql(plan.phone)} LIMIT 1), customer_phone=${sql(plan.phone)} WHERE receipt_number=${sql(sale.receipt)} AND client_request_id=${sql(`legacy-sale:${sale.receipt}`)} AND created_at=${sql(sale.createdAt)} AND total_usd=${sqlNum(sale.total)} AND customer_id IS NULL AND COALESCE(customer_phone,'')=${sql(sale.customerPhone)};`)
  }
}
for (const sale of receipts) {
  const clientRequestId = `legacy-sale:${sale.receipt}`
  // Only the known stale all-paid credit headers are changed. Paid source
  // receipts are verified ABA and intentionally receive no UPDATE.
  if (sale.creditUsd > 0) statements.push(`UPDATE sales SET payment_method='Credit', amount_paid_usd=0, updated_at=CURRENT_TIMESTAMP WHERE receipt_number=${sql(sale.receipt)} AND client_request_id=${sql(clientRequestId)} AND created_at=${sql(sale.createdAt)} AND total_usd=${sqlNum(sale.total)} AND amount_paid_usd=${sqlNum(sale.total)} AND payment_method=${sql(sale.existing.payment_method)};`)
  for (const item of sale.items) {
    if (!item.product.opening_batch_id) throw new Error(`Refusing to model sale stock effect without opening batch: ${sale.invoice} / ${item.product.id}`)
  }
  const legacyId = Number(sale.invoice)
  if (!Number.isInteger(legacyId) || legacyId <= 0) throw new Error(`Cannot form receivable id from invoice ${sale.invoice}`)
  const customerId = sale.customer?.id || (sale.customerPhone ? `(SELECT id FROM customers WHERE phone_normalized=${sql(phoneKey(sale.customerPhone))} LIMIT 1)` : 'NULL')
  const status = sale.creditUsd > 0 ? 'unpaid' : 'paid'
  statements.push(`INSERT INTO customer_receivables (legacy_id,customer_id,customer_code,customer_name,invoice_no,invoice_date,taxable_amount_usd,vat_amount_usd,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES (${legacyId},${customerId},NULL,${sql(sale.customerName || 'Unknown customer')},${sql(sale.invoice)},'2026-09-01',${sqlNum(sale.subtotal)},0,${sqlNum(sale.total)},${sqlNum(sale.amountPaidUsd)},${sqlNum(sale.creditUsd)},${sql(status)},${sql(path.basename(files.invoice))},${legacyId}) ON CONFLICT(source_file,legacy_id) DO UPDATE SET customer_id=excluded.customer_id,customer_name=excluded.customer_name,total_amount_usd=excluded.total_amount_usd,amount_paid_usd=excluded.amount_paid_usd,outstanding_balance_usd=excluded.outstanding_balance_usd,status=excluded.status WHERE customer_receivables.invoice_no=excluded.invoice_no AND customer_receivables.invoice_date=excluded.invoice_date;`)
}
for (const plan of transferPlans) {
  const transfer = plan.transfer
  const transferKey = `legacy-transfer:${transfer.number}:${transfer.ordinal}`
  if (plan.mode === 'already_applied_noop' && (Number(plan.existingUserId) !== Number(transfer.cashier.user.id) || norm(plan.existingUserName) !== norm(transfer.cashier.user.name))) {
    statements.push(`UPDATE stock_transfers SET user_id=${transfer.cashier.user.id}, user_name=${sql(transfer.cashier.user.name || transfer.cashier.canonical)} WHERE id=${plan.existingId} AND client_request_id=${sql(transferKey)} AND from_branch_id=${transfer.fromBranchId} AND to_branch_id=${transfer.toBranchId} AND product_id=${transfer.product.id} AND quantity=${sqlNum(transfer.quantity)} AND ${plan.existingUserId == null ? 'user_id IS NULL' : `user_id=${Number(plan.existingUserId)}`} AND COALESCE(user_name,'')=${sql(plan.existingUserName || '')} AND EXISTS (SELECT 1 FROM legacy_inventory_effects WHERE source_key IN (${sql(`${transferKey}:out`)},${sql(`${transferKey}:in`)}));`)
  }
  if (plan.mode === 'link_existing_no_stock_effect') {
    statements.push(`UPDATE stock_transfers SET client_request_id=${sql(transferKey)}, user_id=${transfer.cashier.user.id}, user_name=${sql(transfer.cashier.user.name || transfer.cashier.canonical)}, notes=${sql(`Old-system transfer #${transfer.number}; source actor ${plan.sourceActor}; legacy import was entered by James`)} WHERE id=${plan.existingId} AND client_request_id IS NULL AND from_branch_id=${transfer.fromBranchId} AND to_branch_id=${transfer.toBranchId} AND product_id=${transfer.product.id} AND quantity=${sqlNum(transfer.quantity)} AND user_id=${plan.existingUserId} AND user_name=${sql(plan.existingUserName)} AND NOT EXISTS (SELECT 1 FROM legacy_inventory_effects WHERE reference_id=${plan.existingId});`)
  }
  if (plan.mode === 'create_with_effects') {
    statements.push(`INSERT INTO stock_transfers (from_branch_id,to_branch_id,product_id,product_name,quantity,notes,user_id,user_name,created_at,client_request_id) SELECT ${transfer.fromBranchId},${transfer.toBranchId},${transfer.product.id},${sql(transfer.product.name)},${sqlNum(transfer.quantity)},${sql(`Old-system transfer #${transfer.number}; source actor ${transfer.cashier.canonical}`)},${transfer.cashier.user.id},${sql(transfer.cashier.user.name || transfer.cashier.canonical)},${sql(transfer.occurredAt)},${sql(transferKey)} WHERE NOT EXISTS (SELECT 1 FROM stock_transfers WHERE client_request_id=${sql(transferKey)});`)
  }
}
// Apply stock effects in source business-time order. This is essential for
// product 64: the verified 11:20 transfer-in must precede its later Shop sale.
// The guarded ledger trigger remains the final fail-safe at apply time.
for (const effect of inventoryEffectPlan) {
  const referenceId = effect.referenceTransferKey
    ? `(SELECT id FROM stock_transfers WHERE client_request_id=${sql(effect.referenceTransferKey)})`
    : sqlNum(effect.referenceId)
  statements.push(`INSERT OR IGNORE INTO legacy_inventory_effects (source_key,product_id,branch_id,batch_id,quantity_delta,movement_quantity,movement_type,reason,reference_id,occurred_at,unit_cost_usd,unit_cost_khr) VALUES (${sql(effect.sourceKey)},${effect.productId},${effect.branchId},${effect.batchId || 'NULL'},${sqlNum(effect.quantityDelta)},${sqlNum(effect.movementQuantity)},${sql(effect.movementType)},${sql(effect.reason)},${referenceId},${sql(effect.occurredAt)},${effect.unitCostUsd == null ? 'NULL' : sqlNum(effect.unitCostUsd)},${effect.unitCostKhr == null ? 'NULL' : sqlNum(effect.unitCostKhr)});`)
}
const feeStatements = expenseRows.map((fee) => `INSERT INTO fees (fee_type,label,amount_usd,amount_khr,fee_date,branch_id,notes,created_by_name,created_at,updated_at) SELECT ${sql(fee.feeType)},${sql(fee.label)},0,${sqlNum(fee.khr)},${sql(fee.date)},2,${sql(fee.notes)},'Old system',${sql(fee.createdAt)},${sql(fee.createdAt)} WHERE NOT EXISTS (SELECT 1 FROM fees WHERE fee_date='2026-09-01' AND label=${sql(fee.label)} AND amount_khr=${sqlNum(fee.khr)} AND COALESCE(notes,'')=COALESCE(${sql(fee.notes)},''));`)
statements.push(...feeStatements)
const sqlFile = path.join(outputDir, 'import.sql')
fs.writeFileSync(sqlFile, `${statements.join('\n\n')}\n`)
// Separate review-only name-fill plan.  Its source is the verified 73-product
// import file, and every statement retains a blank-description precondition.
const officialNameSqlFile = path.join(outputDir, 'official-name-fill.sql')
const officialNameStatements = officialNameFill.candidates.map((candidate) =>
  `UPDATE products SET description=${sql(`Official Product Name:\n${candidate.officialName}`)}, updated_at=CURRENT_TIMESTAMP WHERE ${officialNameFillGuardSql(candidate)};`,
)
fs.writeFileSync(officialNameSqlFile, `${officialNameStatements.join('\n')}\n`)
console.log(JSON.stringify({ ...report, status: 'ready_for_human_review_only', outputDir, sqlFile, officialNameSqlFile }, null, 2))
if (process.argv.includes('--apply')) {
  throw new Error('This Sep-1 tool is deliberately dry-run only. Review the correction manifest and SQL artifacts in a separately approved apply workflow.')
}
