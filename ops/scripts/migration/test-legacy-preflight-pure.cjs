const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Anchored to __dirname, never the cwd: this file used to read the importers
// through './ops/scripts/migration/...', which only resolved when it happened
// to be run from the repository root.
const migrationDir = __dirname

;(async () => {
  const helpers = await import('./legacy-preflight.mjs')
  const users = [
    { id: 1, username: 'Admin', name: 'Administrator' },
    { id: 2, username: 'James', name: 'James' },
    { id: 3, username: 'Za', name: 'Za' },
    { id: 4, username: 'Rath', name: 'Rath' },
  ]
  for (const [raw, id] of [['Aza', 3], ['Rout', 4], ['Routh', 4], ['Rath', 4], ['Sethyka', 2], ['Pagna', 2], ['Super Admin', 1]]) {
    const resolved = helpers.resolveLegacyCashier(raw, users)
    assert.equal(resolved.status, 'resolved', raw)
    assert.equal(resolved.user.id, id, raw)
  }
  assert.equal(helpers.canonicalLegacyPhone('093 702 628'), '093702628', 'local leading zero must be retained for storage/equality')
  assert.equal(helpers.canonicalLegacyPhone('+855 93 702 628'), '093702628', 'country form must fold to the same local canonical key')
  assert.equal(helpers.resolveUniqueBarcode('00123', [{ id: 8 }]).status, 'resolved')
  assert.equal(helpers.resolveUniqueBarcode('00123', [{ id: 8 }, { id: 9 }]).status, 'quarantined_duplicate_barcode')
  const override = helpers.resolveReviewedSep1ItemOverride({
    invoice: '004413', barcode: '041554539462', sourceName: 'Maybelline Fit Me Foundation N. 118', sourceCostUsd: 8.5,
    candidates: [{ id: 4115, name: 'Maybelline Fit Me Foundation N. 118' }, { id: 4123, name: 'Maybelline Fit Me Foundation O. 118' }],
    existingSaleItems: [{ receipt_number: '004413@2026-09-01', product_id: 4115, product_name: 'Maybelline Fit Me Foundation N. 118', cost_price_usd: 8.5 }],
  })
  assert.equal(override.status, 'reviewed_override_confirmed')
  assert.equal(helpers.resolveReviewedSep1ItemOverride({
    invoice: '004413', barcode: '041554539462', sourceName: 'Maybelline Fit Me Foundation N. 118', sourceCostUsd: 7,
    candidates: [{ id: 4115, name: 'Maybelline Fit Me Foundation N. 118' }], existingSaleItems: [],
  }).status, 'no_reviewed_override', 'cost must remain a strict source guard')
  const fill = helpers.planVerifiedBlankOfficialNameFill(
    [{ barcode: '123', name: 'Verified name' }, { barcode: '123', name: 'Verified name' }],
    [{ id: 1, barcode: '123', name: 'Verified name', description: '' }, { id: 2, barcode: '123', name: 'Verified name', description: 'keep' }],
  )
  assert.deepEqual(fill.candidates, [{ id: 1, barcode: '123', officialName: 'Verified name' }])
  assert.equal(fill.skipped[0].reason, 'description_not_blank')
  assert.equal(helpers.officialNameFillGuardSql({ id: 7, barcode: '123' }), "id=7 AND barcode='123' AND TRIM(COALESCE(description,''))=''" )
  assert.equal(helpers.officialNameFillGuardSql({ id: 8, barcode: '' }), "id=8 AND TRIM(COALESCE(barcode,''))='' AND TRIM(COALESCE(description,''))=''" )
  const blankBarcodeIds = new Set([6066, 6067, 6068, 6093, 6094])
  const seventyThreeCandidates = Array.from({ length: 73 }, (_, index) => ({ id: 6032 + index, barcode: blankBarcodeIds.has(6032 + index) ? '' : `bc-${index}` }))
  const seventyThreeGuards = seventyThreeCandidates.map(helpers.officialNameFillGuardSql)
  assert.equal(seventyThreeGuards.length, 73)
  assert.equal(seventyThreeGuards.some((guard) => /barcode\s*=\s*NULL/i.test(guard)), false, 'all 73 title updates must have executable barcode predicates')
  for (const id of blankBarcodeIds) assert.ok(seventyThreeGuards.includes(`id=${id} AND TRIM(COALESCE(barcode,''))='' AND TRIM(COALESCE(description,''))=''`), `blank-barcode product ${id} needs a null-safe guard`)
  const manifest = helpers.buildSep1CorrectionManifest({
    receipts: [
      { invoice: '44', receipt: '44@2026-09-01', total: 5, amountPaidUsd: 3, creditUsd: 2, items: [{ ordinal: 0, quantity: 3 }] },
      { invoice: '45', receipt: '45@2026-09-01', total: 7, amountPaidUsd: 7, creditUsd: 0, items: [] },
    ],
    transfers: [{ number: 'T1', ordinal: 0, quantity: 5 }],
  })
  assert.equal(manifest.mode, 'dry_run_only')
  assert.equal(manifest.invariants.uniqueIdempotencyKeys, true)
  assert.equal(manifest.invariants.transferNetQuantity, 0)
  assert.equal(manifest.invariants.plannedSaleStockDelta, -3)
  assert.equal(manifest.invariants.receivableCount, 2, 'paid and unpaid source invoices both require AR ledger rows')
  assert.equal(manifest.invariants.receivableTotalUsd, 12)
  assert.equal(manifest.invariants.receivablePaidUsd, 10)
  assert.equal(manifest.invariants.receivableOutstandingUsd, 2)
  const sepScript = fs.readFileSync(path.join(migrationDir, 'import-sep01-legacy-reports.mjs'), 'utf8')
  const aug31Script = fs.readFileSync(path.join(migrationDir, 'import-aug31-legacy-reports.mjs'), 'utf8')
  assert.ok(aug31Script.includes("resolveArchivedReport(legacyRoot, name)"), 'Aug-31 migration must prefer the preserved archive over loose Downloads copies')
  assert.ok(aug31Script.includes('new Set([4377, 4378, 4379, 4380, 4381])'), 'Aug-31 Rath attribution must be limited to the five receipts reconciled by the user report')
  assert.ok(aug31Script.includes("cashier: RATH_PROVEN_RECEIPTS.has(Number(first['Invoice No'])) ? cashierRath : null"), 'each Aug-31 sale carries evidence-scoped cashier identity')
  assert.ok(aug31Script.includes("sale.cashier?.username || 'Old system'"), 'unproven Aug-31 cashier names remain explicitly unknown')
  assert.ok(aug31Script.includes('rathSales.length !== 5 || rathGross !== 146'), 'the importer fails if the Rath source reconciliation drifts')
  assert.ok(aug31Script.includes('refusing mixed create/correction SQL'), 'a partial Aug-31 cohort cannot mix creation with corrections')
  assert.ok(aug31Script.includes('Existing Aug-31 receipt identity drifted; refusing correction'), 'existing receipts must match request id, timestamp, total, and a known legacy cashier state')
  assert.ok(aug31Script.includes("cashier_id IS NULL AND cashier_name='Old system'"), 'cashier correction is limited to known legacy states')
  assert.equal(sepScript.includes('INSERT OR IGNORE INTO sales'), false, 'existing Sep-1 sales must not be replayed with INSERT OR IGNORE')
  assert.equal(sepScript.includes('INSERT INTO sale_items'), false, 'existing sale items must never be duplicated by this reconciliation artifact')
  assert.ok(sepScript.includes("payment_method='Credit', amount_paid_usd=0"), 'credit correction must be a guarded header update')
  assert.ok(sepScript.includes('link_existing_no_stock_effect'), 'existing transfer 1723 must not receive another stock effect')
  assert.ok(sepScript.includes('officialNameFillGuardSql(candidate)'), 'name-fill SQL must use the null-safe candidate guard')
  assert.ok(sepScript.includes('rows(files.productSummary, 1)'), 'the product/supplier table is on Sheet2, after the title-only Sheet1')
  assert.ok(sepScript.includes('productSummaryByBarcode.get(barcodeKey(code))'), 'legacy supplier evidence must join barcode-first')
  assert.ok(sepScript.includes('if (!sourceValue || !current) continue'), 'supplier transitions must require both legacy and current evidence')
  assert.ok(sepScript.includes('stockAvailabilitySequenceSafe'), 'generated stock effects need a remote-state sequence invariant')
  assert.ok(sepScript.includes('inventoryEffectPlan'), 'sale and transfer effects must share one chronological plan')
  assert.ok(sepScript.includes('existing_sale_item_identity_cost_total_mismatch'), 'live sale lines must be checked by product, quantity, cost, applied price and total')
  assert.ok(sepScript.includes("requiresMigrations = ['0101_legacy_inventory_effect_historical_cost.sql']"), 'historical-cost trigger migration must precede the correction SQL')
  assert.ok(sepScript.includes('unit_cost_usd,unit_cost_khr'), 'legacy sale effects must carry the source unit cost into movement reporting')
  console.log('PASS legacy migration preflight helpers')
})().catch((error) => { console.error(error); process.exitCode = 1 })
