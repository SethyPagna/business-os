// UI-STOCK S2-S13 layout rules for the Stock Session float, read from source:
// the mode is the title, the shared details never change shape, labels live
// inside the controls, and the buttons carry the owner's words.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

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
  assert.match(shared, /useSupplierSuggestions\(/, 'the compact Supplier box runs on the picker\'s own names read and resolver')
  assert.match(shared, /placeholder=\{label\}/, 'the compact supplier box reads "Supplier"')
  assert.match(shared, /grid-cols-2 gap-1\.5 sm:grid-cols-4/, 'two per row on a phone, one row of four on desktop')
  assert.doesNotMatch(shared, /mb-1 block text-\[11px\]/, 'no caption above an input')
  assert.match(supplierField, /export function useSupplierSuggestions\(/, 'one names read and one resolver behind both boxes')
  assert.doesNotMatch(modal, /stock_receipt_free_goods/, 'Free is a line cell, never a shared detail')
})

runTest('S3/S4: one Received date select, one Tag select, and the reason row with manage and Add', () => {
  assert.doesNotMatch(entry, /rounded-full border px-2\.5/, 'received dates are no longer a wrapping chip list')
  assert.match(entry, /<AppSelect[\s\S]{0,200}value=\{lotValue\}/, 'the received date is one select')
  assert.match(entry, /variant="select"/, 'the tag is one select')
  assert.match(tagRow, /variant === 'select'/)
  assert.match(tagRow, /'stock_tag_sellable'/)
  assert.match(entry, /onClick=\{onManageReasons\}[\s\S]{0,500}<Settings2/, 'the reason row keeps its manage icon button')
  assert.match(entry, /next\.slice\(0, REASON_MAX_LENGTH\)/, 'the reason box keeps the 500-character clamp')
  assert.match(modal, /StockReasonsManagerModal/, 'manage opens the stock reasons manager')
  assert.match(modal, /reloadReasons/, 'closing the manager reloads the options')
})

runTest('manage reasons: the icon shows only for users the Worker lets save reasons (inventory edit_reasons)', () => {
  assert.match(modal, /const canEditReasons = permissions\.can\('inventory', 'edit_reasons'\)/)
  assert.match(modal, /onManageReasons=\{canEditReasons \? \(\) => setReasonsOpen\(true\) : undefined\}/)
  assert.match(entry, /\{onManageReasons \? \(\s*<button[\s\S]{0,200}onClick=\{onManageReasons\}/, 'no dead manage button for users who cannot save')
  const worker = readFileSync(new URL('../../cloudflare/src/routes/inventory.ts', import.meta.url), 'utf8')
  const put = worker.slice(worker.indexOf("app.put('/reasons'"), worker.indexOf("app.put('/reasons'") + 400)
  assert.match(put, /getActionTier\(user, 'inventory', 'edit_reasons'\) === 'none'[\s\S]{0,120}403/, 'the Worker refuses the same users')
})

runTest('a received-date read that fails says so, not "Failed to load products"', () => {
  assert.doesNotMatch(modal, /key: 'load_failed'/)
  assert.match(modal, /key: 'batches_load_failed', fallback: 'Could not load received dates\.'/)
})

runTest('360 px: no mode or select text is clipped (browser pass, 30 Sep: "Rem…", "New · 3…", "Sella…")', () => {
  // Measured at 360: "Remove" needed 67 px in a 63 px segment; the lot and
  // tag selects kept 49 and 25 px for their text. Phones split the row.
  assert.match(header, /min-w-0 truncate rounded-\[0\.6rem\] px-1 /, 'the mode segments keep 1 px-unit padding so "Remove" fits')
  const rows = [...entry.matchAll(/<div className="(grid grid-cols-[^ ]+ gap-1\.5 sm:grid-cols-\[[^"]+\])">/g)].map((match) => match[1])
  assert.equal(rows.length, 2, 'the Add E3 row and the Remove/Set row are two columns on a phone')
  assert.match(rows[0], /^grid grid-cols-2 /, 'Add: Expiry and Tag share the second phone row equally')
  // "Remove entirely" needed 102 px of text room in an even half (86 px).
  assert.match(rows[1], /^grid grid-cols-\[minmax\(0,0\.7fr\)_minmax\(0,1\.3fr\)\] /, 'Remove/Set: the Tag select gets the wider phone cell')
  for (const row of rows) assert.match(row, /sm:grid-cols-\[minmax\(0,1\.5fr\)_minmax\(0,(1\.2|0\.8)fr\)_minmax\(0,1\.2fr\)\]/, 'one row from sm up, as the spec draws it')
  assert.match(entry, /<div className="col-span-2 sm:col-span-1">\s*\{lotSelect\}/, 'the received date takes the whole first phone row')
  assert.equal((entry.match(/\{lotSelect\}/g) || []).length, 2)
})

runTest('Khmer: the labels inside the number cells keep a Khmer line box (browser pass, lang=km at 360)', () => {
  // khmerRoom measured line-height 9/9 on ចំនួន, ថ្លៃដើម, តម្លៃ.
  for (const [name, text] of [['shared', shared], ['entry', entry]] as const) {
    for (const match of text.matchAll(/<span className="([^"]*text-\[9px\][^"]*)"/g)) {
      assert.doesNotMatch(match[1], /leading-none/, `${name}: an inset label squeezes Khmer to a 1.0 line height`)
      assert.match(match[1], /leading-\[1\.6\]/, `${name}: an inset label gets the Khmer line height`)
    }
  }
  assert.match(shared, /text-\[9px\]/, 'the inset label is still there')
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

runTest('Items and Review show the barcode under the name: two child rows of one name differ only by it', () => {
  // The old queue did this (tests/stockInSessionProductNames); the rewrite lost it.
  const barcodeLine = /\{(line\.product|review)\.barcode \? <span className="block break-all dense-id text-\[10px\] text-gray-400">\{(line\.product|review)\.barcode\}<\/span> : null\}/
  assert.match(items, barcodeLine, 'Items: the barcode sits under the name')
  assert.match(review, barcodeLine, 'Review: the barcode sits under the name')
  assert.match(src('utils/stockSessionDraft.ts'), /barcode: String\(line\.product\.barcode \|\| ''\)/, 'the review carries the barcode')
})

runTest('build: the catalog closure does not grow -- the compact controls live in the lazy float, not components/shared', () => {
  // components/shared is vite.config.ts's app-shared catch-all, which the public
  // catalog loads. Measured 30 Sep: the compact variants added 2.5 KB there.
  assert.doesNotMatch(reasonField, /variant\b|MessageSquare|SuggestionTextInput/, 'StockReasonField is back to its one shape')
  assert.doesNotMatch(supplierField, /variant ===|variant\?:|Truck/, 'SupplierPickerField renders no compact shape')
})

runTest('build: an icon in a shared stock control never pulls the public catalog into app-shared', () => {
  // 30 Sep build: StockReasonField's MessageSquare was also PublicCatalogPage's,
  // Rollup put it in catalog-public, and app-shared -> catalog-public closed a cycle.
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  const pinned = new Set([...vite.matchAll(/const (?:routeSharedIconNames|appShellIconNames) = new Set\(\[([^\]]*)\]\)/g)]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((name) => name[1])))
  assert.ok(pinned.has('truck') && pinned.has('settings-2'), 'read the shared-ui icon sets from vite.config.ts')
  const catalogDir = new URL('../src/components/catalog/', import.meta.url)
  const catalogIcons = new Set(readdirSync(catalogDir, { recursive: true }).map(String).filter((file) => /\.tsx?$/.test(file))
    .flatMap((file) => [...readFileSync(new URL(file.replace(/\\/g, '/'), catalogDir), 'utf8').matchAll(/lucide-react\/dist\/esm\/icons\/([a-z0-9-]+)\.js/g)].map((match) => match[1])))
  assert.ok(catalogIcons.size > 0, 'read the catalog icon imports')
  for (const [name, text] of [['StockReasonField', reasonField], ['SupplierPickerField', supplierField], ['StockConditionTagRow', tagRow]] as const) {
    for (const [, icon] of text.matchAll(/lucide-react\/dist\/esm\/icons\/([a-z0-9-]+)\.js/g)) {
      assert.ok(pinned.has(icon) || !catalogIcons.has(icon), `${name} imports "${icon}", which the public catalog also imports and vite.config.ts does not pin to shared-ui`)
    }
  }
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

runTest('iOS: no raw vh in the float -- a dropdown height rides --app-vh like every modal', () => {
  // iosLayoutGuards D4 freezes the raw-vh files; the float must not join them.
  for (const [name, text] of Object.entries({ modal, header, shared, entry, items, footer, review })) {
    assert.doesNotMatch(text.replace(/var\(--app-vh, 1vh\)/g, ''), /(?<![a-z-])\d+(?:\.\d+)?vh\b/, name + ' uses a raw vh unit')
  }
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock session layout test(s) failed`)
} else {
  console.log('\nAll stock session layout tests passed')
}
