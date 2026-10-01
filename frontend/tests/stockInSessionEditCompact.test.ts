import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Spec UI-STOCK section 10 (owner, 30 Sep 2026: "make each part compact and 1
// row as much as possible", labels inside the inputs). The stock-in session's
// header edit and its saved-line editor take the Stock Session's own controls:
// no caption above an input, one row per field pair, and Paid / Not Yet Paid
// with its due date laid out like the session's Payment step.

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const source = read('../src/components/products/StockInSessionsSection.tsx')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const CAPTION = /<span className="mb-1 block text-\[11px\] text-gray-500">/
const headerEdit = (text: string): string => text.slice(text.indexOf('{editing ? <div'), text.indexOf(': <div className="grid grid-cols-2 gap-x-3', text.indexOf('{editing ? <div')))
const lineEditor = (text: string): string => text.slice(text.indexOf('data-testid="stock-in-line-editor"'), text.indexOf('stock_in_line_edit_hint', text.indexOf('data-testid="stock-in-line-editor"')))

function headerIsCompact(text: string): boolean {
  const block = headerEdit(text)
  return block.length > 0
    && !CAPTION.test(block)
    && /<IconField icon=\{CalendarDays\} title=\{receivedDateLabel\}>\s*<DateEntryInput[^>]*placeholder=\{receivedDateLabel\}/.test(block)
    && /<CompactSupplierBox idPrefix="stock-session-edit"/.test(block)
    && /role="radiogroup"/.test(block) && /aria-checked=\{editPayment === status\}/.test(block)
    && /<IconField icon=\{CalendarClock\} title=\{dueDateLabel\}>\s*<DateEntryInput[^>]*disabled=\{editPayment !== 'credit'\}/.test(block)
    && !/: <div \/>\}/.test(block)
}

function lineEditorIsCompact(text: string): boolean {
  const block = lineEditor(text)
  return block.length > 0
    && !CAPTION.test(block)
    && /<InsetNumberField label=\{tr\('quantity', 'Quantity'\)\}/.test(block)
    && /\{canEditCosts \? <InsetNumberField label=\{tr\('unit_cost', 'Unit cost'\)\}/.test(block)
    && /<IconField icon=\{CalendarDays\} title=\{receivedDateLabel\}>/.test(block)
    && /<CompactSupplierBox idPrefix="stock-in-line-edit"/.test(block)
    && /<IconField icon=\{MessageSquare\} title=\{tr\('reason', 'Reason'\)\} className="col-span-2 sm:col-span-4">/.test(block)
}

// The pre-lane layout: a caption above every input, and an empty cell where
// the due date is not needed.
const OLD = `
        {editing ? <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/60">
          <label><span className="mb-1 block text-[11px] text-gray-500">{tr('received_date', 'Received date')}</span><DateEntryInput className="h-9 text-sm" /></label>
          {editPayment === 'credit' ? <label><span className="mb-1 block text-[11px] text-gray-500">{tr('due_date', 'Due date')}</span></label> : <div />}
        </div> : <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {lineEdit ? <div data-testid="stock-in-line-editor" className="space-y-2">
            <label className="min-w-0"><span className="mb-1 block text-[11px] text-gray-500">{tr('quantity', 'Quantity')}</span><input /></label>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{tr('stock_in_line_edit_hint', 'x')}</div>
`

runTest('the checks refuse the captioned pre-lane layout', () => {
  assert.equal(headerIsCompact(OLD), false)
  assert.equal(lineEditorIsCompact(OLD), false)
})

runTest('the header edit is two compact rows with the names inside the controls', () => {
  assert.ok(headerIsCompact(source))
})

runTest('the saved-line editor has no captions: Qty | Cost | Received date | Supplier, then Reason', () => {
  assert.ok(lineEditorIsCompact(source))
  assert.match(lineEditor(source), /className="grid grid-cols-2 gap-1\.5 sm:grid-cols-4"/, 'two columns on a phone, one row of four on desktop')
})

runTest('the controls come from the Stock Session so every stock surface looks the same', () => {
  assert.match(source, /import \{ IconField, InsetNumberField \} from '\.\.\/stock-session\/StockSessionSharedDetails\.tsx'/)
})

if (failed) process.exitCode = 1
