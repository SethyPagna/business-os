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
  // The checkbox column width is now derived (selectColWidth) so it can
  // collapse to 0 out of select mode (11.1); it must still resolve to
  // SELECT_COL_WIDTH while selecting, and the image column stays fixed.
  assert.match(
    surface,
    /<col style=\{\{ width: selectColWidth \}\} \/>\s*<col style=\{\{ width: IMAGE_COL_WIDTH \}\} \/>/,
    'the colgroup checkbox col must read selectColWidth (which is SELECT_COL_WIDTH in select mode, 0 otherwise) and the image col the constant',
  )
  assert.match(surface, /const selectColWidth = selectionModeActive \? SELECT_COL_WIDTH : '0px'/, 'the checkbox column collapses to 0 out of select mode')
})

runTest('the image column fits the thumbnail without excess indentation', () => {
  // "too much indentation when only need a bit spacing from group image".
  const imageWidth = Number(surface.match(/const IMAGE_COL_WIDTH = '([\d.]+)rem'/)![1])
  // The desktop thumbnail is h-14 w-14 = 3.5rem (enlarged Aug 29), and its
  // cell adds px-2 (0.5rem each side = 1rem). The column must therefore be
  // AT LEAST 4.5rem or the fixed-width thumbnail overflows into the name
  // rail; and no more than ~a little over that, or the extra reads as the
  // reported left-rail indentation.
  assert.ok(imageWidth >= 4.5, `the column must fit the 3.5rem thumbnail + its 1rem px-2 gutter (>= 4.5rem), got ${imageWidth}rem`)
  assert.ok(imageWidth <= 5.5, `the column reserved ${imageWidth}rem for a 3.5rem thumbnail -- that gap is the reported indentation`)
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
  // The group header spans the trailing columns (title on the NAME rail);
  // the category band spans one column further LEFT (label on the IMAGE
  // rail). Two different spans on purpose -- see the next test.
  assert.match(surface, /<td colSpan=\{FULL_WIDTH_ROW_SPAN\}/, 'the group header must span the trailing columns via FULL_WIDTH_ROW_SPAN')
  assert.match(surface, /<td colSpan=\{CATEGORY_BAND_SPAN\}/, 'the category band must span from the image column via CATEGORY_BAND_SPAN')
  assert.match(surface, /const FULL_WIDTH_ROW_SPAN = 6/)
  assert.match(surface, /const CATEGORY_BAND_SPAN = 7/)
})

runTest('the category band sits on the IMAGE rail, one column left of the group title', () => {
  // The revised target (user, Aug 26): a category names a shelf of
  // pictured products, so its label reads against the pictures, not the
  // names. CATEGORY_BAND_SPAN must therefore be exactly one MORE than
  // FULL_WIDTH_ROW_SPAN -- the extra column it eats is the image column.
  const categorySpan = Number(surface.match(/const CATEGORY_BAND_SPAN = (\d+)/)![1])
  const groupSpan = Number(surface.match(/const FULL_WIDTH_ROW_SPAN = (\d+)/)![1])
  assert.strictEqual(categorySpan - groupSpan, 1, 'the category band must cover exactly one more column (the image column) than the group header')
})

runTest('desktop columns fit the available width and overflow remains reachable', () => {
  // Name and Details flex with the table while the four numeric columns stay
  // compact. This keeps Stock/Qty in the default viewport at xl widths.
  const colgroup = surface.slice(surface.indexOf('<colgroup>'), surface.indexOf('</colgroup>'))
  // Name auto, Details bounded and immediately adjacent -- unchanged. The
  // bound itself moved 10.5rem -> 15rem: both 10.5rem and 12.5rem sat under
  // the two branch chips once Noto Sans Khmer widened them, so they wrapped
  // and every row in the report grew (see the colgroup comment). The five
  // bounded widths now sum to 44.5rem, still inside the 58rem table minimum
  // asserted three lines below.
  assert.match(colgroup, /<col \/>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<col style=\{\{ width: '15rem' \}\} \/>/)
  assert.strictEqual((colgroup.match(/<col style=\{\{ width: '[\d.]+rem' \}\} \/>/g) || []).length, 5)
  assert.match(surface, /<div className="relative overflow-x-auto">/)
  assert.match(surface, /<table className="w-full min-w-\[58rem\] table-fixed/)
  assert.match(surface, /card hidden min-w-0 max-w-full overflow-hidden xl:flex/)
  assert.match(surface, /min-w-0 max-w-full space-y-2 xl:hidden/)
})

runTest('a product row uses the shared gutter for its name, so it lands on the same rail', () => {
  assert.match(
    products,
    /<td className=\{`\$\{ROW_TEXT_GUTTER\} py-2`\}>/,
    "the name cell must use ROW_TEXT_GUTTER for every row -- a child aligns with the group title, no indent",
  )
  assert.match(products, /import ProductsListSurface, \{ ROW_TEXT_GUTTER \}/)
})

runTest('a grouped child row aligns with the group title -- no text indent (the empty image column is the offset)', () => {
  // Revised (user, mid-turn): a child row shows no image, and that empty
  // image column already sets the group title's thumbnail apart, so the
  // child NAME lines up exactly with the group title. There must be no
  // CHILD_ROW_INDENT applying a text nudge.
  assert.ok(!/export const CHILD_ROW_INDENT/.test(surface), 'CHILD_ROW_INDENT must be gone -- a child row aligns with the group title, no indent')
  assert.ok(!/CHILD_ROW_INDENT/.test(products), 'Products.tsx must not apply a child indent any more')
  // `indented` is still what drops the child's thumbnail (its only remaining job).
  assert.match(surface, /renderDesktopProductRow\(product, \{ indented: showGroupRow \}\)/)
})

runTest('11.2: the desktop header checkbox is the select-all (aligned with the other five list pages)', () => {
  // Part 451: Products was the lone list page with an always-visible toolbar
  // "Select all (N)" control and an empty header cell; it now matches
  // Inventory/Sales/Returns/Branches/Contacts -- the column-header checkbox
  // IS select-all in select mode, over the shared selection helpers.
  assert.match(surface, /checked=\{isSelectionScopeFullySelected\(allVisibleIds\)\}/, 'the header select-all reads whether every visible product is selected')
  assert.match(surface, /onChange=\{\(event\) => toggleSelectionScope\(allVisibleIds, event\.target\.checked\)\}/, 'the header select-all toggles the whole visible scope')
  assert.ok(!/desktopSelectAllRef|mobileSelectAllRef/.test(products), 'Products.tsx keeps no dead select-all ref')
  assert.ok(!/const productSelectAllLabel/.test(products), 'the always-visible toolbar "Select all (N)" control is removed')
})

runTest('11.1: the checkbox column only takes space in select mode', () => {
  assert.match(surface, /const selectColWidth = selectionModeActive \? SELECT_COL_WIDTH : '0px'/)
  assert.match(surface, /const selectCellPad = selectionModeActive \? 'px-2' : 'px-0'/)
  assert.match(surface, /<td className=\{`\$\{selectCellPad\} py-2`\}>/, 'the category band checkbox cell collapses')
  assert.match(surface, /<td className=\{`\$\{selectCellPad\} py-2\.5`\}>/, 'the group header checkbox cell collapses')
  assert.match(products, /<td className=\{`\$\{selectionModeActive \? 'px-2' : 'px-0'\} py-2`\} onClick=/, 'the product row checkbox cell collapses out of select mode')
})

runTest('mobile keeps same-name products inside the grouped UI instead of flattening them', () => {
  assert.match(surface, /const showGroupRow = group\.rows\.length > 1/, 'mobile and desktop must both decide grouping from the number of display rows')
  assert.ok(!/Small screens skip group TITLE rows entirely/.test(surface), 'the old mobile-only flattening path must stay removed')
  assert.match(surface, /renderMobileProductCard\(product, \{ indented: true \}\)/, 'rows inside a mobile group render as grouped rows')
  assert.match(surface, /renderGroupThumbnail \? renderGroupThumbnail\(group\) : null/, 'mobile group header keeps the shared group thumbnail')
  assert.match(surface, /getGroupSummaryParts\(group\)\.map/, 'mobile group header exposes the same group summary information')
  assert.match(surface, /onClick=\{\(\) => toggleProductGroup\(group\.key\)\}/, 'mobile group header can expand and collapse')
})

runTest('11.3: hold-to-select is wired onto the group title row', () => {
  assert.match(surface, /\{\.\.\.\(bindGroupHold \? bindGroupHold\(group\) : \{\}\)\}/, 'the group header <tr> spreads the hold handlers')
  assert.match(products, /const bindGroupHold = useCallback/, 'Products.tsx defines bindGroupHold')
  assert.match(products, /onLongPress: \(\) => toggleSelectionScope\(\(group\.ids/, 'a hold selects the whole group')
  assert.match(products, /consumeLongPressClick\(state\)/, 'a ghost-click guard stops the group also toggling expand after a hold')
  assert.match(products, /bindGroupHold=\{bindGroupHold\}/, 'bindGroupHold is passed to the surface')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll productsRowAlignment tests passed')
}
