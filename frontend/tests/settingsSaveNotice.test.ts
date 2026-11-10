// Owner, 10 Nov 2026: saving Receipt settings DID save, but the toast said
// "No changes to save". The form autosaves silently 900 ms after an edit, so
// by the time Save is pressed the write is already stored and the write
// answers 'unchanged'. The press must still say "Saved" once; only a press
// with nothing new to tell says no change.
//
// Run: node tests/settingsSaveNotice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { manualSaveNotice, settingsSaveOutcome, type SettingsSaveOutcome } from '../src/utils/settingsSave.ts'

assert.equal(manualSaveNotice('saved', false), 'saved', 'a real write says Saved')
assert.equal(manualSaveNotice('unchanged', true), 'saved', 'an edit the autosave already stored still says Saved')
assert.equal(manualSaveNotice('unchanged', false), 'unchanged', 'no edit says no change')

// The form's own bookkeeping, driven the way ReceiptSettings drives it.
class Form {
  silent = false
  stored = 'a'
  draft = 'a'
  edit(value: string) { this.draft = value }
  private write(): SettingsSaveOutcome {
    if (this.draft === this.stored) return 'unchanged'
    this.stored = this.draft
    return 'saved'
  }
  autosave() {
    if (this.write() === 'saved') this.silent = true
  }
  press() {
    const notice = manualSaveNotice(this.write(), this.silent)
    this.silent = false
    return notice
  }
}

const untouched = new Form()
assert.equal(untouched.press(), 'unchanged', 'opening and pressing Save with no edit')

const autosaved = new Form()
autosaved.edit('b'); autosaved.autosave()
assert.equal(autosaved.press(), 'saved', 'edit, autosave fires, then Save')
assert.equal(autosaved.press(), 'unchanged', 'a second press with nothing new')

const pressedFast = new Form()
pressedFast.edit('b')
assert.equal(pressedFast.press(), 'saved', 'Save before the autosave fires')

const again = new Form()
again.edit('b'); again.autosave(); again.press()
again.edit('c')
assert.equal(again.press(), 'saved', 'save, edit again, save again')
assert.equal(again.press(), 'unchanged')

assert.equal(settingsSaveOutcome({ success: true, unchanged: true }), 'unchanged')
assert.equal(settingsSaveOutcome({ success: true }), 'saved')

const source = readFileSync(new URL('../src/components/receipt-settings/ReceiptSettings.tsx', import.meta.url), 'utf8')
assert.match(source, /silentToast: true,/, 'the shared save helper no longer toasts on this form: the form announces it')
assert.match(source, /notify\(notice === 'saved' \? t\('settings_saved'\) : t\('settings_no_changes'\)/)
assert.match(source, /else if \(outcome === 'saved'\) \{\s*savedSilentlyRef\.current = true/, 'a silent save arms the next press')

console.log('settingsSaveNotice.test.ts OK')
