// UI-STOCK S1: "add stock ... shows title add stock but it is in set stock".
// The fast_stockin draft is one key for every host and mode; the old float let
// the draft's mode beat the mode the caller asked for, so a leftover Set draft
// turned "Add Stock" into a Set float. The mode is now resolved once: a draft
// that holds Items is that session and keeps its mode; otherwise the caller's
// mode wins. The pristine snapshot uses the same resolved mode.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  emptyStockSessionDraft,
  modeSwitchBlocked,
  normalizeStockSessionDraft,
  openingDraft,
  resolveOpeningMode,
  sessionSteps,
} from '../src/utils/stockSessionDraft.ts'

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

let minted = 0
const mint = (): string => `stockline_mode_${++minted}`
const src = (relative: string): string => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

const queuedLine = { key: 'a', requestId: 'r1', product: { id: 1, name: 'A' }, productName: 'A', mode: 'set', quantity: 3, batchChoice: 5, batchLabel: '29/09/2026', reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '' }

runTest('S1: a leftover draft with no Items never overrides the mode the caller asked for', () => {
  const leftover = normalizeStockSessionDraft({ mode: 'set', branchId: '1', receivedDate: '2026-09-30', supplier: { supplierId: null, supplierName: '' }, paymentStatus: 'paid', creditDueDate: '', query: 'sk', picked: { id: 1, name: 'A' }, quantity: '30', lines: [] }, mint)!
  assert.equal(resolveOpeningMode(leftover, 'add'), 'add', 'the old float opened this in Set')
  const opened = openingDraft(leftover, 'add')
  assert.equal(opened.mode, 'add')
  assert.equal(opened.picked, null, 'a Set target typed for another mode is not carried into Add')
  assert.equal(opened.quantity, '1')
  assert.equal(opened.branchId, '1', 'shared details stay')
  assert.equal(opened.batchChoice, 'new')
})

runTest('a draft that holds Items opens in its own mode, whatever the caller asked', () => {
  const session = normalizeStockSessionDraft({ mode: 'set', branchId: '1', lines: [queuedLine] }, mint)!
  assert.equal(resolveOpeningMode(session, 'add'), 'set')
  assert.equal(openingDraft(session, 'add'), session, 'nothing in a live session is dropped')
})

runTest('no draft: the caller mode, else Add', () => {
  assert.equal(resolveOpeningMode(null, 'remove'), 'remove')
  assert.equal(resolveOpeningMode(null, undefined), 'add')
  assert.equal(resolveOpeningMode(emptyStockSessionDraft({ sessionId: 1, mode: 'set', branchId: '1', receivedDate: '2026-09-30' }), null), 'add')
})

runTest('mode is session-level: switching waits while Items holds a line', () => {
  assert.equal(modeSwitchBlocked([]), false)
  assert.equal(modeSwitchBlocked([queuedLine]), true)
  assert.deepEqual(sessionSteps('add', []), ['items', 'payment', 'review'])
  assert.deepEqual(sessionSteps('remove', []), ['items', 'review'])
  assert.deepEqual(sessionSteps('set', []), ['items', 'review'])
})

runTest('a v1 draft (before the Stock Session) still loads, lines keep their mode and gain ids', () => {
  const v1 = normalizeStockSessionDraft({
    sessionId: 1759200000000,
    branchId: '2', receivedDate: '2026-09-29', supplier: { supplierId: 4, supplierName: 'Bong Long' },
    paymentStatus: 'credit', creditDueDate: '2026-10-10', query: '', picked: null, quantity: '1', unitCost: '', freeGoods: false,
    createPriceVariant: false, expiryDate: '', reason: '', batchChoice: 'new',
    lines: [
      { key: 'x', product: { id: 9, name: 'Old add' }, productName: 'Old add', quantity: 2, unitCost: '1.5', freeGoods: false, createPriceVariant: false, expiryDate: '', batchChoice: 'new', batchLabel: 'New', status: 'saving', detail: '' },
      { key: 'y', requestId: 'kept', product: { id: 10, name: 'Old remove' }, productName: 'Old remove', mode: 'remove', quantity: 1, unitCost: '', freeGoods: false, expiryDate: '', batchChoice: 3, batchLabel: '01/09/2026', status: 'error', detail: 'Only 0 available' },
    ],
  }, mint)!
  assert.equal(v1.version, 2)
  assert.equal(v1.mode, 'add', 'the first line decides a v1 draft that never stored a mode')
  assert.equal(v1.lines[0].mode, 'add', 'a pre-mode line is an add, never a change')
  assert.ok(v1.lines[0].requestId.startsWith('stockline_mode_'), 'an id-less line is given one')
  assert.equal(v1.lines[1].requestId, 'kept', 'an existing id is never regenerated')
  assert.equal(v1.lines[0].status, 'queued', 'a line caught mid-save was never answered')
  assert.equal(v1.lines[1].mode, 'remove')
  assert.equal(v1.lines[1].freeQuantity, 0)
  assert.equal(v1.paymentStatus, 'credit')
  assert.equal(v1.supplier.supplierName, 'Bong Long')
})

runTest('the float resolves the mode once and seeds state AND the pristine snapshot from it', () => {
  const modal = src('components/inventory/FastStockInModal.tsx')
  assert.match(modal, /resolveOpeningMode\(|openingDraft\(/, 'the float must use the shared resolver')
  assert.doesNotMatch(modal, /draft\?\.mode \|\| initialMode/, 'the draft mode must never beat the caller silently')
  assert.doesNotMatch(modal, /mode: initialMode \|\| 'add'/, 'the pristine snapshot must not use a different mode than the state')
  assert.match(modal, /modeSwitchBlocked\(/, 'the header disables the other modes from the same rule')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock session mode-opening test(s) failed`)
} else {
  console.log('\nAll stock session mode-opening tests passed')
}
