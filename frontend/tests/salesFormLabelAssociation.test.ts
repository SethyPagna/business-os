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
  'the shared range is named by a fieldset legend rather than an unassociated label',
)

assert.match(exportModal, /<DateTimeRangePicker\b/)
assert.doesNotMatch(exportModal, /<DateEntryInput\b/)

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

console.log('PASS sales shared export range and responsive section headers have associated labels')
