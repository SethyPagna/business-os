// The Announcement Strip shows the order the server stored, not only the
// order the editor guessed (WEB-2, owner 24 Sep 2026).
//
// Before: a drop moved the cards locally, sent the new order, and threw the
// server's answer away. The reorder PUT answers with every card in its stored
// order, so a card another device had added or moved meanwhile never showed
// where it really was, and a second drop could race the first.
//
// Pinned here:
//   1. the Worker premise -- PUT /api/promotions/reorder/all answers with the
//      rows in stored order (sort_order, then id), typed as Promotion[];
//   2. the one path that saves an order puts that answer on screen, reloads
//      on a failure or an unusable answer, and takes one move at a time;
//   3. moveCard, run for real: the dragged card takes the target's slot, in
//      both directions and to either end.
//
// Run: node tests/announcementStripOrder.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const source = read('../src/components/catalog/ManagePromotionsModal.tsx')
const transport = read('../src/api/promotionsTransport.ts')
const worker = read('../../cloudflare/src/routes/promotions.ts')

// The text of one `const name = ...` declaration inside the component, up to
// the next declaration at the same two-space indent.
function declaration(name: string): string {
  const start = source.indexOf(`\n  const ${name} = `)
  assert.ok(start >= 0, `ManagePromotionsModal declares ${name}`)
  const rest = source.slice(start + 1)
  const end = rest.slice(1).search(/\n {2}const [A-Za-z]+ = /)
  return end > 0 ? rest.slice(0, end + 1) : rest
}

// 1. The premise the editor relies on.
const reorderRoute = worker.slice(worker.indexOf("app.put('/reorder/all'"))
assert.ok(reorderRoute.length > 0, 'the Worker still has the strip reorder route')
const reorderBody = reorderRoute.slice(0, reorderRoute.indexOf('\n})'))
assert.match(reorderBody, /SELECT \* FROM promotions ORDER BY sort_order ASC, id ASC/, 'the reorder route reads every card back in stored order')
assert.match(reorderBody, /return c\.json\(rows\)/, 'the reorder route answers with those rows')
assert.match(transport, /export function reorderPromotions\(order: Array<number \| string>\): Promise<Promotion\[\]>/, 'the transport types the answer as the card list')

// 2. One path saves an order, and it shows the server's answer.
const saveOrder = declaration('saveOrder')
assert.equal((source.match(/\breorderPromotions\(/g) || []).length, 1, 'reorderPromotions is called from exactly one place')
assert.match(saveOrder, /const rows = await reorderPromotions\(next\.map\(\(p\) => p\.id\)\)/, 'saveOrder sends the new order and keeps the answer')
assert.match(saveOrder, /if \(Array\.isArray\(rows\)\) setPromotions\(rows\)\s*\n\s*else await loadPromotions\(\)/, 'the list becomes the stored order; an unusable answer reloads it')
assert.match(saveOrder, /catch \(error\) \{[\s\S]*?copy\('saveOrderFailed'[\s\S]*?await loadPromotions\(\)/, 'a failed save says so and reloads the stored order')
assert.match(saveOrder, /if \(orderSaving\) return/, 'a move waits until the previous one is confirmed')
assert.match(saveOrder, /setOrderSaving\(true\)[\s\S]*finally \{\s*\n\s*if \(aliveRef\.current\) setOrderSaving\(false\)/, 'the saving flag always clears')
assert.match(source, /draggable=\{!orderSaving\}/, 'cards cannot be dragged while an order is being saved')
assert.match(source, /aria-busy=\{orderSaving\}/, 'the list reports that it is saving')

const handleDrop = declaration('handleDrop')
assert.match(handleDrop, /void saveOrder\(moveCard\(promotions, fromIndex, toIndex\)\)/, 'a drop goes through saveOrder')
assert.doesNotMatch(handleDrop, /setPromotions\(/, 'a drop never sets the list on its own')

// 3. moveCard, compiled from the component source and run.
const moveCardSource = source.slice(source.indexOf('function moveCard('), source.indexOf('\n}\n', source.indexOf('function moveCard(')) + 2)
assert.ok(moveCardSource.startsWith('function moveCard('), 'moveCard is a plain module function')
const compiled = transformSync(`${moveCardSource}\nmodule.exports = moveCard`, { loader: 'ts', format: 'cjs' }).code
const mod = { exports: {} as unknown }
new Function('module', compiled)(mod)
const moveCard = mod.exports as <T>(list: T[], from: number, to: number) => T[]
const ids = (list: Array<{ id: number }>) => list.map((p) => p.id).join(',')
const cards = [1, 2, 3, 4].map((id) => ({ id }))
assert.equal(ids(moveCard(cards, 0, 2)), '2,3,1,4', 'dragged down, the card takes the target slot')
assert.equal(ids(moveCard(cards, 3, 1)), '1,4,2,3', 'dragged up, the card takes the target slot')
assert.equal(ids(moveCard(cards, 0, 3)), '2,3,4,1', 'a card can reach the end')
assert.equal(ids(moveCard(cards, 3, 0)), '4,1,2,3', 'a card can reach the front')
assert.equal(ids(cards), '1,2,3,4', 'moveCard never mutates the list on screen')

console.log('PASS announcementStripOrder: the strip shows the stored order after every move')
