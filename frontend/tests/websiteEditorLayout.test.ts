// The Website Editor fits a phone (WEB-2, owner 24 Sep 2026: "userfriendly,
// doesn't break page boundary etc... responsive").
//
// Pinned here:
//   1. Announcement Strip cards. On a phone the strip modal leaves each card
//      a narrow row, and as one row the grip, picture, Active pill, Edit and
//      Delete took nearly all of it: the title was cut to a few letters. On a
//      phone a card is now two lines -- the card itself (picture, title,
//      subtitle), then its actions -- and from `sm:` up it is one row again.
//
// Run: node tests/websiteEditorLayout.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const count = (text: string, pattern: RegExp) => (text.match(pattern) || []).length

// 1. Announcement Strip cards.
const strip = read('../src/components/catalog/ManagePromotionsModal.tsx')
const rowStart = strip.indexOf('draggable={!orderSaving}')
assert.ok(rowStart > 0, 'the strip renders its cards')
const row = strip.slice(rowStart, strip.indexOf('\n            ))}', rowStart))
const rowClass = row.match(/className=\{`([^`$]*)/)?.[1] || ''
assert.match(rowClass, /(?:^|\s)flex-col(?:\s|$)/, 'on a phone a card stacks its two lines')
assert.match(rowClass, /(?:^|\s)sm:flex-row(?:\s|$)/, 'from sm: up a card is one row')
assert.doesNotMatch(rowClass, /(?:^|\s)items-center(?:\s|$)/, 'a stacked card is not centred sideways (only sm:items-center)')

const cardLine = row.indexOf('<div className="flex min-w-0 flex-1 items-center gap-3">')
const actionLine = row.indexOf('<div className="flex shrink-0 items-center justify-end gap-3">')
assert.ok(cardLine > 0, 'the first line can shrink and takes the free width')
assert.ok(actionLine > cardLine, 'the actions line comes after the first line')
const first = row.slice(cardLine, actionLine)
assert.equal(count(first, /<div\b/g), count(first, /<\/div>/g), 'the first line closes before the actions line opens: they are siblings, not nested')
assert.ok(first.includes('{promo.title}'), 'the title sits on the first line')
const actions = row.slice(actionLine)
assert.equal(count(actions, /<\/div>/g) - count(actions, /<div\b/g), 1, 'the actions line is the last thing on the card')
for (const action of ['handleToggleActive(promo)', 'startEdit(promo)', 'setPendingDelete(promo)']) {
  assert.ok(actions.includes(action), `${action} sits on the actions line`)
}

console.log('PASS websiteEditorLayout: strip cards give the title its own line on a phone')
