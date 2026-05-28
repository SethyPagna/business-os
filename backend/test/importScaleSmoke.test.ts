'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseCsvRowBatchesFromFile } = require('../src/importCsv')
const { normalizeImportMoney } = require('../src/importParsing')

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

function makeLargeCsv(filePath, rows = 10000) {
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' })
  stream.write('\uFEFFname,sku,description,selling_price_usd,stock_quantity,image_filenames\n')
  for (let index = 0; index < rows; index += 1) {
    const rowNumber = index + 1
    const khmerName = `\u1795\u179b\u17b7\u178f\u1795\u179b ${rowNumber}`
    const khmerDescription = `\u1780\u1798\u17d2\u1796\u17bb\u1787\u17b6 ${rowNumber}`
    stream.write(`"${khmerName}",SKU-${rowNumber},"${khmerDescription}","\u17DB\u17E1\u17E2\u17E3\u17E4.\u17E5\u17E6\u17E7",${rowNumber % 20},"SKU-${rowNumber}.jpg"\n`)
  }
  return new Promise((resolve, reject) => {
    stream.end(resolve)
    stream.on('error', reject)
  })
}

async function assertLargeCsvSmoke(rowCount, batchSize, timeBudgetMs) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-scale-import-'))
  const filePath = path.join(tempDir, `products-${rowCount}.csv`)
  await makeLargeCsv(filePath, rowCount)

  let count = 0
  let maxBatch = 0
  let first = null
  let last = null
  const startedAt = Date.now()
  for await (const batch of parseCsvRowBatchesFromFile(filePath, { batchSize })) {
    maxBatch = Math.max(maxBatch, batch.length)
    if (!first && batch[0]) first = batch[0]
    if (batch.length) last = batch[batch.length - 1]
    count += batch.length
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  assert.equal(count, rowCount)
  assert.ok(maxBatch <= batchSize, `batch was too large: ${maxBatch}`)
  assert.equal(first.name, '\u1795\u179b\u17b7\u178f\u1795\u179b 1')
  assert.equal(last.name, `\u1795\u179b\u17b7\u178f\u1795\u179b ${rowCount}`)
  assert.equal(normalizeImportMoney(first.selling_price_usd), 1234.57)
  assert.ok(Date.now() - startedAt < timeBudgetMs, `${rowCount} streaming parse exceeded smoke budget`)

  fs.rmSync(tempDir, { recursive: true, force: true })
}

runTest('streaming parser walks 10k Khmer rows in bounded batches', async () => {
  await assertLargeCsvSmoke(10000, 300, 15000)
})

if (process.env.BUSINESS_OS_FULL_SCALE_SMOKE === '1') {
  runTest('streaming parser walks 50k Khmer rows in bounded batches', async () => {
    await assertLargeCsvSmoke(50000, 300, 45000)
  })
}

process.on('beforeExit', () => {
  if (failed > 0) process.exitCode = 1
})
