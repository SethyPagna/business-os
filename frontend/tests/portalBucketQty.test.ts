import assert from 'node:assert/strict'
import { findItemQty } from '../src/components/catalog/portalBucket.ts'
import type { PortalBucketItem } from '../src/components/catalog/portalBucket.ts'

// Backs `usePortalBucket().getQty`, used by the public-catalog product card
// to show/keep incrementing an item's own qty badge instead of swapping the
// Add button to a static "Added" checkmark (progress.md part 202/226).

const items: PortalBucketItem[] = [
  { id: 1, name: 'Lipstick', qty: 3 },
  { id: '2', name: 'Blush', qty: 1 },
]

// Present item, numeric id.
assert.equal(findItemQty(items, 1), 3)
// Present item, id passed as the "other" type (string vs numeric) --
// lookup is string-compared, matching how `hasItem`/`add` already match ids
// (product ids can arrive as either type depending on the calling surface).
assert.equal(findItemQty(items, '1'), 3)
assert.equal(findItemQty(items, 2), 1)

// Absent item returns 0, not undefined -- callers do `qty > 0` directly.
assert.equal(findItemQty(items, 999), 0)
assert.equal(typeof findItemQty(items, 999), 'number')

// Empty bucket.
assert.equal(findItemQty([], 1), 0)

console.log('PASS portalBucket findItemQty/getQty resolves per-item quantity for the Add-button badge')
