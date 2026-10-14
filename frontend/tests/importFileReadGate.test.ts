// The Excel parse runs off the UI thread, so the Inventory, Sales and Contacts
// import dialogs stay interactive while a file is read. The gate each of them
// reads through drops a result that is no longer the latest pick (a newer pick,
// a mode switch, the dialog closing) and aborts the worker behind it, so the
// last pick wins and a late file never lands under a changed choice.
//
// Run: node tests/importFileReadGate.test.ts
import assert from 'node:assert/strict'
import { createImportFileReadGate } from '../src/utils/importFileReadGate.ts'

let passed = 0
async function check(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function recorder() {
  const applied: string[] = []
  const failed: unknown[] = []
  return { applied, failed, apply: (value: string) => { applied.push(value) }, fail: (error: unknown) => { failed.push(error) } }
}

await check('a lone read applies its result', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  await gate.read(async () => 'file A', out.apply, out.fail)
  assert.deepEqual(out.applied, ['file A'])
  assert.deepEqual(out.failed, [])
})

await check('the last pick wins even when an earlier, slower read finishes after it', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  const slow = deferred<string>()
  const first = gate.read(() => slow.promise, out.apply, out.fail)
  const second = gate.read(async () => 'second pick', out.apply, out.fail)
  await second
  slow.resolve('first pick, finished last')
  await first
  assert.deepEqual(out.applied, ['second pick'], 'the stale result was dropped')
})

await check('a newer read aborts the signal of the one it replaces', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  const signals: AbortSignal[] = []
  const slow = deferred<string>()
  const first = gate.read((signal) => { signals.push(signal); return slow.promise }, out.apply, out.fail)
  assert.equal(signals[0].aborted, false)
  const second = gate.read((signal) => { signals.push(signal); return Promise.resolve('b') }, out.apply, out.fail)
  assert.equal(signals[0].aborted, true, 'the replaced read is told to stop')
  await second
  assert.equal(signals[1].aborted, false, 'the current read is not')
  slow.resolve('late')
  await first
  assert.deepEqual(out.applied, ['b'])
})

await check('cancel() drops an in-flight result and aborts it, and the gate works again afterwards', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  let signal!: AbortSignal
  const slow = deferred<string>()
  const pending = gate.read((s) => { signal = s; return slow.promise }, out.apply, out.fail)
  gate.cancel()
  assert.equal(signal.aborted, true)
  slow.resolve('too late for the new mode')
  await pending
  assert.deepEqual(out.applied, [])
  assert.deepEqual(out.failed, [])

  await gate.read(async () => 'fresh', out.apply, out.fail)
  assert.deepEqual(out.applied, ['fresh'])
})

await check('a read that cannot be aborted (the native file picker) is still dropped by cancel()', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  const picker = deferred<string>()
  const pending = gate.read(() => picker.promise, out.apply, out.fail)
  gate.cancel()
  picker.resolve('chosen after the dialog was closed')
  await pending
  assert.deepEqual(out.applied, [])
})

await check('a replaced read that settles late leaves the newer read abortable', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  const stale = deferred<string>()
  const current = deferred<string>()
  let currentSignal!: AbortSignal
  const first = gate.read(() => stale.promise, out.apply, out.fail)
  const second = gate.read((signal) => { currentSignal = signal; return current.promise }, out.apply, out.fail)
  stale.resolve('stale')
  await first
  gate.cancel()
  assert.equal(currentSignal.aborted, true, 'cancel() still reaches the read that is in flight')
  current.resolve('late')
  await second
  assert.deepEqual(out.applied, [])
})

await check('only the current read reports a failure; an aborted or stale one stays silent', async () => {
  const gate = createImportFileReadGate()
  const out = recorder()
  const abortError = new DOMException('The import was cancelled.', 'AbortError')
  const first = gate.read((signal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(abortError))), out.apply, out.fail)
  const second = gate.read(async () => { throw new Error('could not read B') }, out.apply, out.fail)
  await Promise.all([first, second])
  assert.equal(out.failed.length, 1, 'the replaced read did not report its AbortError')
  assert.equal((out.failed[0] as Error).message, 'could not read B')

  const closed = gate.read((signal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(abortError))), out.apply, out.fail)
  gate.cancel()
  await closed
  assert.equal(out.failed.length, 1, 'a cancelled read stays silent')
})

await check('a failure while applying a result is reported like a read failure', async () => {
  const gate = createImportFileReadGate()
  const failed: unknown[] = []
  await gate.read(async () => 'rows', () => { throw new Error('could not analyse the rows') }, (error) => failed.push(error))
  assert.equal((failed[0] as Error).message, 'could not analyse the rows')
})

await check('an async apply finishes before the read settles', async () => {
  const gate = createImportFileReadGate()
  const order: string[] = []
  await gate.read(async () => 'rows', async (value) => { await Promise.resolve(); order.push(`applied ${value}`) }, () => order.push('failed'))
  order.push('settled')
  assert.deepEqual(order, ['applied rows', 'settled'])
})

await check('cancel() with nothing in flight is harmless, and a finished read leaves nothing to abort', async () => {
  const gate = createImportFileReadGate()
  gate.cancel()
  const out = recorder()
  let signal!: AbortSignal
  await gate.read(async (s) => { signal = s; return 'done' }, out.apply, out.fail)
  gate.cancel()
  assert.equal(signal.aborted, false, 'a read that already finished is not aborted by a later cancel')
  assert.deepEqual(out.applied, ['done'])
})

console.log(`ALL PASS importFileReadGate (${passed} checks)`)
