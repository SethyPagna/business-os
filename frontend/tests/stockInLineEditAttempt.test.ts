import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as helpers from '../src/utils/stockInLineEdit.ts'

// Execute the actual component handlers with deterministic hook slots and a
// synthetic transport. Only the JSX rendering is omitted; no handler is
// copied/reimplemented here. This exposes same-tick clicks as well as rerenders.
const source = fs.readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const row = { id: 41, product_id: 7, product_name: 'Fixture item', quantity: 10, batch_id: 9, batch_revision: 4,
  batch_received_at: '2026-09-05', batch_supplier_name: 'Fixture supplier', batch_unit_cost_usd: 2, total_cost_usd: 20,
  batch_receipt_session_count: 1, batch_payment_status: 'paid', movement_type: 'add', created_at: '2026-09-05', edit_count: 1 }
const summary = { key: 'session:1', rows: [], quantity: 10, lineCount: 1, supplier: { supplierId: null, supplierName: 'Fixture supplier' },
  receivedDate: '2026-09-05', branchId: '1', branchName: 'Branch', userName: 'Actor', createdAt: '2026-09-05', costUsd: 20,
  linesWithoutCost: 0, paymentStatus: 'paid', creditDueDate: '', hasSharedBatch: false, hasMixedHeader: false }

function harness(componentSource = source) {
  let slot = 0
  const slots: unknown[] = []
  const requests: Array<{ id: number; body: Record<string, unknown> }> = []
  const state = { user: { id: 7 }, rows: [{ ...row }] as Array<Omit<typeof row, 'id'> & { id: number | null }>, reads: 0, headers: 0, reverts: 0, readFailure: false, messages: [] as string[],
    dispatch: async (_id: number, _body: Record<string, unknown>): Promise<unknown> => { throw Object.assign(new Error('Lost response'), { outcome: 'unknown' }) },
    revertDispatch: async (_id: number): Promise<unknown> => undefined }
  const deps = {
    ...helpers,
    useState(initial: unknown) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(initial: unknown) { const index = slot++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: () => {},
    useApp: () => ({ user: state.user, fmtKHR: String }), canViewAcquisitionCosts: () => true, canEditAcquisitionCosts: () => true,
    DEFAULT_PAGE_SIZE: 25, clampPage: () => 1, groupByBusinessDay: () => [],
    getStockInSessions: async () => ({ sessions: [], total: 0 }),
    getStockInSessionLines: async () => { state.reads++; if (state.readFailure) throw new Error('Read failed'); return { rows: state.rows.map((r) => ({ ...r })) } },
    editStockInLine: async (id: number, body: Record<string, unknown>) => { requests.push({ id, body: JSON.parse(JSON.stringify(body)) }); return state.dispatch(id, body) },
    updateBatch: async () => { state.headers++ }, revertStockMovement: async (id: number) => { state.reverts++; return state.revertDispatch(id) },
  }
  const start = componentSource.indexOf('function sessionCost(')
  const end = componentSource.indexOf('  return <div className="space-y-3">')
  assert.ok(start > 0 && end > start, 'the real handler region must be located')
  const handlerSource = componentSource.slice(start, end).replace('export default function ', 'function ')
    + `return { open, saveHeader, editHeader, addMoreStock, editing, addMore, removeRow, removeSession, startLineEdit, patchLineDraft, saveLineEdit, lineEdit, selected, busy,
      closeSession: typeof closeSession === 'function' ? closeSession : null,
      cancelLineEdit: typeof cancelLineEdit === 'function' ? cancelLineEdit : null } };
      return StockInSessionsSection;`
  const compiled = ts.transpile(handlerSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const Component = new Function(...Object.keys(deps), compiled)(...Object.values(deps))
  const render = () => { slot = 0; return Component({ t: (key: string) => key, notify: (message: string) => state.messages.push(message), branches: [], onChanged: () => {} }) }
  return { render, state, requests }
}

Object.assign(globalThis, { window: { confirm: () => true } })
async function opened(componentSource = source) {
  const h = harness(componentSource)
  await h.render().open(summary)
  h.render().startLineEdit(h.state.rows[0])
  h.render().patchLineDraft({ quantity: '12' })
  return h
}

async function frozenRetry(componentSource = source) {
  const h = await opened(componentSource)
  await h.render().saveLineEdit()
  h.render().patchLineDraft({ quantity: '99', unitCostUsd: '9', receivedDate: '2026-10-01', supplierName: 'Changed', reason: 'Changed' })
  await h.render().saveLineEdit()
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.requests[1], h.requests[0], 'unknown-outcome retry must send the exact original movement, body and request ID')
}

await frozenRetry()
console.log('PASS actual save handler freezes a complete attempt across an unknown response and draft edits')

{
  const h = await opened()
  let reject: (error: Error) => void = () => {}
  h.state.dispatch = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise })
  const saving = h.render().saveLineEdit()
  const api = h.render()
  await api.saveLineEdit()
  api.patchLineDraft({ quantity: '66' })
  api.startLineEdit({ ...row, id: 42 })
  api.cancelLineEdit(); api.closeSession()
  api.editHeader(); api.addMoreStock()
  await api.open({ ...summary, key: 'session:2' })
  await api.saveHeader(); await api.removeRow(row); await api.removeSession()
  assert.equal(h.requests.length, 1, 'same-tick double save and other writes cannot pass the synchronous lock')
  assert.equal(h.render().lineEdit.row.id, 41)
  assert.equal(h.render().lineEdit.draft.quantity, '12')
  assert.equal(h.render().selected.key, 'session:1')
  assert.equal(h.render().editing, false); assert.equal(h.render().addMore, null)
  assert.equal(h.state.headers, 0); assert.equal(h.state.reverts, 0)
  reject(Object.assign(new Error('Timeout'), { outcome: 'unknown' }))
  await saving
  h.render().closeSession(); h.render().cancelLineEdit()
  assert.ok(h.render().lineEdit && h.render().selected, 'unknown outcome also blocks later dismissal')
}
console.log('PASS sending and unresolved attempts block duplicate dispatch, edits, other rows, header writes and dismissal')

for (const error of [
  Object.assign(new Error('Network'), { outcome: 'unknown' }),
  Object.assign(new Error('Timeout'), { code: 'request_timeout' }),
  Object.assign(new Error('Server'), { status: 500, code: 'stale_line' }),
  Object.assign(new Error('Gateway'), { status: 502 }),
  Object.assign(new Error('Conflict'), { status: 409, code: 'idempotency_conflict' }),
  null,
]) {
  const h = await opened()
  h.state.dispatch = async () => { if (error) throw error; return { success: true, movementId: 999 } }
  await h.render().saveLineEdit()
  assert.ok(h.render().lineEdit, 'unknown/malformed acknowledgement retains the original editor')
  h.render().patchLineDraft({ quantity: '88' })
  await h.render().saveLineEdit()
  assert.deepEqual(h.requests[1], h.requests[0])
}
console.log('PASS network, timeout, server errors, malformed acknowledgement and idempotency conflict retain the exact request')

{
  const h = await opened()
  const committed = new Set<string>()
  let effects = 0
  h.state.dispatch = async (id, body) => {
    assert.equal(Object.isFrozen(body), true)
    const requestId = String(body.client_request_id)
    if (!committed.has(requestId)) {
      committed.add(requestId); effects++
      h.state.rows[0] = { ...h.state.rows[0], quantity: 12, batch_revision: 5, total_cost_usd: 24 }
      throw Object.assign(new Error('Success reply lost'), { outcome: 'unknown' })
    }
    return { success: true, movementId: id, operation_id: 'stored-operation', replayed: true, after: { quantity: body.quantity } }
  }
  await h.render().saveLineEdit()
  await h.render().saveLineEdit()
  assert.equal(effects, 1)
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.requests[1], h.requests[0])
  assert.equal(h.render().lineEdit, null)
  assert.equal(h.render().selected.rows[0].batch_revision, 5)
}
console.log('PASS a committed lost reply is retried once with the same receipt and refreshes the successful review')

{
  const h = await opened()
  h.state.rows[0].batch_revision = 8
  h.state.dispatch = async () => { throw Object.assign(new Error('Stale review'), { status: 409, code: 'stale_line' }) }
  h.state.readFailure = true
  await h.render().saveLineEdit()
  assert.ok(h.render().lineEdit, 'even a known refusal cannot release the attempt before refresh succeeds')
  h.state.readFailure = false
  await h.render().saveLineEdit()
  assert.equal(h.render().lineEdit, null)
  assert.equal(h.render().selected.rows[0].batch_revision, 8)
  const oldId = h.requests[0].body.client_request_id
  h.render().startLineEdit(h.render().selected.rows[0]); h.render().patchLineDraft({ quantity: '13' })
  h.state.dispatch = async (id, body) => ({ success: true, movementId: id, operation_id: 'new-operation', after: { quantity: body.quantity } })
  await h.render().saveLineEdit()
  assert.notEqual(h.requests[2].body.client_request_id, oldId, 'a revised attempt receives a new ID')
  assert.equal(h.requests[2].body.expected_batch_revision, 8)
}
console.log('PASS known stale refusal requires fresh rows before a new attempt and request ID')

{
  const h = await opened()
  await h.render().saveLineEdit()
  h.state.user = { id: 9 }
  await h.render().saveLineEdit()
  assert.equal(h.requests.length, 1, 'another actor cannot retry the first actor\'s edit')
  assert.ok(h.render().lineEdit)
}
console.log('PASS another signed-in actor cannot dispatch an unresolved attempt')

{
  const h = await opened()
  let acknowledge: (response: unknown) => void = () => {}
  h.state.dispatch = () => new Promise((resolve) => { acknowledge = resolve })
  const saving = h.render().saveLineEdit()
  h.state.user = { id: 9 }; h.render()
  acknowledge({ success: true, movementId: row.id, operation_id: 'late-operation', after: { quantity: 12 } })
  await saving
  assert.ok(h.render().lineEdit, 'a late response cannot release another actor\'s attempt')
  assert.equal(h.state.reads, 1, 'a late response cannot reopen the prior actor\'s session')
}
console.log('PASS actor changes while a request is in flight fence its late acknowledgement')

{
  const h = await opened()
  h.state.dispatch = async () => { throw Object.assign(new Error('Quantity rejected'), { status: 400, code: 'invalid_quantity' }) }
  await h.render().saveLineEdit()
  assert.equal(h.render().lineEdit, null)
  const oldId = h.requests[0].body.client_request_id
  h.render().startLineEdit(h.render().selected.rows[0]); h.render().patchLineDraft({ quantity: '13' })
  await h.render().saveLineEdit()
  assert.notEqual(h.requests[1].body.client_request_id, oldId)
}
console.log('PASS explicit noncommitting validation refreshes and releases the old request ID')

for (const code of ['permission_denied', 'product_cost_edit_required']) {
  const denied = Object.assign(new Error('Permission refused'), { status: 403, code })
  const first = await opened()
  first.state.dispatch = async () => { throw denied }
  await first.render().saveLineEdit()
  assert.equal(first.render().lineEdit, null, 'an explicit first-request permission refusal cannot trap the editor')
  assert.equal(first.state.reads, 2)

  const retry = await opened()
  await retry.render().saveLineEdit()
  retry.state.dispatch = async () => { throw denied }
  await retry.render().saveLineEdit()
  assert.ok(retry.render().lineEdit, 'permission refusal on retry cannot disprove the previous unknown commit')
  assert.equal(retry.state.reads, 1)
  assert.deepEqual(retry.requests[1], retry.requests[0])
}
console.log('PASS first explicit permission refusal releases after refresh while permission loss after unknown retains the attempt')

{
  const h = harness()
  await h.render().open(summary)
  await h.render().removeRow(row)
  assert.equal(h.requests[0].body.quantity, 0)
  assert.equal(h.requests[0].body.expected_batch_revision, 4)
  assert.equal(h.render().lineEdit.draft.quantity, '0', 'removal remains visible for retry')
  h.render().patchLineDraft({ quantity: '50' })
  await h.render().saveLineEdit()
  assert.deepEqual(h.requests[1], h.requests[0])
  assert.equal(h.state.reverts, 0, 'edited lines never use the original receipt reversal')
}
console.log('PASS edited-line removal freezes its zero-quantity request and revision for retry')

{
  const h = harness()
  h.state.rows = [{ ...row, id: null, quantity: 0 }, { ...row }, { ...row, id: 42, edit_count: 0 }]
  await h.render().open(summary)
  await h.render().removeRow(h.state.rows[0])
  assert.equal(h.requests.length, 0)
  await h.render().removeSession()
  assert.equal(h.requests.length, 1, 'a bulk removal stops at its first unresolved edit')
  assert.equal(h.requests[0].id, row.id)
  assert.equal(h.state.reverts, 0, 'neither the zero line nor later rows can be reversed')
  assert.equal(h.render().lineEdit.row.id, row.id)
}
console.log('PASS session removal skips zero lines and stops before other rows after an uncertain edit')

async function mixedRemoval(componentSource = source) {
  const h = harness(componentSource)
  h.state.rows = [{ ...row }, { ...row, id: 42 }, { ...row, id: 43, edit_count: 0 }, { ...row, id: 44 }]
  h.state.dispatch = async (id, body) => {
    const live = h.state.rows.find((item) => item.id === id)!
    assert.equal(body.expected_batch_revision, live.batch_revision, 'each same-lot edit uses the review after the previous write')
    h.state.rows = h.state.rows.filter((item) => item.id !== id).map((item) => ({ ...item, batch_revision: item.batch_revision + 1 }))
    return { success: true, movementId: id, operation_id: `operation-${id}`, after: { quantity: 0 } }
  }
  let finishLegacy: () => void = () => {}
  let legacyStarted: () => void = () => {}
  const legacyReady = new Promise<void>((resolve) => { legacyStarted = resolve })
  h.state.revertDispatch = async (id) => {
    legacyStarted()
    await new Promise<void>((resolve) => { finishLegacy = resolve })
    h.state.rows = h.state.rows.filter((item) => item.id !== id).map((item) => ({ ...item, batch_revision: item.batch_revision + 1 }))
  }
  await h.render().open(summary)
  const staleApi = h.render()
  const removing = staleApi.removeSession()
  // A stale second-row failure exits before the legacy request; expose that
  // outcome as a failed assertion instead of waiting forever in the probe.
  await Promise.race([legacyReady, removing])
  assert.equal(h.state.reverts, 1, 'all prior edited rows must complete before the legacy row')
  assert.equal(h.render().busy, true, 'the lock survives each acknowledged edited row')
  await staleApi.removeSession(); await staleApi.removeRow({ ...row, id: 99 }); await staleApi.saveHeader()
  staleApi.closeSession(); staleApi.startLineEdit(row)
  staleApi.editHeader(); staleApi.addMoreStock()
  await staleApi.open({ ...summary, key: 'session:other' })
  assert.equal(h.render().selected.key, summary.key)
  assert.equal(h.render().editing, false); assert.equal(h.render().addMore, null)
  assert.equal(h.state.reverts, 1, 'even same-tick closures cannot interleave another removal')
  assert.equal(h.state.headers, 0)
  finishLegacy(); await removing
  assert.deepEqual(h.requests.map((request) => [request.id, request.body.expected_batch_revision]), [[41, 4], [42, 5], [44, 7]])
  assert.equal(h.state.rows.length, 0)
  assert.equal(h.render().selected, null)
  assert.equal(h.render().busy, false)
}
await mixedRemoval()
console.log('PASS mixed multi-row removal refreshes shared-lot revisions and holds exclusion through legacy requests')
await assert.rejects(() => mixedRemoval(source.replace(
  'reviewedRowsRef.current.find((candidate) => candidate.id === original.id)', 'original')), /all prior edited rows must complete/)
await assert.rejects(() => mixedRemoval(source.replace(
  'setBusy(sessionRemovalBusyRef.current)', 'setBusy(false)')), /the lock survives/)
console.log('PASS NEGATIVE CONTROLS: mixed removal rejects stale original rows and clearing busy between edited rows')

// The probe must detect the old class of bug, not just count requests. Inject
// a recomputation at the actual dispatch seam and remove only the draft lock.
const dispatchNeedle = 'editStockInLine(attempt.movementId, attempt.body)'
const draftNeedle = 'if (pendingAttemptRef.current || lineAttemptBusyRef.current) return\n    setLineEdit'
assert.ok(source.includes(dispatchNeedle) && source.includes(draftNeedle), 'negative-control mutation points remain present')
const defective = source.replace(dispatchNeedle,
  'editStockInLine(attempt.movementId, buildStockInLineEditBody(lineEdit.row, lineEdit.draft, attempt.body.client_request_id, canEditCosts).body)')
  .replace(draftNeedle, 'setLineEdit')
await assert.rejects(() => frozenRetry(defective), /unknown-outcome retry must send/)
console.log('PASS NEGATIVE CONTROL: the same handler probe rejects rebuilding a request from mutable draft state')

assert.match(source, /<fieldset disabled=\{busy \|\| Boolean\(pendingAttempt\)\}/)
assert.match(source, /onClose=\{closeSession\}/)
assert.match(source, /closeDisabled=\{busy \|\| Boolean\(pendingAttempt\)\}/)
assert.match(source, /onClick=\{editHeader\}/)
assert.match(source, /onClick=\{addMoreStock\}/)
assert.match(source, /onClick=\{cancelLineEdit\}/)
