// UI-STOCK S4/S8 (KNOWN-138): one reason/label editor for every manager.
// Before, the stock reasons manager lived as four copies of load/save/rename/
// delete with rename through window.prompt and raw English tab ids
// ("adjust / transfer / move / delete"), and the return and expense managers
// each drew their own rows. Part 1 drives the catalog helpers the stock
// manager uses; part 2 pins the three managers onto the shared editor; part 3
// drives the editor itself in headless Chromium (add on Enter, inline rename
// with Enter and Escape, delete only after the shared confirm, dirty report).
//
// Run: node tests/reasonListEditor.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>

// ------------------------------------------------------------ 1. catalog helpers
const catalogSource = read('utils/useStockReasonCatalog.ts')
const compiled = ts.transpileModule(catalogSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const catalog: any = { exports: {} }
new Function('require', 'module', 'exports', compiled)(() => ({}), catalog, catalog.exports)
const { normalizeStockReasonCatalog, withStockReason, withoutStockReason, stockReasonsOfType, STOCK_REASON_TYPES } = catalog.exports

assert.deepEqual(STOCK_REASON_TYPES, ['adjust', 'transfer', 'move', 'delete'])
const saved = normalizeStockReasonCatalog({ items: [
  { id: 'a1', type: 'adjust', label: ' New arrival ' },
  { id: 'd1', type: 'delete', label: 'Discontinued' },
  { id: 'x', type: 'bogus', label: 'Nope' },
  { id: 'e', type: 'adjust', label: '   ' },
  { type: 'move', label: 'Wrong row' },
] })
assert.deepEqual(saved, [
  { id: 'a1', type: 'adjust', label: 'New arrival' },
  { id: 'd1', type: 'delete', label: 'Discontinued' },
  { id: 'move:Wrong row', type: 'move', label: 'Wrong row' },
], 'unknown types and blank labels drop; the delete type is kept (the old manager filtered it out of its lists)')
assert.equal(withStockReason(saved, 'adjust', 'new ARRIVAL'), null, 'a duplicate in the same type is refused, case-insensitively')
assert.deepEqual(withStockReason(saved, 'transfer', '  New   arrival ', 42)?.at(-1), { id: 'transfer:42', type: 'transfer', label: 'New arrival' }, 'the same words in another type are a new reason')
assert.equal(withStockReason(saved, 'adjust', '   '), null)
assert.deepEqual(withoutStockReason(saved, 'd1').map((item: { id: string }) => item.id), ['a1', 'move:Wrong row'], 'delete removes exactly one entry and keeps the other types')
assert.deepEqual(stockReasonsOfType(saved, 'delete').map((item: { label: string }) => item.label), ['Discontinued'])
console.log('PASS the stock reason catalog helpers')

// ------------------------------------------------------------ 2. the managers share the editor
const editor = read('components/shared/ReasonListEditor.tsx')
const stockManager = read('components/shared/StockReasonsManagerModal.tsx')
const returnManager = read('components/returns/ReturnReasonManagerModal.tsx')
const expenseManager = read('components/fees/ExpenseLabelManagerModal.tsx')
for (const [name, source] of [['ReasonListEditor', editor], ['StockReasonsManagerModal', stockManager], ['ReturnReasonManagerModal', returnManager], ['ExpenseLabelManagerModal', expenseManager], ['useStockReasonCatalog', catalogSource]] as const) {
  assert.doesNotMatch(source, /window\.prompt|window\.confirm/, `${name}: no native prompt or confirm`)
}
for (const [name, source] of [['StockReasonsManagerModal', stockManager], ['ReturnReasonManagerModal', returnManager], ['ExpenseLabelManagerModal', expenseManager]] as const) {
  assert.match(source, /import ReasonListEditor from '[./]*(?:shared\/)?ReasonListEditor\.tsx'/, `${name} renders the shared editor`)
  assert.match(source, /<ReasonListEditor[\s\S]*?onDirtyChange=/, `${name} feeds typed-but-unsaved text to its close guard`)
}
assert.match(editor, /askToConfirm\(request\)[\s\S]*?await onDelete\(item\)/, 'delete runs only after the shared confirm dialog answers yes')
assert.match(stockManager, /export default function StockReasonsManagerModal\(\{ initialTab = 'adjust', onClose, onChanged[,} ]/, 'the lane contract: { initialTab, onClose, onChanged }')
assert.match(stockManager, /useStockReasonCatalog\(/, 'the manager keeps no copy of the catalog logic')
for (const [type, key] of [['adjust', 'reason_tab_stock'], ['transfer', 'transfer'], ['move', 'reason_tab_move'], ['delete', 'delete']]) {
  assert.match(stockManager, new RegExp(`${type}: \\['${key}'`), `the ${type} tab is labelled through ${key}`)
}
assert.doesNotMatch(stockManager, /\{type\}<\/button>/, 'no raw type id as a tab label')
assert.deepEqual([en.reason_tab_stock, km.reason_tab_stock, en.reason_tab_move, km.reason_tab_move], ['Stock', 'ស្តុក', 'Move row', 'ផ្លាស់ជួរ'])
assert.match(catalogSource, /getInventoryReasonImpact[\s\S]*?replaceInventoryReason/, 'rename previews the linked movements before replacing')
assert.match(returnManager, /tr\('return_reason_remove_confirm'[\s\S]*?deleteConfirm=\{\(row\) => removeConfirm\(row\.label\)\}/, 'a return reason is removed only after its own review text is confirmed')
assert.doesNotMatch(expenseManager, /expense_labels_help/, 'no helper paragraph above the list')
const returnsPage = read('components/returns/Returns.tsx')
const feesPage = read('components/fees/FeesPage.tsx')
assert.match(returnsPage, /className=\{toolbarIconButtonClassName\} onClick=\{\(\) => setShowReasonManager\(true\)\}[^>]*>\s*<Tags className="h-4 w-4" \/>/, 'Returns opens its reasons with the same icon button as Expenses')
assert.doesNotMatch(returnsPage, /settings-2/, 'the odd Settings2 h-8 button is gone')
assert.match(feesPage, /className=\{toolbarIconButtonClassName\}\s*onClick=\{openLabelManager\}[\s\S]{0,200}<Tags className="h-4 w-4" \/>/, 'Expenses keeps the toolbar icon button with Tags')
console.log('PASS the stock, return and expense managers share one editor')

// ------------------------------------------------------------ 3. the editor in a browser
const fixtureSource = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import ReasonListEditor from '/src/components/shared/ReasonListEditor.tsx'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const pack = lang === 'km' ? km : en
  document.body.className = lang === 'km' ? 'lang-km' : ''
  const t = (key) => pack[key] || key
  const tr = (key, fallback) => pack[key] || fallback
  const log = window.__log = { adds: [], renames: [], deletes: [], dirty: [] }
  function Host() {
    const [items, setItems] = useState([{ id: 'a', label: 'New arrival' }, { id: 'b', label: 'Counted wrong សាប៊ូ' }])
    const [draft, setDraft] = useState('')
    return (
      <div style={{ width: 340, padding: 8 }} id="host">
        <ReasonListEditor
          items={items}
          tr={tr}
          draft={draft}
          onDraftChange={setDraft}
          onAdd={(label) => { log.adds.push(label); setItems((list) => [...list, { id: 'n' + list.length, label }]); setDraft('') }}
          onRename={(item, to) => { log.renames.push([item.id, to]); setItems((list) => list.map((row) => row.id === item.id ? { ...row, label: to } : row)); return true }}
          onDelete={(item) => { log.deletes.push(item.id); setItems((list) => list.filter((row) => row.id !== item.id)) }}
          onDirtyChange={(dirty) => log.dirty.push(dirty)}
        />
      </div>
    )
  }
  createRoot(document.getElementById('root')).render(<AppContext.Provider value={{ ...FALLBACK_APP_CONTEXT, t, language: lang }}><Host /></AppContext.Provider>)
`

const browser = await launchResolveFixture('reason-list-editor', fixtureSource)
const { evaluate, pause, open, press, khmerRoom } = browser
const labels = () => evaluate<string[]>(`[...document.querySelectorAll('[data-reason-row] .detail-scroll-text')].map((node) => node.textContent)`)
const typeInto = async (selector: string, text: string) => {
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await pause(40)
}
const clickButton = async (label: string, scope = 'document') => {
  const found = await evaluate<boolean>(`(() => { const button = [...${scope}.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') || node.textContent.trim()) === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true })()`)
  assert.ok(found, `button "${label}" is on the page`)
  await pause(60)
}

await browser.run('PASS the shared reason editor adds, renames inline and deletes only after the confirm', async () => {
  await open(360, 'lang=en', `document.querySelectorAll('[data-reason-row]').length === 2`)
  assert.deepEqual(await labels(), ['New arrival', 'Counted wrong សាប៊ូ'])

  // Add: the button reads "Add", Enter submits, a blank line cannot be added.
  assert.equal(await evaluate<boolean>(`[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Add').disabled`), true, 'nothing typed: Add is disabled')
  await typeInto('[data-reason-list-editor] input', '  Supplier   bonus ')
  assert.equal(await evaluate<boolean>(`__log.dirty.at(-1)`), true, 'typed text is reported dirty to the host')
  await press('Enter')
  await pause(60)
  assert.deepEqual(await evaluate(`__log.adds`), ['Supplier bonus'], 'Enter adds the trimmed label')
  assert.equal(await evaluate<boolean>(`__log.dirty.at(-1)`), false)

  // Inline rename: the input replaces the label; Escape cancels, Enter saves.
  await clickButton('Rename New arrival')
  assert.equal(await evaluate<string>(`document.activeElement.value`), 'New arrival', 'the rename input opens in place, focused, with the label')
  assert.equal(await evaluate<number>(`document.querySelectorAll('[data-reason-row] button[aria-label^="Delete "]').length`), 2, 'the row in edit shows Save/Cancel, not Delete')
  await typeInto('[data-reason-row] input', 'Arrived today')
  assert.equal(await evaluate<boolean>(`__log.dirty.at(-1)`), true, 'an open rename with a change is dirty')
  await press('Escape')
  await pause(60)
  assert.deepEqual(await labels(), ['New arrival', 'Counted wrong សាប៊ូ', 'Supplier bonus'], 'Escape cancels the rename')
  assert.deepEqual(await evaluate(`__log.renames`), [])
  await clickButton('Rename New arrival')
  await typeInto('[data-reason-row] input', 'Arrived today')
  await press('Enter')
  await pause(60)
  assert.deepEqual(await evaluate(`__log.renames`), [['a', 'Arrived today']], 'Enter saves the rename')
  assert.deepEqual(await labels(), ['Arrived today', 'Counted wrong សាប៊ូ', 'Supplier bonus'])

  // Delete: nothing happens until the shared confirm dialog says yes.
  await clickButton('Delete Counted wrong សាប៊ូ')
  const dialog = await evaluate<string | null>(`(() => { const node = [...document.querySelectorAll('[role=dialog]')].pop(); return node ? node.textContent : null })()`)
  assert.ok(dialog && dialog.includes('Delete this saved reason?') && dialog.includes('Counted wrong សាប៊ូ'), 'the confirm names the reason')
  assert.deepEqual(await evaluate(`__log.deletes`), [], 'no delete before the answer')
  await clickButton('Cancel', `[...document.querySelectorAll('[role=dialog]')].pop()`)
  assert.deepEqual(await evaluate(`__log.deletes`), [], 'Cancel keeps it')
  await clickButton('Delete Counted wrong សាប៊ូ')
  const confirm = await evaluate<boolean>(`(() => { const node = [...document.querySelectorAll('[role=dialog]')].pop(); const button = [...node.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Delete').pop(); button.click(); return true })()`)
  assert.ok(confirm)
  await pause(80)
  assert.deepEqual(await evaluate(`__log.deletes`), ['b'], 'confirmed: deleted')
  assert.deepEqual(await labels(), ['Arrived today', 'Supplier bonus'])

  // Nothing overflows the phone width; Khmer gets its line box.
  assert.equal(await evaluate<boolean>(`document.documentElement.scrollWidth <= 360`), true, 'no horizontal overflow at 360 px')
  await open(360, 'lang=km', `document.querySelectorAll('[data-reason-row]').length === 2`)
  await khmerRoom('reason editor', '#host', 2)
})
