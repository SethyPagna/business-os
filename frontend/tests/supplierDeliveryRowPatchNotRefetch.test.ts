import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// P4-4b item 6 (parity): the sibling-surface gap flagged when
// tests/customerRowPatchNotRefetch.test.ts landed -- SuppliersTab.tsx:911
// and DeliveryTab.tsx:918 called the same unconditional
// load({ silent: true }) after every save that CustomersTab.tsx used to.
// Both now patch the edit's PUT response into their loaded row array in
// place (patchSupplierRow / patchDeliveryContact), falling back to the
// full load() when the id isn't on the currently-loaded page, and still
// taking the full load() on create (a new row's page/sort slot can't be
// derived from the response alone) -- exactly the scoping
// tests/customerRowPatchNotRefetch.test.ts already pins for
// CustomersTab.tsx's patchCustomerRow.
//
// SuppliersTab.tsx has one extra wrinkle CustomersTab/DeliveryTab don't:
// a rename with the "copy" choice keeps `selected` truthy but actually
// creates a DIFFERENT new row than the one selected, so that path must
// still fall through to the full load() like a genuine create does --
// this is pinned explicitly below (the gate is `useUpdate`, not `selected`).
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the same style as customerRowPatchNotRefetch.test.ts,
// plus direct unit tests of the extracted merge/fallback functions
// (executed for real, not just pattern-matched).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

function extractFunction(source: string, name: string): (...args: any[]) => unknown {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `function ${name} must exist`)
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  let end = bodyStart
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break } }
  }
  const fnSource = source.slice(start, end)
  const js = ts.transpileModule(fnSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return ${name};`)()
}

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const suppliers = readFrontend('src/components/contacts/SuppliersTab.tsx')
const delivery = readFrontend('src/components/contacts/DeliveryTab.tsx')

runTest('SuppliersTab: patchSupplierRow exists and merges the write response over the existing row', () => {
  assert.match(suppliers, /function patchSupplierRow\(rows: SupplierRow\[\], id: number \| string, patch: Record<string, unknown>\): SupplierRow\[\] \| null \{/)
  assert.match(suppliers, /return \{ \.\.\.row, \.\.\.patch \}/)
})

runTest('SuppliersTab: an update patches in place, gated on useUpdate (not just `selected`)', () => {
  assert.match(suppliers, /if \(useUpdate && result && typeof result === 'object'\) \{\s*const patched = patchSupplierRow\(suppliers, \(selected as \{ id: number \| string \}\)\.id, result as Record<string, unknown>\)/, 'the patch call must gate on useUpdate so a rename-copy (selected truthy, but a NEW row was created) still falls through to the full load()')
  assert.match(suppliers, /if \(patched\) \{\s*setSuppliers\(patched\)\s*\} else \{\s*await load\(\{ silent: true, label: 'Suppliers after save' \}\)\s*\}/)
})

runTest('SuppliersTab: create (and rename-copy) still runs the full load', () => {
  const gateIndex = suppliers.indexOf("if (useUpdate && result && typeof result === 'object')")
  const tail = suppliers.slice(gateIndex, gateIndex + 700)
  assert.match(tail, /\} else \{\s*await load\(\{ silent: true, label: 'Suppliers after save' \}\)\s*\}/)
})

runTest('SuppliersTab: patchSupplierRow (executed): merges, preserves other rows, returns null on no match', () => {
  const patchSupplierRow = extractFunction(suppliers, 'patchSupplierRow')
  const rows = [
    { id: 1, name: 'Old Supplier', phone: '011' },
    { id: 2, name: 'Other Supplier' },
  ]
  const patched = patchSupplierRow(rows, 1, { id: 1, name: 'New Supplier', phone: '012' }) as any[]
  assert.ok(patched)
  assert.equal(patched[0].name, 'New Supplier')
  assert.equal(patched[0].phone, '012')
  assert.equal(patched[1].name, 'Other Supplier')
  assert.equal(patchSupplierRow(rows, 999, { id: 999 }), null)
})

runTest('DeliveryTab: patchDeliveryContact exists and merges the write response over the existing row', () => {
  assert.match(delivery, /function patchDeliveryContact\(rows: DeliveryContact\[\], id: number \| string, patch: Record<string, unknown>\): DeliveryContact\[\] \| null \{/)
  assert.match(delivery, /return \{ \.\.\.row, \.\.\.patch \}/)
})

runTest('DeliveryTab: an edit patches in place instead of unconditionally reloading', () => {
  assert.match(delivery, /if \(selected && res && typeof res === 'object'\) \{\s*const patched = patchDeliveryContact\(contacts, selected\.id, res as Record<string, unknown>\)/)
  assert.match(delivery, /if \(patched\) \{\s*setContacts\(patched\)\s*\} else \{\s*await load\(\{ silent: true, label: 'Delivery contacts after save' \}\)\s*\}/)
})

runTest('DeliveryTab: create still runs the full load', () => {
  const gateIndex = delivery.indexOf("if (selected && res && typeof res === 'object')")
  const tail = delivery.slice(gateIndex, gateIndex + 700)
  assert.match(tail, /\} else \{\s*await load\(\{ silent: true, label: 'Delivery contacts after save' \}\)\s*\}/)
})

runTest('DeliveryTab: patchDeliveryContact (executed): merges, preserves other rows, returns null on no match', () => {
  const patchDeliveryContact = extractFunction(delivery, 'patchDeliveryContact')
  const rows = [
    { id: 5, name: 'Old Driver', area: 'North' },
    { id: 6, name: 'Other Driver' },
  ]
  const patched = patchDeliveryContact(rows, 5, { id: 5, name: 'New Driver', area: 'South' }) as any[]
  assert.ok(patched)
  assert.equal(patched[0].name, 'New Driver')
  assert.equal(patched[0].area, 'South')
  assert.equal(patched[1].name, 'Other Driver')
  assert.equal(patchDeliveryContact(rows, 999, { id: 999 }), null)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All supplierDeliveryRowPatchNotRefetch tests passed')
}
