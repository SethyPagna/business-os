// A scanner-gun burst into a free-text Reason box (utils/scannerWedge.ts SCAN_GUARD_PROPS, lane 6.0.940).
//
// The stock-session line's Reason box adds the line on Enter and the count editor's Reason box saves the issue
// on Enter, so a burst typed there became a reason that was a barcode and fired the add or the save. A text field
// keeps today's behaviour (the person is typing there on purpose) UNLESS it opts in with the data attribute; an
// opted-in field is treated like a quantity box: put back, code to search. The real-browser proof is
// scannerReasonGuardBrowser.test.ts; this file pins the classification and which fields opted in.
//
// Run: node tests/scannerWedgeReasonGuard.test.ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCAN_GUARD_PROPS, classifyWedgeFocus } from '../src/utils/scannerWedge.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string): string => readFileSync(path.join(frontend, relative), 'utf8').replace(/\r\n/g, '\n')

const text = { tagName: 'INPUT', type: 'text' }
const optedIn = { ...text, dataset: { scanGuard: 'true' } }

runTest('the opt-in is one data attribute', () => {
  assert.deepEqual(SCAN_GUARD_PROPS, { 'data-scan-guard': 'true' })
})

runTest('an opted-in text field is put back like a quantity box; every other text field is left alone', () => {
  assert.equal(classifyWedgeFocus(optedIn, false), 'restore')
  assert.equal(classifyWedgeFocus(text, false), 'text', 'without the attribute nothing changed')
  assert.equal(classifyWedgeFocus({ ...text, dataset: {} }, false), 'text')
  assert.equal(classifyWedgeFocus({ ...text, dataset: { scanGuard: 'false' } }, false), 'text', 'only the exact opt-in counts')
  for (const type of ['search', 'email', 'url', 'tel', 'password', '']) {
    assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type }, false), 'text', `a plain ${type || 'untyped'} field`)
  }
})

runTest('the opt-in changes nothing else: the search field, numbers, selects, free text boxes and non-text inputs', () => {
  assert.equal(classifyWedgeFocus(optedIn, true), 'search', 'the surface\'s own search field still takes the code')
  assert.equal(classifyWedgeFocus({ tagName: 'TEXTAREA', dataset: { scanGuard: 'true' } }, false), 'text', 'only a text <input> can be put back, so a textarea is never opted in')
  assert.equal(classifyWedgeFocus({ tagName: 'DIV', isContentEditable: true, dataset: { scanGuard: 'true' } }, false), 'text')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'checkbox', dataset: { scanGuard: 'true' } }, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'number' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'text', inputMode: 'decimal' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'SELECT' }, false), 'restore')
  assert.equal(classifyWedgeFocus(null, false), 'idle')
})

runTest('exactly the two Reason boxes opt in, and the stock-session one goes through the shared input\'s prop', () => {
  const walk = (dir: string): string[] => readdirSync(path.join(frontend, dir), { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name).replace(/\\/g, '/')] : []
  ))
  // Comments may name the attribute (the hook documents it); only code opts a field in.
  const code = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const users = walk('src').filter((file) => /SCAN_GUARD_PROPS|guardScans/.test(code(file))).sort()
  assert.deepEqual(users, [
    'src/components/inventory/InventoryCheckCountEditor.tsx',
    'src/components/shared/SuggestionTextInput.tsx',
    'src/components/stock-session/StockSessionLineEntry.tsx',
    'src/utils/scannerWedge.ts',
  ])
  const line = read('src/components/stock-session/StockSessionLineEntry.tsx')
  assert.match(line, /<SuggestionTextInput\s+id="stock-session-reason"[\s\S]*?\bguardScans\n\s*\/>/, 'the line entry\'s Reason box')
  assert.equal((line.match(/guardScans/g) || []).length, 1, 'and no other box on that row')
  const editor = read('src/components/inventory/InventoryCheckCountEditor.tsx')
  assert.match(editor, /<input ref=\{reasonRef\} id=\{reasonId\}[^\n]*\n[^\n]*\{\.\.\.SCAN_GUARD_PROPS\} \/>/, 'the count editor\'s Reason box')
  assert.equal((editor.match(/SCAN_GUARD_PROPS/g) || []).length, 2, 'the import and the one box; the Count box is guarded by its numeric input mode')
  const shared = read('src/components/shared/SuggestionTextInput.tsx')
  assert.match(shared, /\{\.\.\.\(guardScans \? SCAN_GUARD_PROPS : \{\}\)\}/)
  assert.match(shared, /guardScans = false/, 'every other suggestion field is unguarded by default')
})

if (failed > 0) process.exitCode = 1
