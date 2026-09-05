// N9 (sales lane): the Sales list had NO driver/courier column at all --
// SALES_OPTIONAL_COLUMNS only defined cashier/branch/items even though
// GET /sales has carried a resolved delivery_contact_name (with a live
// linked_driver_name fallback baked in server-side) since the delivery
// contacts feature shipped. This pins:
//   1. resolveDriverLabel's three cases (discriminating against the old
//      "just read sale.delivery_contact_name inline, no shared resolver"
//      shape, and against a resolver that ignores linked_driver_name).
//   2. The Driver column is registered on SALES_OPTIONAL_COLUMNS,
//      default-visible (not hidden behind an opt-in toggle), and rendered
//      on both the desktop table and the phone card.
//   3. The sibling gap on the Returns list -- no branch column existed at
//      all -- is closed the same way.
//
// Run: node tests/salesDriverColumn.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDriverLabel } from '../src/utils/salesDriverLabel.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. resolveDriverLabel: three cases, exercised against real shapes rather
//    than a regex over source (a pure function, so behavior is checkable
//    directly).

// Case A: linked_driver_name present -- wins even when delivery_contact_name
// also has a (stale/different) value, so a live-linked driver's current name
// is preferred over an old snapshot.
assert.equal(
  resolveDriverLabel({ linked_driver_name: 'Sok Dara', delivery_contact_name: 'Old Name' }),
  'Sok Dara',
)

// Case B: no linked_driver_name (the real shape GET /sales sends today --
// the server destructures linked_driver_name out of the response) -- falls
// back to delivery_contact_name.
assert.equal(
  resolveDriverLabel({ delivery_contact_name: 'Chan Vuthy' }),
  'Chan Vuthy',
)
assert.equal(
  resolveDriverLabel({ linked_driver_name: null, delivery_contact_name: 'Chan Vuthy' }),
  'Chan Vuthy',
)

// Case C: neither field set (or blank/whitespace-only) -- empty string, so
// callers apply their own empty-state text (a dash in a table cell, a
// translated "No driver" in a detail view).
assert.equal(resolveDriverLabel({}), '')
assert.equal(resolveDriverLabel(null), '')
assert.equal(resolveDriverLabel(undefined), '')
assert.equal(resolveDriverLabel({ linked_driver_name: '  ', delivery_contact_name: '   ' }), '')

// Whitespace is trimmed on the winning value too.
assert.equal(resolveDriverLabel({ linked_driver_name: '  Sok Dara  ' }), 'Sok Dara')

// ---------------------------------------------------------------------------
// 2. Source-shape: the column is registered, default-visible, and rendered
//    on desktop (th/td gated by cols.isVisible) and on the phone card.

const salesSurface = read('src/components/sales/SalesListSurface.tsx')

assert.match(
  salesSurface,
  /const SALES_OPTIONAL_COLUMNS: TableColumnDef\[] = \[[\s\S]*?\{ key: 'driver'[\s\S]*?]/,
  'driver must be registered on SALES_OPTIONAL_COLUMNS',
)
// The column definition for 'driver' must not carry defaultVisible: false --
// "must show" (owner wording) means it ships visible, unlike a plain opt-in
// column.
const driverColumnDef = /\{\s*key:\s*'driver'[^}]*}/.exec(salesSurface)?.[0] || ''
assert.ok(driverColumnDef, 'expected to find the driver column definition object')
assert.doesNotMatch(driverColumnDef, /defaultVisible:\s*false/, 'the driver column must be default-visible')

assert.match(salesSurface, /import \{ resolveDriverLabel \} from '\.\.\/\.\.\/utils\/salesDriverLabel\.ts'/)
assert.match(salesSurface, /cols\.isVisible\('driver'\)/, 'the desktop table must gate the driver cell on the column chooser')
// Header cell exists.
assert.match(salesSurface, /cols\.isVisible\('driver'\) \? <th[\s\S]{0,120}>\{t\('driver'\)}<\/th> : null/)
// Body cell reads resolveDriverLabel(sale), not a raw inline field read (the
// whole point of extracting the pure function is one call site, not a
// re-implementation per surface).
assert.match(salesSurface, /resolveDriverLabel\(sale\)/)

// Phone card: driver appears in the same always-shown meta line as cashier
// and branch (mobile ignores the desktop column chooser, same as those two).
const mobileCardStart = salesSurface.indexOf('space-y-2 md:hidden')
assert.ok(mobileCardStart > 0, 'expected to find the phone card list in SalesListSurface')
const mobileCardSource = salesSurface.slice(mobileCardStart)
assert.match(mobileCardSource, /resolveDriverLabel\(sale\)/, 'the phone card must also render the driver label')

// ---------------------------------------------------------------------------
// 3. Sibling gap: Returns list had no branch column at all.

const returnsSurface = read('src/components/returns/ReturnsListSurface.tsx')

assert.match(
  returnsSurface,
  /const RETURN_OPTIONAL_COLUMNS: TableColumnDef\[] = \[[\s\S]*?\{ key: 'branch'[\s\S]*?]/,
  'branch must be registered on RETURN_OPTIONAL_COLUMNS',
)
const returnBranchColumnDef = /\{\s*key:\s*'branch'[^}]*}/.exec(returnsSurface)?.[0] || ''
assert.ok(returnBranchColumnDef, 'expected to find the returns branch column definition object')
assert.doesNotMatch(returnBranchColumnDef, /defaultVisible:\s*false/, 'the returns branch column must be default-visible, matching the sales list')

assert.match(returnsSurface, /branch_name\?:\s*string \| null/, 'ReturnRecord must carry branch_name')
assert.match(returnsSurface, /cols\.isVisible\('branch'\)[\s\S]{0,200}ret\.branch_name/, 'the desktop row must render ret.branch_name behind the column toggle')

const returnsMobileStart = returnsSurface.indexOf('mobile-cards-only')
assert.ok(returnsMobileStart > 0, 'expected to find the phone card list in ReturnsListSurface')
assert.match(returnsSurface.slice(returnsMobileStart), /ret\.branch_name/, 'the returns phone card must also show branch')

console.log('salesDriverColumn.test.ts OK')
