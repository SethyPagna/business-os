// The contacts invoice ledgers must pin their filter + date row.
//
// User, Aug 31 2026: "the search bar row and the date both can be pinned and
// stick ... for all sections and pages". Products/Inventory/Sales/Returns/
// Branches and the Customers/Suppliers/Delivery directories all obey it; the
// three invoice sections mounted INSIDE those same tabs did not -- each drew
// its branch/supplier/status filters and its DateTimeRangePicker in a plain
// `flex flex-nowrap ... overflow-x-auto` row that scrolled away with the rows
// it filters, so re-ranging a long ledger meant scrolling back to the top.
//
// The sections are enumerated, never named: any contacts `*Section.tsx` that
// renders a DateTimeRangePicker is a ledger surface and is held to the rule,
// so a fourth one added tomorrow is caught the day it lands.
//
// Two things are asserted, because the cheap version of this fix does not
// work. `sticky` on the row itself is inert: a box that scrolls horizontally
// (`overflow-x-auto`) is its own scroll container, and a sticky element
// sticks relative to its nearest scrolling ancestor, so it would never pin to
// the page. The wrapper therefore has to be a separate element that CONTAINS
// the scrolling row, which is what the containment check below proves by
// walking the div depth rather than grepping for the word "sticky".
//
// Run: node tests/contactsInvoiceStickyRows.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const contactsDir = path.join(here, '..', 'src', 'components', 'contacts')

function read(file: string): string {
  return fs.readFileSync(path.join(contactsDir, file), 'utf8').replace(/\r\n/g, '\n')
}

/**
 * The index just past the `<div ...>` whose className matches `predicate`, and
 * the index of its matching `</div>`, found by walking div depth. Returns null
 * when no such div exists.
 */
function divSpan(source: string, predicate: (classes: string) => boolean): { start: number; end: number } | null {
  for (const open of source.matchAll(/<div className="([^"]*)"[^>]*>/g)) {
    if (!predicate(open[1])) continue
    const start = open.index! + open[0].length
    let depth = 1
    const tag = /<div\b|<\/div>/g
    tag.lastIndex = start
    for (let m = tag.exec(source); m; m = tag.exec(source)) {
      depth += m[0] === '</div>' ? -1 : 1
      if (depth === 0) return { start, end: m.index }
    }
    return null
  }
  return null
}

/**
 * Where this file draws its Start→End control. `StatsRangeRow` is the shared
 * wrapper (picker + preset chips) the ledgers switched to in P3-10; a surface
 * that still draws the bare `DateTimeRangePicker` is held to the same rule.
 */
function rangeControlIndex(source: string): number {
  const stats = source.indexOf('<StatsRangeRow')
  return stats >= 0 ? stats : source.indexOf('<DateTimeRangePicker')
}

function hasRangeControl(source: string): boolean {
  return rangeControlIndex(source) >= 0
}

/** Does this file pin its date row inside a sticky wrapper that contains it? */
function pinsItsDateRow(source: string): boolean {
  const span = divSpan(source, (classes) => /\bsticky\b/.test(classes) && /\btop-\d/.test(classes))
  if (!span) return false
  const picker = rangeControlIndex(source)
  return picker > span.start && picker < span.end
}

const sections = fs
  .readdirSync(contactsDir)
  .filter((file) => file.endsWith('Section.tsx'))
  .filter((file) => hasRangeControl(read(file)))
  .sort()

assert.deepEqual(
  sections,
  ['ApInvoicesSection.tsx', 'ArInvoicesSection.tsx', 'StockInInvoicesSection.tsx'],
  'the sweep must find the ledger sections it is meant to hold to the rule',
)

for (const file of sections) {
  const source = read(file)
  assert.ok(
    pinsItsDateRow(source),
    `${file}: the filter + date row must sit inside a sticky top-N wrapper, so it pins while the ledger scrolls`,
  )

  // P3-10. Pinned is not the same as visible. The range control used to be the
  // third or fourth item INSIDE the `flex flex-nowrap ... overflow-x-auto`
  // select row, which on a phone put it past the right edge of a row nobody
  // scrolls -- the owner's "invoice doesn't have start and end date ... i
  // don't see it in small screens". It now leads the sticky block on its own
  // full-width line, with the selects row underneath, exactly like Sales.
  const sticky = divSpan(source, (classes) => /\bsticky\b/.test(classes) && /\btop-\d/.test(classes))!
  const range = rangeControlIndex(source)
  const scrollingRow = divSpan(source, (classes) => /\bflex-nowrap\b/.test(classes) && /\boverflow-x-auto\b/.test(classes))
  assert.ok(scrollingRow, `${file}: the branch/supplier/status selects still live in one scrollable row`)
  assert.ok(
    range < scrollingRow!.start,
    `${file}: the Start→End range must come BEFORE the horizontally scrolling selects row, not inside it`,
  )
  // "First child" is proven by what sits between the sticky wrapper's opening
  // tag and the range control: JSX comments and whitespace only, never another
  // element. Grepping for order alone would pass a layout that quietly grew a
  // row above the range.
  assert.equal(
    source.slice(sticky.start, range).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim(),
    '',
    `${file}: the Start→End range must be the FIRST child of the sticky wrapper -- only comments may precede it`,
  )
  assert.ok(
    source.includes('<StatsRangeRow'),
    `${file}: use the shared StatsRangeRow so the preset chips (All time / Today / ...) come with the range`,
  )
  for (const open of source.matchAll(/<div className="([^"]*)"/g)) {
    assert.ok(
      !(/\bsticky\b/.test(open[1]) && /\boverflow-x-auto\b/.test(open[1])),
      `${file}: "${open[1]}" makes the horizontally scrolling row itself sticky, which never pins -- wrap it instead`,
    )
  }
  const stickyClasses = /<div className="([^"]*sticky[^"]*)"/.exec(source)![1]
  assert.match(stickyClasses, /\bz-\d/, `${file}: the pinned row needs a stacking context above the rows it covers`)
  assert.match(
    stickyClasses,
    /\bbg-/,
    `${file}: the pinned row needs its own background, or the ledger rows show through it`,
  )
  assert.ok(sticky.end > sticky.start, `${file}: the sticky wrapper must be closed`)
}

// Positive control. A sweep that answers "pinned" for everything it is handed
// proves nothing, so it is run here against a surface that is deliberately NOT
// pinned: CustomerPurchasesReportModal draws the same DateTimeRangePicker, but
// it is a modal -- its own panel scrolls, and the app pins section rows, not
// modal rows. If the check below ever starts reporting `true`, the instrument
// is broken and the assertions above are meaningless.
const control = read('CustomerPurchasesReportModal.tsx')
// This modal has since moved to the shared StatsRangeRow wrapper too (same
// migration the ledger sections got in P3-10), so it no longer draws a bare
// `<DateTimeRangePicker` -- check with the same hasRangeControl() detector the
// sweep above uses, rather than pinning the one control shape that moved.
assert.ok(hasRangeControl(control), 'the control must actually be a date-range surface')
assert.equal(
  pinsItsDateRow(control),
  false,
  'the sweep must be able to tell a pinned row from an unpinned one -- it answered "pinned" for the modal control',
)

console.log(`PASS ${sections.length} contacts invoice sections pin their filter + date row (control: modal correctly unpinned)`)
