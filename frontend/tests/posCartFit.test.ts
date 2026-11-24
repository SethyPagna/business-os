// The till's cart panel must always fit inside the panels row. POS.tsx used to render the stored width as both `width` and
// `minWidth`, so on an 800 px tablet (row 580) a stored 400 px cart ran from 516 to 916 and pushed End shift and the right edge of
// Complete Sale off screen. These tests pin the pure fit rule and the wiring that applies it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CART_FIT_DIVIDER_PX,
  CART_FIT_FLOOR_PX,
  CART_FIT_LG_BREAKPOINT_PX,
  CART_FIT_PRODUCTS_MIN_LG_PX,
  CART_FIT_PRODUCTS_MIN_MD_PX,
  cartProductsMinPx,
  fitCartWidth,
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
assert.match(posSource, /matchMedia\(`\(min-width: \$\{CART_FIT_LG_BREAKPOINT_PX\}px\)`\)\.matches/, 'POS reads the lg breakpoint from the named export')
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
assert.match(effect, /cartProductsMinPx\(/, 'measure takes the products minimum from the shared helper')
assert.doesNotMatch(posSource, /setCartWidthPx\(\(current\) => clampCartWidth\(current\)\)/, 'a window resize no longer overwrites the stored width state with a clamped one')

const groupPos = posSource.indexOf('<ShiftHistoryPanel branchId={primaryBranchFilterId}')
const groupStart = posSource.lastIndexOf('<div', groupPos)
assert.match(posSource.slice(groupStart, groupPos), /shrink-0/, 'shift group never shrinks')
const rowStart = posSource.lastIndexOf('<div className="flex-shrink-0 flex w-full min-w-0 items-center border-b', groupStart)
assert.ok(rowStart > 0, 'top row must be found')
assert.match(posSource.slice(rowStart, groupStart), /flex min-w-0 flex-1 items-center gap-1 px-2 py-1\.5 overflow-x-auto/, 'order tabs keep min-w-0 flex-1 and scroll so they give way first')

console.log('posCartFit tests passed')
