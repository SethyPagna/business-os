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
//   3. A stored preference that predates the column does not keep it hidden.
//   4. The sibling gap on the Returns list -- no branch column existed at
//      all -- is closed the same way.
//
// N23 (owner, Sep 6 2026: "show delivery driver column in display") extended
// 2 and 3: the column now appears at the same breakpoint as its Branch
// sibling rather than 1024px-and-up only, the phone card NAMES the driver,
// and a preference written before the column existed no longer hides it.
//
// Run: node tests/salesDriverColumn.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDriverLabel } from '../src/utils/salesDriverLabel.ts'
import { SALES_COLUMNS_SURFACE_KEY, SALES_OPTIONAL_COLUMNS } from '../src/components/sales/salesListColumns.ts'
import { COLUMN_STORAGE_PREFIX, defaultVisibleColumns, parseStoredColumns } from '../src/components/shared/columnPreferences.ts'

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

assert.deepEqual(
  SALES_OPTIONAL_COLUMNS.map((column) => column.key),
  ['cashier', 'branch', 'driver', 'items'],
  'driver must be registered among the Sales list optional columns',
)
// "must show" (owner wording) means it ships visible, unlike a plain opt-in
// column -- checked on the real definition, not on its source text.
assert.ok(
  defaultVisibleColumns(SALES_OPTIONAL_COLUMNS).has('driver'),
  'the driver column must be default-visible',
)
assert.match(
  salesSurface,
  /useColumnPreferences\(SALES_COLUMNS_SURFACE_KEY, SALES_OPTIONAL_COLUMNS\)/,
  'the surface must use the shared column definitions, not a local copy',
)

assert.match(salesSurface, /import \{ resolveDriverLabel \} from '\.\.\/\.\.\/utils\/salesDriverLabel\.ts'/)
assert.match(salesSurface, /cols\.isVisible\('driver'\)/, 'the desktop table must gate the driver cell on the column chooser')
// Header cell exists.
assert.match(salesSurface, /cols\.isVisible\('driver'\) \? <th[\s\S]{0,120}>\{t\('driver'\)}<\/th> : null/)
// Body cell reads resolveDriverLabel(sale), not a raw inline field read (the
// whole point of extracting the pure function is one call site, not a
// re-implementation per surface).
assert.equal(
  (salesSurface.match(/const driverLabel = resolveDriverLabel\(sale\)/g) || []).length,
  2,
  'the desktop row and the phone card must BOTH resolve the driver through the shared function',
)
// N23: N/A placeholder stays (Sep 6 ruling) -- an empty driver cell would
// read as a rendering bug rather than as "nobody delivered this".
assert.match(salesSurface, /\{driverLabel \|\| 'N\/A'}/, 'the desktop driver cell keeps its N/A placeholder')

// N23: the driver column was `hidden lg:table-cell`, so on a tablet or a
// small laptop -- the widths this counter actually uses -- it was not
// rendered at all, which is exactly "it does not show". It now appears at the
// same breakpoint as Branch, the sibling metadata column beside it.
const driverHeader = /cols\.isVisible\('driver'\) \? <th ([^>]*)>/.exec(salesSurface)?.[1] || ''
const branchHeader = /cols\.isVisible\('branch'\) \? <th ([^>]*)>/.exec(salesSurface)?.[1] || ''
assert.ok(driverHeader && branchHeader, 'expected both the driver and branch header cells')
const breakpointOf = (className: string): string => (/(?:hidden )?(sm|md|lg|xl):table-cell/.exec(className)?.[1] || 'always')
assert.equal(
  breakpointOf(driverHeader),
  breakpointOf(branchHeader),
  'the driver header must appear at the same breakpoint as its Branch sibling',
)
assert.notEqual(breakpointOf(driverHeader), 'lg', 'the driver column must not be desktop-only')
for (const [label, pattern] of [
  ['body cell', /cols\.isVisible\('driver'\) \? <td ([^>]*)>\{driverLabel/],
  ['skeleton cell', /cols\.isVisible\('driver'\) \? <td ([^>]*)><div/],
] as const) {
  const className = pattern.exec(salesSurface)?.[1] || ''
  assert.ok(className, `expected the driver ${label}`)
  assert.equal(breakpointOf(className), breakpointOf(branchHeader), `the driver ${label} must match the header's breakpoint`)
}

// Phone card: the driver is not just present but NAMED. Cashier / branch /
// driver all shared one unlabeled pipe-separated meta line, so a bare "Sok
// Dara" could equally have been the cashier. The desktop table has a column
// header to disambiguate; the card needs the label itself.
const mobileCardStart = salesSurface.indexOf('space-y-2 md:hidden')
assert.ok(mobileCardStart > 0, 'expected to find the phone card list in SalesListSurface')
const mobileCardSource = salesSurface.slice(mobileCardStart)
assert.match(mobileCardSource, /const driverLabel = resolveDriverLabel\(sale\)/, 'the phone card must also resolve the driver label')
assert.match(mobileCardSource, /\{driverLabel \? <span>\| \{t\('driver'\)}: \{driverLabel}<\/span> : null}/, 'the phone card must NAME the driver, not show a bare name')

// ---------------------------------------------------------------------------
// 3. A stored preference written BEFORE the driver column existed must not
//    keep it hidden -- the defect the owner was actually looking at, since
//    the column was already default-visible in code.
//
//    parseStoredColumns intersects the stored set with the known keys and
//    returns it verbatim, so a legacy set that never mentioned 'driver'
//    resolves to "driver off". Re-run the exact composition
//    useColumnPreferences.readInitial performs, against a fake localStorage
//    holding a genuine pre-N9 value.

const LEGACY_STORED = JSON.stringify(['cashier', 'branch', 'items'])
const store: Record<string, string> = {
  // What a user who last touched the chooser before N9 has on disk.
  [`${COLUMN_STORAGE_PREFIX}sales`]: LEGACY_STORED,
}
const resolve = (surfaceKey: string): Set<string> =>
  parseStoredColumns(store[COLUMN_STORAGE_PREFIX + surfaceKey] ?? null, SALES_OPTIONAL_COLUMNS)
  ?? defaultVisibleColumns(SALES_OPTIONAL_COLUMNS)

// Discriminating: on the old key that same stored value hides the column.
assert.equal(resolve('sales').has('driver'), false, 'sanity: the legacy stored set is what hid the column')
assert.equal(
  resolve(SALES_COLUMNS_SURFACE_KEY).has('driver'),
  true,
  'a user whose preference predates the Driver column must see it',
)
assert.notEqual(SALES_COLUMNS_SURFACE_KEY, 'sales', 'the surface key must have moved for the defaults to reapply')

// ...and the bump is one-time, not a defaults-always-win merge: a choice
// stored UNDER THE NEW KEY is honored exactly as written, including a
// deliberate hide of the driver column.
store[`${COLUMN_STORAGE_PREFIX}${SALES_COLUMNS_SURFACE_KEY}`] = JSON.stringify(['cashier', 'branch', 'items'])
assert.equal(
  resolve(SALES_COLUMNS_SURFACE_KEY).has('driver'),
  false,
  'a deliberate hide under the current key must be honored, not overwritten by defaults',
)
delete store[`${COLUMN_STORAGE_PREFIX}${SALES_COLUMNS_SURFACE_KEY}`]

// The composition above must stay the one useColumnPreferences actually runs.
const columnHook = read('src/components/shared/useColumnPreferences.ts')
assert.match(columnHook, /parseStoredColumns\(localStorage\.getItem\(COLUMN_STORAGE_PREFIX \+ surfaceKey\), columns\)/)
assert.match(columnHook, /return stored \?\? defaultVisibleColumns\(columns\)/)

// ---------------------------------------------------------------------------
// 4. Sibling gap: Returns list had no branch column at all.

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
