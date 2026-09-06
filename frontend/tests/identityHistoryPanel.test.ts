// N34 / lane "linkover", item 2 -- "a merge can be inspected", and the reason
// that sentence was not true yet.
//
// The history reader and its panel shipped inside ONE surface: the Resolve float
// in Products -> Conflicts. That float opens only from a cluster card, and
// Conflicts lists what is still OUTSTANDING. So the normal case -- a survivor
// whose conflict is gone precisely because the merge happened -- had no screen
// anywhere that could answer "was this row merged, and from what?". The answer
// existed, was gated behind the one question it could not be asked about, and
// every check in the previous round passed anyway, because they all tested the
// reader rather than its reachability.
//
// So this file pins TWO things:
//   1. the panel's content decision, as a pure function (which lines, in which
//      order, and when there is nothing to show at all), and
//   2. that BOTH surfaces render that one panel -- the Conflicts float and the
//      product form in edit mode -- with a positive control, because a source
//      probe that only ever sees the fixed file proves nothing.
//
// Run: node tests/identityHistoryPanel.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasIdentityHistory,
  identityHistoryEntries,
  type IdentityFold,
  type IdentityHistory,
} from '../src/components/products/helpers/identityHistory.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src', 'components', 'products')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${label}`)
}

const fold = (over: Partial<IdentityFold>): IdentityFold => ({
  fromId: 1, fromName: 'Twin', intoId: 10, intoName: 'Survivor',
  at: '2026-09-05 11:00:00', by: 'sethy', source: 'merge', reversed: false, snapshotId: 1,
  ...over,
})

// --- 1. WHAT THE PANEL SAYS ----------------------------------------------
check('nothing recorded renders nothing at all', () => {
  for (const empty of [null, undefined, {}, { mergedFrom: [], mergedInto: null, keptSeparate: [] }]) {
    assert.equal(hasIdentityHistory(empty as IdentityHistory | null), false)
    assert.deepEqual(identityHistoryEntries(empty as IdentityHistory | null), [])
  }
})

check('DISCRIMINATING: a row with only a keep-separate decision still has history', () => {
  // The panel's gate reads the WHOLE history, not just the folds. A gate written
  // as `mergedFrom.length > 0` hides exactly the row whose operator asked to be
  // able to change his mind later -- the decision the owner's ruling is about.
  const history: IdentityHistory = {
    mergedFrom: [], mergedInto: null,
    keptSeparate: [{ at: '2026-09-06 09:00:00', by: 'lin', keptSeparateFrom: [22, 23], path: 'create' }],
  }
  assert.equal(hasIdentityHistory(history), true)
  const entries = identityHistoryEntries(history)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'kept_separate')
  assert.deepEqual((entries[0] as { ids: number[] }).ids, [22, 23])
})

check('DISCRIMINATING: the server\'s order is preserved, never recomputed', () => {
  // Two folds recorded in the SAME second, newest (snapshot 9) first -- which is
  // the order readProductIdentityHistory returns after sorting on the snapshot
  // id. A panel that re-sorted on `at` has nothing to order these two by and
  // would swap them on any stable-sort-by-equal-key implementation detail; one
  // that sorted ascending would invert them outright.
  const history: IdentityHistory = {
    mergedFrom: [
      fold({ fromId: 12, fromName: 'Bulk Twin', snapshotId: 9, source: 'bulk_merge', at: '2026-09-06 10:00:00' }),
      fold({ fromId: 11, fromName: 'Single Twin', snapshotId: 8, at: '2026-09-06 10:00:00' }),
    ],
  }
  assert.deepEqual(
    identityHistoryEntries(history).map((entry) => (entry as { name: string }).name),
    ['Bulk Twin', 'Single Twin'],
  )
})

check('an undone fold keeps its flag, and a nameless row falls back to its id', () => {
  const entries = identityHistoryEntries({
    mergedFrom: [fold({ fromId: 13, fromName: null, reversed: true, snapshotId: 3 })],
    mergedInto: fold({ fromId: 10, intoId: 99, intoName: '  ', snapshotId: 2 }),
  })
  assert.equal(entries.length, 2)
  assert.equal((entries[0] as { name: string; reversed: boolean }).name, '#13')
  assert.equal((entries[0] as { reversed: boolean }).reversed, true, '"undone" and "never happened" must not render the same')
  assert.equal(entries[1].kind, 'merged_into')
  assert.equal((entries[1] as { name: string }).name, '#99', 'a blank name is not a name')
  // Keys are unique, or React collapses two folds of the same row into one line.
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length)
})

// --- 2. WHERE THE PANEL IS ------------------------------------------------
// A probe run against three inputs: the two shipped surfaces, and the product
// form as it stood before this fix.
const rendersPanel = (text: string) => /<IdentityHistoryPanel\b/.test(text)
const loadsHistory = (text: string) => /getProductIdentityHistory\(/.test(text)

check('the Conflicts resolve float renders the shared panel', () => {
  const tab = fs.readFileSync(path.join(src, 'ProductDuplicatesTab.tsx'), 'utf8')
  assert.ok(rendersPanel(tab), 'Conflicts must render the one panel, not its own copy of the markup')
  assert.ok(loadsHistory(tab))
  // ...and no second hand-written rendering of the same lines is left behind.
  assert.ok(
    !/identity_history_merged_from/.test(tab),
    'the float must render THROUGH the shared panel -- a second copy of these lines drifts the moment either gains a row type',
  )
})

check('DISCRIMINATING: the product form shows it too, in edit mode', () => {
  const form = fs.readFileSync(path.join(src, 'forms', 'ProductForm.tsx'), 'utf8')
  assert.ok(
    loadsHistory(form),
    'without this the only reader of GET /:id/identity-history is a float that opens for rows still in a cluster -- a merge survivor with no remaining conflict can never be inspected',
  )
  assert.ok(rendersPanel(form), 'the form must render the shared panel')
  assert.match(
    form, /isEditMode \? <IdentityHistoryPanel/,
    'edit mode only: a row being created has no history, and an empty panel on every create would be chrome that says nothing',
  )
})

check('POSITIVE CONTROL: the pre-fix product form fails both probes', () => {
  // The form as it stood at 6e3abfea, in the two respects this test is about:
  // it rendered the create-match hint and nothing else about identity, and it
  // never called the history endpoint.
  const PRE_FIX_FORM = [
    "      {activeTab === 'basic' ? (",
    '        <div className="space-y-4">',
    '          {isCreateMode && createVerdict.kind ? (',
    '            <p>{tr("create_match_name_hint", "This name already exists")}</p>',
    '          ) : null}',
  ].join('\n')
  assert.equal(rendersPanel(PRE_FIX_FORM), false, 'a probe that passes on the pre-fix form discriminates nothing')
  assert.equal(loadsHistory(PRE_FIX_FORM), false)
})

console.log(`PASS identityHistoryPanel (${passed} checks)`)
