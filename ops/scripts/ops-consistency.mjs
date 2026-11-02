#!/usr/bin/env node
// consistency job of .github/workflows/ops.yml (and the dispatch-only consistency-watch.yml): runs ONE pack of fixed, guarded,
// read-only health queries against production D1, in a row, and writes the result only as an encrypted file for the owner
// (ops/scripts/ops-crypto.mjs). Nothing here repairs anything (RELIABILITY-PLAN 5.3: a red check opens nothing and writes nothing).
//
//   OPS_PACK     recent = Tier A, the touched rows of the last two business days (the five ops/queries/recent-*.sql, about 20 thousand
//                rows read in all); full = Tier B, the whole health pack (the fourteen ops/queries/health-*.sql without the -rows
//                drill-down), the weekly run, to be started when the shop is closed
//   OPS_OUT_DIR  where consistency-<pack>-<run>.enc.json is written
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  (wrangler reads them)
//
// Every file of the pack is guarded and has to declare a read ceiling BEFORE the first call goes out. Each query runs as one
// `wrangler d1 execute business-os --remote --json` call with the canonical SQL from the guard, and is read by the same
// interpretD1Output the d1-export job uses, so the verdict is the one the owner already trusts. A query also fails when it READ more
// rows than its ceiling: the ceiling is what the Free-day arithmetic was done with, so a production run above it means the CI seed no
// longer matches production (re-measure; it is not drift).
//
// The size of the database comes free with every response (`meta.size_after`). The storage alarm (ops/scripts/metrics/storage-alarm.mjs)
// fails the run at 400 MB and says WATCH when the 12-month projection passes 450 MB.
//
// Public log: the pack, the query file names (from this public repository), PASS or FAIL, how many alarm columns were not zero, the
// pack's read ceiling, the storage level word and the database size in whole megabytes, the encrypted file's size and Cloudflare error
// codes. Never a row, a business figure or an id: those are only in the encrypted file.

import {
  CLOUDFLARE_DIR, OpsError, cloudflareErrorCodes, codesText, commitId, isMain,
  publicToken, requireEnv, runId, runMain, runWrangler, say, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import { interpretD1Output, wranglerArgs } from './ops-d1-export.mjs'
import { loadQuery } from './ops-sql-guard.mjs'
import { evaluateStorage, loadBaseline, sizeFromMetas } from './metrics/storage-alarm.mjs'

// A new health file is added to the pack on purpose: test-ops-consistency-native.cjs fails when ops/queries holds a recent-* or
// health-* file that is in neither list.
export const PACKS = Object.freeze({
  recent: Object.freeze([
    'recent-stock-ledgers',
    'recent-sale-money',
    'recent-returns-money',
    'recent-shift-cash',
    'recent-prepared-figures',
  ]),
  full: Object.freeze([
    'health-catalog-cost',
    'health-identifiers',
    'health-legacy-ledgers',
    'health-loyalty',
    'health-movement-balance',
    'health-product-family',
    'health-r2-references',
    'health-references',
    'health-returns-money',
    'health-sale-money',
    'health-sale-stock-parity',
    'health-shift-coverage',
    'health-stock-ledgers',
    'health-supplier-lots',
  ]),
})

export function parsePack(value) {
  const pack = String(value || '').trim()
  if (!Object.prototype.hasOwnProperty.call(PACKS, pack)) throw new OpsError('pack-invalid', 'OPS_PACK must be recent or full.')
  return pack
}

// Throws on a missing file, a file the guard rejects, or a file with no numeric read ceiling (a refused-on-free file cannot be in a pack).
export function loadPack(pack, load = loadQuery) {
  return PACKS[pack].map((name) => {
    const query = load(name)
    if (!Number.isInteger(query.maxRowsRead) || query.maxRowsRead <= 0) throw new OpsError('pack-query-unbudgeted', `${name} declares no read ceiling.`)
    return query
  })
}

export function packCeiling(queries) {
  return queries.reduce((total, query) => total + query.maxRowsRead, 0)
}

// How many of the alarm columns of a query were not exactly 0 (a missing column counts: it is not a pass).
export function nonZeroColumns(rows, rules) {
  if (!rules || !rules.expectZero) return 0
  let columns = 0
  for (const row of rows) {
    const names = rules.expectZero === '*' ? Object.keys(row || {}) : rules.expectZero
    for (const name of names) if (!row || row[name] !== 0) columns += 1
  }
  return columns
}

// runQuery(sql) -> { code, stdout, stderr, timedOut }   (runWrangler, or a test double over a local database)
export async function runPack({ queries, runQuery, now = new Date(), baseline = loadBaseline() }) {
  const results = []
  for (const query of queries) {
    const run = await runQuery(query.sql)
    let verdict
    let errorCodes = []
    if (run.code !== 0 || run.timedOut) {
      errorCodes = cloudflareErrorCodes(`${run.stdout}\n${run.stderr}`)
      verdict = { ok: false, problems: [run.timedOut ? 'wrangler-timed-out' : 'wrangler-exit-nonzero'], rows: [], rowCount: undefined, meta: null }
    } else {
      verdict = interpretD1Output(run.stdout, query.rules)
      errorCodes = verdict.errorCodes || []
    }
    const problems = [...verdict.problems]
    const rowsRead = verdict.meta && Number.isFinite(Number(verdict.meta.rows_read)) ? Number(verdict.meta.rows_read) : null
    if (rowsRead !== null && rowsRead > query.maxRowsRead) problems.push('read-ceiling-exceeded')
    results.push({
      name: query.name,
      ok: problems.length === 0,
      problems: [...new Set(problems)],
      errorCodes,
      alarmed: Boolean(query.rules && query.rules.expectZero),
      nonZero: nonZeroColumns(verdict.rows, query.rules),
      ceiling: query.maxRowsRead,
      rowsRead,
      rowCount: verdict.rowCount,
      meta: verdict.meta,
      rows: verdict.rows,
      rules: query.rules,
      sql: query.sql,
      zeroCheck: verdict.zeroCheck,
      wrangler: run.code === 0 && !run.timedOut ? { exitCode: run.code } : {
        exitCode: run.code, timedOut: run.timedOut, stdout: truncate(run.stdout), stderr: truncate(run.stderr),
      },
    })
  }
  const sizeBytes = sizeFromMetas(results.map((result) => result.meta))
  const storage = { sizeBytes, ...evaluateStorage({ sizeBytes, now, baseline }) }
  const problems = []
  if (storage.level === 'ALARM') problems.push('storage-alarm')
  // No size while at least one query answered: the alarm would be blind, and a blind alarm must not look like a pass.
  if (storage.level === 'UNKNOWN' && results.some((result) => result.meta)) problems.push('storage-size-unreadable')
  return { ok: results.every((result) => result.ok) && problems.length === 0, results, storage, problems, ceiling: packCeiling(queries) }
}

// Pure: the only lines the public log may show for a pack run.
export function publicLines({ pack, outcome, bytes }) {
  const { results, storage, problems, ceiling } = outcome
  const lines = [['consistency pack {pack}: {queries} queries, read ceiling {ceiling} rows', { pack, queries: results.length, ceiling }]]
  for (const result of results) {
    const query = publicToken(result.name)
    // A file with no alarm columns only says that it ran inside its ceiling: its figures are for the owner to compare, in the encrypted file.
    if (result.alarmed) lines.push(['{query}: {result}, {columns} alarm columns not zero', { query, result: result.ok ? 'PASS' : 'FAIL', columns: result.nonZero }])
    else lines.push(['{query}: {result} (ran inside its ceiling; no alarm columns, figures in the encrypted file)', { query, result: result.ok ? 'PASS' : 'FAIL' }])
    for (const problem of result.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
    if (result.errorCodes.length) lines.push(['cloudflare error codes: {codes}', { codes: publicToken(codesText(result.errorCodes)) }])
  }
  if (storage.level === 'UNKNOWN') lines.push(['storage: {level} (no response carried a size)', { level: storage.level }])
  else lines.push(['storage: {level}, {size} MB of the 500 MB Free cap', { level: storage.level, size: Math.round(storage.sizeMB) }])
  if (storage.level !== 'UNKNOWN' && Number.isFinite(storage.daysTo400) && storage.daysTo400 > 0 && storage.level === 'WATCH') {
    lines.push(['storage: about {days} days to the 400 MB alarm at the steepest recent growth', { days: storage.daysTo400 }])
  }
  for (const problem of problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (bytes !== undefined) lines.push(['encrypted file: {bytes} bytes', { bytes }])
  lines.push(['consistency verdict: {verdict}', { verdict: outcome.ok ? 'PASS' : 'FAIL' }])
  return lines
}

async function main() {
  const pack = parsePack(requireEnv('OPS_PACK'))
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const startedAt = new Date().toISOString()
  const commit = commitId()
  const run = runId()

  // Everything is guarded and budgeted before the first call to production.
  const queries = loadPack(pack)
  say('sql guard: {result} ({queries} read-only statements, each with a read ceiling)', { result: 'PASS', queries: queries.length })

  const outcome = await runPack({
    queries,
    runQuery: (sql) => runWrangler(wranglerArgs(sql), { cwd: CLOUDFLARE_DIR, timeoutMs: 5 * 60 * 1000 }),
  })

  const finishedAt = new Date().toISOString()
  const payload = {
    kind: 'consistency',
    pack,
    database: 'business-os',
    commit,
    runId: run,
    startedAt,
    finishedAt,
    ok: outcome.ok,
    problems: outcome.problems,
    ceiling: outcome.ceiling,
    storage: outcome.storage,
    results: outcome.results,
  }
  const report = writeEncryptedReport(outDir, `consistency-${pack}-${run}`, payload, {
    kind: 'consistency', name: pack, commit, runId: run, createdAt: finishedAt,
  })
  for (const [template, values] of publicLines({ pack, outcome, bytes: report.bytes })) {
    say(template, values)
    summary(template, values)
  }
  return outcome.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
