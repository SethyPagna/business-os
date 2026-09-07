// N36 -- "for product names, make it horizontal scroll instead of pushing
// rows... make sure it is smooth ios pwa and android pwa, responsive etc...
// clean no need show the scroll bar... just built in." (owner, Sep 6 2026)
//
// Three properties, all of which have failed in this repo before and none of
// which a screenshot would catch:
//
//   1. The class exists once, in styles/main.css, and declares every part of
//      "scrolls, cleanly, on a phone": overflow-x, nowrap, hidden scrollbar in
//      both engines, native momentum, no overscroll chaining.
//   2. It does NOT pin touch-action. A name cell sits inside a vertically
//      scrolling list; `touch-action: pan-x` (which the neighbouring
//      .compact-action-row does use, correctly, for a horizontal toolbar)
//      would make a vertical swipe that happens to start on a product name do
//      nothing at all. This is the "smooth ios pwa and android pwa" half and
//      it is invisible on a desktop mouse.
//   3. EVERY product-name cell uses that one class -- the Products desktop
//      row and mobile card, both group titles, Inventory / Branches >
//      Products desktop and mobile rows, the image-only view, and the
//      expanded branch's own stock cards and group titles on the Branches
//      page -- and none of those files carries scroll CSS of its own.
//
// Run: node tests/productNameScrollCells.test.ts

import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const css = read('styles/main.css')

let failures = 0
function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

function block(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`)
  assert.ok(at > 0, `no CSS rule for selector: ${selector}`)
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

// The class string that OWNS a marker: the nearest class-carrying opener
// before it. Two shapes exist in these files -- a plain className="..." and
// the Khmer-aware getKhmerTextProps(name, '...' | `...`) -- and the nearest of
// the two wins. Markers are chosen so that opener is the name cell itself.
const OPENERS = [
  { lead: 'className="', close: '"' },
  { lead: "getKhmerTextProps(productName, '", close: "'" },
  { lead: 'getKhmerTextProps(productName, `', close: '`' },
]

function classNear(source: string, marker: string): string {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `marker not found: ${marker}`)
  let best = { start: -1, close: '"' }
  for (const opener of OPENERS) {
    const found = source.lastIndexOf(opener.lead, at)
    if (found > -1 && found + opener.lead.length > best.start) {
      best = { start: found + opener.lead.length, close: opener.close }
    }
  }
  assert.ok(best.start > 0, `no class string before marker: ${marker}`)
  const end = source.indexOf(best.close, best.start)
  assert.ok(end > best.start, `unterminated class string before marker: ${marker}`)
  return source.slice(best.start, end)
}

// ---------------------------------------------------------------------------
// 1. The shared class
// ---------------------------------------------------------------------------

runTest('.scroll-x-clean scrolls horizontally with no visible scrollbar', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.match(rule, /overflow-x:\s*auto/, 'must scroll horizontally')
  assert.match(rule, /white-space:\s*nowrap/, 'the name must stay on one line')
  assert.match(rule, /min-width:\s*0/, 'must be able to shrink inside a flex/table cell')
  assert.match(rule, /text-overflow:\s*clip/, 'a scrolling name must not also grow an ellipsis')
  assert.match(rule, /scrollbar-width:\s*none/, 'Firefox/standards scrollbar hidden')
  assert.match(rule, /-webkit-overflow-scrolling:\s*touch/, 'iOS momentum scrolling')
  assert.match(rule, /overscroll-behavior-inline:\s*contain/, 'a horizontal fling must not chain out to the page')
  const bar = block(css, '.scroll-x-clean::-webkit-scrollbar')
  assert.match(bar, /display:\s*none/, 'WebKit/Blink scrollbar hidden -- this is the iOS and Android PWA case')
})

runTest('.scroll-x-clean does NOT pin touch-action, so vertical list scrolling survives', () => {
  const rule = block(css, '.scroll-x-clean')
  assert.doesNotMatch(rule, /touch-action/, 'pinning the axis would break a vertical swipe that starts on a product name')
  // Positive control: the class this one is modelled on DOES pin it, so the
  // assertion above is checking a real distinction and not a typo.
  assert.match(block(css, '.compact-action-row'), /touch-action:\s*pan-x/, 'positive control: the horizontal toolbar class still pins pan-x')
})

runTest('Khmer names keep their ink inside the scrolling box', () => {
  // overflow-y: hidden cannot take an overflow-clip-margin, so without a line
  // -height floor every coeng subscript would be sheared off.
  assert.match(css, /body\.lang-km \.scroll-x-clean[\s\S]{0,80}line-height:\s*var\(--km-line-height/, 'the km line-height floor must be restated for the scrolling cell')
})

// ---------------------------------------------------------------------------
// 2. Every product-name cell uses it -- sibling parity
// ---------------------------------------------------------------------------

const NAME_CELLS: Array<[string, string, string]> = [
  ['Products desktop table row', 'components/products/Products.tsx', '${indented ? \'font-medium\' : \'font-semibold\'}'],
  ['Products mobile card', 'components/products/Products.tsx', 'text-sm font-semibold text-gray-900 dark:text-white'],
  ['Products group title (desktop)', 'components/products/surfaces/ProductsListSurface.tsx', 'text-left text-sm font-semibold text-slate-700'],
  ['Products group title (mobile)', 'components/products/surfaces/ProductsListSurface.tsx', 'text-left text-sm font-semibold text-slate-800'],
  ['Inventory / Branches > Products desktop row', 'components/inventory/InventoryProductsSurface.tsx', 'font-medium text-slate-800 dark:text-slate-100'],
  ['Inventory / Branches > Products mobile row', 'components/inventory/InventoryProductsSurface.tsx', '{product.name || \'—\'}</span><strong>'],
  // The GROUP TITLES on that same surface. `label: group.name` (line 58 of
  // that file) IS the product name, so a group title there is a product-name
  // cell exactly like the three group titles already in this list -- and both
  // of them were still wrapping after the first pass.
  //
  // The desktop one cannot be excused by the argument that keeps the
  // Products.tsx group title safe (a table-fixed table with a colgroup, where
  // a spanning cell cannot widen anything): this table is
  // `<table className="w-full border-collapse text-xs" style={{ minWidth: 680 }}>`
  // -- NOT table-fixed, no colgroup -- so a long label inside the
  // `colSpan={columnCount}` cell wraps and grows the header row.
  //
  // Markers: the FIRST `{group.label}` in the file is the desktop title
  // (the mobile one is later and is reached by its own unique marker), and
  // `({group.items.length})</button>` occurs only in the mobile title.
  ['Inventory / Branches > Products desktop group title', 'components/inventory/InventoryProductsSurface.tsx', '{group.label}'],
  ['Inventory / Branches > Products mobile group title', 'components/inventory/InventoryProductsSurface.tsx', '({group.items.length})</button>'],
  ['Products image-only view', 'components/products/ProductsImageOnlyView.tsx', 'text-sm font-medium text-gray-800 dark:text-gray-100'],
  // The expanded branch's own stock grid on the Branches page. This is a
  // SECOND "Branches > Products" surface, separate from the
  // InventoryProductsSurface rows above, and it is the one the owner reaches
  // by expanding a branch card -- it was still on break-words after the first
  // pass, which is exactly the sibling gap this list exists to catch.
  ['Branch stock card', 'components/branches/Branches.tsx', '{product.name}</div>'],
  ['Branch stock group title', 'components/branches/Branches.tsx', '{group.name}</span>'],
  // Products > Conflicts. A duplicate cluster row is a product row on a
  // Products SUB PAGE, so it is inside the ask, and it was the last name cell
  // still on `truncate` -- behind a tap-to-unwrap toggle that existed only
  // because the ellipsis was otherwise a dead end. Scrolling replaces both,
  // and the toggle's state has to go with it or it becomes zombie code.
  ['Products > Conflicts row', 'components/products/ProductDuplicatesTab.tsx', '{product.name || `#${product.id}`}'],
  // The two stock-in pickers, named as siblings by N36. Both offer a product
  // by NAME and both truncated it, so the row that tells you which product you
  // are about to receive stock into was the one row whose name you could not
  // finish reading -- and a dropdown option has no detail sheet to fall back
  // on. Same shared class, no per-file CSS, handlers untouched.
  ['Stock-in picker (fast stock-in)', 'components/inventory/FastStockInModal.tsx', '{group.name}</span>'],
  ['Stock-in picker (create session)', 'components/products/CreateProductsSessionModal.tsx', '{group.name}</span>'],
  // TransferModal carries four distinct product-name readings: the single
  // picker result, the selected-product summary, each bulk-picker row and the
  // bulk group title. A person must be able to read the distinguishing suffix
  // before moving stock, so all four use the same scroll contract.
  ['Transfer single picker group', 'components/branches/TransferModal.tsx', '{group.name}</span>'],
  ['Transfer selected product', 'components/branches/TransferModal.tsx', '{selectedProduct.name}</span>'],
  ['Transfer bulk picker row', 'components/branches/TransferModal.tsx', '{product.name}</div>'],
  ['Transfer bulk group title', 'components/branches/TransferModal.tsx', '{group.name} ·'],
]

runTest('every product-name cell carries the one shared class', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.ok(owner.includes('scroll-x-clean'), `${label}: name cell classes are "${owner}"`)
  }
})

runTest('no product-name cell still wraps or ellipsises instead of scrolling', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.doesNotMatch(owner, /\bbreak-words\b/, `${label}: still wraps to a second row`)
    assert.doesNotMatch(owner, /\btruncate\b/, `${label}: still ends in an unreadable ellipsis`)
    assert.doesNotMatch(owner, /\bline-clamp-/, `${label}: still clamps to N lines`)
  }
})

// ---------------------------------------------------------------------------
// 2b. The four cells that are deliberately NOT converted
// ---------------------------------------------------------------------------
// The ask's own enumerating grep --
//   git grep -n "dense-cell-truncate\|line-clamp" -- \
//     frontend/src/components/products frontend/src/components/inventory
// -- also returns product-name cells on two Products SUB PAGES that this lane
// does not convert: Stock Change and Stock-in sessions, both rendered from
// Products.tsx a couple of dozen lines from the Conflicts tab that IS in
// NAME_CELLS above. Silence about them is indistinguishable from an oversight,
// so the exclusion is stated here and goes red if anything moves.
//
// Two independent reasons, and either one alone is sufficient:
//
//   1. They are dense six-column HISTORY/ledger rows, governed by a different
//      convention that tests/historyRowModel.test.ts already pins: "a
//      truncated Stock Change cell has no tooltip to reveal it" -- every
//      `dense-cell-truncate` there MUST carry a title=. Converting the cell to
//      .scroll-x-clean drops the truncation the tooltip rule keys on, and the
//      reveal affordance in a dense ledger is the tooltip, not a swipe.
//   2. Both files belong to OTHER running lanes (ledger2 owns
//      StockChangeSection, stockin owns StockInSessionsSection), so they are
//      not this lane's to rewrite.
//
// The shape asserted per cell: a desktop cell truncates AND titles itself; a
// mobile twin wraps (break-words), which has no ellipsis and therefore no dead
// end. Neither may quietly acquire the scrolling class instead.
const EXCLUDED_CELLS: Array<{ file: string; expect: Array<'truncate+title' | 'wrap'> }> = [
  // The desktop dense cell is served by the delegated reveal controller;
  // the mobile twin wraps in full.
  { file: 'components/products/StockChangeSection.tsx', expect: ['wrap', 'truncate+title'] },
  // The deployed-lineage stock-in work made both twins wrap before this lane
  // was reconciled. Preserve that newer readable behavior; the exclusion is
  // about keeping history rows out of product-name horizontal scrolling.
  { file: 'components/products/StockInSessionsSection.tsx', expect: ['wrap', 'wrap'] },
]

runTest('the dense history name cells stay OUT of the scroll conversion, on purpose', () => {
  for (const { file, expect } of EXCLUDED_CELLS) {
    const source = read(file)
    const tags = [...source.matchAll(/<span\b[^>]*>\{row\.product_name\}/g)].map((m) => m[0])
    assert.equal(
      tags.length,
      expect.length,
      `${file}: expected ${expect.length} product-name cells, found ${tags.length} -- the exclusion list is stale`,
    )
    tags.forEach((tag, i) => {
      const where = `${file} cell ${i + 1} (${expect[i]}): ${tag}`
      assert.doesNotMatch(tag, /\bscroll-x-clean\b/, `${where}\n  -- converting this cell needs its own region_exceptions entry and a check that historyRowModel.test.ts stays green`)
      if (expect[i] === 'truncate+title') {
        assert.match(tag, /\bdense-cell-truncate\b/, `${where}\n  -- the dense ledger row's clipping is what historyRowModel.test.ts keys its tooltip rule on`)
        assert.match(tag, /\btitle=/, `${where}\n  -- a clipped ledger value with no tooltip is a dead-end ellipsis`)
      } else {
        assert.match(tag, /\bbreak-words\b/, `${where}\n  -- the mobile twin wraps instead of clipping, so it has no ellipsis to reveal`)
      }
    })
  }
})

runTest('the scroll behaviour lives in ONE place, not per file', () => {
  for (const [, file] of NAME_CELLS) {
    const source = read(file)
    assert.doesNotMatch(source, /overflow-x-auto[^"'`\s]*\s+[^"'`]*whitespace-nowrap[^"'`]*scrollbar/, `${file}: hand-rolled scroll classes`)
    assert.doesNotMatch(source, /\[-webkit-overflow-scrolling/, `${file}: per-file momentum-scroll arbitrary value`)
    assert.doesNotMatch(source, /::-webkit-scrollbar/, `${file}: per-file scrollbar CSS`)
  }
  assert.equal((css.match(/^\.scroll-x-clean \{/gm) || []).length, 1, '.scroll-x-clean must be declared exactly once')
})

// ---------------------------------------------------------------------------
// 3. The row must not have lost anything else
// ---------------------------------------------------------------------------

runTest('the name cells keep their existing behaviour and handlers', () => {
  const products = read('components/products/Products.tsx')
  // Tap-to-open: the row-level long-press/click handlers that open the detail
  // sheet are untouched by a class-only change, and both rows still bind them.
  assert.ok((products.match(/createLongPressHandlers\(rowLongPressState, \{/g) || []).length >= 2, 'both product rows keep their long-press/tap handlers')
  assert.equal((products.match(/deferCopySurfaceAction\(copyTarget/g) || []).length, 4,
    'single-click row actions are deferred only on copy triggers, so double-click can win without pre-opening the product')
  // Khmer name detection still wraps the name, so the shared class composes
  // with the Khmer text class rather than replacing it.
  assert.equal(
    (products.match(/getKhmerTextProps\(productName, ['`]scroll-x-clean/g) || []).length,
    2,
    'both product-name cells still route their class through getKhmerTextProps',
  )
})

if (failures) {
  console.error(`${failures} failing check(s)`)
  process.exit(1)
}
console.log('PASS productNameScrollCells')
