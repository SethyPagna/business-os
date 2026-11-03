#!/usr/bin/env node
// The D1 size alarm and the per-table size attribution (ops/scripts/metrics/storage-alarm.mjs, storage-attribution.mjs).
//
// The alarm is the one thing standing between the shop and "Exceeded maximum DB size", where writes fail and sales stop, so the
// boundary is pinned to the byte: 399,999,999 is not an alarm, 400,000,000 is. WATCH is the 12-month projection over 450 MB and
// passes the run. The growth rate only ever comes from baseline points at least a week old, and a shrinking database never projects
// below its size. Three mutants of the module (the boundary, the age filter, the shrink clamp) must each be caught by this file.
// No network, no database, no clock: `now` is always passed in.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..', '..')
const METRICS = path.join(ROOT, 'ops', 'scripts', 'metrics')
const MB = 1e6
const NOW = new Date('2026-11-02T00:00:00Z')
const dayBefore = (days) => new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10)
// no history at all: no slope, so only the 400 MB line can speak
const NO_HISTORY = []

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${err && err.stack}`) }
}

// Everything the alarm promises, as one function, so the mutants can be run through the very same assertions.
function alarmAssertions(alarm) {
  const at = (sizeBytes, baseline = NO_HISTORY) => alarm.evaluateStorage({ sizeBytes, now: NOW, baseline })
  // the line itself, to the byte
  assert.strictEqual(at(399999999).level, 'OK', '399,999,999 bytes is under the line')
  assert.strictEqual(at(400000000).level, 'ALARM', '400,000,000 bytes is the alarm')
  assert.strictEqual(at(400000001).level, 'ALARM')
  assert.strictEqual(at(499999999).level, 'ALARM')
  assert.strictEqual(at(400000000).daysTo400, 0)
  assert.deepStrictEqual(at(400000000).reasons, ['the database is at or above 400 MB'])
  // an unreadable size is UNKNOWN, never OK
  for (const bad of [0, -1, NaN, null, undefined, 'x']) assert.strictEqual(alarm.evaluateStorage({ sizeBytes: bad, now: NOW, baseline: NO_HISTORY }).level, 'UNKNOWN')
  // growth: only points at least a week old count
  const young = [{ date: dayBefore(6), bytes: 100 * MB }, { date: dayBefore(3), bytes: 100 * MB }]
  const fromYoung = at(300 * MB, young)
  assert.strictEqual(fromYoung.growthMBPerDay, null, 'a 6-day-old point must not set the slope')
  assert.strictEqual(fromYoung.level, 'OK', 'no usable slope, no WATCH')
  const week = at(300 * MB, [{ date: dayBefore(7), bytes: 293 * MB }, ...young])
  assert.strictEqual(week.growthMBPerDay, 1, 'a point exactly 7 days old counts: (300-293)/7 = 1 MB/day')
  // the 12-month projection: 300 MB + 365 days x slope, WATCH strictly above 450 MB
  const slope = (megabytesBack) => [{ date: dayBefore(365), bytes: (300 - megabytesBack) * MB }]
  assert.strictEqual(at(300 * MB, slope(149.8)).level, 'OK', '300 + 149.8 = 449.8 MB projected')
  assert.strictEqual(at(300 * MB, slope(150.2)).level, 'WATCH', '300 + 150.2 = 450.2 MB projected')
  assert.deepStrictEqual(at(300 * MB, slope(150.2)).reasons, ['the 12-month projection is above 450 MB'])
  assert.strictEqual(at(300 * MB, slope(150.2)).projected12mMB, 450)
  // the steepest of several usable points wins (an over-warning costs a log line, an under-warning costs the sales)
  const several = [{ date: dayBefore(100), bytes: 290 * MB }, { date: dayBefore(20), bytes: 280 * MB }, { date: dayBefore(10), bytes: 296 * MB }]
  assert.strictEqual(at(300 * MB, several).growthMBPerDay, 1, 'from 20 days ago: 20 MB / 20 days; the other points give 0.1 and 0.4')
  // a shrinking database (the purge gives space back) never projects below where it is
  const shrunk = at(200 * MB, [{ date: dayBefore(30), bytes: 300 * MB }])
  assert.strictEqual(shrunk.level, 'OK')
  assert.strictEqual(shrunk.projected12mMB, 200, 'a negative slope projects flat, not below the size')
  assert.strictEqual(shrunk.daysTo400, null)
  // alarm outranks watch
  assert.strictEqual(at(410 * MB, slope(100)).level, 'ALARM')
}

async function main() {
  const alarm = await import(pathToFileURL(path.join(METRICS, 'storage-alarm.mjs')).href)
  const attribution = await import(pathToFileURL(path.join(METRICS, 'storage-attribution.mjs')).href)

  await check('the alarm: the 400 MB line to the byte, WATCH at a 12-month projection over 450 MB, UNKNOWN never OK', () => {
    assert.strictEqual(alarm.ALARM_BYTES, 400e6)
    assert.strictEqual(alarm.PROJECTION_LIMIT_BYTES, 450e6)
    assert.strictEqual(alarm.FREE_CAP_BYTES, 500e6)
    assert.strictEqual(alarm.PROJECTION_DAYS, 365)
    assert.strictEqual(alarm.MIN_BASELINE_AGE_DAYS, 7)
    alarmAssertions(alarm)
  })

  await check('the size comes from the last response that carried one', () => {
    assert.strictEqual(alarm.sizeFromMetas([{ size_after: 100 }, { size_after: 250000000 }, { size_after: 260000000 }]), 260000000)
    assert.strictEqual(alarm.sizeFromMetas([{ size_after: 250000000 }, null, {}, { size_after: 0 }, { size_after: 'x' }]), 250000000, 'a null, empty, zero or non-numeric meta is skipped')
    assert.strictEqual(alarm.sizeFromMetas([null, {}, { size_after: -5 }]), null)
    assert.strictEqual(alarm.sizeFromMetas([]), null)
    assert.strictEqual(alarm.sizeFromMetas([{ size_after: '253700000' }]), 253700000, 'a numeric string is a number')
  })

  await check('the committed baseline: sorted, measured, and the real status today is WATCH, not OK and not ALARM', () => {
    const series = alarm.loadBaseline()
    assert.ok(series.length >= 8, 'the measured series')
    assert.deepStrictEqual(series.map((p) => p.date), [...series.map((p) => p.date)].sort())
    assert.ok(series.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.bytes > 100e6 && p.bytes < 400e6), 'every point is a real size under the alarm')
    const newest = Date.parse(`${series[series.length - 1].date}T00:00:00Z`)
    assert.ok(series.some((p) => (newest - Date.parse(`${p.date}T00:00:00Z`)) / 86400000 >= alarm.MIN_BASELINE_AGE_DAYS), 'a refreshed baseline must keep a point at least a week older than its newest, or the slope is null and WATCH silently becomes OK')
    const now = alarm.evaluateStorage({ sizeBytes: 253.7e6, now: new Date('2026-11-02T00:00:00Z'), baseline: series })
    assert.strictEqual(now.level, 'WATCH', 'at 253.7 MB growing 1-2 MB/day the 12-month projection passes 450 MB')
    assert.ok(now.growthMBPerDay > 0.5 && now.growthMBPerDay < 3.5, `slope ${now.growthMBPerDay}`)
    assert.ok(Number.isInteger(now.daysTo400) && now.daysTo400 > 30 && now.daysTo400 < 400, `days to 400 MB: ${now.daysTo400}`)
    assert.ok(now.daysTo500 > now.daysTo400)
  })

  await check('loadBaseline refuses a file with no series and drops malformed points', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-baseline-'))
    try {
      const write = (name, value) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(value)); return f }
      assert.throws(() => alarm.loadBaseline(write('none.json', { note: 'x' })), /series/)
      const kept = alarm.loadBaseline(write('mixed.json', { series: [
        { date: '2026-10-02', bytes: 2 }, { date: 'yesterday', bytes: 5 }, { date: '2026-10-01', bytes: 1 }, { date: '2026-10-03', bytes: -4 }, { date: '2026-10-04', bytes: 'abc' },
      ] }))
      assert.deepStrictEqual(kept, [{ date: '2026-10-01', bytes: 1 }, { date: '2026-10-02', bytes: 2 }], 'sorted by date; the bad dates and sizes are gone')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  const mutants = [
    ['the line moved from >= to >: 400,000,000 bytes stops being an alarm', (s) => s.replace('sizeBytes >= ALARM_BYTES) { level', 'sizeBytes > ALARM_BYTES) { level')],
    ['the age filter dropped: a 3-day-old point sets the slope', (s) => s.replace('if (!(ageDays >= MIN_BASELINE_AGE_DAYS)) continue', 'if (!(ageDays >= 0)) continue')],
    ['the shrink clamp removed: a shrinking database projects below its size', (s) => s.replace('Math.max(0, slope)', 'slope')],
    ['the slope taken as the LEAST steep point instead of the steepest', (s) => s.replace('if (steepest === null || perDay > steepest)', 'if (steepest === null || perDay < steepest)')],
  ]
  for (const [label, mutate] of mutants) {
    await check(`mutant caught: ${label}`, async () => {
      const source = fs.readFileSync(path.join(METRICS, 'storage-alarm.mjs'), 'utf8')
      const mutated = mutate(source)
      assert.notStrictEqual(mutated, source, 'the mutation must change the module')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-mutant-'))
      try {
        fs.writeFileSync(path.join(dir, 'storage-alarm.mjs'), mutated)
        const broken = await import(pathToFileURL(path.join(dir, 'storage-alarm.mjs')).href)
        assert.throws(() => alarmAssertions(broken), /./, 'the assertions must go red on this mutant')
        alarmAssertions(alarm)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  await check('attribution: payload tables carry their measured bytes, the rest is spread by rows, and the total is the size', () => {
    const tableRows = { sales: 1000, sale_items: 3000, inventory_movements: 6000, sale_mutation_receipts: 400, undo_snapshots: 400, empty_table: 0 }
    const payloadBytes = { sale_mutation_receipts: 3000000, undo_snapshots: 7000000 }
    const result = attribution.attributeStorage({ sizeBytes: 100e6, tableRows, payloadBytes })
    assert.strictEqual(result.totalRows, 10800)
    assert.strictEqual(result.payloadTotal, 10000000)
    const width = (100e6 - 10e6) / 10800
    assert.strictEqual(result.averageRestWidthBytes, Math.round(width * 10) / 10)
    const by = Object.fromEntries(result.rows.map((r) => [r.table, r]))
    assert.strictEqual(by.sale_mutation_receipts.estimatedBytes, Math.round(3000000 + 400 * width))
    assert.strictEqual(by.sale_mutation_receipts.measuredPayloadBytes, 3000000)
    assert.strictEqual(by.inventory_movements.estimatedBytes, Math.round(6000 * width))
    assert.strictEqual(by.empty_table.estimatedBytes, 0)
    const sum = result.rows.reduce((n, r) => n + r.estimatedBytes, 0)
    assert.ok(Math.abs(sum - 100e6) <= result.rows.length, `the estimates add up to size_after (off by ${sum - 100e6} bytes of rounding)`)
    assert.ok(Math.abs(result.rows.reduce((n, r) => n + r.share, 0) - 100) < 1, 'the shares add up to 100 percent')
    assert.deepStrictEqual(result.rows.map((r) => r.estimatedBytes), result.rows.map((r) => r.estimatedBytes).sort((a, b) => b - a), 'biggest first')
  })

  await check('attribution: no rows, a payload bigger than the size, and an unknown payload table do not divide by zero or go negative', () => {
    const none = attribution.attributeStorage({ sizeBytes: 50e6, tableRows: {} })
    assert.deepStrictEqual([none.totalRows, none.averageRestWidthBytes, none.rows.length], [0, 0, 0])
    const over = attribution.attributeStorage({ sizeBytes: 5e6, tableRows: { a: 10 }, payloadBytes: { a: 9e6 } })
    assert.strictEqual(over.averageRestWidthBytes, 0, 'the rest is clamped at zero')
    assert.ok(over.rows.every((r) => r.estimatedBytes >= 0))
    const strangers = attribution.attributeStorage({ sizeBytes: 10e6, tableRows: { a: 10 }, payloadBytes: { not_counted: 1e6 } })
    assert.deepStrictEqual(strangers.rows.map((r) => r.table).sort(), ['a', 'not_counted'], 'a payload table with no row count is still listed')
  })

  await check('attribution: reads the d1-table-rows groups (string or object) and the payload columns of several exports, taking the larger', () => {
    const rows = attribution.tableRowsFrom({ rows: [{ rows_1: JSON.stringify({ a: 5, b: '7' }), rows_2: { c: 1 }, other: 'ignored' }] })
    assert.deepStrictEqual(rows, { a: 5, b: 7, c: 1 })
    assert.deepStrictEqual(attribution.tableRowsFrom({ rows: [] }), {})
    const payload = attribution.payloadFrom([
      { rows: [{ undo_snapshot_bytes: 5, audit_bytes: 9, unrelated_column: 99 }] },
      { rows: [{ undo_snapshots_payload_bytes: 12, audit_bytes: 4 }] },
      { rows: [] },
    ])
    assert.deepStrictEqual(payload, { undo_snapshots: 12, audit_logs: 9 })
    for (const table of new Set(Object.values(attribution.PAYLOAD_COLUMNS))) assert.ok(/^[a-z_]+$/.test(table))
  })

  console.log(process.exitCode ? `test-ops-storage-alarm-pure: FAILED (${passed} passed)` : `test-ops-storage-alarm-pure: ${passed} checks passed`)
}

main().catch((err) => { process.exitCode = 1; console.error(err) })
