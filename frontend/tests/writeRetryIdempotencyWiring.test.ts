import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// SCAN1 F2 / F5 / O13 (28 Sep 2026): the surfaces that double-applied a write
// when the operator retried after a UI timeout that the POST outlived.
// tests/writeIntentIdentity.test.ts proves the helpers by behaviour; this file
// pins that each surface actually routes its write through them:
//   * the request identity comes from identityForIntent (one per intent),
//     never minted inline per press (the plausible wrong fix: an id minted in
//     the payload literal changes on every retry, exactly like no id at all);
//   * the identity is dropped only after the write committed;
//   * the timer is withWriteTimeout, translated, so a timeout says "outcome
//     unknown, check before retrying" instead of "Please try again";
//   * Inventory's undo/redo send their OWN stable ids: inheriting the forward
//     adjust's id would make the Worker answer 409 (same id, different body)
//     or replay the forward adjust instead of reversing it.

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

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  assert.ok(from >= 0, `missing anchor ${start}`)
  const to = text.indexOf(end, from + start.length)
  assert.ok(to > from, `missing end anchor ${end}`)
  return text.slice(from, to)
}

const customerReturn = source('components/returns/NewReturnModal.tsx')
const supplierReturn = source('components/returns/NewSupplierReturnModal.tsx')
const loyalty = source('components/loyalty-points/LoyaltyPointsPage.tsx')
const contactWrites = source('api/contactWriteTransport.ts')
const inventory = source('components/inventory/Inventory.tsx')
const stockImport = source('components/products/import/StockActionImportModal.tsx')

runTest('legacy customer return: one id AND one return number per intent, unknown-outcome timeout', () => {
  const submit = between(customerReturn, 'const handleSubmit = async () => {', '\n  const STEPS: ModalStep[]')
  // The Worker's digest covers return_number too (canonicalReturnCreateIntent),
  // so the retry must resend BOTH or it is refused as a different return.
  assert.match(submit, /identityForIntent\(legacyReturnIdentityRef, legacyReturnIntent, \(\) => \(\{\n\s+client_request_id: createClientRequestId\('return'\),\n\s+return_number: `RET-\$\{businessDateTimeId\(\)\}`,\n\s+\}\)\)/)
  assert.match(submit, /createReturnRequest\(\{ \.\.\.legacyReturnIntent, \.\.\.legacyReturnIdentity \}\)/)
  assert.match(submit, /withWriteTimeout\(\n\s+\(\) => createReturnRequest/)
  assert.doesNotMatch(submit, /withLoaderTimeout\(/, 'the create is a write: its timeout must not say "try again"')
  assert.match(submit, /RETURN_CREATE_TIMEOUT_MS,\n\s+\(key: string\) => T\(key, ''\),/)
  const reset = submit.indexOf('legacyReturnIdentityRef.current = null')
  assert.ok(reset > submit.indexOf('createReturnRequest('), 'the identity is dropped only after the create answered')
  assert.ok(reset < submit.indexOf('} catch (error) {'), 'a failed or unknown attempt keeps its identity for the retry')
  assert.match(customerReturn, /const legacyReturnIdentityRef = useRef<IntentIdentityRef<\{ client_request_id: string; return_number: string \}>\['current'\]>\(null\)/)
})

runTest('supplier return: one id per intent (the Worker dedupes by id alone), unknown-outcome timeout', () => {
  const submit = between(supplierReturn, 'const submit = async () => {', '\n  // Backdrop/X close')
  assert.match(submit, /identityForIntent\(supplierReturnIdentityRef, supplierReturnIntent, \(\) => \(\{\n\s+client_request_id: createClientRequestId\('supplier_return'\),\n\s+return_number: `SRET-\$\{businessDateTimeId\(\)\}`,\n\s+\}\)\)/)
  assert.match(submit, /withWriteTimeout\(\n\s+\(\) => createSupplierReturnRequest\(\{ \.\.\.supplierReturnIntent, \.\.\.supplierReturnIdentity \}\)/)
  assert.doesNotMatch(submit, /withLoaderTimeout\(/)
  assert.match(submit, /SUPPLIER_RETURN_CREATE_TIMEOUT_MS,\n\s+\(key: string\) => tr\(key, ''\),/)
  const reset = submit.indexOf('supplierReturnIdentityRef.current = null')
  assert.ok(reset > submit.indexOf('await Promise.resolve(onSuccess?.(result))'), 'kept until the parent accepted the result, so a retry after a parent failure replays')
  assert.ok(reset < submit.indexOf('} catch (error) {'))
})

runTest('loyalty add: one id per intent reaches the Worker, unknown-outcome timeout', () => {
  const award = between(loyalty, 'async function handleAwardPoints(): Promise<void> {', '\n  return (')
  assert.match(award, /identityForIntent\(awardIdentityRef, \{ customerId, points, note \}, \(\) => createClientRequestId\('loyalty_points'\)\)/)
  assert.match(award, /awardCustomerPoints\(customerId, \{ points, note, client_request_id: awardRequestId \}\)/)
  assert.match(award, /withWriteTimeout\(\n\s+\(\) => awardCustomerPoints/)
  assert.doesNotMatch(award, /withLoaderTimeout\(/)
  assert.match(award, /LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\n\s+\(key: string\) => t\?\.\(key\),/)
  const reset = award.indexOf('awardIdentityRef.current = null')
  assert.ok(reset > award.indexOf('awardCustomerPoints(') && reset < award.indexOf('} catch (error) {'))
  // The transport keeps a supplied id (buildContactWritePayload) instead of minting per call.
  assert.match(contactWrites, /export function awardCustomerPoints\(id: number \| string, payload: \{ points: number; note\?: string; client_request_id\?: string \}\)/)
})

runTest('inventory adjust: every adjust carries an intent-stable id; undo/redo carry their own', () => {
  const handle = between(inventory, 'const adjustmentIntent = {', '\n    if (adjustForm.type === \'remove\') {')
  assert.match(handle, /client_request_id: identityForIntent\(adjustIdentityRef, adjustmentIntent, \(\) => createClientRequestId\(scopedSet \? 'stock-set' : 'stockadjust'\)\)/)
  assert.doesNotMatch(between(handle, 'const adjustmentIntent = {', '\n    }\n'), /client_request_id/, 'the intent (what the id is keyed on) must not contain the id itself')
  const commit = between(inventory, 'const commitAdjust = async () => {', '\n  // The compact "what\'s about to happen" review rows')
  assert.match(commit, /const undoRequestId = retryableRequestId\('stockadjust-undo'\)/)
  assert.match(commit, /const redoRequestId = retryableRequestId\('stockadjust-redo'\)/)
  const undo = between(commit, 'undo: async () => {', 'redo: async () => {')
  assert.match(undo, /const undoBase = \{ \.\.\.adjustmentRequest, attribution: 'correction' as const, client_request_id: undoRequestId\.current\(\) \}/)
  assert.ok(undo.indexOf('undoRequestId.settle()') > undo.indexOf('await load(true)'), 'rotate only after the whole undo succeeded, or a retry after a failed reload would apply it twice')
  const redo = between(commit, 'redo: async () => {', '\n        })')
  assert.match(redo, /client_request_id: redoRequestId\.current\(\)/)
  assert.ok(redo.indexOf('redoRequestId.settle()') > redo.indexOf('await load(true)'))
  assert.ok(commit.indexOf('adjustIdentityRef.current = null') > commit.indexOf("'Adjust inventory stock'"), 'a committed adjust forgets its identity')
  assert.match(inventory, /withWriteTimeout\(loader, label, INVENTORY_STOCK_MUTATION_TIMEOUT_MS, \(key: string\) => tr\(key, ''\)\)/)
  const open = between(inventory, 'const openAdjust = (p: InventoryProduct) => {', 'setAdjustModal(p)')
  assert.match(open, /adjustIdentityRef\.current = null/, 'a fresh modal opening is a fresh intent')
})

runTest('stock-action import: a retry resumes the job it already created instead of creating a second', () => {
  const run = between(stockImport, 'const handleImport = async () => {', '\n  if (reviewJob && !canViewCosts)')
  assert.match(run, /let pending = pendingJobRef\.current/)
  assert.match(run, /if \(pending && pending\.intent !== intent\) \{\n\s+await cancelImportJob\(pending\.id\)/, 'a different sheet cancels the orphan first (approve refuses a cancelled job)')
  assert.match(run, /if \(!pending\) \{\n\s+const created = unwrapImportJob\(await createImportJob\(\{/, 'a job is created only when none is pending')
  assert.equal(run.split('createImportJob(').length - 1, 1, 'exactly one create call, inside the !pending branch')
  assert.match(run, /if \(!pending\.uploaded\) \{\n\s+await uploadImportJobCsv\(/, 'a retry does not re-upload into a job that already has the file')
  assert.ok(run.indexOf('pendingJobRef.current = null') > run.indexOf('await startImportJob(pending.id)'), 'released only once the job started')
  assert.match(stockImport, /import \{ createImportJob, uploadImportJobCsv, startImportJob, cancelImportJob \} from '\.\.\/\.\.\/\.\.\/api\/importJobsTransport\.ts'/)
  assert.match(stockImport, /const orphan = pendingJobRef\.current\n\s+pendingJobRef\.current = null\n\s+if \(orphan\) void cancelImportJob\(orphan\.id\)\.catch\(\(\) => \{\}\)/, 'closing the modal cancels a job that never started')
})

if (failed) {
  console.error(`${failed} write retry idempotency wiring test(s) failed`)
  process.exit(1)
}
console.log('write retry idempotency wiring: all cases pass')
