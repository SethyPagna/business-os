// P3-9: collapsing the supplier duplicates a hidden writer left in production,
// and closing the picker gap that let the same supplier be attributed two ways.
//
// Background (read-only sweep against production data): a since-removed
// `ensureSupplierExists()` in productWriteTransport.ts POSTed /api/suppliers on
// every product create/update whose supplier name was missing from the device's
// local cache. The Worker's duplicate gate lets `name_only` through, so a fresh
// same-name, phone-null row was inserted each time. Production carries "j
// secrat" x10 (ids 20, 38-46) and "lang" x6 (ids 23-37).
//
// Run: node tests/supplierDuplicateCollapse.test.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import {
  chooseBulkMergeKeeper,
  planBulkContactMerges,
  type ContactDuplicateCluster,
} from '../src/components/contacts/contactDuplicates.ts'

// node cannot import a .tsx module directly, and the picker's own imports
// (React, the suggestion input, the actor-read-scope helpers) are irrelevant to
// the pure name resolver under test -- so the file is compiled here and its
// module-level imports are stubbed. The resolver itself is the REAL production
// code, not a copy.
const nodeRequire = createRequire(import.meta.url)
function loadPickerExports(): Record<string, any> {
  const pickerSource = readFileSync(new URL('../src/components/shared/SupplierPickerField.tsx', import.meta.url), 'utf8')
  const compiled = transformSync(pickerSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => (id === 'react' || id.startsWith('react/') ? nodeRequire(id) : { __esModule: true, default: () => null }),
    mod,
    mod.exports,
  )
  return mod.exports
}
const { resolveSupplierByExactName } = loadPickerExports() as {
  resolveSupplierByExactName: (rows: Array<{ id: number; name: string }>, typed: string) => { id: number; name: string } | null
}

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const entry = (id: number, name: string, phone: string | null = null) => ({ id, name, phone, membershipNumber: null })
const cluster = (contacts: ReturnType<typeof entry>[]): ContactDuplicateCluster => ({
  type: 'name', value: contacts[0]?.name || '', severity: 'name_only', contacts,
})

// --- D1: bulk merge handles a cluster of any size ---------------------------

test('the production "j secrat" cluster of ten is planned, not skipped', () => {
  const jSecrat = cluster([20, 38, 39, 40, 41, 42, 43, 44, 45, 46].map((id) => entry(id, 'j secrat')))
  const [plan] = planBulkContactMerges([jSecrat])
  assert.ok(plan, 'a ten-member cluster must produce a plan -- the old two-only rule skipped it')
  assert.equal(plan.keeperId, 20, 'the oldest row survives when no member has a phone')
  assert.deepEqual(plan.loserIds, [38, 39, 40, 41, 42], 'the next five merge into it in one request, in id order')
  assert.deepEqual(plan.laterIds, [43, 44, 45, 46], 'one request carries six records; the rest merge on the next run')
})

test('the production "lang" cluster of six is planned the same way', () => {
  const lang = cluster([23, 27, 29, 31, 34, 37].map((id) => entry(id, 'lang')))
  const [plan] = planBulkContactMerges([lang])
  assert.equal(plan.keeperId, 23)
  assert.deepEqual(plan.loserIds, [27, 29, 31, 34, 37], 'six records fit one request')
  assert.deepEqual(plan.laterIds, [])
})

test('the one member with a phone survives, whatever its id', () => {
  const keeper = chooseBulkMergeKeeper([entry(20, 'j secrat'), entry(38, 'j secrat', '012 345 678'), entry(39, 'j secrat')])
  assert.equal(keeper?.id, 38, 'a row somebody actually typed a phone into is the real contact')
})

test('two phones is ambiguous, so the rule falls back to the oldest row', () => {
  const keeper = chooseBulkMergeKeeper([entry(20, 'lang', '011 1'), entry(38, 'lang', '012 2'), entry(39, 'lang')])
  assert.equal(keeper?.id, 20, 'no single phone-bearing row means no phone-based answer')
})

test('a two-member cluster still merges the younger into the older', () => {
  const [plan] = planBulkContactMerges([cluster([entry(38, 'acme'), entry(20, 'acme')])])
  assert.equal(plan.keeperId, 20)
  assert.deepEqual(plan.loserIds, [38])
})

test('a cluster with nothing to merge produces no plan', () => {
  assert.deepEqual(planBulkContactMerges([cluster([entry(20, 'solo')])]), [], 'one member is not a merge')
  assert.equal(chooseBulkMergeKeeper([]), null)
})

test('mixed selections plan every cluster, not just the small ones', () => {
  const plans = planBulkContactMerges([
    cluster([entry(20, 'j secrat'), entry(38, 'j secrat'), entry(39, 'j secrat')]),
    cluster([entry(50, 'acme'), entry(51, 'acme')]),
  ])
  assert.equal(plans.length, 2, 'the 3-way must not be dropped beside the 2-way')
  assert.deepEqual(plans.map((plan) => plan.loserIds.length), [2, 1])
})

// The panel must actually use the planner -- a pure function nobody calls would
// pass every assertion above while Bulk Merge still skipped the big clusters.
const duplicatesTab = readFileSync(new URL('../src/components/contacts/DuplicatesTab.tsx', import.meta.url), 'utf8')
test('DuplicatesTab drives Bulk Merge from the planner', () => {
  assert.match(duplicatesTab, /planBulkContactMerges\(targets\)/, 'bulk merge must plan every selected cluster')
  assert.doesNotMatch(duplicatesTab, /cluster\.contacts\.length === 2/, 'the two-only filter is gone')
  assert.match(
    duplicatesTab,
    /mergeContacts\(table, contactMergeRequest\(plan\.cluster, plan\.keeperId, plan\.loserIds\)\)/,
    'every loser in a cluster is merged by one request, not just one',
  )
  assert.doesNotMatch(duplicatesTab, /for \(const loserId of plan\.loserIds\)/, 'no request per record')
})

// --- D2: no hidden writer may post a supplier contact again -----------------

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
const sourceFiles = walk(srcRoot)

/** Source with comments removed, so prose about the old bug is not the bug. */
const codeOnly = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

test('the only POST to the supplier-contact endpoint is the shared write transport', () => {
  const offenders: string[] = []
  for (const file of sourceFiles) {
    const text = codeOnly(readFileSync(file, 'utf8'))
    for (const match of text.matchAll(/apiFetch\(\s*['"`]POST['"`]\s*,\s*['"`]\/api\/suppliers['"`]/g)) {
      offenders.push(`${file.slice(srcRoot.length + 1).replace(/\\/g, '/')} @${match.index}`)
    }
    assert.doesNotMatch(text, /ensureSupplierExists/, `${file}: the hidden supplier writer must stay removed`)
  }
  // createContact() in contactWriteTransport builds the endpoint from its
  // arguments, so even that one does not match a literal POST '/api/suppliers'.
  assert.deepEqual(offenders, [], 'a supplier contact is only ever created through createSupplier()')
})

test('createSupplier() is only reached from the Contacts Suppliers tab', () => {
  const callers = sourceFiles
    .filter((file) => /createSupplier\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(srcRoot.length + 1).replace(/\\/g, '/'))
    .filter((file) => !file.startsWith('api/'))
    .sort()
  assert.deepEqual(
    callers,
    ['components/contacts/SuppliersTab.tsx'],
    'a supplier row may only be created by the user-initiated Add form (and its undo/redo replays)',
  )
})

test('positive control: the sweep can see a call it is meant to catch', () => {
  const sample = "await apiFetch('POST', '/api/suppliers', { name })"
  assert.equal([...sample.matchAll(/apiFetch\(\s*['"`]POST['"`]\s*,\s*['"`]\/api\/suppliers['"`]/g)].length, 1)
})

// --- D3: typing an existing supplier's exact name resolves its id -----------

const loaded = [{ id: 20, name: 'j secrat' }, { id: 47, name: 'Acme Supply' }, { id: 48, name: 'lang' }]

test('an exactly typed name resolves to the existing contact', () => {
  assert.equal(resolveSupplierByExactName(loaded, 'Acme Supply')?.id, 47)
})

test('case and stray whitespace do not break the match', () => {
  assert.equal(resolveSupplierByExactName(loaded, '  acme   supply ')?.id, 47)
  assert.equal(resolveSupplierByExactName(loaded, 'J SECRAT')?.id, 20)
})

test('a name that matches nothing stays name-only', () => {
  assert.equal(resolveSupplierByExactName(loaded, 'Somebody New'), null)
  assert.equal(resolveSupplierByExactName(loaded, '   '), null)
  assert.equal(resolveSupplierByExactName([], 'Acme Supply'), null, 'nothing resolves before the list loads')
})

test('a partial name does not resolve -- only an exact one does', () => {
  assert.equal(resolveSupplierByExactName(loaded, 'Acme'), null)
  assert.equal(resolveSupplierByExactName(loaded, 'Acme Supply Co'), null)
})

test('an ambiguous name resolves to nothing rather than picking a duplicate', () => {
  const withCluster = [...loaded, { id: 38, name: 'j secrat' }, { id: 39, name: 'J Secrat' }]
  assert.equal(
    resolveSupplierByExactName(withCluster, 'j secrat'),
    null,
    'while the cluster exists there is no single right id, so the attribution stays name-only',
  )
})

const picker = readFileSync(new URL('../src/components/shared/SupplierPickerField.tsx', import.meta.url), 'utf8')
test('the picker resolves the typed name instead of always dropping the id', () => {
  assert.match(picker, /resolveSupplierByExactName\(resolvable, next\)/, 'typing must go through the resolver')
  assert.doesNotMatch(picker, /else onChange\(\{ supplierId: null, supplierName: next \}\)/, 'the unconditional drop is gone')
  assert.match(picker, /supplierId: resolved \? resolved\.id : null/, 'an unresolved name is still recorded by name only')
})

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
console.log('PASS supplier duplicate clusters collapse in bulk, no hidden writer remains, and the picker resolves typed names')
