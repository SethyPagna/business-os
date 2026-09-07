#!/usr/bin/env node

import assert from 'node:assert/strict'
import { runTransportDiagnostic, stages } from './diagnose-historical-repair-transport.mjs'

const ids = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./repair-manifest.json', import.meta.url), 'utf8'))).batching.fee_chunks[0].ids

function fixtureRow(id) {
  return { id, branch_id: null, marker: `row-${id}` }
}

function fakePlatform({ hang = false } = {}) {
  const calls = []
  let disposed = false
  const prepare = (sql) => {
    assert.match(sql, /^SELECT\b/)
    calls.push({ kind: 'prepare', sql })
    return {
      all: async () => {
        if (hang) return new Promise(() => {})
        const rows = sql === 'SELECT 1 AS marker'
          ? [{ marker: 1 }]
          : (sql.includes(`IN (${ids[0]})`) ? ids.slice(0, 1) : ids).map(fixtureRow)
        return { results: rows, meta: { changes: 0 } }
      },
    }
  }
  const db = {
    prepare,
    batch: async (statements) => {
      calls.push({ kind: 'batch', count: statements.length })
      const result = await statements[0].all()
      return [{ ...result, success: true }]
    },
  }
  return {
    value: {
      env: { DB: db },
      dispose: async () => { disposed = true },
    },
    calls,
    wasDisposed: () => disposed,
  }
}

for (const stage of stages) {
  const platform = fakePlatform()
  const result = await runTransportDiagnostic(stage, {
    verifyOperator: async () => ({ account_id: 'test', api_token_id: 'test' }),
    getPlatformProxy: async () => platform.value,
    timeoutMs: 100,
  })
  assert.equal(result.stage, stage)
  assert.equal(result.writes, 0)
  assert.equal(result.remote_binding_disposed, true)
  assert.equal(platform.wasDisposed(), true)
  assert.equal(result.rows, stage === 'marker-all' || stage === 'one-row-all' ? 1 : 99)
  assert.equal(platform.calls.some((call) => !/^SELECT\b/.test(call.sql || 'SELECT')), false)
  assert.equal(platform.calls.filter((call) => call.kind === 'batch').length, stage === 'fee-chunk-batch' ? 1 : 0)
}

const hanging = fakePlatform({ hang: true })
await assert.rejects(
  runTransportDiagnostic('marker-all', {
    verifyOperator: async () => ({ account_id: 'test', api_token_id: 'test' }),
    getPlatformProxy: async () => hanging.value,
    timeoutMs: 10,
  }),
  /exceeded 10ms/,
)
assert.equal(hanging.wasDisposed(), true)

process.stdout.write('historical repair transport diagnostic verifier: PASS\n')
