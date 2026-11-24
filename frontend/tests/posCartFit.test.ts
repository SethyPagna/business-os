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
  CART_FIT_PRODUCTS_MIN_PX,
  fitCartWidth,
} from '../src/components/pos/posCartFit.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const posSource = fs.readFileSync(path.join(here, '../src/components/pos/POS.tsx'), 'utf8')

const D = CART_FIT_DIVIDER_PX
const P = CART_FIT_PRODUCTS_MIN_PX
assert.equal(D, 8)
assert.equal(P, 280)
assert.equal(CART_FIT_FLOOR_PX, 240)

const rows = [548, 580, 700, 853, 916, 1146]
const stored = [300, 400, 860]
const expected: Record<string, number> = {
  '548/300': 260, '548/400': 260, '548/860': 260,
  '580/300': 292, '580/400': 292, '580/860': 292,
  '700/300': 300, '700/400': 400, '700/860': 412,
  '853/300': 300, '853/400': 400, '853/860': 565,
  '916/300': 300, '916/400': 400, '916/860': 628,
  '1146/300': 300, '1146/400': 400, '1146/860': 858,
}
for (const row of rows) {
  for (const s of stored) {
    const got = fitCartWidth(row, s)
    assert.equal(got, expected[`${row}/${s}`], `row ${row} stored ${s}`)
    if (row - D - P >= CART_FIT_FLOOR_PX) assert.ok(got + D + P <= row, `row ${row} stored ${s} must leave the products column`)
  }
}

assert.equal(fitCartWidth(400, 400), CART_FIT_FLOOR_PX, 'row too small even for the floor: cart holds the floor, the row may scroll')
assert.equal(fitCartWidth(0, 400), 400, 'unmeasured row keeps the stored width')
assert.equal(fitCartWidth(Number.NaN, 400), 400, 'non-finite row keeps the stored width')
assert.equal(fitCartWidth(900, 400, 352), 400, 'a larger products minimum still fits 400 in 900')
assert.equal(fitCartWidth(700, 400, 352), 340, 'a larger products minimum shrinks the cart: 700 - 8 - 352')
assert.equal(fitCartWidth(1000, 400), 400, 'wide screen keeps the stored pixels')

const stylePos = posSource.indexOf('ref={cartPanelRef}')
assert.ok(stylePos > 0, 'cart panel must be found')
const cartTag = posSource.slice(stylePos, posSource.indexOf('>', posSource.indexOf('style={isDesktopViewport', stylePos)) + 1)
assert.match(cartTag, /width: `\$\{fittedCartWidthPx\}px`/, 'cart width renders the fitted width')
assert.match(cartTag, /minWidth: `\$\{fittedCartWidthPx\}px`/, 'cart minWidth renders the fitted width')
assert.doesNotMatch(cartTag, /cartWidthPx\}px/, 'cart style never renders the raw stored width')
assert.match(posSource, /fitCartWidth\(/, 'POS uses fitCartWidth')
assert.match(posSource, /new ResizeObserver\(/, 'POS measures the panels row with a ResizeObserver')

const resizeEffect = posSource.slice(posSource.indexOf('new ResizeObserver('), posSource.indexOf('new ResizeObserver(') + 700)
assert.doesNotMatch(resizeEffect, /writePosStorage/, 'fitting never writes the stored width back')
assert.doesNotMatch(posSource, /setCartWidthPx\(\(current\) => clampCartWidth\(current\)\)/, 'a window resize no longer overwrites the stored width state with a clamped one')

const groupPos = posSource.indexOf('<ShiftHistoryPanel branchId={primaryBranchFilterId}')
const groupStart = posSource.lastIndexOf('<div', groupPos)
assert.match(posSource.slice(groupStart, groupPos), /shrink-0/, 'shift group never shrinks')
const rowStart = posSource.lastIndexOf('<div className="flex-shrink-0 flex w-full min-w-0 items-center border-b', groupStart)
assert.match(posSource.slice(rowStart, groupStart), /flex min-w-0 flex-1 items-center gap-1 px-2 py-1\.5 overflow-x-auto/, 'order tabs keep min-w-0 flex-1 and scroll so they give way first')
assert.match(posSource.slice(rowStart, rowStart + 200), /flex w-full min-w-0 items-center/, 'top row is bounded by the cart width with min-w-0')

console.log('posCartFit tests passed')
