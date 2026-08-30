// Pins the Products → Duplicates review section's multi-select bulk
// contract, which deliberately mirrors the contacts Possible Duplicates
// panel (cross-surface rule): per-cluster checkboxes, Select all over the
// FILTERED view, a bulk bar with Merge/Dismiss selected, sequential calls
// with visible progress, and — the safety-critical part — bulk merge only
// ever automated for exactly-2-product clusters with "keep the older
// record" (lower id) as the keeper; 3+ clusters are skipped for a human,
// never guessed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'components', 'products', 'ProductDuplicatesTab.tsx'), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('every cluster card carries a selection checkbox and a selected ring', () => {
  assert.match(src, /type="checkbox"/)
  assert.match(src, /onChange=\{onToggleSelect\}/)
  assert.match(src, /selected \? 'ring-2 ring-blue-400/, 'a selected card must be visibly distinct')
})

test('Select all selects the FILTERED view, not hidden clusters', () => {
  assert.match(src, /setSelectedKeys\(new Set\(visibleClusters\.map\(\(cluster\) => clusterKey\(cluster\)\)\)\)/)
})

test('bulk merge automates only 2-product clusters and keeps the older record', () => {
  assert.match(src, /cluster\.products\.length === 2/, 'a 3+ cluster needs a human-picked keeper')
  assert.match(src, /\[\.\.\.cluster\.products\]\.sort\(\(a, b\) => a\.id - b\.id\)/, 'keeper = lower id (created first)')
  assert.match(src, /mergePossiblySameProducts\(keeper\.id, other\.id\)/)
  assert.match(src, /bulk_merge_skipped_multiway/, 'skipped 3+ groups are reported, not silent')
})

test('bulk actions run sequentially with live progress and continue past failures', () => {
  assert.match(src, /bulk_merging_progress/)
  assert.match(src, /bulk_dismissing_progress/)
  assert.match(src, /catch \{\s*\n\s*failed \+= 1/, 'one failed cluster must not abort the rest')
  assert.match(src, /bulk_dismiss_partial_failure/)
  assert.match(src, /bulk_merge_partial_failure/)
})

test('selection is cleared after any bulk action and pruned when a cluster resolves', () => {
  assert.match(src, /setSelectedKeys\(new Set\(\)\)/)
  const removeBlock = src.slice(src.indexOf('const removeCluster'), src.indexOf('const toggleSelected'))
  assert.match(removeBlock, /next\.delete\(id\)/, 'merging/dismissing a cluster individually must drop it from the selection too')
})

test('the bulk bar reuses the contacts panel\'s shared vocabulary (one review pattern everywhere)', () => {
  for (const key of ['duplicates_bulk_selected_count', 'duplicates_bulk_merge_action', 'duplicates_bulk_dismiss_action', 'select_all', 'clear_selection']) {
    assert.ok(src.includes(key), `${key} should be the same key the contacts DuplicatesTab uses`)
  }
})

test('groups apply only after EVERY row is decided, with exactly one Keep', () => {
  // Decide-all-then-apply (user, Aug 30): per-row Keep/Remove decisions,
  // Apply armed only when the whole group is decided with one keeper.
  assert.match(src, /const \[decisions, setDecisions\] = useState<Record<number, 'keep' \| 'remove'>>/)
  assert.match(src, /const everyDecided = cluster\.products\.every\(\(product\) => decisions\[product\.id\]\)/)
  assert.match(src, /const canApply = Boolean\(keeper\) && everyDecided && removals\.length > 0/)
  assert.match(src, /onApplyDecisions\(keeper, removals\)/)
  assert.match(src, /if \(next\[Number\(id\)\] === 'keep'\) delete next\[Number\(id\)\]/, 'picking a new Keep demotes the old keeper to undecided')
})

test('Resolve edits IN PLACE via a float — the tab never navigates away', () => {
  assert.match(src, /const \[editTarget, setEditTarget\] = useState<ClusterProduct \| null>/)
  assert.match(src, /updateProduct\(editTarget\.id, \{/)
  assert.match(src, /<Modal title=/, 'the edit float is the shared Modal')
  assert.ok(!src.includes('onResolve'), 'no navigation-out prop remains')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll productDuplicatesTab tests passed')
