import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { compileHandler, findFunction, readComponent, type ComponentSource, type Scope } from './componentHandlerHarness.ts'
import { captureActorReadScope } from '../src/api/actorReadScope.ts'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { awardCustomerPoints } from '../src/api/contactWriteTransport.ts'
import { adjustStock } from '../src/api/inventoryWriteTransport.ts'
import { createReturn, createSupplierReturn } from '../src/api/returnsTransport.ts'
import { createWriteTimeoutError } from '../src/utils/writeIntent.ts'

const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const translate = (key: string, fallback = ''): string => km[key] ?? fallback
const UI_TIMEOUT_MS = 5
const SETTLE_DEADLINE_MS = 2_000
const OPERATOR_PAUSE_MS = 20_000
const unknownOutcome = createWriteTimeoutError('write', UI_TIMEOUT_MS, (key: string) => km[key]).message

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Call = unknown[]
type Notice = { message: string; tone?: string }
type Outcome = { kind: 'hang' } | { kind: 'lost' } | { kind: 'answer'; value: unknown }
type WireRequest = Record<string, unknown>
type HistoryAction = { undo: () => Promise<void>; redo: () => Promise<void> }

const HANG: Outcome = { kind: 'hang' }
const LOST: Outcome = { kind: 'lost' }
const answer = (value: unknown): Outcome => ({ kind: 'answer', value })

function outcomeOf(outcome: Outcome): Promise<unknown> {
  if (outcome.kind === 'hang') return new Promise(() => {})
  if (outcome.kind === 'lost') {
    return Promise.reject(Object.assign(new Error('The server did not confirm the write.'), { code: 'write_outcome_unknown', status: 503 }))
  }
  return Promise.resolve(outcome.value)
}

function scriptedWrite() {
  const calls: Call[] = []
  let next: Outcome = HANG
  return {
    calls,
    will(outcome: Outcome): void { next = outcome },
    fn: (...args: unknown[]): Promise<unknown> => {
      calls.push(JSON.parse(JSON.stringify(args)) as Call)
      return outcomeOf(next)
    },
  }
}
type ScriptedWrite = ReturnType<typeof scriptedWrite>

function installSteppedClock(): { advance(ms: number): void; restore(): void } {
  const RealDate = globalThis.Date
  let offsetMs = 0
  const now = (): number => RealDate.now() + offsetMs
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    get: (target, property, receiver) => (property === 'now' ? now : Reflect.get(target, property, receiver)),
  })
  return {
    advance: (ms: number) => { offsetMs += ms },
    restore: () => { globalThis.Date = RealDate },
  }
}

async function settled<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} never settled: the write has no UI timeout`)), SETTLE_DEADLINE_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function withoutIdentity(request: unknown): WireRequest {
  const { client_request_id: _id, return_number: _number, ...rest } = request as WireRequest
  return rest
}

function assertEveryPartChanged(next: string[], previous: string[], why: string): void {
  next.forEach((part, index) => assert.notEqual(part, previous[index], why))
}

interface IntentDrive {
  press(): Promise<unknown>
  write: ScriptedWrite
  notices: Notice[]
  identityOf(call: Call): string[]
  requestOf(call: Call): unknown
  editIntent(): void
  committed: Outcome
  failParentOnce?: () => void
}

async function proveOneIdentityPerIntent(drive: IntentDrive): Promise<void> {
  const clock = installSteppedClock()
  try {
    const attempt = async (outcome: Outcome, label: string): Promise<Call> => {
      clock.advance(OPERATOR_PAUSE_MS)
      drive.write.will(outcome)
      const before = drive.write.calls.length
      await settled(drive.press(), label)
      assert.equal(drive.write.calls.length, before + 1, `${label}: one write per press`)
      return drive.write.calls[before]
    }
    const timedOut = await attempt(HANG, 'the attempt the UI stopped waiting for')
    assert.ok(
      drive.notices.some((notice) => notice.message.includes(unknownOutcome)),
      `the UI timeout says the outcome is unknown, in the active language; saw ${JSON.stringify(drive.notices)}`,
    )
    const retries = [await attempt(LOST, 'the retry whose answer was lost')]
    if (drive.failParentOnce) {
      drive.failParentOnce()
      retries.push(await attempt(drive.committed, 'the retry the Worker committed while the parent failed'))
    }
    retries.push(await attempt(drive.committed, 'the retry that committed'))
    for (const retry of retries) {
      assert.deepEqual(drive.identityOf(retry), drive.identityOf(timedOut), 'a retry after a failed or unknown attempt resends its identity, so the Worker replays instead of applying twice')
      assert.deepEqual(drive.requestOf(retry), drive.requestOf(timedOut), 'the retry resends the same request under that identity')
    }
    const identical = await attempt(LOST, 'the same values after a committed write')
    assertEveryPartChanged(drive.identityOf(identical), drive.identityOf(timedOut), 'after a committed write, even an identical intent is a new request')
    drive.editIntent()
    const edited = await attempt(LOST, 'a changed intent')
    assertEveryPartChanged(drive.identityOf(edited), drive.identityOf(identical), 'a changed intent is a new request, never a replay of the old one')
    const editedRetry = await attempt(drive.committed, 'the retry of the changed intent')
    assert.deepEqual(drive.identityOf(editedRetry), drive.identityOf(edited))
  } finally {
    clock.restore()
  }
}

function recordNotices(notices: Notice[]) {
  return (message: string, tone?: string) => { notices.push({ message: String(message), tone }) }
}

await runTest('loyalty add: a timed-out or lost award keeps its id; only a committed award or a changed intent mints a new one', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { points: '50', note: 'Birthday' }
  const scope: Scope = {
    lookupData: { customer: { id: 42 } },
    notify: recordNotices(notices),
    copy: (_key: string, fallback = '') => fallback,
    t: (key: string) => km[key] ?? key,
    setManualPointSaving: () => {},
    setManualPoints: () => {},
    setManualPointNote: () => {},
    handleLookup: async () => {},
    loadCustomerPoints: async () => {},
    awardIdentityRef: { current: null },
    awardCustomerPoints: write.fn,
    LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS: UI_TIMEOUT_MS,
    manualPoints: form.points,
    manualPointNote: form.note,
  }
  const render = await compileHandler<() => Promise<void>>(readComponent('components/loyalty-points/LoyaltyPointsPage.tsx'), 'handleAwardPoints', { locals: Object.keys(scope) })
  await proveOneIdentityPerIntent({
    press: () => render({ ...scope, manualPoints: form.points, manualPointNote: form.note })(),
    write,
    notices,
    identityOf: (call) => [String((call[1] as WireRequest).client_request_id)],
    requestOf: (call) => [call[0], withoutIdentity(call[1])],
    editIntent: () => { form.points = '75' },
    committed: answer({ success: true }),
  })
  assert.match(String((write.calls[0][1] as WireRequest).client_request_id), /^loyalty_points_/)
})

await runTest('legacy customer return: a timed-out or lost create keeps its id AND return number until the create commits', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { reason: 'Damaged' }
  const scope: Scope = {
    pendingLoaded: true,
    pendingError: null,
    sessionStale: false,
    lifecycle: { current: { alive: true, generation: 0, scope: captureActorReadScope('returns') } },
    pendingV1: null,
    isV1Sale: false,
    unsupportedMoneyVersion: false,
    submitNetReturn: async () => { throw new Error('a legacy sale must not take the v1 create path') },
    activeItems: [{ id: 11, product_id: 5, product_name: 'Serum', returnQty: 1, applied_price_usd: 10, applied_price_khr: 41000, return_to_stock: true, stock_action: 'restock', branch_id: 1, pickedBatchId: 31 }],
    notify: recordNotices(notices),
    T: translate,
    itemsMissingLot: [],
    replacementsMissingLot: [],
    submitInFlightRef: { current: false },
    setSubmitting: () => {},
    foundSale: { id: 7, receipt_number: 'R-0007', customer_name: 'Sokha', branch_id: 1, exchange_rate: 4100 },
    user: { id: 3, name: 'Dara' },
    returnType: 'refund',
    notes: '',
    totalRefund: 10,
    totalRefundKhr: 41000,
    replacements: [],
    replacementPaymentMethod: 'cash',
    legacyReturnIdentityRef: { current: null },
    createReturnRequest: write.fn,
    RETURN_CREATE_TIMEOUT_MS: UI_TIMEOUT_MS,
    window: { dispatchEvent: () => true },
    onClose: () => {},
    onSuccess: () => {},
    finalReason: form.reason,
  }
  const render = await compileHandler<() => Promise<void>>(readComponent('components/returns/NewReturnModal.tsx'), 'handleSubmit', { locals: Object.keys(scope) })
  await proveOneIdentityPerIntent({
    press: () => render({ ...scope, finalReason: form.reason })(),
    write,
    notices,
    identityOf: (call) => [String((call[0] as WireRequest).client_request_id), String((call[0] as WireRequest).return_number)],
    requestOf: (call) => withoutIdentity(call[0]),
    editIntent: () => { form.reason = 'Wrong shade' },
    committed: answer({ success: true, id: 90 }),
  })
  const first = write.calls[0][0] as WireRequest
  assert.match(String(first.client_request_id), /^return_/)
  assert.match(String(first.return_number), /^RET-/)
})

await runTest('supplier return: the id survives a timeout, a lost answer and a failed hand-over to the parent', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { reason: 'Expired' }
  let parentFailures = 0
  const scope: Scope = {
    branchId: '1',
    supplierId: '4',
    selectedItems: [{ product_id: 5, product_name: 'Serum', quantity: 2, cost_price_usd: 4, cost_price_khr: 16400 }],
    notify: recordNotices(notices),
    tr: translate,
    submitInFlightRef: { current: false },
    setSubmitting: () => {},
    user: { id: 3, name: 'Dara' },
    supplier: { id: 4, name: 'Glow Co' },
    notes: '',
    settlement: 'refund',
    effectiveCompensationUsd: 8,
    effectiveCompensationKhr: 32800,
    supplierReturnIdentityRef: { current: null },
    createSupplierReturnRequest: write.fn,
    SUPPLIER_RETURN_CREATE_TIMEOUT_MS: UI_TIMEOUT_MS,
    window: { dispatchEvent: () => true },
    onSuccess: () => {
      if (parentFailures > 0) {
        parentFailures -= 1
        throw new Error('The returns list could not refresh.')
      }
    },
    onClose: () => {},
    reason: form.reason,
  }
  const render = await compileHandler<() => Promise<void>>(readComponent('components/returns/NewSupplierReturnModal.tsx'), 'submit', { locals: Object.keys(scope) })
  await proveOneIdentityPerIntent({
    press: () => render({ ...scope, reason: form.reason })(),
    write,
    notices,
    identityOf: (call) => [String((call[0] as WireRequest).client_request_id), String((call[0] as WireRequest).return_number)],
    requestOf: (call) => withoutIdentity(call[0]),
    editIntent: () => { form.reason = 'Damaged in transit' },
    committed: answer({ success: true, id: 91 }),
    failParentOnce: () => { parentFailures = 1 },
  })
  const first = write.calls[0][0] as WireRequest
  assert.match(String(first.client_request_id), /^supplier_return_/)
  assert.match(String(first.return_number), /^SRET-/)
})

await runTest('inventory adjust: Save and Confirm keep one id per intent across failures; undo and redo keep their own until they fully succeed', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const pushed: HistoryAction[] = []
  let reloadFailures = 0
  const product = { id: 9, name: 'Serum', stock_quantity: 10, branch_stock: [{ branch_id: 1, quantity: 10 }], selling_price_usd: 12, selling_price_khr: 49200, cost_price_usd: 4 }
  const state: Scope = { pendingAdjust: null, adjustSaving: false, adjustModal: null, adjustForm: {} }
  const stable: Scope = {
    adjustIdentityRef: { current: null },
    receiptSessionIdRef: { current: 0 },
    adjustStockInFlightRef: { current: false },
    setPendingAdjust: (value: unknown) => { state.pendingAdjust = value },
    setAdjustSaving: (value: unknown) => { state.adjustSaving = value },
    setAdjustModal: (value: unknown) => { state.adjustModal = value },
    setAdjustForm: (value: unknown) => { state.adjustForm = value },
    notify: recordNotices(notices),
    tr: translate,
    getStockQty: (row?: { stock_quantity?: number }) => Number(row?.stock_quantity || 0),
    canEditCosts: true,
    canViewCosts: true,
    adjustCurrentQuantity: 10,
    user: { id: 3, name: 'Dara' },
    defaultBranch: { id: 1 },
    ensureInventoryReasonsLoaded: async () => {},
    getInventoryApi: () => ({ adjustStock: write.fn }),
    actionHistory: { pushAction: (action: HistoryAction) => { pushed.push(action) }, refreshServerItems: async () => {} },
    load: async () => {
      if (reloadFailures > 0) {
        reloadFailures -= 1
        throw new Error('The inventory list could not reload.')
      }
    },
    INVENTORY_STOCK_MUTATION_TIMEOUT_MS: UI_TIMEOUT_MS,
  }
  const inventory = readComponent('components/inventory/Inventory.tsx')
  const locals = [...Object.keys(state), ...Object.keys(stable)]
  const open = await compileHandler<(row: unknown) => void>(inventory, 'openAdjust', { locals })
  const save = await compileHandler<() => Promise<void>>(inventory, 'handleAdjust', { locals })
  const confirm = await compileHandler<() => Promise<void>>(inventory, 'commitAdjust', { locals, include: ['runInventoryMutation'] })
  const scope = (): Scope => ({ ...state, ...stable })
  const fillRemoval = (quantity: string) => { state.adjustForm = { ...(state.adjustForm as object), type: 'remove', quantity, reason: 'Damaged', batch_id: '31' } }
  const parkedId = (): string => String((state.pendingAdjust as { request: WireRequest }).request.client_request_id)
  const lastRequest = (): WireRequest => write.calls[write.calls.length - 1][0] as WireRequest
  const clock = installSteppedClock()
  try {
    const pressSave = async () => { clock.advance(OPERATOR_PAUSE_MS); await save(scope())() }
    const backOutOfReview = () => { state.pendingAdjust = null }
    const pressConfirm = async (outcome: Outcome, label: string): Promise<WireRequest> => {
      clock.advance(OPERATOR_PAUSE_MS)
      write.will(outcome)
      const before = write.calls.length
      await settled(confirm(scope())(), label)
      assert.equal(write.calls.length, before + 1, `${label}: one write per confirm`)
      return lastRequest()
    }
    open(scope())(product)
    fillRemoval('2')
    await pressSave()
    const intentId = parkedId()
    assert.match(intentId, /^stockadjust_/)
    const timedOut = await pressConfirm(HANG, 'the adjust the UI stopped waiting for')
    assert.ok(notices.some((notice) => notice.message.includes(unknownOutcome)), `the UI timeout says the outcome is unknown; saw ${JSON.stringify(notices)}`)
    backOutOfReview()
    await pressSave()
    assert.equal(parkedId(), intentId, 'Save pressed again after an unknown outcome parks the same identity')
    const refused = await pressConfirm(answer({ success: false, error: 'Stock is busy' }), 'the adjust the Worker answered with success: false')
    backOutOfReview()
    await pressSave()
    const lost = await pressConfirm(LOST, 'the adjust whose answer was lost')
    const committed = await pressConfirm(answer({ success: true, batchId: 31 }), 'the re-confirmed adjust that committed')
    for (const retry of [refused, lost, committed]) {
      assert.equal(retry.client_request_id, intentId, 'a retry after a failed or unknown adjust resends its identity, so stock moves once')
      assert.deepEqual(retry, timedOut, 'the retry resends the same adjust')
    }
    state.adjustModal = product
    await pressSave()
    const afterCommit = parkedId()
    assert.notEqual(afterCommit, intentId, 'after a committed adjust, even an identical one is a new request')
    backOutOfReview()
    fillRemoval('3')
    await pressSave()
    const changed = parkedId()
    assert.notEqual(changed, afterCommit, 'a changed adjust is a new request')
    await pressConfirm(LOST, 'the changed adjust whose answer was lost')
    open(scope())(product)
    fillRemoval('3')
    await pressSave()
    assert.notEqual(parkedId(), changed, 'reopening the adjust modal is an explicit new intent')

    assert.equal(pushed.length, 1, 'the committed adjust pushed one undo entry')
    const [history] = pushed
    const run = async (step: () => Promise<void>, outcome: Outcome, label: string, fails: boolean): Promise<WireRequest> => {
      clock.advance(OPERATOR_PAUSE_MS)
      write.will(outcome)
      const attempt = settled(step(), label)
      if (fails) await assert.rejects(attempt, `${label} fails`)
      else await attempt
      return lastRequest()
    }
    const undoTimedOut = await run(history.undo, HANG, 'the undo the UI stopped waiting for', true)
    reloadFailures = 1
    const undoReloadFailed = await run(history.undo, answer({ success: true }), 'the undo that committed but whose reload failed', true)
    const undoDone = await run(history.undo, answer({ success: true }), 'the undo that fully succeeded', false)
    for (const retry of [undoReloadFailed, undoDone]) {
      assert.equal(retry.client_request_id, undoTimedOut.client_request_id, 'a retried undo replays its own request instead of reversing the stock twice')
    }
    assert.match(String(undoTimedOut.client_request_id), /^stockadjust-undo_/)
    assert.notEqual(undoTimedOut.client_request_id, intentId, 'the undo carries its own id, not the forward adjust id')
    const redoLost = await run(history.redo, LOST, 'the redo whose answer was lost', true)
    const redoDone = await run(history.redo, answer({ success: true }), 'the redo that fully succeeded', false)
    assert.equal(redoDone.client_request_id, redoLost.client_request_id, 'a retried redo replays its own request')
    assert.match(String(redoLost.client_request_id), /^stockadjust-redo_/)
    assert.notEqual(redoLost.client_request_id, undoTimedOut.client_request_id)
    const nextUndo = await run(history.undo, answer({ success: true }), 'the undo after the redo', false)
    assert.notEqual(nextUndo.client_request_id, undoDone.client_request_id, 'once an undo fully succeeded, the next undo is a new request')
  } finally {
    clock.restore()
  }
})

await runTest('stock-action import: a retry resumes the job it created; only a started job or a different sheet releases it', async () => {
  const created: string[] = []
  const uploads: unknown[] = []
  const starts: unknown[] = []
  const cancels: unknown[] = []
  const reviewed: unknown[] = []
  let uploadOutcome: Outcome = answer({ ok: true })
  let startOutcome: Outcome = answer({ ok: true })
  const sheet = { csvText: 'barcode,quantity\n111,2\n', fileName: 'shelf-a.csv' }
  const scope: Scope = {
    canEditCosts: true,
    setError: () => {},
    tr: (_key: string, english: string) => english,
    busy: false,
    setBusy: () => {},
    mode: 'direct',
    rowCount: 1,
    pendingJobRef: { current: null },
    aliveRef: { current: true },
    setReviewJob: (job: unknown) => { reviewed.push(job) },
    createImportJob: async () => {
      created.push(`job-${created.length + 1}`)
      return { job: { id: created[created.length - 1] } }
    },
    uploadImportJobCsv: (upload: { jobId: unknown }) => { uploads.push(upload.jobId); return outcomeOf(uploadOutcome) },
    startImportJob: (jobId: unknown) => { starts.push(jobId); return outcomeOf(startOutcome) },
    cancelImportJob: async (jobId: unknown) => { cancels.push(jobId) },
    csvText: sheet.csvText,
    fileName: sheet.fileName,
  }
  const render = await compileHandler<() => Promise<void>>(readComponent('components/products/import/StockActionImportModal.tsx'), 'handleImport', { locals: Object.keys(scope) })
  const clock = installSteppedClock()
  try {
    const importSheet = async (upload: Outcome, start: Outcome) => {
      clock.advance(OPERATOR_PAUSE_MS)
      uploadOutcome = upload
      startOutcome = start
      await settled(render({ ...scope, ...sheet })(), 'the import press')
    }
    await importSheet(answer({ ok: true }), LOST)
    await importSheet(answer({ ok: true }), answer({ ok: true }))
    assert.deepEqual(created, ['job-1'], 'the retry after a lost start answer resumes job-1 instead of creating a second job')
    assert.deepEqual(uploads, ['job-1'], 'the sheet is not uploaded twice into the same job')
    assert.deepEqual(starts, ['job-1', 'job-1'])
    assert.deepEqual(reviewed, [{ id: 'job-1', rowCount: 1 }])

    await importSheet(LOST, answer({ ok: true }))
    await importSheet(answer({ ok: true }), answer({ ok: true }))
    assert.deepEqual(created, ['job-1', 'job-2'], 'a started job is released: the next import of the same sheet is a new job, and a failed upload is resumed')
    assert.deepEqual(uploads, ['job-1', 'job-2', 'job-2'])

    await importSheet(answer({ ok: true }), LOST)
    sheet.csvText = 'barcode,quantity\n222,5\n'
    sheet.fileName = 'shelf-b.csv'
    await importSheet(answer({ ok: true }), answer({ ok: true }))
    assert.deepEqual(cancels, ['job-3'], 'a different sheet cancels the orphaned job first')
    assert.deepEqual(created, ['job-1', 'job-2', 'job-3', 'job-4'])
    assert.deepEqual(reviewed.at(-1), { id: 'job-4', rowCount: 1 })
  } finally {
    clock.restore()
  }
})

await runTest('the write transports put a supplied identity on the wire unchanged', async () => {
  const originalFetch = globalThis.fetch
  const bodies: WireRequest[] = []
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as WireRequest)
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  setSyncServerUrl('https://sync.example.test')
  try {
    const sends: Array<[string, () => Promise<unknown>, WireRequest]> = [
      ['createReturn', () => createReturn({ sale_id: 7, client_request_id: 'return_fixed', return_number: 'RET-FIXED' }), { client_request_id: 'return_fixed', return_number: 'RET-FIXED' }],
      ['createSupplierReturn', () => createSupplierReturn({ supplier_id: 4, client_request_id: 'supplier_return_fixed', return_number: 'SRET-FIXED' }), { client_request_id: 'supplier_return_fixed', return_number: 'SRET-FIXED' }],
      ['awardCustomerPoints', () => awardCustomerPoints(42, { points: 50, note: 'Birthday', client_request_id: 'loyalty_points_fixed' }), { client_request_id: 'loyalty_points_fixed' }],
      ['adjustStock', () => adjustStock({ productId: 9, type: 'remove', quantity: 2, client_request_id: 'stockadjust_fixed' }), { client_request_id: 'stockadjust_fixed' }],
    ]
    for (const [name, send, identity] of sends) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await send()
        const body = bodies[bodies.length - 1]
        for (const [field, value] of Object.entries(identity)) {
          assert.equal(body[field], value, `${name} attempt ${attempt + 1}: ${field} is the caller's, not minted per call`)
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    setSyncServerUrl('')
    __resetApiWriteDedupeForTests()
  }
})

const VOLATILE_CALL = /\b(?:Date|now|random|randomUUID|performance|createClientRequestId|businessDateTimeId|getClientDeviceInfo)\b/
const IDENTITY_FIELD = /^(?:client_request_id|return_number|client_time|clientTime)$/

function lineOf(component: ComponentSource, node: ts.Node): string {
  const { line } = component.file.getLineAndCharacterOfPosition(node.getStart(component.file))
  return `${component.url.pathname.split('/src/')[1]}:${line + 1} ${node.getText(component.file).split('\n')[0]}`
}

function ancestors(node: ts.Node): ts.Node[] {
  const chain: ts.Node[] = []
  for (let current = node.parent; current; current = current.parent) chain.push(current)
  return chain
}

function onFailurePath(node: ts.Node): boolean {
  let child: ts.Node = node
  for (const ancestor of ancestors(node)) {
    if (ts.isCatchClause(ancestor)) return true
    if (ts.isTryStatement(ancestor) && ancestor.finallyBlock === child) return true
    child = ancestor
  }
  return false
}

function functionLabel(fn: ts.Node): string {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text
  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isCallExpression(parent) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) return parent.parent.name.text
  if (ts.isArrowFunction(parent) && parent.body === fn) return `${functionLabel(parent)} cleanup`
  if (ts.isCallExpression(parent)) return parent.expression.getText()
  return '<anonymous>'
}

function enclosingFunction(node: ts.Node): ts.Node {
  const fn = ancestors(node).find((ancestor) => ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor) || ts.isFunctionDeclaration(ancestor))
  assert.ok(fn, `no enclosing function for ${node.getText()}`)
  return fn
}

function descendants(root: ts.Node, match: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (match(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function isRefCurrentAssignment(node: ts.Node, ref: string): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isPropertyAccessExpression(node.left)
    && node.left.name.text === 'current'
    && node.left.expression.getText() === ref
}

function callsNamed(root: ts.Node, name: string): ts.CallExpression[] {
  return descendants(root, (node) => ts.isCallExpression(node) && (
    (ts.isIdentifier(node.expression) && node.expression.text === name)
    || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name)
  )) as ts.CallExpression[]
}

function releaseFollowsWrite(release: ts.Node, write: ts.CallExpression): boolean {
  const tryStatement = ancestors(release).find((ancestor): ancestor is ts.TryStatement => ts.isTryStatement(ancestor) && ancestors(release).includes(ancestor.tryBlock))
  return !!tryStatement
    && ancestors(write).includes(tryStatement.tryBlock)
    && release.getStart() > write.getEnd()
}

const identitySurfaces = [
  { component: 'components/loyalty-points/LoyaltyPointsPage.tsx', ref: 'awardIdentityRef', handler: 'handleAwardPoints', write: 'awardCustomerPoints', newIntent: [] as string[] },
  { component: 'components/returns/NewReturnModal.tsx', ref: 'legacyReturnIdentityRef', handler: 'handleSubmit', write: 'createReturnRequest', newIntent: [] as string[] },
  { component: 'components/returns/NewSupplierReturnModal.tsx', ref: 'supplierReturnIdentityRef', handler: 'submit', write: 'createSupplierReturnRequest', newIntent: [] as string[] },
  { component: 'components/inventory/Inventory.tsx', ref: 'adjustIdentityRef', handler: 'commitAdjust', write: 'adjustStock', newIntent: ['openAdjust'] },
]

await runTest('an intent identity is released only after its write committed or by an explicit new intent, never on a failure path', () => {
  for (const surface of identitySurfaces) {
    const component = readComponent(surface.component)
    const uses = descendants(component.file, (node) => ts.isIdentifier(node) && node.text === surface.ref && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node))
    const releases: ts.BinaryExpression[] = []
    for (const use of uses) {
      const parent = use.parent
      if (ts.isVariableDeclaration(parent) && parent.name === use) continue
      if (ts.isCallExpression(parent) && parent.expression.getText() === 'identityForIntent' && parent.arguments[0] === use) continue
      const assignment = parent.parent
      if (ts.isPropertyAccessExpression(parent) && isRefCurrentAssignment(assignment, surface.ref) && assignment.right.kind === ts.SyntaxKind.NullKeyword) {
        releases.push(assignment)
        continue
      }
      assert.fail(`${surface.ref} may only be keyed by identityForIntent or released with \`.current = null\`; found ${lineOf(component, parent)}`)
    }
    const handler = findFunction(component, surface.handler)
    const [write] = callsNamed(handler, surface.write)
    assert.ok(write, `${surface.handler} calls ${surface.write}`)
    let releasedAfterCommit = 0
    for (const release of releases) {
      assert.ok(!onFailurePath(release), `a catch or finally must not release ${surface.ref}: ${lineOf(component, release)}`)
      const owner = functionLabel(enclosingFunction(release))
      if (surface.newIntent.includes(owner)) continue
      assert.equal(owner, surface.handler, `${surface.ref} is released outside its write handler: ${lineOf(component, release)}`)
      assert.ok(releaseFollowsWrite(release, write), `${surface.ref} is released before ${surface.write} answered: ${lineOf(component, release)}`)
      releasedAfterCommit += 1
    }
    assert.equal(releasedAfterCommit, 1, `${surface.handler} releases ${surface.ref} once, after the committed write`)
  }
})

await runTest('an undo/redo request id is settled only on the success path', () => {
  const component = readComponent('components/inventory/Inventory.tsx')
  const settles = callsNamed(findFunction(component, 'commitAdjust'), 'settle')
  assert.equal(settles.length, 2, 'undo and redo each settle their id')
  for (const settle of settles) assert.ok(!onFailurePath(settle), `settle() on a failure path re-mints the id a retry must replay: ${lineOf(component, settle)}`)
})

await runTest('the stock-action import releases its pending job only after it started, was cancelled, or the sheet was closed', () => {
  const component = readComponent('components/products/import/StockActionImportModal.tsx')
  const writes = descendants(component.file, (node) => isRefCurrentAssignment(node, 'pendingJobRef')) as ts.BinaryExpression[]
  const releases = writes.filter((node) => node.right.getText() !== 'pending')
  assert.ok(releases.length >= 3)
  for (const release of releases) {
    assert.ok(!onFailurePath(release), `a catch or finally must not drop the pending job: ${lineOf(component, release)}`)
    const owner = functionLabel(enclosingFunction(release))
    if (owner === 'useEffect cleanup') continue
    assert.equal(owner, 'handleImport', `the pending job is dropped outside handleImport: ${lineOf(component, release)}`)
    const handler = findFunction(component, 'handleImport')
    const settledJob = [...callsNamed(handler, 'startImportJob'), ...callsNamed(handler, 'cancelImportJob')]
    assert.ok(settledJob.some((call) => releaseFollowsWrite(release, call)), `the pending job is dropped before it started or was cancelled: ${lineOf(component, release)}`)
  }
})

function intentExpression(component: ComponentSource, call: ts.CallExpression): ts.Node {
  const intent = call.arguments[1]
  if (!ts.isIdentifier(intent)) return intent
  const [declaration] = descendants(enclosingFunction(call), (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === intent.text) as ts.VariableDeclaration[]
  assert.ok(declaration?.initializer, `${lineOf(component, call)}: the intent ${intent.text} is declared in the same handler`)
  return declaration.initializer
}

function assertStableIntent(component: ComponentSource, intent: ts.Node): void {
  for (const node of descendants(intent, () => true)) {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && VOLATILE_CALL.test(node.expression.getText())) {
      assert.fail(`the keyed intent holds a value that changes on every press, so a retry would mint a new id: ${lineOf(component, node)}`)
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && IDENTITY_FIELD.test(node.name.getText())) {
      assert.fail(`the keyed intent must not carry an identity or a device clock: ${lineOf(component, node)}`)
    }
  }
}

await runTest('every keyed intent holds only the operator-entered values, nothing volatile', () => {
  for (const surface of identitySurfaces) {
    const component = readComponent(surface.component)
    const keyed = callsNamed(component.file, 'identityForIntent')
    assert.equal(keyed.length, 1, `${surface.component} keys exactly one write intent`)
    assertStableIntent(component, intentExpression(component, keyed[0]))
  }
  const importModal = readComponent('components/products/import/StockActionImportModal.tsx')
  const [intent] = descendants(findFunction(importModal, 'handleImport'), (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'intent') as ts.VariableDeclaration[]
  assert.ok(intent?.initializer)
  assertStableIntent(importModal, intent.initializer)
})

if (failed) {
  console.error(`${failed} write retry idempotency test(s) failed`)
  process.exit(1)
}
console.log('write retry idempotency: all cases pass')
