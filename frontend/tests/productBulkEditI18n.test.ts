// Products bulk-edit panels (Info / Pricing / Move stock) were three whole
// panels of raw English -- audit finding "products-bulkedit-i18n" (i18n:1,
// i18n:2, i18n:3). Only the Brand label (Info) and the wholesale rows +
// relative-adjustment block (Pricing) had already been wired through
// tr()/t(); everything else -- headings, Category/Unit/Supplier/Target
// Branch labels, the "Keep current"/"Select branch" option labels, every
// "Leave blank to keep" placeholder, the Low Stock Threshold label, the KHR
// auto-calc note, both "Apply to N products" buttons, the "Move Stock"
// button and its "Select a branch first" error toast -- rendered in English
// even in Khmer mode. This file proves each of those now resolves through
// tr()/t() against real pack keys, and that the literal English strings
// are gone from the three panels' source.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
type TestCallback = () => void | Promise<void>
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

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const source = fs.readFileSync(path.join(SRC, 'components', 'products', 'Products.tsx'), 'utf8')
const en = JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'en.json'), 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'km.json'), 'utf8')) as Record<string, unknown>

// Isolate each panel by its bulkEditMode guard so a regression in one panel
// cannot hide behind an unrelated, already-translated one.
const sliceBetween = (startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `marker not found: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `end marker not found after start: ${endMarker}`)
  return source.slice(start, end)
}

const infoPanel = sliceBetween(
  "hasSelected && bulkEditMode === 'info'",
  "hasSelected && bulkEditMode === 'pricing'",
)
const pricingPanel = sliceBetween(
  "hasSelected && bulkEditMode === 'pricing'",
  "hasSelected && bulkEditMode === 'stock'",
)
const movePanel = sliceBetween(
  "hasSelected && bulkEditMode === 'branch'",
  '{/* A-Z filter row removed',
)

const NEW_KEYS = [
  'bulk_edit_update_info_for',
  'bulk_edit_update_pricing_for',
  'bulk_edit_move_stock_to_branch_for',
  'bulk_edit_products_count_suffix',
  'bulk_edit_apply_to_prefix',
  'bulk_price_khr_auto_note',
  'keep_current',
  'leave_blank_to_keep',
  'target_branch',
  'select_branch_first',
]

await runTest('bulk-edit i18n: every new key exists in both packs with non-placeholder Khmer', () => {
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], 'string', `en.json missing '${key}'`)
    assert.equal(typeof km[key], 'string', `km.json missing '${key}'`)
    assert.notEqual((en[key] as string).trim(), '', `en.json '${key}' is empty`)
    const kmValue = km[key] as string
    assert.notEqual(kmValue.trim(), '', `km.json '${key}' is empty`)
    assert.notEqual(kmValue, en[key], `km.json '${key}' was not actually translated (equals English)`)
    assert.match(kmValue, /[ក-៿]/, `km.json '${key}' contains no Khmer script: ${kmValue}`)
  }
})

await runTest('bulk-edit Info panel: heading, field labels and placeholders are translated', () => {
  assert.doesNotMatch(infoPanel, /Update basic info for <strong>/, 'heading still hardcoded English')
  assert.doesNotMatch(infoPanel, />Category<\/label>/, 'Category label still hardcoded')
  assert.doesNotMatch(infoPanel, />Unit<\/label>/, 'Unit label still hardcoded')
  assert.doesNotMatch(infoPanel, />Supplier<\/label>/, 'Supplier label still hardcoded')
  assert.doesNotMatch(infoPanel, /label: 'Keep current' \}/, "'Keep current' option label still a bare literal")
  assert.doesNotMatch(infoPanel, /"Leave blank to keep"/, 'placeholder still hardcoded')
  assert.doesNotMatch(infoPanel, />Low Stock Threshold<\/label>/, 'Low Stock Threshold label still hardcoded')
  assert.doesNotMatch(infoPanel, />Apply to \{selectedVisibleCount\} products</, 'Apply button still hardcoded')

  assert.match(infoPanel, /tr\('bulk_edit_update_info_for', 'Update basic info for'\)/)
  assert.match(infoPanel, /tr\('category', 'Category'\)/)
  assert.match(infoPanel, /tr\('unit', 'Unit'\)/)
  assert.match(infoPanel, /tr\('supplier', 'Supplier'\)/)
  assert.match(infoPanel, /tr\('keep_current', 'Keep current'\)/g)
  assert.equal((infoPanel.match(/tr\('keep_current', 'Keep current'\)/g) || []).length, 2, 'expected Category AND Unit to both offer the Keep-current option')
  assert.match(infoPanel, /tr\('leave_blank_to_keep', 'Leave blank to keep'\)/)
  assert.match(infoPanel, /tr\('low_stock_threshold', 'Low Stock Threshold'\)/)
  assert.match(infoPanel, /tr\('bulk_edit_apply_to_prefix', 'Apply to'\)/)
  // Brand was already translated before this lane -- must still be intact.
  assert.match(infoPanel, /\{t\('brand'\)\|\|'Brand'\}/)
})

await runTest('bulk-edit Pricing panel: price labels, placeholders and auto-calc note are translated', () => {
  assert.doesNotMatch(pricingPanel, /Update pricing for <strong>/, 'heading still hardcoded English')
  assert.doesNotMatch(pricingPanel, />Selling Price \(USD\)<\/label>/, 'Selling Price (USD) label still hardcoded')
  assert.doesNotMatch(pricingPanel, />Selling Price \(KHR\)<\/label>/, 'Selling Price (KHR) label still hardcoded')
  assert.doesNotMatch(pricingPanel, />Purchase Price \(USD\)<\/label>/, 'Purchase Price (USD) label still hardcoded')
  assert.doesNotMatch(pricingPanel, />Purchase Price \(KHR\)<\/label>/, 'Purchase Price (KHR) label still hardcoded')
  assert.doesNotMatch(pricingPanel, /"Leave blank to keep"/, 'a placeholder is still hardcoded')
  assert.doesNotMatch(pricingPanel, />KHR prices will auto-calculate at current exchange rate</, 'auto-calc note still hardcoded')

  assert.match(pricingPanel, /tr\('bulk_edit_update_pricing_for', 'Update pricing for'\)/)
  assert.match(pricingPanel, /tr\('selling_price_usd', 'Selling Price \(USD\)'\)/)
  assert.match(pricingPanel, /tr\('selling_price_khr', 'Selling Price \(KHR\)'\)/)
  assert.match(pricingPanel, /tr\('purchase_price_usd', 'Purchase Price \(USD\)'\)/)
  assert.match(pricingPanel, /tr\('purchase_price_khr', 'Purchase Price \(KHR\)'\)/)
  assert.match(pricingPanel, /tr\('bulk_price_khr_auto_note', 'KHR prices will auto-calculate at current exchange rate'\)/)
  // All six price inputs (selling x2, wholesale x2, purchase x2) share the
  // one placeholder key -- count them so a missed input can't hide.
  assert.equal((pricingPanel.match(/tr\('leave_blank_to_keep', 'Leave blank to keep'\)/g) || []).length, 6, 'expected all 6 price placeholders to use leave_blank_to_keep')
  // Wholesale labels were already translated before this lane -- must still be intact.
  assert.match(pricingPanel, /tr\('wholesale_price_usd_full'/)
  assert.match(pricingPanel, /tr\('wholesale_price_khr_full'/)
  assert.match(pricingPanel, /tr\('bulk_edit_apply_to_prefix', 'Apply to'\)/)
})

await runTest('bulk-edit Move-stock panel: label, options, button and error toast are translated', () => {
  assert.doesNotMatch(movePanel, /Move stock to a branch for <strong>/, 'heading still hardcoded English')
  assert.doesNotMatch(movePanel, />Target Branch<\/label>/, 'Target Branch label still hardcoded')
  assert.doesNotMatch(movePanel, /ariaLabel="Target Branch"/, 'Target Branch ariaLabel still hardcoded')
  assert.doesNotMatch(movePanel, /'Select branch'(?!\)|,)/, "'Select branch' option label still a bare literal")
  assert.doesNotMatch(movePanel, />Move Stock</, 'Move Stock button still hardcoded')
  assert.doesNotMatch(movePanel, /notify\('Select a branch first','error'\)/, 'error toast still hardcoded')

  assert.match(movePanel, /tr\('bulk_edit_move_stock_to_branch_for', 'Move stock to a branch for'\)/)
  assert.match(movePanel, /tr\('target_branch', 'Target Branch'\)/g)
  assert.equal((movePanel.match(/tr\('target_branch', 'Target Branch'\)/g) || []).length, 2, 'expected both the label AND the ariaLabel to use target_branch')
  assert.match(movePanel, /tr\('select_branch', 'Select branch'\)/)
  assert.match(movePanel, /tr\('move_stock', 'Move Stock'\)/)
  assert.match(movePanel, /notify\(tr\('select_branch_first', 'Select a branch first'\),\s*'error'\)/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
