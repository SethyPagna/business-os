#!/usr/bin/env node

import { createRequire } from 'node:module'
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
const expectedDatabaseId = '49795be9-eabe-43f1-8e16-b86faed60cb1'
const probeStatementCount = 91
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function runCapacityProbe(dependencies = {}) {
  validateOperatorConfig()
  const operator = await (dependencies.verifyOperator || verifyCloudflareOperator)()
  const getProxy = dependencies.getPlatformProxy || (() => {
    const require = createRequire(join(root, 'cloudflare/package.json'))
    return require('wrangler').getPlatformProxy({ configPath: operatorConfigPath, remoteBindings: true })
  })
  let platform
  let result
  try {
    platform = await getProxy()
    const db = platform?.env?.DB
    assert(db?.prepare && db?.batch, 'remote D1 binding is unavailable')
    const statements = Array.from({ length: probeStatementCount }, (_, index) => db.prepare('SELECT ? AS probe_index').bind(index + 1))
    const results = await db.batch(statements)
    assert(Array.isArray(results) && results.length === probeStatementCount, 'read-only D1 capacity probe result count mismatch')
    results.forEach((entry, index) => {
      assert(entry?.success !== false, `read-only D1 capacity probe statement ${index + 1} failed`)
      assert(Number(entry?.meta?.changes) === 0, `read-only D1 capacity probe statement ${index + 1} reported a write`)
      assert(Number(entry?.results?.[0]?.probe_index) === index + 1, `read-only D1 capacity probe statement ${index + 1} returned the wrong marker`)
    })
    result = {
      status: 'read_only_capacity_verified',
      cloudflare_operator: operator,
      database_id: expectedDatabaseId,
      batch_calls: 1,
      statements: probeStatementCount,
      successful_results: results.length,
      writes: 0,
    }
  } finally {
    await platform?.dispose?.()
  }
  return { ...result, remote_binding_disposed: true }
}

async function main() {
  assert(process.argv.slice(2).length === 0, 'capacity probe accepts no command-line options')
  process.stdout.write(`${JSON.stringify(await runCapacityProbe(), null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'read_only_capacity_probe_failed', error: redactErrorMessage(error) })}\n`)
  process.exitCode = 1
})

export { probeStatementCount, runCapacityProbe }
