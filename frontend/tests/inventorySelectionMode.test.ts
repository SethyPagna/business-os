import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Regression coverage for "Inventory page still using checkboxes / changes
// not applying" (progress.md Aug 18 batch item, fixed part 194). Root
// cause: InventoryProductsSurface.tsx accepted `selectionModeActive` and
// `getInventoryLongPressState` as props (comments even claimed parity with
// Products.tsx's long-press pattern) but never actually used them anywhere
// in the render body -- every section/group/row checkbox rendered
// unconditionally regardless of selection state, and `createLongPressHandlers`/
// `consumeLongPressClick` were imported but never called, so a row's
// onClick always just opened the detail sheet. These assertions read the
// real source (not a mock) so a future edit that quietly drops the wiring
// again fails loudly instead of silently regressing.

const source = readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')

assert.match(
  source,
  /createLongPressHandlers\(rowLongPressState, \{\s*disabled: selectionModeActive,\s*onLongPress: \(\) => toggleInventorySelectionScope\(rowScopeIds, true\),/,
  'Mobile product row should wire a real long-press handler that enters select mode, matching Products.tsx',
)

assert.match(
  source,
  /getInventoryLongPressState\(Number\(p\.id\)\)/,
  'Row long-press state should come from the shared per-row-id slot the parent (Inventory.tsx) hands down',
)

assert.match(
  source,
  /if \(consumeLongPressClick\(rowLongPressState\)\) return/,
  'Row click handler should consume the long-press ghost click, same fix as Products.tsx part 161',
)

// Every checkbox in the file -- section select-all, group select-all, and
// the per-row checkbox, on both the mobile card and desktop table -- must
// be gated behind selectionModeActive. A bare, unconditional
// `<input type="checkbox"` anywhere in this file (outside the props/type
// declarations above the component) is exactly the original bug: a
// checkbox rendered whether or not anything is selected.
const bodyStart = source.indexOf('export default function InventoryProductsSurface')
assert.ok(bodyStart > -1, 'Component body should be present')
const body = source.slice(bodyStart)

const uncondCheckboxPattern = /\n\s*<input\s*\n\s*type="checkbox"/g
let match: RegExpExecArray | null
let uncondCount = 0
while ((match = uncondCheckboxPattern.exec(body))) {
  // Look at the ~120 chars immediately before this <input to confirm it's
  // guarded by a `{selectionModeActive ? (` just above it.
  const precedingText = body.slice(Math.max(0, match.index - 120), match.index)
  if (!/selectionModeActive \? \(/.test(precedingText)) uncondCount += 1
}
assert.equal(uncondCount, 0, 'Every checkbox (section/group/row, mobile and desktop) should only render while selectionModeActive is true')

console.log('PASS Inventory selection mode: checkboxes gated + long-press wiring actually used, not just accepted as unused props')
