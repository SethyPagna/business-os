import assert from 'node:assert/strict'
import fs from 'node:fs'

// Owner screenshot, phone width: the Export icon wrapped onto a row of its own below Stats + dates.
// Fixed by letting the dates box take only what is left (basis 0, shrinkable) so chip, dates and
// actions share ONE row. Measured in Chromium with the built CSS (Records/Incidents/2026-10-27/LANE-6.0.1003.md):
// at 320/360/390/430/1280 px, with and without a second action, everything sits on one row and
// inside the card; the old layout wrapped at 360 px with Export + Manage.
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const row = read('../src/components/shared/StatsRangeRow.tsx')
const strip = read('../src/components/shared/StatsStrip.tsx')
const dashboard = read('../src/components/dashboard/Dashboard.tsx')
const sales = read('../src/components/sales/Sales.tsx')

assert.ok(row.includes("singleRow = false"), 'single-row is opt-in: every other caller keeps its wrapping layout')
assert.ok(row.includes("singleRow ? 'min-w-[8rem] flex-1 basis-0' : 'min-w-[10.5rem] flex-1'"), 'the dates box has no intrinsic basis, so it never forces the actions down a row')
assert.ok(row.includes("${singleRow ? 'flex-nowrap' : 'flex-wrap'}`} data-stats-range-controls"), 'the control row itself does not wrap')
assert.ok(row.includes("${singleRow ? 'flex-nowrap' : 'flex-wrap'}`}>{actions}"), 'the actions stay together at the right end')
assert.ok(strip.includes('singleRow={singleRow}'), 'StatsStrip hands the option to the row')

// Both pages with the Stats + dates + action pattern opt in.
for (const [name, source] of [['Dashboard', dashboard], ['Sales', sales]] as const) {
  const at = source.indexOf('<StatsStrip')
  assert.ok(at > 0 && /\n\s+singleRow\n/.test(source.slice(at, at + 3500)), `${name} puts Stats, the date range and its actions on one row`)
}
// The compact icon actions are the same height as the Stats chip (h-10) so the row stays level.
assert.ok(strip.includes('inline-flex h-10 min-h-10 shrink-0'), 'the Stats chip is h-10')
assert.ok(read('../src/components/shared/toolbarButtonStyles.ts').includes('h-10 min-h-10 w-10'), 'the Export icon button is the same height')

console.log('PASS stats toolbar single row')
