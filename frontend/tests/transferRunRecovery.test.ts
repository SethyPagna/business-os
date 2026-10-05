// U-transfer3 (refuter R-transfer2 F1, 27 Sep 2026): a saved transfer run the
// server REFUSED for good locked the transfer form forever.
//
// A client: "transfer stock isn't working, tried to edit the number selected
// etc... but couldn't". The Branch TransferModal saves a transfer run before
// its first request and cleared it ONLY on success; while a run was saved the
// whole form was disabled and the only action was Retry. A 400 insufficient
// stock / 404 lot gone / 409 refusal answers the same on every Retry, so that
// operator could never edit the numbers or send another transfer. Inventory's
// transfer had the same lock.
//
// Contract now, per saved run:
//   refused (definitive 4xx)  -> Edit restores every untransferred line into
//                                the form and clears the run; Discard clears it
//                                through the shared review dialog.
//   unknown (network/5xx/...)  -> Retry-only lock stays; Discard exists but only
//                                through the review dialog, which warns the
//                                transfer may already have been applied.
//   a refusal record never survives a later dispatch, so a reply lost on a
//   Retry is never mistaken for a refusal (Edit would send it again under a
//   NEW key: a double transfer).
//
// Run: node tests/transferRunRecovery.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { ensureClientRequestId } from '../src/api/requestIds.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const compile = (code: string) => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
function load(path: string, resolve: (id: string) => unknown): any {
  const compiled = { exports: {} as any }
  new Function('exports', 'require', 'module', compile(read(path)))(compiled.exports, (id: string) => {
    const found = resolve(id)
    if (!found) throw new Error(`Unexpected import ${id}`)
    return found
  }, compiled)
  return compiled.exports
}

const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))
const rules = load('../src/api/branchRuleErrors.ts', () => null)
const branchTransport = load('../src/api/branchTransport.ts', (id) => ({
  './http.ts': { route: (_key: string, online: () => unknown) => online(), apiFetch: async () => ({ success: true }) },
  './query.ts': {},
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_name: 'test' }) },
  './requestIds.ts': { ensureClientRequestId },
  '../utils/syncProblemLifecycle.ts': { dispatchResolvedSyncError: () => {} },
} as Record<string, unknown>)[id])
const refusal = load('../src/api/transferRunRefusal.ts', (id) => (id === './branchRuleErrors.ts' ? rules : null))
const recovery = load('../src/api/transferRunRecovery.ts', (id) => (
  id === './branchTransport.ts' ? branchTransport : id === './transferRunRefusal.ts' ? refusal : null))
const { prepareTransferRun, saveTransferRun, loadTransferRun } = branchTransport
const { transferRefusalFromError, isRefusedTransferRun, transferRunEditState, localizeTransferRefusal, inventoryTransferEditForm } = refusal

function store() {
  const rows = new Map<string, string>()
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, code: null }, extra)

// R-transfer3: only the codes the transfer routes emit AFTER finding no
// idempotency receipt prove nothing was applied (the allowlist in
// api/transferRunRefusal.ts, pinned to the route sources by
// cloudflare/scripts/test-transfer-refusal-after-receipt-pure.cjs).
const coded = (status: number, code: string, message = code) => httpError(status, message, { code })
test('only an allowlisted post-receipt refusal is definitive; everything else is an unknown result', () => {
  const refused = [
    coded(400, 'transfer_insufficient_stock', 'Insufficient stock in source branch'),
    coded(404, 'transfer_product_missing', 'Product not found'),
    coded(404, 'transfer_lot_missing', 'Received date not found for this product'),
    coded(400, 'transfer_direction_invalid', 'Transfers must go between the Shop and the Warehouse'),
    coded(409, 'canonical_branch_configuration_invalid'),
    coded(409, 'transfer_selected_lot_short', 'The selected received date no longer has enough stock.'),
    coded(409, 'transfer_stock_changed', 'The products or stock in this transfer changed while it was being saved. Nothing was moved. Refresh and try again.'),
    coded(409, 'transfer_too_many_lots'),
  ]
  for (const error of refused) assert.ok(transferRefusalFromError(error), `${(error as any).status} ${(error as any).code} is a refusal`)
  assert.deepEqual([...refusal.DEFINITIVE_TRANSFER_REFUSAL_CODES].sort(), refused.map((error) => (error as any).code).sort(), 'every allowlisted code is covered above')
  const unknown = [
    // Answered BEFORE the receipt lookup: says nothing about an earlier send.
    httpError(403, 'You do not have permission to perform this action'),
    httpError(403, 'Transferring stock requires Full Access to Branches -- Partial Access support for this action is not built.'),
    httpError(400, 'Could not read request body.', { code: 'request_body_unreadable' }),
    httpError(409, 'Refresh the app before transferring stock.', { code: 'client_upgrade_required' }),
    httpError(400, 'Missing required fields'),
    httpError(400, 'An existing received date must be selected.', { code: 'invalid_batch_id' }),
    // An older Worker's uncoded refusals: not provable, so locked (the base behaviour).
    httpError(400, 'Insufficient stock in source branch'),
    httpError(404, 'Product not found'),
    httpError(413, 'Payload too large'),
    httpError(408, 'Request timeout'),
    Object.assign(new Error('Request timed out after 90s'), { code: 'request_timeout', outcome: 'unknown' }),
    Object.assign(new Error('Failed to fetch'), { code: 'write_outcome_unknown', outcome: 'unknown' }),
    httpError(500, 'Something went wrong', { outcome: 'unknown' }),
    httpError(503, 'Maintenance is in progress. No stock was transferred; try again shortly.', { code: 'maintenance_active' }),
    httpError(503, 'An app upgrade is in progress. Please try again shortly.', { code: 'release_upgrade_in_progress' }),
    httpError(401, 'Not authenticated', { code: 'invalid_session' }),
    httpError(403, 'Blocked by the edge', { code: 'edge_interference' }),
    httpError(429, 'Too many requests'),
    // Something IS recorded under this key: never offer to resend its lines.
    httpError(409, 'client_request_id was already used for different transfer data.', { code: 'idempotency_conflict' }),
    Object.assign(new Error('Server is offline.'), { code: 'write_requires_live_server' }),
    new Error('Lost reply'),
    null,
    // Mutant M4 (outcome check removed): an allowlisted code on an unknown outcome.
    Object.assign(coded(409, 'transfer_stock_changed', 'x'), { outcome: 'unknown' }),
    // Mutant M5 (5xx counted as a refusal): allowlisted codes on 5xx / other statuses.
    coded(500, 'transfer_stock_changed'),
    coded(503, 'transfer_insufficient_stock'),
    coded(403, 'transfer_product_missing'),
  ]
  for (const error of unknown) assert.equal(transferRefusalFromError(error), null, `${(error as any)?.status} ${(error as any)?.code} ${String((error as any)?.message)} is NOT a refusal`)
  assert.equal(transferRefusalFromError(Object.assign(coded(409, 'transfer_stock_changed'), { outcome: 'not_dispatched' })), null)
})

// The refuter's sequences (R-transfer3): the first send APPLIES and its reply
// is lost; the Retry is answered before the receipt lookup (403 after a
// permission revoke, or 400 request_body_unreadable). That answer must not
// unlock Edit; once the cause clears, Retry under the SAME key replays.
for (const [label, preReceiptAnswer] of [
  ['403 permission revoked', () => httpError(403, 'You do not have permission to perform this action')],
  ['400 request_body_unreadable', () => httpError(400, 'Could not read request body.', { code: 'request_body_unreadable' })],
] as const) {
  test(`R-transfer3: lost reply, then ${label} on Retry: no Edit, and stock moves once`, async () => {
    const storage = store()
    const server = { answerBeforeReceipt: false, receipts: new Set<string>(), moved: 0, loseReply: true }
    const send = async (request: any) => {
      if (server.answerBeforeReceipt) throw preReceiptAnswer()
      const key = request.body.client_request_id
      if (server.receipts.has(key)) return { success: true, transferredCount: 1, replayed: true }
      server.receipts.add(key); server.moved += Number(request.body.quantity)
      if (server.loseReply) { server.loseReply = false; throw Object.assign(new Error('Failed to fetch'), { outcome: 'unknown', code: 'write_outcome_unknown' }) }
      return { success: true, transferredCount: 1 }
    }
    const checkpoint = (next: unknown) => saveTransferRun(7, next, storage)
    const run = prepareTransferRun(7, [{ bulk: false, body: { productId: 11, fromBranchId: 1, toBranchId: 2, quantity: 5, reason: 'restock' } }])
    saveTransferRun(7, run, storage)
    await assert.rejects(recovery.executeTransferRun(run, checkpoint, send), /Failed to fetch/)
    assert.equal(server.moved, 5)
    server.answerBeforeReceipt = true
    await assert.rejects(recovery.executeTransferRun(loadTransferRun(7, storage), checkpoint, send))
    const saved = loadTransferRun(7, storage)
    assert.equal(isRefusedTransferRun(saved), false, `${label} on a Retry is not a refusal: Edit is not offered`)
    assert.equal(saved.refusal, undefined)
    assert.equal(saved.outcomeUnknown, true, 'the run is marked unknown for good')
    // The Discard dialog therefore shows the may-already-be-applied warning (refusedRun is null).
    server.answerBeforeReceipt = false
    const done = await recovery.executeTransferRun(saved, checkpoint, send)
    assert.equal(done.next, 1)
    assert.equal(server.moved, 5, 'EXPECTED moved=5: the Retry replayed the receipt under the same key')
  })
}

test('R-transfer3 (b): once a run had an unknown outcome, even a proving refusal never offers Edit again', async () => {
  const storage = store()
  const checkpoint = (next: unknown) => saveTransferRun(7, next, storage)
  const answers: Array<() => never> = [
    () => { throw Object.assign(new Error('Failed to fetch'), { outcome: 'unknown', code: 'write_outcome_unknown' }) },
    () => { throw coded(400, 'transfer_insufficient_stock', 'Insufficient stock in source branch') },
  ]
  const run = prepareTransferRun(7, [{ bulk: false, body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, reason: 'r' } }])
  saveTransferRun(7, run, storage)
  await assert.rejects(recovery.executeTransferRun(run, checkpoint, async () => answers[0]()))
  await assert.rejects(recovery.executeTransferRun(loadTransferRun(7, storage), checkpoint, async () => answers[1]()))
  const saved = loadTransferRun(7, storage)
  assert.equal(isRefusedTransferRun(saved), false, 'unknown is sticky')
  assert.equal(saved.outcomeUnknown, true)
  assert.equal(saved.refusal, undefined, 'no refusal is even recorded on a run that had an unknown outcome')
  // A tab closed mid-send: the run was saved as dispatched and nothing came back.
  const closed = { ...prepareTransferRun(8, [{ bulk: false, body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, reason: 'r' } }]), dispatched: true }
  const rows = store()
  saveTransferRun(8, closed, rows)
  await assert.rejects(recovery.executeTransferRun(closed, (next: unknown) => saveTransferRun(8, next, rows), async () => answers[1]()))
  assert.equal(isRefusedTransferRun(loadTransferRun(8, rows)), false, 'a send that died with the tab is an unknown result')
  // A fresh run refused on its first send IS editable.
  const fresh = prepareTransferRun(9, [{ bulk: false, body: { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, reason: 'r' } }])
  const freshRows = store()
  saveTransferRun(9, fresh, freshRows)
  await assert.rejects(recovery.executeTransferRun(fresh, (next: unknown) => saveTransferRun(9, next, freshRows), async () => answers[1]()))
  assert.equal(isRefusedTransferRun(loadTransferRun(9, freshRows)), true)
  // A run saved by the earlier build with a 403 recorded as a refusal is locked again.
  assert.equal(isRefusedTransferRun({ ...fresh, refusal: { status: 403, code: null, message: 'You do not have permission to perform this action' } }), false)
  assert.equal(isRefusedTransferRun({ ...fresh, refusal: { status: 400, code: null, message: 'Insufficient stock in source branch' } }), false)
  assert.equal(isRefusedTransferRun({ ...fresh, outcomeUnknown: true, refusal: { status: 400, code: 'transfer_insufficient_stock', message: 'x' } }), false)
})

test('the executor records a refusal and strips it before any re-dispatch (double-apply guard)', async () => {
  const storage = store()
  const stock = { from: 10, to: 0 }
  const receipts = new Map<string, string>()
  let mode: 'refuse' | 'apply-then-lose-reply' | 'apply' = 'refuse'
  let dispatches = 0
  const send = async (request: any) => {
    dispatches += 1
    const key = request.body.client_request_id
    if (mode === 'refuse') throw coded(400, 'transfer_insufficient_stock', 'Insufficient stock in source branch')
    if (!receipts.has(key)) { receipts.set(key, JSON.stringify(request.body)); stock.from -= 4; stock.to += 4 }
    if (mode === 'apply-then-lose-reply') { mode = 'apply'; throw Object.assign(new Error('Lost reply'), { outcome: 'unknown', code: 'write_outcome_unknown' }) }
    return { success: true, transferredCount: 1 }
  }
  const run = prepareTransferRun(7, [{ bulk: true, body: { fromBranchId: 1, toBranchId: 2, reason: 'restock', items: [{ productId: 5, quantity: 4 }] } }])
  saveTransferRun(7, run, storage)
  const checkpoint = (next: unknown) => saveTransferRun(7, next, storage)

  await assert.rejects(recovery.executeTransferRun(run, checkpoint, send), /Insufficient stock/)
  const refusedRun = loadTransferRun(7, storage)
  assert.ok(isRefusedTransferRun(refusedRun), 'the refusal is persisted on the saved run (survives a reload)')
  assert.equal(refusedRun.refusal.status, 400)
  assert.equal(refusedRun.next, 0)
  assert.deepEqual(stock, { from: 10, to: 0 }, 'a refusal moved nothing')

  // Retry of the refused run: the refusal is stripped and persisted BEFORE the
  // request goes out; this time it applies and the reply is lost.
  mode = 'apply-then-lose-reply'
  const seen: unknown[] = []
  await assert.rejects(recovery.executeTransferRun(refusedRun, (next: any) => { seen.push(next.refusal); checkpoint(next) }, send), /Lost reply/)
  assert.equal(seen[0], undefined, 'the first checkpoint (before dispatch) carries no refusal')
  const afterLostReply = loadTransferRun(7, storage)
  assert.equal(isRefusedTransferRun(afterLostReply), false, 'a lost reply after a refusal is an UNKNOWN result: Edit is not offered')
  assert.deepEqual(stock, { from: 6, to: 4 })

  // The only offered path is Retry under the SAME key: it replays, never re-applies.
  const done = await recovery.executeTransferRun(afterLostReply, checkpoint, send)
  assert.equal(done.next, 1)
  assert.deepEqual(stock, { from: 6, to: 4 }, 'applied exactly once across refuse -> lost reply -> retry')
  assert.equal(stock.from + stock.to, 10)
  assert.equal(dispatches, 3)
})

test('a refusal the storage cannot record still surfaces the server error unchanged', async () => {
  const run = prepareTransferRun(7, [{ bulk: false, body: { productId: 1, quantity: 1, fromBranchId: 1, toBranchId: 2, reason: 'r' } }])
  const error = coded(404, 'transfer_product_missing', 'Product not found')
  // The pre-dispatch checkpoint succeeds; recording the refusal afterwards fails.
  let checkpoints = 0
  await assert.rejects(recovery.executeTransferRun(run, () => { checkpoints += 1; if (checkpoints > 1) throw new Error('storage full') }, async () => { throw error }), (thrown: unknown) => thrown === error)
  assert.equal(checkpoints, 2)
})

test('a run whose pre-dispatch state cannot be saved sends nothing', async () => {
  let sent = 0
  const run = { ...prepareTransferRun(7, [{ bulk: false, body: { productId: 1, quantity: 1 } }]), refusal: { status: 400, code: null, message: 'x' } }
  await assert.rejects(recovery.executeTransferRun(run, () => { throw new Error('storage full') }, async () => { sent += 1; return {} }), /storage full/)
  assert.equal(sent, 0)
})

test('Edit restores every untransferred line, never a confirmed one', () => {
  // Three chunks; chunk 0 confirmed, chunk 1 refused.
  const run = {
    ...prepareTransferRun(7, [
      { bulk: true, body: { fromBranchId: 2, toBranchId: 1, reason: 'Restock shop', items: [{ productId: 1, quantity: 3 }] } },
      { bulk: true, body: { fromBranchId: 2, toBranchId: 1, reason: 'Restock shop', items: [{ productId: 7, quantity: 2.5, batchId: 71 }, { productId: 8, quantity: 4 }] } },
      { bulk: true, body: { fromBranchId: 2, toBranchId: 1, reason: 'Restock shop', items: [{ productId: 9, quantity: 0.3, batchId: 91 }] } },
    ]),
    next: 1, transferred: 1,
  }
  const state = transferRunEditState(run)
  assert.deepEqual(state, {
    fromBranch: '2', toBranch: '1', reason: 'Restock shop',
    selectedQuantities: { 7: '2.5', 8: '4', 9: '0.3' },
    selectedLots: { 7: 71, 9: 91 },
    lineCount: 3,
  })
  assert.ok(!('1' in state.selectedQuantities), 'the confirmed chunk is never restored (it would transfer twice)')
  // The single (non-bulk) request shape restores the same way.
  const single = transferRunEditState(prepareTransferRun(7, [{ bulk: false, body: { fromBranchId: 1, toBranchId: 2, productId: 4, quantity: 6, batchId: 44, reason: 'Move' } }]))
  assert.deepEqual(single.selectedQuantities, { 4: '6' })
  assert.deepEqual(single.selectedLots, { 4: 44 })
  // A product twice with different lots keeps its total and falls back to Automatic.
  const twice = transferRunEditState(prepareTransferRun(7, [
    { bulk: true, body: { fromBranchId: 1, toBranchId: 2, reason: 'r', items: [{ productId: 3, quantity: 0.1, batchId: 31 }] } },
    { bulk: true, body: { fromBranchId: 1, toBranchId: 2, reason: 'r', items: [{ productId: 3, quantity: 0.2, batchId: 32 }] } },
  ]))
  assert.deepEqual(twice.selectedQuantities, { 3: '0.3' })
  assert.deepEqual(twice.selectedLots, {})
  // Inventory's one-request run.
  assert.deepEqual(inventoryTransferEditForm(prepareTransferRun(7, [{ bulk: false, body: { productId: 12, fromBranchId: '2', toBranchId: '1', quantity: 2.5, reason: 'Shelf', batchId: 5 } }])), {
    productId: '12', from_branch_id: '2', to_branch_id: '1', quantity: 2.5, reason: 'Shelf', batch_id: 5, batch_quantity: '',
  })
})

test('the refusal reason is shown in the operator language, including plain-English 400/404s', () => {
  const tKm = (key: string) => km[key]
  for (const [message, key] of [
    ['Insufficient stock in source branch', 'transfer_refused_insufficient'],
    ['Product not found', 'transfer_refused_product_missing'],
    ['One or more selected products no longer exist', 'transfer_refused_product_missing'],
    ['Received date not found for product Tea', 'transfer_refused_lot_missing'],
    ['An existing received date must be selected.', 'transfer_refused_lot_missing'],
  ]) {
    assert.equal(localizeTransferRefusal({ status: 400, code: null, message }, tKm), km[key], message)
    assert.equal(localizeTransferRefusal({ status: 400, code: null, message }, (k: string) => en[k]), en[key], message)
  }
  assert.equal(localizeTransferRefusal({ status: 400, code: null, message: 'Insufficient stock for: Tea (need 5, have 3)' }, tKm),
    km.transfer_refused_insufficient_items.replace('{detail}', 'Tea (need 5, have 3)'))
  assert.equal(localizeTransferRefusal({ status: 409, code: 'transfer_selected_lot_short', message: en.transfer_selected_lot_short }, tKm), km.transfer_selected_lot_short)
  assert.equal(localizeTransferRefusal({ status: 400, code: null, message: 'Some new server sentence' }, tKm), 'Some new server sentence', 'unknown text is shown as sent')
  // Wording is independent of the Edit decision: an old Worker's uncoded 400 is
  // still translated for Inventory's banner, while it no longer unlocks Edit.
  assert.equal(refusal.localizeTransferError(httpError(400, 'Insufficient stock in source branch'), tKm), km.transfer_refused_insufficient)
  assert.equal(transferRefusalFromError(httpError(400, 'Insufficient stock in source branch')), null)
  assert.equal(refusal.localizeTransferError(null, tKm), '')
  for (const key of ['transfer_run_refused', 'transfer_run_refused_reason', 'transfer_run_refusal_label', 'transfer_run_edit', 'transfer_run_edit_hint',
    'transfer_run_discard_title', 'transfer_run_discard_refused', 'transfer_run_discard_unknown', 'transfer_refused_insufficient',
    'transfer_refused_insufficient_items', 'transfer_refused_product_missing', 'transfer_refused_lot_missing']) {
    assert.ok(en[key] && km[key] && en[key] !== km[key], `${key} exists in both packs and km is translated`)
    assert.match(km[key], /[ក-៿]/, `${key} is Khmer script`)
  }
})

// ---------------------------------------------------------------------------
// The Branch TransferModal itself: its real handlers and its real fieldset
// lock, evaluated against a stub component state.
const modal = read('../src/components/branches/TransferModal.tsx')
// Up to and including endMarker when it closes the block (the default); up
// to, excluding, a marker that is the NEXT declaration.
function slice(source: string, start: string, endMarker = '\n  }\n', include = endMarker === '\n  }\n'): string {
  const from = source.indexOf(start)
  assert.ok(from > 0, `source has ${start.trim()}`)
  const to = source.indexOf(endMarker, from)
  assert.ok(to > from, `the end of ${start.trim()}`)
  return source.slice(from, include ? to + endMarker.length : to)
}
const fieldsetExpression = modal.match(/<fieldset disabled=\{([^}]+)\}/)![1]
const refusedRunExpression = modal.match(/const refusedRun = ([^\n]+)/)?.[1]

function modalHarness(savedRun: any, storage = store()) {
  const state: Record<string, any> = {
    savedRun, retryError: 'Insufficient stock in source branch', retryStorageError: '', discardingRun: false,
    fromBranch: '', toBranch: '', reason: '', selectedQuantities: {}, selectedLots: {}, rowLots: { 7: { branch: '2', batches: [] } },
    stockReload: 0, showAllProducts: false, showSelectedOnly: false, pendingTransfer: null,
  }
  const setter = (key: string) => (value: unknown) => { state[key] = typeof value === 'function' ? (value as (current: unknown) => unknown)(state[key]) : value }
  const refs = { previousSourceRef: { current: '' }, multiProductsBranchRef: { current: '2' } }
  const notices: string[] = []
  const scope = () => ({
    savedRun: state.savedRun, saving: false, savingBulk: false, canTransferStock: true, retryStorageError: state.retryStorageError,
    user: { id: 7 }, t: (key: string) => en[key] || key, notify: (message: string) => { notices.push(message) },
    getErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
    saveTransferRun: (actorId: unknown, run: unknown) => saveTransferRun(actorId, run, storage),
    isRefusedTransferRun, transferRunEditState, ...refs,
    setFromBranch: setter('fromBranch'), setToBranch: setter('toBranch'), setReason: setter('reason'),
    setSelectedQuantities: setter('selectedQuantities'), setSelectedLots: setter('selectedLots'), setRowLots: setter('rowLots'),
    setStockReload: setter('stockReload'), setShowAllProducts: setter('showAllProducts'), setShowSelectedOnly: setter('showSelectedOnly'),
    setPendingTransfer: setter('pendingTransfer'), setRetryError: setter('retryError'), setSavedRun: setter('savedRun'),
    setDiscardingRun: setter('discardingRun'), setRetryStorageError: setter('retryStorageError'),
  })
  const run = (name: string) => {
    const context = scope()
    const handler = new Function(...Object.keys(context), compile(`${slice(modal, `  const ${name} = () => {`)}; return ${name}`))(...Object.values(context))
    handler()
  }
  const formDisabled = () => {
    const context = { saving: false, savingBulk: false, savedRun: state.savedRun, retryStorageError: state.retryStorageError, canTransferStock: true }
    return Boolean(new Function(...Object.keys(context), `return (${fieldsetExpression})`)(...Object.values(context)))
  }
  const editOffered = () => {
    assert.ok(refusedRunExpression, 'TransferModal derives refusedRun from the saved run')
    return !!new Function('savedRun', 'isRefusedTransferRun', `return (${refusedRunExpression})`)(state.savedRun, isRefusedTransferRun)
  }
  return { state, refs, run, formDisabled, editOffered, storage, notices }
}

function refusedBranchRun(storage: ReturnType<typeof store>) {
  const run = {
    ...prepareTransferRun(7, [
      { bulk: true, body: { fromBranchId: 2, toBranchId: 1, reason: 'Restock shop', items: [{ productId: 7, quantity: 12, batchId: 71 }, { productId: 8, quantity: 4 }] } },
    ]),
    dispatched: true,
    refusal: { status: 400, code: 'transfer_insufficient_stock', message: 'Insufficient stock in source branch' },
  }
  saveTransferRun(7, run, storage)
  return run
}

test('(a) a refused saved run no longer disables the form after Edit', () => {
  const storage = store()
  const h = modalHarness(refusedBranchRun(storage), storage)
  assert.equal(h.formDisabled(), true, 'while the refused run is saved the form is locked')
  assert.equal(h.editOffered(), true, 'Edit is offered for a refused run')
  h.run('editSavedTransfer')
  assert.equal(h.formDisabled(), false, 'after Edit the form is editable')
  assert.equal(loadTransferRun(7, storage), null, 'the saved run is cleared, so a reload does not lock it again')
  // (c) every line comes back: products, quantities, lots, source, destination, reason.
  assert.deepEqual(h.state.selectedQuantities, { 7: '12', 8: '4' })
  assert.deepEqual(h.state.selectedLots, { 7: 71 })
  assert.equal(h.state.fromBranch, '2')
  assert.equal(h.state.toBranch, '1')
  assert.equal(h.state.reason, 'Restock shop')
  assert.equal(h.state.retryError, '')
  // The source-change reset must not wipe the restored picks, and lots and
  // the catalog reload so a vanished received date falls back to Automatic.
  assert.equal(h.refs.previousSourceRef.current, '2')
  assert.equal(h.refs.multiProductsBranchRef.current, '')
  assert.deepEqual(h.state.rowLots, {})
  assert.equal(h.state.stockReload, 1)
  assert.match(modal, /const selectedLotProducts = `\$\{stockReload\}\|/, 'the lot load re-keys on the reload tick')
  assert.match(modal, /\}, \[debouncedSearch, fromBranch, mode, showAllProducts, stockReload\]\)/, 'the catalog load re-keys on the reload tick')
})

test('(a) a refused saved run no longer disables the form after Discard', () => {
  const storage = store()
  const h = modalHarness(refusedBranchRun(storage), storage)
  assert.equal(h.formDisabled(), true)
  h.run('discardSavedTransfer')
  assert.equal(h.formDisabled(), false)
  assert.equal(loadTransferRun(7, storage), null)
})

test('(b) an unknown-result run keeps the Retry lock and discards only through the confirm, with the warning', () => {
  const storage = store()
  const unknown = prepareTransferRun(7, [{ bulk: true, body: { fromBranchId: 2, toBranchId: 1, reason: 'Restock shop', items: [{ productId: 7, quantity: 12 }] } }])
  saveTransferRun(7, unknown, storage)
  const h = modalHarness(unknown, storage)
  assert.equal(h.editOffered(), false, 'no Edit for an unknown result')
  h.run('editSavedTransfer')
  assert.equal(h.state.savedRun, unknown, 'Edit refuses an unknown-result run')
  assert.ok(loadTransferRun(7, storage), 'and keeps its retry identity')
  assert.equal(h.formDisabled(), true, 'the Retry lock stays')
  // The banner's Discard button only opens the review dialog.
  const discardButtons = [...modal.matchAll(/onClick=\{([^}]*)\}>\{t\('discard'\)\}<\/button>/g)]
  assert.ok(discardButtons.length >= 1, 'the banner has a Discard button')
  for (const [, onClick] of discardButtons) assert.match(onClick, /^\(\) => setDiscardingRun\(true\)$/, 'Discard asks first; it never clears the run itself')
  assert.doesNotMatch(modal, /onClick=\{discardSavedTransfer\}/)
  // The dialog: warns for an unknown result, confirms into discardSavedTransfer.
  const dialog = slice(modal, '{discardingRun && (savedRun || retryStorageError) ? (', '\n      ) : null}', true)
  assert.match(dialog, /<ConfirmDialog/)
  assert.match(dialog, /onConfirm=\{discardSavedTransfer\}/)
  assert.match(dialog, /onClose=\{\(\) => setDiscardingRun\(false\)\}/)
  assert.match(dialog, /refusedRun\s*\?\s*\(t\('transfer_run_discard_refused'\)[\s\S]*:\s*\(t\('transfer_run_discard_unknown'\)/, 'an unknown result gets the may-already-be-applied warning')
  assert.match(en.transfer_run_discard_unknown, /may already have been applied/)
  assert.match(en.transfer_run_discard_unknown, /Stock Changes/)
  // Confirming does discard.
  h.run('discardSavedTransfer')
  assert.equal(h.state.savedRun, null)
  assert.equal(loadTransferRun(7, storage), null)
})

test('an unreadable saved run can be discarded too (it locked the form just as permanently)', () => {
  const storage = store()
  storage.setItem('businessos_pending_transfer_v1:7', '{"version":1,"broken":true}')
  assert.throws(() => loadTransferRun(7, storage), /cannot be read/)
  const h = modalHarness(null, storage)
  h.state.retryStorageError = 'The saved transfer cannot be read.'
  assert.equal(h.formDisabled(), true)
  h.run('discardSavedTransfer')
  assert.equal(h.state.retryStorageError, '')
  assert.equal(h.formDisabled(), false)
  assert.equal(storage.getItem('businessos_pending_transfer_v1:7'), null)
})

// ---------------------------------------------------------------------------
// Inventory: the same lock, on /inventory/transfer.
const inventory = read('../src/components/inventory/Inventory.tsx')

test('Inventory: a refused submit unlocks the open form; an unknown result keeps the lock', async () => {
  // 'legacy' = a run an earlier build saved with a 403 recorded as a refusal:
  // it must NOT unlock (R-transfer3).
  for (const outcome of ['refused', 'unknown', 'legacy'] as const) {
    const storage = new Map<string, any>()
    const run = { ...prepareTransferRun(5, [{ bulk: false, body: { productId: 7, quantity: 12, fromBranchId: '2', toBranchId: '1', reason: 'r', userId: 5 } }]), context: { kind: 'submit', productName: 'Tea', original: {}, entryId: 'e' } }
    let pending: unknown = 'unset'
    let panel = 'unset'
    const api = {
      loadInventoryTransfer: () => storage.get('run') ?? null,
      saveInventoryTransfer: (_actor: unknown, next: unknown) => { if (next) storage.set('run', next); else storage.delete('run') },
      prepareInventoryTransfer: () => run,
    }
    const context = {
      transferAuthorityRef: { current: { allowed: true, actorId: '5' } }, tr: (key: string, fallback: string) => en[key] || fallback,
      beginSingleAction: () => true, finishSingleAction: () => {}, transferStockInFlightRef: { current: false }, transferSaving: false, setTransferSaving: () => {},
      loadInventoryWriteTransport: async () => api,
      setPendingTransfer: (value: unknown) => { pending = value }, setTransferRetryError: (value: string) => { panel = value },
      transferErrorMessage: (error: Error) => error.message,
      isRefusedTransferRun,
      completeInventoryTransfer: async (saved: any) => {
        // What the recording executor does on each outcome.
        if (outcome === 'refused') { api.saveInventoryTransfer('5', { ...saved, dispatched: true, refusal: { status: 400, code: 'transfer_insufficient_stock', message: 'Insufficient stock in source branch' } }); throw coded(400, 'transfer_insufficient_stock', 'Insufficient stock in source branch') }
        if (outcome === 'legacy') { api.saveInventoryTransfer('5', { ...saved, refusal: { status: 403, code: null, message: 'Branch transfers require Full Access to Inventory' } }); throw httpError(403, 'Branch transfers require Full Access to Inventory') }
        throw Object.assign(new Error('Lost reply'), { outcome: 'unknown' })
      },
    }
    const intent = new Function(...Object.keys(context), compile(`${slice(inventory, '  const runInventoryTransferIntent = async', '\n\n  const retryInventoryTransfer')}; return runInventoryTransferIntent`))(...Object.values(context))
    await assert.rejects(intent('submit', { userId: 5 }, { productName: 'Tea' }))
    if (outcome === 'refused') {
      assert.equal(storage.get('run'), undefined, 'refused: the saved run is cleared')
      assert.equal(pending, null, 'refused: the open form unlocks (transferPending false)')
      assert.equal(panel, '', 'refused: no stale pending banner')
    } else {
      assert.ok(storage.get('run'), 'unknown: the retry identity is kept')
      assert.equal(pending, run, 'unknown: the form stays locked behind Retry')
      assert.equal(panel, outcome === 'legacy' ? 'Branch transfers require Full Access to Inventory' : 'Lost reply')
    }
  }
})

test('Inventory: Edit and Discard exist for a saved run, Discard only through the review dialog', () => {
  assert.match(inventory, /const editInventoryTransfer = async \(\) => \{/)
  assert.match(inventory, /if \(!run \|\| !isRefusedTransferRun\(run\) \|\| run\.context\.kind !== 'submit'/, 'Edit only for a refused submit')
  assert.match(inventory, /api\.saveInventoryTransfer\(actorId, null\)[\s\S]{0,400}setTransferForm\(\{[\s\S]{0,300}batch_id: form\.batch_id[\s\S]{0,200}setTransferModal\(product\)/, 'Edit clears the run and reopens the form with its values')
  assert.match(inventory, /onClick=\{\(\) => setDiscardingInventoryTransfer\(true\)\}/)
  assert.doesNotMatch(inventory, /<button[^>]*discardInventoryTransfer/, 'no button discards without the review dialog')
  assert.match(inventory, /\{discardingInventoryTransfer && pendingTransfer \? \([\s\S]{0,200}<ConfirmDialog[\s\S]{0,400}transfer_run_discard_unknown[\s\S]{0,1500}onConfirm=\{\(\) => \{ void discardInventoryTransfer\(\) \}\}/)
})
