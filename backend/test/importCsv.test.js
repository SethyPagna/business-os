'use strict'

const assert = require('node:assert/strict')
const { parseCsvRows } = require('../src/importCsv')
const { normalizeImportMoney, parseImportNumericValue } = require('../src/importParsing')

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

runTest('CSV parser preserves Khmer text and strips UTF-8 BOM', () => {
  const rows = parseCsvRows('\uFEFFname,description\n"ក្រែមលាបមុខ","ប្រើពេលយប់"')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'ក្រែមលាបមុខ')
  assert.equal(rows[0].description, 'ប្រើពេលយប់')
})

runTest('CSV parser handles TSV, CRLF, quotes, and empty cells', () => {
  const rows = parseCsvRows('name\tprice\tdescription\r\n"A\tB"\t1,234.567\t""\r\nC\t\tPlain')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'A\tB')
  assert.equal(rows[0].price, '1,234.567')
  assert.equal(rows[0].description, '')
  assert.equal(rows[1].price, '')
})

runTest('numeric import parsing supports Khmer digits and mixed separators', () => {
  assert.equal(parseImportNumericValue('៛១២៣៤.៥៦៧', 0), 1234.567)
  assert.equal(parseImportNumericValue('$1,234.567', 0), 1234.567)
  assert.equal(parseImportNumericValue('1 234,567', 0), 1234.567)
})

runTest('money import normalization rounds upward to two decimals', () => {
  assert.equal(normalizeImportMoney('1.001', 0), 1.01)
  assert.equal(normalizeImportMoney('៣.០០១', 0), 3.01)
})

if (failed > 0) {
  process.exitCode = 1
}
