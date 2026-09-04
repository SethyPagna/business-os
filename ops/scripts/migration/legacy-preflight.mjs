// Pure helpers shared by the dated legacy-report dry runs.  They deliberately
// make no D1, filesystem-write, or network calls so their evidence rules can be
// tested without touching production.
import fs from 'node:fs'
import path from 'node:path'

export const normalizeLegacyText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
/**
 * The ONE barcode-key rule every legacy migration script shares.
 *
 * A source code is a BARCODE ONLY WHEN IT IS ENTIRELY DIGITS.  Anything else --
 * a SKU-style code, a spreadsheet header cell, a "Created By:..." banner row --
 * returns '' so the caller falls through to its name path instead of chasing a
 * barcode.  '' is deliberate: it is neither an error nor a throw, because every
 * caller already reads an empty key as "this row carries no barcode".
 *
 * This helper used to strip non-digits, and stripping does NOT produce an empty
 * key -- it produces a SHORT WRONG one.  "Libre10ml" became "10" and
 * "CompletelyClean45g" became "45", and 44 live products carry the literal
 * barcode "10" (the 10ml-perfume placeholder), 3 of them active.  The only
 * reason this produced dropped lines rather than silent mis-booking into the
 * wrong product is that the duplicate-barcode quarantine stood in front of it.
 * Relax that quarantine and this becomes silent mis-booking against those 44
 * products.  The Sep-1 transfer path is the sharpest edge: it calls
 * resolveUniqueBarcode with no name fallback at all, so a short wrong key that
 * hit exactly one active product would book stock against an unrelated product
 * and look correct forever.
 *
 * A digits-only code keeps its leading-zero normalisation ("0012345" ->
 * "12345") so an Excel-widened barcode still equals its stored form, and "0"
 * stays "0" for the callers that reject it as a placeholder.
 */
export const barcodeKey = (value) => {
  const code = String(value ?? '').trim()
  if (!/^[0-9]+$/.test(code)) return ''
  return code.replace(/^0+(?=\d)/, '')
}
// Keep this identical to cloudflare/src/lib/phone.ts::canonicalizePhone.
// Unlike a barcode comparison key, a stored customer phone must retain its
// national leading zero so portal/customer equality lookups keep working.
export function canonicalLegacyPhone(value) {
  const digits = String(value ?? '').trim().replace(/\D/g, '')
  if (!digits) return null
  if (/^855\d{8,9}$/.test(digits)) return `0${digits.slice(3)}`
  return digits
}

export const CASHIER_OVERRIDES = Object.freeze({
  aza: 'Za',
  rout: 'Rath',
  routh: 'Rath',
  rath: 'Rath',
  sethyka: 'James',
  pagna: 'James',
  'super admin': 'Admin',
})

// These are review decisions, not a barcode matching rule.  Every field is a
// source guard; removing any one turns historical cost/name inference back
// into an unsafe generic fallback.
export const SEP1_REVIEWED_ITEM_OVERRIDES = Object.freeze([
  Object.freeze({
    invoice: '004413', barcode: '041554539462', sourceName: 'Maybelline Fit Me Foundation N. 118', sourceCostUsd: 8.5,
    productId: 4115, productName: 'Maybelline Fit Me Foundation N. 118',
  }),
  Object.freeze({
    invoice: '004411', barcode: '041554590913', sourceName: 'Maybelline Mascara N.802', sourceCostUsd: 7.836956,
    productId: 4259, productName: 'Maybelline Sky High Mascara N.802',
  }),
])

/**
 * Locate a report from the preserved archive before accepting a loose copy.
 * A duplicate loose export is not evidence that it is the intended source.
 */
export function resolveArchivedReport(sourceRoot, filename) {
  const root = path.resolve(sourceRoot)
  // `Migration from old system` itself is the preserved archive. Its direct
  // report is the dated cutover source; older 27th-30th copies are fallback
  // evidence only when that archived direct report is absent.
  const candidates = [
    path.join(root, filename),
    path.join(root, '27th-30th', filename),
    path.join(root, 'archive', filename),
  ]
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error(`Missing archived legacy report: ${filename} under ${root}`)
  return found
}

/** Apply source overrides before any username/display-name comparison. */
export function resolveLegacyCashier(rawName, users = []) {
  const rawKey = normalizeLegacyText(rawName)
  if (!rawKey) return { status: 'absent', rawName: String(rawName ?? ''), canonical: null, user: null }
  const canonical = CASHIER_OVERRIDES[rawKey] || String(rawName).trim()
  const wanted = normalizeLegacyText(canonical)
  const matches = users.filter((user) => [user.username, user.name]
    .some((value) => normalizeLegacyText(value) === wanted))
  const distinct = [...new Map(matches.map((user) => [String(user.id), user])).values()]
  if (distinct.length === 1) return { status: 'resolved', rawName: String(rawName), canonical, user: distinct[0] }
  return { status: distinct.length ? 'ambiguous' : 'unmatched', rawName: String(rawName), canonical, user: null, candidates: distinct.map((user) => user.id) }
}

/**
 * Never let a cost/name fallback silently choose among duplicate barcodes.
 *
 * Some callers (the Sep-1 stock-transfer path) have NO name fallback behind
 * this, so `missing_barcode` there means the line is reported and skipped, not
 * resolved by another route.  That is why the key must come from barcodeKey's
 * entirely-digits rule and never from digit extraction: a short wrong key here
 * has nothing standing behind it but the duplicate quarantine.
 */
export function resolveUniqueBarcode(barcode, candidates = []) {
  const key = barcodeKey(barcode)
  if (!key || key === '0') return { status: 'missing_barcode', key, product: null }
  if (candidates.length === 1) return { status: 'resolved', key, product: candidates[0] }
  return {
    status: candidates.length ? 'quarantined_duplicate_barcode' : 'unmatched_barcode',
    key,
    product: null,
    candidateIds: candidates.map((candidate) => candidate.id),
  }
}

/**
 * Release one reviewed collision only when its source row AND the live sale
 * already agree with the review decision.  This deliberately cannot create a
 * new mapping or resolve an otherwise-identical future invoice.
 */
export function resolveReviewedSep1ItemOverride({ invoice, barcode, sourceName, sourceCostUsd, candidates = [], existingSaleItems = [] }) {
  const override = SEP1_REVIEWED_ITEM_OVERRIDES.find((candidate) =>
    candidate.invoice === String(invoice)
    && candidate.barcode === String(barcode).trim()
    && candidate.sourceName === String(sourceName).trim()
    && Math.abs(candidate.sourceCostUsd - Number(sourceCostUsd)) < 0.00001,
  )
  if (!override) return { status: 'no_reviewed_override', product: null }
  const product = candidates.find((candidate) => Number(candidate.id) === override.productId && String(candidate.name) === override.productName)
  if (!product) return { status: 'override_live_product_mismatch', product: null, override }
  // Match on the OLD-SYSTEM label, which after migration 0107 lives in
  // sales.legacy_receipt_number -- receipt_number now holds the business
  // YYYYMMDD-HHMMSS id. Both are accepted so this keeps working against a
  // pre-0107 snapshot as well as against repaired production.
  const legacyLabel = `${override.invoice}@2026-09-01`
  const existing = existingSaleItems.filter((item) =>
    (String(item.legacy_receipt_number ?? '') === legacyLabel || String(item.receipt_number) === legacyLabel)
    && Number(item.product_id) === override.productId
    && String(item.product_name) === override.productName
    && Math.abs(Number(item.cost_price_usd) - override.sourceCostUsd) < 0.00001,
  )
  if (existing.length !== 1) return { status: 'override_live_sale_mismatch', product: null, override, existingCount: existing.length }
  return { status: 'reviewed_override_confirmed', product, override }
}

/**
 * The only name-fill input allowed by this tool is the verified 73-product
 * import file.  It never accepts review_official_names.csv, whose raw values
 * include unresolved/ambiguous and encoding-damaged evidence.
 */
export function planVerifiedBlankOfficialNameFill(verifiedRows = [], liveProducts = []) {
  const verified = new Map()
  const barcodeLessByName = new Map()
  for (const row of verifiedRows) {
    const barcode = String(row.barcode ?? '').trim()
    const name = String(row.name ?? '').trim()
    if (!name) continue
    const nameKey = normalizeLegacyText(name)
    if (!barcode || barcode === '0') {
      const entries = barcodeLessByName.get(nameKey) || []
      // Shop/warehouse snapshot twins repeat the same verified title. They
      // are one identity, not an ambiguous name-only mapping.
      if (!entries.some((entry) => normalizeLegacyText(entry.name) === nameKey)) entries.push({ barcode: '', name })
      barcodeLessByName.set(nameKey, entries)
      verified.set(`name:${nameKey}`, { barcode: '', name })
      continue
    }
    verified.set(`${barcode}\u0001${nameKey}`, { barcode, name })
  }
  const candidates = []
  const skipped = []
  for (const product of liveProducts) {
    const barcode = String(product.barcode ?? '').trim()
    const nameKey = normalizeLegacyText(product.name)
    const key = `${barcode}\u0001${nameKey}`
    const nameOnly = barcodeLessByName.get(nameKey) || []
    // Barcode remains the primary key.  A barcode-less source row may use an
    // exact, unique verified name only; an ambiguous name remains omitted.
    const evidence = verified.get(key) || (barcode === '' && nameOnly.length === 1 ? nameOnly[0] : null)
    if (!evidence) continue
    if (String(product.description ?? '').trim() === '') candidates.push({ id: product.id, barcode: evidence.barcode, officialName: evidence.name })
    else skipped.push({ id: product.id, reason: 'description_not_blank' })
  }
  return { candidates, skipped, expectedDistinctVerifiedProducts: verified.size }
}

/** SQL predicate for a reviewed blank-description fill; supports barcode-less
 * verified identities without ever relying on `barcode = NULL` (which matches
 * no SQLite row). */
export function officialNameFillGuardSql(candidate) {
  const id = Number(candidate?.id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Official-name candidate requires a positive id')
  const barcode = String(candidate?.barcode ?? '').trim()
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  const barcodeGuard = barcode ? `barcode=${quote(barcode)}` : "TRIM(COALESCE(barcode,''))=''"
  return `id=${id} AND ${barcodeGuard} AND TRIM(COALESCE(description,''))=''`
}

/** Create an idempotent, write-free Sep-1 correction manifest and its invariants. */
export function buildSep1CorrectionManifest({ receipts = [], transfers = [], sourceFiles = [], reviewedOverrides = [] } = {}) {
  const saleKeys = receipts.map((sale) => `legacy-sale:${sale.receipt}`)
  // The AR ledger is a faithful per-invoice source ledger, not merely an
  // unpaid queue. Paid rows are required for reconciliation totals too.
  const receivableKeys = receipts.map((sale) => `legacy-receivable:2026-09-01:${sale.invoice}`)
  const saleEffectKeys = receipts.flatMap((sale) => sale.items.map((item) => `legacy-sale:${sale.receipt}:${item.ordinal}`))
  const transferEffectKeys = transfers.flatMap((transfer) => [
    `legacy-transfer:${transfer.number}:${transfer.ordinal}:out`,
    `legacy-transfer:${transfer.number}:${transfer.ordinal}:in`,
  ])
  const duplicateKeys = (values) => values.filter((value, index) => values.indexOf(value) !== index)
  const saleDelta = receipts.flatMap((sale) => sale.items).reduce((sum, item) => sum - Number(item.quantity || 0), 0)
  const transferDelta = transfers.reduce((sum, transfer) => sum + Number(transfer.quantity || 0) - Number(transfer.quantity || 0), 0)
  return {
    mode: 'dry_run_only',
    sourceFiles,
    reviewedOverrides,
    operations: {
      sales: saleKeys,
      receivables: receivableKeys,
      inventoryEffects: saleEffectKeys,
      transferEffects: transferEffectKeys,
    },
    invariants: {
      uniqueIdempotencyKeys: duplicateKeys([...saleKeys, ...receivableKeys, ...saleEffectKeys, ...transferEffectKeys]).length === 0,
      transferNetQuantity: transferDelta,
      plannedSaleStockDelta: saleDelta,
      receivableCount: receivableKeys.length,
      receivableTotalUsd: Number(receipts.reduce((sum, sale) => sum + Number(sale.total || 0), 0).toFixed(2)),
      receivablePaidUsd: Number(receipts.reduce((sum, sale) => sum + Number(sale.amountPaidUsd || 0), 0).toFixed(2)),
      receivableOutstandingUsd: Number(receipts.reduce((sum, sale) => sum + Number(sale.creditUsd || 0), 0).toFixed(2)),
      reviewedOverrideCount: reviewedOverrides.length,
      postconditions: [
        'each source key may be inserted once only',
        'sales reduce only their mapped Shop stock; transfers net to zero globally',
        'receivables use source-key idempotent upserts guarded by invoice/date identity',
        'only known legacy all-paid credit headers are guardedly corrected; paid ABA headers are unchanged',
        'negative-stock trigger and pre/post stock totals must pass before any apply',
      ],
    },
  }
}

/**
 * Refuse to re-apply an old-system importer after migration 0107.
 *
 * These importers key every sale they wrote by the OLD SYSTEM's invoice label
 * `NNNNNN@YYYY-MM-DD`, both to mint sales.receipt_number and -- crucially --
 * to recognise the rows they already imported so a rerun is a no-op.
 * Migration 0107 moved that label to sales.legacy_receipt_number and put
 * receipt_number back into the project's own YYYYMMDD-HHMMSS format (the user
 * rule of Sep 2 2026, after a reconciliation pack overwrote 15,004 receipts).
 *
 * Post-0107 a rerun would therefore do two harmful things at once: match none
 * of its own rows and duplicate every sale, and write the `@` label back onto
 * live receipts. Neither is recoverable from inside the script, so it stops
 * here instead. A genuine re-import goes through the sales importer, which
 * routes a foreign source label to legacy_receipt_number and mints a real
 * business receipt id from the sale's own moment
 * (cloudflare/src/lib/salesImportCommit.ts).
 *
 * @param queryRows a function running one SQL command and returning its rows
 */
export function assertLegacyReceiptEraStillCurrent(queryRows) {
  const rows = queryRows("SELECT COUNT(*) AS n FROM pragma_table_info('sales') WHERE name = 'legacy_receipt_number'")
  if (Number(rows?.[0]?.n || 0) > 0) {
    throw new Error(
      'Refusing to apply: migration 0107 has already moved the old-system `NNNNNN@YYYY-MM-DD` labels to '
      + 'sales.legacy_receipt_number and rewritten sales.receipt_number to the business YYYYMMDD-HHMMSS format. '
      + 'This importer keys its sales by the old label, so a rerun would duplicate every row it already '
      + 'imported and put the `@` shape back on live receipts. Re-import through the sales importer instead.',
    )
  }
}
