import assert from 'node:assert/strict'
import { normalizeCsvKey, normalizeCsvMoney, parseCsvNumber, parseCsvRows } from '../src/utils/csvImport.js'

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
    { _rowNumber: 2, name: 'Alpha, Beta', quantity: '2', note: 'hello' },
  ])
})

await runTest('normalizeCsvKey lowercases and trims values', () => {
  assert.equal(normalizeCsvKey('  SKU-001  '), 'sku-001')
})

await runTest('parseCsvNumber falls back for invalid numbers', () => {
  assert.equal(parseCsvNumber('12.5', 0), 12.5)
  assert.equal(parseCsvNumber('oops', 7), 7)
})

await runTest('parseCsvRows preserves Khmer text and TSV delimiter input', () => {
  const rows = parseCsvRows('\uFEFFName\tDescription\tPrice\nក្រែមលាបមុខ\tអត្ថបទខ្មែរ\t១២៣៤.៥៦៧')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'ក្រែមលាបមុខ')
  assert.equal(rows[0].description, 'អត្ថបទខ្មែរ')
  assert.equal(normalizeCsvMoney(rows[0].price), 1234.57)
})

await runTest('normalizeCsvMoney rounds messy currency and decimal formats upward', () => {
  assert.equal(normalizeCsvMoney('$1,234.567'), 1234.57)
  assert.equal(normalizeCsvMoney('៛១២៣៤.៥៦១'), 1234.57)
  assert.equal(normalizeCsvMoney('1 234,567'), 1234.57)
  assert.equal(normalizeCsvMoney('3'), 3.00)
})

if (failed > 0) {
  process.exitCode = 1
}
