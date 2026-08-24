import assert from 'node:assert/strict'
import { offsetDate, todayStr } from '../src/utils/dateHelpers.ts'

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

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

runTest('todayStr returns a local YYYY-MM-DD value', () => {
  const value = todayStr()
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(value, offsetDate(0))
})

runTest('offsetDate returns a local date offset from today', () => {
  const today = parseLocalDate(todayStr())
  const tomorrow = parseLocalDate(offsetDate(1))
  const yesterday = parseLocalDate(offsetDate(-1))
  assert.equal(Math.round((tomorrow.getTime() - today.getTime()) / 86_400_000), 1)
  assert.equal(Math.round((today.getTime() - yesterday.getTime()) / 86_400_000), 1)
})

if (failed > 0) {
  process.exitCode = 1
}
