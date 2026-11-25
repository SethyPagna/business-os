// The till's cart panel must always fit inside the panels row. POS.tsx used to render the stored width as both `width` and
// `minWidth`, so on an 800 px tablet (row 580) a stored 400 px cart ran from 516 to 916 and pushed End shift and the right edge of
// Complete Sale off screen. These tests pin the pure fit rule and the wiring that applies it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from '../node_modules/esbuild/lib/main.js'
import {
  CART_DRAG_THRESHOLD_PX,
  CART_FIT_DIVIDER_PX,
  CART_FIT_FLOOR_PX,
  CART_FIT_LG_BREAKPOINT_PX,
  CART_FIT_PRODUCTS_MIN_LG_PX,
  CART_FIT_PRODUCTS_MIN_MD_PX,
  beginCartDrag,
  cartDragSavedWidth,
  cartProductsMinPx,
  dragCartWidth,
  moveCartDrag,
  fitCartWidth,
  measurePanelsRow,
  viewportProductsMinPx,
} from '../src/components/pos/posCartFit.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const posSource = fs.readFileSync(path.join(here, '../src/components/pos/POS.tsx'), 'utf8')

const D = CART_FIT_DIVIDER_PX
assert.equal(D, 8)
assert.equal(CART_FIT_PRODUCTS_MIN_MD_PX, 288)
assert.equal(CART_FIT_PRODUCTS_MIN_LG_PX, 352)
assert.equal(CART_FIT_LG_BREAKPOINT_PX, 1024)
assert.equal(CART_FIT_FLOOR_PX, 240)
assert.equal(cartProductsMinPx(false), 288)
assert.equal(cartProductsMinPx(true), 352)

const rows: Array<[number, number]> = [[548, 288], [580, 288], [700, 288], [853, 288], [916, 288], [1146, 352]]
const stored = [300, 400, 860]
const expected: Record<string, number> = {
  '548/300': 252, '548/400': 252, '548/860': 252,
  '580/300': 284, '580/400': 284, '580/860': 284,
  '700/300': 300, '700/400': 400, '700/860': 404,
  '853/300': 300, '853/400': 400, '853/860': 557,
  '916/300': 300, '916/400': 400, '916/860': 620,
  '1146/300': 300, '1146/400': 400, '1146/860': 786,
}
for (const [row, min] of rows) {
  for (const s of stored) {
    const got = fitCartWidth(row, s, min)
    assert.equal(got, expected[`${row}/${s}`], `row ${row} stored ${s}`)
    if (row - D - min >= CART_FIT_FLOOR_PX) assert.ok(got + D + min <= row, `row ${row} stored ${s} must leave the products column`)
  }
}
assert.equal(fitCartWidth(580, 400), 284, 'the default minimum is the md one')
assert.equal(fitCartWidth(400, 400), CART_FIT_FLOOR_PX, 'row too small even for the floor: cart holds the floor, the row may scroll')
assert.equal(fitCartWidth(0, 400), 400, 'unmeasured row keeps the stored width')
assert.equal(fitCartWidth(Number.NaN, 400), 400, 'non-finite row keeps the stored width')
assert.equal(fitCartWidth(700.9, 860, 288), 404, 'a fractional row rounds the cart DOWN, never past the row')
assert.equal(fitCartWidth(1000, 400), 400, 'wide screen keeps the stored pixels')

// The numbers above must be the products column's real CSS minimums and the divider's real width.
const productsClass = posSource.match(/md:min-w-\[(\d+)rem\] lg:min-w-\[(\d+)rem\]/)
assert.ok(productsClass, 'products column keeps its md/lg min-width classes')
assert.equal(Number(productsClass[1]) * 16, CART_FIT_PRODUCTS_MIN_MD_PX, 'md minimum matches the CSS')
assert.equal(Number(productsClass[2]) * 16, CART_FIT_PRODUCTS_MIN_LG_PX, 'lg minimum matches the CSS')
assert.match(posSource, /relative w-2 flex-shrink-0 cursor-col-resize/, 'divider is w-2 = 8 px')
assert.doesNotMatch(posSource, /matchMedia\(`/, 'POS builds no media query of its own: viewportProductsMinPx owns the lg query')
assert.doesNotMatch(posSource, /CART_FIT_LG_BREAKPOINT_PX/, 'POS names no breakpoint')
assert.doesNotMatch(posSource, /\? 352 : 288/, 'POS carries no private copy of the minimums')

const stylePos = posSource.indexOf('ref={cartPanelRef}')
assert.ok(stylePos > 0, 'cart panel must be found')
const cartTag = posSource.slice(stylePos, posSource.indexOf('>', posSource.indexOf('style={isDesktopViewport', stylePos)) + 1)
assert.match(cartTag, /width: `\$\{fittedCartWidthPx\}px`/, 'cart width renders the fitted width')
assert.match(cartTag, /minWidth: `\$\{fittedCartWidthPx\}px`/, 'cart minWidth renders the fitted width')
assert.doesNotMatch(cartTag, /cartWidthPx\}px/, 'cart style never renders the raw stored width')
assert.match(posSource, /fitCartWidth\(panelsRowFit\.rowPx, cartWidthPx, panelsRowFit\.productsMinPx\)/, 'render passes the measured products minimum')

const effectStart = posSource.indexOf('const row = mainPanelsRef.current')
const effectEnd = posSource.indexOf('observer.disconnect()', effectStart)
assert.ok(effectStart > 0 && effectEnd > effectStart, 'measuring effect must be found')
const effect = posSource.slice(effectStart, effectEnd)
assert.doesNotMatch(effect, /writePosStorage|localStorage|setItem/, 'measuring never writes storage')
assert.match(effect, /new ResizeObserver\(measure\)/, 'the row is watched with a ResizeObserver')
assert.match(effect, /observer\.observe\(row\)/, 'the row is actually observed')
assert.match(effect, /\r?\n\s*measure\(\)\r?\n/, 'the row is measured once on mount')
assert.match(effect, /const next = measurePanelsRow\(row, \(q\) => window\.matchMedia\(q\)\)/, 'the measure reads the row and the viewport through the one helper')
assert.doesNotMatch(effect, /innerWidth|cartProductsMinPx|getBoundingClientRect/, 'the measure carries no width or minimum of its own')
assert.doesNotMatch(posSource, /setCartWidthPx\(\(current\) => clampCartWidth\(current\)\)/, 'a window resize no longer overwrites the stored width state with a clamped one')

const groupPos = posSource.indexOf('<ShiftHistoryPanel branchId={primaryBranchFilterId}')
const groupStart = posSource.lastIndexOf('<div', groupPos)
const groupTag = posSource.slice(groupStart, groupPos)
const groupClasses = (groupTag.match(/className="([^"]*)"/)?.[1] ?? '').split(' ')
assert.ok(groupClasses.includes('contents'), 'the shift group is display: contents, so its buttons are siblings of the order tabs in the one wrapping row')
for (const gone of ['ml-auto', 'shrink-0', 'max-w-full', 'flex', 'flex-wrap', 'overflow-hidden']) {
  assert.ok(!groupClasses.includes(gone), `the shift group is not a box (${gone}): a box wraps its buttons into a third line`)
}
const rowStart = posSource.lastIndexOf('<div className="flex-shrink-0 flex flex-wrap justify-end gap-x-1 w-full min-w-0 items-center border-b', groupStart)
assert.ok(rowStart > 0, 'top row must be found: wrapping, right-aligned, with a 4 px column gap')
const tabsTag = posSource.slice(rowStart, groupStart)
assert.match(tabsTag, /flex min-w-\[7rem\] flex-1 items-center gap-1 px-2 py-1\.5 overflow-x-auto/, 'order tabs keep a 7rem floor, flex-1 and scroll: a shift button wraps to the next line when tabs plus buttons do not fit')
assert.doesNotMatch(tabsTag, /whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer[^]*truncate/, 'no label is hidden')

// Dragging uses the SAME fit as the render, so the divider follows the pointer and the saved width is the one shown.
assert.equal(dragCartWidth(1146, 700, 352, 300, 860), 700, 'a wide row follows the pointer')
assert.equal(dragCartWidth(1146, 900, 352, 300, 860), 786, 'held at row - divider - lg products minimum')
assert.equal(dragCartWidth(700, 900, 288, 300, 860), 404, 'md: held at row - divider - md products minimum')
assert.equal(dragCartWidth(700, 100, 288, 300, 860), 300, 'dragging left stops at the cart minimum')
assert.equal(dragCartWidth(580, 400, 288, 300, 860), null, 'row too narrow for 300: the divider does not move and nothing is saved')
assert.equal(dragCartWidth(596, 400, 288, 300, 860), 300, 'a row that holds exactly 300 + divider + minimum')
assert.equal(dragCartWidth(595, 400, 288, 300, 860), null, 'one pixel less and it does not')
assert.equal(dragCartWidth(0, 500, 288, 300, 860), 500, 'unmeasured row keeps the pointer width')
assert.equal(dragCartWidth(3000, 5000, 352, 300, 860), 860, 'a drag never passes the cart maximum')

const clampStart = posSource.indexOf('const clampCartWidth')
const clampBody = posSource.slice(clampStart, posSource.indexOf('const startCartResize', clampStart))
assert.match(clampBody, /dragCartWidth\(/, 'the drag clamp is the shared fit')
assert.match(clampBody, /const productsMinPx = viewportProductsMinPx\(\(q\) => window\.matchMedia\(q\)\)/, 'the drag clamp takes the products minimum from the same helper as the measure')
assert.match(clampBody, /dragCartWidth\(mainPanelsRef\.current\.getBoundingClientRect\(\)\.width, px, productsMinPx, CART_WIDTH_MIN_PX, CART_WIDTH_MAX_PX\)/, 'the clamp passes the shared products minimum and the cart limits')
assert.doesNotMatch(clampBody, /PRODUCTS_MIN_PX|- 280/, 'the drag clamp carries no private minimum')
const dragStart = posSource.indexOf('const startCartResize')
const drag = posSource.slice(dragStart, posSource.indexOf('const resetCartWidth', dragStart))
assert.match(drag, /if \(step\.apply !== null\) setCartWidthPx\(step\.apply\)/, 'only an applied step moves the divider: a refused or sub-threshold move does not')
assert.match(drag, /beginCartDrag\(clientX\)/, 'a press opens a drag session')
assert.match(drag, /moveCartDrag\(session, moveClientX, \(x\) => clampCartWidth\(containerRect\.right - x\)\)/, 'every move goes through the session helper and the drag clamp')
assert.match(drag, /const savedWidth = cartDragSavedWidth\(session\)\r?\n\s*if \(savedWidth === null\) return/, 'release saves nothing when no move was applied')
assert.match(drag, /String\(savedWidth\)/, 'release saves exactly the last width the drag showed')
assert.doesNotMatch(drag, /handleMove\(clientX\)/, 'pressing the divider applies nothing: only a move does')
assert.doesNotMatch(drag, /setCartWidthPx\(\(current\)/, 'release never saves whatever the width state happens to be')

// The session helper: a press that does not move is a click and changes and saves nothing; only a real drag applies and saves.
assert.equal(CART_DRAG_THRESHOLD_PX, 3)
const wide = (x: number) => 1000 - x
const s0 = beginCartDrag(500)
assert.equal(cartDragSavedWidth(s0), null, 'a press alone saves nothing')
let step = moveCartDrag(s0, 500, wide)
assert.equal(step.apply, null, 'a move of 0 px applies nothing')
assert.equal(cartDragSavedWidth(step.session), null, 'a click saves nothing')
step = moveCartDrag(s0, 502, wide)
assert.equal(step.apply, null, 'a 2 px wobble applies nothing')
assert.equal(cartDragSavedWidth(step.session), null, 'a 2 px wobble saves nothing')
step = moveCartDrag(s0, 498, wide)
assert.equal(step.apply, null, 'a 2 px wobble to the left applies nothing')
step = moveCartDrag(s0, 503, wide)
assert.equal(step.apply, 497, 'a 3 px move is a drag and applies the clamp width')
assert.equal(cartDragSavedWidth(step.session), 497, 'a drag saves the width it showed')
step = moveCartDrag(step.session, 400, wide)
assert.equal(step.apply, 600, 'the drag keeps following the pointer')
assert.equal(cartDragSavedWidth(step.session), 600, 'the saved width is the last shown width')
step = moveCartDrag(step.session, 500, wide)
assert.equal(step.apply, 500, 'once a drag, coming back to the press point still applies')
assert.equal(cartDragSavedWidth(step.session), 500)
const refused = moveCartDrag(step.session, 300, () => null)
assert.equal(refused.apply, null, 'a width the fit refuses is not applied')
assert.equal(cartDragSavedWidth(refused.session), 500, 'a refused move keeps the last shown width as the one to save')
const neverShown = moveCartDrag(beginCartDrag(500), 100, () => null)
assert.equal(neverShown.apply, null)
assert.equal(cartDragSavedWidth(neverShown.session), null, 'a drag the fit always refuses (768 wide) saves nothing')

// The real clampCartWidth and startCartResize from POS.tsx, run against a fake window: click and drag at 853 and 1366 wide.
const lf = posSource.replace(/\r\n/g, '\n')
const sStart = lf.indexOf('const startCartResize = useCallback(')
const sEnd = lf.indexOf('}, [clampCartWidth])', sStart) + '}, [clampCartWidth])'.length
assert.ok(sStart > 0 && sEnd > sStart, 'startCartResize must be found')
const cStart = lf.indexOf('const clampCartWidth = useCallback(')
const cEnd = lf.indexOf('}, [])', cStart) + '}, [])'.length
assert.ok(cStart > 0 && cEnd > cStart, 'clampCartWidth must be found')
const js = transformSync(lf.slice(cStart, cEnd) + '\n' + lf.slice(sStart, sEnd) + '\nreturn startCartResize', { loader: 'ts' }).code
const build = new Function(
  'useCallback', 'mainPanelsRef', 'window', 'document', 'dragCartWidth', 'cartProductsMinPx', 'CART_FIT_LG_BREAKPOINT_PX', 'CART_WIDTH_MIN_PX',
  'CART_WIDTH_MAX_PX', 'CART_WIDTH_STORAGE_KEY', 'setCartResizing', 'setCartWidthPx', 'writePosStorage', 'beginCartDrag', 'moveCartDrag',
  'cartDragSavedWidth', 'viewportProductsMinPx', js,
) as (...a: unknown[]) => (x: number) => void

function runDrag(viewport: number, rowWidth: number, pressX: number, moves: number[]) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const writes: string[] = []
  const shown: number[] = []
  const lgQuery = `(min-width: ${CART_FIT_LG_BREAKPOINT_PX}px)`
  const fakeWindow = {
    get innerWidth(): number { throw new Error('the drag must read the row and matchMedia, never window.innerWidth') },
    matchMedia: (q: string) => ({ matches: q === lgQuery && viewport >= CART_FIT_LG_BREAKPOINT_PX }),
    addEventListener: (n: string, f: (e: unknown) => void) => { listeners[n] = f },
    removeEventListener: (n: string) => { delete listeners[n] },
  }
  const fakeDocument = { body: { style: { userSelect: '', cursor: '' } } }
  const row = { getBoundingClientRect: () => ({ width: rowWidth, right: rowWidth }) }
  const start = build(
    (f: unknown) => f, { current: row }, fakeWindow, fakeDocument, dragCartWidth, cartProductsMinPx, CART_FIT_LG_BREAKPOINT_PX, 300, 860, 'k',
    () => {}, (v: unknown) => { if (typeof v === 'number') shown.push(v) }, (_a: string, _k: string, v: string) => { writes.push(v) },
    beginCartDrag, moveCartDrag, cartDragSavedWidth, viewportProductsMinPx,
  )
  start(pressX)
  for (const x of moves) listeners.mousemove({ clientX: x })
  listeners.mouseup({})
  return { writes, shown }
}
for (const rowWidth of [853, 1366]) {
  const press = rowWidth - 400
  assert.deepEqual(runDrag(rowWidth, rowWidth, press, []), { writes: [], shown: [] }, `${rowWidth}: a click on the divider changes and saves nothing`)
  assert.deepEqual(runDrag(rowWidth, rowWidth, press, [press - 2]), { writes: [], shown: [] }, `${rowWidth}: a 2 px wobble changes and saves nothing`)
  const dragged = runDrag(rowWidth, rowWidth, press, [press - 20, press - 50])
  assert.equal(dragged.writes.length, 1, `${rowWidth}: a real drag saves once`)
  assert.equal(dragged.writes[0], String(dragged.shown[dragged.shown.length - 1]), `${rowWidth}: the saved width is the shown width`)
  assert.equal(dragged.shown[dragged.shown.length - 1], 450)
}
assert.deepEqual(runDrag(768, 548, 148, [128, 100]), { writes: [], shown: [] }, '768 wide (row 548): the fit refuses every width, nothing moves, nothing saves')


// One helper chooses the products minimum from the viewport; the render measure and the drag clamp both call it.
const lgQ = `(min-width: ${CART_FIT_LG_BREAKPOINT_PX}px)`
const mm = (viewport: number) => (q: string) => ({ matches: q === lgQ && viewport >= CART_FIT_LG_BREAKPOINT_PX })
assert.equal(viewportProductsMinPx(mm(1023)), 288, 'below lg the products column needs 288')
assert.equal(viewportProductsMinPx(mm(1024)), 352, 'from lg it needs 352')
assert.equal(viewportProductsMinPx(mm(1366)), 352)
assert.equal(viewportProductsMinPx(mm(768)), 288)
const fakeRow = (width: number) => ({ getBoundingClientRect: () => ({ width }) })
assert.deepEqual(measurePanelsRow(fakeRow(1060), mm(1280)), { rowPx: 1060, productsMinPx: 352 }, 'at 1280 the row is 1060 and the minimum 352')
assert.deepEqual(measurePanelsRow(fakeRow(548), mm(768)), { rowPx: 548, productsMinPx: 288 })

// The real measure from POS.tsx, run against a fake window whose innerWidth is poisoned: it reads the row and matchMedia only.
const mStart = lf.indexOf('const measure = () => {')
const mEnd = lf.indexOf('\n    measure()', mStart)
assert.ok(mStart > 0 && mEnd > mStart, 'measure must be found')
const measureJs = transformSync(lf.slice(mStart, mEnd) + '\nreturn measure', { loader: 'ts' }).code
const buildMeasure = new Function('row', 'window', 'setPanelsRowFit', 'measurePanelsRow', measureJs) as (...a: unknown[]) => () => void
function runMeasure(viewport: number, rowWidth: number) {
  let current: { rowPx: number; productsMinPx: number } = { rowPx: 0, productsMinPx: 288 }
  const fakeWindow = {
    get innerWidth(): number { throw new Error('the measure must read the row and matchMedia, never window.innerWidth') },
    matchMedia: mm(viewport),
  }
  const setter = (f: (prev: typeof current) => typeof current) => { current = f(current) }
  buildMeasure(fakeRow(rowWidth), fakeWindow, setter, measurePanelsRow)()
  return current
}
assert.deepEqual(runMeasure(1280, 1060), { rowPx: 1060, productsMinPx: 352 }, 'POS measure at 1280, row 1060: the lg minimum')
assert.deepEqual(runMeasure(1023, 900), { rowPx: 900, productsMinPx: 288 }, 'POS measure at 1023: the md minimum')
assert.deepEqual(runMeasure(853, 853), { rowPx: 853, productsMinPx: 288 })
assert.equal(fitCartWidth(1060, 860, runMeasure(1280, 1060).productsMinPx), 700, 'the cart leaves the lg products column its 352 at 1280 with stored 860')

// And the drag clamp at lg uses the same minimum: at 1280 (row 1060) a wish of 860 is held to 700, not to the md 764.
const lgDrag = runDrag(1280, 1060, 200, [190, 100])
assert.equal(lgDrag.shown[lgDrag.shown.length - 1], 700, 'the drag clamp at lg holds the products column its 352')
assert.equal(lgDrag.writes[0], '700')

console.log('posCartFit tests passed')
