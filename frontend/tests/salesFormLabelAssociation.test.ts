// Regression for the four visible unassociated labels reproduced in the
// Sales -> Export -> Detailed sales report -> Custom flow. Source-shape is
// intentional here: the frontend utility suite has no DOM, while the exact
// rendered `HTMLLabelElement.control` contract is covered by the browser
// acceptance used to identify this regression.
//
// Run: node tests/salesFormLabelAssociation.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string): string => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8')

const exportModal = read('components/sales/ExportModal.tsx')
const salesList = read('components/sales/SalesListSurface.tsx')

const labels = (source: string): string[] => Array.from(source.matchAll(/<label\b[\s\S]*?<\/label>/g), (match) => match[0])

assert.match(
  exportModal,
  /<fieldset\b[^>]*>[\s\S]*?<legend[^>]*>\{tr\('report_period', 'Report Period'\)\}<\/legend>[\s\S]*?<\/fieldset>/,
  'the period buttons are named by a fieldset legend rather than an unassociated label',
)

for (const [name, id] of [
  ['start_date', 'sales-export-start-date'],
  ['end_date', 'sales-export-end-date'],
] as const) {
  assert.match(
    exportModal,
    new RegExp(`<label htmlFor="${id}"[^>]*>\\{tr\\('${name}', '[^']+'\\)\\}<\\/label>[\\s\\S]*?<DateEntryInput id="${id}"`),
    `${name} label points to the DateEntryInput control`,
  )
}

for (const label of labels(exportModal)) {
  assert.match(label, /\bhtmlFor=/, 'every remaining ExportModal label names its control')
}

const salesListLabels = labels(salesList)
assert.equal(salesListLabels.length, 2, 'desktop and phone section headers each keep one checkbox label')
for (const label of salesListLabels) {
  assert.match(label, /<input\b/, 'a SalesListSurface label is rendered only with its nested selection checkbox')
}
assert.equal(
  Array.from(salesList.matchAll(/\{selectionModeActive \? \(\s*<label\b/g)).length,
  2,
  'both responsive section headers conditionally render the label only in selection mode',
)

console.log('PASS sales custom export and responsive section headers have associated labels')
