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
import ts from 'typescript'
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
// 3. The catalogue is all-time
// ---------------------------------------------------------------------------

runTest('the catalogue report is independent of received dates', () => {
  assert.doesNotMatch(products, /buildCreatedDateFilterSection|createdDateFrom|createdDateTo/, 'Products must not own a received-date range')
  assert.doesNotMatch(products, /batchDateFrom|batchDateTo/, 'catalog requests and exports must not carry lot received-date bounds')
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
// tree. The original interpolation idioms remain handled:
//   .replace('{x}', ...)   .split('{x}').join(...)   replaceVars(..., { x })
// A local fill(tr(...), { x }) is accepted only after executing its actual
// formatter and associating this key literal with this exact variables object.
const INTERPOLATION_WINDOW = 700
const INTERPOLATION_LOOKBEHIND = 200

function replaceVarsHandles(window: string, name: string): boolean {
  return new RegExp(
    `replaceVars\\([\\s\\S]{0,${INTERPOLATION_WINDOW}}?,\\s*\\{[\\s\\S]{0,${INTERPOLATION_WINDOW}}?\\b${name}\\b\\s*(?::|,|\\})`,
  ).test(window)
}

function fillInterpolations(source: string): Map<number, Set<string>> {
  const handled = new Map<number, Set<string>>()
  if (!/function fill\s*\(/.test(source)) return handled
  const file = ts.createSourceFile('product.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations: ts.Node[] = []
  const findBindings = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node))
      && node.name && ts.isIdentifier(node.name) && node.name.text === 'fill') declarations.push(node)
    ts.forEachChild(node, findBindings)
  }
  findBindings(file)
  // Do not let another function/parameter with the same name inherit credit.
  if (declarations.length !== 1 || !ts.isFunctionDeclaration(declarations[0]) || !declarations[0].body) return handled
  const definition = declarations[0].getText(file)
  const compiled = ts.transpileModule(definition, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const format = new Function(`${compiled}; return fill`)() as (template: string, vars: Record<string, string | number>) => string
  assert.equal(format('{name}|{quantity}|{name}|{missing}', { name: 'A$&', quantity: 0 }), 'A$&|0|A$&|{missing}',
    'the production fill formatter must replace supplied/repeated placeholders literally and preserve missing ones for detection')
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fill') {
      const [translated, vars] = node.arguments
      if (translated && ts.isCallExpression(translated) && ts.isIdentifier(translated.expression)
        && ['t', 'tr'].includes(translated.expression.text) && vars && ts.isObjectLiteralExpression(vars)
        && !vars.properties.some(ts.isSpreadAssignment)) {
        const key = translated.arguments.find(ts.isStringLiteralLike)
        if (key) {
          const names = new Set<string>()
          for (const property of vars.properties) {
            if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
              && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) names.add(property.name.text)
          }
          for (const name of names) {
            assert.equal(format(`{${name}}|{${name}}`, { [name]: 'probe$&' }), 'probe$&|probe$&',
              `the production fill formatter must substitute the call's ${name} property`)
          }
          handled.set(key.getStart(file), names)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return handled
}

runTest('fill interpolation is verified and cannot hide missing or neighboring substitutions', () => {
  const adapter = readFileSync(new URL('../src/components/products/productResolveAdapter.ts', import.meta.url), 'utf8')
  const parsed = ts.createSourceFile('adapter.ts', adapter, ts.ScriptTarget.Latest, true)
  const definition = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'fill')
  assert.ok(definition, 'the production formatter must exist')
  const probe = (calls: string, formatter = definition.getText(parsed)): boolean => {
    const source = `${formatter}\n${calls}`
    return fillInterpolations(source).get(source.indexOf("'key'"))?.has('name') ?? false
  }
  assert.equal(probe("fill(tr(t, 'key', '{name}'), { name: 'Rose' })"), true)
  assert.equal(probe("fill(tr(t, 'key', '{name}'), { name })"), true, 'shorthand properties count')
  assert.equal(probe("fill(tr(t, 'key', '{name}'), { remaining: 1 })"), false, 'renamed property leaves the placeholder missing')
  assert.equal(probe("fill(tr(t, 'key', '{name}'), {})"), false, 'missing variables are not exempted')
  assert.equal(probe("fill(tr(t, 'other', '{name}'), { name }); tr(t, 'key', '{name}')"), false, 'a nearby filled call cannot cover another key')
  assert.equal(probe("fill(tr(t, 'key', '{name}'), { name, ...unknown })"), false, 'an unchecked spread cannot replace verified variables')
  assert.equal(probe("function shadow(fill) { return fill(tr(t, 'key', '{name}'), { name }) }"), false, 'shadowed fill is not the verified formatter')
  assert.throws(() => probe("fill(tr(t, 'key', '{name}'), { name })", 'function fill(template, vars) { return template }'),
    /production fill formatter must replace/, 'a replaced/no-op formatter must fail even when the call supplies matching names')
})

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
    const filled = fillInterpolations(src)
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
              && !replaceVarsHandles(window, name)
              && !filled.get(at)?.has(name)
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

  assert.equal(
    replaceVarsHandles("replaceVars(t('key'), { committed, remaining })", 'committed'),
    true,
    'positive control: shorthand object properties satisfy a matching placeholder',
  )
  assert.equal(
    replaceVarsHandles("replaceVars(t('key'), { remaining })", 'committed'),
    false,
    'negative control: another shorthand property must not satisfy a missing placeholder',
  )
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('productsDataReportShape: all assertions passed')
