// 6.0.966 -- cancelling exchanges that took several replacement lines back, in steps that each fit one Free invocation, and asking everything first.
//
// Free runs 50 D1 queries per invocation (PLAN_TIER free), so a take-back of 2+ lines is refused by its own admission there. The dialog stays ONE action: the
// server's dry run says whether the plan needs the take-backs one line at a time (`takeBackPerLine`), and then each line is its own COMPLETE return of the
// replacement sale -- a state the shop can stand in -- followed by the one atomic cancel that links them. This file holds the screen's half:
//   1. PER LINE vs ONE RETURN: a small plan makes one single-line return per ticked line; a plan with room makes one return for all of them (unchanged).
//   2. RESUMABLE: a step that fails leaves the finished steps in `taken`; the retry announces them, makes only what is missing, and never makes a step twice.
//   3. NOTHING IS WRITTEN UNTIL EVERYTHING IS ACCEPTED (several exchanges together): the answers, the cancel's dry run and each take-back's own admission are
//      all asked before the first take-back is made, so one refused item leaves nothing behind.
//   4. THE FROZEN REQUEST of a step whose outcome was not seen is resumed, not abandoned or duplicated; the quote the admission read is reused.
//
// Run: node tests/returnReplacementCancelSteps.test.ts
import assert from 'node:assert/strict'
import { buildReturnBulkPayload, type ReturnBulkPayload } from '../src/components/returns/helpers/returnBulkAction.ts'
import * as steps from '../src/components/returns/helpers/returnReplacementCancel.ts'
import {
  composeCancelPayload, defaultAnswer, takeBackReplacement, toggleCancel, type ReplacementLine, type ReplacementOutstanding, type TakeBackDeps, type TakenBack,
} from '../src/components/returns/helpers/returnReplacementCancel.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const line = (id: number): ReplacementLine => ({
  id, sale_item_id: 500 + id, product_id: 9000 + id, product_name: `Item ${id}`, branch_id: 1, batch_id: null, quantity: 1, applied_price_usd: 10, applied_price_khr: 40000,
})
const info = (returnId: number, saleId: number, count: number, extra: Partial<ReplacementOutstanding> = {}): ReplacementOutstanding => ({
  return_id: returnId, sale_id: saleId, receipt_number: `R-${returnId}`, money_precision_version: 1, exchange_rate: 4000,
  lines: Array.from({ length: count }, (_, index) => line(returnId * 100 + index + 1)), ...extra,
})
const rows = [
  { id: 10, status: 'completed', return_type: 'restock', updated_at: 'u10', replacement_sale_id: 77 },
  { id: 12, status: 'completed', return_type: 'restock', updated_at: 'u12', replacement_sale_id: 78 },
]
const frozen = (): ReturnBulkPayload => buildReturnBulkPayload({ rows, field: 'status', source: 'completed', target: 'cancelled', clientRequestId: 'return-bulk-fixed' })
const everything = (outstanding: ReplacementOutstanding) => toggleCancel(defaultAnswer(outstanding), true)

await runTest('1. a small plan: one single-line return per ticked line, each its own step, in order; the cancel links all of them', async () => {
  const exchange = info(10, 77, 5)
  const made: number[][] = []
  const takeBack = async (_o: ReplacementOutstanding, lines: ReplacementLine[]) => { made.push(lines.map((l) => l.id)); return 900 + made.length }
  const sent: ReturnBulkPayload[] = []
  const check = async (payload: ReturnBulkPayload) => { sent.push(payload); return { dryRun: true, ok: true, takeBackPerLine: true } }
  const taken = new Map<number, TakenBack>()
  const payload = await composeCancelPayload({ payload: frozen(), outstanding: new Map([[10, exchange]]), answers: new Map([[10, everything(exchange)]]), taken, takeBack, check })
  assert.deepEqual(made, [[1001], [1002], [1003], [1004], [1005]], 'five steps of one line each')
  assert.deepEqual(payload.items[0].replacement, { return_ids: [901, 902, 903, 904, 905] }, 'one cancel links every step')
  assert.equal(sent.length, 1, 'one dry run for the whole selection')
  assert.deepEqual(sent[0].items[0].replacement?.planned?.length, 5, 'the dry run announces all five lines')
  assert.deepEqual(taken.get(10)?.parts.map((part) => part.lines), [[1001], [1002], [1003], [1004], [1005]], 'every finished step is remembered with the lines it covers')
})

await runTest('1. a plan with room (Paid) is unchanged: ONE return for all the ticked lines', async () => {
  const exchange = info(10, 77, 5)
  const made: number[][] = []
  const takeBack = async (_o: ReplacementOutstanding, lines: ReplacementLine[]) => { made.push(lines.map((l) => l.id)); return 900 }
  for (const answer of [{ dryRun: true, ok: true }, { dryRun: true, ok: true, takeBackPerLine: false }, undefined, null]) {
    made.length = 0
    const payload = await composeCancelPayload({ payload: frozen(), outstanding: new Map([[10, exchange]]), answers: new Map([[10, everything(exchange)]]), taken: new Map(), takeBack, check: async () => answer })
    assert.deepEqual(made, [[1001, 1002, 1003, 1004, 1005]], `one step (${JSON.stringify(answer)})`)
    assert.deepEqual(payload.items[0].replacement, { return_ids: [900] })
  }
})

await runTest('2. a step that fails: the finished steps are kept; the retry announces them, makes ONLY the missing ones, and a third send makes nothing', async () => {
  const exchange = info(10, 77, 5)
  const attempts: number[][] = []
  let failAt = 3
  const takeBack = async (_o: ReplacementOutstanding, lines: ReplacementLine[]) => {
    attempts.push(lines.map((l) => l.id))
    if (attempts.length === failAt) throw Object.assign(new Error('offline'), { code: 'return_v1_unavailable' })
    return 900 + lines[0].id
  }
  const sent: ReturnBulkPayload[] = []
  const check = async (payload: ReturnBulkPayload) => { sent.push(payload); return { takeBackPerLine: true } }
  const taken = new Map<number, TakenBack>()
  const base = { payload: frozen(), outstanding: new Map([[10, exchange]]), answers: new Map([[10, everything(exchange)]]), taken, takeBack, check }
  await assert.rejects(composeCancelPayload(base), /offline/)
  assert.deepEqual(taken.get(10)?.parts.map((part) => part.id), [1901, 1902], 'two steps were made before the third failed, and are remembered')
  failAt = 0
  const done = await composeCancelPayload({ ...base, payload: frozen() })
  assert.deepEqual(attempts, [[1001], [1002], [1003], [1003], [1004], [1005]], 'the retry continues at the failed line; nothing finished is made again')
  assert.deepEqual(sent[1].items[0].replacement, { return_ids: [1901, 1902], planned: [{ sale_item_id: 1503, quantity: 1 }, { sale_item_id: 1504, quantity: 1 }, { sale_item_id: 1505, quantity: 1 }] },
    'the retry\'s dry run names the take-backs that exist and announces only the rest')
  assert.deepEqual(done.items[0].replacement, { return_ids: [1901, 1902, 1903, 1904, 1905] })
  const again = await composeCancelPayload({ ...base, payload: frozen() })
  assert.equal(attempts.length, 6, 'a further send makes no take-back')
  assert.equal(sent.length, 2, 'and has nothing to check')
  assert.deepEqual(again.items[0].replacement, { return_ids: [1901, 1902, 1903, 1904, 1905] })
})

await runTest('3. several exchanges together: one refused take-back leaves nothing written -- every admission is asked before the first take-back', async () => {
  const first = info(10, 77, 2)
  const second = info(12, 78, 2)
  const outstanding = new Map([[10, first], [12, second]])
  const answers = new Map([[10, everything(first)], [12, everything(second)]])
  const order: string[] = []
  const takeBack = async (o: ReplacementOutstanding) => { order.push(`make ${o.return_id}`); return 900 + o.return_id }
  const check = async () => { order.push('check'); return { takeBackPerLine: true } }
  const validateTakeBack = async (o: ReplacementOutstanding, lines: ReplacementLine[]) => {
    order.push(`validate ${o.return_id}:${lines.map((l) => l.id).join(',')}`)
    if (o.return_id === 12 && lines[0].id === 1202) throw Object.assign(new Error('refused'), { code: 'customer_return_over_plan_budget' })
    return { quote: `${o.return_id}` }
  }
  const taken = new Map<number, TakenBack>()
  await assert.rejects(composeCancelPayload({ payload: frozen(), outstanding, answers, taken, takeBack, check, validateTakeBack }), (error: { code?: string }) => error.code === 'customer_return_over_plan_budget')
  assert.deepEqual(order, ['check', 'validate 10:1001', 'validate 10:1002', 'validate 12:1201', 'validate 12:1202'], 'the cancel first, then every take-back; the refusal stops it before any is made')
  assert.equal(taken.size, 0, 'nothing is remembered because nothing was made')
  // The same selection with every admission accepted makes them all, after the checks, and hands the quotes it read to the steps.
  order.length = 0
  const quotes: unknown[] = []
  const accepted = await composeCancelPayload({ payload: frozen(), outstanding, answers, taken, check,
    takeBack: async (o, lines, prepared) => { order.push(`make ${o.return_id}:${lines[0].id}`); quotes.push(prepared); return 900 + lines[0].id },
    validateTakeBack: async (o, lines) => ({ quote: `${o.return_id}:${lines[0].id}` }) })
  assert.deepEqual(order, ['check', 'make 10:1001', 'make 10:1002', 'make 12:1201', 'make 12:1202'])
  assert.deepEqual(quotes, [{ quote: '10:1001' }, { quote: '10:1002' }, { quote: '12:1201' }, { quote: '12:1202' }], 'each step reuses the quote its own admission read')
  assert.deepEqual(accepted.items.map((item) => item.replacement), [{ return_ids: [1901, 1902] }, { return_ids: [1201, 1202].map((id) => 900 + id) }])
})

await runTest('3. a refused cancel (dry run) or an unready answer in ANY exchange stops everything before an admission is asked or a take-back made', async () => {
  const first = info(10, 77, 2)
  const second = info(12, 78, 2)
  const outstanding = new Map([[10, first], [12, second]])
  const touched: string[] = []
  const takeBack = async (o: ReplacementOutstanding) => { touched.push(`make ${o.return_id}`); return 1 }
  const validateTakeBack = async (o: ReplacementOutstanding) => { touched.push(`validate ${o.return_id}`); return null }
  // The cancel is refused (price floor, change, budget, permissions): no admission, no take-back.
  await assert.rejects(composeCancelPayload({ payload: frozen(), outstanding, answers: new Map([[10, everything(first)], [12, everything(second)]]), taken: new Map(), takeBack, validateTakeBack,
    check: async () => { throw Object.assign(new Error('floor'), { code: 'return_replacement_price_forbidden' }) } }), (error: { code?: string }) => error.code === 'return_replacement_price_forbidden')
  assert.deepEqual(touched, [])
  // The second exchange ticks the box and no line: refused locally before the dry run is even sent.
  const unticked = { cancel: true, picked: new Set<number>() }
  const sent: string[] = []
  await assert.rejects(composeCancelPayload({ payload: frozen(), outstanding, answers: new Map([[10, everything(first)], [12, unticked]]), taken: new Map(), takeBack, validateTakeBack,
    check: async () => { sent.push('check'); return {} } }), (error: { code?: string }) => error.code === 'return_cancel_replacement_pick_one')
  assert.deepEqual([touched, sent], [[], []], 'not even the dry run is sent')
})

function v1Deps(overrides: Partial<TakeBackDeps> = {}, log: string[] = []): TakeBackDeps {
  return {
    userId: 7, reason: 'r',
    getReturnQuoteV1: async () => { log.push('quote'); return { quote: true } },
    prepareReturnCreateV1: async () => { log.push('prepare'); return { bodyJson: '{"fresh":true}' } },
    submitReturnCreateV1: async (_actor, pending) => { log.push(`submit ${(pending as { bodyJson: string }).bodyJson}`); return { id: 321 } },
    clearPendingReturnCreateV1: async () => { log.push('clear') },
    createReturn: async () => ({ id: 654 }),
    legacyIdentity: (returnId, signature) => ({ client_request_id: `c-${returnId}-${signature.length}`, return_number: `RET-${returnId}` }),
    ...overrides,
  }
}

await runTest('4. a frozen request left by an unseen outcome is resumed (same request id), not abandoned; any other pending request is not ours', async () => {
  const exchange = info(10, 77, 2)
  const target = [exchange.lines[0]]
  const matching = JSON.stringify({ client_request_id: 'return-abc', sale_id: 77, items: [{ sale_item_id: target[0].sale_item_id, quantity: 1 }] })
  const log: string[] = []
  const id = await takeBackReplacement(v1Deps({ loadPendingReturnCreateV1: () => ({ bodyJson: matching }) }, log), exchange, target)
  assert.equal(id, 321)
  assert.deepEqual(log, [`submit ${matching}`, 'clear'], 'the saved request is submitted as it was and then cleared; nothing new is quoted or prepared')
  // A different pending request (another sale, another line, an exchange) is left alone: a new one is prepared, which reports the pending one.
  for (const other of [
    JSON.stringify({ sale_id: 99, items: [{ sale_item_id: target[0].sale_item_id, quantity: 1 }] }),
    JSON.stringify({ sale_id: 77, items: [{ sale_item_id: 999, quantity: 1 }] }),
    JSON.stringify({ sale_id: 77, items: [{ sale_item_id: target[0].sale_item_id, quantity: 1 }], replacement_items: [{ product_id: 1 }] }),
    'not json',
  ]) {
    const again: string[] = []
    await takeBackReplacement(v1Deps({ loadPendingReturnCreateV1: () => ({ bodyJson: other }) }, again), exchange, target)
    assert.deepEqual(again.slice(0, 2), ['quote', 'prepare'], `${other.slice(0, 40)} is not resumed`)
  }
})

await runTest('4. the quote the admission read is reused; validateTakeBack asks the quote only for a money-v1 sale and writes nothing', async () => {
  const exchange = info(10, 77, 2)
  const log: string[] = []
  const deps = v1Deps({}, log)
  const quote = await steps.validateTakeBack(deps, exchange, exchange.lines)
  assert.deepEqual([quote, log], [{ quote: true }, ['quote']])
  log.length = 0
  await takeBackReplacement(deps, exchange, exchange.lines, quote)
  assert.deepEqual(log, ['prepare', 'submit {"fresh":true}', 'clear'], 'no second quote')
  const legacy = info(12, 78, 1, { money_precision_version: 0 })
  log.length = 0
  assert.equal(await steps.validateTakeBack(deps, legacy, legacy.lines), null, 'a legacy replacement sale has no quote to ask')
  assert.deepEqual(log, [])
  await assert.rejects(steps.validateTakeBack(deps, exchange, [{ ...line(1), sale_item_id: null }]), (error: { code?: string }) => error.code === 'return_v1_review_required')
  await assert.rejects(steps.validateTakeBack(deps, exchange, []), (error: { code?: string }) => error.code === 'return_v1_review_required')
})

if (failed > 0) process.exitCode = 1
