// Products bulk-edit panels (Info / Pricing / Stock / Move stock) were raw
// English -- audit finding "products-bulkedit-i18n" (i18n:1, i18n:2, i18n:3),
// plus a Round-2 verifier finding that the Stock panel (the fourth panel,
// inside this lane's own declared region) was left untranslated even though
// its mode chip ("Stock" / stock_short) IS translated, and that the first
// round invented a competing prefix+bare-number+suffix i18n mechanism that
// structurally cannot reorder for Khmer word order. This file proves:
//   1. every panel resolves its strings through tr()/t() against real pack
//      keys, and the literal English strings are gone from all four panels;
//   2. the one-rule-one-implementation fix: no bulk-edit key is a sentence
//      fragment (a `_prefix`/`_suffix` key) -- each count sentence is ONE key
//      carrying a single {count} placeholder, substituted the same way as
//      every other {count}-templated key in this codebase (see the comment
//      by productSelectedLabel above, and ExportFieldsModal.tsx).
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
const stockPanel = sliceBetween(
  "hasSelected && bulkEditMode === 'stock'",
  "hasSelected && bulkEditMode === 'branch'",
)
const movePanel = sliceBetween(
  "hasSelected && bulkEditMode === 'branch'",
  '{/* A-Z filter row removed',
)

const NEW_KEYS = [
  'bulk_edit_update_info_for_count',
  'bulk_edit_update_pricing_for_count',
  'bulk_edit_adjust_stock_for_count',
  'bulk_edit_move_stock_to_branch_for_count',
  'bulk_edit_apply_to_count',
  'bulk_price_khr_auto_note',
  'keep_current',
  'leave_blank_to_keep',
  'target_branch',
  'select_branch_first',
]

// The keys the Round-1 commit introduced and that the Round-2 fix retires:
// a prefix + bare JSX number + suffix cannot reorder for Khmer, where the
// count follows the noun ("ផលិតផលចំនួន {count}") not the English order.
const RETIRED_KEYS = ['bulk_edit_apply_to_prefix', 'bulk_edit_products_count_suffix']

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

await runTest('bulk-edit i18n: no sentence-fragment (_prefix/_suffix) keys remain, and count keys carry {count}', () => {
  for (const key of RETIRED_KEYS) {
    assert.equal(en[key], undefined, `en.json still has retired fragment key '${key}'`)
    assert.equal(km[key], undefined, `km.json still has retired fragment key '${key}'`)
    assert.doesNotMatch(source, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Products.tsx still references retired key '${key}'`)
  }
  // Every key this lane's bulk-edit region references that carries a count
  // must be ONE key with a literal {count} placeholder -- never split into a
  // separate prefix/suffix pair, and never itself named *_prefix/*_suffix.
  const countKeys = [
    'bulk_edit_update_info_for_count',
    'bulk_edit_update_pricing_for_count',
    'bulk_edit_adjust_stock_for_count',
    'bulk_edit_move_stock_to_branch_for_count',
    'bulk_edit_apply_to_count',
  ]
  for (const key of countKeys) {
    assert.doesNotMatch(key, /_prefix$|_suffix$/, `count key '${key}' is itself a sentence fragment`)
    assert.match(en[key] as string, /\{count\}/, `en.json '${key}' must contain a {count} placeholder`)
    assert.match(km[key] as string, /\{count\}/, `km.json '${key}' must contain a {count} placeholder`)
  }
  // No key anywhere in either pack is a bare sentence-fragment key (the
  // pre-existing, unrelated 'object_prefix' R2 setting is not a sentence
  // fragment and is excluded).
  const fragmentKeys = Object.keys(en).filter((k) => (k.endsWith('_prefix') || k.endsWith('_suffix')) && k !== 'object_prefix')
  assert.deepEqual(fragmentKeys, [], `unexpected sentence-fragment keys survive in en.json: ${fragmentKeys.join(', ')}`)
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

  assert.match(infoPanel, /tr\('bulk_edit_update_info_for_count', 'Update basic info for \{count\} products'\)/)
  assert.match(infoPanel, /tr\('category', 'Category'\)/)
  assert.match(infoPanel, /tr\('unit', 'Unit'\)/)
  assert.match(infoPanel, /tr\('supplier', 'Supplier'\)/)
  assert.match(infoPanel, /tr\('keep_current', 'Keep current'\)/g)
  assert.equal((infoPanel.match(/tr\('keep_current', 'Keep current'\)/g) || []).length, 2, 'expected Category AND Unit to both offer the Keep-current option')
  assert.match(infoPanel, /tr\('leave_blank_to_keep', 'Leave blank to keep'\)/)
  assert.match(infoPanel, /tr\('low_stock_threshold', 'Low Stock Threshold'\)/)
  assert.match(infoPanel, /tr\('bulk_edit_apply_to_count', 'Apply to \{count\} products'\)\.replace\('\{count\}', String\(selectedVisibleCount\)\)/)
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

  assert.match(pricingPanel, /tr\('bulk_edit_update_pricing_for_count', 'Update pricing for \{count\} products'\)/)
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
  assert.match(pricingPanel, /tr\('bulk_edit_apply_to_count', 'Apply to \{count\} products'\)\.replace\('\{count\}', String\(selectedVisibleCount\)\)/)
})

await runTest('bulk-edit Stock panel: heading, Quantity/Action labels and Apply button are translated', () => {
  assert.doesNotMatch(stockPanel, /Adjust stock for <strong>/, 'heading still hardcoded English')
  assert.doesNotMatch(stockPanel, />Quantity<\/label>/, 'Quantity label still hardcoded')
  assert.doesNotMatch(stockPanel, />Action<\/label>/, 'Action label still hardcoded')
  assert.doesNotMatch(stockPanel, />Apply to \{selectedVisibleCount\} products</, 'Apply button still hardcoded')

  assert.match(stockPanel, /tr\('bulk_edit_adjust_stock_for_count', 'Adjust stock for \{count\} products'\)/)
  assert.match(stockPanel, /tr\('quantity', 'Quantity'\)/)
  assert.match(stockPanel, /tr\('action', 'Action'\)/)
  assert.match(stockPanel, /tr\('bulk_edit_apply_to_count', 'Apply to \{count\} products'\)\.replace\('\{count\}', String\(selectedVisibleCount\)\)/)
  // Add/Remove/Set action chips were already translated before this lane.
  assert.match(stockPanel, /t\('add'\)\s*\|\|\s*'Add'/)
  assert.match(stockPanel, /t\('remove'\)/)
  assert.match(stockPanel, /t\('set'\)/)
})

await runTest('bulk-edit Move-stock panel: label, options, button and error toast are translated', () => {
  assert.doesNotMatch(movePanel, /Move stock to a branch for <strong>/, 'heading still hardcoded English')
  assert.doesNotMatch(movePanel, />Target Branch<\/label>/, 'Target Branch label still hardcoded')
  assert.doesNotMatch(movePanel, /ariaLabel="Target Branch"/, 'Target Branch ariaLabel still hardcoded')
  assert.doesNotMatch(movePanel, /'Select branch'(?!\)|,)/, "'Select branch' option label still a bare literal")
  assert.doesNotMatch(movePanel, />Move Stock</, 'Move Stock button still hardcoded')
  assert.doesNotMatch(movePanel, /notify\('Select a branch first','error'\)/, 'error toast still hardcoded')

  assert.match(movePanel, /tr\('bulk_edit_move_stock_to_branch_for_count', 'Move stock to a branch for \{count\} products'\)/)
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
