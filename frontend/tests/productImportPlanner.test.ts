import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyzeProductImportRows, analyzeProductImportText } from '../src/components/products/import/productImportPlanner.ts'

let failed = 0

type TestCallback = () => void | Promise<void>
type ImportFixtureRow = Record<string, unknown>

interface ProductImportReviewSubgroupFixture {
  rowIndexes: number[]
  suggestedAction: string
}

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('same product name and same non-stock details plans stock merge', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: '12.345', stock_quantity: '3' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: 12.35, stock_quantity: 1 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 10)
  assert.equal(analysis.summary.mergeCount, 1)
})

await runTest('same product name and same details but different branch, no barcode, still plans stock merge', () => {
  // A barcode is no longer required for the merge shortcut: everything
  // that identifies "the same product" (name, sku, category, brand, unit,
  // description, supplier, prices) matches here and only branch differs,
  // so this is one product restocked at another branch, not a variant.
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', brand: 'Acme', category: 'Skincare', selling_price_usd: '12', purchase_price_usd: '6', branch: 'Branch B', stock_quantity: '3' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', brand: 'Acme', category: 'Skincare', selling_price_usd: 12, purchase_price_usd: 6, branch: 'Branch A', stock_quantity: 1 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 10)
  assert.equal(analysis.summary.mergeCount, 1)
})

await runTest('same product name and a different BRAND still merges -- brand is not a detail', () => {
  // Details are barcode + cost only (utils/productDetailRule.ts). Brand,
  // category, unit, supplier, sku and description are descriptive fields,
  // not identity: the same article relabelled is still the same article.
  // This assertion is inverted from what it used to be, when brand DID fork
  // a variant -- that definition disagreed with both the backend matcher
  // and the frontend's own display merge.
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', brand: 'Acme', branch: 'Branch B', stock_quantity: '3' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', brand: 'Other Brand', branch: 'Branch A', stock_quantity: 1 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
})

await runTest('same product name with different sku/price/supplier still merges -- none are details', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-2', selling_price_usd: '15', supplier: 'Supplier B', stock_quantity: '2' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', selling_price_usd: 12, supplier: 'Supplier A', created_at: '2026-01-01' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
})

await runTest('same product name and a different COST plans a separate child row', () => {
  // Cost is what was actually spent. It is a detail precisely so it can
  // never be silently replaced by another row's figure.
  const analysis = analyzeProductImportRows([
    { name: 'Serum', cost_price_usd: '9', stock_quantity: '2' },
  ], [
    { id: 10, name: 'Serum', cost_price_usd: 6, created_at: '2026-01-01' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'create_variant')
  assert.equal(analysis.rows[0]._parent_id, 10)
  assert.equal(analysis.summary.variantCount, 1)
})

await runTest('same name + same barcode + same cost merges even when the SELLING price differs', () => {
  // Selling and special price are what we plan to charge and are adjusted
  // for sales/POS -- not what the item is. Same barcode and same cost means
  // the same product, so this folds into existing stock and the highest
  // price wins. Inverted from the old rule, which treated any price change
  // as a different product and forked ~700 duplicate rows out of a real
  // catalog.
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: '15', cost_price_usd: '6', discount_percent: '10', stock_quantity: '2' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: 12, cost_price_usd: 6, discount_percent: 0 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
})

await runTest('malformed existing product rows do not crash import analysis', () => {
  const existingProducts = [
    null,
    { id: 20, name: 'Safe Cream', sku: 'SAFE-1', barcode: 'BC-SAFE-1', image_gallery: null, selling_price_usd: 8.01 },
    { id: 21, name: '', image_gallery: '{bad json' },
  ] as unknown as ImportFixtureRow[]

  // The null and bad-JSON entries above are the actual crash-safety
  // regression this test guards against.
  const analysis = analyzeProductImportRows([
    { name: 'Safe Cream', sku: 'SAFE-1', barcode: 'BC-SAFE-1', selling_price_usd: '8.001', stock_quantity: '2' },
  ], existingProducts)

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 20)
})

await runTest('different product name with same SKU or barcode becomes editable identifier conflict', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum Travel', sku: 'S-1', barcode: 'BC-1', selling_price_usd: '8.001', stock_quantity: '2' },
  ], [
    { id: 20, name: 'Serum Full Size', sku: 'S-1', barcode: 'BC-1', selling_price_usd: 12.01 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'new')
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.conflicts[0].conflictType, 'identifier')
  assert.deepEqual(analysis.conflicts[0].conflictFields, ['sku', 'barcode'])
})

await runTest('same product name with same barcode still exposes identifier handling', () => {
  // Different cost keeps these apart (cost is a detail), so the shared
  // barcode still has to be surfaced as an identifier conflict rather than
  // silently duplicated onto two rows.
  const analysis = analyzeProductImportRows([
    { name: 'Serum', barcode: 'BC-1', cost_price_usd: '9', supplier: 'Supplier B', stock_quantity: '2' },
  ], [
    { id: 20, name: 'Serum', barcode: 'BC-1', cost_price_usd: 6, supplier: 'Supplier A', created_at: '2026-01-01' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'create_variant')
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.conflicts[0].conflictType, 'same_name_identifier')
  assert.deepEqual(analysis.conflicts[0].conflictFields, ['barcode'])
})

await runTest('same-file duplicate barcode rows become review conflicts', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum A', barcode: '651986410538', selling_price_usd: '12', stock_quantity: '1' },
    { name: 'Serum B', barcode: '651986410538', selling_price_usd: '14', stock_quantity: '2' },
  ], [])

  assert.equal(analysis.conflicts.length, 2)
  assert.deepEqual(analysis.conflicts.map((entry) => entry.conflictFields), [['barcode'], ['barcode']])
  assert.deepEqual(analysis.conflicts[0]?.importDuplicateRows?.barcode, [0, 1])
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.rows[1]._identifier_conflict_mode, 'clear_imported')
})

await runTest('scientific notation barcodes are blocking review conflicts', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum A', barcode: '8.19265E+11', selling_price_usd: '12', stock_quantity: '1' },
  ], [])

  assert.equal(analysis.cleanRows.length, 0)
  assert.equal(analysis.conflicts.length, 1)
  assert.equal(analysis.conflicts[0].conflictType, 'barcode_scientific_notation')
  assert.deepEqual(analysis.conflicts[0].conflictFields, ['barcode'])
  assert.deepEqual(analysis.conflicts[0].issueTypes, ['barcode_scientific_notation'])
  assert.equal(analysis.summary.errorCount, 1)
})

await runTest('missing product name rows stay visible as review issues', () => {
  const analysis = analyzeProductImportRows([
    { name: '', barcode: 'HAS-BARCODE', selling_price_usd: '12', stock_quantity: '1' },
    { name: 'Named Product', barcode: 'OK-1', selling_price_usd: '14', stock_quantity: '2' },
  ], [])

  assert.equal(analysis.rows.length, 2)
  assert.equal(analysis.rows[0]._planned_action, 'skip_row')
  assert.equal(analysis.conflicts[0].conflictType, 'missing_name')
  assert.deepEqual(analysis.conflicts[0].issueTypes, ['missing_name'])
  assert.equal(analysis.errors.length, 1)
})

await runTest('duplicate imported same-name rows avoid unsafe temporary row ids', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Cream', sku: 'C-1', selling_price_usd: '3.001', stock_quantity: '1' },
    { name: 'Cream', sku: 'C-1', selling_price_usd: '3.001', stock_quantity: '4' },
    { name: 'Cream', sku: 'C-2', selling_price_usd: '4.001', stock_quantity: '2' },
  ], [])

  // All three rows share a name and have no barcode and no cost, so under
  // the identity rule (details = barcode + cost, see
  // utils/productDetailRule.ts) they are ONE product: sku and selling price
  // are not details. Rows 1 and 2 therefore merge into row 0's stock. The
  // actual regression this test guards (no unsafe 'row:N' temp ids below)
  // is unaffected either way.
  assert.deepEqual(analysis.rows.map((row) => row._planned_action), ['new', 'merge_stock', 'merge_stock'])
  assert.equal(analysis.rows.some((row) => String(row._parent_id || '').startsWith('row:')), false)
  assert.equal(analysis.rows.some((row) => String(row._target_product_id || '').startsWith('row:')), false)
})

await runTest('a differing DETAIL (barcode or cost) still plans a separate child row', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Cream', barcode: 'BC-1', selling_price_usd: '3', stock_quantity: '1' },
    { name: 'Cream', barcode: 'BC-2', selling_price_usd: '3', stock_quantity: '1' },
    { name: 'Cream', barcode: 'BC-1', cost_price_usd: '9', stock_quantity: '1' },
  ], [])
  const actions = analysis.rows.map((row) => row._planned_action)
  assert.equal(actions[0], 'new')
  assert.notEqual(actions[1], 'merge_stock', 'a different barcode must not merge -- barcode is a detail')
  assert.notEqual(actions[2], 'merge_stock', 'a different cost must not merge -- cost is a detail')
})

await runTest('same imported name groups rows into detail subgroups for review', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Cream', barcode: 'BC-1', brand: 'A', unit: 'pcs', selling_price_usd: '3.001', stock_quantity: '1' },
    { name: 'Cream', barcode: 'BC-1', brand: 'A', unit: 'pcs', selling_price_usd: '3.001', stock_quantity: '4' },
    { name: 'Cream', barcode: 'BC-2', brand: 'B', unit: 'pcs', selling_price_usd: '4.001', stock_quantity: '2' },
  ], [])

  const group = (analysis.groups || []).find((entry) => entry.key === 'cream')
  assert.ok(group, 'Expected same-name group in analysis')
  assert.equal(group.rowNumbers.length, 3)
  assert.equal(group.subgroups.length, 2)
  const subgroups = group.subgroups as ProductImportReviewSubgroupFixture[]
  assert.deepEqual(subgroups.map((entry) => entry.rowIndexes).sort((a, b) => b.length - a.length), [[0, 1], [2]])
  assert.equal(subgroups[0]?.suggestedAction, 'merge_stock')
  assert.equal(subgroups.some((entry) => entry.suggestedAction === 'create_variant'), true)
})

await runTest('large product import analysis keeps deterministic row counts', () => {
  const rows = ['name,sku,selling_price_usd,stock_quantity']
  for (let index = 0; index < 10000; index += 1) {
    rows.push(`ផលិតផល ${index},SKU-${index},${index % 10}.123,${index % 7}`)
  }
  const analysis = analyzeProductImportText(rows.join('\n'), [])

  assert.equal(analysis.summary.total, 10000)
  assert.equal(analysis.rows.length, 10000)
  assert.equal(analysis.errors.length, 0)
})

await runTest('bulk import modal does not fetch the full product catalog before review', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /await\s+window\.api\.getProducts\(/)
  assert.match(source, /Existing-product conflicts\s+[\s\S]*server import job/)
})

await runTest('bulk import modal stops the async start sequence after cancel is requested', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /useRef/)
  assert.match(source, /cancelRequestedRef/)
  assert.match(source, /throwIfImportCancelled/)
  assert.match(source, /cancelImportJob\(currentJob\.id,\s*\{\s*source:/)
  assert.match(source, /getProductImportBarcodeIssue/)
  assert.match(source, /isBlockingProductImportIssue/)
  assert.match(source, /blockingIssueCount/)

  const startMatches = [...source.matchAll(/await\s+withLoaderTimeout\(\s*\(\) => api\.startImportJob\(activeJobId,\s*\{\s*source:/g)]
  assert.ok(startMatches.length >= 2, 'expected timeout-wrapped image-only and CSV import start calls')
  for (const match of startMatches) {
    const previousGuard = source.lastIndexOf('throwIfImportCancelled()', match.index)
    assert.ok(previousGuard >= 0, 'startImportJob must be guarded by throwIfImportCancelled')
    assert.ok(match.index - previousGuard < 900, 'start guard should be close to the start call')
  }
})

await runTest('bulk import modal surfaces grouped families, filter hints, inline edits, undo, and target clarity', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')

  assert.match(source, /CONFLICT_FILTER_OPTIONS/)
  assert.doesNotMatch(source, /value:\s*'identifier',\s*label:\s*'SKU\/barcode'/)
  assert.match(source, /value:\s*'barcode',\s*label:\s*'Barcode'/)
  assert.match(source, /value:\s*'sku',\s*label:\s*'SKU'/)
  assert.match(source, /title=\{item\.hint\}/)
  assert.match(source, /reviewGroups/)
  assert.match(source, /collapsedFamilyKeys/)
  assert.match(source, /visibleConflictSections/)
  assert.match(source, /subgroups/)
  assert.match(source, /reviewUndoStack/)
  assert.match(source, /Undo2/)
  assert.match(source, /InlineImportDetailGrid/)
  assert.match(source, /getImportActionTargetSummary/)
  assert.match(source, /buildVisibleFamilyRows/)
  assert.match(source, /createFamilyContextEntry/)
  assert.match(source, /visibleReviewRowCount/)
  assert.match(source, /const conflictGroups = useMemo\(\(\) => \{[\s\S]*for \(const entry of conflicts\)/)
  assert.doesNotMatch(source, /sameName:\s*conflicts\.filter\(/)
  assert.doesNotMatch(source, /pricing:\s*conflicts\.filter\(/)
})

await runTest('bulk import modal explains specific review errors before apply', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')

  assert.match(source, /getProductImportRowIssueDetails/)
  assert.match(source, /reviewIssueSummary/)
  assert.match(source, /reviewIssueIndexSet/)
  assert.doesNotMatch(source, /Errors and review blockers/)
  assert.doesNotMatch(source, /Show error rows/)
  assert.match(source, /Product name is required/)
  assert.match(source, /Barcode looks like scientific notation/)
  assert.match(source, /Duplicate SKU\/barcode/)
  assert.match(source, /Price\/cost needs review/)
  assert.match(source, /conflictFilter === 'errors'[\s\S]*reviewIssueIndexSet\.has/)
  assert.match(source, /Errors \(\{reviewIssueRows\.length/)
  assert.match(source, /Same identifier appears in CSV rows/)
})

await runTest('bulk import modal keeps cancelled-job recovery and one persisted server review', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')

  assert.match(source, /expandedDetailRows/)
  assert.match(source, /toggleInlineDetails/)
  assert.match(source, /More details/)
  assert.match(source, /setExpandedDetailRows\(new Set\(\)\)/)
  assert.match(source, /Retry import/)
  assert.match(source, /Delete import/)
  assert.match(source, /Back to upload/)
  assert.match(source, /cancelledImportRecovery/)
  assert.match(source, /isCancelledStartError/)
  assert.match(source, /const IMPORT_JOB_STATUS_TIMEOUT_MS = 10000/)
  assert.match(source, /ProductServerImportReviewScreen/)
  assert.match(
    source,
    /withLoaderTimeout\(\s*\(\) => api\.getImportJob\?\.\(jobId\),\s*'Product import job status',\s*IMPORT_JOB_STATUS_TIMEOUT_MS,\s*\)/,
  )
  assert.doesNotMatch(source, /preflightImportJob|IMPORT_JOB_PREFLIGHT_TIMEOUT_MS/)
  assert.doesNotMatch(source, /const payload = await window\.api\.getImportJob\(jobId\)/)
})

await runTest('corrupted Khmer text is blocked before import', () => {
  const analysis = analyzeProductImportRows([
    { name: '??????? CeraVe Serum', brand: '????', selling_price_usd: '12', stock_quantity: '1' },
  ], [])

  assert.equal(analysis.cleanRows.length, 0)
  assert.equal(analysis.conflicts.length, 1)
  assert.equal(analysis.conflicts[0].conflictType, 'possible_encoding_corruption')
  assert.deepEqual(analysis.conflicts[0].issueTypes, ['possible_encoding_corruption'])
  assert.match(analysis.errors[0], /UTF-8 or UTF-16/)
})

// Real-file audit (Aug 23 2026, chat) -- see getBlankCsvHeaderColumns'
// comment in csvImport.ts. Confirms the products template's own duplicate-
// header warning still fires (discount_ends_at.1/is_active.1, found in the
// user's real uploaded products-template_with_description.csv) AND the new
// blank-header-column warning fires independently, side by side.
await runTest('analyzeProductImportText warns on a blank header column with real data under it', () => {
  const text = 'name,,barcode,selling_price_usd,stock_quantity\nCream,SKU-1,BC-1,3,1'
  const analysis = analyzeProductImportText(text, [])
  assert.equal(analysis.warnings.some((warning) => /Column 2 has no header/.test(warning)), true)
})

await runTest('analyzeProductImportText does not warn about blank headers on a clean file', () => {
  const text = 'name,barcode,selling_price_usd,stock_quantity\nCream,BC-1,3,1'
  const analysis = analyzeProductImportText(text, [])
  assert.equal(analysis.warnings.some((warning) => /no header/.test(warning)), false)
})

await runTest('analyzeProductImportText surfaces both a duplicate-header and a blank-header warning together', () => {
  const text = 'name,barcode,discount_ends_at,,discount_ends_at.1\nCream,BC-1,2026-01-01,stray,2026-02-01'
  const analysis = analyzeProductImportText(text, [])
  assert.equal(analysis.warnings.some((warning) => /Duplicate or near-duplicate/.test(warning)), true)
  assert.equal(analysis.warnings.some((warning) => /Column 4 has no header/.test(warning)), true)
})

await runTest('VIP price: reads the vip_price_* header, honours the legacy special_price_* header, and defaults blank to 0 not the selling price', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Vip New', selling_price_usd: '12', vip_price_usd: '8', stock_quantity: '1' },
    { name: 'Vip Legacy', selling_price_usd: '12', special_price_usd: '7', stock_quantity: '1' },
    { name: 'Vip Blank', selling_price_usd: '12', stock_quantity: '1' },
  ], [])
  const byName = (name: string) => analysis.rows.find((row) => String(row.name) === name)
  assert.equal(Number(byName('Vip New')!.special_price_usd), 8, 'the new vip_price_usd header maps into special_price_usd')
  assert.equal(Number(byName('Vip Legacy')!.special_price_usd), 7, 'the legacy special_price_usd header still works')
  assert.equal(Number(byName('Vip Blank')!.special_price_usd), 0, 'a blank VIP price is 0, NOT the selling price (12) -- defaulting to selling was destroying real VIP prices on re-save')
})

if (failed > 0) {
  process.exitCode = 1
}
