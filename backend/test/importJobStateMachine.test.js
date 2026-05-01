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
const { IMPORTS_PATH } = require('../src/config')
const {
  addJobFile,
  cancelAllImportJobs,
  cancelImportJob,
  createImportJob,
  deleteAllImportJobs,
  deleteImportJob,
  getImportJob,
  getImportJobReview,
  getJobFiles,
  processImportJob,
  updateImportJobDecisions,
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

function writeJobFile(jobId, name, content) {
  const filePath = path.join(IMPORTS_PATH, jobId, name)
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

  await runTest('destructive reset cancellation stops all active import jobs', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeImportFile('reset-products.csv', 'name,stock_quantity\nReset Product,1\n')
    addJobFile(job.id, { path: csvPath, originalname: 'reset-products.csv', mimetype: 'text/csv' }, 'csv', 'reset-products.csv')
    updateJob(job.id, { status: 'queued', phase: 'apply_queued' })

    const summary = await cancelAllImportJobs({ reason: 'test reset', waitMs: 1000 })
    const files = getJobFiles(job.id)

    assert.equal(summary.cancelled >= 1, true)
    assert.equal(summary.remaining.length, 0)
    assert.equal(files[0].status, 'cancelled')
  })

  await runTest('deleteImportJob removes database rows and import runtime files', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeJobFile(job.id, 'delete-products.csv', 'name,stock_quantity\nDelete Product,1\n')
    addJobFile(job.id, { path: csvPath, originalname: 'delete-products.csv', mimetype: 'text/csv' }, 'csv', 'delete-products.csv')
    updateJob(job.id, { status: 'completed', phase: 'completed' })

    const jobRoot = path.join(IMPORTS_PATH, job.id)
    assert.equal(fs.existsSync(jobRoot), true)

    const result = await deleteImportJob(job.id)

    assert.deepEqual(result, { deleted: true, id: job.id })
    assert.equal(getImportJob(job.id), null)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_files WHERE job_id = ?').get(job.id).count, 0)
    assert.equal(fs.existsSync(jobRoot), false)
  })

  await runTest('deleteImportJob removes drained cancelling jobs without waiting forever', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeJobFile(job.id, 'drained-cancel.csv', 'name,stock_quantity\nDrained Product,1\n')
    addJobFile(job.id, { path: csvPath, originalname: 'drained-cancel.csv', mimetype: 'text/csv' }, 'csv', 'drained-cancel.csv')
    updateJob(job.id, {
      status: 'cancelling',
      phase: 'cancel_requested',
      cancel_requested: 1,
      total_rows: 5545,
      processed_rows: 5545,
      failed_rows: 28,
      summary_json: JSON.stringify({ imported: 5513, updated: 4, failed: 28 }),
    })

    const result = await deleteImportJob(job.id)

    assert.deepEqual(result, { deleted: true, id: job.id })
    assert.equal(getImportJob(job.id), null)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_files WHERE job_id = ?').get(job.id).count, 0)
  })

  await runTest('import review surfaces barcode conflicts and stores row decisions', async () => {
    db.prepare(`
      INSERT INTO products (name, sku, barcode, brand, unit, selling_price_usd, stock_quantity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run('Existing Balm', 'BALM-1', 'BAR-100', 'Leang', 'pcs', 2.5, 5)
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeJobFile(job.id, 'review-products.csv', [
      '\uFEFFname,sku,barcode,brand,unit,selling_price_usd,stock_quantity',
      'Different Balm,BALM-NEW,BAR-100,Leang,pcs,2.50,3',
      'Existing Balm,BALM-1,BAR-100,Leang,pcs,2.50,4',
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'review-products.csv', mimetype: 'text/csv' }, 'csv', 'review-products.csv')

    const review = await getImportJobReview(job.id, { filter: 'barcode', pageSize: 20 })

    assert.equal(review.counts.barcode >= 2, true)
    assert.equal(review.rows.length, 2)
    assert.equal(review.rows[0].conflict.fields.includes('barcode'), true)

    const updated = updateImportJobDecisions(job.id, {
      [review.rows[0].rowNumber]: { _identifier_conflict_mode: 'clear_imported', _action: 'new' },
    })

    assert.equal(updated.policy.decisionsByRowNumber[String(review.rows[0].rowNumber)]._identifier_conflict_mode, 'clear_imported')
  })

  await runTest('deleteAllImportJobs clears all import job records and runtime folders', async () => {
    const jobs = [
      createImportJob({ type: 'products', actor: { userName: 'test' } }),
      createImportJob({ type: 'contacts', actor: { userName: 'test' } }),
    ]
    for (const job of jobs) {
      const csvPath = writeJobFile(job.id, `${job.type}.csv`, 'name,stock_quantity\nBulk Product,1\n')
      addJobFile(job.id, { path: csvPath, originalname: `${job.type}.csv`, mimetype: 'text/csv' }, 'csv', `${job.type}.csv`)
      updateJob(job.id, { status: 'completed_with_errors', phase: 'completed_with_errors' })
      assert.equal(fs.existsSync(path.join(IMPORTS_PATH, job.id)), true)
    }

    const result = await deleteAllImportJobs({ removeFiles: true })

    assert.equal(result.deleted >= jobs.length, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_jobs').get().count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_files').get().count, 0)
    assert.deepEqual(fs.readdirSync(IMPORTS_PATH), [])
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
