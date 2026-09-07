// Name suggestions on the CREATE product form.
//
// Owner report (2026-09-06): typing into Name offered NOTHING -- "no
// suggestion source exists at all" on the rig. Root cause: the form already
// ran a debounced existing-product lookup (min 2 characters, 350ms) to power
// the one-line "this name already exists" hint, but its rows were never
// offered as a picklist. Nothing new is fetched; the same read now also
// renders as suggestions.
//
// The owner's standing rule this must not break: a suggestion NEVER
// auto-picks. Choosing a row fills the NAME TEXT ONLY -- it does not load
// that product, switch the form to editing it, or add a session line.
//
// Run: node tests/productNameSuggestions.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  PRODUCT_MATCH_DEBOUNCE_MS,
  PRODUCT_MATCH_MIN_CHARS,
  buildProductNameSuggestions,
  productMatchQueries,
  shouldSearchProductMatches,
} from '../src/components/products/helpers/productNameSuggestions.ts'

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

const CANDIDATES = [
  { id: 12, name: 'Dior Sauvage', barcode: '3348901250115', brand: 'Dior' },
  { id: 13, name: 'Dior Sauvage', barcode: '03348901250115', brand: 'Dior' },
  { id: 12, name: 'Dior Sauvage', barcode: '3348901250115', brand: 'Dior' },
  { id: 14, name: 'Diorshow Mascara', barcode: '', brand: '' },
  { id: 15, name: '   ', barcode: '999', brand: 'Ghost' },
]

check('DISCRIMINATING: matched products become suggestion rows (there was no source at all before)', () => {
  const rows = buildProductNameSuggestions(CANDIDATES)
  assert.deepEqual(rows.map((row) => row.value), ['Dior Sauvage', 'Dior Sauvage', 'Diorshow Mascara'])
})

check('a row shows name + barcode + brand, so the operator recognises WHICH product it is', () => {
  const rows = buildProductNameSuggestions(CANDIDATES)
  assert.equal(rows[0].meta, '3348901250115 · Dior')
  assert.equal(rows[1].meta, '03348901250115 · Dior', 'the zero-padded twin is a DIFFERENT row and must stay distinguishable')
  assert.equal(rows[2].meta, undefined, 'a product with neither barcode nor brand shows no second line')
})

check('the same product arriving from both the name and the barcode query appears once', () => {
  const ids = buildProductNameSuggestions(CANDIDATES).map((row) => row.key)
  assert.deepEqual(ids, ['product-12', 'product-13', 'product-14'])
  assert.equal(new Set(ids).size, ids.length)
})

check('a nameless row is never offered, and the row being edited is excluded', () => {
  assert.equal(buildProductNameSuggestions(CANDIDATES).some((row) => row.value.trim() === ''), false)
  const rows = buildProductNameSuggestions(CANDIDATES, { excludeId: 12 })
  assert.deepEqual(rows.map((row) => row.key), ['product-13', 'product-14'], 'offering a product its own name back is noise')
})

check('the list is bounded so a common word cannot flood the form', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ id: index + 100, name: `Serum ${index}` }))
  assert.equal(buildProductNameSuggestions(many).length, 8)
  assert.equal(buildProductNameSuggestions(many, { limit: 3 }).length, 3)
})

check('min length: one character never asks the catalog anything', () => {
  assert.equal(PRODUCT_MATCH_MIN_CHARS, 2)
  assert.equal(shouldSearchProductMatches('a', ''), false, 'one letter would match a third of the catalog')
  assert.equal(shouldSearchProductMatches('ab', ''), true)
  assert.equal(shouldSearchProductMatches('', '88'), true, 'a barcode alone is a legitimate search')
  assert.equal(shouldSearchProductMatches(' ', ' '), false, 'whitespace is not typing')
})

check('the queries sent are exactly the fields long enough to be worth asking about', () => {
  assert.deepEqual(productMatchQueries('Dior', '3348901250115'), ['Dior', '3348901250115'])
  assert.deepEqual(productMatchQueries('D', '3348901250115'), ['3348901250115'])
  assert.deepEqual(productMatchQueries('  Dior  ', ''), ['Dior'])
})

check('the debounce is one shared constant, not a literal per caller', () => {
  assert.equal(PRODUCT_MATCH_DEBOUNCE_MS, 350)
  const form = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
  assert.match(form, /\}, PRODUCT_MATCH_DEBOUNCE_MS\)/, 'the form uses the shared debounce')
  assert.match(form, /shouldSearchProductMatches\(name, barcode\)/, 'the form uses the shared min-length gate')
  assert.match(form, /productMatchQueries\(name, barcode\)/, 'the form uses the shared query builder')
})

check('FILL-ONLY: picking a name suggestion changes the name field and nothing else', () => {
  const form = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
  // The checkout is CRLF (core.autocrlf=true on Windows), so this locates the
  // block by regex rather than by an embedded newline literal.
  const opening = /<SuggestionTextInput\s+id="product-name"/.exec(form)
  assert.ok(opening, 'the editable Name field must render the shared control')
  const at = opening.index
  const block = form.slice(at, form.indexOf('/>', at))
  assert.match(block, /onChange=\{\(value\) => setField\('name', value\)\}/, 'a pick writes the name field only')
  assert.doesNotMatch(block, /setForm\(|onSave|saveNewItem|setDetailProduct|product\.id/, 'a pick must never load, switch to, or add that product')
})

check('the suggestions are built from the lookup that already ran -- no second read', () => {
  const form = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
  assert.match(
    form,
    /buildProductNameSuggestions\(createMatches, \{ excludeId: product\?\.id \}\)/,
    'the picklist reuses createMatches, the same rows that feed the identity hint',
  )
  assert.equal(
    (form.match(/searchProductsForMatch\(/g) || []).length,
    1,
    'exactly one existing-product search in this form',
  )
})

check('suggestions are create-mode only, and never over a name locked by grouping', () => {
  const form = fs.readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
  assert.match(form, /isCreateMode && !nameLocked \? buildProductNameSuggestions/, 'edit mode and locked names offer no list')
})

if (!process.exitCode) console.log(`\n${passed} checks passed`)
