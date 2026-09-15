// p6/searchable-pickers -- "for province, district, subdistrict, make them
// able to search and choose. instead of showing everything. regarding
// contacts, pos, etc... do the same for supplier, brand, category, product
// name, units, barcode, etc." (owner, 2026-09-15).
//
// This sweep pins two things:
//   1. the specific pickers this lane converted (AddressPresetPicker's
//      province/district/subdistrict chip lists gained a type-to-filter box;
//      PromotionsPage's category/brand scope pickers and VariantFormModal's
//      unit picker now render the SAME shared SuggestionTextInput control
//      ProductForm's Category/Brand/Unit/Supplier fields already used --
//      see tests/suggestionTextInput.test.ts for that control's own
//      behaviour contract, which is not re-pinned here).
//   2. a REGRESSION GUARD: no <AppSelect ... options={X}> anywhere outside
//      the public catalog (owned by another lane) may bind X to an
//      identifier that looks like an unbounded catalog list (category,
//      brand, supplier, unit) -- that shape is exactly "click to show
//      everything" with no way to type-filter. A future PR that adds a new
//      one must either reuse SuggestionTextInput or extend the allowlist
//      below with a named reason.
//
// Run: node tests/searchablePickersP6.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')

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

const read = (rel: string): string => fs.readFileSync(path.join(srcRoot, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // The public storefront is owned by another lane -- never swept here.
      if (full.split(path.sep).join('/').includes('/components/catalog')) continue
      walk(full, out)
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// --- 1. AddressPresetPicker: province/district/subdistrict gained a filter box.
check('AddressPresetPicker: each preset category can be typed-filtered, not only clicked from the full list', () => {
  const component = read('components/pos/AddressPresetPicker.tsx')
  assert.match(
    component,
    /presets\[category\]\.length > 6 \? \(\s*<input/,
    'a search box appears above a category\'s chip list once it is long enough to need one',
  )
  assert.match(
    component,
    /value=\{filters\[category\]\}/,
    'the box is wired to per-category filter state',
  )
  assert.match(
    component,
    /\.filter\(\(value\) => !filters\[category\]\.trim\(\) \|\| value\.toLocaleLowerCase\(\)\.includes\(filters\[category\]\.trim\(\)\.toLocaleLowerCase\(\)\)\)/,
    'typing narrows the rendered chips by substring',
  )
  // An empty query must still show (and let the operator scroll/click) the
  // full list -- "without the ability to search" cuts both ways: it must
  // never become search-ONLY either.
  assert.match(component, /!filters\[category\]\.trim\(\) \|\|/, 'an empty filter keeps every preset visible')
})

// --- 2. PromotionsPage: category/brand scope pickers reuse the shared combobox.
check('PromotionsPage: category and brand promotion-scope pickers use the shared searchable combobox', () => {
  const page = read('components/promotions/PromotionsPage.tsx')
  const categoryAt = page.indexOf("draft.scope_type === 'category'")
  const brandAt = page.indexOf("draft.scope_type === 'brand'")
  assert.ok(categoryAt > 0 && brandAt > 0, 'both scope branches must exist')
  const categoryBlock = page.slice(categoryAt, categoryAt + 300)
  const brandBlock = page.slice(brandAt, brandAt + 300)
  assert.match(categoryBlock, /<SuggestionTextInput/, 'category scope no longer renders a click-only AppSelect')
  assert.match(brandBlock, /<SuggestionTextInput/, 'brand scope no longer renders a click-only AppSelect')
  assert.doesNotMatch(categoryBlock, /<AppSelect/, 'the AppSelect this replaced must actually be gone, not just shadowed')
  assert.doesNotMatch(brandBlock, /<AppSelect/, 'same for brand')
})

// --- 3. VariantFormModal: Unit matches ProductForm's sibling field (parity).
check('VariantFormModal: Unit uses the same shared combobox ProductForm\'s Unit field uses (sibling parity)', () => {
  const variantModal = read('components/products/forms/VariantFormModal.tsx')
  const unitAt = variantModal.indexOf('variant-form-unit')
  assert.ok(unitAt > 0, 'the Unit field must exist')
  const block = variantModal.slice(Math.max(0, unitAt - 50), unitAt + 400)
  assert.match(block, /<SuggestionTextInput/, 'Unit must render the shared type-or-select control')
  assert.doesNotMatch(block, /<AppSelect/, 'the old click-only dropdown must be gone from this field')
})

// --- 4. Regression guard: no NEW AppSelect binds to an unbounded catalog list.
// Each entry names the file:line the exception was verified at, and why it is
// a bounded/enumerable list rather than an unbounded catalog one that needs
// type-filtering (branches, fee types, payment/return-reason enums, and
// similar small admin-configured sets a business realistically has a
// handful of, never hundreds of).
const ALLOWLISTED_APPSELECT_OPTION_BINDINGS = new Set([
  'branchOptions',
  'destinationBranchOptions',
  'branchSelectOptions',
  'adjustBranchSelectOptions',
  'adjustTargetSelectOptions',
  'transferSourceBranchOptions',
  'lineBranchId', // AppSelect *value*, not options -- kept for clarity if ever grepped together
])

check('REGRESSION GUARD: no AppSelect outside the catalog lane binds options to a category/brand/supplier/unit list', () => {
  const offenders: string[] = []
  for (const file of walk(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/')
    const text = fs.readFileSync(file, 'utf8')
    const re = /<AppSelect[^>]*?options=\{([a-zA-Z0-9_.]+)\}/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const binding = match[1]
      if (ALLOWLISTED_APPSELECT_OPTION_BINDINGS.has(binding)) continue
      if (/categor|brand|suppl(ier)?|^unit|unitOptions|unitSelect/i.test(binding)) {
        offenders.push(`${rel}: options={${binding}}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'a new click-only AppSelect must not bind to an unbounded catalog list; reuse SuggestionTextInput instead')
})

// --- 5. No native <select> anywhere in the admin frontend (AppSelect/
// SuggestionTextInput/FilterMenu are the only pickers this codebase uses --
// see AppSelect.tsx's own header comment for why a native select was
// replaced everywhere already).
check('REGRESSION GUARD: no native <select> element exists anywhere in src', () => {
  const offenders: string[] = []
  for (const file of walk(srcRoot)) {
    const text = fs.readFileSync(file, 'utf8')
    if (/<select[ >]/.test(text)) offenders.push(path.relative(srcRoot, file))
  }
  assert.deepEqual(offenders, [], 'a native <select> renders at the browser\'s discretion and cannot be type-filtered')
})

if (!process.exitCode) console.log(`\n${passed} checks passed`)
