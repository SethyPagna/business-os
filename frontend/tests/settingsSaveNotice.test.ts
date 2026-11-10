// Owner, 10 Nov 2026: saving Receipt settings DID save, but the toast said
// "No changes to save". The form autosaves silently 900 ms after an edit, so
// by the time Save is pressed the write is already stored and the write
// answers 'unchanged'. The press must still say "Saved" once; only a press
// with nothing new to tell says no change.
//
// Run: node tests/settingsSaveNotice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { manualSaveNotice, settingsSaveOutcome } from '../src/utils/settingsSave.ts'

assert.equal(manualSaveNotice('saved', false), 'saved', 'a real write says Saved')
assert.equal(manualSaveNotice('unchanged', true), 'saved', 'an edit the autosave already stored still says Saved')
assert.equal(manualSaveNotice('unchanged', false), 'unchanged', 'no edit says no change')

assert.equal(settingsSaveOutcome({ success: true, unchanged: true }), 'unchanged')
assert.equal(settingsSaveOutcome({ success: true }), 'saved')

// The form's bookkeeping is the saver module, driven for real (timers, failed
// writes, Footer, Print, leaving the page) in tests/receiptSettingsSaver.test.ts.
const form = readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
assert.match(form, /createReceiptSettingsSaver\(/, 'the form owns no write logic of its own')
assert.match(form, /await saver\.manualSave\(\)/)
assert.doesNotMatch(form, /savedSilentlyRef/, 'no second copy of the notice bookkeeping')

console.log('settingsSaveNotice.test.ts OK')
