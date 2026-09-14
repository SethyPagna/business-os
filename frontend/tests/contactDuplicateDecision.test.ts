import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createSeparateContactDecision,
  normalizeContactDuplicateCheck,
  readContactDuplicateDecisionError,
  type ContactDuplicateCheck,
} from '../src/components/contacts/contactDuplicates.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const match = {
  id: 7,
  name: 'Sok Dara',
  phone: '012 345 678',
  membershipNumber: 'LC-00007',
  matchedPhone: '012345678',
  severity: 'exact_match' as const,
  version: '534F4B.303132',
}
const review = {
  candidateIds: [7],
  candidateVersions: [{ id: 7, version: match.version }],
  fingerprint: `v1|7@${match.version}`,
}
const check: ContactDuplicateCheck = {
  matches: [match],
  duplicateReview: review,
  allowedActions: ['use_existing', 'create_separate'],
}

test('only an allowed reviewed exact candidate becomes a create-separate decision', () => {
  assert.deepEqual(createSeparateContactDecision(check), { action: 'create_separate', ...review })
  assert.equal(createSeparateContactDecision({ ...check, allowedActions: ['use_existing'] }), null)
})

test('structured duplicate review survives the legacy nested api error shape', () => {
  const error = { code: 'contact_duplicate_decision_required', duplicate: { ...match, ...check } }
  assert.deepEqual(readContactDuplicateDecisionError(error), check)
  assert.deepEqual(normalizeContactDuplicateCheck(check), check)
  assert.equal(readContactDuplicateDecisionError({ code: 'contact_duplicate_decision_required', duplicate: match }), null)
})

test('a duplicate write error carries a local-only sync occurrence without changing the server decision wire', () => {
  const syncProblem = {
    errorId: 'failure-17',
    channel: 'customers:create',
    code: 'contact_duplicate_decision_required',
  }
  const parsed = readContactDuplicateDecisionError({
    code: syncProblem.code,
    syncErrorId: syncProblem.errorId,
    syncErrorChannel: syncProblem.channel,
    duplicate: { ...match, ...check },
  })
  assert.deepEqual(parsed?.syncProblem, syncProblem)
  assert.deepEqual(parsed?.matches[0].syncProblem, syncProblem)
  assert.deepEqual(createSeparateContactDecision(parsed!), { action: 'create_separate', ...review })
})

test('live form checks include every secondary option phone and never send a boolean confirmation', () => {
  const hook = read('../src/components/contacts/useContactDuplicateFlag.ts')
  const customer = read('../src/components/contacts/CustomerFormModal.tsx')
  const supplier = read('../src/components/contacts/SuppliersTab.tsx')
  const delivery = read('../src/components/contacts/DeliveryTab.tsx')
  for (const [label, source] of [['customer', customer], ['supplier', supplier], ['delivery', delivery]] as const) {
    assert.match(source, /options\.map\(\(option\) => option\.phone\)/, `${label} live check includes secondary phones`)
    assert.match(source, /duplicateDecision/, `${label} sends an explicit decision`)
    assert.doesNotMatch(source, /confirmDuplicate/, `${label} does not authorize by boolean`)
  }
  assert.match(hook, /phones: string\[\]/)
  assert.match(hook, /checkContactDuplicate\(table, \{ name: trimmedName, phones: trimmedPhones, excludeId \}\)/)
})

test('full contact forms return structured duplicate review and open only a fetched exact record', () => {
  const customers = read('../src/components/contacts/CustomersTab.tsx')
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  const delivery = read('../src/components/contacts/DeliveryTab.tsx')
  for (const source of [customers, suppliers, delivery]) {
    assert.match(source, /return \{ duplicateDecisionRequired: duplicateCheck \}/)
    assert.match(source, /handleUseExisting/)
    assert.match(source, /if \(!existing\) throw new Error/)
  }
})

test('POS never auto-retries or fabricates an existing contact and exposes every candidate choice', () => {
  const pos = read('../src/components/pos/POS.tsx')
  const modals = read('../src/components/pos/POSQuickAddModals.tsx')
  const shell = read('../src/components/pos/QuickAddModal.tsx')
  assert.doesNotMatch(pos, /handleAddCustomer\(true\)|handleAddDelivery\(true\)|confirmDuplicate/)
  assert.doesNotMatch(pos, /\|\| \{ id: dup\.id/)
  assert.match(pos, /loadPosCustomersByIds\(\[match\.id\]\)/)
  assert.match(pos, /loadPosDeliveryContactsByIds\(\[match\.id\]\)/)
  assert.match(modals, /check\.matches\.map\(\(match\) =>/)
  assert.match(modals, /check\.allowedActions\.includes\('create_separate'\)/)
  assert.match(modals, /saveDisabled=\{!!customerDuplicateCheck\}/)
  assert.match(modals, /saveDisabled=\{!!deliveryDuplicateCheck\}/)
  assert.match(shell, /disabled=\{saving \|\| saveDisabled\}/)
})

test('the Worker response cannot trigger an older cached POS auto-retry or auto-select branch', () => {
  const route = read('../../cloudflare/src/routes/contacts.ts')
  assert.match(route, /code: 'contact_duplicate_decision_required'/)
  assert.doesNotMatch(route, /code: 'possible_duplicate'/)
  assert.doesNotMatch(route, /code: 'phone_conflict'/)
  assert.doesNotMatch(route, /body\.confirmDuplicate/)
})

// ---- P3-9: a same-name supplier is a decision, not a silent create -------

test('a name-only supplier duplicate can be answered with create-separate', () => {
  const nameOnlyMatch = { ...match, matchedPhone: null, severity: 'name_only' as const }
  const nameOnlyCheck: ContactDuplicateCheck = {
    matches: [nameOnlyMatch],
    duplicateReview: review,
    allowedActions: ['use_existing', 'create_separate'],
  }
  assert.deepEqual(createSeparateContactDecision(nameOnlyCheck), { action: 'create_separate', ...review },
    'the server now offers both choices for a name-only match, so the form can echo the review')
})

test('the supplier form asks for a decision on ANY blocking match, not just an exact one', () => {
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  assert.match(suppliers, /const decisionMatch = duplicateMatches\.find\(\(match\) => match\.severity !== 'phone_conflict'\)/,
    'a same-name supplier must reach the confirm dialog -- otherwise the 409 loops forever')
  assert.match(suppliers, /setPendingDuplicateCheck\(decisionMatch \? activeDuplicateCheck : null\)/)
  assert.doesNotMatch(suppliers, /const exactMatch = duplicateMatches\.find/, 'the exact-only gate is gone')
  assert.match(suppliers, /contact_duplicate_same_name_message/, 'and the dialog says what the duplicate actually is')
})

test('only replays of an already-confirmed write carry allow_duplicate_name', () => {
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  assert.equal((suppliers.match(/allow_duplicate_name: true/g) || []).length, 2,
    'buildSupplierPayload (undo/redo) and the bulk restore -- and nothing else')
  const commit = suppliers.slice(suppliers.indexOf('const commitSupplier'), suppliers.indexOf('const commitSupplier') + 1200)
  assert.doesNotMatch(commit, /allow_duplicate_name/, 'the Add/Edit form itself must face the prompt')
})

test('customers and delivery keep their advisory name-only banner', () => {
  const banner = read('../src/components/contacts/DuplicateFlagBanner.tsx')
  assert.match(banner, /name_only:/, 'a name-only match is still shown, on every contact table')
  for (const file of ['../src/components/contacts/CustomerFormModal.tsx', '../src/components/contacts/DeliveryTab.tsx']) {
    assert.doesNotMatch(read(file), /allow_duplicate_name/, `${file} needs no escape hatch -- its name-only matches are not gated`)
  }
})

test('all duplicate-decision copy is available in both languages', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, unknown>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, unknown>
  for (const key of [
    'contact_duplicate_decision_title',
    'contact_duplicate_possible_message',
    'contact_duplicate_phone_conflict_message',
    'contact_duplicate_use_existing',
    'contact_duplicate_create_separately',
    'contact_duplicate_back_to_edit',
    'contact_duplicate_review_changed',
    'contact_duplicate_existing_load_failed',
    'contact_duplicate_existing_choices',
    'contact_duplicate_same_name_message',
  ]) {
    assert.equal(typeof en[key], 'string', `English ${key}`)
    assert.equal(typeof km[key], 'string', `Khmer ${key}`)
  }
})

if (failed) process.exit(1)
