// The Sales list's optional-column set and the localStorage surface key it is
// remembered under. Pulled out of SalesListSurface.tsx so both are reachable
// from a plain-node test (tests/salesDriverColumn.test.ts) -- the surface
// itself is JSX and cannot be imported there, and the surface KEY is exactly
// the thing that decides whether a returning user sees the Driver column.
import type { TableColumnDef } from '../shared/columnPreferences.ts'

// N23 (owner, Sep 6 2026: "show delivery driver column in display").
//
// The Driver column was already registered and already default-visible, but a
// user who had opened the Sales page BEFORE it existed had a stored preference
// under `bos_table_columns_sales` that named only cashier/branch/items.
// parseStoredColumns intersects a stored set with the known keys and returns
// it verbatim, so for those users "driver is not in my stored set" meant
// "driver is off" -- permanently, and invisibly.
//
// The stored format is a bare array of VISIBLE keys, so a key's absence is
// indistinguishable from "the user deliberately turned this one off". Merging
// the defaults into a stored set would therefore silently switch a column
// back on that someone had chosen to hide. A one-time key bump cannot do that:
// it reapplies the defaults for this surface exactly once, leaves every other
// surface's memory alone, and costs a returning user only their sales column
// choices. That is the trade we took.
export const SALES_COLUMNS_SURFACE_KEY = 'sales.v2'

export const SALES_OPTIONAL_COLUMNS: TableColumnDef[] = [
  { key: 'cashier', label: 'Cashier' },
  { key: 'branch', label: 'Branch' },
  // N9: default-visible (the owner's "must show DRIVER" wording), still
  // chooser-toggleable/persisted like every other optional column here.
  { key: 'driver', label: 'Driver' },
  { key: 'items', label: 'Items' },
]
