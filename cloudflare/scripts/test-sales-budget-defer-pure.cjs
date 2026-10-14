// The sales-import apply loop is bounded by the per-invocation D1 call budget (importEngine.ts
// applyHistoricalSalesReceipts + stockQueryBudgetDb in 'call' units).
//
// A historical sales window used to commit up to 600 receipts in one queue invocation: about 6 round trips each, far
// past the 1000 (Paid) / 50 (Free) calls an invocation may make. The loop now stops at a receipt boundary when the
// budget would be crossed, the cursor stops there, and the continuation resumes from it in a fresh invocation.
//
// The real source region is lifted out of importEngine.ts (the budget wrapper, the block helpers and the loop) and run
// against a fake database whose receipt writer follows the real one's shape: a seal read first (a sealed receipt is an
// already-applied no-op after that one read), four more reads, then ONE atomic batch that writes the sale and seals it.
// Every limit from 20 to 160 is swept, each time resuming until the job is done: a receipt must be applied exactly
// once, no invocation may cross its limit, and every invocation must make progress.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts'), 'utf8').replace(/\r\n/g, '\n')
const from = source.indexOf("const STOCK_QUERY_BUDGET = Symbol('stockQueryBudget')")
const to = source.indexOf('async function persistStockResults(')
assert.ok(from > 0 && to > from, 'budget region not found in importEngine.ts -- update this test')
const region = ts.transpileModule(source.slice(from, to), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function load(applyHistoricalSaleImport) {
  const mod = { exports: {} }
  new Function('exports', 'module', 'applyHistoricalSaleImport',
    `${region}
exports.stockQueryBudgetDb = stockQueryBudgetDb; exports.StockQueryBudgetDeferred = StockQueryBudgetDeferred`)(mod.exports, mod, applyHistoricalSaleImport)
  return mod.exports
}

function world(extraReads = () => 0) {
  const sealed = new Set()
  const batches = new Map()
  const stats = { calls: 0 }
  const raw = {
    prepare() {
      const read = async () => { stats.calls++; return undefined }
      return { get: read, all: read, getOnce: read, allOnce: read, run: async () => { stats.calls++; return { changes: 0 } } }
    },
    batch: async (statements) => { stats.calls++; return statements.map(() => ({ meta: { changes: 1 } })) },
  }
  raw.batchOnce = raw.batch
  raw.staging = raw
  const applyHistoricalSaleImport = async (db, input) => {
    await db.prepare('SELECT status FROM import_sales_commits').get()
    if (sealed.has(input.rowNumber)) return { alreadyApplied: true }
    for (let read = 0; read < 4 + extraReads(input.rowNumber); read++) await db.prepare('SELECT 1').get()
    await db.batch([{ sql: 'sale' }, { sql: 'items' }, { sql: 'seal' }])
    sealed.add(input.rowNumber)
    batches.set(input.rowNumber, (batches.get(input.rowNumber) || 0) + 1)
    return { alreadyApplied: false }
  }
  return { raw, sealed, batches, stats, engine: load(applyHistoricalSaleImport) }
}

const receipts = (count) => Array.from({ length: count }, (_, index) => ({ rowNumber: index + 2, data: {} }))
const input = (concurrency) => ({ jobId: 'job-1', nowIso: '2026-10-14T00:00:00.000Z', actor: {}, accrueLoyalty: false, concurrency })
const PRELOOP = 20
const RECEIPT_CALLS = 6

async function invoke(w, limit, list, concurrency, { budgeted = true } = {}) {
  const db = w.engine.stockQueryBudgetDb(w.raw, limit, PRELOOP)
  const budget = db[Object.getOwnPropertySymbols(db).find((s) => String(s) === 'Symbol(stockQueryBudget)')]
  Object.assign(budget, { unit: 'call', enabled: budgeted, reserve: w.engine.SALES_APPLY_TAIL_RESERVE })
  const before = w.stats.calls
  const done = await w.engine.applyHistoricalSalesReceipts(db, list, input(concurrency))
  return { done, calls: w.stats.calls - before + PRELOOP }
}

async function resumeUntilDone(w, limit, count, concurrency, opts, startAt = 0) {
  const all = receipts(count)
  let cursor = startAt
  const invocations = []
  while (cursor < count) {
    assert.ok(invocations.length <= count + 1, `no progress at limit ${limit}`)
    const run = await invoke(w, limit, all.slice(cursor), concurrency, opts)
    invocations.push(run)
    assert.ok(run.done > 0, 'every invocation commits at least one receipt')
    cursor += run.done
  }
  return invocations
}

const outcomesFor = (engine) => (...statuses) => statuses.map((status) => status === 'ok'
  ? { status: 'fulfilled', value: undefined }
  : { status: 'rejected', reason: status === 'deferred' ? new engine.StockQueryBudgetDeferred() : new Error(status) })

async function main() {
  const engine = load()
  const outcomes = outcomesFor(engine)

  // 1. Block size: as many receipts as the remaining calls pay for, never zero, never above the plan concurrency.
  assert.equal(engine.salesApplyBlockSize(960, 12), 12)
  assert.equal(engine.salesApplyBlockSize(40, 12), 5)
  assert.equal(engine.salesApplyBlockSize(8, 12), 1)
  assert.equal(engine.salesApplyBlockSize(3, 12), 1, 'a receipt is always attempted: the loop decides whether it fits')
  assert.equal(engine.salesApplyBlockSize(-4, 6), 1)
  assert.equal(engine.salesApplyBlockSize(500, 6), 6)
  console.log('PASS block size follows the remaining call budget and stays within [1, concurrency]')

  // 2. Where a block stopped: only the receipts committed in order from the front count; a failure is never hidden.
  for (const k of [0, 1, 11, 12, 13]) {
    const size = 14
    const statuses = Array.from({ length: size }, (_, index) => (index < k ? 'ok' : index === k || index % 2 ? 'deferred' : 'ok'))
    const block = engine.resolveSalesApplyBlock(outcomes(...statuses))
    assert.equal(block.prefix, k, `deferred at receipt ${k}: only the committed front counts`)
    assert.equal(block.deferred, k < size, 'a cut block reports the deferral')
    assert.equal(block.failed, false)
  }
  const mixed = engine.resolveSalesApplyBlock(outcomes('ok', 'deferred', 'receipt exploded', 'ok'))
  assert.equal(mixed.failed, true)
  assert.equal(mixed.failure.message, 'receipt exploded')
  assert.equal(mixed.prefix, 1)
  assert.equal(engine.resolveSalesApplyBlock(outcomes('ok', 'ok')).deferred, false)
  console.log('PASS a block stops at the first uncommitted receipt and a real failure outranks a deferral')

  // 3. Where the window ends: before the first unapplied receipt, groups that failed review before it stay final.
  const results = [{ rowNumber: 2 }, { rowNumber: 5 }, { rowNumber: 7 }, { rowNumber: 9 }, { rowNumber: 12 }]
  const groupIndex = new Map([[2, 40], [3, 40], [5, 41], [7, 42], [8, 42], [9, 43], [12, 44]])
  const actionable = [results[0], results[2], results[3], results[4]]
  const full = engine.cutSalesWindowAtFirstUnapplied(results, actionable, 4, groupIndex, 40, 5)
  assert.deepEqual([full.processedUnits, full.persisted.length], [5, 5])
  const cut = engine.cutSalesWindowAtFirstUnapplied(results, actionable, 2, groupIndex, 40, 5)
  assert.equal(cut.processedUnits, 3, 'cursor stops at the group of the first receipt that is not committed')
  assert.deepEqual(cut.persisted.map((r) => r.rowNumber), [2, 5, 7], 'the review failure at group 41 is final; groups from 43 on are re-read')
  const none = engine.cutSalesWindowAtFirstUnapplied(results, actionable, 0, groupIndex, 40, 5)
  assert.deepEqual([none.processedUnits, none.persisted.length], [0, 0])
  console.log('PASS the window ends at the first uncommitted receipt group')

  // 4. Sweep: every limit resumes to completion with each receipt applied exactly once and no invocation over its limit.
  const COUNT = 40
  const costs = []
  for (let limit = PRELOOP + engine.SALES_APPLY_TAIL_RESERVE + RECEIPT_CALLS; limit <= 160; limit++) {
    const w = world()
    const invocations = await resumeUntilDone(w, limit, COUNT, 12)
    assert.equal(w.sealed.size, COUNT, `limit ${limit}: every receipt committed`)
    assert.ok([...w.batches.values()].every((n) => n === 1), `limit ${limit}: no receipt was applied twice`)
    for (const run of invocations) assert.ok(run.calls <= limit, `limit ${limit}: an invocation made ${run.calls} calls`)
    costs.push([limit, invocations.length])
  }
  assert.ok(costs.at(0)[1] > costs.at(-1)[1], 'a larger budget needs fewer invocations')
  console.log(`PASS ${costs.length} budgets from ${costs[0][0]} to ${costs.at(-1)[0]} calls: exactly-once, in budget, always progressing (${costs[0][1]} invocations at the smallest, ${costs.at(-1)[1]} at the largest)`)

  // 5. Control: the same sweep without the budget crosses the limit. If this stopped failing, the sweep above would be
  //    proving nothing.
  {
    const w = world()
    const [run] = await resumeUntilDone(w, 100, COUNT, 12, { budgeted: false })
    assert.ok(run.calls > 100, 'an unbudgeted invocation spends far more than its limit')
    assert.equal(run.done, COUNT)
    console.log(`PASS control: without the budget one invocation makes ${run.calls} calls against a limit of 100`)
  }

  // 6. A mid-block cut leaves later siblings sealed; the replay applies them zero times more.
  {
    const w = world((row) => (row % 3 === 0 ? 12 : 0))
    const limit = PRELOOP + engine.SALES_APPLY_TAIL_RESERVE + 4 * RECEIPT_CALLS
    const first = await invoke(w, limit, receipts(30), 12)
    assert.ok(first.done > 0 && first.done < 30)
    const sealedAhead = [...w.sealed].filter((row) => row - 2 >= first.done).length
    const batchesBefore = [...w.batches.values()].reduce((a, b) => a + b, 0)
    const rest = await resumeUntilDone(w, limit, 30, 12, undefined, first.done)
    assert.ok(rest.length >= 1)
    assert.equal(w.sealed.size, 30)
    assert.ok([...w.batches.values()].every((n) => n === 1))
    assert.ok(sealedAhead > 0, 'the fixture must leave sealed receipts past the cut')
    assert.ok(batchesBefore >= first.done + sealedAhead)
    console.log(`PASS a cut (a heavy receipt overran its estimate) leaves ${sealedAhead} later receipts sealed and the replay does not write them again`)
  }

  // 7. A receipt that cannot fit even in a fresh invocation is refused, not looped forever.
  {
    const w = world()
    await assert.rejects(invoke(w, PRELOOP + engine.SALES_APPLY_TAIL_RESERVE + RECEIPT_CALLS - 1, receipts(3), 12), /One sales receipt exceeds the deployment query budget/)
    console.log('PASS a receipt larger than the whole invocation budget is refused')
  }

  // 8. A genuine receipt failure is thrown after the block settles, never swallowed as a deferral.
  {
    const failing = load(async (db, { rowNumber }) => {
      await db.prepare('SELECT 1').get()
      if (rowNumber === 3) throw new Error('Sale on row 3 has no items')
      return { alreadyApplied: false }
    })
    const raw = world().raw
    const db = failing.stockQueryBudgetDb(raw, 1000, 1)
    await assert.rejects(failing.applyHistoricalSalesReceipts(db, receipts(5), input(12)), /Sale on row 3 has no items/)
    console.log('PASS a real receipt failure is rethrown unchanged')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
