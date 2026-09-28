// U-transfer2 Finding 2 (26 Sep 2026): a saved transfer draft plus a failed
// received-date load left the operator with no way to submit.
//
// The branch TransferModal saves the chosen received date per ticked row
// (selectedLots) into its draft. Reopening the draft reloads each row's lots.
// When that load failed, the row showed "Automatic (FIFO)" with its selector
// locked, but the restored lot id stayed in state, so every submit answered
// "Choose a received date first" -- and nothing could be chosen. The
// Inventory transfer form had the same stale id, hidden: it rode the wire as
// batchId although no received date was shown as selected.
//
// Contract now: a failed lot load falls back to Automatic by dropping that
// row's stale lot id, so submit sends a lot-less line (the Worker allocates it
// FIFO). A successful load keeps a lot it still offers.
//
// Run: node tests/transferLotLoadFailure.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

const modal = read('../src/components/branches/TransferModal.tsx')
const modalExports = {}
new Function('exports', 'require', compile(modal))(modalExports, (name) => (name.includes('batchLabel') ? { batchDisplayLabel: (lot) => lot.received_at } : {}))
const { selectedTransferLot, positiveTransferLots } = modalExports
assert.equal(typeof selectedTransferLot, 'function')
assert.equal(typeof positiveTransferLots, 'function')

// Pull one const/arrow or one useEffect callback out of a component source and
// evaluate it against a stub context.
function extractConst(source, start, end, context) {
  const from = source.indexOf(start)
  assert.ok(from > 0, `missing ${start}`)
  const to = source.indexOf(end, from)
  assert.ok(to > from, `missing the end of ${start}`)
  const name = start.match(/const (\w+)/)[1]
  return new Function(...Object.keys(context), compile(`${source.slice(from, to)}; return ${name}`))(...Object.values(context))
}
function extractEffect(source, anchor, deps, context) {
  const from = source.indexOf('useEffect(() => {', source.indexOf(anchor))
  assert.ok(source.indexOf(anchor) > 0 && from > 0, `missing the effect after ${anchor}`)
  const to = source.indexOf(`}, ${deps})`, from)
  assert.ok(to > from, `missing the effect deps ${deps}`)
  const callback = source.slice(from + 'useEffect('.length, to + 1)
  return new Function(...Object.keys(context), compile(`return (${callback})`))(...Object.values(context))
}

const lot = (id, quantity, received_at = '2026-09-03') => ({ id, quantity, received_at, is_active: 1 })
const tea = { id: 7, name: 'Tea', unit: 'pcs', branch_quantity: 12 }
const rice = { id: 8, name: 'Rice', unit: 'kg', branch_quantity: 9 }

async function runModalScenario({ draftLots, loads }) {
  // The restored draft: both rows ticked at source 1, each with a received date.
  const state = { rowLots: {}, selectedLots: { ...draftLots } }
  const selectedQuantities = { 7: '12', 8: '4' }
  const effect = extractEffect(modal, 'const selectedLotProducts =', '[fromBranch, selectedLotProducts]', {
    fromBranch: '1', selectedQuantities, rowLots: state.rowLots,
    withLoaderTimeout: (loader) => loader(), TRANSFER_STOCK_LOAD_TIMEOUT_MS: 12000,
    getProductBatches: (productId, branchId) => {
      assert.equal(branchId, 1, 'lots are loaded for the current source')
      const outcome = loads[productId]
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ batches: outcome })
    },
    lotBranchRef: { current: '1' }, positiveTransferLots,
    setRowLots: (update) => { state.rowLots = typeof update === 'function' ? update(state.rowLots) : update },
    setSelectedLots: (update) => { state.selectedLots = typeof update === 'function' ? update(state.selectedLots) : update },
    getErrorMessage: (error, fallback) => (error instanceof Error ? error.message : fallback),
    t: (key) => key,
  })
  effect()
  await flush()

  // Submit through the real bulk handler, then the real write path, and read
  // the request body that would be posted to /api/branches/transfer-bulk.
  let pending
  let notice
  const finiteStockAvailable = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0)
  extractConst(modal, 'const handleBulkTransfer =', '  /**\n   * The one write path', {
    savedRun: null, savingBulk: false, retryStorageError: '', fromBranch: '1', toBranch: '2',
    requireCanonicalTransferDirection: () => true, requireTransferReason: () => true,
    selectedEntries: Object.entries(selectedQuantities), multiProducts: [tea, rice], finiteStockAvailable,
    invalidQuantityText: 'quantity', t: (key) => key, notify: (value) => { notice = value },
    rowLots: state.rowLots, selectedLots: state.selectedLots, selectedTransferLot,
    buildPendingTransfer: (scope, items) => ({ scope, items }), setPendingTransfer: (value) => { pending = value },
  })()
  let posted
  if (pending) {
    const runPendingTransfer = extractConst(modal, 'const runPendingTransfer = async', '\n  return createPortal(', {
      canTransferStock: true, retryStorageError: '', savedRun: null,
      requireTransferReason: () => true, requireCanonicalTransferDirection: () => true,
      beginSingleAction: () => true, finishSingleAction: () => {}, transferBulkInFlightRef: { current: false }, savingBulk: false,
      setSavingBulk: () => {}, fromBranch: '1', toBranch: '2', reason: 'Restock shop', TRANSFER_BULK_CHUNK_SIZE: 100,
      user: { id: 5, name: 'Dara' },
      prepareTransferRun: (actorId, requests) => ({ actorId: String(actorId), next: 0, transferred: 0, merges: 0, requests }),
      saveTransferRun: () => {}, setSavedRun: () => {}, setPendingTransfer: () => {}, setRetryError: () => {}, setChunkProgress: () => {},
      executeTransferRun: async (run, checkpoint, send) => {
        await send(run.requests[0])
        return { ...run, next: 1, transferred: 1 }
      },
      transferStockBulkRequest: async (body) => { posted = body; return { success: true } },
      transferStockRequest: async () => { throw new Error('the checked rows go through /transfer-bulk') },
      aliveRef: { current: true }, transferAuthorityRef: { current: { allowed: true, actorId: '5' } },
      completeTransferDraft: () => {}, draftKey: 'draft', draftFinishedRef: { current: false },
      notify: () => {}, onDone: () => {}, localizeBranchRuleError: (text) => text,
      getErrorMessage: (error, fallback) => (error instanceof Error ? error.message : fallback), t: (key) => key,
    })
    await runPendingTransfer(pending)
  }
  return { state, pending, notice, posted }
}

async function main() {
  // 1. The exact dead end: draft lot 71 on Tea, Tea's lot load fails. Rice's
  //    load succeeds and still offers its drafted lot 81.
  const failed = await runModalScenario({
    draftLots: { 7: 71, 8: 81 },
    loads: { 7: new Error('Failed to fetch'), 8: [lot(81, 6)] },
  })
  assert.equal(failed.state.rowLots[7]?.error, 'Failed to fetch', 'the failed row records its error')
  assert.deepEqual(failed.state.selectedLots, { 8: 81 },
    'the failed row falls back to Automatic; only its own stale lot is dropped')
  assert.equal(failed.notice, undefined, `submit is not refused (notice: ${failed.notice})`)
  assert.deepEqual(failed.pending?.items, [{ productId: 7, quantity: 12 }, { productId: 8, quantity: 4, batchId: 81 }],
    'Tea arms lot-less, Rice keeps the lot its successful load still offers')
  assert.deepEqual(failed.posted?.items, [{ productId: 7, quantity: 12 }, { productId: 8, quantity: 4, batchId: 81 }],
    'the posted /transfer-bulk body carries Tea with no batchId (never null or 0)')
  assert.equal('batchId' in failed.posted.items[0], false)

  // 2. Control: a successful load that still offers the drafted lot keeps it.
  const kept = await runModalScenario({ draftLots: { 7: 71 }, loads: { 7: [lot(71, 12)], 8: [] } })
  assert.deepEqual(kept.state.selectedLots, { 7: 71 }, 'a lot the source still offers is kept')
  assert.deepEqual(kept.posted?.items?.[0], { productId: 7, quantity: 12, batchId: 71 })

  // 3. Control: a successful load that no longer offers it falls back too.
  const gone = await runModalScenario({ draftLots: { 7: 71 }, loads: { 7: [lot(72, 12)], 8: [] } })
  assert.deepEqual(gone.state.selectedLots, {}, 'a lot the source no longer offers is dropped')
  assert.deepEqual(gone.posted?.items?.[0], { productId: 7, quantity: 12 })

  // 4. Inventory transfer form: the same fallback for its hidden batch_id.
  const modals = read('../src/components/inventory/InventoryStockModals.tsx')
  async function runInventoryLoad(outcome, form) {
    const state = { form: { ...form }, options: null }
    const effect = extractEffect(modals, 'const transferSourceId = transferForm.from_branch_id', '[transferProductId, transferSourceId]', {
      transferProductId: 7, transferSourceId: '1',
      setTransferBatchOptions: (value) => { state.options = value },
      setTransferBatchesLoading: () => {},
      getProductBatches: () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ batches: outcome })),
      setTransferForm: (update) => { state.form = typeof update === 'function' ? update(state.form) : update },
      console: { error: () => {} },
    })
    effect()
    await flush()
    return state
  }
  const draftedForm = { from_branch_id: '1', to_branch_id: '2', quantity: '5', reason: 'Restock shop', batch_id: 71, batch_quantity: 5 }
  const inventoryFailed = await runInventoryLoad(new Error('Failed to fetch'), draftedForm)
  assert.deepEqual(inventoryFailed.options, [], 'no received date is offered after a failed load')
  assert.equal(inventoryFailed.form.batch_id, '', 'the hidden drafted lot is dropped: Automatic is what the form shows')
  assert.equal(inventoryFailed.form.batch_quantity, '')
  const inventoryKept = await runInventoryLoad([lot(71, 5)], draftedForm)
  assert.equal(inventoryKept.form.batch_id, 71, 'control: a lot the source still offers is kept')
  const untouched = { ...draftedForm, batch_id: '', batch_quantity: '' }
  const inventoryAutomatic = await runInventoryLoad(new Error('Failed to fetch'), untouched)
  assert.deepEqual(inventoryAutomatic.form, untouched, 'an Automatic form is left as it is')

  // ...and the Inventory submit handler then posts batchId null (Worker FIFO).
  const inventory = read('../src/components/inventory/Inventory.tsx')
  const handlerStart = inventory.indexOf('const handleTransferStock = async () => {')
  const handlerEnd = inventory.indexOf('\n  }\n', inventory.indexOf("runInventoryTransferIntent('submit'", handlerStart))
  assert.ok(handlerStart > 0 && handlerEnd > handlerStart, 'found the Inventory transfer submit handler')
  const handlerSource = `${inventory.slice(handlerStart, handlerEnd + '\n  }'.length)}; return handleTransferStock`
  async function submitInventory(form) {
    let body
    let asked = 0
    const notices = []
    const context = {
      transferSaving: false, pendingTransfer: null, transferRetryReady: true, canTransferStock: true,
      transferModal: { id: 7, name: 'Tea', branch_stock: [{ branch_id: 1, quantity: 12 }, { branch_id: 2, quantity: 0 }] },
      transferForm: form, tr: (key, fallback) => fallback, notify: (message) => { notices.push(message) },
      branchesById: new Map([['1', { id: 1, name: 'Warehouse' }], ['2', { id: 2, name: 'Shop' }]]),
      branches: [{ id: 1, name: 'Warehouse' }, { id: 2, name: 'Shop' }],
      branchCanTransferBetween: () => true, branchCanBeTransferSource: () => true,
      // FX-ui: the review is the shared dialog (askToConfirm), not window.confirm.
      askToConfirm: async () => { asked += 1; return true }, user: { id: 5, name: 'Dara' },
      runInventoryTransferIntent: async (kind, original) => { body = original },
    }
    await new Function(...Object.keys(context), compile(handlerSource))(...Object.values(context))()
    if (body) assert.equal(asked, 1, 'the transfer is reviewed once before it posts')
    return { body, notices }
  }
  const afterFailure = await submitInventory(inventoryFailed.form)
  assert.deepEqual(afterFailure.notices, [], `the Inventory submit is not refused (${afterFailure.notices.join(' | ')})`)
  assert.equal(afterFailure.body?.batchId, null, 'the Inventory transfer goes out lot-less after a failed lot load')
  const withLot = await submitInventory(inventoryKept.form)
  assert.equal(withLot.body?.batchId, 71, 'control: a kept lot still rides the Inventory transfer')

  console.log('PASS a failed received-date load falls back to Automatic: TransferModal draft and Inventory form submit lot-less; kept lots still ride')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
