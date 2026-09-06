import assert from 'node:assert/strict'
import fs from 'node:fs'

// N4 -- action rows that pushed their own buttons out of bounds at 320/375.
//
// There is no layout engine here, so the rows are judged by a small pure model
// of the two things that actually decide whether a flex row can overflow:
//
//   1. shrink declarations. A non-wrapping, non-scrolling flex row is bounded
//      only if EVERY child either declares itself shrinkable (min-w-0 /
//      truncate / basis-) or declares itself fixed (shrink-0), and at least one
//      child is shrinkable -- something has to absorb the deficit. A row where
//      no child can shrink cannot fit anything narrower than its content.
//   2. cell arithmetic. Wrapping is not enough on its own: three icon+label
//      buttons sharing a 320px row leave ~47px per label, which truncates the
//      label to nothing. The model computes the label width each button gets
//      and requires it to stay legible.
//
// Every judge is run against the OLD class strings as negative controls, so a
// judge that stopped discriminating would fail the file rather than bless it.

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

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

// --- scraping -------------------------------------------------------------
// The class attribute of the element that OWNS a marker: the nearest
// className="..." before it. Markers are chosen so the nearest one is the
// element under test (an icon or a label inside the button, the first child
// inside the row).
function classNear(source: string, marker: string): string {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `marker not found in source: ${marker}`)
  const open = source.lastIndexOf('className="', at)
  assert.ok(open > 0, `no className before marker: ${marker}`)
  const start = open + 'className="'.length
  const end = source.indexOf('"', start)
  return source.slice(start, end)
}

// The row that CONTAINS a marker: the nearest enclosing <div className="...">.
function rowClassAround(source: string, marker: string): string {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `marker not found in source: ${marker}`)
  const open = source.lastIndexOf('<div className="', at)
  assert.ok(open > 0, `no enclosing div before marker: ${marker}`)
  const start = open + '<div className="'.length
  const end = source.indexOf('"', start)
  return source.slice(start, end)
}

// --- the pure judges ------------------------------------------------------
const SPACING: Record<string, number> = { '0': 0, '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12, '4': 16, '5': 20, '6': 24 }

function scale(classes: string, prefixes: string[]): number {
  for (const token of classes.split(/\s+/)) {
    for (const prefix of prefixes) {
      if (token.startsWith(prefix)) {
        const value = SPACING[token.slice(prefix.length)]
        if (value !== undefined) return value
      }
    }
  }
  return 0
}

type Declaration = 'shrinkable' | 'fixed' | 'rigid'

export function declaration(classes: string): Declaration {
  const tokens = classes.split(/\s+/)
  if (tokens.includes('shrink-0') || tokens.includes('flex-shrink-0')) return 'fixed'
  if (tokens.includes('min-w-0') || tokens.includes('truncate') || tokens.some((token) => token.startsWith('basis-'))) return 'shrinkable'
  return 'rigid'
}

// A row is bounded when it wraps, when it scrolls on purpose, or when every
// child has said how it behaves under pressure and one of them can give way.
export function rowIsBounded(rowClasses: string, childClasses: readonly string[]): boolean {
  const tokens = rowClasses.split(/\s+/)
  if (tokens.includes('flex-wrap')) return true
  if (tokens.includes('overflow-x-auto')) return true
  const declarations = childClasses.map(declaration)
  if (declarations.some((value) => value === 'rigid')) return false
  return declarations.some((value) => value === 'shrinkable')
}

// Width left for the LABEL of an icon+label button, in px, at a given viewport.
// perRow comes from the row itself: a wrapping row whose children claim a
// half-width basis puts two per row, otherwise every button shares one row.
export function labelWidth(viewport: number, rowClasses: string, childClasses: string, count: number): number {
  const rowTokens = rowClasses.split(/\s+/)
  const wraps = rowTokens.includes('flex-wrap')
  const half = childClasses.includes('basis-[calc(50%')
  const perRow = wraps && half ? 2 : count
  const rowPad = scale(rowClasses, ['p-', 'px-']) * 2
  const gap = scale(rowClasses, ['gap-'])
  const cell = (viewport - rowPad - gap * (perRow - 1)) / perRow
  const buttonPad = scale(childClasses, ['px-', 'p-']) * 2
  const iconGap = scale(childClasses, ['gap-'])
  const ICON = 16
  return cell - buttonPad - iconGap - ICON
}

// A two-word English action label at 12px is ~70px wide, and its Khmer
// counterpart is wider; below this the label truncates to an ellipsis and the
// button becomes an unlabelled icon that never declared itself icon-only.
const MIN_LABEL = 72

// The order-tab strip is a deliberate scroller. The question is what is
// allowed to ride inside it: tabs, yes -- the shift controls, no, because a
// scroller carries them off-screen instead of keeping them reachable.
export function shiftControlsOutsideScroller(source: string): boolean {
  const scroller = source.indexOf('overflow-x-auto scroll-x')
  if (scroller < 0) return false
  const close = source.indexOf('\n          </div>', scroller)
  const shift = source.indexOf('<ShiftHistoryPanel', scroller)
  if (close < 0 || shift < 0) return false
  return shift > close
}

// --- fixtures: the shipped rows as they were BEFORE this lane -------------
const OLD_IMPORT_HUB_ROW = 'flex items-center justify-between gap-2 pt-1'
const OLD_IMPORT_HUB_CHILDREN = [
  'text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline',
  'flex items-center gap-2',
]
const OLD_DATED_ROW = 'mt-6 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800'
const OLD_DATED_CHILDREN = [
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
  'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40',
]
const OLD_DETAIL_ROW = 'flex items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700'
const OLD_DETAIL_BUTTON = 'btn-secondary flex min-w-0 flex-1 items-center justify-center gap-1.5 truncate px-3 py-2 text-xs sm:text-sm'
const OLD_POS_STRIP = `          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto bg-gray-50 dark:bg-gray-900 scroll-x">
            {orders.map(order => (
              <div className="... flex-shrink-0 ...">
            ))}
            <div className="ml-auto flex flex-shrink-0 items-center gap-1 pl-2">
              <ShiftHistoryPanel branchId={primaryBranchFilterId} compact label={t('shift_code')} />
            </div>
          </div>
`

// --- the judges must discriminate ----------------------------------------
runTest('the shrink judge fails the rows as they shipped and passes a well-formed one', () => {
  assert.equal(rowIsBounded(OLD_IMPORT_HUB_ROW, OLD_IMPORT_HUB_CHILDREN), false, 'a sentence facing a button group, neither able to shrink, cannot fit 320')
  assert.equal(rowIsBounded(OLD_DATED_ROW, OLD_DATED_CHILDREN), false, 'Back facing "Apply Decisions & Preview" with no shrink anywhere cannot fit 320')
  // Positive control: the judge is not simply returning false. A row that
  // wraps, and a row with one shrinkable child beside fixed ones, are bounded.
  assert.equal(rowIsBounded('flex flex-wrap items-center gap-2', ['text-xs', 'flex items-center']), true)
  assert.equal(rowIsBounded('flex items-center gap-2', ['min-w-0 flex-1 truncate', 'shrink-0']), true)
  // ...and one rigid child is enough to fail it, whatever the others say.
  assert.equal(rowIsBounded('flex items-center gap-2', ['min-w-0 flex-1', 'px-3 py-2 text-xs']), false)
})

runTest('the label-width judge fails three-across at 320 and passes the wrapped pair', () => {
  const oldWidth = labelWidth(320, OLD_DETAIL_ROW, OLD_DETAIL_BUTTON, 3)
  assert.ok(oldWidth < MIN_LABEL, `three buttons across a 320px row leave ${oldWidth.toFixed(1)}px of label`)
  const newRow = 'flex flex-wrap items-center gap-2 border-t border-gray-200 p-3 dark:border-gray-700'
  const newButton = 'btn-secondary flex min-h-11 min-w-0 flex-1 basis-[calc(50%_-_0.25rem)] items-center justify-center gap-1.5 truncate px-3 py-2 text-xs sm:min-h-0 sm:basis-0 sm:text-sm'
  const width = labelWidth(320, newRow, newButton, 3)
  assert.ok(width >= MIN_LABEL, `wrapping to two per row leaves ${width.toFixed(1)}px of label`)
})

runTest('the scroller judge fails the strip as it shipped', () => {
  assert.equal(shiftControlsOutsideScroller(OLD_POS_STRIP), false, 'the shift controls used to ride inside the scrolling tab strip')
})

// --- the shipped source, judged ------------------------------------------
runTest('ImportHub footer keeps its buttons inside the dialog at 320', () => {
  const source = read('components/products/import/ImportHub.tsx')
  const row = rowClassAround(source, "import_hub_classic")
  const classic = classNear(source, "import_hub_classic")
  const actions = classNear(source, '{done && queuedCount > 0 ? (')
  assert.ok(rowIsBounded(row, [classic, actions]), `unbounded row: ${row}`)
  assert.equal(declaration(classic), 'shrinkable', 'the explanatory sentence is what gives way, not the buttons')
})

runTest('DatedStockReconciliationModal footer keeps Back and the step action inside the dialog', () => {
  const source = read('components/products/import/DatedStockReconciliationModal.tsx')
  const row = rowClassAround(source, '<ArrowLeft className=')
  const children = [
    classNear(source, '<ArrowLeft className='),
    classNear(source, "T('continue', 'Continue')"),
    classNear(source, 'dated_count_build_preview'),
    classNear(source, 'dated_count_confirm_import'),
    classNear(source, "T('done', 'Done')"),
  ]
  assert.ok(rowIsBounded(row, children), `unbounded row: ${row}`)
  for (const child of children) {
    assert.notEqual(declaration(child), 'rigid', `step button cannot shrink: ${child}`)
  }
})

runTest('ProductDetailModal actions keep a legible label and a 44px target at 320', () => {
  const source = read('components/products/surfaces/ProductDetailModal.tsx')
  const row = rowClassAround(source, '<PlusCircle className=')
  const buttons = [
    classNear(source, '<PlusCircle className='),
    classNear(source, '<SlidersHorizontal className='),
    classNear(source, '<Pencil className='),
  ]
  assert.ok(rowIsBounded(row, buttons), `unbounded row: ${row}`)
  for (const button of buttons) {
    const width = labelWidth(320, row, button, buttons.length)
    assert.ok(width >= MIN_LABEL, `only ${width.toFixed(1)}px of label survives: ${button}`)
    // Touch target: min-h-11 is 44px, and it is released only from sm up,
    // where the row is no longer a phone row.
    assert.match(button, /\bmin-h-11\b/, `no 44px tap target: ${button}`)
  }
  // The fix is wrapping, not hiding: no label is dropped below sm.
  assert.doesNotMatch(row, /hidden/, 'the row must not hide an action to fit')
  for (const button of buttons) assert.doesNotMatch(button, /\bhidden\b/, 'no action is hidden to fit')
})

runTest('POS shift controls sit beside the order-tab scroller, not inside it', () => {
  const source = read('components/pos/POS.tsx')
  assert.ok(shiftControlsOutsideScroller(source), 'Shift history / End shift still ride inside the scrolling tab strip')
  // The scroller and the shift cell share one non-scrolling row, so the
  // controls stay pinned at the right edge instead of being carried away.
  // classNear walks BACKWARDS from the scroller's own tag, so it lands on the
  // enclosing row rather than on the scroller itself.
  const outer = classNear(source, '<div className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 overflow-x-auto scroll-x">')
  assert.doesNotMatch(outer, /overflow-x-auto/, 'the outer row must not scroll')
  assert.ok(
    rowIsBounded(outer, ['flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 overflow-x-auto scroll-x', 'flex shrink-0 items-center gap-1 px-2 py-1.5 pl-0']),
    `unbounded outer row: ${outer}`,
  )
})

if (failures > 0) {
  console.error(`compactActionRows: ${failures} failing case(s)`)
  process.exit(1)
}
console.log('PASS compact action rows stay inside their container at 320')
