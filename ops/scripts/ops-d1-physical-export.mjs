#!/usr/bin/env node
// d1-physical-export job of .github/workflows/ops.yml: a read-only, keyset-paged copy of EVERY physical table
// of the production D1 database (FTS5 virtual and shadow tables, sqlite_* and _cf_* internals left out),
// written only as encrypted per-table JSONL chunks plus one encrypted manifest (ops/scripts/ops-crypto.mjs).
// The local loader (ops/scripts/latest-data/load-d1-physical-export.mjs) rebuilds a SQLite database from them.
//
//   OPS_OUT_DIR  where d1phys-<run>-manifest.enc.json and d1phys-<run>-f<seq>.enc.json are written
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  (wrangler reads them)
//
// Every statement is built by ops-d1-physical-lib.mjs, passes ops-sql-guard.mjs (one SELECT, nothing else)
// and runs as: wrangler d1 execute business-os --remote --json --command "<sql>". A result that reports a
// write of any kind fails the run. Public log: the verdict, fixed problem codes, file and byte counts and
// Cloudflare error codes -- never a table name, a row count or a row; those are in the encrypted manifest.

import {
  CLOUDFLARE_DIR, OpsError, cloudflareErrorCodes, codesText, commitId, isMain, publicToken,
  requireEnv, runId, runMain, runWrangler, say, summary, writeEncryptedReport,
} from './ops-common.mjs'
import { guardSql } from './ops-sql-guard.mjs'
import { parseJsonOutput, wranglerArgs } from './ops-d1-export.mjs'
import { CHUNK_KIND, MANIFEST_KIND, exportAll, manifestVerdict } from './ops-d1-physical-lib.mjs'

const RETRYABLE = /exceeded its CPU time limit|\[code: 7429\]|D1 DB is overloaded|Requests queued for too long|network connection lost|fetch failed|ECONNRESET|ETIMEDOUT|timed out|internal error/i

// Pure: what wrangler printed -> { ok, rows, meta, retryable, errorCodes }. Row text never leaves this value.
export function interpretWranglerResult(result) {
  const text = `${result.stdout || ''}\n${result.stderr || ''}`
  const errorCodes = cloudflareErrorCodes(text)
  if (result.timedOut) return { ok: false, retryable: true, errorCodes }
  if (result.code !== 0) return { ok: false, retryable: RETRYABLE.test(text), errorCodes }
  const parsed = parseJsonOutput(result.stdout)
  if (!Array.isArray(parsed) || parsed.length !== 1) return { ok: false, retryable: false, errorCodes }
  const set = parsed[0]
  if (!set || !Array.isArray(set.results) || set.success === false) return { ok: false, retryable: false, errorCodes }
  const meta = set.meta && typeof set.meta === 'object' ? set.meta : {}
  if (Number(meta.rows_written || 0) !== 0 || Number(meta.changes || 0) !== 0 || meta.changed_db === true) {
    return { ok: false, retryable: false, errorCodes, wrote: true }
  }
  if (set.results.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) return { ok: false, retryable: false, errorCodes }
  return { ok: true, rows: set.results, meta, retryable: false, errorCodes }
}

// The one place a statement reaches D1: guarded, canonical, read-only.
export async function runGuarded(sql, { timeoutMs = 3 * 60 * 1000 } = {}) {
  const canonical = guardSql(sql).sql
  const result = await runWrangler(wranglerArgs(canonical), { cwd: CLOUDFLARE_DIR, timeoutMs })
  return interpretWranglerResult(result)
}

export function chunkMeta(run, commit, seq) {
  return { kind: CHUNK_KIND, run, commit, seq, createdAt: new Date().toISOString() }
}

// Pure: the only lines the public log may show.
export function publicLines({ verdict, manifest, errorCodes = [] }) {
  const lines = [['d1-physical-export sql guard: {result} (every statement one read-only SELECT)', { result: 'PASS' }]]
  lines.push(['tables, rows and sizes: {tables} (in the encrypted manifest)', { tables: 'withheld' }])
  lines.push(['encrypted files: {files}', { files: manifest.totals.files }])
  lines.push(['encrypted bytes: {bytes}', { bytes: manifest.totals.encryptedBytes }])
  lines.push(['tables changed while exporting: {count}', { count: manifest.changedDuringExport.length }])
  lines.push(['failed tables: {count}', { count: verdict.failedTables }])
  for (const problem of verdict.codes) lines.push(['problem: {code}', { code: new OpsError(problem) }])
  if (errorCodes.length) lines.push(['cloudflare error codes: {codes}', { codes: publicToken(codesText(errorCodes)) }])
  lines.push(['d1-physical-export verdict: {verdict}', { verdict: verdict.ok ? 'PASS' : 'FAIL' }])
  return lines
}

// Runs the whole export into outDir. write(outDir, baseName, payload, meta) -> { bytes } is the encrypting writer
// (writeEncryptedReport; a test passes one with its own key).
export async function exportToDir({ outDir, run, commit, query, write = writeEncryptedReport, concurrency = 3, pause }) {
  const manifest = await exportAll({
    runId: run,
    commit,
    concurrency,
    pause,
    query,
    emit: async ({ seq, text }) => {
      const base = `d1phys-${run}-f${String(seq).padStart(4, '0')}`
      const written = write(outDir, base, text, chunkMeta(run, commit, seq))
      return { file: `${base}.enc.json`, bytes: written.bytes }
    },
  })
  const verdict = manifestVerdict(manifest)
  // The manifest is written last, even after a failure: it says which tables are complete.
  const written = write(outDir, `d1phys-${run}-manifest`, { ...manifest, ok: verdict.ok }, {
    kind: MANIFEST_KIND, run, commit, createdAt: manifest.finishedAt,
  })
  manifest.totals.files += 1
  manifest.totals.encryptedBytes += written.bytes
  return { manifest, verdict }
}

async function main() {
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  requireEnv('CLOUDFLARE_ACCOUNT_ID')
  let errorCodes = []
  const { manifest, verdict } = await exportToDir({
    outDir,
    run: runId(),
    commit: commitId(),
    query: async (sql) => {
      const outcome = await runGuarded(sql)
      if (!outcome.ok) errorCodes = [...new Set([...errorCodes, ...outcome.errorCodes])].slice(0, 5)
      return outcome
    },
  })
  for (const [template, values] of publicLines({ verdict, manifest, errorCodes })) {
    say(template, values)
    summary(template, values)
  }
  return verdict.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
