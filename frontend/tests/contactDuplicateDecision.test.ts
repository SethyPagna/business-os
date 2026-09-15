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

// ---- P4-2: a same-name supplier merges directly, never a prompt ----------
//
// Owner ruling (2026-09-15): "for supplier prevent this issue from happening
// just merge directly if same." This supersedes P3-9's decision-required
// prompt above (2deb30ec) for suppliers only -- customers and delivery
// contacts keep the advisory-only banner, unchanged (see the test below).

test('the supplier form no longer asks for a decision on a same-name match', () => {
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  assert.doesNotMatch(suppliers, /setPendingDuplicateCheck/, 'no pending-decision state -- the server resolves silently')
  assert.doesNotMatch(suppliers, /const decisionMatch = duplicateMatches\.find/, 'no decision gate before submit')
  assert.match(suppliers, /const existingNameMatch = duplicateMatches\.find\(\(match\) => match\.severity !== 'phone_conflict'\)/,
    'the worst non-phone-conflict match is still read, but only to show which record saving will use')
  assert.match(suppliers, /contact_duplicate_will_use_existing/, 'the note tells the user saving will use the existing record, not ask them to choose')
})

test('allow_duplicate_name and create-separate plumbing are fully gone from the supplier form', () => {
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  assert.doesNotMatch(suppliers, /allow_duplicate_name/, 'the server never offers a create-separate escape hatch for suppliers anymore')
  assert.doesNotMatch(suppliers, /createSeparateContactDecision/, 'suppliers never send a create_separate decision')
  assert.doesNotMatch(suppliers, /duplicateDecision: /, 'the supplier submit path sends no client-chosen decision at all')
})

test('the supplier banner tells the user saving will use the existing record, and hides the choice buttons', () => {
  const banner = read('../src/components/contacts/DuplicateFlagBanner.tsx')
  assert.match(banner, /autoResolves/, 'the banner knows some callers auto-resolve instead of prompting')
  assert.match(banner, /contact_duplicate_will_use_existing/)
  const suppliers = read('../src/components/contacts/SuppliersTab.tsx')
  assert.match(suppliers, /<DuplicateFlagBanner matches=\{duplicateMatches\} entityLabel="supplier" autoResolves onUseExisting=\{onUseExisting\} t=\{t\} \/>/,
    'the supplier tab passes autoResolves; customers/delivery do not (checked below)')
})

test('customers and delivery keep their advisory name-only banner and never auto-resolve', () => {
  const banner = read('../src/components/contacts/DuplicateFlagBanner.tsx')
  assert.match(banner, /name_only:/, 'a name-only match is still shown, on every contact table')
  for (const file of ['../src/components/contacts/CustomerFormModal.tsx', '../src/components/contacts/DeliveryTab.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /allow_duplicate_name/, `${file} needs no escape hatch -- its name-only matches are not gated`)
    assert.doesNotMatch(source, /autoResolves/, `${file} still prompts -- P4-2 is suppliers-only`)
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
    'contact_duplicate_will_use_existing',
  ]) {
    assert.equal(typeof en[key], 'string', `English ${key}`)
    assert.equal(typeof km[key], 'string', `Khmer ${key}`)
  }
})

if (failed) process.exit(1)
