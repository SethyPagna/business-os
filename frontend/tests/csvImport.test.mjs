import assert from 'node:assert/strict'
import { normalizeCsvKey, parseCsvNumber, parseCsvRows } from '../src/utils/csvImport.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('parseCsvRows handles quoted values and trims headers', () => {
  const rows = parseCsvRows(' "Name" , "Quantity" , "Note"\n"Alpha, Beta",2," hello " ')
  assert.deepEqual(rows, [
    { name: 'Alpha, Beta', quantity: '2', note: 'hello' },
  ])
})

await runTest('normalizeCsvKey lowercases and trims values', () => {
  assert.equal(normalizeCsvKey('  SKU-001  '), 'sku-001')
})

await runTest('parseCsvNumber falls back for invalid numbers', () => {
  assert.equal(parseCsvNumber('12.5', 0), 12.5)
  assert.equal(parseCsvNumber('oops', 7), 7)
})

if (failed > 0) {
  process.exitCode = 1
}
