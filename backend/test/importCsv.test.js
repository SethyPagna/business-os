'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseCsvRowBatchesFromFile, parseCsvRows } = require('../src/importCsv')
const { normalizeImportMoney, parseImportNumericValue } = require('../src/importParsing')

let failed = 0
const tests = []

function runTest(name, fn) {
  tests.push(Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }))
}

async function collectBatches(filePath, options = {}) {
  const rows = []
  for await (const batch of parseCsvRowBatchesFromFile(filePath, options)) {
    rows.push(...batch)
  }
  return rows
}

runTest('CSV parser preserves Khmer text and strips UTF-8 BOM', () => {
  const khmerName = '\u1795\u179b\u17b7\u178f\u1795\u179b'
  const khmerDescription = '\u1780\u1798\u17d2\u1796\u17bb\u1787\u17b6'
  const rows = parseCsvRows(`\uFEFFname,description\n"${khmerName}","${khmerDescription}"`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, khmerName)
  assert.equal(rows[0].description, khmerDescription)
})

runTest('CSV parser handles TSV, CRLF, quotes, and empty cells', () => {
  const rows = parseCsvRows('name\tprice\tdescription\r\n"A\tB"\t1,234.567\t""\r\nC\t\tPlain')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'A\tB')
  assert.equal(rows[0].price, '1,234.567')
  assert.equal(rows[0].description, '')
  assert.equal(rows[1].price, '')
})

runTest('streaming parser preserves Khmer text and returns bounded batches', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-csv-'))
  const filePath = path.join(tempDir, 'khmer-products.csv')
  const khmerName = '\u1795\u179b\u17b7\u178f\u1795\u179b'
  const rows = ['\uFEFFname,price,description']
  for (let index = 0; index < 25; index += 1) {
    rows.push(`"${khmerName} ${index + 1}","\u17E1\u17E2\u17E3\u17E4.\u17E5\u17E6\u17E7","line ${index + 1}"`)
  }
  fs.writeFileSync(filePath, rows.join('\r\n'), 'utf8')
  const parsed = await collectBatches(filePath, { batchSize: 7 })
  assert.equal(parsed.length, 25)
  assert.equal(parsed[0].name, `${khmerName} 1`)
  assert.equal(parsed[24]._rowNumber, 26)
  assert.equal(parseImportNumericValue(parsed[0].price, 0), 1234.567)
  fs.rmSync(tempDir, { recursive: true, force: true })
})

runTest('numeric import parsing supports Khmer digits and mixed separators', () => {
  assert.equal(parseImportNumericValue('\u17DB\u17E1\u17E2\u17E3\u17E4.\u17E5\u17E6\u17E7', 0), 1234.567)
  assert.equal(parseImportNumericValue('$1,234.567', 0), 1234.567)
  assert.equal(parseImportNumericValue('1 234,567', 0), 1234.567)
})

runTest('money import normalization rounds upward to two decimals', () => {
  assert.equal(normalizeImportMoney('1.001', 0), 1.01)
  assert.equal(normalizeImportMoney('\u17E3.\u17E0\u17E0\u17E1', 0), 3.01)
})

Promise.all(tests).then(() => {
  if (failed > 0) process.exitCode = 1
})
