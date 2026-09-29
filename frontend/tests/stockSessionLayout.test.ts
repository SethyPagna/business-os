// UI-STOCK S2-S13 layout rules for the Stock Session float, read from source:
// the mode is the title, the shared details never change shape, labels live
// inside the controls, and the buttons carry the owner's words.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const src = (relative: string): string => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
const modal = src('components/inventory/FastStockInModal.tsx')
const header = src('components/stock-session/StockSessionHeader.tsx')
const shared = src('components/stock-session/StockSessionSharedDetails.tsx')
const entry = src('components/stock-session/StockSessionLineEntry.tsx')
const items = src('components/stock-session/StockSessionItems.tsx')
const footer = src('components/stock-session/StockSessionFooter.tsx')
const review = src('components/stock-session/StockSessionReviewStep.tsx')
const reasonField = src('components/shared/StockReasonField.tsx')
const supplierField = src('components/shared/SupplierPickerField.tsx')
const tagRow = src('components/inventory/StockConditionTagRow.tsx')
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

runTest('S6: no text title -- the Add | Remove | Set control is the header, in the stock words', () => {
  assert.doesNotMatch(modal, /fast_stockin_title/, 'the old "Fast stock-in" title is gone')
  assert.doesNotMatch(modal, /<h2/, 'no text heading in the float')
  for (const key of ['adjust_add', 'adjust_remove', 'adjust_set']) assert.match(header, new RegExp(`'${key}'`))
  assert.doesNotMatch(header, /tr\('remove'/, 'Remove is ដក (adjust_remove), never លុប (remove)')
  assert.equal(km.adjust_remove, 'ដក')
  assert.match(header, /role="radiogroup"/)
  assert.match(header, /grid-cols-3/, 'the three modes share the whole row equally')
  assert.match(header, /stock_session_switch_blocked/, 'a locked mode says why')
  assert.match(header, /MinimizeButton/)
  assert.match(modal, /aria-label=\{sessionLabel\}/, 'the dialog is named by its mode')
})

runTest('S2: the float opens straight into the session -- no mode chips or scope toggle inside the body', () => {
  assert.doesNotMatch(modal, /stock_set_scope_(lot|branch)|selected_received_date/, 'no "Selected received date / Branch total" toggle')
  assert.doesNotMatch(modal, /aria-pressed=\{mode === option\}/, 'the old in-body mode chips are gone')
  assert.doesNotMatch(entry, /setSetScope|stock_set_scope/)
})

runTest('S5/S9/S11: the shared details are the same two rows in every mode, labels inside the controls', () => {
  assert.doesNotMatch(modal, /receiptFieldsRelevant/, 'the shared block no longer changes shape per mode')
  assert.match(shared, /'applies_to_every_line'/)
  assert.doesNotMatch(shared, /fast_stockin_header|shipment/i)
  assert.doesNotMatch(shared, /mode\s*[!=]==|StockMode/, 'the shared block does not branch on the mode')
  for (const icon of ['Award', 'Store', 'CalendarDays']) assert.match(shared, new RegExp(`icon=\\{${icon}\\}`))
  assert.match(shared, /variant="compact"/, 'Supplier uses the compact picker')
  assert.match(shared, /grid-cols-2 gap-1\.5 sm:grid-cols-4/, 'two per row on a phone, one row of four on desktop')
  assert.doesNotMatch(shared, /mb-1 block text-\[11px\]/, 'no caption above an input')
  assert.match(supplierField, /variant === 'compact'/)
  assert.match(supplierField, /placeholder=\{label\}/, 'the compact supplier box reads "Supplier"')
  assert.doesNotMatch(modal, /stock_receipt_free_goods/, 'Free is a line cell, never a shared detail')
})

runTest('S3/S4: one Received date select, one Tag select, and the reason row with manage and Add', () => {
  assert.doesNotMatch(entry, /rounded-full border px-2\.5/, 'received dates are no longer a wrapping chip list')
  assert.match(entry, /<AppSelect[\s\S]{0,200}value=\{lotValue\}/, 'the received date is one select')
  assert.match(entry, /variant="select"/, 'the tag is one select')
  assert.match(tagRow, /variant === 'select'/)
  assert.match(tagRow, /'stock_tag_sellable'/)
  assert.match(entry, /variant="compact"[\s\S]{0,400}onManage=\{onManageReasons\}/, 'the reason row keeps its manage button')
  assert.match(reasonField, /Settings2/, 'manage is an icon')
  assert.match(modal, /StockReasonsManagerModal/, 'manage opens the stock reasons manager')
  assert.match(modal, /reloadReasons/, 'closing the manager reloads the options')
})

runTest('S13: the line button reads "Add" (or "Save"), text only; the finish button is "Complete Session"', () => {
  assert.match(entry, /\{editing \? tr\('save', 'Save'\) : tr\('add', 'Add'\)\}/)
  assert.doesNotMatch(entry, /fast_stockin_add|＋|update_line/, 'no "+ Add & next", no glyph')
  assert.match(modal, /'complete_session'/)
  assert.doesNotMatch(modal, /complete_stock_session|complete_stock_session_changes|Post stock changes/)
  assert.doesNotMatch(footer + modal, /✓|⏳/, 'no glyphs on the primary button')
  assert.doesNotMatch(modal, /add_next_hint|lines_queued/, 'no "i" button, no "queued"')
  assert.match(footer, /'items'/, 'the footer counts Items')
  assert.match(footer, /flex-1/, 'the primary button takes the rest of the row')
})

runTest('S13: "Items" is the list; one compact row per line; no Existing badge', () => {
  assert.match(items, /tr\('items', 'Items'\)/)
  assert.doesNotMatch(items, /stock_session_existing_product/)
  assert.match(items, /aria-label=\{tr\('remove', 'Remove'\)\}/, 'trash is icon-only with a name')
  assert.doesNotMatch(items, /Pencil/, 'tapping the row edits; no separate pencil')
})

runTest('no helper paragraphs or info icons inside the float', () => {
  for (const [name, text] of [['modal', modal], ['entry', entry], ['shared', shared], ['items', items], ['footer', footer], ['review', review]] as const) {
    assert.doesNotMatch(text, /InfoHint/, `${name} still renders an info icon`)
  }
  assert.doesNotMatch(modal, /ConfirmDialog/, 'the Review step replaces the popup confirm')
})

runTest('every key the float reads exists in both packs (section 12)', () => {
  const flat = (tree: Record<string, unknown>, into: Record<string, unknown> = {}): Record<string, unknown> => {
    for (const [key, value] of Object.entries(tree)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) flat(value as Record<string, unknown>, into)
      else into[key] = value
    }
    return into
  }
  const enFlat = flat(en)
  const kmFlat = flat(km)
  for (const key of ['stock_session', 'stock_session_review', 'complete_session', 'applies_to_every_line', 'stock_session_search',
    'create_named_product', 'stock_line_qty', 'received_date_new', 'stock_set_branch_total', 'stock_tag_sellable',
    'stock_session_switch_blocked', 'paid_to_supplier', 'owed_to_supplier', 'items_total', 'stock_difference',
    'match_cost_to_paid', 'reset_costs', 'items_total_zero', 'supplier_total_mismatch', 'price_edit_required',
    'free_quantity_not_receipt', 'stock_free_suffix']) {
    assert.equal(typeof enFlat[key], 'string', `en.json lacks ${key}`)
    assert.equal(typeof kmFlat[key], 'string', `km.json lacks ${key}`)
  }
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock session layout test(s) failed`)
} else {
  console.log('\nAll stock session layout tests passed')
}
