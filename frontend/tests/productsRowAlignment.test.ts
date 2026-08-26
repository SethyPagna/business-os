// The Products desktop table has ONE left rail, and this file is what
// keeps it that way.
//
// Reported three separate times: on a large screen the category band's
// label, a group's title and a product's own name each started at a
// different x, and all three sat far right of the band they belong to.
// Measured in the shape the table had before this pass:
//
//   category label   px-4 on a colSpan=8 cell            ->  1.00rem
//   product name     w-10 + w-[4.5rem] columns + px-3    ->  7.75rem
//   group title      the same, PLUS the cell's own px-3  ->  8.50rem
//
// The group title was 0.75rem right of its OWN child rows -- three rails
// where there should be one. Hiding the child thumbnail (an earlier pass)
// was necessary but never sufficient, because the offset came from the
// fixed column widths, not the image.
//
// These checks are structural on purpose. A screenshot diff would catch
// the symptom but not tell anyone why; asserting that all three rows
// derive their offset from the SAME constants catches the cause -- someone
// hand-rolling a padding on one of them again.
import assert from 'node:assert/strict'
import fs from 'node:fs'

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

const surface = fs.readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

runTest('the leading columns are sized from the shared constants, not hand-written widths', () => {
  assert.match(surface, /const SELECT_COL_WIDTH = '([\d.]+rem)'/)
  assert.match(surface, /const IMAGE_COL_WIDTH = '([\d.]+rem)'/)
  assert.match(
    surface,
    /<col style=\{\{ width: SELECT_COL_WIDTH \}\} \/>\s*<col style=\{\{ width: IMAGE_COL_WIDTH \}\} \/>/,
    'the colgroup must read the constants -- a literal w-10/w-[4.5rem] here is how the rails drifted apart',
  )
})

runTest('the image column is only a little wider than the thumbnail it holds', () => {
  // "too much indentation when only need a bit spacing from group image".
  const imageWidth = Number(surface.match(/const IMAGE_COL_WIDTH = '([\d.]+)rem'/)![1])
  // The thumbnail is h-10 w-10 = 2.5rem.
  assert.ok(imageWidth >= 2.5, `the column must still fit the 2.5rem thumbnail, got ${imageWidth}rem`)
  assert.ok(imageWidth <= 4, `the column reserved ${imageWidth}rem for a 2.5rem thumbnail -- that gap is the reported indentation`)
})

runTest("the full-width rows use REAL cells in the table's own columns, never a colSpan=8 with its own padding", () => {
  // This is the whole fix. Two earlier attempts re-declared the column
  // widths on the colSpan rows -- once as padding, once as a CSS grid --
  // and both were correct at exactly one window width, because
  // `table-fixed` inflates the declared columns by however much the
  // percentages leave unclaimed. Real cells cannot drift: there is nothing
  // left to keep in sync.
  // The empty-state row is the one legitimate colSpan=8: it has no rail to
  // respect because there are no rows to line up with.
  const fullSpans = (surface.match(/<td colSpan=\{8\}/g) || []).length
  const emptyState = (surface.match(/<td colSpan=\{8\} className="py-10 text-center/g) || []).length
  assert.strictEqual(
    fullSpans - emptyState,
    0,
    'a colSpan=8 row re-declares the column geometry and will drift again -- span the trailing columns only',
  )
  const spans = surface.match(/<td colSpan=\{FULL_WIDTH_ROW_SPAN\}/g) || []
  assert.strictEqual(spans.length, 2, `the category band and the group header must each span the trailing columns, found ${spans.length}`)
  assert.match(surface, /const FULL_WIDTH_ROW_SPAN = 6/)
})

runTest('the column percentages sum to 100%, so table-fixed has nothing to redistribute', () => {
  // Measured in a browser against the built stylesheet: at 90% the two
  // fixed leading columns rendered 51px/89px on a 1400px table having
  // asked for 32px/56px, and the left rail moved with the window (149px
  // at 1400, 98px at 820). At 100% they render exactly as asked and the
  // rail is 98px at both widths.
  const colgroup = surface.slice(surface.indexOf('<colgroup>'), surface.indexOf('</colgroup>'))
  const percentages = [...colgroup.matchAll(/w-\[(\d+)%\]/g)].map((match) => Number(match[1]))
  assert.strictEqual(percentages.length, 6, `expected 6 percentage columns beside the 2 fixed ones, found ${percentages.length}`)
  const total = percentages.reduce((sum, value) => sum + value, 0)
  assert.strictEqual(total, 100, `the percentage columns sum to ${total}% -- the missing ${100 - total}% gets spread across the fixed columns too, which is the indentation that keeps coming back`)
})

runTest('a product row uses the shared gutter for its name, so it lands on the same rail', () => {
  assert.match(
    products,
    /<td className=\{`\$\{ROW_TEXT_GUTTER\} py-2 \$\{indented \? CHILD_ROW_INDENT : ''\}`\}>/,
    "the name cell must use ROW_TEXT_GUTTER -- a literal px-3 here is what put names off the group title's rail",
  )
  assert.match(products, /import ProductsListSurface, \{ CHILD_ROW_INDENT, ROW_TEXT_GUTTER \}/)
})

runTest('a grouped child row is indented only slightly, and only when it is actually in a group', () => {
  // The ask was "a bit spacing", not the ~120px the column widths used to
  // produce for every row regardless of grouping.
  const indent = surface.match(/export const CHILD_ROW_INDENT = 'pl-(\d+)'/)
  assert.ok(indent, 'CHILD_ROW_INDENT must be a plain pl-N literal so Tailwind emits it')
  assert.ok(Number(indent![1]) <= 6, `a child indent of pl-${indent![1]} is a step, not a nudge`)
  // `indented` is only ever true for a row inside a rendered group header.
  assert.match(surface, /renderDesktopProductRow\(product, \{ indented: showGroupRow \}\)/)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll productsRowAlignment tests passed')
}
