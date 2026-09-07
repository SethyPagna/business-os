#!/usr/bin/env node

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  redactErrorMessage,
  validateOperatorConfig,
  verifyCloudflareOperator,
} from './run-historical-repair.mjs'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(evidenceDir, '../../..')
const operatorConfigPath = join(evidenceDir, 'operator-wrangler.toml')
const manifestPath = join(evidenceDir, 'repair-manifest.json')
const expectedDatabaseId = '49795be9-eabe-43f1-8e16-b86faed60cb1'
const stageTimeoutMs = 30_000
const stages = Object.freeze(['marker-all', 'one-row-all', 'fee-chunk-all', 'fee-chunk-batch'])
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const sqlIds = (ids) => ids.map((id) => {
  assert(Number.isSafeInteger(id) && id > 0, 'manifest contains an invalid row ID')
  return String(id)
}).join(',')

async function withinTimeout(operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`read-only transport stage exceeded ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function summarizeAllResult(result, expectedRows) {
  assert(Array.isArray(result?.results), 'D1 .all() did not return rows')
  assert(result.results.length === expectedRows, `D1 .all() returned ${result.results.length} rows; expected ${expectedRows}`)
  assert(Number(result?.meta?.changes) === 0, 'D1 .all() reported a write')
  return {
    result_sets: 1,
    rows: result.results.length,
    serialized_result_bytes: Buffer.byteLength(JSON.stringify(result)),
    writes: 0,
  }
}

function summarizeBatchResult(results, expectedRows) {
  assert(Array.isArray(results) && results.length === 1, 'D1 batch did not return exactly one result')
  const result = results[0]
  assert(result?.success !== false, 'D1 batch returned an unsuccessful result')
  assert(Array.isArray(result?.results), 'D1 batch result did not contain rows')
  assert(result.results.length === expectedRows, `D1 batch returned ${result.results.length} rows; expected ${expectedRows}`)
  assert(Number(result?.meta?.changes) === 0, 'D1 batch reported a write')
  return {
    result_sets: results.length,
    rows: result.results.length,
    serialized_result_bytes: Buffer.byteLength(JSON.stringify(results)),
    writes: 0,
  }
}

async function executeStage(db, stage, feeIds) {
  if (stage === 'marker-all') {
    return summarizeAllResult(await db.prepare('SELECT 1 AS marker').all(), 1)
  }
  const ids = stage === 'one-row-all' ? feeIds.slice(0, 1) : feeIds
  const sql = `SELECT * FROM fees WHERE id IN (${sqlIds(ids)}) ORDER BY id`
  if (stage === 'fee-chunk-batch') {
    return summarizeBatchResult(await db.batch([db.prepare(sql)]), ids.length)
  }
  return summarizeAllResult(await db.prepare(sql).all(), ids.length)
}

async function runTransportDiagnostic(stage, dependencies = {}) {
  assert(stages.includes(stage), `stage must be one of: ${stages.join(', ')}`)
  validateOperatorConfig()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const feeIds = manifest?.batching?.fee_chunks?.[0]?.ids
  assert(Array.isArray(feeIds) && feeIds.length === 99, 'reviewed manifest first fee chunk is not exactly 99 rows')
  const operator = await (dependencies.verifyOperator || verifyCloudflareOperator)()
  const getProxy = dependencies.getPlatformProxy || (() => {
    const require = createRequire(join(root, 'cloudflare/package.json'))
    return require('wrangler').getPlatformProxy({ configPath: operatorConfigPath, remoteBindings: true })
  })
  const timeoutMs = dependencies.timeoutMs || stageTimeoutMs
  let platform
  let summary
  try {
    platform = await getProxy()
    const db = platform?.env?.DB
    assert(db?.prepare && db?.batch, 'remote D1 binding is unavailable')
    summary = await withinTimeout(() => executeStage(db, stage, feeIds), timeoutMs)
  } finally {
    await platform?.dispose?.()
  }
  return {
    status: 'read_only_transport_stage_verified',
    stage,
    cloudflare_operator: operator,
    database_id: expectedDatabaseId,
    timeout_ms: timeoutMs,
    ...summary,
    remote_binding_disposed: true,
  }
}

async function main() {
  const args = process.argv.slice(2)
  assert(args.length === 2 && args[0] === '--stage', 'usage: diagnose-historical-repair-transport.mjs --stage <stage>')
  process.stdout.write(`${JSON.stringify(await runTransportDiagnostic(args[1]), null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'read_only_transport_stage_failed', error: redactErrorMessage(error) })}\n`)
  process.exitCode = 1
})

export { runTransportDiagnostic, stageTimeoutMs, stages }
