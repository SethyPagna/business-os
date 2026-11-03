'use strict'
// P1.4 (6.0.1050): the report_atomic switch (Dashboard and Sales stats totals: getSalesTotalsAndPeriodSeries, getSalesTotalsWithoutLosses,
// readSalesReportTotals). OFF runs today's reader (the legacy copy of the base code), ON runs the bounded atomic batch, SHADOW serves OFF
// and checks it against ON on a sampled request. This test runs the public readers inside a real Worker (Miniflare, every migration, a
// seeded synthetic history with the business-day boundary rows) and proves:
//   1. OFF and ON return identical results for every date range the UI offers x branch x reader, and the instrument can tell them apart
//      (three mutants of the atomic path are each caught);
//   2. a write landing between any two of a request's D1 calls never produces a mixed snapshot, on either path;
//   3. the shadow compares, serves OFF, tells a concurrent write from a mismatch, and costs nothing when unsampled or on Free;
//   4. crafted filters (inherited/accessor/null-prototype objects, injection strings, reversed and malformed dates) take the same outcome
//      on both paths and never widen the scope; an unreadable or malformed switch row is OFF, and report_atomic_long alone moves nothing here.
// The full report family has its own switch and its own test: test-report-atomic-long-parity-native.cjs.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { startParityWorld, once, sha, lf } = require('./harness/report_atomic_parity_world.cjs')

// Each mutant breaks one thing in the ATOMIC path only; the legacy copy has different text at these seams.
const MUTANTS = {
  'omit-item-cost': text => once(text, "'id', 'sale_id', 'quantity', 'total_usd', 'cost_price_usd', 'product_discount_usd', 'manual_discount_usd',", "'id', 'sale_id', 'quantity', 'total_usd', 'product_discount_usd', 'manual_discount_usd',"),
  'returns-unscoped': text => once(text, "AND (${primary.sql})`, idExpr: 'r.id'", "AND (1=1)`, idExpr: 'r.id'"),
  'drop-void-group': text => once(text, "if (options.maxReceipts === undefined) groups.push({ kind: 'voidSales'", "if (false) groups.push({ kind: 'voidSales'"),
}

async function main() {
  const ctx = await startParityWorld({ switchName: 'report_atomic', mutants: MUTANTS })
  const { cf, TODAY, RANGES, BRANCHES, WRITES, UNDO, presets, stable, outcome, same, filterOf, statsOf, raw, exec, counts, setSwitch, run, check, checks, t0 } = ctx
  try {
    const matrix = []
    for (const range of RANGES) for (const branch of BRANCHES) {
      const filter = filterOf(range, branch)
      matrix.push({ label: `${range.id}/b${branch ?? '*'}/combined`, mode: 'combined', filter, granularity: 'day' })
      if (range.startDate) matrix.push({ label: `${range.id}/b${branch ?? '*'}/previous`, mode: 'previous', filter })
      matrix.push({ label: `${range.id}/b${branch ?? '*'}/stats`, mode: 'totals', filter: { startDate: range.startDate || null, endDate: range.endDate || null, startTime: null, endTime: null }, stats: statsOf(range, branch) })
    }
    for (const range of RANGES.filter(r => ['year', 'last_year', 'all'].includes(r.id))) matrix.push({ label: `${range.id}/b*/combined-month`, mode: 'combined', filter: filterOf(range, null), granularity: 'month' })
    matrix.push({ label: 'stats-search', mode: 'totals', filter: { startDate: null, endDate: null }, stats: { search: 'Customer 1' } })

    // ---- 1. OFF versus ON over the whole matrix ----------------------------------------------------------------------------------
    const parity = await run(['off', 'on'], matrix)
    let atomicSeen = 0, fewerCalls = 0, positive = { sales: 0, notPaid: 0, cancelled: 0, refund: 0 }
    matrix.forEach((c, i) => {
      const off = parity.off[i], on = parity.on[i]
      assert.equal(off.kind, 'value', `${c.label}: OFF must succeed: ${JSON.stringify(off.error)}`)
      same(off, on, `${c.label}: OFF and ON differ`)
      assert.ok(!off.calls.some(call => call.atomic), `${c.label}: OFF must never batch atomically`)
      if (on.calls.some(call => call.atomic)) { atomicSeen += 1; if (on.calls.length < off.calls.length) fewerCalls += 1 }
      const totals = c.mode === 'combined' ? off.value.totals : c.mode === 'previous' ? off.value : off.value.totals
      positive.sales += totals.tx_count > 0 ? 1 : 0; positive.notPaid += totals.pending_revenue_usd > 0 ? 1 : 0; positive.cancelled += totals.cancelled_tx_count > 0 ? 1 : 0; positive.refund += totals.refund_usd > 0 ? 1 : 0
    })
    assert.ok(positive.sales > matrix.length * 0.6 && positive.notPaid > 10 && positive.cancelled > 10 && positive.refund > 10, 'fixture must exercise sales, Not Paid, cancelled and refunded windows: ' + JSON.stringify(positive))
    const notAtomic = matrix.filter((c, i) => !parity.on[i].calls.some(call => call.atomic)).map(c => c.label)
    // By design (the Codex chain): the Sales stats route with a date window keeps the two-pass compare; every other totals read
    // (dashboard and analytics totals, previous period, the undated stats) runs the one atomic batch.
    const twoPass = matrix.filter(c => c.mode === 'totals' && c.filter.startDate).map(c => c.label)
    assert.deepEqual([...notAtomic].sort(), [...twoPass].sort(), 'exactly the dated Sales stats cases may skip the atomic batch')
    assert.ok(atomicSeen >= RANGES.length, `ON must reach the atomic batch (${atomicSeen} of ${matrix.length})`)
    assert.ok(fewerCalls >= RANGES.length, `ON must take fewer D1 calls than OFF (${fewerCalls})`)
    check(`OFF == ON over ${matrix.length} cases: ${RANGES.length} ranges (${presets.STATS_PRESETS.length} picker presets, partial-day, 2-second boundary) x branch all/1/2 x combined/previous/stats (atomic reached ${atomicSeen}x, fewer calls ${fewerCalls}x; sales ${positive.sales}, Not Paid ${positive.notPaid}, cancelled ${positive.cancelled}, refunds ${positive.refund})`)

    // absolute checks on the business-day boundary, so parity cannot hide a shared mistake
    const totalsOf = async (range, branch) => { await setSwitch('on'); const r = await ctx.world.invoke({ mode: 'combined', filter: filterOf(range, branch), granularity: 'day' }); return r.value.totals }
    const rowsToday = (await raw.prepare("SELECT id FROM sales WHERE id IN (800001,800002) AND date(datetime(created_at,'+7 hours'))=?").bind(TODAY).all()).results.map(r => r.id)
    assert.deepEqual(rowsToday, [800002], 'fixture: the 17:00:00 UTC sale is on the business day, the 16:59:59 one is not')
    assert.equal((await totalsOf(RANGES.find(r => r.id === 'boundary-2s'), null)).tx_count, 2, 'the 2-second window around local midnight holds both boundary sales')
    assert.ok((await totalsOf(RANGES.find(r => r.id === 'today'), null)).tx_count >= 8, 'today holds the boundary sale and the day-of rows')
    check('boundary absolute: 16:59:59 UTC is yesterday, 17:00:00 UTC is today; the 2-second window holds both')

    // ---- 2. the routes of the mutants: each must break parity -------------------------------------------------------------------
    const valueCaughtBy = {}
    const killers = matrix.filter(c => /^(today|month|all|7d)\//.test(c.label) || c.label === 'stats-search')
    for (const mutant of Object.keys(MUTANTS)) {
      await ctx.swap((await ctx.bundleWorker(mutant)).script)
      const result = await run(['off', 'on'], killers)
      const caught = killers.filter((c, i) => stable(outcome(result.off[i])) !== stable(outcome(result.on[i]))).map(c => c.label)
      valueCaughtBy[mutant] = killers.filter((c, i) => stable(result.off[i].value) !== stable(result.on[i].value)).map(c => c.label)
      assert.ok(caught.length > 0, `MUTANT ${mutant} survived: OFF and ON still agree on every case`)
      check(`mutant ${mutant} is caught (${caught.length} of ${killers.length} cases differ, e.g. ${caught[0]})`)
    }
    await ctx.swap(ctx.mainScript)
    check('mutants restored: the unmutated bundle is back')
    // The mutant's shadow run: the shadow must report the difference, serve OFF, and say which field names differ.
    {
      // Only a mutant that changes the served VALUE can be a shadow mismatch (returns-unscoped moves the row count in the diagnostic, not a field).
      await ctx.swap((await ctx.bundleWorker('drop-void-group')).script)
      const shadowLabel = valueCaughtBy['drop-void-group'].find(label => label.endsWith('/combined'))
      assert.ok(shadowLabel, 'drop-void-group must change a combined report value')
      const shadowCase = matrix.find(c => c.label === shadowLabel)
      const offBase = await run(['off'], [shadowCase])
      await setSwitch('shadow:0.1')
      const shadow = await ctx.world.invoke({ ...shadowCase, sample: 0 })
      same(offBase.off[0], shadow, 'a mismatching shadow must still serve the OFF result')
      const points = shadow.ae.filter(p => p.indexes[0] === 'report_atomic_shadow')
      assert.equal(points.length, 1); assert.equal(points[0].blobs[0], 'totals_and_series'); assert.equal(points[0].blobs[1], 'mismatch', shadowCase.label + ': ' + JSON.stringify(points[0]))
      assert.ok(points[0].blobs.slice(2).some(name => /^totals\./.test(name)), 'the datapoint names the differing field paths, not values: ' + points[0].blobs.join('|'))
      assert.ok(!JSON.stringify(points[0]).match(/\d{2,}\.\d{2}/), 'no money value in the datapoint')
      await ctx.swap(ctx.mainScript)
      check('shadow over a broken atomic path records a mismatch with field names only and serves OFF')
    }

    // ---- 3. a write between any two calls never produces a mixed snapshot ---------------------------------------------------------
    const todayCase = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'today'), null), granularity: 'day' }
    const monthCase = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'month'), '1'), granularity: 'day' }
    const stateOf = r => stable(outcome(r))
    const sweep = {}
    for (const state of ['off', 'on']) {
      await setSwitch(state)
      for (const [name, base] of [['today', todayCase], ['month', monthCase]]) for (const write of Object.keys(WRITES)) {
        const pre = await ctx.world.invoke({ ...base })
        await exec(WRITES[write]); const post = await ctx.world.invoke({ ...base }); await exec(UNDO[write])
        assert.notEqual(stateOf(pre), stateOf(post), `${state}/${name}/${write}: the injected write must change the report, or the sweep proves nothing`)
        const calls = pre.calls.length
        const seen = { pre: 0, post: 0, refused: 0 }
        for (let n = 0; n <= calls + 1; n++) {
          const during = await ctx.world.invoke({ ...base, write: WRITES[write], writeAfter: n })
          await exec(UNDO[write])
          if (during.kind === 'error') { assert.equal(during.error.code, 'snapshot_changed', `${state}/${name}/${write}@${n}: ${JSON.stringify(during.error)}`); seen.refused += 1; continue }
          if (stateOf(during) === stateOf(pre)) seen.pre += 1
          else if (stateOf(during) === stateOf(post)) seen.post += 1
          else assert.fail(`${state}/${name}/${write}@${n}: a MIXED snapshot (neither the state before nor after the write)`)
        }
        sweep[`${state}/${name}/${write}`] = { ...seen, calls }
      }
    }
    const onSweeps = Object.entries(sweep).filter(([key]) => key.startsWith('on/'))
    assert.ok(onSweeps.every(([, v]) => v.pre > 0 && v.post > 0), 'the sweep must see the write land both before and after the atomic batch')
    check('write between any two calls: never a mixed snapshot, OFF refuses or is whole, ON is whole -- ' + Object.entries(sweep).map(([k, v]) => `${k}: calls ${v.calls}, pre ${v.pre}/post ${v.post}/refused ${v.refused}`).join('; '))

    // ---- 4. the switch itself ---------------------------------------------------------------------------------------------------
    const probe = { mode: 'combined', filter: filterOf(RANGES.find(r => r.id === 'month'), null), granularity: 'day' }
    await setSwitch('off'); const offProbe = await ctx.world.invoke(probe)
    assert.equal(offProbe.calls.filter(c => c.sw).length, 1, 'the OFF reader pays the switch read once')
    await setSwitch('on'); const onProbe = await ctx.world.invoke(probe)
    assert.equal(onProbe.calls.filter(c => c.sw).length, 1, 'the ON reader pays the switch read once (one reader asks)')
    for (const [label, rawRow] of [['absent row', null], ['not json', 'not json'], ['array', '[]'], ['ON spelled in capitals', JSON.stringify({ switches: { report_atomic: 'ON' } })], ['true', JSON.stringify({ switches: { report_atomic: true } })],
      ['unknown name', JSON.stringify({ switches: { report_atomic_longer: 'on' } })], ['the long switch alone', JSON.stringify({ switches: { report_atomic_long: 'on' } })],
      ['shadow:0', JSON.stringify({ switches: { report_atomic: 'shadow:0' } })], ['shadow garbage', JSON.stringify({ switches: { report_atomic: 'shadow:x' } })], ['proto key', '{"switches":{"__proto__":{"report_atomic":"on"}}}']]) {
      await exec([{ sql: "DELETE FROM system_flags WHERE key='read_switches'" }])
      if (rawRow !== null) await exec([{ sql: 'INSERT INTO system_flags(key,value) VALUES(?,?)', values: ['read_switches', rawRow] }])
      const r = await ctx.world.invoke({ ...probe, sample: 0 })
      same(offProbe, r, `${label}: must be OFF`)
      assert.ok(!r.calls.some(c => c.atomic), `${label}: must not reach the atomic batch`)
      assert.equal(r.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').length, 0)
    }
    check('malformed, unknown or oversized switch rows are OFF, and report_atomic_long alone does not move the totals: exact legacy statements, no shadow datapoint')
    await setSwitch('on')
    const unreadable = await ctx.world.invoke({ ...probe, failSwitchRead: true })
    same(offProbe, unreadable, 'an unreadable switch row must be OFF')
    assert.ok(!unreadable.calls.some(c => c.atomic)); assert.deepEqual(unreadable.ae.map(p => [p.indexes[0], p.blobs[0]]), [['switch_read', 'fallback']])
    check('an unreadable switch row (D1 error) is OFF and writes one switch_read/fallback datapoint')
    // the converse: report_atomic ON moves the totals and leaves the long reports on the old reader
    {
      const longProbe = { mode: 'snapshot', filter: filterOf(RANGES.find(r => r.id === 'month'), null) }
      await setSwitch('on'); const longWithTotalsOn = await ctx.world.invoke(longProbe)
      await setSwitch('off'); const longOff = await ctx.world.invoke(longProbe)
      same(longOff, longWithTotalsOn, 'report_atomic ON must leave the full report family on the old reader')
      assert.ok(!longWithTotalsOn.calls.some(c => c.atomic), 'the full report family reads no atomic batch while only report_atomic is on')
      check('report_atomic alone does not move the full report family (it stays on the old two-pass reader)')
    }

    // shadow: sampled, unsampled, Free, a refusal, a concurrent write
    await setSwitch('shadow:0.1')
    const sampled = await ctx.world.invoke({ ...probe, sample: 0 })
    same(offProbe, sampled, 'a sampled shadow serves OFF'); assert.ok(sampled.calls.some(c => c.atomic), 'a sampled shadow also runs the atomic batch')
    assert.deepEqual(sampled.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').map(p => p.blobs), [['totals_and_series', 'match']])
    const unsampled = await ctx.world.invoke({ ...probe, sample: 0.5 })
    same(offProbe, unsampled, 'an unsampled shadow serves OFF'); assert.ok(!unsampled.calls.some(c => c.atomic)); assert.equal(unsampled.calls.length, offProbe.calls.length); assert.equal(unsampled.ae.length, 0)
    const free = await ctx.world.invoke({ ...probe, sample: 0, tier: 'free' })
    same(offProbe, free, 'a shadow on Free serves OFF'); assert.ok(!free.calls.some(c => c.atomic)); assert.equal(free.calls.length, offProbe.calls.length); assert.equal(free.ae.length, 0)
    await setSwitch(JSON.stringify({ epoch: 1, switches: { report_atomic: 'shadow:5' } }))
    const clampedYes = await ctx.world.invoke({ ...probe, sample: 0.09 }), clampedNo = await ctx.world.invoke({ ...probe, sample: 0.5 })
    assert.ok(clampedYes.calls.some(c => c.atomic) && !clampedNo.calls.some(c => c.atomic), 'shadow:5 is clamped to 0.1')
    await setSwitch('shadow:0.1')
    const writeInside = await ctx.world.invoke({ ...probe, sample: 0, write: WRITES.sale, writeAfter: offProbe.calls.length + 1 }); await exec(UNDO.sale)
    assert.deepEqual(writeInside.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').map(p => p.blobs[1]), ['write_between'])
    check('shadow: sampled serves OFF and matches; unsampled and Free cost nothing; shadow:5 clamps to 0.1; a concurrent write is write_between, not a mismatch')
    await exec([{ sql: "INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance_mode',?)", values: [JSON.stringify({ mode: 'restore' })] }])
    for (const state of ['off', 'on', 'shadow:0.1']) {
      await setSwitch(state)
      const refused = await ctx.world.invoke({ ...probe, sample: 0 })
      assert.equal(refused.kind, 'error'); assert.equal(refused.error.code, 'maintenance_restore'); assert.equal(refused.error.status, 409)
      assert.equal(refused.ae.filter(p => p.indexes[0] === 'report_atomic_shadow').length, 0, 'a refusal by the served reader is not a shadow outcome')
    }
    await exec([{ sql: "DELETE FROM system_flags WHERE key='maintenance_mode'" }])
    check('maintenance_restore refuses identically on OFF, ON and SHADOW (409), with no shadow datapoint')

    // ---- 5. crafted filters ---------------------------------------------------------------------------------------------------------
    const month = RANGES.find(r => r.id === 'month')
    const crafted = [
      ['branchId injection', { ...filterOf(month, "1 OR 1=1") }], ['branchId statement', { ...filterOf(month, "1; DROP TABLE sales") }], ['branchId unknown', { ...filterOf(month, '999') }], ['branchId integer', { ...filterOf(month, 1) }],
      ['branchId object', { ...filterOf(month, { toString: 'x' }) }], ['branchId array', { ...filterOf(month, ['1', '2']) }], ['branchId empty', { ...filterOf(month, '') }],
      ['reversed dates', { startDate: month.endDate, endDate: month.startDate, branchId: null }], ['non-ISO dates', { startDate: '2026-9-1', endDate: '2026-9-30', branchId: null }], ['impossible date', { startDate: '2026-02-30', endDate: '2026-03-01', branchId: null }],
      ['date with time', { startDate: '2026-09-01 00:00:00', endDate: '2026-09-13', branchId: null }], ['injection date', { startDate: "2026-09-01' OR '1'='1", endDate: '2026-09-13', branchId: null }], ['unicode digits', { startDate: '٢٠٢٦-09-01', endDate: '2026-09-13', branchId: null }],
      ['only startDate', { startDate: month.startDate, endDate: '', branchId: null }], ['reversed instants', { startDate: month.startDate, endDate: month.endDate, createdFrom: `${TODAY} 05:00:00`, createdTo: `${TODAY} 02:00:00`, branchId: null }],
      ['ISO instants with Z', { startDate: TODAY, endDate: TODAY, createdFrom: `${TODAY}T02:00:00Z`, createdTo: `${TODAY}T05:00:00Z`, branchId: null }], ['numeric dates', { startDate: 20260901, endDate: 20260913, branchId: null }],
      ['inherited properties', { kind: 'inherited', startDate: month.startDate, endDate: month.endDate, branchId: null }], ['null prototype', { kind: 'null-proto', ...filterOf(month, '1') }], ['accessor that changes on read', { kind: 'getter', ...filterOf(month, null), startDate: month.startDate, endDate: TODAY }],
      ['symbol key', { kind: 'symbol', ...filterOf(month, null) }], ['extra status key', { kind: 'extra-key', ...filterOf(month, null) }], ['all-time with a branch', { startDate: '', endDate: '', branchId: '2' }], ['all-time empty', { startDate: '', endDate: '', branchId: null }],
      ['inherited all-time', { kind: 'inherited', startDate: null, endDate: null, branchId: null }], ['null prototype all-time', { kind: 'null-proto', startDate: '', endDate: '', branchId: null }],
      ['symbol key all-time', { kind: 'symbol', startDate: '', endDate: '', branchId: null }], ['accessor all-time', { kind: 'getter', startDate: null, endDate: null, branchId: null }],
    ]
    const craftedCases = crafted.flatMap(([label, filter]) => [{ label: label + '/combined', mode: 'combined', filter, granularity: 'day' }, { label: label + '/previous', mode: 'previous', filter, rawPrevious: true }, { label: label + '/stats', mode: 'totals', filter: { startDate: filter.startDate ?? null, endDate: filter.endDate ?? null }, stats: { startDate: filter.startDate, endDate: filter.endDate, branchId: filter.branchId } }])
    const craftedResults = await run(['off', 'on'], craftedCases)
    let refusals = 0
    craftedCases.forEach((c, i) => {
      same(craftedResults.off[i], craftedResults.on[i], `crafted ${c.label}: OFF and ON must take the same outcome`)
      if (craftedResults.off[i].kind === 'error') refusals += 1
    })
    const isEmpty = r => r.kind === 'value' && (r.value.totals ?? r.value).tx_count === 0
    const idx = label => craftedCases.findIndex(c => c.label === label)
    for (const label of ['branchId injection/combined', 'branchId statement/combined', 'branchId unknown/combined']) assert.ok(isEmpty(craftedResults.on[idx(label)]), `${label}: an injected or unknown branch must select nothing (the value is bound, never interpolated)`)
    assert.equal((await raw.prepare('SELECT COUNT(*) n FROM sales').all()).results[0].n, counts.s, 'no crafted filter touched the data')
    check(`${craftedCases.length} crafted filter cases take the same outcome on OFF and ON (${refusals} refusals, the rest results); injection and unknown branches select nothing`)
    console.log(`done: ${ctx.world.count()} requests in the last world, ${Math.round((Date.now() - t0) / 1000)}s`)
    console.log(JSON.stringify({ status: 'PASS', checks: checks.length, matrix: matrix.length, crafted: craftedCases.length, sweep, source_sha256: sha(lf(fs.readFileSync(path.join(cf, 'src/lib/salesAnalytics.ts'), 'utf8'))), scope: 'Real Worker (Miniflare, 219 migrations, synthetic history); public totals readers; no CPU, quota or production claim.' }))
  } finally {
    await ctx.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
