// Held POS orders must survive the till mounting before the signed-in user
// resolves (owner report, 26 Sep 2026: an order held overnight was gone after
// signing back in the next day).
//
// Cart drafts live under a per-user storage key. The orders state is read
// once, for the scope at mount time. Before this fix, the persist effects ran
// on every key change and wrote the CURRENT (old-scope, usually empty) orders
// into the NEW user's key, erasing the drafts saved there. This test pins the
// fix: a scope change loads the new scope's drafts and suppresses the writes
// for that render.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '../src/components/pos/POS.tsx'), 'utf8').replace(/\r\n/g, '\n')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const persistStart = source.indexOf('// Persist whenever orders or activeId change')
assert.ok(persistStart > 0, 'persist block not found')
const persistBlock = source.slice(persistStart, source.indexOf('/** Apply a partial update to the active order.', persistStart))

check('a scope change is detected against the scope the state was loaded for', () => {
  assert.match(persistBlock, /const loadedDraftScopeRef = useRef\(posStorageScope\)/)
  assert.match(persistBlock, /const draftScopeChanged = loadedDraftScopeRef\.current !== posStorageScope/)
})

check('the new scope\'s saved drafts are READ (orders, active id, counter) when the scope changes', () => {
  const load = persistBlock.slice(0, persistBlock.indexOf('}, [posStorageScope])'))
  assert.match(load, /readPosDraft\(posOrdersStorageKey, 'bos_pos_orders'\)/)
  assert.match(load, /setOrders\(nextOrders\)/)
  assert.match(load, /setActiveId\(readPosDraft\(posActiveStorageKey/)
  assert.match(load, /setOrderCounter\(/)
})

check('every draft write is suppressed on the render where the scope changed (negative control: the old unguarded write)', () => {
  const writes = persistBlock.match(/writePosDraft\(pos(Orders|Active|Counter)StorageKey/g) || []
  assert.equal(writes.length, 3, 'expected the three persist writes')
  const guards = persistBlock.match(/if \(draftScopeChanged\) return\n\s+(if \(resolvedActiveId\) )?writePosDraft/g) || []
  assert.equal(guards.length, 3, 'each persist write must be guarded by draftScopeChanged')
  assert.ok(!/useEffect\(\(\) => \{\n\s+writePosDraft\(posOrdersStorageKey/.test(persistBlock), 'unguarded orders write is back')
})

check('the load effect is declared before the write effects, so it runs first in the same commit', () => {
  assert.ok(persistBlock.indexOf('}, [posStorageScope])') < persistBlock.indexOf('writePosDraft(posOrdersStorageKey'))
})

console.log(`\nOK ${passed} checks`)
