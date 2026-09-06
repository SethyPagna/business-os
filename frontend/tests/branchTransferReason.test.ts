// The Branches transfer modal is the OTHER surface that moves stock between
// branches, and it is the one that had no reason at all.
//
// Inventory.tsx refuses its own transfer without a reason
// (`transfer_reason_required`), and POST /inventory/transfer, /move-row,
// /branches/transfer and /branches/transfer-bulk now all refuse one too
// (cloudflare/scripts/test-inventory-transfer-reason-pure.cjs). TransferModal
// sat between them sending an OPTIONAL `note` -- so the same business rule
// was enforced on one surface and absent on its sibling, and once the Worker
// guard landed this modal would have started 400ing every transfer instead.
// Frontend validation with a backend half, and a backend guard with the
// frontend half that keeps it from firing: this is the parity test for both
// directions.
//
// What is exercised here:
//   1. The field is a REASON, required, in both the single and the bulk
//      layout -- labelled with the pack key, not the "(Optional)" note label
//      it replaced.
//   2. Every write path refuses an empty reason through ONE shared check,
//      and refuses it BEFORE the request (or before parking the confirm) --
//      the entire-branch path included, which is the one that moves the most
//      stock in a single gesture.
//   3. The payload carries `reason`, not `note`, on both endpoints, and the
//      modal's own API contract types say so.
//   4. The English the Worker refuses with is byte-identical to the pack key
//      this modal shows, so a refusal that outruns the UI is still readable.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.message : error)
  }
}

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const modal = read('../src/components/branches/TransferModal.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// One handler's body: from its declaration to the start of the next
// top-level `const ` binding in the component, so "this handler guards" can
// never be satisfied by a check that lives in a different one.
const handlerBody = (name: string): string => {
  const start = modal.indexOf(`  const ${name} = `)
  assert.ok(start > 0, `TransferModal must still declare ${name}`)
  const end = modal.indexOf('\n  const ', start + 10)
  return modal.slice(start, end === -1 ? modal.length : end)
}

runTest('both packs carry the reason label and the refusal, in real Khmer', () => {
  for (const key of ['transfer_reason', 'transfer_reason_required']) {
    assert.ok(en[key], `en.json must carry ${key}`)
    assert.ok(km[key], `km.json must carry ${key}`)
    assert.notEqual(km[key], en[key], `${key} must actually be translated, not the English copied over`)
  }
})

runTest('the transfer reason field is labelled a required reason on both layouts', () => {
  // The single-product panel and the multi-select panel are two separate
  // blocks of JSX; a reason added to one and missed on the other is exactly
  // the sibling gap this test exists for.
  for (const id of ['transfer-reason', 'transfer-reason-multi']) {
    assert.ok(modal.includes(`id="${id}"`), `TransferModal needs the ${id} field`)
  }
  assert.equal(
    (modal.match(/t\('transfer_reason'\)/g) || []).length,
    2,
    'both layouts must label the field with the transfer_reason pack key',
  )
  assert.equal(
    (modal.match(/t\('required'\)/g) || []).length,
    2,
    'both layouts must mark the reason required',
  )
  assert.doesNotMatch(modal, /t\('transfer_note'\)/, 'the optional "Note" label must be gone -- the field is a required reason now')
  assert.doesNotMatch(modal, /id="transfer-note/, 'the optional note inputs must be gone, not left beside the reason')
})

runTest('one shared check refuses an empty reason', () => {
  assert.match(
    modal,
    /const requireTransferReason = \(\): boolean => \{[\s\S]*?if \(reason\.trim\(\)\) return true[\s\S]*?transfer_reason_required[\s\S]*?return false/,
    'the reason check must exist once, notify with the pack key, and refuse',
  )
  assert.equal(
    (modal.match(/transfer_reason_required/g) || []).length,
    1,
    'the refusal must be raised from exactly one place, not repeated per handler',
  )
})

runTest('every write path runs the check before it writes or parks a confirm', () => {
  const paths: Array<{ handler: string; commit: string }> = [
    // The single-product transfer: refuse before the POST.
    { handler: 'handleTransfer', commit: 'transferStock({' },
    // The checked-rows transfer and the whole-branch transfer both park a
    // confirm that runPendingTransfer then writes; refuse before the confirm
    // so the operator is not asked to approve a transfer that cannot run.
    { handler: 'handleBulkTransfer', commit: 'setPendingTransfer(' },
    { handler: 'handleTransferEntireBranch', commit: 'setPendingTransfer(' },
  ]
  for (const { handler, commit } of paths) {
    const body = handlerBody(handler)
    const guardAt = body.indexOf('if (!requireTransferReason()) return')
    assert.ok(guardAt > 0, `${handler} must run the shared reason check`)
    const commitAt = body.indexOf(commit)
    assert.ok(commitAt > 0, `${handler} must still reach ${commit}`)
    assert.ok(guardAt < commitAt, `${handler}: the reason check must run before ${commit}`)
  }
})

runTest('both endpoints receive `reason`, never the legacy `note`', () => {
  const single = handlerBody('handleTransfer')
  const bulk = handlerBody('runPendingTransfer')
  assert.match(single, /transferStock\(\{[\s\S]*?\n\s*reason,\n/, 'the single transfer payload must send reason')
  assert.match(bulk, /transferStockBulk\(\{[\s\S]*?\n\s*reason,\n/, 'the bulk transfer payload must send reason')
  assert.doesNotMatch(single, /\n\s*note,\n/, 'the single transfer payload must not send note')
  assert.doesNotMatch(bulk, /\n\s*note,\n/, 'the bulk transfer payload must not send note')
  // The modal's own contract for the two transports, so a payload that
  // dropped the reason would not typecheck either.
  assert.match(
    modal,
    /transferStock: \(payload: \{[\s\S]*?reason: string[\s\S]*?\}\) => Promise<TransferResult>/,
    'the transferStock contract must require a reason',
  )
  assert.match(
    modal,
    /transferStockBulk: \(payload: \{[\s\S]*?reason: string[\s\S]*?\}\) => Promise<TransferBulkResult>/,
    'the transferStockBulk contract must require a reason',
  )
})

runTest('the Worker refuses with the exact English this modal shows', () => {
  // The same convention branchRuleErrors.ts documents for the two
  // branch-role refusals: the Worker's sentence IS a pack key's English.
  // Pinned so the two halves cannot drift. It is not yet WIRED -- this
  // sentence is absent from BRANCH_RULE_MESSAGE_KEYS, so a rejection that
  // outruns the UI still reads in English; the modal's own check is what
  // keeps an operator from seeing it.
  const routes = [
    read('../../cloudflare/src/routes/inventory.ts'),
    read('../../cloudflare/src/routes/branches.ts'),
  ].join('\n')
  const refusal = `if (!reason) return c.json({ error: '${en.transfer_reason_required}' }, 400)`
  assert.equal(
    routes.split(refusal).length - 1,
    4,
    'all four transfer/move routes must refuse with the exact English of transfer_reason_required',
  )
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll branch transfer reason tests passed')
