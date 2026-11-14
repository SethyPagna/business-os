'use strict'
// Stored daily sales totals: the exact-fraction text, the payload rules, the claim / commit protocol, epoch rules, refusals, quarantine and the owner alert.
//   A. fraction text: round trip against the kernel's own ReportExactDecimal, canonical-only, exact order-free sums, and the CONTROL that rounding per day
//      differs from rounding the summed day totals (so the test fails if a reader rounds a day before adding).
//   B. payload: canonical key-sorted text, validation, decode tolerance.
//   C. which stored days a reader may serve (state, kernel version, epoch, refusal, coverage, quarantine, maintenance).
//   D. the protocol over a REAL migrated chain (node:sqlite, every migration incl. 0308): recover, claim, commit, a write between claim and commit,
//      two recomputes at once, an epoch change during the read, per-run limits (Free and Paid), payload size refusal, kernel refusal.
//   E. the nightly reconcile: match, mismatch -> day dirty + quarantine + ONE alert + analytics, no second alert, write between the looks is not judged,
//      the rotating older slice wraps; the alert is injected, so no real chat is ever reached.
// Run (from cloudflare/): node scripts/test-sales-daily-claim-protocol-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
const ROOT = path.join(__dirname, '..')
const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8').replace(/\r\n/g, '\n'))

let rawDb = null
const dbShim = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p) || [],
      run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => rawDb.batch(items),
}
const cache = new Map()
const overrides = new Map([[path.normalize(path.join(SRC, 'lib/db.ts')), { getDb: () => dbShim }]])
const resolveTs = (base) => { for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return base }
function load(file) {
  const key = path.normalize(file)
  if (overrides.has(key)) return overrides.get(key)
  if (cache.has(key)) return cache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
  const mod = { exports: {} }
  cache.set(key, mod.exports)
  const req = Module.createRequire(key)
  new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
  cache.set(key, mod.exports)
  return mod.exports
}
const T = load(path.join(SRC, 'lib/salesDailyTotals.ts'))
const { ReportExactDecimal } = load(path.join(SRC, 'lib/reportMoneyPrecision.ts'))
const cron = load(path.join(SRC, 'lib/salesDailyCron.ts'))
const tiers = load(path.join(SRC, 'lib/planTier.ts'))

let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  // ---- A. fraction text ---------------------------------------------------------------------------------------------------------------------------------
  await check('A1 exactToText / textToExact round-trip the kernel exact values, including a non-decimal denominator and a number far past a double', () => {
    const third = ReportExactDecimal.recorded('1').divide(ReportExactDecimal.recorded('3'))
    assert.equal(T.exactToText(third), '1/3')
    assert.equal(T.exactToText(ReportExactDecimal.recorded('2.50')), '5/2')
    assert.equal(T.exactToText(ReportExactDecimal.recorded('-0.0625')), '-1/16')
    assert.equal(T.exactToText(ReportExactDecimal.zero()), '0')
    assert.equal(T.exactToText(ReportExactDecimal.recorded('12')), '12')
    const big = ReportExactDecimal.recorded('99999999999').multiply(ReportExactDecimal.recorded('99999999999')).multiply(ReportExactDecimal.recorded('99999999999')).divide(ReportExactDecimal.recorded('7'))
    const text = T.exactToText(big)
    assert.ok(text.length > 30, text)
    assert.equal(T.textToExact(text).compare(big), 0, 'a 33-digit fraction survives the round trip exactly')
    for (const sample of ['0', '5', '-5', '1/3', '-22/7', '7/1000000007']) assert.equal(T.exactToText(T.textToExact(sample)), sample)
  })

  await check('A2 only the canonical text is accepted (reduced, no plus sign, no leading zeros, no negative zero, no /1)', () => {
    for (const good of ['0', '12', '-12', '1/2', '-1/2', '22/7']) assert.equal(T.isCanonicalFractionText(good), true, good)
    for (const bad of ['2/4', '4/2', '+1', '01', '1.5', '1/0', '-0', '5/1', '', ' 1', '1/-2', '1e3', null, 5, '0/5']) assert.equal(T.isCanonicalFractionText(bad), false, String(bad))
    assert.throws(() => T.textToExact('2/4'))
    assert.throws(() => T.addFractionTexts('1/3', 'x'))
  })

  await check('A3 sums are exact and order-free, and equal the kernel arithmetic', () => {
    const parts = ['1/3', '1/6', '-1/7', '10', '0', '123456789012345678901234567890/1000000007', '-5/2', '3/11']
    const expected = parts.map((p) => T.textToExact(p)).reduce((a, b) => a.add(b), ReportExactDecimal.zero())
    const forward = T.sumFractionTexts(parts)
    assert.equal(forward, T.exactToText(expected))
    assert.equal(T.sumFractionTexts([...parts].reverse()), forward)
    assert.equal(T.sumFractionTexts([...parts].sort()), forward)
    assert.equal(T.sumFractionTexts([]), '0')
    assert.equal(T.addFractionTexts('1/3', '2/3'), '1')
  })

  await check('A4 CONTROL: rounding each day then adding is NOT the same as adding the exact day totals then rounding once', () => {
    const days = ['1/3', '1/3', '1/3']
    const roundedEach = days.map((d) => T.textToExact(d).toNumber(2)).reduce((a, b) => a + b, 0)
    const roundedOnce = T.textToExact(T.sumFractionTexts(days)).toNumber(2)
    assert.equal(Math.round(roundedEach * 100) / 100, 0.99)
    assert.equal(roundedOnce, 1)
    assert.notEqual(Math.round(roundedEach * 100) / 100, roundedOnce, 'a reader that rounds per day would fail this control')
  })

  // ---- B. payload ---------------------------------------------------------------------------------------------------------------------------------------
  const bucket = (money = { revenue: '5/2', cost: '0' }, counts = { tx: 2 }) => ({ money, counts })
  const payload = (extra = {}) => ({ v: 1, branches: { 1: { bucket: bucket(), label: { sale: [3, 'Shop'] }, ...extra }, 0: { bucket: bucket({ revenue: '1' }, { tx: 1 }) } } })

  await check('B1 the stored text is key-sorted, so equal payloads are equal texts whatever order they were built in', () => {
    const a = T.encodeSalesDailyPayload(payload())
    const reversed = { branches: { 0: { bucket: { counts: { tx: 1 }, money: { revenue: '1' } } }, 1: { label: { sale: [3, 'Shop'] }, bucket: { counts: { tx: 2 }, money: { cost: '0', revenue: '5/2' } } } }, v: 1 }
    assert.equal(T.encodeSalesDailyPayload(reversed), a)
    assert.deepEqual(T.decodeSalesDailyPayload(a), JSON.parse(a))
  })

  await check('B2 encode refuses what must never reach storage; decode answers null for anything damaged', () => {
    for (const [bad, why] of [
      [{ v: 2, branches: {} }, 'version'], [{ v: 1 }, 'branches'], [{ v: 1, branches: {}, extra: 1 }, 'unknown key'],
      [{ v: 1, branches: { x: { bucket: bucket() } } }, 'branch key'], [{ v: 1, branches: { 1: { bucket: bucket({ a: '2/4' }) } } }, 'non canonical money'],
      [{ v: 1, branches: { 1: { bucket: bucket({ a: 1.5 }) } } }, 'number as money'], [{ v: 1, branches: { 1: { bucket: bucket({ a: '1' }, { tx: -1 }) } } }, 'negative count'],
      [{ v: 1, branches: { 1: { bucket: bucket({ a: '1' }, { tx: 1.5 }) } } }, 'fractional count'], [{ v: 1, branches: { 1: {} } }, 'no bucket'],
    ]) assert.throws(() => T.encodeSalesDailyPayload(bad), RangeError, why)
    assert.throws(() => T.encodeSalesDailyPayload({ v: 1, branches: { 1: { bucket: bucket(), pay: JSON.parse('{"__proto__":{"x":1}}') } } }))
    for (const text of ['', 'not json', '[]', '{}', '{"v":1}', '{"v":1,"branches":{"1":{"bucket":{"money":{"a":"2/4"},"counts":{}}}}}', null, 12]) assert.equal(T.decodeSalesDailyPayload(text), null, String(text))
  })

  await check('B3 differing paths name places and never values', () => {
    const a = payload(), b = payload()
    b.branches[1].bucket.money.revenue = '999/7'
    const paths = T.salesDailyDifferingPaths(a, b)
    assert.deepEqual(paths, ['branches.1.bucket'])
    assert.ok(!paths.join(',').includes('999'))
    assert.deepEqual(T.salesDailyDifferingPaths(a, payload()), [])
  })

  // ---- C. which days a reader may serve -------------------------------------------------------------------------------------------------------------------
  const EPOCH = 'a'.repeat(32)
  const flags = (over = {}) => ({ epoch: EPOCH, coverage: { epoch: EPOCH, kernel: 1 }, quarantined: false, maintenance: false, reconcileCursor: '', ...over })
  const day = (over = {}) => ({ business_date: '2026-11-01', state: 0, claim_gen: 1, kernel_version: 1, data_epoch: EPOCH, refusal: null, ...over })

  await check('C1 only a clean day of this kernel and this epoch is served; every other state means read it raw; a kernel refusal is raised, an own refusal is read raw', () => {
    assert.equal(T.classifyStoredDay(day(), flags()), 'serve')
    assert.equal(T.classifyStoredDay(undefined, flags()), 'missing')
    assert.equal(T.classifyStoredDay(day({ state: 1 }), flags()), 'dirty')
    assert.equal(T.classifyStoredDay(day({ state: 2 }), flags()), 'claimed')
    assert.equal(T.classifyStoredDay(day({ state: 7 }), flags()), 'unusable')
    assert.equal(T.classifyStoredDay(day({ kernel_version: 0 }), flags()), 'old_kernel')
    assert.equal(T.classifyStoredDay(day({ data_epoch: 'b'.repeat(32) }), flags()), 'old_epoch')
    assert.equal(T.classifyStoredDay(day({ data_epoch: '' }), flags()), 'old_epoch')
    assert.equal(T.classifyStoredDay(day(), flags({ epoch: null })), 'old_epoch')
    assert.equal(T.classifyStoredDay(day({ refusal: 'too_many_rows' }), flags()), 'refuse')
    assert.equal(T.classifyStoredDay(day({ refusal: T.SALES_DAILY_PAYLOAD_TOO_LARGE }), flags()), 'unusable')
  })

  await check('C2 no stored day is read while quarantined, in maintenance, uncovered, or under another epoch than the coverage names', () => {
    assert.equal(T.salesDailyStoredReadAllowed(flags()), true)
    assert.equal(T.salesDailyStoredReadAllowed(flags({ quarantined: true })), false)
    assert.equal(T.salesDailyStoredReadAllowed(flags({ maintenance: true })), false)
    assert.equal(T.salesDailyStoredReadAllowed(flags({ coverage: null })), false)
    assert.equal(T.salesDailyStoredReadAllowed(flags({ coverage: { epoch: 'c'.repeat(32), kernel: 1 } })), false)
    assert.equal(T.salesDailyStoredReadAllowed(flags({ epoch: null })), false)
    const rows = [{ key: 'data_epoch', value: EPOCH }, { key: 'sales_daily_coverage', value: JSON.stringify({ epoch: EPOCH, kernel: 1 }) }]
    assert.equal(T.salesDailyStoredReadAllowed(T.salesDailyFlagsFromRows(rows)), true)
    assert.equal(T.salesDailyStoredReadAllowed(T.salesDailyFlagsFromRows([...rows, { key: 'sales_daily_quarantine', value: '{}' }])), false)
    assert.equal(T.salesDailyStoredReadAllowed(T.salesDailyFlagsFromRows([...rows, { key: 'maintenance', value: '{}' }])), false)
    assert.equal(T.salesDailyStoredReadAllowed(T.salesDailyFlagsFromRows([{ key: 'data_epoch', value: 'not hex' }, rows[1]])), false)
  })

  await check('C3 the cron re-covers on a new epoch, a new kernel version, or no coverage, and never on a matching one', () => {
    assert.equal(T.salesDailyNeedsRecover(flags()), false)
    assert.equal(T.salesDailyNeedsRecover(flags({ coverage: { epoch: EPOCH, kernel: 0 } })), true)
    assert.equal(T.salesDailyNeedsRecover(flags({ coverage: { epoch: 'c'.repeat(32), kernel: 1 } })), true)
    assert.equal(T.salesDailyNeedsRecover(flags({ coverage: null })), true)
    assert.equal(T.salesDailyNeedsRecover(flags({ epoch: null, coverage: null })), false, 'no epoch: nothing to cover yet')
  })

  await check('C4 the second-round check: the same (date, state, claim_gen) set holds still, any change does not', () => {
    const first = [day({ business_date: '2026-11-01' }), day({ business_date: '2026-11-02' })]
    assert.equal(T.storedDaysHeldStill(first, [...first].reverse()), true)
    assert.equal(T.storedDaysHeldStill(first, [first[0], day({ business_date: '2026-11-02', claim_gen: 2 })]), false)
    assert.equal(T.storedDaysHeldStill(first, [first[0], day({ business_date: '2026-11-02', state: 1 })]), false)
    assert.equal(T.storedDaysHeldStill(first, [first[0]]), false)
  })

  await check('C5 dates: a real calendar date only, and the range size', () => {
    for (const ok of ['2026-11-14', '2028-02-29']) assert.equal(T.isSalesDailyDate(ok), true, ok)
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '', null, '2026-11-14T00:00']) assert.equal(T.isSalesDailyDate(bad), false, String(bad))
    assert.equal(T.salesDailyRangeDays('2026-11-01', '2026-11-01'), 1)
    assert.equal(T.salesDailyRangeDays('2026-11-01', '2026-11-30'), 30)
    assert.equal(T.salesDailyRangeDays('2026-11-02', '2026-11-01'), 0)
  })

  // ---- D. the protocol on a real migrated chain --------------------------------------------------------------------------------------------------------
  const NOW = Date.parse('2026-11-14T05:00:00Z') // 12:00 in Cambodia, business date 2026-11-14
  const saleSql = (receipt, createdAt) => `INSERT INTO sales(receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,branch_id,created_at) VALUES('${receipt}','req-${receipt}',0,10,10,1,'${createdAt}')`
  const fresh = (days) => {
    rawDb = openDb(migrations)
    rawDb.exec("INSERT INTO branches(name) VALUES('LC Store')")
    days.forEach((d, i) => rawDb.exec(saleSql(`S${i}`, `${d} 03:00:00`)))
    return { DB: {}, Business_OS_Analytics: { points: [], writeDataPoint(p) { this.points.push(p) } } }
  }
  const rows = () => rawDb.prepare('SELECT business_date, state, claim_gen, kernel_version, data_epoch, refusal, payload FROM sales_daily_totals ORDER BY business_date').all().map((r) => ({ ...r }))
  const stateOf = (d) => rows().find((r) => r.business_date === d)
  const epochNow = () => rawDb.prepare("SELECT value FROM system_flags WHERE key='data_epoch'").get().value
  // A fake kernel: the payload is a pure function of the day's raw sales, so a changed sale changes the payload (as the real kernel's would).
  const kernelOf = (hooks = {}, version = T.SALES_DAILY_KERNEL_VERSION) => ({
    version,
    async computeDays(_env, days) {
      if (hooks.beforeRead) hooks.beforeRead(days)
      const out = new Map()
      for (const d of days) {
        const sums = rawDb.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_usd),0) t FROM sales WHERE COALESCE(date(created_at,'+7 hours'),'') = ?").get([d])
        out.set(d, hooks.result ? hooks.result(d, sums) : { payload: { v: 1, branches: { 1: { bucket: { money: { revenue: `${sums.t}` }, counts: { tx: sums.n } } } } }, sourceRows: sums.n, refusal: null })
      }
      if (hooks.afterRead) hooks.afterRead(days)
      return out
    },
  })
  const dep = (over = {}) => ({ mode: 'on', nowMs: NOW, kernel: kernelOf(), ...over })
  const DAYS = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']

  await check('D1 OFF does nothing; shadow does nothing on Free; no kernel wired does nothing; a kernel of another version stores nothing', async () => {
    const env = fresh(DAYS)
    const before = JSON.stringify(rows())
    assert.deepEqual(await cron.runSalesDailyRecompute(env, dep({ mode: 'off' })), { skipped: 'switch-off' })
    assert.deepEqual(await cron.runSalesDailyReconcile(env, dep({ mode: 'off' })), { skipped: 'switch-off' })
    assert.deepEqual(await cron.runSalesDailyRecompute(env, dep({ kernel: null })), { skipped: 'kernel-not-wired' })
    assert.deepEqual(await cron.runSalesDailyRecompute(env, { mode: 'on', nowMs: NOW }), { skipped: 'kernel-not-wired' }, 'phase A ships no kernel')
    assert.deepEqual(await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf({}, 99) })), { skipped: 'kernel-version' })
    env.PLAN_TIER = 'free'; tiers.__resetPlanTierCacheForTests()
    assert.deepEqual(await cron.runSalesDailyRecompute(env, dep({ mode: 'shadow' })), { skipped: 'switch-off' })
    delete env.PLAN_TIER; tiers.__resetPlanTierCacheForTests()
    assert.equal(JSON.stringify(rows()), before, 'nothing was written')
  })

  await check('D2 the migration covers the current kernel, so the first visit computes at once; today is never computed; newest days first', async () => {
    const env = fresh(DAYS)
    assert.equal(rows().length, DAYS.length)
    const first = await cron.runSalesDailyRecompute(env, dep())
    assert.deepEqual([first.pending, first.claimed, first.committed, first.refused, first.more], [6, 6, 6, 0, false])
    const done = rows()
    assert.deepEqual(done.filter((r) => r.state === 0).map((r) => r.business_date), DAYS.slice(0, 6))
    assert.deepEqual(stateOf('2026-11-14').state, 1, 'today stays dirty')
    for (const r of done.filter((x) => x.state === 0)) assert.deepEqual([r.kernel_version, r.data_epoch, r.refusal], [1, epochNow(), null])
    assert.deepEqual(JSON.parse(stateOf('2026-11-10').payload), { v: 1, branches: { 1: { bucket: { money: { revenue: '10' }, counts: { tx: 1 } } } } })
    const second = await cron.runSalesDailyRecompute(env, dep())
    assert.deepEqual([second.pending, second.claimed, second.more], [0, 0, false], 'nothing left to do costs one read')
  })

  await check('D3 a kernel version or epoch change is re-covered by itself: every day dirty again, missing days re-seeded, then recomputed', async () => {
    const env = fresh(DAYS.slice(0, 3))
    await cron.runSalesDailyRecompute(env, dep())
    assert.ok(rows().filter((r) => r.business_date < '2026-11-14').every((r) => r.state === 0))
    rawDb.exec("DELETE FROM sales_daily_totals WHERE business_date = '2026-11-09'")
    rawDb.exec("UPDATE system_flags SET value = lower(hex(randomblob(16))) WHERE key = 'data_epoch'")
    const recovered = await cron.runSalesDailyRecompute(env, dep())
    assert.deepEqual([recovered.recovered, recovered.more], [true, true])
    assert.deepEqual(rows().map((r) => [r.business_date, r.state]), [['2026-11-08', 1], ['2026-11-09', 1], ['2026-11-10', 1]], 'every day dirty, the deleted day re-seeded')
    assert.equal(JSON.parse(rawDb.prepare("SELECT value FROM system_flags WHERE key='sales_daily_coverage'").get().value).epoch, epochNow())
    const after = await cron.runSalesDailyRecompute(env, dep())
    assert.equal(after.committed, 3)
    assert.ok(rows().every((r) => r.state === 0 && r.data_epoch === epochNow()))
    // a kernel version bump: coverage names kernel 1, the code now says 2
    const bumped = await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf({}, 1) }))
    assert.equal(bumped.claimed, 0)
  })

  await check('D4 a write BETWEEN claim and commit sets the day dirty again: the commit is refused, nothing stale is stored, the next visit gets it', async () => {
    const env = fresh(['2026-11-10', '2026-11-11'])
    const hooks = { afterRead: (days) => { if (days.includes('2026-11-10')) rawDb.exec("UPDATE sales SET total_usd = 99 WHERE receipt_number = 'S0'") } }
    const run = await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf(hooks) }))
    assert.deepEqual([run.claimed, run.committed, run.refused], [2, 1, 1])
    assert.equal(stateOf('2026-11-10').state, 1, 'dirty again, and no payload was stored')
    assert.equal(stateOf('2026-11-10').payload, '{}')
    assert.equal(stateOf('2026-11-11').state, 0)
    const next = await cron.runSalesDailyRecompute(env, dep())
    assert.equal(next.committed, 1)
    assert.deepEqual(JSON.parse(stateOf('2026-11-10').payload).branches[1].bucket.money, { revenue: '99' })
  })

  await check('D5 two recomputes at once: the later claim wins, the earlier commit is refused, and the stored day is the later one', async () => {
    const env = fresh(['2026-11-10'])
    let inner = null
    const outer = kernelOf({ afterRead: async () => {} })
    const original = outer.computeDays.bind(outer)
    outer.computeDays = async (e, days) => {
      const result = await original(e, days)
      // while the first run still holds its claim, a second run claims the same day (a newer generation) and commits
      inner = await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf({ result: (d, sums) => ({ payload: { v: 1, branches: { 1: { bucket: { money: { revenue: '777' }, counts: { tx: sums.n } } } } }, sourceRows: 1, refusal: null }) }) }))
      return result
    }
    const first = await cron.runSalesDailyRecompute(env, dep({ kernel: outer }))
    assert.equal(inner.committed, 1)
    assert.deepEqual([first.claimed, first.committed, first.refused], [1, 0, 1], 'the earlier commit is refused')
    assert.equal(stateOf('2026-11-10').state, 0)
    assert.equal(stateOf('2026-11-10').claim_gen, 2)
    assert.equal(JSON.parse(stateOf('2026-11-10').payload).branches[1].bucket.money.revenue, '777')
  })

  await check('D6 an epoch rotation during the read refuses the commit (a restore or reset made the records another database), and the next visit re-covers', async () => {
    const env = fresh(['2026-11-10'])
    const hooks = { afterRead: () => rawDb.exec("UPDATE system_flags SET value = lower(hex(randomblob(16))) WHERE key = 'data_epoch'") }
    const run = await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf(hooks) }))
    assert.deepEqual([run.claimed, run.committed, run.refused], [1, 0, 1])
    assert.equal(stateOf('2026-11-10').state, 2, 'still claimed, never clean')
    assert.deepEqual(await cron.runSalesDailyRecompute(env, dep()), { recovered: true, more: true })
    assert.equal(stateOf('2026-11-10').state, 1)
    assert.equal((await cron.runSalesDailyRecompute(env, dep())).committed, 1)
    assert.equal(stateOf('2026-11-10').data_epoch, epochNow())
  })

  await check('D7 a visit takes at most the plan number of days (Free 3, Paid 30), newest first, and says more is waiting', async () => {
    const many = Array.from({ length: 40 }, (_, i) => new Date(Date.parse('2026-09-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))
    for (const [tier, size] of [['paid', tiers.PLAN_LIMITS_BY_TIER.paid.salesDailyRecomputeDaysPerRun], ['free', tiers.PLAN_LIMITS_BY_TIER.free.salesDailyRecomputeDaysPerRun]]) {
      const env = fresh(many)
      env.PLAN_TIER = tier; tiers.__resetPlanTierCacheForTests()
      const run = await cron.runSalesDailyRecompute(env, dep())
      assert.deepEqual([run.claimed, run.committed, run.more], [size, size, true], tier)
      assert.deepEqual(rows().filter((r) => r.state === 0).map((r) => r.business_date), many.slice(-size), `${tier}: the newest days first`)
      delete env.PLAN_TIER; tiers.__resetPlanTierCacheForTests()
    }
    assert.equal(tiers.PLAN_LIMITS_BY_TIER.free.salesDailyRecomputeDaysPerRun < tiers.PLAN_LIMITS_BY_TIER.paid.salesDailyRecomputeDaysPerRun, true)
  })

  await check('D8 an oversize payload is stored as the own refusal, a kernel refusal as its code; both with an empty payload and never served stored', async () => {
    const env = fresh(['2026-11-10', '2026-11-11'])
    const big = 'x'.repeat(tiers.PLAN_LIMITS_BY_TIER.paid.salesDailyMaxPayloadBytes + 10)
    const result = (d, sums) => (d === '2026-11-10'
      ? { payload: { v: 1, branches: { 1: { bucket: { money: {}, counts: {} }, label: big } } }, sourceRows: sums.n, refusal: null }
      : { payload: { v: 1, branches: {} }, sourceRows: 0, refusal: 'too_many_rows' })
    await cron.runSalesDailyRecompute(env, dep({ kernel: kernelOf({ result }) }))
    const big10 = stateOf('2026-11-10'), refused = stateOf('2026-11-11')
    assert.deepEqual([big10.state, big10.refusal, big10.payload], [0, T.SALES_DAILY_PAYLOAD_TOO_LARGE, '{}'])
    assert.deepEqual([refused.state, refused.refusal, refused.payload], [0, 'too_many_rows', '{}'])
    const f = flags({ epoch: epochNow() })
    assert.equal(T.classifyStoredDay({ ...big10 }, f), 'unusable')
    assert.equal(T.classifyStoredDay({ ...refused }, f), 'refuse')
  })

  // ---- E. the nightly reconcile --------------------------------------------------------------------------------------------------------------------------
  const settled = async (env) => { await cron.runSalesDailyRecompute(env, dep()) }
  const alerts = []
  const alertDep = (over = {}) => dep({ alert: async (_env, days) => { alerts.push([...days]); return true }, ...over })

  await check('E1 a reconcile that finds every day equal writes no quarantine and no alert, advances the cursor, and records the run', async () => {
    const env = fresh(DAYS)
    await settled(env)
    alerts.length = 0
    const result = await cron.runSalesDailyReconcile(env, alertDep())
    assert.deepEqual([result.compared, result.matched, result.mismatched, result.unjudged, result.alerted], [6, 6, [], 0, false])
    assert.equal(rawDb.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='sales_daily_quarantine'").get().n, 0)
    assert.equal(alerts.length, 0)
    assert.ok(rawDb.prepare("SELECT value FROM system_flags WHERE key='sales_daily_reconcile_cursor'").get(), 'the cursor row exists')
    const point = env.Business_OS_Analytics.points.at(-1)
    assert.deepEqual([point.indexes[0], point.blobs[0], point.doubles.slice(0, 4)], ['sales_daily_reconcile', 'match', [6, 6, 0, 0]])
  })

  await check('E2 a MISMATCH: the day goes dirty, every stored read stops, ONE owner alert names the day, and the run is recorded as a mismatch', async () => {
    const env = fresh(DAYS)
    await settled(env)
    alerts.length = 0
    // a stored day that the raw records no longer agree with (as a writer that bypassed every trigger would leave it)
    rawDb.exec("UPDATE sales_daily_totals SET payload = replace(payload, '\"revenue\":\"10\"', '\"revenue\":\"11\"') WHERE business_date = '2026-11-10'")
    const result = await cron.runSalesDailyReconcile(env, alertDep())
    assert.deepEqual(result.mismatched, ['2026-11-10'])
    assert.equal(result.alerted, true)
    assert.deepEqual(alerts, [['2026-11-10']])
    assert.equal(stateOf('2026-11-10').state, 1, 'never healed silently: dirty, to be recomputed on purpose')
    const quarantine = JSON.parse(rawDb.prepare("SELECT value FROM system_flags WHERE key='sales_daily_quarantine'").get().value)
    assert.deepEqual([quarantine.days, quarantine.paths], [['2026-11-10'], ['branches.1.bucket']])
    const f = T.salesDailyFlagsFromRows(rawDb.prepare(T.SALES_DAILY_FLAGS_SQL).all())
    assert.equal(f.quarantined, true)
    assert.equal(T.salesDailyStoredReadAllowed(f), false, 'every reader now ignores every stored day')
    const point = env.Business_OS_Analytics.points.at(-1)
    assert.deepEqual([point.indexes[0], point.blobs[0], point.blobs[1]], ['sales_daily_reconcile', 'mismatch', 'branches.1.bucket'])
    assert.ok(!JSON.stringify(point).includes('11/'), 'no figure in the datapoint')
  })

  await check('E3 once quarantined, a later reconcile stays quiet (no second alert), and the first reason stays', async () => {
    const env = fresh(DAYS)
    await settled(env)
    rawDb.exec("UPDATE sales_daily_totals SET payload = replace(payload, '\"revenue\":\"10\"', '\"revenue\":\"11\"') WHERE business_date IN ('2026-11-10', '2026-11-12')")
    alerts.length = 0
    const first = await cron.runSalesDailyReconcile(env, alertDep())
    assert.deepEqual(first.mismatched, ['2026-11-10', '2026-11-12'])
    assert.deepEqual(alerts, [['2026-11-10', '2026-11-12']], 'one alert, both days')
    const again = await cron.runSalesDailyReconcile(env, alertDep())
    assert.deepEqual(again, { skipped: 'quarantined' })
    assert.equal(alerts.length, 1)
    // a second mismatch found by a run that raced the first: the quarantine row is already there, so it does not alert again
    const env2 = fresh(DAYS)
    await settled(env2)
    rawDb.exec("UPDATE sales_daily_totals SET payload = replace(payload, '\"revenue\":\"10\"', '\"revenue\":\"11\"') WHERE business_date = '2026-11-10'")
    alerts.length = 0
    // a concurrent run quarantined between this run's flag read and its own write: the row is already there, so this run does not alert a second time
    const hooks = { beforeRead: () => rawDb.exec("INSERT INTO system_flags(key,value,updated_at) VALUES('sales_daily_quarantine','{\"at\":\"x\"}',CURRENT_TIMESTAMP)") }
    const racing = await cron.runSalesDailyReconcile(env2, alertDep({ kernel: kernelOf(hooks) }))
    assert.deepEqual([racing.mismatched, racing.alerted], [['2026-11-10'], false])
    assert.equal(stateOf('2026-11-10').state, 1)
    assert.equal(alerts.length, 0)
  })

  await check('E4 a day written to while the records were being read is NOT judged (no false mismatch, no quarantine)', async () => {
    const env = fresh(DAYS)
    await settled(env)
    alerts.length = 0
    const hooks = { afterRead: () => rawDb.exec("UPDATE sales SET total_usd = 55 WHERE receipt_number = 'S2'") }
    const result = await cron.runSalesDailyReconcile(env, alertDep({ kernel: kernelOf(hooks) }))
    assert.deepEqual(result.mismatched, [])
    assert.equal(result.unjudged, 1)
    assert.equal(result.matched, 5)
    assert.equal(rawDb.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='sales_daily_quarantine'").get().n, 0)
    assert.equal(alerts.length, 0)
    assert.equal(env.Business_OS_Analytics.points.at(-1).blobs[0], 'match')
  })

  await check('E5 an unfinished, old-epoch or old-kernel day is not judged; a stored refusal is compared as a refusal', async () => {
    const env = fresh(DAYS)
    const refusing = kernelOf({ result: (d, sums) => (d === '2026-11-09' ? { payload: { v: 1, branches: {} }, sourceRows: 0, refusal: 'too_many_rows' } : { payload: { v: 1, branches: { 1: { bucket: { money: { revenue: `${sums.t}` }, counts: { tx: sums.n } } } } }, sourceRows: sums.n, refusal: null }) })
    await cron.runSalesDailyRecompute(env, dep({ kernel: refusing }))
    rawDb.exec("UPDATE sales_daily_totals SET state = 1 WHERE business_date = '2026-11-08'")
    rawDb.exec("UPDATE sales_daily_totals SET kernel_version = 0 WHERE business_date = '2026-11-12'")
    alerts.length = 0
    const result = await cron.runSalesDailyReconcile(env, alertDep({ kernel: refusing }))
    assert.deepEqual([result.compared, result.matched, result.mismatched, result.unjudged], [4, 4, [], 1], 'the dirty day is not even picked, the old-kernel day is not judged, the refusal day matches its own refusal')
    // the kernel now stops refusing: the stored refusal no longer matches
    const result2 = await cron.runSalesDailyReconcile(env, alertDep())
    assert.deepEqual(result2.mismatched, ['2026-11-09'])
    assert.equal(alerts.length, 1)
  })

  await check('E6 the older slice rotates through the whole history, then starts over; the last N days are always checked', async () => {
    const many = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-10-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))
    const env = fresh(many)
    env.PLAN_TIER = 'free'; tiers.__resetPlanTierCacheForTests()
    const slice = tiers.PLAN_LIMITS_BY_TIER.free.salesDailyReconcileOlderDaysPerRun
    const recent = tiers.PLAN_LIMITS_BY_TIER.free.salesDailyReconcileRecentDays
    for (let i = 0; i < 4; i += 1) await cron.runSalesDailyRecompute(env, dep())
    const seen = []
    const spy = kernelOf({ beforeRead: (days) => seen.push([...days]) })
    for (let i = 0; i < 5; i += 1) await cron.runSalesDailyReconcile(env, alertDep({ kernel: spy }))
    assert.deepEqual(seen[0], many.slice(0, slice), 'the first night checks the oldest slice (all of it is older than the recent window)')
    assert.deepEqual(seen[1], many.slice(slice, 2 * slice))
    assert.equal(seen.length, 4, 'the fifth night finds nothing older than the cursor, checks nothing and wraps')
    assert.ok(seen.every((days) => days.length <= slice + recent), 'a night never exceeds the plan slice plus the recent window')
    const everything = new Set(seen.flat())
    assert.ok(many.every((d) => everything.has(d)), 'four nights covered all twelve days; the fifth wrapped')
    assert.equal(rawDb.prepare("SELECT value FROM system_flags WHERE key='sales_daily_reconcile_cursor'").get().value, '', 'the history ended, so the next night starts over')
    delete env.PLAN_TIER; tiers.__resetPlanTierCacheForTests()
  })

  await check('E7 the Telegram path is never reached from a test: the default sender is only loaded when no alert is injected', async () => {
    const src = fs.readFileSync(path.join(SRC, 'lib/salesDailyCron.ts'), 'utf8')
    assert.equal((src.match(/import\('\.\/telegram'\)/g) || []).length, 1, 'one lazy import, never a top-level one')
    assert.ok(!/^import .*telegram/m.test(src), 'no static telegram import (the rotation file must not name telegram)')
    assert.ok(src.includes('if (deps.alert) return await deps.alert(env, days)'))
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
