// Products is a DATA REPORT of the catalogue, not a second stock-operations
// console. Stock operations -- transfers, receiving, batch management,
// quantity adjustments -- belong to the Branches / Inventory surface. This
// file pins the three things that make Products readable as a report and
// keeps operations out of the list surface itself:
//
//   1. the report's columns exist, in order, with numbers right-aligned
//      and text left-aligned, and Details stays bounded while Name takes
//      the leftover width;
//   2. every filter facet the page BUILDS actually reaches the menu -- the
//      Promotions facet shipped in 642188a4 never did, because its array
//      entry was appended to the end of a `//` comment line, and nothing
//      failed;
//   3. the catalogue can still be date-ranged -- the Created (batch
//      received-date) range lost its only control in 85294c21 while its
//      state, its clear-all reset, its activeFilters term and the server's
//      batchDateFrom/batchDateTo query all stayed wired;
//   4. ProductsListSurface renders no stock-operations affordance.
//
// (2) is deliberately behavioural, not a source grep: it calls the real
// builder and checks the returned array, so ANY future facet that is added
// to the props but not to the array fails here.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildProductFilterSections } from '../src/components/products/helpers/productMenuHelpers.ts'

const surface = readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

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

// ---------------------------------------------------------------------------
// 1. The report's columns
// ---------------------------------------------------------------------------

// Header cells in source order, each as [alignment class, label expression].
// The leading checkbox cell has no label and no alignment -- it collapses to
// zero width out of select mode -- so it is matched separately below.
const REPORT_COLUMNS: Array<{ align: 'left' | 'right'; label: RegExp }> = [
  { align: 'left', label: /t\('receipt_image_short'\) \|\| t\('image'\)/ },
  { align: 'left', label: /t\('product_name'\)/ },
  { align: 'left', label: /t\('details'\)/ },
  { align: 'right', label: /t\('cost'\)/ },
  { align: 'right', label: /t\('selling_price_label'\)/ },
  { align: 'right', label: /t\('margin'\)/ },
  { align: 'right', label: /t\('stock'\)/ },
]

runTest('the desktop table head carries every report column, in order', () => {
  const head = surface.slice(surface.indexOf('const renderDesktopTableHead'), surface.indexOf('const renderDesktopLoadingShell'))
  assert.ok(head.length > 200, 'renderDesktopTableHead must exist')
  let cursor = 0
  for (const column of REPORT_COLUMNS) {
    const match = column.label.exec(head.slice(cursor))
    assert.ok(match, `Products lost its ${column.label} column from the desktop report table`)
    cursor += (match.index || 0) + match[0].length
  }
})

runTest('money and quantity columns are right-aligned, identity columns left', () => {
  const head = surface.slice(surface.indexOf('const renderDesktopTableHead'), surface.indexOf('const renderDesktopLoadingShell'))
  // `<th ` only -- splitting on the bare `<th` would also cut at `<thead`.
  const cells = head.split(/<th[\s>]/).slice(1)
  // First cell is the select-all checkbox: no label, no alignment.
  assert.doesNotMatch(cells[0], /text-(left|right)/, 'the checkbox column must stay unlabelled and unaligned')
  const labelled = cells.slice(1)
  assert.equal(labelled.length, REPORT_COLUMNS.length, `the report table must have exactly ${REPORT_COLUMNS.length} labelled columns`)
  REPORT_COLUMNS.forEach((column, index) => {
    assert.match(
      labelled[index],
      new RegExp(`text-${column.align}\\b`),
      `report column ${index + 1} (${column.label}) must be text-${column.align} -- numbers read down a right-aligned column`,
    )
  })
})

runTest('Name is the only auto column and Details stays bounded', () => {
  const colgroup = surface.slice(surface.indexOf('const desktopColGroup'), surface.indexOf('const renderDesktopTableHead'))
  // Annotated: `match() || []` widens to `RegExpMatchArray | never[]`, and
  // tsc then types indexOf's parameter as `never`.
  const cols: string[] = colgroup.match(/<col\b[^/]*\/>/g) || []
  assert.equal(cols.length, REPORT_COLUMNS.length + 1, 'the colgroup must declare one <col> per column, checkbox included')
  const auto = cols.filter((col) => !/width/.test(col))
  assert.equal(auto.length, 1, 'exactly one column (Name) may be auto-sized; every other column must be bounded')
  assert.equal(cols.indexOf(auto[0]), 2, 'the auto column must be Name (third), not Details or a numeric column')
  // Details must have room for one chip per branch side by side, measured in
  // KHMER -- lang-km puts the whole app on Noto Sans Khmer, which renders even
  // these Latin chips wider, so an English-only width under-sizes the column
  // and the report regrows a line for Khmer operators. "Main Store: 1000" plus
  // "Branch 2: 250" plus the 4px gap needs 208px; 15rem leaves 216px. Anything
  // below wraps them and inflates every row (measured at 1280, Sep 3).
  const detailsWidth = /<col style=\{\{ width: '([\d.]+)rem' \}\} \/>/.exec(cols[3])
  assert.ok(detailsWidth, 'the Details column must declare a rem width')
  assert.ok(Number(detailsWidth[1]) >= 15, `Details is ${detailsWidth[1]}rem -- under 15rem the per-branch chips wrap in Khmer and every row grows`)
})

// ---------------------------------------------------------------------------
// 2. Every facet the page builds reaches the menu
// ---------------------------------------------------------------------------

// One stub per pre-built section prop buildProductFilterSections accepts.
// Adding a prop without adding it to the returned array fails here.
const PREBUILT_SECTION_PROPS = [
  'availabilitySection',
  'issuesSection',
  'promotionsSection',
  'mergedSection',
  'createdSection',
  'searchModeSection',
] as const

runTest('every pre-built filter facet reaches the menu', () => {
  const stubs = Object.fromEntries(
    PREBUILT_SECTION_PROPS.map((prop) => [prop, { id: `stub-${prop}`, label: prop, options: [] }]),
  )
  const sections = buildProductFilterSections({ isOpen: true, ...stubs })
  const ids = new Set(sections.map((section) => section.id))
  for (const prop of PREBUILT_SECTION_PROPS) {
    assert.ok(
      ids.has(`stub-${prop}`),
      `${prop} was passed in but never appears in the menu -- a facet built and thrown away (this is exactly how the Promotions facet went missing)`,
    )
  }
})

runTest('the props the builder declares are the props it renders', () => {
  const helpers = readFileSync(new URL('../src/components/products/helpers/productMenuHelpers.ts', import.meta.url), 'utf8')
  const declared = new Set((helpers.match(/^\s{2}(\w+Section)\?: FilterSection \| null$/gm) || [])
    .map((line) => line.trim().split('?')[0]))
  for (const prop of declared) {
    assert.ok(
      (PREBUILT_SECTION_PROPS as readonly string[]).includes(prop),
      `productMenuHelpers declares ${prop} but this test does not cover it -- add it to PREBUILT_SECTION_PROPS`,
    )
  }
})

// ---------------------------------------------------------------------------
// 3. The report can be date-ranged
// ---------------------------------------------------------------------------

runTest('the catalogue report keeps a working Created date range', () => {
  assert.match(products, /import \{ buildCreatedDateFilterSection \}/, 'Products must build the Created (batch received-date) range section')
  assert.match(
    products,
    /createdSection: buildCreatedDateFilterSection\(\{[\s\S]{0,240}setCreatedDateFrom,[\s\S]{0,120}setCreatedDateTo,/,
    'the Created range must be wired to its own setters, not left as orphaned state',
  )
  // The server-side half must stay wired to the same state, or the control
  // would filter nothing.
  assert.match(products, /batchDateFrom: createdDateFrom \|\| ''/, 'the Created range must still reach the server as batchDateFrom')
})

// ---------------------------------------------------------------------------
// 4. No stock-operations console in the list surface
// ---------------------------------------------------------------------------

// Products presents the catalogue; Branches / Inventory moves the stock.
// The list surface may open a product, group it, select it, filter it -- it
// may not receive, transfer, adjust or re-batch stock.
const OPERATIONS_AFFORDANCES = [
  /FastStockIn/,
  /ReceiveBatch/,
  /ManageBatches/,
  /TransferModal/,
  /openAdjust/,
  /onAdjustStock/,
  /adjust_stock/,
  /add_stock/,
  /remove_stock/,
  /stock_transfer/,
]

runTest('the Products list surface carries no stock-operations affordance', () => {
  for (const pattern of OPERATIONS_AFFORDANCES) {
    assert.doesNotMatch(
      surface,
      pattern,
      `ProductsListSurface must not reach a stock operation (${pattern}) -- Products reports the catalogue, Branches/Inventory moves the stock`,
    )
  }
})

runTest('the list surface renders only reading affordances on a group row', () => {
  // The one group-level menu slot this surface exposes is filled by
  // Products.tsx with catalogue edits (add variant / add image), never with
  // stock movement -- see renderGroupActions there. Pin the slot's contract
  // so a future stock action cannot be dropped into the list.
  const groupActions = products.slice(products.indexOf('const renderGroupActions'), products.indexOf('const renderGroupActions') + 2200)
  assert.ok(groupActions.length > 200, 'renderGroupActions must exist in Products.tsx')
  for (const pattern of OPERATIONS_AFFORDANCES) {
    assert.doesNotMatch(groupActions, pattern, `the group row menu must not offer a stock operation (${pattern})`)
  }
})

// ---------------------------------------------------------------------------
// 5. No Products surface prints a raw {placeholder}
// ---------------------------------------------------------------------------

// tr()/t() return the PACK value whenever the key resolves, and neither
// interpolates. A key whose pack value carries {count} therefore reaches the
// screen with the braces intact unless the call site substitutes them itself.
// The failure hides in plain sight when the fallback is a template literal
// that already has the number in it -- it reads correctly in review and is
// dead code at runtime, in English as much as in Khmer. That is exactly how
// ExportFieldsModal printed "for {count} product(s)" to operators.
//
// A report page is mostly counts, so this is pinned for the whole Products
// tree. Three interpolation idioms are in use and all three count as handled:
//   .replace('{x}', ...)   .split('{x}').join(...)   replaceVars(..., { x })
const INTERPOLATION_WINDOW = 700
const INTERPOLATION_LOOKBEHIND = 200

runTest('no Products surface renders an uninterpolated {placeholder}', () => {
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

  const placeholdersOf = (value: unknown): string[] =>
    [...new Set(String(value || '').match(/\{\s*[a-zA-Z_]\w*\s*\}/g) || [])]

  const keyPlaceholders = new Map<string, string[]>()
  for (const key of new Set([...Object.keys(en), ...Object.keys(km)])) {
    const marks = [...new Set([...placeholdersOf(en[key]), ...placeholdersOf(km[key])])]
    if (marks.length) keyPlaceholders.set(key, marks)
  }
  assert.ok(keyPlaceholders.size > 0, 'the packs must still contain placeholder-bearing keys for this check to mean anything')

  const dir = new URL('../src/components/products/', import.meta.url)
  const files: string[] = []
  const walk = (folder: URL): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, folder))
      else if (/\.tsx?$/.test(entry.name)) files.push(fileURLToPath(new URL(entry.name, folder)))
    }
  }
  walk(dir)
  assert.ok(files.length > 20, 'the Products tree must have been walked')

  const leaks: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const [key, marks] of keyPlaceholders) {
      for (const quote of ["'", '"', '`']) {
        let at = src.indexOf(quote + key + quote)
        while (at !== -1) {
          // Reaches backwards as well: `replaceVars(t('key') || '...', { n })`
          // wraps the call, so the helper's name sits BEFORE the key literal.
          const window = src.slice(Math.max(0, at - INTERPOLATION_LOOKBEHIND), at + INTERPOLATION_WINDOW)
          const unhandled = marks.filter((mark) => {
            const name = mark.slice(1, -1).trim()
            return !window.includes(`.replace('${mark}'`)
              && !window.includes(`.replace("${mark}"`)
              && !window.includes(`.split('${mark}')`)
              && !window.includes(`.split("${mark}")`)
              && !new RegExp(`replaceVars\\([\\s\\S]{0,${INTERPOLATION_WINDOW}}?\\b${name}\\s*:`).test(window)
          })
          if (unhandled.length) {
            const line = src.slice(0, at).split('\n').length
            leaks.push(`${file.split(/[\\/]/).slice(-2).join('/')}:${line} uses '${key}' but never substitutes ${unhandled.join(', ')}`)
          }
          at = src.indexOf(quote + key + quote, at + 1)
        }
      }
    }
  }
  assert.deepEqual(leaks, [], `a Products surface would print raw braces to the operator:\n  ${leaks.join('\n  ')}`)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('productsDataReportShape: all assertions passed')
