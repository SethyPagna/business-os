'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-import-state-'))
process.env.BUSINESS_OS_RUNTIME_DIR = tempRoot
process.env.JOB_QUEUE_DRIVER = 'sqlite'
process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES = '0'
process.env.IMPORT_MEDIA_WAIT_TIMEOUT_MS = '1000'

const { db } = require('../src/database')
const {
  addJobFile,
  cancelImportJob,
  createImportJob,
  getJobFiles,
  processImportJob,
  updateJob,
} = require('../src/services/importJobs')
const { processMediaOptimizationJob } = require('../src/services/mediaQueue')

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

function writeImportFile(name, content) {
  const filePath = path.join(tempRoot, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

async function main() {
  await runTest('pre-cancelled queued job does not start analysis', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    updateJob(job.id, { status: 'queued', phase: 'analyze_queued', cancel_requested: 1 })

    const result = await processImportJob(job.id, { mode: 'analyze' })

    assert.equal(result.status, 'cancelled')
    assert.equal(result.phase, 'cancelled')
  })

  await runTest('cancelImportJob finalizes queued job and file records', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeImportFile('products.csv', 'name,stock_quantity\nTest Product,1\n')
    addJobFile(job.id, { path: csvPath, originalname: 'products.csv', mimetype: 'text/csv' }, 'csv', 'products.csv')
    updateJob(job.id, { status: 'queued', phase: 'analyze_queued' })

    const cancelled = await cancelImportJob(job.id)
    const files = getJobFiles(job.id)

    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.phase, 'cancelled')
    assert.equal(files[0].status, 'cancelled')
  })

  await runTest('media worker skips files for cancelled import jobs', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const imagePath = writeImportFile('image.jpg', 'not-a-real-image')
    const imageFile = addJobFile(job.id, { path: imagePath, originalname: 'image.jpg', mimetype: 'image/jpeg' }, 'image', 'image.jpg')
    updateJob(job.id, { status: 'cancelled', phase: 'cancelled', cancel_requested: 1 })

    await processMediaOptimizationJob({ storedName: 'missing-image.jpg', importJobId: job.id, importFileId: imageFile.id })
    const files = getJobFiles(job.id, 'image')

    assert.equal(files[0].status, 'cancelled')
  })
}

main().catch((error) => {
  failed += 1
  console.error(error)
})

process.on('beforeExit', () => {
  try { db.close() } catch (_) {}
  try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch (_) {}
  if (failed > 0) process.exitCode = 1
})
