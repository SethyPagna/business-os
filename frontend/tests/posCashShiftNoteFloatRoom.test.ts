// R40 proof (375x812): the My Notes launcher (components/shared/NotesWidget.tsx) docks to the left edge just above the bottom action bar, which
// is where the POS cash-shift note sits, so it covered the last words of the note. The note keeps its own room on phones; the launcher is not
// moved on any page (its offset is documented in NotesWidget.tsx: left-0, bottom clearance above the action bar).
// Mutants killed (each turns one assertion red):
//   the room class dropped from the note above Complete    -> "the POS note keeps room for the launcher on phones"
//   the room applies on desktop too                        -> "the room is phones only"
//   the launcher itself is moved off the left edge         -> "the launcher stays where it is on every page"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, '..', rel), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('the POS note keeps room for the launcher on phones', () => {
  const pos = read('src/components/pos/POS.tsx')
  const above = pos.split('\n').find((line) => line.includes('<CashShiftNote gate={posCashGate}') && line.includes('className="mb-1.5'))
  assert.ok(above, 'the note above Complete Sale is found')
  assert.match(above, /className="mb-1\.5 max-md:ml-8"/)
})
runTest('the room is phones only', () => {
  const pos = read('src/components/pos/POS.tsx')
  assert.ok(!/<CashShiftNote[^\n]*className="[^"]*\bml-8\b/.test(pos.replace(/max-md:ml-8/g, '')), 'no unprefixed left margin on a desktop note')
})
runTest('the launcher stays where it is on every page', () => {
  const widget = read('src/components/shared/NotesWidget.tsx')
  assert.match(widget, /pointer-events-none fixed left-0 z-\[1001\]/)
  assert.match(widget, /max-md:bottom-\[calc\(var\(--bottom-action-bar-clearance\)\+0\.125rem\)\]/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
