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
const overview = read('src/components/sales/reports/OverviewReport.tsx')
const frame = read('src/components/sales/reports/ReportFrame.tsx')
const hub = read('src/components/sales/ReportsHub.tsx')
const salesList = read('src/components/sales/reports/SalesListReport.tsx')
const returns = read('src/components/sales/reports/ReturnsReport.tsx')
const expenses = read('src/components/sales/reports/ExpensesReport.tsx')
const fold = read('src/components/shared/kit/Fold.tsx')
const sectionHeader = read('src/components/shared/kit/SectionHeader.tsx')
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

/** Does this source still cut text with an ellipsis box in its markup?
 *
 *  A class CONSTANT counts as markup: the kit's fold header keeps its class
 *  string in `FOLD_TITLE_CLASS`, so a predicate anchored to `className=`
 *  would have read the ellipsis that shipped there as absent. */
export function hasEllipsisedCells(source: string): boolean {
  const code = stripComments(source)
  return /\btruncate\b/.test(code) || /\btext-ellipsis\b/.test(code) || /\bline-clamp-\d/.test(code)
}

check('report rows, row details, the hub and the kit fold never ellipsise a name', () => {
  // Fold is in this list because the ROOT CAUSE lived there: the kit put
  // `truncate` on the panel heading and only `.reports-fold-panel > div > h3`
  // in reports-surface.css undid it, so every other Fold caller (the kit
  // gallery, anything adopted later) kept the ellipsis and any change to the
  // header's DOM shape silently re-broke the reports one.
  // SectionHeader is here for the same reason Fold is: it is the kit's own
  // heading row, and a report's <h2> IS a SectionHeader title. Worse than
  // Fold's case, its `title` tooltip only ever covered the string form --
  // ReportFrame passes a titleControl ELEMENT as the title, so the active
  // report's own name was an ellipsis with no reveal at all behind it.
  for (const [label, source] of [['ReportTable', table], ['ReceiptSheet', sheet], ['GroupedReport', grouped], ['ReportFrame', frame], ['ReportsHub', hub], ['kit Fold', fold], ['kit SectionHeader', sectionHeader]] as const) {
    assert.equal(hasEllipsisedCells(source), false, `${label} still has an ellipsis box on a text cell`)
  }
  // ...and the replacement is the shared scroller, used the same way the
  // product detail surfaces already use it (one implementation, not two).
  assert.match(table, /<span className="detail-scroll-text">\{formatCell\(c, row, fmtMoney\)\}<\/span>/, 'text cells scroll their full value')
  assert.match(sheet, /'detail-scroll-text font-medium'/, 'a card title (the record name) scrolls')
  assert.match(sheet, /\['detail-scroll-text', cellClass\]/, 'a ledger label scrolls')
  // The fold header takes the same scroller the shared Modal's header takes
  // (`Modal.tsx`: `detail-scroll-text min-w-0 flex-1`) -- level-1 and level-2
  // dialogs reveal a long title the same way.
  assert.match(fold, /const FOLD_TITLE_CLASS = 'detail-scroll-text min-w-0 flex-1/, 'the kit fold header scrolls its title at the kit, not through a per-surface override')
  assert.equal((fold.match(/<h3 className=\{FOLD_TITLE_CLASS\}>/g) || []).length, 2, 'both fold branches (mobile sheet, desktop panel) share that one heading class')
  assert.match(sectionHeader, /<h2\s*\n\s*className="detail-scroll-text /, 'the kit section heading scrolls a long title too')
  assert.doesNotMatch(stripComments(surfaceCss), /\.reports-fold-panel > div > h3/, 'the per-surface heading override is gone with the cause')
  // The date-range handle is the one place the hub still had an ellipsis:
  // its only text IS the range it exists to report.
  assert.match(hub, /className="detail-scroll-text min-w-0 text-\[length:var\(--ui-size-meta\)\]/, 'the folded filters handle scrolls the active range')
  // An error message is prose: it wraps rather than scrolls or ellipsises.
  assert.match(frame, /className="min-w-0 flex-1 whitespace-normal break-words">\{error\}/, 'a report error is readable in full')
  assert.match(mainCss, /\.detail-scroll-text\s*\{[^}]*overflow-x:\s*auto[^}]*white-space:\s*nowrap/, 'the shared scroller is a real horizontal scroller')
  // The `title` tooltip that used to be the only reveal is gone with the
  // ellipsis: a native tooltip vanishes the moment the pointer moves, which
  // is the behaviour the owner rejected.
  assert.doesNotMatch(stripComments(table), /title=\{c\.kind/, 'no hover-only tooltip stands in for the full value')
})

check('NEGATIVE CONTROL: the ellipsis checker still fails a truncating cell', () => {
  const defective = '<td className={["max-w-[200px] truncate", extra].join(" ")} title={String(value)}>{cell}</td>'
  assert.equal(hasEllipsisedCells(defective), true, 'the checker must reject a truncating cell')
  // ...including one hidden behind a class constant, which is exactly how the
  // kit fold carried it.
  assert.equal(hasEllipsisedCells("const TITLE = 'min-w-0 flex-1 truncate font-semibold'"), true, 'the checker must reject an ellipsis hidden in a class constant')
  assert.equal(hasEllipsisedCells('// truncate is deliberately not used here\n<td className="max-w-[200px]">{cell}</td>'), false, 'prose about truncation is not a truncating cell')
})

check('a scrolled name keeps a Khmer line box (overflow-y cannot stay visible beside overflow-x)', () => {
  // The box is bought ONCE, in main.css, by the unlayered line-height floor --
  // and `--km-line-height` is defined in exactly one place, so there is no
  // smaller value for the floor to miss. This surface used to add
  // `padding-block: 2px` on top of it, which made every Khmer scroller row 4px
  // taller than it needed to be. Measured in headless Chrome over the real hub
  // in lang-km, worst case of all 56 scroller cells: with the padding gone the
  // ink sat 1.94px below the top of its box and 4.06px above the bottom at
  // 1254px, and 2.52px / 3.48px at 526px; scrollHeight equalled clientHeight on
  // all 56; an overflow hidden-vs-visible pixel comparison (control: a squashed
  // line box, which it does report) found no ink outside the box.
  assert.match(
    mainCss,
    /body\.lang-km \.detail-scroll-text,\s*\n\.detail-scroll-text\.khmer-text \{ line-height: var\(--km-line-height, 1\.6\); \}/,
    'main.css must carry the one Khmer floor the scroller depends on',
  )
  assert.deepEqual(mainCss.match(/--km-line-height:\s*[\d.]+/g), ['--km-line-height: 1.6'],
    'the floor is one number, defined once -- a second, smaller one would need its own padding case')
  // Read without comments: this file explains the decision in prose right
  // above the rule, and prose about padding is not padding.
  const surfaceRules = stripComments(surfaceCss)
  assert.doesNotMatch(surfaceRules, /detail-scroll-text[^{}]*\{\s*\n\s*padding-block/,
    'the reports surface must not pay a second time for a line box main.css already buys')
  // The TRUNCATING cells are a different clip site and keep their padding:
  // `.truncate` is `overflow: hidden`, whose Khmer room comes from an
  // @supports block a browser may not apply.
  assert.match(
    surfaceRules,
    /body\.lang-km \[data-reports-hub\] td\.truncate,\s*\n\s*body\.lang-km \[data-reports-hub\] \.truncate \{\s*\n\s*padding-block: 2px/,
    'the elliptical cells keep the padding that is their only unconditional room',
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
  assert.match(fold, /document\.addEventListener\('scroll', scheduleTrack, true\)/, 'the anchored panel follows its row on scroll')
})

/** Does the anchored placement keep the panel inside the viewport vertically,
 *  the way it already did horizontally? */
export function clampsToViewport(source: string): { top: boolean; bottom: boolean; height: boolean } {
  const code = stripComments(source)
  return {
    top: /const top = Math\.min\(Math\.max\(margin, rect\.bottom \+ gap\)/.test(code),
    bottom: /const bottom = Math\.min\(Math\.max\(margin, viewportHeight - rect\.top \+ gap\)/.test(code),
    height: /Math\.max\(margin, viewportHeight - margin - maxHeight\)/.test(code),
  }
}

check('a scrolled-away row cannot carry the float off the screen', () => {
  // The float follows its anchor, so without a vertical clamp scrolling the
  // list to the end put the panel at a measured top of -872px: fully off the
  // top, its X unreachable, and a fixed element cannot be scrolled back. The
  // owner's "if i move it it disappears" survived the auto-close fix on
  // desktop because of exactly this.
  assert.deepEqual(clampsToViewport(fold), { top: true, bottom: true, height: true }, 'both placements clamp to the viewport margins, and the height clamps with them')
  // One measurement per frame, not one per scroll event.
  assert.match(fold, /frame = window\.requestAnimationFrame\(/, 'scroll/resize tracking is coalesced into one rAF')
  assert.match(fold, /if \(frame\) window\.cancelAnimationFrame\(frame\)/, 'the pending frame is cancelled with the listeners')
  assert.match(fold, /if \(last && last\.top === rect\.top/, 'an unchanged anchor rect never re-renders the panel')
})

check('the anchored panel re-measures when the open row changes', () => {
  // `anchorRef.current` is a MUTATION: React never re-runs an effect for it.
  // Pressing a second row while the float is open swapped the ref to the new
  // row but left the panel measured against the old one, so the detail hung
  // beside the wrong row (measured in reportsDetailFloatClose: panel top
  // 275px while the newly-opened row sat at 542px). The row's identity is
  // passed in as `anchorKey` and keyed into the placement effect.
  assert.match(fold, /anchorKey\?: string \| number/, 'the kit takes the anchor identity as a prop')
  assert.match(fold, /\}, \[open, isMobile, anchorRef, anchorKey\]\)/, 'the placement effect re-measures when the open row changes')
  // The history effect deliberately stays keyed on `open` alone: re-arming it
  // on every row change would push a second entry per row (Part 143767f4).
  assert.doesNotMatch(fold, /\}, \[open, anchorKey\]\)/, 'the history entry is not re-armed per row')
  for (const [label, source] of [['GroupedReport', grouped], ['PeriodReport', period], ['SalesListReport', salesList], ['ReturnsReport', returns], ['ExpensesReport', expenses], ['OverviewReport', overview]] as const) {
    assert.match(source, /anchorKey=\{/, `${label} passes the open row's identity to its fold`)
  }
})

check('NEGATIVE CONTROL: the clamp checker still fails the unclamped placement', () => {
  const defective = `
    function placeAnchored(rect, panelWidth) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8))
      return { position: 'fixed', left, top: rect.bottom + 8, maxHeight: Math.max(120, spaceBelow) }
    }
  `
  assert.deepEqual(clampsToViewport(defective), { top: false, bottom: false, height: false }, 'the checker must reject a placement that only clamps left')
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
  // MONOTONIC in window width. The hub is capped at 74rem and its gutter grows
  // with the window, so the sheet is widest around 1280-1440 and narrower
  // again at 1920 (measured, real hub + real CSS in headless Chrome: 660 /
  // 752 / 936 / 1066 / 1053 / 1014px at 700 / 800 / 1024 / 1280 / 1440 /
  // 1920). A 64rem (1024px) third tier therefore gave 3 columns at 1440 and
  // dropped back to 2 at 1920 -- a wider monitor showing less. 60rem sits
  // below the whole plateau, and every tier is the same 20rem per card.
  assert.match(surfaceCss, /@container \(min-width: 60rem\)/, 'the three-column tier is reachable across the whole desktop plateau')
  assert.doesNotMatch(stripComments(surfaceCss), /@container \(min-width: 64rem\)/, 'the non-monotonic 64rem tier is gone')
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
  // ...and the RECEIPT style has to agree with the excel style about where
  // that one bold sits, or the receipt sheet ends up with no emphasis at all.
  assert.match(table, /key: '__totals',\s*\n\s*summary: true,/, "the receipt style's totals block is the sheet's tfoot")
  assert.match(sheet, /block\.summary \? 'detail-scroll-text font-semibold' : 'detail-scroll-text font-medium'/, 'only a summary block takes the bold title')
  assert.match(sheet, /kind === 'total' && block\.summary \? 'pt-1 font-semibold' : LINE_CLASS\[kind \|\| 'add'\]/, 'only a summary block takes the bold total line')
  // The block flag is named summary, not emphasis: ReportColumn.emphasis in
  // the same folder means font-MEDIUM on a data column, and two flags one
  // word apart with opposite weights is how a later edit picks the wrong one.
  assert.doesNotMatch(stripComments(sheet), /\bemphasis\b/, 'the receipt block flag is not a second emphasis')
  // The Overview is the surface the owner called fine; its statement groups
  // are summaries, not record cards, so they keep the weight they had before
  // this lane instead of being flattened with the list views.
  assert.match(overview, /highlight: isTheoreticalGroup\(g\),[\s\S]{0,700}?summary: true,/, "the Overview statement's groups keep their weight")
  // ...and the SAME statement renders the same way wherever it appears. The
  // Sep 22 pass flattened the six row-detail folds while leaving the Overview
  // bold, so a customer's statement read differently from the Overview chip
  // that summarises it. A row detail is a statement, not one card in a list,
  // so every one of them carries the statement weight (Sep 23 ruling).
  for (const [label, source, count] of [['GroupedReport', grouped, 3], ['PeriodReport', period, 2], ['SalesListReport', salesList, 2], ['ReturnsReport', returns, 1], ['ExpensesReport', expenses, 1]] as const) {
    assert.equal((stripComments(source).match(/\bsummary: true,/g) || []).length, count, `${label}'s row-detail statement blocks all carry the statement weight`)
  }
  assert.doesNotMatch(surfaceCss, /@media screen\s*\{/, 'the screen-only +2px size bump is gone (owner: "the size is too big")')
  assert.match(surfaceCss, /--ui-size-body:\s*12px/, 'the compact document scale is the base')
  assert.doesNotMatch(surfaceCss, /calc\(16px \* var\(--ui-km-boost/, 'no 16px Latin body anywhere in the surface')
})

if (failures.length) {
  console.log(`\n${failures.length} test(s) failed`)
  process.exit(1)
}
console.log('PASS reports readability: names scroll, details are readable, floats close only on X/outside')
