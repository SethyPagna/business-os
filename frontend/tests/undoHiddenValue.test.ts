// P2.8-F (4 Nov 2026): an Undo that would have to put back a value the editor could not see is refused, never faked.
//
// An account without "See full phone numbers" is shown a value that is only a number as 097 *** 822: a phone, but also a contact saved
// under its number, a note, a label or a contact person that is one. The Undo of an edit replays the snapshot taken before it, so for such
// a field it would replay the mask; the Worker reads a mask as "the value you already hold" (cloudflare/scripts/test-phone-masked-text-native.cjs),
// so the write would answer 200 and the field would keep its NEW value: a silent non-restore, wrong data. When the edit changed a field
// that was shown masked, the Undo is refused up front, with a translated reason (N1's key), and nothing is written.
//
// Part 1 the rule: only the exact mask shape counts (a note that merely contains "***" or digits does not), only a field the edit CHANGED
// counts, a holder's real snapshot never does. Part 2 every edit site that offers Undo for a field the Worker masks asks the question and
// refuses with the reason: the four contact sites, a product edit and bulk edit, a user edit, a return edit. Part 3 the reason is in both packs.
//
// Run: node tests/undoHiddenValue.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { UNDO_HIDDEN_VALUE_FALLBACK, isShownMask, undoNeedsHiddenValue, undoNeedsHiddenValueIn } from '../src/utils/hiddenValueUndo.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---- Part 1: the rule ------------------------------------------------------------------------------------------------------
{
  for (const shown of ['097 *** 822', '***', '1 *** 2', '010 *** 333', ' 097  ***  822 ', 'refund to "093 *** 424" requested', "ref '093 *** 424'", 'refund to “093 *** 424”', 'x "***" y']) {
    assert.equal(isShownMask(shown), true, `a mask: ${JSON.stringify(shown)}`)
  }
  for (const typed of ['call *** later', 'a *** b', 'ref 4471', '097 262 822', '097 **** 822', '097 ** 822', '1234 *** 822', 'mask *** here', '', '*', '**', 'refund to "093 111 424"', 'amount "12.50" refunded']) {
    assert.equal(isShownMask(typed), false, `not a mask: ${JSON.stringify(typed)}`)
  }
  for (const other of [null, undefined, 5, {}, ['097 *** 822']]) assert.equal(isShownMask(other), false, `not a string: ${JSON.stringify(other)}`)
  // The shape is repeated from the Worker (cloudflare/src/lib/phoneMask.ts MASK_SHAPE): the two must read the same text, or an Undo is
  // refused for a value the Worker would keep, or allowed for one it would silently not restore.
  const workerMask = read('../../cloudflare/src/lib/phoneMask.ts').match(/const MASK_SHAPE = \/\^(\(\?:.+\))\$\//)
  assert.ok(workerMask, 'the Worker still declares MASK_SHAPE as one anchored alternation')
  const ownMask = read('../src/utils/hiddenValueUndo.ts').match(/const MASK = '(.+)'/)
  assert.ok(ownMask, 'the helper declares MASK as one string')
  assert.equal(ownMask[1].replace(/\\\\/g, '\\'), workerMask[1], 'the frontend mask shape is the Worker mask shape, character for character')
  console.log('PASS only the exact mask shape the masker writes counts (a note that merely contains "***" or digits does not)')
}
{
  const before = { id: 7, name: '010 *** 333', notes: '097 *** 822', label: '097 *** 831', contact_person: '097 *** 812', email: 'a@b.test' }
  assert.equal(undoNeedsHiddenValue(before, { ...before, notes: 'new note' }), true, 'the note was shown masked and the edit changed it')
  assert.equal(undoNeedsHiddenValue(before, { ...before, name: 'Dara' }), true, 'a contact saved under its number was renamed')
  assert.equal(undoNeedsHiddenValue(before, { ...before, label: '' }), true, 'a hidden label was cleared')
  assert.equal(undoNeedsHiddenValue(before, { ...before, contact_person: null }), true, 'a hidden contact person was cleared')
  assert.equal(undoNeedsHiddenValue(before, { ...before, notes: '097 *** 999' }), true, 'a different mask is a different value')
  assert.equal(undoNeedsHiddenValue(before, { ...before, email: 'c@d.test' }), false, 'a field that was not shown masked can be put back')
  assert.equal(undoNeedsHiddenValue(before, { ...before }), false, 'an edit that left every masked field as shown: the same mask on both sides')
  assert.equal(undoNeedsHiddenValue(before, { email: 'c@d.test' }), false, 'a field the edit did not send is not a reason')
  assert.equal(undoNeedsHiddenValue({ notes: '097 262 822' }, { notes: 'new note' }), false, 'a holder\'s snapshot has the real value: undo works')
  assert.equal(undoNeedsHiddenValue({ notes: 'call *** later' }, { notes: 'call me' }), false, 'a note that merely contains *** is not a mask')
  assert.equal(undoNeedsHiddenValue({ notes: '' }, { notes: 'x' }), false, 'nothing was hidden')
  assert.equal(undoNeedsHiddenValue(null, { notes: 'x' }), false)
  assert.equal(undoNeedsHiddenValue(before, null), false, 'no information about the edit: nothing to refuse')
  assert.equal(undoNeedsHiddenValue('097 *** 822', 'x'), false, 'a bare string has no field')
  console.log('PASS undo is refused only when the edit changed a field that was shown masked')
}
{
  assert.equal(undoNeedsHiddenValue({ id: 1, items: [{ id: 5, notes: '097 *** 822' }] }, { id: 1, items: [{ id: 5, notes: 'changed' }] }), true, 'a field inside a line')
  assert.equal(undoNeedsHiddenValue({ id: 1, items: [{ id: 5, notes: '097 *** 822' }] }, { id: 1, items: [{ id: 5, notes: '097 *** 822' }] }), false)
  assert.equal(undoNeedsHiddenValue({ reason: 'refund to "093 *** 424" requested' }, { reason: 'refund to someone' }), true, 'a reason that quoted a number')
  assert.equal(undoNeedsHiddenValue({ reason: 'refund to "093 *** 424" requested' }, { reason: 'refund to "093 *** 424" requested' }), false)
  assert.equal(undoNeedsHiddenValueIn([{ id: 1, supplier: 'Sok' }, { id: 2, supplier: '097 *** 812' }], { supplier: 'Vanna' }), true, 'one product of a bulk edit is enough')
  assert.equal(undoNeedsHiddenValueIn([{ id: 1, supplier: 'Sok' }, { id: 2, supplier: 'Lux' }], { supplier: 'Vanna' }), false)
  assert.equal(undoNeedsHiddenValueIn([], { supplier: 'Vanna' }), false)
  console.log('PASS the rule reads lines and quoted reasons, and a bulk edit asks about each snapshot')
}

// ---- Part 2: every edit site that offers Undo for a field the Worker masks ------------------------------------------------------
for (const [file, call] of [
  ['../src/components/contacts/CustomersTab.tsx', 'undoNeedsHiddenValue(existingSnapshot, nextSnapshot)'],
  ['../src/components/contacts/SuppliersTab.tsx', 'undoNeedsHiddenValue(existingSnapshot, nextSnapshot)'],
  ['../src/components/contacts/DeliveryTab.tsx', 'undoNeedsHiddenValue(existingSnapshot, nextSnapshot)'],
  ['../src/components/contacts/CustomerSourceModal.tsx', 'undoNeedsHiddenValue(before, { ...before, ...payload })'],
] as const) {
  const source = read(file)
  assert.ok(source.includes(`undoNeedsHiddenPhone(`) && source.includes(`|| ${call}`), `${file}: the phone question (N1) and the question about every other masked field are both asked`)
  assert.ok(source.includes('undoRefused: undoBlocked,'), `${file}: a refused undo is marked so that it never moves between stacks or marks the row failed`)
  assert.ok(/undo: undoBlocked \? \(\) => \{ throw new Error\(tr\((t, )?'contact_undo_phone_hidden', UNDO_PHONE_HIDDEN_FALLBACK\)\) \} : async \(\) => \{/.test(source), `${file}: the refusal says why, in the viewer's language`)
}
for (const [file, asks, count] of [
  ['../src/components/products/Products.tsx', ['undoNeedsHiddenValue(previousSnapshot, latestProductSnapshot)', 'undoNeedsHiddenValueIn(restoredSnapshots, nextUpdates)'], 2],
  ['../src/components/users/Users.tsx', ['undoNeedsHiddenValue(previousSnapshot, nextSnapshot)'], 1],
  ['../src/components/returns/Returns.tsx', ['undoNeedsHiddenValue(previousSnapshot, latestSnapshot)'], 1],
] as const) {
  const source = read(file)
  for (const ask of asks) assert.ok(source.includes(`const undoBlocked = ${ask}`), `${file}: the edit's undo asks ${ask}`)
  assert.equal(source.split('undoRefused: undoBlocked,').length - 1, count, `${file}: ${count} refused undo(s) marked`)
  assert.equal((source.match(/undo: undoBlocked \? \(\) => \{ throw new Error\(tr\('contact_undo_phone_hidden', UNDO_HIDDEN_VALUE_FALLBACK\)\) \} : /g) || []).length, count, `${file}: the refusal says why, in the viewer's language`)
}
console.log('PASS every edit site that offers Undo for a field the Worker masks asks the question and refuses with the reason (contacts x4, product edit and bulk edit, user edit, return edit)')

// ---- Part 3: the reason is translated ----------------------------------------------------------------------------------------------
{
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.equal(en.contact_undo_phone_hidden, UNDO_HIDDEN_VALUE_FALLBACK, 'the English fallback is the pack text, word for word')
  assert.ok(/saved value is incomplete/.test(en.contact_undo_phone_hidden) && !/phone/i.test(en.contact_undo_phone_hidden) && !/who can see/.test(en.contact_undo_phone_hidden), 'the reason fits a note or a name that is a number, not only a phone, and names nobody who sees more')
  assert.ok(typeof km.contact_undo_phone_hidden === 'string' && /[ក-៿]/.test(km.contact_undo_phone_hidden) && km.contact_undo_phone_hidden.includes('***'), 'the Khmer reason is Khmer and says what is hidden')
  assert.notEqual(km.contact_undo_phone_hidden, en.contact_undo_phone_hidden)
  console.log('PASS the reason is in both packs and fits a phone, a name, a note and a label')
}
