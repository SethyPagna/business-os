import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// P4-4b item 6: CustomersTab.tsx's handleSave used to call
// load({ silent: true }) unconditionally after every save -- a full
// re-search of the current filtered/sorted/paginated page (with its
// loyalty-points/portal-account joins) just to reflect one row changing.
// updateCustomer's PUT response already IS the updated row
// (`SELECT * FROM customers WHERE id = @id`, routes/contacts.ts), so an
// edit now patches it into `customers` state directly instead. A create's
// correct position on that same server-sorted/paginated list can't be
// derived from the response alone, so creates still take the full load()
// (same "patch only when the target position is already known" rule
// tests/productStockAdjustPatchNotRefetch.test.ts pins for Products.tsx).
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the project's existing style, plus a direct unit test
// of the extracted patchCustomerRow merge/fallback logic (which needs no
// DOM to exercise for real).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const source = readFileSync(resolve(frontendRoot, 'src/components/contacts/CustomersTab.tsx'), 'utf8')

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

runTest('patchCustomerRow exists and merges the write response over the existing row', () => {
  assert.match(source, /function patchCustomerRow\(rows: CustomerRow\[\], id: number \| string, patch: Record<string, unknown>\): CustomerRow\[\] \| null \{/)
  assert.match(source, /return \{ \.\.\.row, \.\.\.patch \}/, 'the response must be spread OVER the existing row so computed-only fields (points/portal_account) survive')
})

runTest('an edit patches the row in place instead of unconditionally reloading', () => {
  assert.match(source, /if \(selected && result && typeof result === 'object'\) \{\s*const patched = patchCustomerRow\(customers, selected\.id, result as Record<string, unknown>\)/, 'the edit branch must call patchCustomerRow with the write response')
  assert.match(source, /if \(patched\) \{\s*setCustomers\(patched\)\s*\} else \{\s*await load\(\{ silent: true, label: 'Customers after save' \}\)\s*\}/, 'a successful patch must replace the full load(); an unmatched id must still fall back to it')
})

runTest('a create still runs the full load (its list position cannot be inferred locally)', () => {
  // The else-branch (falls when `selected` is falsy, i.e. a create) must
  // still call the full load(), since a brand-new row's correct
  // page/sort slot on a server-paged list can't be derived from the POST
  // response alone.
  const editIfIndex = source.indexOf("if (selected && result && typeof result === 'object')")
  const tail = source.slice(editIfIndex, editIfIndex + 700)
  assert.match(tail, /\} else \{\s*await load\(\{ silent: true, label: 'Customers after save' \}\)\s*\}/, 'the create path (selected falsy) must still call the full load()')
})

// Direct unit test of the merge/fallback semantics themselves (extracted
// verbatim via source, executed for real -- not just pattern-matched).
runTest('patchCustomerRow (executed): merges write response, preserves computed fields, and returns null on no match', () => {
  const start = source.indexOf('function patchCustomerRow')
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
  const patchCustomerRow = new Function(`${js}; return patchCustomerRow;`)()

  const rows = [
    { id: 1, name: 'Old Name', points_balance: 40, portal_account: { membershipId: 'M1', createdAt: null } },
    { id: 2, name: 'Someone Else', points_balance: 0, portal_account: null },
  ]
  const patched = patchCustomerRow(rows, 1, { id: 1, name: 'New Name', phone: '012 345 678' })
  assert.ok(patched, 'a matching id must return a patched array, not null')
  assert.equal(patched![0].name, 'New Name', 'the write response fields win')
  assert.equal(patched![0].phone, '012 345 678')
  assert.equal(patched![0].points_balance, 40, 'points_balance (absent from the write response) must survive from the previously-loaded row')
  assert.deepEqual(patched![0].portal_account, { membershipId: 'M1', createdAt: null }, 'portal_account (absent from the write response) must survive too')
  assert.equal(patched![1].name, 'Someone Else', 'other rows are untouched')

  const noMatch = patchCustomerRow(rows, 999, { id: 999, name: 'Nowhere' })
  assert.equal(noMatch, null, 'an id not present in the currently-loaded page must signal the caller to fall back to a full load')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All customerRowPatchNotRefetch tests passed')
}
