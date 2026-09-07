// The ONE "type or select" field, and the rule behind it.
//
// Owner report (2026-09-06): "categories still does not show the available
// options when i write... like names, brand, supplier etc... especially so
// for add/create products". Three separate causes sat behind one symptom:
//
//   Category  -- its options came from the categories LOOKUP TABLE, which is
//                empty in production. Fixed server-side; pinned by
//                cloudflare/scripts/test-lookup-suggestions-pure.cjs.
//   Supplier  -- ProductForm's private matcher was
//                  `form.supplier ? supplierList.filter(...) : []`
//                so FOCUSING the field offered nothing at all. That is the
//                DISCRIMINATING input below: an empty query.
//   Brand     -- the create-products header used a native <datalist>, which
//                browsers may render or ignore. Pinned as source shape.
//
// Run: node tests/suggestionTextInput.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildSuggestionMatches,
  nextSuggestionIndex,
  normalizeSuggestionOptions,
  shouldPickOnClick,
  suggestionEmptyState,
  PICK_GESTURE_WINDOW_MS,
} from '../src/utils/suggestionMatching.ts'

let passed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (error) {
    console.log(`FAIL ${name} -`, error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

const read = (rel: string): string => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
// Repo-root relative. One claim in this lane spans both packages, and the only
// way it cannot drift is for the same test to read both sides of it.
const readRepo = (rel: string): string => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

// The exact matcher the old private supplier field used, kept here as the
// POSITIVE CONTROL: a test that only ever exercises the new code cannot tell
// a fix from a no-op. Every "old" expectation below is produced by running
// this, not by asserting a remembered value.
function oldSupplierMatcher(options: string[], typed: string): string[] {
  return typed ? options.filter((option) => option.toLowerCase().includes(typed.toLowerCase())) : []
}

const SUPPLIERS = ['Acme Trading', 'Beauty Depot', 'acme trading']

check('DISCRIMINATING: focusing an empty field -- old code offered nothing, new code offers everything', () => {
  assert.deepEqual(oldSupplierMatcher(SUPPLIERS, ''), [], 'positive control: the old matcher really did return [] on focus')
  assert.deepEqual(
    buildSuggestionMatches(SUPPLIERS, '').map((option) => option.value),
    ['Acme Trading', 'Beauty Depot'],
    'an empty query lists every option -- that is the moment the operator does not know what exists',
  )
})

check('the two matchers still agree once something IS typed (nothing else changed)', () => {
  const typed = 'dep'
  assert.deepEqual(
    buildSuggestionMatches(SUPPLIERS, typed).map((option) => option.value),
    oldSupplierMatcher(SUPPLIERS, typed),
    'a typed query narrows exactly as it always did',
  )
})

check('matching is case-insensitive substring, not prefix', () => {
  assert.deepEqual(buildSuggestionMatches(['Makeup - Face', 'Skincare'], 'FACE').map((o) => o.value), ['Makeup - Face'])
  assert.deepEqual(buildSuggestionMatches(['Makeup - Face', 'Skincare'], 'care').map((o) => o.value), ['Skincare'])
})

check('options are de-duplicated case-insensitively, first spelling wins', () => {
  // Imported catalog data carries "Ariana" and "ARIANA"; two rows that render
  // identically are a bug report waiting to happen.
  assert.deepEqual(normalizeSuggestionOptions(['Ariana', 'ARIANA', ' ariana ']).map((o) => o.value), ['Ariana'])
  assert.deepEqual(normalizeSuggestionOptions(['  ', '', null, undefined, 'Real']).map((o) => o.value), ['Real'])
})

check('the meta line is searchable too, so a barcode finds its product row', () => {
  const rows = [{ value: 'Serum', meta: '8801234567890 · Dior' }]
  assert.deepEqual(buildSuggestionMatches(rows, '880123').map((o) => o.value), ['Serum'])
})

check("filter:'none' passes a server-narrowed list straight through", () => {
  // The create-form Name lookup searches by name AND barcode; re-filtering on
  // the typed name would silently drop every barcode hit.
  const rows = [{ value: 'Serum', meta: '8801234567890' }]
  assert.deepEqual(buildSuggestionMatches(rows, 'zzz', { filter: 'none' }).map((o) => o.value), ['Serum'])
  assert.deepEqual(buildSuggestionMatches(rows, 'zzz').map((o) => o.value), [], 'default filtering still narrows')
})

check('keyboard cursor wraps at both ends and starts from nothing highlighted', () => {
  assert.equal(nextSuggestionIndex(-1, 3, 1), 0, 'ArrowDown from nothing lands on the first row')
  assert.equal(nextSuggestionIndex(-1, 3, -1), 2, 'ArrowUp from nothing lands on the last row')
  assert.equal(nextSuggestionIndex(2, 3, 1), 0, 'past the end wraps to the top')
  assert.equal(nextSuggestionIndex(0, 3, -1), 2, 'before the start wraps to the bottom')
  assert.equal(nextSuggestionIndex(0, 0, 1), -1, 'an empty list has nothing to highlight')
})

// --- The cross-surface law: ONE component, and every host renders it.
const component = read('components/shared/SuggestionTextInput.tsx')
const productForm = read('components/products/forms/ProductForm.tsx')
const sessionModal = read('components/products/CreateProductsSessionModal.tsx')
const supplierPicker = read('components/shared/SupplierPickerField.tsx')

check('the shared component is the only copy -- ProductForm no longer defines its own', () => {
  assert.doesNotMatch(productForm, /function SuggestionTextInput\s*\(/, 'the private copy must be deleted, not left beside the shared one')
  assert.match(productForm, /import SuggestionTextInput.*shared\/SuggestionTextInput/, 'ProductForm imports the shared control')
})

check('every catalog field in ProductForm renders the shared control', () => {
  for (const id of ['product-category', 'product-brand', 'product-unit', 'product-supplier']) {
    const at = productForm.indexOf(`id="${id}"`)
    assert.ok(at > 0, `${id} must exist`)
    const nearby = productForm.slice(Math.max(0, at - 400), at)
    assert.match(nearby, /<SuggestionTextInput/, `${id} must be the shared suggestion control`)
  }
  // Name renders TWO ways: the plain read-only input when the name is locked
  // by grouping (there is nothing to suggest -- the field asks for
  // confirmation before it may be typed in at all), and the shared control
  // otherwise. Assert the unlocked branch specifically.
  assert.match(
    productForm,
    /<SuggestionTextInput\s+id="product-name"[\s\S]{0,400}options=\{nameSuggestionOptions\}[\s\S]{0,200}filter="none"/,
    'the editable Name field must offer existing-product suggestions',
  )
  assert.match(productForm, /nameLocked \? \(/, 'the locked variant stays a plain confirm-first input')
})

check('the create-products header dropped the native datalist for the shared control', () => {
  assert.doesNotMatch(sessionModal, /<datalist[ >]/, 'a native datalist renders at the browser\'s discretion -- the owner saw nothing')
  assert.doesNotMatch(sessionModal, /list="create-products-brand-options"/, 'the datalist wiring must go with it')
  assert.match(sessionModal, /<SuggestionTextInput[\s\S]{0,200}id="create-products-brand"/, 'the header Brand renders the shared control')
  assert.match(sessionModal, /id="create-products-brand"[\s\S]{0,200}options=\{brandOptions\}/, 'header and item Brand read the SAME list')
  // Round-2 defect: swapping the datalist for the shared control also demoted
  // the field's <label> to a bare <span>, so the caption stopped being a
  // click/tap target and the control lost its accessible-name association --
  // in a grid where Branch and Received date both still carry real labels.
  // The label stays a SIBLING of the control (htmlFor), never a wrapper: a
  // click on an option row inside a <label> bounces focus back to the input.
  assert.match(sessionModal, /<label htmlFor="create-products-brand"/, 'the header Brand keeps a real label, like every sibling in that grid')
  assert.doesNotMatch(sessionModal, /<span[^>]*>\{tr\('brand', 'Brand'\)\}<\/span>/, 'a bare span is what the label had been demoted to')
})

check('the shared supplier picker delegates to the same control (one implementation)', () => {
  assert.match(supplierPicker, /import SuggestionTextInput/, 'SupplierPickerField wraps the shared control rather than copying it')
  assert.match(supplierPicker, /<SuggestionTextInput/)
  assert.match(
    supplierPicker,
    /if \(option\) onChange\(\{ supplierId: Number\(option\.payload\), supplierName: option\.value \}\)/,
    'a PICK still carries the contact id',
  )
  assert.match(
    supplierPicker,
    /else onChange\(\{ supplierId: null, supplierName: next \}\)/,
    'typing still breaks the contact link -- an id may only come from an explicit pick',
  )
})

check('the control opens on focus AND on typing, and floats above the form', () => {
  assert.match(component, /onFocus=\{\(\) => \{ setOpen\(true\); requestOptions\(\) \}\}/, 'focus opens the list')
  assert.match(component, /onChange=\{\(event\) => \{ onChange\(event\.target\.value\); setOpen\(true\)/, 'typing opens the list')
  assert.match(component, /className="absolute left-0 right-0 top-full z-40/, 'the list floats; it never pushes the form down')
  assert.match(component, /max-h-\[min\(14rem,45vh\)\]/, 'the list is capped against the viewport so it stays on screen at 375px')
})

check('DISCRIMINATING: a tap picks through mousedown -- no onTouchStart may pick', () => {
  // Round-1 defect: the row carried
  //     onTouchStart={(event) => { event.preventDefault(); pick(option) }}
  // preventDefault on touchstart cancels the tap's ENTIRE synthetic mouse
  // sequence and the scroll the gesture might still have become, so dragging
  // a long list to read row 12 picked row 1 the instant the finger landed. It
  // was never needed either: a tap synthesises mousedown BEFORE the focus
  // change that blurs the input, which is exactly why the base
  // SupplierPickerField's mousedown-only picker has worked on its four touch
  // surfaces since D5a.
  assert.doesNotMatch(component, /onTouchStart=\{[^}]*pick\(/, 'no touchstart handler may pick -- scrolling the list must not select a row')
  assert.match(component, /onMouseDown=\{\(event\) => \{ event\.preventDefault\(\); pick\(option\) \}\}/, 'the mousedown fast path is what beats blur, on mouse and touch alike')
  assert.match(component, /onClick=\{\(event\) => \{[\s\S]{0,200}shouldPickOnClick[\s\S]{0,120}pick\(option\)/, 'click is the fallback for a browser that skips the synthetic mousedown')
  assert.match(component, /window\.setTimeout\([\s\S]{0,200}, 120\)/, 'the deferred blur keeps the row mounted long enough for that click to land')
})

check('DISCRIMINATING: the click fallback picks, except when the same tap already picked on mousedown', () => {
  // Positive control -- round 1's onClick could never pick, on ANY input:
  //     onClick={(event) => { event.preventDefault() }}
  const oldClickPicks = (_lastPickAt: number, _now: number): boolean => false
  assert.equal(oldClickPicks(0, 5_000), false, 'positive control: the old click handler really never picked')
  assert.equal(shouldPickOnClick(0, 5_000), true, 'a click with no preceding pick IS the pick')
  assert.equal(shouldPickOnClick(5_000, 5_000 + PICK_GESTURE_WINDOW_MS - 1), false, 'the click of a tap whose mousedown already picked must not pick a second time')
  assert.equal(shouldPickOnClick(5_000, 5_000 + PICK_GESTURE_WINDOW_MS), true, 'a genuinely new gesture picks again')
})

check('DISCRIMINATING: an empty list may only say "nothing saved yet" once its source has reported', () => {
  // Round-1 defect, live on a real host: FastStockInModal renders ProductForm
  // WITHOUT brandOptions, so Brand there had NO source at all -- and the field
  // announced "Nothing saved yet -- type a new one." over a catalog carrying
  // 205 brands. The same sentence was also shown for a query that simply
  // matched none of a full list.
  const oldEmptyHintState = (_sourced: boolean, _optionCount: number): string => 'none-yet'
  assert.equal(oldEmptyHintState(false, 0), 'none-yet', 'positive control: the old hint really was unconditional')
  assert.equal(suggestionEmptyState(false, 0), 'unknown', 'nothing has reported -- there is nothing honest to say')
  assert.equal(suggestionEmptyState(true, 0), 'none-yet', 'the source reported, and it holds nothing')
  assert.equal(suggestionEmptyState(true, 205), 'no-match', 'the source holds 205 brands; none match what was typed')
})

check('Brand owns its own source, so a host that plumbs nothing in still suggests', () => {
  const fastStockIn = read('components/inventory/FastStockInModal.tsx')
  const hostAt = fastStockIn.indexOf('<ProductForm')
  assert.ok(hostAt > 0, 'FastStockInModal renders ProductForm')
  const hostBlock = fastStockIn.slice(hostAt, fastStockIn.indexOf('/>', hostAt))
  // This pin is anchored to the REAL host shape: that file is owned by
  // another lane and supplies no brandOptions, which is precisely why the
  // fallback and the gate below have to live inside ProductForm.
  assert.doesNotMatch(hostBlock, /brandOptions=/, 'this host supplies no brandOptions')
  assert.doesNotMatch(productForm, /brandOptions = \[\]/, 'a [] default makes "did the host supply a list" unanswerable')
  assert.match(productForm, /const brandOptionsProvided = Array\.isArray\(brandOptions\)/, 'ProductForm can tell a supplied list from none')
  assert.match(productForm, /getProductFilters/, 'and falls back to the brands products actually carry')

  const brandAt = productForm.indexOf('id="product-brand"')
  const brandBlock = productForm.slice(brandAt, brandAt + 900)
  assert.doesNotMatch(brandBlock, /emptyHint=\{tr\(/, 'the Brand hint may not be unconditional')
  assert.match(brandBlock, /emptyHint=\{emptyHintFor\(brandSuggestionsSourced/, 'it is gated on the source having reported')
  assert.match(brandBlock, /onRequestOptions=\{ensureBrandSuggestions\}/, 'and the fallback is fetched when the list is actually opened')
  // The once-only guard must be released on failure, or one dropped request
  // silences Brand for the entire life of the form.
  assert.match(productForm, /\.catch\(\(\) => \{ brandFallbackRequestedRef\.current = false \}\)/, 'a failed fallback read may be retried on the next focus')
  assert.doesNotMatch(productForm, /setFallbackBrands\(\[\]\)/, 'and a failure must never be recorded as "this catalog has no brands"')
})

check('every hint in the family answers to the same gate (one rule, one implementation)', () => {
  for (const [id, sourced] of [
    ['product-category', 'categorySuggestionsSourced'],
    ['product-brand', 'brandSuggestionsSourced'],
    ['product-unit', 'unitSuggestionsSourced'],
    ['product-supplier', 'supplierSuggestionsSourced'],
  ]) {
    const at = productForm.indexOf(`id="${id}"`)
    assert.ok(at > 0, `${id} must exist`)
    assert.match(productForm.slice(at, at + 900), new RegExp(`emptyHint=\\{emptyHintFor\\(${sourced}`), `${id}'s hint is gated`)
  }
  assert.match(productForm, /function emptyHintFor[\s\S]{0,400}suggestionEmptyState/, 'the gate is the shared rule, not a per-field literal')
  // Siblings outside ProductForm carry the same rule rather than a copy.
  assert.match(sessionModal, /emptyHint=\{suggestionEmptyState\(brandOptions\.length > 0, brandOptions\.length\) === 'no-match'/, 'the create-products header Brand is gated too')
  const variantModal = read('components/products/forms/VariantFormModal.tsx')
  assert.match(variantModal, /suggestionEmptyState\(/, "the variant form's Supplier is gated too")
})

check('DISCRIMINATING: the supplier rows promise exactly what the read behind them returns', () => {
  // Round-2 defect: the rows mapped a second "meta" line from supplier.company,
  // and the comment above them sold it as the way to tell two contacts with the
  // same personal name apart. But the ONLY supplier read this form is allowed
  // to make is fields=names -- deliberately the one shape reachable without the
  // contacts_suppliers permission -- and that answers SELECT id, name. The line
  // could never render online; only a stale offline mirror (written by the
  // full read, which needs that permission) could ever have produced one, so
  // the "disambiguator" was present or absent depending on who you were and
  // whether you had been offline. Pinning BOTH sides here is what stops the
  // claim and the read drifting apart again.
  const contactsRoute = readRepo('cloudflare/src/routes/contacts.ts')
  assert.match(
    contactsRoute,
    /fields \|\| ''\) === 'names'[\s\S]{0,400}SELECT id, name FROM/,
    'fields=names really is id + name only',
  )
  assert.match(productForm, /getSuppliers\(\{ fields: 'names' \}\)/, 'and that is the read ProductForm makes')
  const supplierAt = productForm.indexOf('const supplierSuggestionOptions')
  assert.ok(supplierAt > 0, 'the supplier option mapping must exist')
  const block = productForm.slice(Math.max(0, supplierAt - 700), supplierAt + 500)
  assert.doesNotMatch(block, /supplier\.company/, 'a column that read never returns may not be mapped')
  assert.match(block, /name-only/, 'and the comment says name-only rather than promising a company line')
})

check('the list is a real combobox for keyboard and screen readers', () => {
  assert.match(component, /role="combobox"/)
  assert.match(component, /aria-expanded=\{listOpen\}/)
  assert.match(component, /role="listbox"/)
  assert.match(component, /role="option"/)
  assert.match(component, /aria-activedescendant=/)
  for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Enter']) {
    assert.ok(component.includes(`'${key}'`), `${key} must be handled`)
  }
})

check('rows wrap instead of truncating -- no suggestion hides behind an ellipsis', () => {
  assert.doesNotMatch(component, /class[^"]*"[^"]*\btruncate\b/, 'a truncated suggestion is the ambiguity this control removes')
  assert.match(component, /break-words/)
})

check('Enter is only swallowed when it is actually taking a suggestion', () => {
  const at = component.indexOf("event.key === 'Enter'")
  assert.ok(at > 0)
  const block = component.slice(at, at + 260)
  assert.match(block, /open && cursor >= 0 && matches\[cursor\]/, 'otherwise Enter must keep reaching the form')
})

if (!process.exitCode) console.log(`\n${passed} checks passed`)
