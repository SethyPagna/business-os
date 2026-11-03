#!/usr/bin/env node
// The consistency runner (ops/scripts/ops-consistency.mjs): the two packs, their guard and read ceilings, the verdict, the storage
// alarm inside it, and what it may print.
//
// The queries are the REAL ones, as the ops workflow runs them (the guard's canonical text), executed on the migrated chain in
// node:sqlite and wrapped the way `wrangler d1 execute --json` wraps a result, so the verdict comes from interpretD1Output exactly as
// in production. A clean world is green; one alarm column turned to 1 is red and counted; a database at 400,000,000 bytes fails the
// run and one byte less does not; a query that reads one row over its ceiling fails; and no figure, name or id reaches the public
// log or the clear text of the report. Three mutants of the runner (storage alarm dropped, ceiling doubled, alarm-column count blind)
// must each be caught by the same scenario. No network, no wrangler.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const OPS_SCRIPTS = path.join(ROOT, 'ops', 'scripts')
const NOW = new Date('2026-11-02T00:00:00Z')
const MB = 1e6

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${err && err.stack}`) }
}

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = OFF;')
for (const sql of loadAll()) db.exec(sql)

// What wrangler prints for a successful read-only call.
function d1Output(rows, meta = {}) {
  return JSON.stringify([{ results: rows, success: true, meta: { served_by: 'x', duration: 1, changes: 0, changed_db: false, rows_read: 10, rows_written: 0, size_after: 250 * MB, ...meta } }])
}

// An executor over the empty migrated database. `tweak(name, rows, meta)` lets a scenario plant a drift or change the meta.
function sqliteExecutor(queries, tweak = () => {}) {
  const byText = new Map(queries.map((q) => [q.sql, q.name]))
  return async (sql) => {
    const name = byText.get(sql)
    assert.ok(name, 'the executor was handed SQL that is not one of the pack\'s guarded texts')
    const rows = db.prepare(sql).all().map((r) => ({ ...r }))
    const meta = {}
    const replaced = tweak(name, rows, meta)
    if (replaced && replaced.fail) return replaced.fail
    return { code: 0, stdout: d1Output(replaced && replaced.rows ? replaced.rows : rows, meta), stderr: '', timedOut: false }
  }
}

// Everything the runner promises, so the mutants can be run through the very same assertions.
async function scenario(c, load) {
  const queries = load('recent')
  const names = queries.map((q) => q.name)
  const run = (tweak, extra = {}) => c.runPack({ queries, runQuery: sqliteExecutor(queries, tweak), now: NOW, baseline: [], ...extra })

  // clean world: green, nothing counted, no storage trouble
  const clean = await run()
  assert.strictEqual(clean.ok, true)
  assert.deepStrictEqual(clean.results.map((r) => [r.name, r.ok, r.nonZero]), names.map((n) => [n, true, 0]))
  assert.strictEqual(clean.storage.level, 'OK')
  assert.strictEqual(clean.ceiling, queries.reduce((n, q) => n + q.maxRowsRead, 0))

  // one alarm column turned to 1: that query is red, counted once, and ONLY that one
  for (const query of queries) {
    const [column] = query.rules.expectZero
    const planted = await run((name, rows) => { if (name === query.name) { rows[0][column] = 1; return { rows } } })
    assert.strictEqual(planted.ok, false, `${query.name}: ${column} = 1 must turn the run red`)
    assert.deepStrictEqual(planted.results.filter((r) => !r.ok).map((r) => [r.name, r.nonZero, r.problems]), [[query.name, 1, ['expect-zero-failed']]])
  }
  // a MISSING alarm column is not a pass either
  const [firstColumn] = queries[0].rules.expectZero
  const missing = await run((name, rows) => { if (name === queries[0].name) { delete rows[0][firstColumn]; return { rows } } })
  assert.strictEqual(missing.ok, false)
  assert.strictEqual(missing.results[0].nonZero, 1)

  // the storage line, to the byte
  const sized = (bytes) => run((name, rows, meta) => { meta.size_after = bytes })
  const under = await sized(399999999)
  assert.strictEqual(under.ok, true, '399,999,999 bytes passes')
  assert.strictEqual(under.storage.level, 'OK')
  const over = await sized(400000000)
  assert.strictEqual(over.ok, false, '400,000,000 bytes fails the run')
  assert.strictEqual(over.storage.level, 'ALARM')
  assert.deepStrictEqual(over.problems, ['storage-alarm'])
  assert.ok(over.results.every((r) => r.ok), 'the queries themselves were fine: the alarm is the whole failure')
  // the size is read from the LAST response that carried one
  const lastWins = await run((name, rows, meta) => { meta.size_after = name === names[names.length - 1] ? 401 * MB : 200 * MB })
  assert.strictEqual(lastWins.storage.level, 'ALARM')
  // no response carried a size while queries answered: a blind alarm is a failure
  const blind = await run((name, rows, meta) => { meta.size_after = undefined })
  assert.strictEqual(blind.ok, false)
  assert.strictEqual(blind.storage.level, 'UNKNOWN')
  assert.deepStrictEqual(blind.problems, ['storage-size-unreadable'])

  // the read ceiling: equal passes, one over fails
  const ceilingOf = (name) => queries.find((q) => q.name === name).maxRowsRead
  const atCeiling = await run((name, rows, meta) => { meta.rows_read = ceilingOf(name) })
  assert.strictEqual(atCeiling.ok, true, 'reading exactly the ceiling is within it')
  const pastCeiling = await run((name, rows, meta) => { if (name === names[1]) meta.rows_read = ceilingOf(name) + 1 })
  assert.strictEqual(pastCeiling.ok, false)
  assert.deepStrictEqual(pastCeiling.results.filter((r) => !r.ok).map((r) => [r.name, r.problems]), [[names[1], ['read-ceiling-exceeded']]])
  assert.strictEqual(pastCeiling.results[1].rowsRead, ceilingOf(names[1]) + 1)

  // a statement that reports a write is refused, whatever it returned
  const wrote = await run((name, rows, meta) => { if (name === names[0]) meta.rows_written = 1 })
  assert.deepStrictEqual(wrote.results.filter((r) => !r.ok).map((r) => [r.name, r.problems]), [[names[0], ['d1-reported-a-write']]])

  // wrangler itself failing: an exit code, a timeout; the Cloudflare code survives, the text does not reach the public lines
  const failed = await run((name) => {
    if (name === names[2]) return { fail: { code: 1, stdout: '', stderr: 'Error [code: 7500] something about CANARY-ROW', timedOut: false } }
    if (name === names[3]) return { fail: { code: 1, stdout: '', stderr: '', timedOut: true } }
  })
  assert.strictEqual(failed.ok, false)
  assert.deepStrictEqual(failed.results[2].problems, ['wrangler-exit-nonzero'])
  assert.deepStrictEqual(failed.results[2].errorCodes, [7500])
  assert.deepStrictEqual(failed.results[3].problems, ['wrangler-timed-out'])
  assert.strictEqual(failed.storage.level, 'OK', 'size still comes from the queries that answered')
  // every query failing: the size is unknown but that adds no problem of its own (nothing answered)
  const dead = await run(() => ({ fail: { code: 1, stdout: '', stderr: '', timedOut: false } }))
  assert.strictEqual(dead.ok, false)
  assert.strictEqual(dead.storage.level, 'UNKNOWN')
  assert.deepStrictEqual(dead.problems, [])
}

async function main() {
  const common = await import(pathToFileURL(path.join(OPS_SCRIPTS, 'ops-common.mjs')).href)
  const guard = await import(pathToFileURL(path.join(OPS_SCRIPTS, 'ops-sql-guard.mjs')).href)
  const c = await import(pathToFileURL(path.join(OPS_SCRIPTS, 'ops-consistency.mjs')).href)

  await check('the packs are exactly the ops/queries families: five recent-*, fourteen health-* without the -rows drill-down', () => {
    const files = fs.readdirSync(path.join(ROOT, 'ops', 'queries')).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4))
    assert.deepStrictEqual(Object.keys(c.PACKS), ['recent', 'full'])
    assert.deepStrictEqual([...c.PACKS.recent].sort(), files.filter((f) => f.startsWith('recent-')).sort(), 'a new recent-* file must be added to the recent pack')
    assert.deepStrictEqual([...c.PACKS.full].sort(), files.filter((f) => f.startsWith('health-') && !f.endsWith('-rows')).sort(), 'a new health-* file must be added to the full pack')
    assert.strictEqual(c.PACKS.recent.length, 5)
    assert.strictEqual(c.PACKS.full.length, 14)
    assert.ok(Object.isFrozen(c.PACKS) && Object.isFrozen(c.PACKS.recent) && Object.isFrozen(c.PACKS.full))
    assert.strictEqual(new Set([...c.PACKS.recent, ...c.PACKS.full]).size, 19, 'no file in both packs')
  })

  await check('every pack file passes the guard with a numeric read ceiling; Tier A files stay under 20k each and the pack under 2% of a Free day at every ceiling', () => {
    for (const pack of Object.keys(c.PACKS)) {
      const queries = c.loadPack(pack)
      assert.strictEqual(queries.length, c.PACKS[pack].length)
      for (const q of queries) {
        assert.ok(Number.isInteger(q.maxRowsRead) && q.maxRowsRead > 0 && !q.refusedOnFree, `${q.name}: a numeric read ceiling`)
        assert.ok(q.sql.length <= guard.MAX_SQL_CHARS)
      }
    }
    const recent = c.loadPack('recent')
    for (const q of recent) {
      assert.ok(q.maxRowsRead <= 20000, `${q.name}: ${q.maxRowsRead} is over the 20,000 of one Tier A file`)
      assert.ok(q.rules.expectZero && q.rules.expectZero.length > 0 && q.rules.expectZero !== '*', `${q.name}: names its alarm columns`)
    }
    assert.ok(c.packCeiling(recent) <= 100000, `Tier A ceilings sum to ${c.packCeiling(recent)}, over 2% of a 5,000,000 Free day`)
    assert.ok(recent.every((q) => q.maxRowsRead >= 2000), 'no Tier A ceiling is so tight that a quiet import day fails it')
    assert.ok(c.packCeiling(c.loadPack('full')) < 2.5e6, 'the weekly pack stays under half a Free day')
  })

  await check('a pack file with no ceiling, or one refused on Free, stops the run before any call to production', () => {
    const real = guard.loadQuery('recent-shift-cash')
    assert.throws(() => c.loadPack('recent', () => ({ ...real, maxRowsRead: null, refusedOnFree: true })), (e) => e.code === 'pack-query-unbudgeted')
    assert.throws(() => c.loadPack('recent', () => ({ ...real, maxRowsRead: 0 })), (e) => e.code === 'pack-query-unbudgeted')
    assert.throws(() => c.loadPack('recent', () => { throw new common.OpsError('query-not-found') }), (e) => e.code === 'query-not-found')
  })

  await check('the pack name is exactly recent or full', () => {
    assert.strictEqual(c.parsePack('recent'), 'recent')
    assert.strictEqual(c.parsePack(' full '), 'full')
    for (const bad of ['', 'Recent', 'weekly', 'recent,full', '__proto__', 'constructor', 'toString', undefined, null]) {
      assert.throws(() => c.parsePack(bad), (e) => e.code === 'pack-invalid', `must refuse ${String(bad)}`)
    }
  })

  await check('alarm columns are counted per column, a missing one counts, and a query without any counts zero', () => {
    const rules = { expectZero: ['a', 'b'] }
    assert.strictEqual(c.nonZeroColumns([{ a: 0, b: 0 }], rules), 0)
    assert.strictEqual(c.nonZeroColumns([{ a: 1, b: 0 }], rules), 1)
    assert.strictEqual(c.nonZeroColumns([{ a: 3, b: 7 }], rules), 2)
    assert.strictEqual(c.nonZeroColumns([{ a: 0 }], rules), 1, 'a missing column is not a pass')
    assert.strictEqual(c.nonZeroColumns([{ a: '0', b: null }], rules), 2, 'only a number 0 is zero')
    assert.strictEqual(c.nonZeroColumns([{ a: 1, b: 1 }, { a: 1, b: 0 }], rules), 3, 'every row counts')
    assert.strictEqual(c.nonZeroColumns([{ x: 0, y: 5 }], { expectZero: '*' }), 1)
    assert.strictEqual(c.nonZeroColumns([{ x: 5 }], {}), 0)
    assert.strictEqual(c.nonZeroColumns([{ x: 5 }], null), 0)
  })

  await check('the real Tier A queries on the migrated chain: green when clean, red and counted when planted, the storage line to the byte', async () => {
    await scenario(c, c.loadPack)
  })

  await check('the full pack runs end to end the same way (fourteen queries, one verdict)', async () => {
    const queries = c.loadPack('full')
    const outcome = await c.runPack({ queries, runQuery: sqliteExecutor(queries), now: NOW, baseline: [] })
    assert.strictEqual(outcome.ok, true)
    assert.strictEqual(outcome.results.length, 14)
    const planted = await c.runPack({ queries, runQuery: sqliteExecutor(queries, (name, rows) => { if (name === 'health-stock-ledgers') { rows[0][queries.find((q) => q.name === name).rules.expectZero[0]] = 2; return { rows } } }), now: NOW, baseline: [] })
    assert.strictEqual(planted.ok, false)
    assert.deepStrictEqual(planted.results.filter((r) => !r.ok).map((r) => r.name), ['health-stock-ledgers'])
    const alarmed = outcome.results.filter((r) => r.alarmed).map((r) => r.name)
    assert.deepStrictEqual(alarmed, ['health-stock-ledgers'], 'only one Tier B file carries alarm columns today; the public log must not call the others green on figures it never checked')
    const printed = c.publicLines({ pack: 'full', outcome, bytes: 1 }).map(([t, v]) => common.formatPublic(t, v))
    assert.ok(printed.includes('health-sale-money: PASS (ran inside its ceiling; no alarm columns, figures in the encrypted file)'))
    assert.ok(printed.includes('health-stock-ledgers: PASS, 0 alarm columns not zero'))
    assert.ok(!printed.some((l) => l.startsWith('health-sale-money') && l.includes('alarm columns not zero')))
  })

  await check('the public log: only words, counts and file names; a canary row never reaches it, nor the clear text of the report', async () => {
    const queries = c.loadPack('recent')
    const CANARY = 'Mrs. Canary 0123456789 uploads/products/canary.jpg'
    const outcome = await c.runPack({
      queries,
      runQuery: sqliteExecutor(queries, (name, rows) => { if (name === queries[0].name) { rows[0].customer_name = CANARY; rows[0][queries[0].rules.expectZero[0]] = 12345; return { rows } } }),
      now: NOW,
      baseline: [],
    })
    assert.strictEqual(outcome.ok, false)
    const lines = c.publicLines({ pack: 'recent', outcome, bytes: 4321 })
    const printed = lines.map(([template, values]) => common.formatPublic(template, values))
    for (const line of printed) {
      assert.ok(!line.includes(CANARY) && !line.includes('12345'), `a figure or a name reached the public log: ${line}`)
      assert.ok(line.length <= 200)
    }
    assert.ok(printed[0].startsWith('consistency pack recent: 5 queries, read ceiling '))
    assert.ok(printed.includes(`${queries[0].name}: FAIL, 1 alarm columns not zero`))
    assert.ok(printed.includes(`${queries[1].name}: PASS, 0 alarm columns not zero`))
    assert.ok(printed.includes('problem: expect-zero-failed'))
    assert.ok(printed.includes('storage: OK, 250 MB of the 500 MB Free cap'))
    assert.ok(printed.includes('encrypted file: 4321 bytes'))
    assert.strictEqual(printed[printed.length - 1], 'consistency verdict: FAIL')
    // the storage words, each through the formatter
    const sized = async (bytes, baseline = []) => c.publicLines({ pack: 'recent', outcome: await c.runPack({ queries, runQuery: sqliteExecutor(queries, (n, r, meta) => { meta.size_after = bytes }), now: NOW, baseline }), bytes: 1 }).map(([t, v]) => common.formatPublic(t, v))
    assert.ok((await sized(401 * MB)).includes('storage: ALARM, 401 MB of the 500 MB Free cap'))
    assert.ok((await sized(401 * MB)).includes('problem: storage-alarm'))
    const watching = await sized(300 * MB, [{ date: '2026-10-03', bytes: 280 * MB }])
    assert.ok(watching.includes('storage: WATCH, 300 MB of the 500 MB Free cap'))
    assert.ok(watching.some((l) => /^storage: about \d+ days to the 400 MB alarm/.test(l)))
    // and the report on disk holds none of it in the clear
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-consistency-'))
    try {
      const report = common.writeEncryptedReport(dir, 'consistency-recent-1', { results: outcome.results }, { kind: 'consistency', name: 'recent', commit: 'unknown', runId: 'local', createdAt: NOW.toISOString() })
      const text = fs.readFileSync(report.file, 'utf8')
      assert.ok(!text.includes('Canary') && !text.includes('12345'), 'the report is not encrypted')
      assert.ok(JSON.stringify(outcome.results).includes('Canary'), 'the canary is in what gets encrypted')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await check('the report payload keeps what the lead needs: SQL, rules, rows, meta, read counts and the storage verdict', async () => {
    const queries = c.loadPack('recent')
    const outcome = await c.runPack({ queries, runQuery: sqliteExecutor(queries), now: NOW, baseline: [] })
    const r = outcome.results[0]
    for (const key of ['name', 'ok', 'problems', 'errorCodes', 'nonZero', 'ceiling', 'rowsRead', 'rowCount', 'meta', 'rows', 'rules', 'sql', 'wrangler']) assert.ok(key in r, key)
    assert.strictEqual(r.sql, queries[0].sql)
    assert.strictEqual(r.rowsRead, 10)
    assert.strictEqual(outcome.storage.sizeBytes, 250 * MB)
    assert.strictEqual(outcome.storage.sizeMB, 250)
  })

  const mutants = [
    ['storage alarm dropped from the verdict', (s) => s.replace("if (storage.level === 'ALARM') problems.push('storage-alarm')", "if (storage.level === 'ALARM') problems.push('storage-watch-only')")],
    ['read ceiling doubled', (s) => s.replace('rowsRead > query.maxRowsRead', 'rowsRead > query.maxRowsRead * 2')],
    ['alarm-column count blind', (s) => s.replace('for (const name of names) if (!row || row[name] !== 0) columns += 1', 'for (const name of names) if (!row || row[name] === undefined) columns += 1')],
    ['a blind storage alarm passes', (s) => s.replace("if (storage.level === 'UNKNOWN' && results.some((result) => result.meta)) problems.push('storage-size-unreadable')", '')],
  ]
  for (const [label, mutate] of mutants) {
    await check(`mutant caught: ${label}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consistency-mutant-'))
      try {
        fs.cpSync(OPS_SCRIPTS, path.join(dir, 'ops', 'scripts'), { recursive: true })
        const file = path.join(dir, 'ops', 'scripts', 'ops-consistency.mjs')
        const source = fs.readFileSync(file, 'utf8')
        const mutated = mutate(source)
        assert.notStrictEqual(mutated, source, 'the mutation must change the runner')
        fs.writeFileSync(file, mutated)
        const broken = await import(pathToFileURL(file).href)
        // the mutant must fail the scenario that the real runner passes
        await assert.rejects(() => scenario(broken, (pack) => c.loadPack(pack)), /./, 'the scenario must go red on this mutant')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  console.log(process.exitCode ? `test-ops-consistency-native: FAILED (${passed} passed)` : `test-ops-consistency-native: ${passed} checks passed`)
}

main().catch((err) => { process.exitCode = 1; console.error(err) })
