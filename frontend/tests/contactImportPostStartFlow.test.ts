import assert from 'node:assert/strict'
import { decideContactImportPostStartAction } from '../src/components/contacts/contactImportPostStartFlow.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('no job snapshot yet keeps polling', () => {
  assert.deepEqual(decideContactImportPostStartAction(null), { kind: 'keep_polling' })
  assert.deepEqual(decideContactImportPostStartAction(undefined), { kind: 'keep_polling' })
})

await runTest('pending/queued/analyzing all keep polling', () => {
  for (const status of ['pending', 'queued', 'analyzing']) {
    assert.deepEqual(decideContactImportPostStartAction({ status }), { kind: 'keep_polling' }, status)
  }
})

await runTest('status is case/whitespace-normalized, same as normalizeJobStatus', () => {
  assert.deepEqual(decideContactImportPostStartAction({ status: '  Analyzing ' }), { kind: 'keep_polling' })
})

await runTest('failed and cancelled are terminal -- stop polling, do not open the conflicts modal', () => {
  assert.deepEqual(decideContactImportPostStartAction({ status: 'failed' }), { kind: 'terminal' })
  assert.deepEqual(decideContactImportPostStartAction({ status: 'cancelled' }), { kind: 'terminal' })
})

await runTest('awaiting_review with warned rows shows the conflicts step', () => {
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review', summary: { warned: 4 } }),
    { kind: 'show_conflicts' },
  )
})

await runTest('awaiting_review with zero (or missing) warned rows goes straight to ready_to_approve', () => {
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review', summary: { warned: 0 } }),
    { kind: 'ready_to_approve' },
  )
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review' }),
    { kind: 'ready_to_approve' },
  )
})

await runTest('any other/unexpected status (e.g. approved, completed, running) keeps polling rather than guessing', () => {
  for (const status of ['approved', 'completed', 'running', 'applying', 'completed_with_errors', 'weird_unknown_status']) {
    assert.deepEqual(decideContactImportPostStartAction({ status }), { kind: 'keep_polling' }, status)
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
