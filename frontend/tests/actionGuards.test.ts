import assert from 'node:assert/strict'
import {
  beginKeyedAction,
  beginNamedAction,
  beginSingleAction,
  finishKeyedAction,
  finishNamedAction,
  finishSingleAction,
} from '../src/utils/actionGuards.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('single action guard blocks repeats until finished', () => {
  const ref = { current: false }
  assert.equal(beginSingleAction(ref), true)
  assert.equal(ref.current, true)
  assert.equal(beginSingleAction(ref), false)
  finishSingleAction(ref)
  assert.equal(ref.current, false)
  assert.equal(beginSingleAction(ref, { value: 'saving' }), true)
  assert.equal(ref.current, 'saving')
})

runTest('single action guard respects external blocked state', () => {
  const ref = { current: false }
  assert.equal(beginSingleAction(ref, { blocked: true }), false)
  assert.equal(ref.current, false)
})

runTest('named action guard tracks the active action name', () => {
  const ref = { current: '' }
  assert.equal(beginNamedAction(ref, 'import'), true)
  assert.equal(ref.current, 'import')
  assert.equal(beginNamedAction(ref, 'retry'), false)
  finishNamedAction(ref, 'retry')
  assert.equal(ref.current, 'import')
  finishNamedAction(ref, 'import')
  assert.equal(ref.current, '')
})

runTest('keyed action guard allows different keys but blocks duplicate keys', () => {
  const ref = { current: new Set<string>() }
  assert.equal(beginKeyedAction(ref, 'logo'), true)
  assert.equal(beginKeyedAction(ref, 'logo'), false)
  assert.equal(beginKeyedAction(ref, 'cover'), true)
  assert.deepEqual(Array.from(ref.current).sort(), ['cover', 'logo'])
  finishKeyedAction(ref, 'logo')
  assert.equal(beginKeyedAction(ref, 'logo'), true)
})

runTest('keyed action guard rejects blank keys and blocked starts', () => {
  const ref = { current: new Set<string>() }
  assert.equal(beginKeyedAction(ref, ''), false)
  assert.equal(beginKeyedAction(ref, 'avatar', { blocked: true }), false)
  assert.equal(ref.current.size, 0)
})

if (failed > 0) {
  process.exitCode = 1
}
