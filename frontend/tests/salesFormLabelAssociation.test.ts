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

// The day header is one shared component for the desktop row and the phone card:
// its only label wraps the selection checkbox and exists only in select mode.
assert.equal(labels(salesList).length, 0, 'the SalesListSurface has no hand-rolled day-header label left')
assert.equal(
  Array.from(salesList.matchAll(/<DayGroupHeader\b/g)).length,
  2,
  'desktop and phone section headers both render the shared day-group header',
)
const dayHeader = read('components/shared/DayGroupHeader.tsx')
const dayHeaderLabels = labels(dayHeader)
assert.equal(dayHeaderLabels.length, 1, 'the shared day header has one checkbox label')
assert.match(dayHeaderLabels[0], /<input\b/, 'the day-header label is rendered only with its nested selection checkbox')
assert.match(dayHeader, /selection \? \(\s*<label\b/, 'the label is conditional on selection mode')

console.log('PASS sales shared export range and responsive section headers have associated labels')
