// N36 -- "for product names, make it horizontal scroll instead of pushing
// rows... make sure it is smooth ios pwa and android pwa, responsive etc...
// clean no need show the scroll bar... just built in." (owner, Sep 6 2026)
//
// Three properties, all of which have failed in this repo before and none of
// which a screenshot would catch:
//
//   1. The behaviour is declared ONCE for the whole stylesheet. "One line,
//      scrolls horizontally, no ellipsis" was declared twice -- the older
//      .detail-scroll-text and this lane's .scroll-x-clean repeated all eight
//      properties and differed only in whether the scrollbar is painted -- so
//      the two could drift apart silently. They now share one base rule and
//      each adds only its scrollbar policy, and this file goes red if a third
//      copy appears.
//   2. touch-action is an OPEN QUESTION, recorded rather than guessed. Every
//      one of these cells sits under .page-scroll or .modal-scroll, both of
//      which pin `touch-action: pan-y`, and BOTH established horizontal
//      utilities answer with `touch-action: pan-x` -- .compact-action-row (a
//      toolbar) and .detail-scroll-text (the closer sibling: a scrolling TEXT
//      cell). .scroll-x-clean sets none, because unlike those two its cells
//      fill most of a LIST row and pinning the axis could make a vertical
//      swipe that starts on a product name do nothing at all. That is a
//      real-device call (iOS PWA / Android PWA), so this file asserts neither
//      value; it pins that the question is written down beside the rule.
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

// Every leaf rule in the stylesheet: selector list + declaration body.
// Comments are stripped first so a brace inside prose cannot desync the scan,
// and the regex only matches blocks with no nested block, so an @layer or
// @media wrapper is walked through rather than captured.
const CSS_RULES: Array<{ selectors: string[]; body: string }> = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] }))

// The declarations that apply to `selector`, joined across every rule whose
// selector list names it exactly (so a base rule and its modifier both count,
// and `.scroll-x-clean::-webkit-scrollbar` does not).
function block(selector: string): string {
  const hits = CSS_RULES.filter((rule) => rule.selectors.includes(selector))
  assert.ok(hits.length > 0, `no CSS rule for selector: ${selector}`)
  return hits.map((rule) => rule.body).join('\n')
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

runTest('ONE rule declares "one line, scrolls, no ellipsis" -- no second copy of it', () => {
  const utilities = CSS_RULES.filter((rule) =>
    /overflow-x:\s*auto/.test(rule.body)
    && /white-space:\s*nowrap/.test(rule.body)
    && /text-overflow:\s*clip/.test(rule.body))
  assert.equal(
    utilities.length,
    1,
    `main.css must declare that behaviour exactly once; found ${utilities.length}: `
      + utilities.map((rule) => rule.selectors.join(', ')).join('  |  '),
  )
  const [base] = utilities
  assert.ok(base.selectors.includes('.scroll-x-clean'), `the product-name class must be on the shared base rule, not a copy of it (selectors: ${base.selectors.join(', ')})`)
  assert.ok(base.selectors.includes('.detail-scroll-text'), `the pre-existing detail-value class must share it (selectors: ${base.selectors.join(', ')})`)
  assert.match(base.body, /min-width:\s*0/, 'must be able to shrink inside a flex/table cell')
  assert.match(base.body, /-webkit-overflow-scrolling:\s*touch/, 'iOS momentum scrolling')
  assert.match(base.body, /overscroll-behavior-inline:\s*contain/, 'a horizontal fling must not chain out to the page')
  assert.doesNotMatch(base.body, /touch-action/, 'the shared base must not settle the open question for both classes at once -- see the next test')
})

runTest('.scroll-x-clean hides the bar in both engines; .detail-scroll-text keeps its hairline', () => {
  const clean = block('.scroll-x-clean')
  assert.match(clean, /scrollbar-width:\s*none/, 'Firefox/standards scrollbar hidden')
  assert.match(clean, /-ms-overflow-style:\s*none/, 'legacy Edge/IE scrollbar hidden')
  assert.match(block('.scroll-x-clean::-webkit-scrollbar'), /display:\s*none/, 'WebKit/Blink scrollbar hidden -- this is the iOS and Android PWA case')
  // The one difference between the two names, and the only reason both exist.
  assert.match(block('.detail-scroll-text'), /scrollbar-width:\s*thin/, 'detail values keep the bar they shipped with')
  assert.match(block('.detail-scroll-text::-webkit-scrollbar'), /height:\s*3px/, 'and its hairline height')
})

runTest('touch-action on .scroll-x-clean is an OPEN QUESTION, recorded rather than guessed', () => {
  // Every converted cell sits under one of these two, and both pin the axis.
  assert.match(block('.page-scroll'), /touch-action:\s*pan-y/, 'the page scroller pins pan-y')
  assert.match(block('.modal-scroll'), /touch-action:\s*pan-y/, 'the modal scroller pins pan-y')
  // Both established horizontal utilities answer that with pan-x -- not just
  // the toolbar, but the closer sibling, a scrolling TEXT cell.
  assert.match(block('.compact-action-row'), /touch-action:\s*pan-x/, 'precedent 1: the horizontal toolbar pins pan-x')
  assert.match(block('.detail-scroll-text'), /touch-action:\s*pan-x/, 'precedent 2: the detail-value text cell pins pan-x too')
  // So the omission on .scroll-x-clean is not a settled design. This test
  // asserts NEITHER value -- it pins that the question is written down beside
  // the rule, so the next writer settles it on a device instead of
  // rediscovering it. Remove this only together with a device result.
  assert.match(
    css,
    /OPEN QUESTION -- touch-action[\s\S]{0,1400}real-device question/,
    'the unsettled axis question must stay recorded in main.css beside the rule',
  )
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
  // On BOTH the class belongs to an inner span, never to the button: the
  // button is the 44px touch target and carries the chevron and the variant
  // count, and a scroller on the button scrolls those two out of view with the
  // name (and `display: block` from the shared rule stops the label centring
  // in the target). The next test pins that separately.
  //
  // Markers: the FIRST `{group.label}` in the file is the desktop title's own
  // span; the mobile one is reached by the count span that follows only it.
  ['Inventory / Branches > Products desktop group title', 'components/inventory/InventoryProductsSurface.tsx', '{group.label}'],
  ['Inventory / Branches > Products mobile group title', 'components/inventory/InventoryProductsSurface.tsx', '{group.label}</span><span className="shrink-0 font-normal">('],
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
  // The TRANSFER product picker on the Branches page. Same shape as the two
  // stock-in pickers above -- a grouped list of products you pick one from --
  // and the same reason applies: a picker option has no detail sheet to fall
  // back on, so the row that tells you which product you are about to move
  // between branches must be readable to its end. All three name cells in
  // that modal: the option, its group title, and the chosen product's own
  // line, which was a dead-end `truncate` on a product name.
  ['Transfer picker option', 'components/branches/TransferModal.tsx', '{product.name}</div>'],
  ['Transfer picker group title', 'components/branches/TransferModal.tsx', "· {(t('transfer_group_variant_count')"],
  ['Transfer picker selected product', 'components/branches/TransferModal.tsx', '{selectedProduct.name}</span>'],
  // Transfer HISTORY on the Branches page -- the mobile card and the desktop
  // table cell for the same value. Both wrapped, so a long product name grew
  // the row instead of scrolling in it, which is the exact defect N36 names.
  // Neither carries `dense-cell-truncate`, so the Stock Change tooltip rule in
  // tests/historyRowModel.test.ts does not key on them and the "dense ledger"
  // exclusion below does not reach them either. The desktop one keeps its own
  // `max-w-[16rem]` cap -- the shared base sits in the components layer, so
  // that Tailwind utility still wins and the name scrolls inside the cap.
  ['Branches transfer history card', 'components/branches/Branches.tsx', '{transfer.product_name}</div>'],
  ['Branches transfer history row', 'components/branches/Branches.tsx', '{transfer.product_name}</span></td>'],
  // The rest of the sweep. `git grep -n "break-words\|truncate\|line-clamp"`
  // over components/products, components/inventory and components/branches,
  // filtered to product-name bindings, also reaches these four. Each is the
  // same defect on a different surface, so leaving them would make the rule
  // hold on the surfaces the ask listed and nowhere else:
  //   - the stock-adjust product picker option (a picker with a dead-end
  //     ellipsis, exactly like the three pickers above),
  //   - the bulk add-stock result row, which names the product a line
  //     succeeded or failed for,
  //   - and the two batch modals' header subtitles, which are the only place
  //     those dialogs say WHICH product you are receiving or managing.
  ['Stock-adjust picker option', 'components/products/forms/StockAdjustModal.tsx', '{group.name || String(lead?.id)}'],
  ['Bulk add-stock result row', 'components/products/forms/BulkAddStockModal.tsx', '{row.request.productName}'],
  ['Manage batches header subtitle', 'components/inventory/ManageBatchesModal.tsx', '{product.name}</div>'],
  ['Receive batch header subtitle', 'components/inventory/ReceiveBatchModal.tsx', '{product.name}</div>'],
  // The Adjust-stock and Transfer dialogs on the Inventory page: identical
  // class string, identical role and identical failure mode as the two batch
  // modals directly above -- a `truncate` with no title=, on the ONE line that
  // says which product the dialog is about. They survived the earlier passes
  // because the enumerating grep's binding filter only knew {product.name},
  // product_name and productName, and these bind {adjustModal.name} and
  // {transferModal.name}. The completeness sweep in section 2c now reads the
  // ELEMENT rather than the line, so a new spelling cannot hide again.
  ['Adjust-stock header subtitle', 'components/inventory/InventoryStockModals.tsx', '{adjustModal.name} - Current:'],
  ['Transfer-stock header subtitle', 'components/inventory/InventoryStockModals.tsx', '{transferModal.name} - '],
]

runTest('every product-name cell carries the one shared class', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.ok(owner.includes('scroll-x-clean'), `${label}: name cell classes are "${owner}"`)
  }
})

runTest('a group title scrolls its NAME, not its chevron and variant count', () => {
  // A group title is a button with three parts: the ▸/▾ chevron, the product
  // name, and the count of variants under it. Putting the scroller on the
  // BUTTON scrolls all three -- so the affordance that says the group is
  // collapsed, and the number that says how many rows are hidden, slide out of
  // view as soon as the name is long enough to need scrolling. It also makes
  // the button `display: block` (the shared rule), which stops the label
  // centring inside the 44px touch target. The class belongs on an inner span.
  const source = read('components/inventory/InventoryProductsSurface.tsx')
  const marks = [...source.matchAll(/aria-expanded=\{!collapsed\.has\(group\.key\)\}/g)]
  assert.equal(marks.length, 2, `both group titles on this surface must be reached; found ${marks.length}`)
  for (const mark of marks) {
    const opener = source.lastIndexOf('<button', mark.index)
    assert.ok(opener > -1, 'a group title must be a button')
    const start = source.indexOf('className="', opener) + 'className="'.length
    const cls = source.slice(start, source.indexOf('"', start))
    assert.doesNotMatch(cls, /\bscroll-x-clean\b/, `the group-title BUTTON must not scroll: its classes are "${cls}"`)
    assert.match(cls, /\bmin-h-11\b/, `the 44px touch target must survive: classes are "${cls}"`)
    assert.match(cls, /\bitems-center\b/, `the label must centre in the touch target: classes are "${cls}"`)
  }
})

runTest('no product-name cell still wraps or ellipsises instead of scrolling', () => {
  for (const [label, file, marker] of NAME_CELLS) {
    const owner = classNear(read(file), marker)
    assert.doesNotMatch(owner, /\bbreak-words\b/, `${label}: still wraps to a second row`)
    assert.doesNotMatch(owner, /\bwhitespace-normal\b/, `${label}: still re-enables wrapping`)
    assert.doesNotMatch(owner, /\btruncate\b/, `${label}: still ends in an unreadable ellipsis`)
    assert.doesNotMatch(owner, /\bline-clamp-/, `${label}: still clamps to N lines`)
  }
})

// ---------------------------------------------------------------------------
// 2b. The name cells that are deliberately NOT converted
// ---------------------------------------------------------------------------
// The ask's own enumerating grep --
//   git grep -n "dense-cell-truncate\|line-clamp" -- \
//     frontend/src/components/products frontend/src/components/inventory
// -- and a plain sweep for product-name bindings also reach cells this lane
// leaves alone. Silence about them is indistinguishable from an oversight, so
// each one is named here with its reason and goes red if anything moves.
//
// Two independent grounds, and either alone is sufficient:
//
//   1. DENSE LEDGER (Stock Change). tests/historyRowModel.test.ts pins "all 8
//      truncated Stock Change cells reveal their value on hover" -- every
//      `dense-cell-truncate` there MUST carry a title=. Converting the cell to
//      .scroll-x-clean drops the truncation that rule keys on, and in a dense
//      six-column ledger the reveal affordance is the tooltip, not a swipe.
//   2. OWNER RULING N26, shipped on the integration tip and now in production:
//      "stock in sessions when clicked on did not show the products full name,
//      got cut by elipses" -> on the three stock-in line surfaces the name
//      WRAPS in full with the barcode under it, and
//      tests/stockInSessionProductNames.test.ts asserts the exact wrapping
//      markup. Scrolling is the N36 remedy for a name that would otherwise be
//      CUT; where the owner has already ruled the name must wrap, N36 does not
//      override N26. (These are also other lanes' files: ledger2 owns
//      StockChangeSection, stockin owns the three stock-in surfaces.)
//
// Shapes asserted: 'truncate+title' = clips AND reveals on hover;
// 'wrap' = wraps to a second line, which has no ellipsis and so no dead end.
// Neither may quietly acquire the scrolling class instead.
const EXCLUDED_CELLS: Array<{
  label: string
  file: string
  marker: string
  shape: 'truncate+title' | 'wrap'
  title?: string
}> = [
  // 1. dense ledger
  { label: 'Stock Change mobile card', file: 'components/products/StockChangeSection.tsx', marker: 'text-[13px] font-semibold leading-4 text-gray-800', shape: 'wrap' },
  { label: 'Stock Change desktop row', file: 'components/products/StockChangeSection.tsx', marker: 'block dense-cell-truncate font-semibold', shape: 'truncate+title', title: 'title={row.product_name}' },
  // 2. owner ruling N26 -- these WRAP on purpose, barcode underneath
  { label: 'Stock-in sessions receipt row', file: 'components/products/StockInSessionsSection.tsx', marker: 'break-words font-semibold">{row.product_name}', shape: 'wrap' },
  { label: 'Stock-in sessions mobile card', file: 'components/products/StockInSessionsSection.tsx', marker: 'block break-words text-[13px] font-medium leading-4', shape: 'wrap' },
  { label: 'Fast stock-in received queue', file: 'components/inventory/FastStockInModal.tsx', marker: '{line.productName}', shape: 'wrap' },
  { label: 'Add-products saved list', file: 'components/products/CreateProductsSessionModal.tsx', marker: "{row.status === 'saved' ? '✅' : '•'} {row.name}", shape: 'wrap' },
  // 3. DETAIL SHEETS. A detail sheet's title IS the reveal a scrolling row
  //    falls back to, so wrapping it in full is the destination, not a
  //    defect: there is nothing further to open, and a swipe gesture on the
  //    sheet's own heading competes with dismissing the sheet. These four
  //    also belong to other lanes (text-affordances owns the product detail
  //    modals, sheet-safe-area owns the description modal, stockin owns the
  //    stock-in line detail).
  { label: 'Product detail sheet title', file: 'components/products/surfaces/ProductDetailModal.tsx', marker: '{productName}</div>', shape: 'wrap' },
  { label: 'Product description sheet title', file: 'components/products/surfaces/ProductDescriptionDetailModal.tsx', marker: '{productName}', shape: 'wrap' },
  { label: 'Inventory product detail sheet title', file: 'components/inventory/ProductDetailModal.tsx', marker: '{p.name}</div>', shape: 'wrap' },
  { label: 'Stock-in line detail title', file: 'components/products/StockInSessionsSection.tsx', marker: 'font-semibold text-gray-900 dark:text-white">{selectedLine.product_name}', shape: 'wrap' },
]

runTest('the ledger and stock-in name cells stay OUT of the scroll conversion, on purpose', () => {
  for (const { label, file, marker, shape, title } of EXCLUDED_CELLS) {
    const source = read(file)
    const owner = classNear(source, marker)
    const where = `${label} (${file}, ${shape}): classes are "${owner}"`
    assert.doesNotMatch(
      owner,
      /\bscroll-x-clean\b/,
      `${where}\n  -- converting this cell needs its own region_exceptions entry plus a check that historyRowModel.test.ts and stockInSessionProductNames.test.ts stay green`,
    )
    if (shape === 'truncate+title') {
      assert.match(owner, /\bdense-cell-truncate\b/, `${where}\n  -- the dense ledger row's clipping is what historyRowModel.test.ts keys its tooltip rule on`)
      const tail = source.slice(source.indexOf(marker), source.indexOf(marker) + 240)
      assert.ok(title && tail.includes(title), `${where}\n  -- a clipped ledger value with no tooltip is a dead-end ellipsis`)
    } else {
      assert.match(owner, /\bbreak-words\b/, `${where}\n  -- this cell wraps by ruling; losing the wrap is a behaviour change, not a class tidy-up`)
    }
  }
})

runTest('the scroll behaviour lives in ONE place, not per file', () => {
  for (const [, file] of NAME_CELLS) {
    const source = read(file)
    assert.doesNotMatch(source, /overflow-x-auto[^"'`\s]*\s+[^"'`]*whitespace-nowrap[^"'`]*scrollbar/, `${file}: hand-rolled scroll classes`)
    assert.doesNotMatch(source, /\[-webkit-overflow-scrolling/, `${file}: per-file momentum-scroll arbitrary value`)
    assert.doesNotMatch(source, /::-webkit-scrollbar/, `${file}: per-file scrollbar CSS`)
  }
})

// ---------------------------------------------------------------------------
// 3. The row must not have lost anything else
// ---------------------------------------------------------------------------

runTest('the name cells keep their existing behaviour and handlers', () => {
  const products = read('components/products/Products.tsx')
  // Tap-to-open: the row-level long-press/click handlers that open the detail
  // sheet are untouched by a class-only change, and both rows still bind them.
  assert.ok((products.match(/createLongPressHandlers\(rowLongPressState, \{/g) || []).length >= 2, 'both product rows keep their long-press/tap handlers')
  assert.match(products, /onClick: \(\) => \{ if \(!dupInfo\) setDetailProduct\(p\) \}/, 'tap-to-open detail is preserved')
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
