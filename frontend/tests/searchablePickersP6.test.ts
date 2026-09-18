// p6/searchable-pickers -- "for province, district, subdistrict, make them
// able to search and choose. instead of showing everything. regarding
// contacts, pos, etc... do the same for supplier, brand, category, product
// name, units, barcode, etc." (owner, 2026-09-15).
//
// Follow-up (coordinator, same day): a filter box bolted above a chip wall
// still shows everything once the box is empty -- AddressPresetPicker's
// three categories were converted a SECOND time, off the chip wall entirely,
// onto the SAME SuggestionTextInput combobox every other converted picker in
// this lane already uses (one row per category; opens on focus; free text
// still allowed; existing rename/delete/add stays reachable behind the
// "Manage" toggle instead of always-rendered chips).
//
// This sweep pins three things:
//   1. the specific pickers this lane converted (AddressPresetPicker's
//      province/district/subdistrict, PromotionsPage's category/brand scope
//      pickers, VariantFormModal's unit picker) all render the SAME shared
//      SuggestionTextInput control ProductForm's Category/Brand/Unit/Supplier
//      fields already used -- see tests/suggestionTextInput.test.ts for that
//      control's own behaviour contract, which is not re-pinned here).
//   2. ContactPicker (the customer picker `NewSupplierReturnModal` uses) gained
//      the same arrow-key cursor every other combobox in this lane has.
//   3. a REGRESSION GUARD: no <AppSelect ... options={X}> anywhere outside
//      the public catalog (owned by another lane) may bind X to an
//      identifier that looks like an unbounded catalog list (category,
//      brand, supplier, unit, product/name, barcode) -- that shape is exactly "click to show
//      everything" with no way to type-filter. A future PR that adds a new
//      one must either reuse SuggestionTextInput or extend the allowlist
//      below with a named reason.
//
// Run: node tests/searchablePickersP6.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSuggestionMatches, type SuggestionOption } from '../src/utils/suggestionMatching.ts'
import { buildProductBulkInfoUpdates } from '../src/components/products/helpers/productWriteHelpers.ts'

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

// --- 1. AddressPresetPicker: province/district/subdistrict are ONE row each,
// on the shared combobox -- not a chip wall with a filter box bolted above it.
check('AddressPresetPicker: province/district/subdistrict render the shared searchable combobox, not a chip wall', () => {
  const component = read('components/pos/AddressPresetPicker.tsx')
  assert.match(component, /import SuggestionTextInput from '\.\.\/shared\/SuggestionTextInput\.tsx'/)
  const at = component.indexOf('<SuggestionTextInput')
  assert.ok(at > 0, 'the combobox must be rendered')
  const block = component.slice(at, at + 500)
  assert.match(block, /id=\{`address-preset-\$\{category\}`\}/, 'one combobox per category')
  assert.match(block, /value=\{selected\[category\] \|\| ''\}/, 'it shows the current selection')
  assert.match(block, /options=\{presets\[category\]\}/, 'it offers every saved preset for that category, not a hand-picked subset')
  // The old always-visible chip wall (a bare-word button per preset, outside
  // any "Manage" gate) must be gone -- it is exactly the "showing everything"
  // shape the owner flagged. A filter box bolted above the SAME wall (this
  // lane's own first attempt) is not enough either: an empty query still
  // rendered the whole wall.
  assert.doesNotMatch(
    component,
    /presets\[category\]\.length > 6 \? \(\s*<input/,
    'the old "filter box above a chip wall" shape must be gone -- the combobox replaces it entirely',
  )
})

check('AddressPresetPicker: existing manage (rename/delete/add) stays reachable, only tucked behind "Manage"', () => {
  const component = read('components/pos/AddressPresetPicker.tsx')
  const manageAt = component.indexOf('{manage ? (')
  assert.ok(manageAt > 0, 'a manage-gated block must exist')
  const manageBlock = component.slice(manageAt, manageAt + 3600)
  assert.match(manageBlock, /onClick=\{\(\) => setEditing\(/, 'rename stays reachable from a list row')
  assert.match(manageBlock, /onClick=\{\(\) => setPendingRemove\(removeKey\)\}/, 'delete stays reachable from a list row')
  assert.match(manageBlock, /onClick=\{\(\) => void add\(category\)\}/, 'add stays reachable')
  // The wall render moved entirely inside this manage gate -- nothing outside
  // it may still map presets[category] into always-visible chip buttons.
  const beforeManage = component.slice(0, manageAt)
  assert.doesNotMatch(beforeManage, /presets\[category\]\.map/, 'no preset list renders outside the Manage gate')
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

// --- 4. ContactPicker: gains the same arrow-key cursor every other combobox
// in this lane has (it was already fully searchable -- type-filters, opens on
// focus, Escape/click-outside close -- the ONE gap was no visible/keyboard
// highlight while arrowing through results).
check('ContactPicker: ArrowDown/ArrowUp move a highlighted cursor, Enter takes it, matching nextSuggestionIndex', () => {
  const component = read('components/contacts/ContactPicker.tsx')
  assert.match(component, /import \{ nextSuggestionIndex \} from '\.\.\/\.\.\/utils\/suggestionMatching\.ts'/, 'reuses the shared cursor-wrap helper rather than a private copy')
  assert.match(component, /const \[cursor, setCursor\] = useState\(-1\)/, 'a cursor is tracked')
  const keyDownAt = component.indexOf('const handleKeyDown')
  assert.ok(keyDownAt > 0)
  const keyDownBlock = component.slice(keyDownAt, keyDownAt + 900)
  assert.match(keyDownBlock, /ArrowDown.*ArrowUp|ArrowUp.*ArrowDown/s, 'both arrow keys are handled')
  assert.match(keyDownBlock, /nextSuggestionIndex\(current, results\.length, event\.key === 'ArrowDown' \? 1 : -1\)/, 'the cursor wraps using the shared helper')
  assert.match(keyDownBlock, /open && cursor >= 0 && results\[cursor\]/, 'Enter takes the highlighted row when one is active')
  assert.match(keyDownBlock, /'Escape'/, 'Escape is still handled')
  // The row rendering must actually SHOW the highlight, not just track it.
  const rowsAt = component.indexOf('results.map((contact, index)')
  assert.ok(rowsAt > 0, 'rows must be indexed to compare against the cursor')
  const rowsBlock = component.slice(rowsAt, rowsAt + 700)
  assert.match(rowsBlock, /index === cursor/, 'the active row is visually distinguished')
  assert.match(rowsBlock, /onMouseEnter=\{\(\) => setCursor\(index\)\}/, 'hovering a row moves the keyboard cursor too, so mouse and keyboard agree')
})

// --- 5. Regression guard: no NEW AppSelect binds to an unbounded catalog list.
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

// Parse TSX rather than matching an opening tag with [^>]*: an onChange
// arrow before options contains `>` and used to hide even categoryOptions.
// This is a binding-name guard, not whole-program data-flow analysis. Traverse
// the actual options expression so member access, parentheses and inline maps
// cannot hide the catalog binding, and unrelated props/comments cannot trigger it.
function catalogOptionBindings(source: string): string[] {
  const tree = ts.createSourceFile('picker.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders: string[] = []
  const catalogBinding = /categor|brand|suppl(ier)?|^unit|unitOptions|unitSelect|product|barcode/i
  function visit(node: ts.Node): void {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === 'AppSelect') {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(tree) !== 'options') continue
        const initializer = attribute.initializer
        if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) continue
        let expression = initializer.expression
        while (ts.isParenthesizedExpression(expression)) expression = expression.expression
        if (ALLOWLISTED_APPSELECT_OPTION_BINDINGS.has(expression.getText(tree))) continue
        let isCatalog = false
        function inspectBinding(child: ts.Node): void {
          if (ts.isIdentifier(child) && catalogBinding.test(child.text)) isCatalog = true
          ts.forEachChild(child, inspectBinding)
        }
        inspectBinding(expression)
        if (isCatalog) offenders.push(expression.getText(tree))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return offenders
}

check('DISCRIMINATING: click-only product/name and barcode bindings are rejected alongside existing catalog families', () => {
  for (const binding of ['categoryOptions', 'brandOptions', 'supplierOptions', 'unitOptions', 'productOptions', 'productNameOptions', 'productNames', 'barcodeOptions']) {
    assert.deepEqual(catalogOptionBindings(`<AppSelect options={${binding}} />`), [binding], `${binding} must not escape the guard`)
  }
})

check('DISCRIMINATING: JSX callbacks, member bindings, parentheses and mapped options cannot hide a catalog selector', () => {
  assert.deepEqual(catalogOptionBindings('<AppSelect onChange={(value) => setValue(value)} options={categoryOptions} />'), ['categoryOptions'])
  assert.deepEqual(catalogOptionBindings('<AppSelect\n onChange={(value) => setValue(value)}\n options={(lookups.productNames)} />'), ['lookups.productNames'])
  assert.deepEqual(catalogOptionBindings('<AppSelect options={catalog.barcodes}></AppSelect>'), ['catalog.barcodes'])
  assert.deepEqual(catalogOptionBindings('<AppSelect options={products.map(product => ({ value: product.id, label: product.name }))} />'), ['products.map(product => ({ value: product.id, label: product.name }))'])
})

check('the guard allows searchable controls and bounded lists, and ignores comments, strings and unrelated props', () => {
  for (const binding of ALLOWLISTED_APPSELECT_OPTION_BINDINGS) {
    assert.deepEqual(catalogOptionBindings(`<AppSelect options={(${binding})} />`), [], binding)
  }
  assert.deepEqual(catalogOptionBindings(`
    // <AppSelect options={productOptions} />
    const example = '<AppSelect options={barcodeOptions} />'
    const picker = <>
      <SuggestionTextInput options={productNameOptions} />
      <AppSelect value={product.barcode} onChange={(value) => setProduct(value)} options={branchOptions} />
      <AppSelect options={[{ value: 'product', label: 'Product' }, { value: 'service', label: 'Service' }]} />
    </>
  `), [])
})

// Exercise the actual host option builders and callbacks, not copies of their
// intended behavior. TS erases annotations; the supplied bindings stand in for
// React setters and the current render's data. No DOM or backend writes occur.
function pickerProp<T>(file: string, idPrefix: string, prop: string, bindings: Record<string, unknown>): T {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: string | undefined
  function visit(node: ts.Node): void {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === 'SuggestionTextInput') {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      const id = attributes.find(attribute => attribute.name.getText(tree) === 'id')
      if (id?.initializer?.getText(tree).includes(idPrefix)) {
        const attribute = attributes.find(item => item.name.getText(tree) === prop)
        if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression?.getText(tree)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(expression, `${file}: ${idPrefix} must expose ${prop} on the shared searchable control`)
  const javascript = ts.transpileModule(`const actual = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return new Function(...Object.keys(bindings), `${javascript}\nreturn actual;`)(...Object.values(bindings)) as T
}

type Pick = (value: string, option?: SuggestionOption) => void
const translate = (_key: string, fallback: string): string => fallback

check('stock-in supplier filtering keeps duplicate-name keys distinct and supports none, all and clearing', () => {
  const file = 'components/contacts/StockInInvoicesSection.tsx'
  const id = 'stock-in-invoice-supplier'
  let selected = 'all'
  let query = ''
  let page = 5
  const options = pickerProp<SuggestionOption[]>(file, id, 'options', {
    tr: translate, supplierKey: selected,
    supplierOptions: [{ key: 'supplier:11', name: 'Same long supplier name' }, { key: 'supplier:22', name: 'Same long supplier name' }],
  })
  const matches = buildSuggestionMatches(options, 'long supplier')
  assert.deepEqual(matches.map(option => option.payload), ['supplier:11', 'supplier:22'])
  const pick = pickerProp<Pick>(file, id, 'onChange', {
    changeFilter: (apply: () => void) => { apply(); page = 1 },
    setSupplierQuery: (value: string) => { query = value },
    setSupplierKey: (value: string) => { selected = value },
  })
  pick(matches[1].value, matches[1])
  assert.equal(selected, 'supplier:22', 'the label must not replace the request key')
  assert.equal(page, 1, 'choosing or clearing a supplier resets pagination')
  pick('Same long supplier name')
  assert.equal(selected, 'all', 'typing an exact duplicate label must not silently pick the first ID')
  pick(options[1].value, options[1])
  assert.equal(selected, 'none')
  pick(options[0].value, options[0])
  assert.equal(selected, 'all')
  assert.equal(query, '')
  pick(matches[0].value, matches[0])
  pick('')
  assert.equal(selected, 'all')
  assert.equal(query, '')
  assert.match(read(file), /setSupplierKey\('all'\); setSupplierQuery\(''\)/, 'the Clear button resets both key and visible query')
})

check('bulk category/unit search never commits arbitrary typed text, and clearing still means keep current', () => {
  const file = 'components/products/Products.tsx'
  for (const field of ['category', 'unit']) {
    const id = `bulk-product-${field}`
    let form: Record<string, string> = { brand: 'Existing brand' }
    const options = pickerProp<SuggestionOption[]>(file, id, 'options', {
      tr: translate, categories: [{ name: 'Skin care' }], units: [{ name: 'Bottle' }],
    })
    const pick = pickerProp<Pick>(file, id, 'onChange', {
      setBulkEditForm: (update: (current: Record<string, string>) => Record<string, string>) => { form = update(form) },
    })
    pick(options[1].value, options[1])
    assert.equal(form[field], options[1].payload)
    assert.deepEqual(buildProductBulkInfoUpdates(form), { brand: 'Existing brand', [field]: options[1].payload })
    pick('Unlisted typed value')
    assert.equal(form[`${field}Query`], 'Unlisted typed value')
    assert.deepEqual(buildProductBulkInfoUpdates(form), { brand: 'Existing brand' }, 'search text must never enter a bulk mutation payload')
    pick(options[1].value, options[1])
    pick('')
    assert.deepEqual(buildProductBulkInfoUpdates(form), { brand: 'Existing brand' })
    pick(options[1].value, options[1])
    pick(options[0].value, options[0])
    assert.deepEqual(buildProductBulkInfoUpdates(form), { brand: 'Existing brand' }, 'explicit Keep current preserves the same no-op semantics')
    assert.equal(form[`${field}Query`], '', 'Keep current returns to an empty, searchable field')
  }
})

check('dated import candidates retain numeric IDs behind duplicate names, filter by ID, and clear incomplete decisions', () => {
  const file = 'components/products/import/DatedStockReconciliationModal.tsx'
  const id = 'dated-count-candidate-'
  const row = { rowNumber: 7 }
  const candidates = [101, 202]
  const options = pickerProp<SuggestionOption[]>(file, id, 'options', {
    candidates, productNameById: new Map([[101, 'Same long product name'], [202, 'Same long product name']]), decision: {},
  })
  assert.equal(buildSuggestionMatches(options, 'long product').length, 2, 'duplicate labels remain two selectable products')
  assert.deepEqual(buildSuggestionMatches(options, '#202').map(option => option.payload), [202])
  let decision: { candidateProductId?: number } = {}
  let queries: Record<number, string> = {}
  const pick = pickerProp<Pick>(file, id, 'onChange', {
    row, candidates,
    setCandidateQueries: (update: (current: Record<number, string>) => Record<number, string>) => { queries = update(queries) },
    updateDecision: (rowNumber: number, patch: { candidateProductId?: number }) => { assert.equal(rowNumber, 7); decision = patch },
  })
  pick(options[1].value, options[1])
  assert.equal(decision.candidateProductId, 202)
  pick(options[1].value)
  assert.equal(decision.candidateProductId, undefined, 'typing an exact name does not choose a candidate')
  pick(options[0].value, options[0])
  pick('')
  assert.equal(decision.candidateProductId, undefined)
  assert.equal(queries[7], '')
  pick('Unrelated', { value: 'Unrelated', payload: 999 })
  assert.equal(decision.candidateProductId, undefined, 'a stale/noncandidate row cannot link')
})

check('REGRESSION GUARD: no AppSelect outside the catalog lane binds options to a category/brand/supplier/unit/product/name/barcode list', () => {
  const offenders: string[] = []
  for (const file of walk(srcRoot)) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/')
    const text = fs.readFileSync(file, 'utf8')
    for (const binding of catalogOptionBindings(text)) {
      offenders.push(`${rel}: options={${binding}}`)
    }
  }
  assert.deepEqual(offenders, [], 'a new click-only AppSelect must not bind to an unbounded catalog list; reuse SuggestionTextInput instead')
})

// --- 6. No native <select> anywhere in the admin frontend (AppSelect/
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
