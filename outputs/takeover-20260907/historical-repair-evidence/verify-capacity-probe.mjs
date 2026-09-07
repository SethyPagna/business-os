#!/usr/bin/env node

import { probeStatementCount, runCapacityProbe } from './probe-historical-repair-capacity.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const operator = {
  account_id: '743e5b727d139e85ed11679097f6f99e',
  api_token_id: 'local-probe-token-id',
}

function fakePlatform({ fail = false } = {}) {
  const state = { batchCalls: 0, statementCounts: [], disposed: false }
  const platform = {
    env: {
      DB: {
        prepare(sql) {
          return {
            sql,
            params: [],
            bind(...params) { this.params = params; return this },
          }
        },
        async batch(statements) {
          state.batchCalls += 1
          state.statementCounts.push(statements.length)
          if (fail) throw new Error('synthetic capacity failure')
          return statements.map((statement, index) => {
            assert(statement.sql === 'SELECT ? AS probe_index', 'probe used non-read-only SQL')
            assert(statement.params.length === 1 && statement.params[0] === index + 1, 'probe marker binding mismatch')
            return { success: true, meta: { changes: 0 }, results: [{ probe_index: index + 1 }] }
          })
        },
      },
    },
    async dispose() { state.disposed = true },
  }
  return { platform, state }
}

const success = fakePlatform()
const result = await runCapacityProbe({
  verifyOperator: async () => operator,
  getPlatformProxy: async () => success.platform,
})
assert(result.status === 'read_only_capacity_verified', 'successful probe status mismatch')
assert(result.statements === probeStatementCount && result.successful_results === probeStatementCount, 'successful probe count mismatch')
assert(result.writes === 0 && success.state.batchCalls === 1 && success.state.statementCounts[0] === probeStatementCount, 'probe did not execute one 91-statement read-only batch')
assert(success.state.disposed && result.remote_binding_disposed, 'successful probe did not dispose its proxy')

const failure = fakePlatform({ fail: true })
let failureObserved = false
try {
  await runCapacityProbe({
    verifyOperator: async () => operator,
    getPlatformProxy: async () => failure.platform,
  })
} catch (error) {
  failureObserved = /synthetic capacity failure/.test(String(error.message))
}
assert(failureObserved && failure.state.batchCalls === 1 && failure.state.disposed, 'failed probe did not fail safely and dispose its proxy')

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  successful_probe: { batch_calls: success.state.batchCalls, statements: success.state.statementCounts[0], writes: result.writes, disposed: success.state.disposed },
  failed_probe: { failure_observed: failureObserved, batch_calls: failure.state.batchCalls, disposed: failure.state.disposed },
}, null, 2)}\n`)
