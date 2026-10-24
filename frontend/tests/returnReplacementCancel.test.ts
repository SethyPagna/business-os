// 6.0.958 (owner, 22 Oct 2026): "if cancel, ask if replacement also cancel, if so, choose some or all."
//
// Cancelling a return that opened a replacement sale asks what happens to the replacement items still with the customer. The Worker refuses the
// cancel until the request says (cloudflare/scripts/test-return-exchange-cancel-native.cjs drives every stock and money consequence on workerd + D1);
// this test holds the screen's half:
//   1. THE QUESTION: only completed customer returns that opened a replacement sale, only on completed -> cancelled, are asked; the default keeps the
//      replacement; cancelling needs at least one ticked line; "some" and "all" are the ticked lines.
//   2. THE REQUEST: the answers ride on the frozen bulk payload (items[i].replacement.return_ids), sorted, and touch nothing else.
//   3. TAKING UNITS BACK: an ordinary return of the replacement sale -- the money-v1 quote -> frozen request -> create, or the legacy body with the
//      recorded line prices -- covering every outstanding unit of every ticked line, made once even if the cancel is sent again.
//   4. THE DIALOG, rendered: the question is part of the one shared review (no second confirm, never the browser's confirm()), Apply waits for the
//      look-up, a failed look-up never traps the operator, and the box is disabled (not hidden) without permission to add returns.
//   5. THE PACKS: every new sentence exists in English and Khmer, and the inline fallbacks are the pack's.
//
// Run: node tests/returnReplacementCancel.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { buildReturnBulkPayload, type ReturnBulkPayload } from '../src/components/returns/helpers/returnBulkAction.ts'
import {
  answerReady, composeCancelPayload, defaultAnswer, outstandingFromRefusal, parseOutstanding, pickedLines, resolveReplacementChoices, rowsNeedingReplacementAnswer,
  takeBackReplacement, takeBackSignature, toggleCancel, toggleLine, withReplacementChoices,
  type ReplacementLine, type ReplacementOutstanding, type TakeBackDeps, type TakenBack,
} from '../src/components/returns/helpers/returnReplacementCancel.ts'
import { bulkDialogDependency, NOT_BULK_DIALOG_DEPENDENCY } from './bulkFieldChangeDialogShim.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(path.join(here, ...parts), 'utf8').replace(/\r\n?/g, '\n')

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const line = (id: number, extra: Partial<ReplacementLine> = {}): ReplacementLine => ({
  id, sale_item_id: 500 + id, product_id: 9000 + id, product_name: `Item ${id}`, branch_id: 1, batch_id: null, quantity: 1, applied_price_usd: 16, applied_price_khr: 64000, ...extra,
})
const info = (returnId: number, extra: Partial<ReplacementOutstanding> = {}): ReplacementOutstanding => ({
  return_id: returnId, sale_id: 77, receipt_number: '20261022-1', money_precision_version: 1, exchange_rate: 4000, lines: [line(1), line(2, { quantity: 2, applied_price_usd: 6.48, applied_price_khr: 25920 })], ...extra,
})
const wire = (value: ReplacementOutstanding) => JSON.parse(JSON.stringify(value))

await runTest('1. only completed customer returns that opened a replacement sale are asked, and only when cancelling', () => {
  const rows = [
    { id: 1, status: 'completed', return_scope: 'customer', replacement_sale_id: 70 },
    { id: 2, status: 'completed', return_scope: 'customer', replacement_sale_id: null },
    { id: 3, status: 'cancelled', return_scope: 'customer', replacement_sale_id: 71 },
    { id: 4, status: 'completed', return_scope: 'supplier', replacement_sale_id: 72 },
    { id: 5, status: null, return_scope: null, replacement_sale_id: '73' },
    { id: 6, status: 'completed', return_scope: 'customer' },
  ]
  assert.deepEqual(rowsNeedingReplacementAnswer(rows, 'status', 'completed', 'cancelled'), [1, 5])
  assert.deepEqual(rowsNeedingReplacementAnswer(rows, 'status', 'cancelled', 'completed'), [], 'a restore asks nothing')
  assert.deepEqual(rowsNeedingReplacementAnswer(rows, 'return_type', 'completed', 'cancelled'), [], 'a method change asks nothing')
})

await runTest('1. the default keeps the replacement; cancelling needs a ticked line; some and all are the ticked lines', () => {
  const i = info(10)
  const keep = defaultAnswer(i)
  assert.equal(keep.cancel, false)
  assert.deepEqual(pickedLines(i, keep), [], 'nothing is taken back unless the box is on')
  assert.equal(answerReady(i, keep), true)
  const all = toggleCancel(keep, true)
  assert.deepEqual(pickedLines(i, all).map((l) => l.id), [1, 2], 'turning the box on starts with every line ticked: all')
  const some = toggleLine(all, 1)
  assert.deepEqual(pickedLines(i, some).map((l) => l.id), [2], 'unticking a line leaves it with the customer: some')
  assert.equal(answerReady(i, toggleLine(some, 2)), false, 'cancelling with no line ticked is not an answer')
  assert.equal(answerReady(i, toggleCancel(toggleLine(some, 2), false)), true, 'unticking the box makes it "keep" again')
  assert.deepEqual(pickedLines(i, toggleLine(some, 1)).map((l) => l.id), [1, 2], 'ticking a line back restores it')
  assert.deepEqual([...keep.picked], [1, 2], 'the starting answer is not mutated by a toggle')
})

await runTest('1. the Worker\'s answer is validated: anything malformed is not an outstanding replacement', () => {
  assert.deepEqual(parseOutstanding(wire(info(10))), info(10))
  assert.equal(parseOutstanding(null), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), lines: [] }), null, 'nothing left is not a question')
  assert.equal(parseOutstanding({ ...wire(info(10)), return_id: 0 }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), sale_id: '77' }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), lines: [{ ...line(1), quantity: 0 }] }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), lines: [{ ...line(1), sale_item_id: 'x' }] }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), lines: [{ ...line(1), applied_price_usd: -1 }] }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), lines: [{ ...line(1), id: 'a' }] }), null)
  assert.equal(parseOutstanding({ ...wire(info(10)), money_precision_version: 7 })?.money_precision_version, 0, 'an unknown version is treated as legacy, never as v1')
  const refusal = (extra: object) => Object.assign(new Error('x'), { status: 409, code: 'return_cancel_replacement_choice_required', ...extra })
  assert.deepEqual(outstandingFromRefusal(refusal({ replacements: [wire(info(10)), wire(info(11))] }))?.map((r) => r.return_id), [10, 11])
  assert.equal(outstandingFromRefusal(refusal({ replacements: [wire(info(10)), { return_id: 11 }] })), null, 'one bad entry spoils the list')
  assert.equal(outstandingFromRefusal(refusal({ replacements: null })), null)
  assert.equal(outstandingFromRefusal(Object.assign(new Error('x'), { code: 'write_conflict', replacements: [wire(info(10))] })), null, 'another refusal is not this one')
  assert.equal(outstandingFromRefusal(null), null)
})

const rows = [
  { id: 10, status: 'completed', return_type: 'restock', updated_at: 'u10', replacement_sale_id: 77 },
  { id: 11, status: 'completed', return_type: 'refund', updated_at: 'u11' },
  { id: 12, status: 'completed', return_type: 'restock', updated_at: 'u12', replacement_sale_id: 78 },
]
const frozen = () => buildReturnBulkPayload({ rows, field: 'status', source: 'completed', target: 'cancelled', clientRequestId: 'return-bulk-fixed' })

await runTest('2. the answers ride on the frozen payload, sorted, and touch nothing else', () => {
  const payload = frozen()
  const before = JSON.stringify(payload)
  const next = withReplacementChoices(payload, new Map([[12, []], [10, [905, 903]]]))
  assert.equal(JSON.stringify(payload), before, 'the frozen payload is not mutated')
  assert.deepEqual(next.items.map((item) => [item.id, item.replacement ?? null]), [[10, { return_ids: [903, 905] }], [11, null], [12, { return_ids: [] }]])
  assert.equal(next.client_request_id, 'return-bulk-fixed', 'the retry id is the one already frozen')
  assert.deepEqual({ ...next, items: undefined }, { ...payload, items: undefined })
  assert.deepEqual(next.items[1], payload.items[1], 'a return with no replacement is untouched')
  assert.deepEqual(withReplacementChoices(payload, new Map()), payload)
})

// ---- 3. taking units back ----------------------------------------------------------------------------------------------------------------
function deps(overrides: Partial<TakeBackDeps> = {}, log: Array<[string, unknown]> = []): { deps: TakeBackDeps; log: Array<[string, unknown]> } {
  const result: TakeBackDeps = {
    userId: 7, reason: 'Replacement items cancelled with the return',
    getReturnQuoteV1: async (saleId, items) => { log.push(['quote', { saleId, items }]); return { quote: true } },
    prepareReturnCreateV1: async (actorId, payload, quote) => { log.push(['prepare', { actorId, payload, quote }]); return { pending: true } },
    submitReturnCreateV1: async (actorId, pending) => { log.push(['submit', { actorId, pending }]); return { id: 321, returnNumber: 'RET-1', replacementSaleId: null, replacementReceiptNumber: null } },
    clearPendingReturnCreateV1: async (actorId, pending) => { log.push(['clear', { actorId, pending }]) },
    createReturn: async (payload) => { log.push(['legacy', payload]); return { id: 654 } },
    legacyIdentity: (returnId, signature) => ({ client_request_id: `return-${returnId}-${signature.length}`, return_number: `RET-${returnId}` }),
    ...overrides,
  }
  return { deps: result, log }
}

await runTest('3. a money-v1 replacement is taken back through the same quote -> frozen request -> create, for every outstanding unit of the ticked lines', async () => {
  const { deps: d, log } = deps()
  const i = info(10)
  const id = await takeBackReplacement(d, i, i.lines)
  assert.equal(id, 321)
  assert.deepEqual(log.map(([step]) => step), ['quote', 'prepare', 'submit', 'clear'], 'quote first, the frozen request next, and the request is cleared once it is recorded')
  assert.deepEqual(log[0][1], { saleId: 77, items: [{ sale_item_id: 501, quantity: 1 }, { sale_item_id: 502, quantity: 2 }] }, 'all outstanding units of both lines, on the REPLACEMENT sale')
  const prepared = (log[1][1] as { payload: Record<string, unknown>; quote: unknown })
  const { client_request_id: takeBackId, ...preparedBody } = prepared.payload as Record<string, unknown>
  assert.match(String(takeBackId), /^rtb-10_.{8,}$/, 'the take-back carries the mark the Worker finds the take-backs of an exchange by')
  assert.deepEqual(preparedBody, { reason: 'Replacement items cancelled with the return', return_type: 'restock', notes: null, branch_id: 1,
    items: [{ sale_item_id: 501, quantity: 1, stock_action: 'restock', branch_id: 1 }, { sale_item_id: 502, quantity: 2, stock_action: 'restock', branch_id: 1 }] })
  assert.deepEqual(prepared.quote, { quote: true }, 'the request is frozen against the quote just read')
  assert.deepEqual((log[2][1] as { pending: unknown }).pending, { pending: true })
  assert.deepEqual((log[3][1] as { pending: unknown }).pending, { pending: true })
})

await runTest('3. some: only the ticked line is covered; a failed create leaves the frozen request in place and answers no id', async () => {
  const only = info(10).lines.slice(1)
  const { deps: d, log } = deps()
  await takeBackReplacement(d, info(10), only)
  assert.deepEqual((log[0][1] as { items: unknown }).items, [{ sale_item_id: 502, quantity: 2 }])
  const failing = deps({ submitReturnCreateV1: async () => { throw Object.assign(new Error('offline'), { code: 'return_v1_unavailable' }) } })
  await assert.rejects(takeBackReplacement(failing.deps, info(10), only), /offline/)
  assert.ok(!failing.log.some(([step]) => step === 'clear'), 'an unconfirmed create keeps the saved request so it can only be retried as it was')
  const noId = deps({ submitReturnCreateV1: async () => ({ id: 0 }) })
  await assert.rejects(takeBackReplacement(noId.deps, info(10), only), (error: { code?: string }) => error.code === 'return_v1_pending', 'a reply without a return id is an unknown outcome')
  await assert.rejects(takeBackReplacement(d, info(10), []), (error: { code?: string }) => error.code === 'return_v1_review_required', 'nothing ticked takes nothing back')
  await assert.rejects(takeBackReplacement(d, info(10), [line(1, { sale_item_id: null })]), (error: { code?: string }) => error.code === 'return_v1_review_required')
})

await runTest('3. a legacy replacement sale is returned with the legacy body at the recorded line prices', async () => {
  const { deps: d, log } = deps()
  const legacy = info(12, { money_precision_version: 0, exchange_rate: 4100 })
  const id = await takeBackReplacement(d, legacy, legacy.lines)
  assert.equal(id, 654)
  assert.deepEqual(log.map(([step]) => step), ['legacy'], 'no v1 quote for a legacy sale')
  const body = log[0][1] as Record<string, unknown>
  assert.deepEqual({ ...body, items: undefined }, {
    client_request_id: `return-12-${takeBackSignature(legacy.lines).length}`, return_number: 'RET-12', sale_id: 77, receipt_number: '20261022-1', branch_id: 1,
    reason: 'Replacement items cancelled with the return', return_type: 'restock', notes: null, exchange_rate: 4100, total_refund_usd: 28.96, total_refund_khr: 115840, items: undefined,
  })
  assert.deepEqual(body.items, [
    { sale_item_id: 501, product_id: 9001, product_name: 'Item 1', quantity: 1, applied_price_usd: 16, applied_price_khr: 64000, return_to_stock: true, stock_action: 'restock', branch_id: 1 },
    { sale_item_id: 502, product_id: 9002, product_name: 'Item 2', quantity: 2, applied_price_usd: 6.48, applied_price_khr: 25920, return_to_stock: true, stock_action: 'restock', branch_id: 1 },
  ])
})

await runTest('3. the cancel is sent once its units are back; a second send links the SAME return and never takes the units back twice', async () => {
  const outstanding = new Map([[10, info(10)], [12, info(12)]])
  const taken = new Map<number, TakenBack>()
  const calls: Array<[number, number[]]> = []
  const takeBack = async (o: ReplacementOutstanding, lines: ReplacementLine[]) => { calls.push([o.return_id, lines.map((l) => l.id)]); return 900 + o.return_id }
  const answers = new Map([[10, toggleLine(toggleCancel(defaultAnswer(info(10)), true), 1)], [12, defaultAnswer(info(12))]])
  const first = await composeCancelPayload({ payload: frozen(), outstanding, answers, taken, takeBack })
  assert.deepEqual(calls, [[10, [2]]], 'return 10 takes line 2 back; return 12 keeps its replacement and takes nothing')
  assert.deepEqual(first.items.map((item) => item.replacement ?? null), [{ return_ids: [910] }, null, { return_ids: [] }])
  const again = await composeCancelPayload({ payload: frozen(), outstanding, answers, taken, takeBack })
  assert.deepEqual(calls, [[10, [2]]], 'no second take-back for the same choice')
  assert.deepEqual(again.items.map((item) => item.replacement ?? null), [{ return_ids: [910] }, null, { return_ids: [] }])
  // The choice cannot change once units are back; the dialog locks it, and the flow refuses if it is changed anyway.
  const changed = new Map(answers).set(10, toggleCancel(defaultAnswer(info(10)), true))
  await assert.rejects(composeCancelPayload({ payload: frozen(), outstanding, answers: changed, taken, takeBack }), (error: { code?: string }) => error.code === 'return_cancel_replacement_changed')
  assert.deepEqual(calls, [[10, [2]]])
})

await runTest('3. a dry run of the cancel is sent BEFORE any take-back is made; a refused check leaves nothing behind (6.0.964)', async () => {
  const outstanding = new Map([[10, info(10)], [12, info(12)]])
  const answers = new Map([[10, toggleLine(toggleCancel(defaultAnswer(info(10)), true), 1)], [12, defaultAnswer(info(12))]])
  const order: string[] = []
  const sent: ReturnBulkPayload[] = []
  const takeBack = async (o: ReplacementOutstanding, _lines: ReplacementLine[]) => { order.push(`take-back ${o.return_id}`); return 900 + o.return_id }
  const check = async (payload: ReturnBulkPayload) => { order.push('check'); sent.push(payload) }
  const taken = new Map<number, TakenBack>()
  const first = await composeCancelPayload({ payload: frozen(), outstanding, answers, taken, takeBack, check, makeRequestId: () => 'return-bulk-dry-0001' })
  assert.deepEqual(order, ['check', 'take-back 10'], 'the check comes first, then the take-back')
  assert.equal(sent[0].dry_run, true)
  assert.equal(sent[0].client_request_id, 'return-bulk-dry-0001')
  assert.deepEqual(sent[0].items.map((item) => item.replacement ?? null).map((choice) => choice && { ids: choice.return_ids, planned: choice.planned?.length ?? 0 }),
    [{ ids: [], planned: 1 }, null, { ids: [], planned: 0 }], 'the units about to be taken back are announced by sale line; a return that keeps its replacement says so')
  assert.equal(first.dry_run, undefined, 'the real cancel is not a dry run')
  // A refused check: the take-back is never made.
  const refused: string[] = []
  await assert.rejects(composeCancelPayload({ payload: frozen(), outstanding, answers, taken: new Map(), takeBack: async (o) => { refused.push('take-back'); return o.return_id },
    check: async () => { throw Object.assign(new Error('over plan'), { code: 'return_bulk_over_plan_budget' }) } }), (error: { code?: string }) => error.code === 'return_bulk_over_plan_budget')
  assert.deepEqual(refused, [], 'no take-back after a refused check')
  // A retry whose take-back already exists is linked, not announced again; with nothing left to make there is no check at all.
  order.length = 0
  await composeCancelPayload({ payload: frozen(), outstanding, answers, taken, takeBack, check })
  assert.deepEqual(order, [], 'the take-back exists already: nothing to check, nothing to make')
  // Keeping every replacement needs no take-back, so no check either.
  await composeCancelPayload({ payload: frozen(), outstanding, answers: new Map([[10, defaultAnswer(info(10))], [12, defaultAnswer(info(12))]]), taken: new Map(), takeBack, check })
  assert.deepEqual(order, [])
})

await runTest('3. nothing is sent unless every answer is ready; an unready answer takes nothing back first', async () => {
  const outstanding = new Map([[10, info(10)], [12, info(12)]])
  const answers = new Map([[12, toggleCancel(defaultAnswer(info(12)), true)], [10, toggleLine(toggleLine(toggleCancel(defaultAnswer(info(10)), true), 1), 2)]])
  const calls: number[] = []
  await assert.rejects(resolveReplacementChoices({ outstanding, answers, taken: new Map(), takeBack: async (o) => { calls.push(o.return_id); return 1 } }),
    (error: { code?: string }) => error.code === 'return_cancel_replacement_pick_one')
  assert.deepEqual(calls, [], 'return 10 is checked before return 12 takes anything back')
  // Without permission to add returns every answer is "keep" and nothing is made.
  const noAdd = await composeCancelPayload({ payload: frozen(), outstanding, answers: new Map([[10, toggleCancel(defaultAnswer(info(10)), true)]]), taken: new Map() })
  assert.deepEqual(noAdd.items.map((item) => item.replacement ?? null), [{ return_ids: [] }, null, { return_ids: [] }])
  // No exchange return at all: the payload is returned as it was frozen.
  const plain = frozen()
  assert.equal(await composeCancelPayload({ payload: plain, outstanding: new Map(), answers: new Map(), taken: new Map() }), plain)
})

// ---- 4. the dialog, rendered ---------------------------------------------------------------------------------------------------------------------------
type AnyProps = Record<string, any>
// The component under test imports the helper module, which is TypeScript: both are compiled here, the helper's only import being a type.
function compileHelper(file: string): Record<string, unknown> {
  const compiled = transformSync(read('..', 'src', 'components', 'returns', 'helpers', file), { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, unknown> }
  // The cancel helper takes the request-id maker from the bulk helper (a value import since 6.0.964).
  const resolve = (id: string): unknown => id.endsWith('/returnBulkAction.ts') ? compileHelper('returnBulkAction.ts') : nodeRequire(id)
  new Function('require', 'module', 'exports', compiled)(resolve, mod, mod.exports)
  return mod.exports
}
const helperCancel = compileHelper('returnReplacementCancel.ts')
const listComponent = ((): ((props: AnyProps) => unknown) => {
  const source = read('..', 'src', 'components', 'returns', 'ReplacementChoiceList.tsx')
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.endsWith('/returnReplacementCancel.ts')) return helperCancel
    const dialogDependency = bulkDialogDependency(id, shim)
    if (dialogDependency !== NOT_BULK_DIALOG_DEPENDENCY) return dialogDependency
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(shim, mod, mod.exports)
  return mod.exports.default as (props: AnyProps) => unknown
})()

const tr = (_key: string, english: string) => english
const choiceItem = (answer = defaultAnswer(info(10)), locked = false) => ({ outstanding: info(10), returnNumber: 'RET-10', answer, locked })
const renderList = (props: AnyProps): string => renderToStaticMarkup(React.createElement(listComponent, {
  items: [choiceItem()], loading: false, failed: false, canTakeBack: true, disabled: false, tr, fmtUSD: (n: number) => `$${n.toFixed(2)}`,
  onToggleCancel: () => {}, onToggleLine: () => {}, onRetry: () => {}, ...props,
}))

await runTest('4. the question renders as one box per return, off by default; turning it on lists every line, all ticked', () => {
  const off = renderList({})
  assert.match(off, /Also cancel the replacement items/)
  assert.match(off, /RET-10 → 20261022-1/)
  assert.equal((off.match(/type="checkbox"/g) || []).length, 1, 'only the box until it is turned on')
  assert.doesNotMatch(off, /checked=""/, 'the replacement stays by default')
  const on = renderList({ items: [choiceItem(toggleCancel(defaultAnswer(info(10)), true))] })
  assert.equal((on.match(/type="checkbox"/g) || []).length, 3, 'the box and one tick per line')
  assert.equal((on.match(/checked=""/g) || []).length, 3, 'box on, both lines ticked: all')
  assert.match(on, /Item 1 × 1/)
  assert.match(on, /Item 2 × 2/)
  assert.match(on, /\$16\.00/)
  assert.match(on, /\$12\.96/, 'a line shows its units times its recorded price')
  const some = renderList({ items: [choiceItem(toggleLine(toggleCancel(defaultAnswer(info(10)), true), 1))] })
  assert.equal((some.match(/checked=""/g) || []).length, 2, 'box on, one line ticked: some')
  const none = renderList({ items: [choiceItem(toggleLine(toggleLine(toggleCancel(defaultAnswer(info(10)), true), 1), 2))] })
  assert.match(none, /role="alert"[^>]*>Tick at least one replacement item/, 'cancelling with nothing ticked says so')
})

await runTest('4. without permission to add returns the box is disabled, not hidden, and says why; a locked choice cannot change', () => {
  const noAdd = renderList({ canTakeBack: false })
  assert.match(noAdd, /Also cancel the replacement items/)
  assert.match(noAdd, /disabled=""/)
  assert.match(noAdd, /needs permission to add returns/)
  const locked = renderList({ items: [choiceItem(toggleCancel(defaultAnswer(info(10)), true), true)] })
  assert.equal((locked.match(/disabled=""/g) || []).length, 3, 'the box and both lines are fixed once the units are back')
  assert.match(locked, /already returned/)
  assert.equal((renderList({ disabled: true }).match(/disabled=""/g) || []).length, 1, 'saving freezes the box')
})

await runTest('4. while the look-up runs the dialog says so; if it fails there is a retry and no trap', () => {
  const loading = renderList({ loading: true })
  assert.match(loading, /role="status"/)
  assert.match(loading, /Checking the replacement items/)
  assert.doesNotMatch(loading, /type="checkbox"/)
  const failedMarkup = renderList({ failed: true })
  assert.match(failedMarkup, /role="alert"/)
  assert.match(failedMarkup, /could not be checked/)
  assert.match(failedMarkup, /<button[^>]*aria-label="Retry"[^>]*title="Retry"/, 'the retry is an icon button with its name')
  assert.equal(renderList({ items: [] }), '', 'nothing left with the customer: no question')
})

const modalSource = read('..', 'src', 'components', 'returns', 'ReturnsBulkActionModal.tsx')
const pageSource = read('..', 'src', 'components', 'returns', 'Returns.tsx')

await runTest('4. the question is part of the shared review: no second confirm, Apply waits for the look-up, a failed look-up never blocks it', () => {
  assert.doesNotMatch(modalSource + read('..', 'src', 'components', 'returns', 'ReplacementChoiceList.tsx'), /\bconfirm\(|window\.confirm/, 'never the browser\'s confirm()')
  assert.match(modalSource, /list=\{askIds\.length \? \(\s*<ReplacementChoiceList/, 'the choices sit in the shared review\'s list slot')
  assert.match(modalSource, /<BulkFieldChangeDialog/)
  const canApply = /const canApply = ([^\n]+)\n/.exec(modalSource)?.[1] ?? ''
  assert.match(canApply, /lookup !== 'loading'/, 'Apply waits for the look-up')
  assert.match(canApply, /answersReady/, 'and for every answer to be ready')
  assert.doesNotMatch(canApply, /failed/, 'a failed look-up does not block Apply: the Worker names the lines itself')
  assert.match(modalSource, /const fresh = outstandingFromRefusal\(error\)\s+if \(fresh\) \{ absorb\(fresh\); setLookup\('ready'\) \}/, 'a refused cancel brings its lines into the dialog')
  assert.match(modalSource, /composeCancelPayload\(\{ payload, outstanding, answers, taken: taken\.current, takeBack: canTakeBack \? takeBack : undefined, validateTakeBack, check: onCheck \}\)/, 'the request is composed by the tested helper: the dry run and every take-back admission first')
  assert.match(modalSource, /await onApply\(payload\)\s+onClose\(\)/, 'the dialog closes only after the cancel is recorded')
})

await runTest('4. the page wires the look-up to the return\'s fresh detail and the take-back to the add-returns grant', () => {
  assert.match(pageSource, /const canAddReturn = can\('returns', 'add'\)/)
  assert.match(pageSource, /getReturn\(returnId, \{ fresh: true \}\)/, 'the question is asked of the current state, never a cached read')
  assert.match(pageSource, /parseOutstanding\(detail\?\.replacement_outstanding\)/)
  assert.match(pageSource, /canTakeBack=\{canAddReturn\}/)
  assert.match(pageSource, /loadOutstanding=\{loadReplacementOutstanding\}/)
  assert.match(pageSource, /takeBack=\{takeBackReplacementLines\}/)
  assert.match(pageSource, /validateTakeBack=\{validateReplacementLines\}/, 'every take-back is asked before the first is made (6.0.966)')
  assert.match(pageSource, /legacyIdentity: \(returnId, signature\) =>/, 'a legacy take-back keeps one request identity per choice')
  const transportSource = read('..', 'src', 'api', 'returnsTransport.ts')
  assert.match(transportSource, /return apiFetch\('POST', '\/api\/returns\/bulk', payload\)/, 'the cancel is still the one grouped request')
  assert.match(read('..', 'src', 'api', 'http.ts'), /error\.replacements = Array\.isArray\(parsed\?\.replacements\) \? parsed\.replacements : null/, 'the API error carries the Worker\'s list of lines')
})

// ---- 5. the packs ----------------------------------------------------------------------------------------------------------------------------------------
const en = JSON.parse(read('..', 'src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('..', 'src', 'lang', 'km.json')) as Record<string, string>
await runTest('5. every new sentence exists in English and Khmer, and the inline fallbacks are the pack\'s', () => {
  const keys = ['return_cancel_replacement_also', 'return_cancel_replacement_checking', 'return_cancel_replacement_load_failed', 'return_cancel_replacement_hint', 'return_cancel_replacement_need_add',
    'return_cancel_replacement_pick_one', 'return_cancel_replacement_taken', 'return_cancel_replacement_reason', 'return_cancel_replacement_changed',
    'return_cancel_replacement_choice_required', 'return_cancel_replacement_invalid', 'return_bulk_over_plan_budget', 'return_cancel_replacement_not_paid', 'return_restore_exchange_credit', 'return_cancel_exchange_change', 'return_exchange_line_no_lot', 'refund_credit']
  for (const key of keys) {
    assert.ok(String(en[key] || '').trim(), `en.${key}`)
    assert.match(String(km[key] || ''), /[ក-៿]/, `km.${key} is Khmer`)
  }
  const sources = [modalSource, read('..', 'src', 'components', 'returns', 'ReplacementChoiceList.tsx'), pageSource]
  let checked = 0
  for (const source of sources) {
    for (const [, key, english, khmer] of source.matchAll(/tr\('(return_cancel_replacement_[a-z_]+)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\)/g)) {
      assert.equal(english, en[key], `${key} English fallback`)
      assert.equal(khmer, km[key], `${key} Khmer fallback`)
      checked += 1
    }
  }
  assert.ok(checked >= 8, `checked ${checked} inline fallbacks`)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('PASS return replacement cancel: the question, the request, the take-back, the dialog and the packs')
