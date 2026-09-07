import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const formSource = readFileSync(new URL('../src/components/contacts/CustomerFormModal.tsx', import.meta.url), 'utf8')
const enSource = readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')
const kmSource = readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')
const en = JSON.parse(enSource) as Record<string, string>
const km = JSON.parse(kmSource) as Record<string, string>

assert.match(
  formSource,
  /const membershipNumberReadOnly = !customer \|\| Boolean\(String\(customer\.membership_number \|\| ''\)\.trim\(\)\)/,
  'new customers and existing customers with stored membership numbers must be read-only while legacy blank records remain editable',
)

const membershipBlockStart = formSource.indexOf('id="customer-form-membership"')
const membershipBlockEnd = formSource.indexOf('<DuplicateFlagBanner', membershipBlockStart)
assert.ok(membershipBlockStart >= 0 && membershipBlockEnd > membershipBlockStart, 'membership field block must exist')
const membershipBlock = formSource.slice(membershipBlockStart, membershipBlockEnd)

assert.match(membershipBlock, /readOnly=\{membershipNumberReadOnly\}/, 'the derived lock state controls the actual input')
assert.match(membershipBlock, /aria-readonly=\{membershipNumberReadOnly\}/, 'assistive technology receives the same lock state')
assert.doesNotMatch(membershipBlock, /disabled=/, 'read-only membership numbers remain readable and focusable')
assert.match(
  membershipBlock,
  /!customer \? \([\s\S]*membership_number_auto_hint[\s\S]*\) : membershipNumberReadOnly \? \([\s\S]*membership_number_preserved_hint[\s\S]*\) : null/,
  'new auto-assignment and existing preserved IDs have distinct truthful hints while legacy blank edits have neither locked hint',
)
assert.doesNotMatch(formSource, /existing one can still be corrected/, 'the form must not promise a backend-ignored correction')

assert.equal(en.membership_number_preserved_hint, 'This existing membership number is preserved and cannot be changed.')
assert.equal(km.membership_number_preserved_hint, 'លេខសមាជិកដែលមានស្រាប់នេះត្រូវបានរក្សាទុក ហើយមិនអាចកែប្រែបានទេ។')
assert.equal((enSource.match(/"membership_number_preserved_hint"/g) || []).length, 1, 'English hint key is unique')
assert.equal((kmSource.match(/"membership_number_preserved_hint"/g) || []).length, 1, 'Khmer hint key is unique')

console.log('customer membership read-only tests passed')
