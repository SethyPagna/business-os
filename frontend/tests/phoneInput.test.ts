import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatPhoneInputEdit, formatPhoneInputValue } from '../src/utils/phoneInput.ts'

assert.equal(formatPhoneInputValue(''), '')
assert.equal(formatPhoneInputValue('0'), '0')
assert.equal(formatPhoneInputValue('0123'), '012 3')
assert.equal(formatPhoneInputValue('0123456'), '012 345 6')
assert.equal(formatPhoneInputValue('012345678'), '012 345 678')
assert.equal(formatPhoneInputValue('0962345678'), '096 234 5678')

assert.equal(formatPhoneInputValue('012-345 (678)'), '012 345 678', 'paste removes visual separators without changing digits')
assert.equal(formatPhoneInputValue('(+855) 12 345 678'), '+855 12 345 678', 'Cambodian country prefix remains explicit')
assert.equal(formatPhoneInputValue('+855 96 234 5678'), '+855 96 234 5678')
assert.equal(formatPhoneInputValue('+123456789012345'), '+123 456 789 012 345', 'valid international length is not truncated')

assert.deepEqual(
  formatPhoneInputEdit('012345', 3, 3),
  { value: '012 345', selectionStart: 3, selectionEnd: 3 },
  'backspace at an inserted separator keeps the caret before that separator',
)
assert.deepEqual(
  formatPhoneInputEdit('012 3945 678', 6, 6),
  { value: '012 394 5678', selectionStart: 6, selectionEnd: 6 },
  'middle insertion keeps the caret after the same digit',
)
assert.deepEqual(
  formatPhoneInputEdit('012 39 678', 4, 6),
  { value: '012 396 78', selectionStart: 3, selectionEnd: 6 },
  'selection editing remains anchored by digit position',
)

const contactSources = [
  '../src/components/contacts/CustomerFormModal.tsx',
  '../src/components/contacts/SuppliersTab.tsx',
  '../src/components/contacts/DeliveryTab.tsx',
  '../src/components/pos/POSQuickAddModals.tsx',
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'))

for (const source of contactSources) {
  assert.match(source, /formatPhoneInputElement\(e(?:vent)?\.currentTarget\)/, 'every owned form family wires its phone edits through the formatter')
}

const combinedSource = contactSources.join('\n')
assert.equal((combinedSource.match(/autoComplete="tel"/g) || []).length, 7, 'all seven owned primary, option, and POS quick-add phone inputs remain telephone inputs')
assert.equal((combinedSource.match(/formatPhoneInputElement\(/g) || []).length, 7, 'all seven owned phone inputs format progressively')

console.log('phone input tests passed')
