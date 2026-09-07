// N36 -- "the qty unit is being pushed to next row if selling price, wholesale
// price, cost price is fully there. 2 digits, if 3 even worse ... keep it
// visible compact one line" (owner, Sep 6 2026).
//
// There is no layout engine here, so the row is judged two ways, and BOTH have
// to hold or the file is red:
//
//   1. Shape. The Products mobile card's price strip must be a single named
//      container that declares nowrap, and no child on it may re-declare a
//      wrap-enabling class. A row that can wrap is the defect.
//   2. Arithmetic. A pure width model of the strip, run at the widths the
//      report is about (375 standalone, 375 in select mode, 360 Android), on
//      the worst case the owner described: three-digit USD prices in all three
//      slots plus a four-digit quantity and a unit chip. The model is fed the
//      OLD gap/size numbers as a negative control, so a model that stopped
//      discriminating fails here instead of blessing the row.
//
// Run: node tests/productRowPriceStrip.test.ts

import assert from 'node:assert/strict'
import fs from 'node:fs'

const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')

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

// The declaration block of a CSS rule, by exact selector.
function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  assert.ok(at > 0, `no CSS rule for selector: ${selector}`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

// The strip element in the mobile card: the div carrying the strip class, and
// everything up to its closing </div> at the same indent.
function stripMarkup(): string {
  const at = products.indexOf('<div className="price-strip mt-1">')
  assert.ok(at > 0, 'the Products mobile card must render its price row through one named .price-strip container')
  const end = products.indexOf('\n            </div>', at)
  assert.ok(end > at, 'could not find the end of the price strip element')
  return products.slice(at, end)
}

// ---------------------------------------------------------------------------
// 1. Shape
// ---------------------------------------------------------------------------

runTest('the price strip container declares nowrap and never wraps', () => {
  const strip = block('.price-strip')
  assert.match(strip, /flex-wrap:\s*nowrap/, '.price-strip must declare flex-wrap: nowrap')
  assert.match(strip, /display:\s*flex/, '.price-strip must be a flex row')
  assert.match(strip, /white-space:\s*nowrap/, '.price-strip must declare white-space: nowrap')
  // The residual overflow (a promotion label beside a long Khmer unit) has to
  // go somewhere that is neither a second row nor a clipped value.
  assert.match(strip, /overflow-x:\s*auto/, '.price-strip must scroll rather than wrap or clip when it truly cannot fit')
  assert.match(strip, /scrollbar-width:\s*none/, 'the strip\'s own scrollbar must stay invisible')
  assert.match(block('.price-strip::-webkit-scrollbar'), /display:\s*none/, 'webkit scrollbar must be hidden too')
})

runTest('the strip spends divider blanks and one step of digit size, not a second line', () => {
  const strip = block('.price-strip')
  // gap: the row used gap-x-1.5 (.375rem). Anything at or above that has not
  // paid for the fix.
  const gap = /gap:\s*0\s+([\d.]+)rem/.exec(strip)
  assert.ok(gap, '.price-strip must declare an explicit column gap')
  assert.ok(Number(gap[1]) < 0.375, `strip gap must be tighter than the old gap-x-1.5 (.375rem), got ${gap[1]}rem`)
  // font-size: the row used text-xs (.75rem).
  const size = /font-size:\s*([\d.]+)rem/.exec(strip)
  assert.ok(size, '.price-strip must own its font size')
  assert.ok(Number(size[1]) < 0.75 && Number(size[1]) >= 0.65, `strip digits must step down a small amount from .75rem, got ${size[1]}rem`)
  assert.match(strip, /font-variant-numeric:\s*tabular-nums/, 'prices must use tabular figures so the columns do not jitter')
  assert.match(strip, /letter-spacing:\s*-/, 'tracking must be tightened, not loosened')
  assert.match(block('.price-strip .price-strip-divider'), /margin:\s*0\s+-/, 'the blank either side of "|" is what gets spent first')
})

runTest('the row does not get taller in exchange for staying on one line', () => {
  // The compact row is the point of the ask -- buying the one-line strip back
  // with a taller row would just move the damage. text-xs carried a 1rem line
  // box; the strip must pin its own line-height at or below that, so the
  // step-down cannot be traded for vertical space, and the qty cell's
  // inline-flex chip cannot push the box open either.
  const strip = block('.price-strip')
  const lh = /line-height:\s*([\d.]+)rem/.exec(strip)
  assert.ok(lh, '.price-strip must pin its own line-height rather than inheriting one')
  assert.ok(Number(lh[1]) <= 1, `the strip's line box must not grow past the old 1rem, got ${lh[1]}rem`)
  // Khmer is the one case allowed a taller line box -- a coeng cluster needs
  // ~1.6em of ink and would otherwise be sheared -- and it is scoped to
  // body.lang-km so the Latin row keeps the compact height.
  assert.match(css, /body\.lang-km \.price-strip[\s\S]{0,80}line-height:\s*var\(--km-line-height/, 'km keeps its line-height floor, scoped to the km body class')
  // No vertical padding/margin is introduced on the strip itself; the row's
  // own mt-1 is the only spacing, and it is unchanged.
  assert.doesNotMatch(strip, /padding/, 'the strip must not add vertical padding to the row')
  assert.match(stripMarkup(), /className="price-strip mt-1"/, 'the strip keeps exactly the spacing the wrapping row had')
})

runTest('no value on the strip is hidden, clipped or dropped', () => {
  const strip = stripMarkup()
  for (const marker of ['fmtUSD(sellingUsd)', 'fmtUSD(wholesaleUsd)', 'fmtUSD(costUsd)', 'String(qty || 0)', 'renderUnitChip(unitName)']) {
    assert.ok(strip.includes(marker), `the strip must still render ${marker}`)
  }
  assert.equal((strip.match(/price-strip-divider/g) || []).length, 3, 'all three "|" dividers stay visible')
  assert.doesNotMatch(strip, /\btruncate\b/, 'no value on the strip may be ellipsised away')
  assert.doesNotMatch(strip, /\bhidden\b/, 'no value on the strip may be hidden at a breakpoint')
})

runTest('nothing inside the strip re-enables wrapping', () => {
  const strip = stripMarkup()
  assert.doesNotMatch(strip, /flex-wrap/, 'the strip element must not carry a Tailwind wrap class')
  assert.doesNotMatch(strip, /gap-y-/, 'a row gap only exists to space wrapped lines')
  assert.doesNotMatch(strip, /\bflex\b\s+flex-wrap/, 'the strip must not re-declare the old wrapping flex row')
  assert.match(block('.price-strip > *'), /flex:\s*0 0 auto/, 'strip children must not shrink their digits away')
})

runTest('the unit chip inside the strip is not left larger than the prices', () => {
  // renderUnitChip's uncoloured variant is text-xs; after the step-down that
  // would render bigger than the prices next to it.
  assert.match(products, /price-strip-qty/, 'the qty+unit cell must be addressable from CSS')
  const qty = block('.price-strip-qty > span')
  assert.match(qty, /font-size:\s*[\d.]+rem/, 'the unit chip must be pinned to the strip\'s scale')
})

// ---------------------------------------------------------------------------
// 1b. The DESKTOP qty cell is deliberately left wrapping
// ---------------------------------------------------------------------------
// The owner's sentence -- "the qty unit is being pushed to next row if selling
// price, wholesale price, cost price is fully there" -- also describes, word
// for word, what Products.tsx:3425 does on the desktop Products table: its
// qty+unit div carries `flex-wrap` and `gap-y-0.5`, and the comment above it
// says the unit chip is ALLOWED to drop to its own line. Silence about that
// cell would be indistinguishable from missing it, so the ruling is stated
// here and goes red if the premise it rests on ever moves.
//
// The ruling is: leave it. It is a DIFFERENT defect with the same symptom.
//   - The three prices are not in this cell. Cost is its own <td>
//     (Products.tsx:3385), selling+wholesale another (:3389), qty a third
//     (:3411), inside `<table className="w-full min-w-[58rem] table-fixed ...">`
//     (ProductsListSurface.tsx:314) with an explicit colgroup. Under
//     `table-fixed` a column's width comes from the colgroup, not from its
//     content, so a fully-populated price column CANNOT take width from the
//     qty column. The owner's causal clause ("if ... price is fully there")
//     is only true of the mobile strip, where all four values do share one
//     flex row -- and that is the row this lane compacted.
//   - The wrap here is the Aug 19 2026 fix for a different ask: a long or
//     Khmer unit name spilling PAST the cell's right edge. Removing
//     `flex-wrap` would restore that overflow. Removing it and compacting
//     instead would be a fix for a problem this column does not have.
//
// So the pin is on the premise, not on the pixels: if someone drops
// `table-fixed`/`min-w-[58rem]`, or converts this cell without thinking, the
// reasoning above stops holding and this file says so.

runTest('the desktop qty cell keeps its deliberate wrap, and the premise for that still holds', () => {
  const qtyCell = /className=\{`flex flex-wrap items-center justify-end gap-x-1 gap-y-0\.5 font-bold \$\{stockStatusTextClass\}`\}/
  assert.match(products, qtyCell, 'the desktop qty+unit cell must keep flex-wrap and gap-y-0.5 (Aug 19 2026: a long/Khmer unit name must drop, not spill past the cell edge)')
  const surface = fs.readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
  assert.match(surface, /<table className="w-full min-w-\[58rem\] table-fixed /, 'the desktop table must stay table-fixed at min-w-[58rem] -- that is the whole reason the price columns cannot squeeze the qty column')
  // Positive control on the "different cell" half: the prices really are in
  // other <td>s, so the qty cell's wrap cannot be the owner's price-driven one.
  for (const priceCell of ['<div className="font-medium text-red-700 dark:text-red-400">{fmtUSD(costUsd)}</div>', '<div className="font-semibold text-green-700 dark:text-green-400">{fmtUSD(sellingUsd)}</div>']) {
    assert.ok(products.includes(priceCell), `the desktop prices must stay in their own column: ${priceCell}`)
  }
  // And the MOBILE strip -- the row where the four values really do share one
  // flex line -- must not have been "fixed" by copying this wrap back onto it.
  assert.doesNotMatch(stripMarkup(), /flex-wrap/, 'the desktop ruling must not leak onto the mobile strip')
})

// ---------------------------------------------------------------------------
// 2. Arithmetic
// ---------------------------------------------------------------------------
// Advance widths at 1rem for the app's sans stack, rounded conservatively
// (measured against Inter/system-ui digits: digits and "$" ~0.556em, "." and
// "|" ~0.28em). The model is intentionally generous to the row -- if it says
// the row overflows, it overflows.

const EM_DIGIT = 0.556
const EM_THIN = 0.28

function textWidth(text: string, rem: number, trackingEm: number, boldFactor = 1): number {
  let em = 0
  for (const ch of text) em += /[.,|]/.test(ch) ? EM_THIN : EM_DIGIT
  em += trackingEm * text.length
  return em * rem * 16 * boldFactor
}

type StripModel = {
  gapRem: number
  fontRem: number
  trackingEm: number
  unitChipRem: number
  // Negative inline margin on the "|" itself, which eats into the gap on BOTH
  // of its sides -- this is the "reduce space between digit and the dividing
  // |" half of the ask, and it is real width, so the model counts it.
  dividerMarginRem: number
}

// Worst case the owner named: three-digit USD in every slot, four-digit qty.
//
// The lane's acceptance words that worst case as "three-digit USD prices AND a
// 4-digit KHR figure present". The strip renders NO KHR figure at all:
//   git grep -n "fmtKHR(" -- frontend/src/components/products/Products.tsx
// returns exactly three sites -- 3387 (cost), 3391 (selling) and 3397
// (wholesale) -- and all three are DESKTOP <td>s, each printing its riel value
// on its own line under the USD one; none of them is inside the mobile strip
// at 3634-3678. So the four-digit token modelled below is textWidth('1234')
// standing in for String(qty || 0), the QUANTITY -- the widest four-digit run
// the strip can actually contain. The substitution is deliberate; the check
// under "the model still covers the worst case the acceptance named" is what
// keeps it honest, because the day a KHR figure IS added to the strip the
// model silently stops covering that worst case.
function stripWidth(m: StripModel): number {
  const price = '$123.45'
  const selling = textWidth(price, m.fontRem, m.trackingEm, 1.03) // font-semibold
  const wholesale = textWidth(price, m.fontRem, m.trackingEm, 1.01)
  const cost = textWidth(price, m.fontRem, m.trackingEm)
  const qty = textWidth('1234', m.fontRem, m.trackingEm, 1.01)
  const dividers = 3 * textWidth('|', m.fontRem, m.trackingEm)
  // Coloured unit chip: ml-1 (4px) + px-2 (16px) + a 3-character label.
  const unit = 4 + 16 + textWidth('pcs', m.unitChipRem, 0, 1.03)
  const gaps = 6 * m.gapRem * 16
  const dividerPull = 6 * m.dividerMarginRem * 16 // 3 dividers, both sides
  return selling + wholesale + cost + qty + dividers + unit + gaps - dividerPull
}

// Text column available to the strip. Page px-3 + card px-3 + (for a
// standalone card) the w-16 thumbnail and its gap-3.
function textColumn(viewport: number, opts: { selectMode?: boolean } = {}): number {
  return viewport - 24 - 24 - 64 - 12 - (opts.selectMode ? 28 : 0)
}

const OLD: StripModel = { gapRem: 0.375, fontRem: 0.75, trackingEm: 0, unitChipRem: 0.625, dividerMarginRem: 0 }

function currentModel(): StripModel {
  const strip = block('.price-strip')
  const gap = /gap:\s*0\s+([\d.]+)rem/.exec(strip)
  const font = /font-size:\s*([\d.]+)rem/.exec(strip)
  const track = /letter-spacing:\s*(-?[\d.]+)em/.exec(strip)
  const chip = /font-size:\s*([\d.]+)rem/.exec(block('.price-strip-qty > span'))
  const pull = /margin:\s*0\s+-([\d.]+)rem/.exec(block('.price-strip .price-strip-divider'))
  assert.ok(gap && font && track && chip && pull, 'the strip must declare gap, font-size, letter-spacing, a chip size and a divider pull')
  return {
    gapRem: Number(gap[1]),
    fontRem: Number(font[1]),
    trackingEm: Number(track[1]),
    unitChipRem: Number(chip[1]),
    dividerMarginRem: Number(pull[1]),
  }
}

runTest('NEGATIVE CONTROL: the old gap/size numbers do overflow the cases in the report', () => {
  // If this ever passes, the width model has stopped discriminating and every
  // assertion below is worthless.
  assert.ok(stripWidth(OLD) > textColumn(375, { selectMode: true }), 'model must reproduce the reported overflow at 375 in select mode')
  assert.ok(stripWidth(OLD) > textColumn(360), 'model must reproduce the reported overflow on a 360px Android')
})

runTest('the shipped strip fits on one line in every case in the report', () => {
  const m = currentModel()
  const w = stripWidth(m)
  for (const [label, avail] of [
    ['375 standalone card', textColumn(375)],
    ['375 in select mode', textColumn(375, { selectMode: true })],
    ['360 Android', textColumn(360)],
    ['360 Android in select mode', textColumn(360, { selectMode: true })],
  ] as Array<[string, number]>) {
    assert.ok(w <= avail, `${label}: strip needs ${w.toFixed(1)}px but only ${avail}px is available`)
  }
})

runTest('the comment beside the class quotes the model, not a hand-computed guess', () => {
  // The first pass hand-added the levers in the CSS comment, forgot the
  // divider pull entirely and under-counted the font step, and shipped
  // "241px -> ~211px" beside a model that computes 242.1 -> 203.7. Prose that
  // disagrees with the executable model next to it is worse than no prose --
  // the lane report then repeated the wrong pair as a fact, including a
  // "3px over" degradation this file's own 360+select case proves does not
  // happen. So the two figures are machine-readable and answerable to the
  // model, and any drift between them is red.
  const quoted = /OLD ([\d.]+)px,\s*\n?\s*NEW ([\d.]+)px/.exec(css)
  assert.ok(quoted, 'the .price-strip comment must quote its model as "OLD <n>px, NEW <n>px"')
  for (const [label, claimed, actual] of [
    ['OLD', Number(quoted[1]), stripWidth(OLD)],
    ['NEW', Number(quoted[2]), stripWidth(currentModel())],
  ] as Array<[string, number, number]>) {
    assert.ok(
      Math.abs(claimed - actual) <= 0.1,
      `the comment claims ${label} = ${claimed}px but the model computes ${actual.toFixed(1)}px`,
    )
  }
})

runTest('the model still covers the worst case the acceptance named', () => {
  // See the comment block above stripWidth(). The acceptance says "a 4-digit
  // KHR figure present"; the strip has no KHR figure, so the model's four
  // digits are the quantity instead. That substitution is only sound while it
  // stays true that the strip carries no riel value -- a KHR figure added here
  // would be a FOURTH money token the model does not price, and every fit
  // assertion above would quietly stop meaning what it says.
  const strip = stripMarkup()
  assert.doesNotMatch(strip, /fmtKHR/, 'the strip must carry no KHR figure, or the width model no longer covers the acceptance worst case')
  // Positive control: the three riel sites the grep names really are in this
  // file, so the assertion above is a real distinction and not a dead regex.
  assert.equal((products.match(/fmtKHR\(/g) || []).length, 3, 'Products.tsx must still hold exactly the three desktop <td> riel sites')
  // And the four digits actually modelled are the quantity.
  assert.ok(strip.includes('String(qty || 0)'), 'the four-digit token in the model stands in for the strip quantity')
})

runTest('the fix is a real saving, not a rounding artefact', () => {
  const saved = stripWidth(OLD) - stripWidth(currentModel())
  assert.ok(saved >= 25, `expected the compaction to buy back real width, got ${saved.toFixed(1)}px`)
})

if (failures) {
  console.error(`${failures} failing check(s)`)
  process.exit(1)
}
console.log('PASS productRowPriceStrip')
