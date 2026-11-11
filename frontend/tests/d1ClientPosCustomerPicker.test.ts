// D1 client lane (C5): the till's customer picker sends no empty read, no read after a pick, one read on refocus and none while closed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { posCustomerSearchRequest } from '../src/components/pos/posCustomerSearch.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

await test('picker: no empty read, no read after a pick, one read on refocus, none while closed', () => {
  type Step = { text: string; open: boolean }
  const baseRequests = (steps: Step[]) => steps.length // the old effect fired on the first open and on every text change
  const session: Step[] = [
    { text: '', open: true },
    { text: 's', open: true },
    { text: 'so', open: true },
    { text: 'sok', open: true },
    { text: 'Sok Dara', open: false },
    { text: 'Sok Dara', open: true },
    { text: '012', open: true },
    { text: '1', open: true },
  ]
  const after = session.filter((s) => posCustomerSearchRequest(s.text, s.open) !== null)
  assert.deepEqual(after.map((s) => s.text), ['so', 'sok', 'Sok Dara', '012'])
  assert.ok(after.length < baseRequests(session))
  assert.equal(posCustomerSearchRequest('Sok Dara', false), null, 'a customers event with the picker closed reads no list')
  assert.equal(posCustomerSearchRequest('កា', true), 'កា', 'Khmer from its second code point')
  assert.equal(posCustomerSearchRequest('ក', true), null)
})

await test('picker source: no hidden fetch, the by-id check and the cache drop stay on every customers event', () => {
  const pos = read('../src/components/pos/POS.tsx')
  assert.doesNotMatch(pos, /customerOptionsLoadedRef/, 'the first-open empty read is gone')
  assert.doesNotMatch(pos, /showCustomer \|\| showAddCustomer\) return undefined/, 'the create dialog no longer triggers a hidden search')
  assert.match(pos, /posCustomerSearchRequest\(active\?\.customerSearch \|\| '', showCustomer && showCustomerDrop\)/)
  const branch = pos.slice(pos.indexOf("if (channel === 'customers') {"), pos.indexOf("if (channel === 'deliveryContacts'"))
  assert.match(branch, /await invalidatePosCustomerReads\(\)/)
  assert.match(branch, /loadPosCustomersByIds\(\[selected\.id as string \| number\]\)/, 'the selected customer is still checked by id on every customers event')
  assert.match(branch, /customerPickerOpenRef\.current/, 'the list re-search runs only while the picker is open')
  assert.match(pos, /onFocus=\{\(\) => setShowCustomerDrop\(true\)\}/, 'refocus reopens the drop, which is what triggers the one lazy read')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('PASS d1 client POS customer picker')
