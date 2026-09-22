// Reports readability lane (owner, Sep 22 2026, verbatim): "reports section,
// the other options other than overview are text heavy and the boldness,
// weight made it worse. balance that. also the size is too big... can make it
// manageable. also product names are using elipses when too long, remember we
// don't do that. we do scroll left and right. also when i click on the
// reports rows the opened details are unreadable.. broken. fix them. also
// when open open as a float , click outside/click close to close... current
// if i move it just auto close."
//
// Four contracts are pinned here, each with a NEGATIVE CONTROL -- a synthetic
// source string that still carries the defect, run through the same predicate,
// so a checker that has silently stopped discriminating fails loudly instead
// of reporting green on everything.
//
//   1. No name in a report row or row detail ends in an ellipsis. Long names
//      scroll sideways through the app-wide `.detail-scroll-text` (main.css),
//      the same scroller the product detail surfaces use -- not a second
//      implementation, and not a hover-only `title` tooltip.
//   2. A detail float closes ONLY through its header X, an outside press,
//      Escape or the browser Back. Nothing bound to pointer movement, and --
//      the actual root cause of the owner's "if i move it just auto close" --
//      no effect keyed on the caller's inline `onClose`, whose identity
//      changes on every unrelated re-render (the app shell re-renders the page
//      while scrolling) and whose teardown ran history.back() -> popstate ->
//      close.
//   3. The row detail is readable: the receipt sheet lays its cards out from
//      its OWN width (a container query), never the viewport's, so the sheet
//      inside a 320-448px float is one tape instead of three ~90px columns.
//   4. Weight and size are balanced against the Overview: no per-row
//      semibold in the list views, and no screen-only size bump above the
//      document scale.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const stripComments = (source: string) => source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const table = read('src/components/sales/reports/ReportTable.tsx')
const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
const grouped = read('src/components/sales/reports/GroupedReport.tsx')
const period = read('src/components/sales/reports/PeriodReport.tsx')
const fold = read('src/components/shared/kit/Fold.tsx')
const surfaceCss = read('src/components/sales/reports/reports-surface.css')
const mainCss = read('src/styles/main.css')

const failures: string[] = []
function check(name: string, run: () => void): void {
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}`)
    console.log(String(error instanceof Error ? error.message : error))
  }
}

// ---------------------------------------------------------------------------
// 1. Names scroll, never ellipsise.
// ---------------------------------------------------------------------------

/** Does this source still cut text with an ellipsis box in its markup? */
export function hasEllipsisedCells(source: string): boolean {
  const code = stripComments(source)
  return /className=[^\n]*\btruncate\b/.test(code) || /\btext-ellipsis\b/.test(code) || /\bline-clamp-\d/.test(code)
}

check('report rows and row details never ellipsise a name', () => {
  for (const [label, source] of [['ReportTable', table], ['ReceiptSheet', sheet], ['GroupedReport', grouped]] as const) {
    assert.equal(hasEllipsisedCells(source), false, `${label} still has an ellipsis box on a text cell`)
  }
  // ...and the replacement is the shared scroller, used the same way the
  // product detail surfaces already use it (one implementation, not two).
  assert.match(table, /<span className="detail-scroll-text">\{formatCell\(c, row, fmtMoney\)\}<\/span>/, 'text cells scroll their full value')
  assert.match(sheet, /className="detail-scroll-text font-medium">\{block\.title\}/, 'a card title (the record name) scrolls')
  assert.match(sheet, /\['detail-scroll-text', cellClass\]/, 'a ledger label scrolls')
  assert.match(mainCss, /\.detail-scroll-text\s*\{[^}]*overflow-x:\s*auto[^}]*white-space:\s*nowrap/, 'the shared scroller is a real horizontal scroller')
  // The `title` tooltip that used to be the only reveal is gone with the
  // ellipsis: a native tooltip vanishes the moment the pointer moves, which
  // is the behaviour the owner rejected.
  assert.doesNotMatch(stripComments(table), /title=\{c\.kind/, 'no hover-only tooltip stands in for the full value')
})

check('NEGATIVE CONTROL: the ellipsis checker still fails a truncating cell', () => {
  const defective = '<td className={["max-w-[200px] truncate", extra].join(" ")} title={String(value)}>{cell}</td>'
  assert.equal(hasEllipsisedCells(defective), true, 'the checker must reject a truncating cell')
  assert.equal(hasEllipsisedCells('// truncate is deliberately not used here\n<td className="max-w-[200px]">{cell}</td>'), false, 'prose about truncation is not a truncating cell')
})

check('a scrolled name keeps a Khmer line box (overflow-y cannot stay visible beside overflow-x)', () => {
  assert.match(
    surfaceCss,
    /body\.lang-km \[data-reports-hub\] \.detail-scroll-text,\s*\n\s*body\.lang-km \.reports-fold-panel \.detail-scroll-text \{\s*\n\s*padding-block: 2px/,
    'the Khmer block pays for the scroller line box in the report AND in the portalled fold',
  )
})

// ---------------------------------------------------------------------------
// 2. The float closes only on X / outside / Escape / Back.
// ---------------------------------------------------------------------------

/** Every DOM event this source closes or opens a panel from. */
export function pointerCloseListeners(source: string): string[] {
  const code = stripComments(source)
  const listeners = [...code.matchAll(/addEventListener\(\s*'([a-z]+)'/g)].map((m) => m[1])
  const props = [...code.matchAll(/\bon(MouseLeave|MouseOut|PointerLeave|PointerOut|MouseMove|PointerMove)\s*=/g)].map((m) => m[1])
  return [...listeners.filter((e) => /^(mouseleave|mouseout|pointerleave|pointerout|mousemove|pointermove)$/.test(e)), ...props]
}

/** Effects that would tear down and re-arm whenever the caller re-renders. */
export function effectsKeyedOnOnClose(source: string): string[] {
  return [...stripComments(source).matchAll(/\}, \[([^\]]*)\]\)/g)]
    .map((m) => m[1])
    .filter((deps) => /\bonClose\b/.test(deps))
}

check('the detail float has no pointer-movement close path', () => {
  assert.deepEqual(pointerCloseListeners(fold), [], 'Fold closes nothing from a pointer moving or leaving')
  assert.match(fold, /document\.addEventListener\('mousedown', closeIfOutside\)/, 'an outside PRESS still closes it')
  assert.match(fold, /event\.key === 'Escape'/, 'Escape still closes it')
  // Exactly one close affordance per rendered panel: the header X, in each of
  // the two branches (mobile sheet, desktop panel).
  assert.equal((fold.match(/aria-label=\{tr\('close', 'Close'\)\}/g) || []).length, 2, 'one header X per panel branch, no second close control')
})

check('no Fold effect is keyed on the caller\'s inline onClose', () => {
  assert.deepEqual(effectsKeyedOnOnClose(fold), [], 'a changing handler identity must not re-arm the history entry, or its popstate closes the panel')
  assert.match(fold, /const onCloseRef = useRef\(onClose\)/, 'the latest handler is reached through a ref instead')
  assert.match(fold, /onCloseRef\.current\(\)/, 'the close paths call through that ref')
  // Scrolling MOVES the anchored panel with its row; it never closes it.
  assert.match(fold, /document\.addEventListener\('scroll', track, true\)/, 'the anchored panel follows its row on scroll')
})

check('NEGATIVE CONTROL: both float checkers still fail the pre-fix Fold', () => {
  const defective = `
    useEffect(() => {
      const closeOnLeave = () => onClose()
      document.addEventListener('mouseleave', closeOnLeave)
      window.history.pushState({}, '')
      return () => { document.removeEventListener('mouseleave', closeOnLeave); window.history.back() }
    }, [open, onClose])
  `
  assert.deepEqual(pointerCloseListeners(defective), ['mouseleave'], 'the checker must catch a pointer-leave close')
  assert.deepEqual(effectsKeyedOnOnClose(defective), ['open, onClose'], 'the checker must catch an onClose-keyed effect')
})

// ---------------------------------------------------------------------------
// 3. The row detail is laid out from the width it actually has.
// ---------------------------------------------------------------------------

check('the row detail reads as one tape inside a float and as cards in the report', () => {
  assert.match(surfaceCss, /\.report-receipt-sheet\s*\{[^}]*container-type:\s*inline-size/, 'the sheet is its own query container')
  assert.match(surfaceCss, /@container \(min-width: 40rem\)/, 'cards appear from a SHEET width, not a window width')
  assert.ok(!/md:grid|xl:grid-cols/.test(stripComments(sheet)), 'no viewport variant decides the card grid')
  assert.match(sheet, /data-receipt-layout=\{centered \? 'statement' : 'cards'\}/, 'the centered statement opts out of the card grid explicitly')
  // The two folds whose body is a full income statement take the kit's wide
  // panel; 320px was not a width a statement's label/value pairs fit in.
  for (const [label, source] of [['GroupedReport', grouped], ['PeriodReport', period]] as const) {
    assert.match(source, /size="lg"/, `${label}'s statement fold uses the wide panel`)
  }
})

// ---------------------------------------------------------------------------
// 4. Weight and size, measured against the Overview.
// ---------------------------------------------------------------------------

check('list views carry no per-row bold, and no size above the document scale', () => {
  assert.match(table, /c\.emphasis \? 'font-medium' : ''/, 'the emphasised column is medium, not bold, on every row')
  assert.match(sheet, /total: 'pt-1 font-medium'/, 'a card/ledger total is medium; the rule above it carries the hierarchy')
  assert.match(grouped, /font-mono font-medium">\{c\.lineSales\}/, 'the products card headline is medium')
  // One bold row survives per table -- the totals line -- which is exactly
  // what the Overview statement does.
  assert.match(table, /<tr className="h-\[var\(--ui-row-h\)\] bg-\[var\(--ui-surface-2\)\] font-semibold">/, 'the single totals row keeps its weight')
  assert.doesNotMatch(surfaceCss, /@media screen\s*\{/, 'the screen-only +2px size bump is gone (owner: "the size is too big")')
  assert.match(surfaceCss, /--ui-size-body:\s*12px/, 'the compact document scale is the base')
  assert.doesNotMatch(surfaceCss, /calc\(16px \* var\(--ui-km-boost/, 'no 16px Latin body anywhere in the surface')
})

if (failures.length) {
  console.log(`\n${failures.length} test(s) failed`)
  process.exit(1)
}
console.log('PASS reports readability: names scroll, details are readable, floats close only on X/outside')
