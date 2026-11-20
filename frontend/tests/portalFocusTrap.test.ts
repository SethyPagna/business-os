import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTrapIndex } from '../src/components/catalog/portalFocusTrap.ts'

// Tab and Shift+Tab cycle inside the sheet: last wraps to first and back.
assert.equal(nextTrapIndex(4, 0, false), 1)
assert.equal(nextTrapIndex(4, 2, false), 3)
assert.equal(nextTrapIndex(4, 3, false), 0, 'Tab on the last goes to the first')
assert.equal(nextTrapIndex(4, 1, true), 0)
assert.equal(nextTrapIndex(4, 0, true), 3, 'Shift+Tab on the first goes to the last')
// Focus on the sheet itself (-1) or outside it enters at the right end.
assert.equal(nextTrapIndex(4, -1, false), 0)
assert.equal(nextTrapIndex(4, -1, true), 3)
assert.equal(nextTrapIndex(4, 9, false), 0)
// One control: it stays on it. None: -1, the caller keeps focus on the sheet.
assert.equal(nextTrapIndex(1, 0, false), 0)
assert.equal(nextTrapIndex(1, 0, true), 0)
assert.equal(nextTrapIndex(0, -1, false), -1)

// The sheet wires it, and Escape and focus return are still there.
const sheet = readFileSync(new URL('../src/components/catalog/PortalSheet.tsx', import.meta.url), 'utf8')
assert.match(sheet, /event\.key === 'Tab'/)
assert.match(sheet, /nextTrapIndex\(/)
assert.match(sheet, /event\.key !== 'Escape'/)
assert.match(sheet, /opener\.focus\(/)

console.log('PASS the account sheet keeps Tab and Shift+Tab inside it')
