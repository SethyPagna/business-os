#!/usr/bin/env node
// d1-export job of .github/workflows/ops.yml: runs ONE fixed, guarded,
// read-only query file against production D1 and writes the result only as an
// encrypted file for the owner (ops/scripts/ops-crypto.mjs).
//
//   OPS_QUERY    name of ops/queries/<name>.sql (from the workflow input)
//   OPS_OUT_DIR  where <kind>-<name>-<run>.enc.json is written
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  (wrangler reads them)
//
// Runs: wrangler d1 execute business-os --remote --json --command "<sql>"
// with the canonical SQL from ops-sql-guard.mjs. Public log: the query name,
// PASS/FAIL, the expect-zero result, the encrypted file size and Cloudflare
// error codes. Never the row count: that is a table size, and it stays in
// the encrypted file for every query.

import {
  CLOUDFLARE_DIR, OpsError, codesText, cloudflareErrorCodes, commitId, isMain,
  publicToken, requireEnv, runId, runMain, runWrangler, say, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import { loadQuery } from './ops-sql-guard.mjs'

export const DATABASE = 'business-os'

export function wranglerArgs(sql) {
  return ['d1', 'execute', DATABASE, '--remote', '--json', '--command', sql]
}

export function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch { /* fall through */ }
  // Anything printed ahead of the JSON (it should not be, with --json).
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*[[{]/.test(lines[i])) {
      try {
        return JSON.parse(lines.slice(i).join('\n'))
      } catch { /* keep looking */ }
    }
  }
  return undefined
}

// Pure: wrangler's --json stdout + the query's rules -> verdict.
// problems[] holds fixed codes (safe to print); rows are for the report only.
export function interpretD1Output(stdout, rules) {
  const problems = []
  const parsed = parseJsonOutput(stdout)
  if (parsed === undefined) return { ok: false, problems: ['d1-output-not-json'], rows: [], rowCount: 0, meta: null }
  if (!Array.isArray(parsed)) {
    return { ok: false, problems: [parsed && parsed.error ? 'd1-error' : 'd1-output-not-an-array'], rows: [], rowCount: 0, meta: null, errorCodes: cloudflareErrorCodes(JSON.stringify(parsed)) }
  }
  if (parsed.length !== 1) problems.push('d1-expected-one-result-set')
  const set = parsed[0]
  if (!set || !Array.isArray(set.results)) {
    return { ok: false, problems: [...problems, 'd1-no-results-array'], rows: [], rowCount: 0, meta: set && set.meta ? set.meta : null }
  }
  if (set.success === false) problems.push('d1-success-false')
  const meta = set.meta && typeof set.meta === 'object' ? set.meta : {}
  // A read-only statement must report no write of any kind.
  if (Number(meta.rows_written || 0) !== 0 || Number(meta.changes || 0) !== 0 || meta.changed_db === true) {
    problems.push('d1-reported-a-write')
  }
  const rows = set.results
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) problems.push('d1-rows-not-objects')
  if (rows.length < rules.minRows) problems.push('min-rows-not-met')
  if (rules.maxRows !== null && rules.maxRows !== undefined && rows.length > rules.maxRows) problems.push('max-rows-exceeded')
  if (rules.expectZero) {
    let zeroFailed = false
    for (const row of rows) {
      const cols = rules.expectZero === '*' ? Object.keys(row || {}) : rules.expectZero
      if (!cols.length) zeroFailed = true
      for (const col of cols) {
        if (!row || !Object.prototype.hasOwnProperty.call(row, col) || row[col] !== 0) zeroFailed = true
      }
    }
    if (zeroFailed) problems.push('expect-zero-failed')
  }
  const zeroCheck = rules.expectZero ? (problems.includes('expect-zero-failed') ? 'FAIL' : 'PASS') : undefined
  return { ok: problems.length === 0, problems: [...new Set(problems)], rows, rowCount: rows.length, meta, zeroCheck }
}

// Pure: the only lines the public log may show for an export.
export function publicLines({ name, verdict, rules, bytes, errorCodes = [] }) {
  const lines = [['d1-export query {query}', { query: publicToken(name) }]]
  lines.push(['rows: {rows} (in the encrypted file)', { rows: 'withheld' }])
  if (rules && rules.expectZero) {
    lines.push(['expect-zero check: {result}', { result: verdict.zeroCheck || 'SKIPPED' }])
  }
  for (const problem of verdict.problems) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (errorCodes.length) lines.push(['cloudflare error codes: {codes}', { codes: publicToken(codesText(errorCodes)) }])
  if (bytes !== undefined) lines.push(['encrypted file: {bytes} bytes', { bytes }])
  lines.push(['d1-export verdict: {verdict}', { verdict: verdict.ok ? 'PASS' : 'FAIL' }])
  return lines
}

async function main() {
  const name = requireEnv('OPS_QUERY').trim()
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const startedAt = new Date().toISOString()
  const commit = commitId()
  const run = runId()

  // Throws on a bad name, a missing file, or a file the guard rejects.
  const query = loadQuery(name)
  say('sql guard: {result} (one read-only statement)', { result: 'PASS' })

  const result = await runWrangler(wranglerArgs(query.sql), { cwd: CLOUDFLARE_DIR, timeoutMs: 5 * 60 * 1000 })
  let verdict
  let errorCodes = []
  if (result.code !== 0 || result.timedOut) {
    errorCodes = cloudflareErrorCodes(`${result.stdout}\n${result.stderr}`)
    verdict = { ok: false, problems: [result.timedOut ? 'wrangler-timed-out' : 'wrangler-exit-nonzero'], rows: [], rowCount: undefined, meta: null }
  } else {
    verdict = interpretD1Output(result.stdout, query.rules)
    errorCodes = verdict.errorCodes || []
  }

  const payload = {
    kind: 'd1-export',
    query: name,
    database: DATABASE,
    commit,
    runId: run,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: verdict.ok,
    problems: verdict.problems,
    rules: query.rules,
    sql: query.sql,
    rowCount: verdict.rowCount,
    meta: verdict.meta,
    rows: verdict.rows,
    wrangler: verdict.ok ? { exitCode: result.code } : {
      exitCode: result.code,
      timedOut: result.timedOut,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    },
  }
  const report = writeEncryptedReport(outDir, `d1-export-${name}-${run}`, payload, {
    kind: 'd1-export', name, commit, runId: run, createdAt: payload.finishedAt,
  })
  for (const [template, values] of publicLines({ name, verdict, rules: query.rules, bytes: report.bytes, errorCodes })) {
    say(template, values)
    summary(template, values)
  }
  return verdict.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
