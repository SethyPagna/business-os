'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-import-state-'))
process.env.BUSINESS_OS_RUNTIME_DIR = tempRoot
process.env.JOB_QUEUE_DRIVER = 'bullmq'
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
  preflightImportJob,
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

  await runTest('product import review accounts for missing names, text barcodes, and duplicate barcodes in the file', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeJobFile(job.id, 'review-product-issues.csv', [
      '\uFEFFname,sku,barcode,brand,unit,stock_quantity,branch',
      'Alpha Serum,,DUP-100,Leang,pcs,1,',
      'Beta Serum,,DUP-100,Leang,pcs,1,',
      'Khmer Barcode,,កាដូរឈើ,Leang,pcs,1,',
      ',,3606000534674,Leang,pcs,1,',
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'review-product-issues.csv', mimetype: 'text/csv' }, 'csv', 'review-product-issues.csv')

    const review = await getImportJobReview(job.id, { pageSize: 20 })

    assert.equal(review.counts.total, 4)
    assert.equal(review.counts.duplicate_barcode_groups, 1)
    assert.equal(review.counts.duplicate_barcode, 2)
    assert.equal(review.counts.barcode_text, 1)
    assert.equal(review.counts.missing_name, 1)
    assert.equal(review.rows.some((entry) => entry.conflict.issueTypes.includes('barcode_text')), true)
    assert.equal(review.rows.some((entry) => entry.conflict.issueTypes.includes('missing_name')), true)
  })

  await runTest('product import keeps reviewed unicode and scientific barcode text without row failures', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const unicodeBarcode = 'កាដូរឈើ'
    const scientificBarcode = '3.3489E+12'
    const csvPath = writeJobFile(job.id, 'unicode-barcode-products.csv', [
      '\uFEFFname,sku,barcode,brand,unit,stock_quantity,branch',
      `Unicode Barcode Product,,${unicodeBarcode},Leang,pcs,1,`,
      `Scientific Barcode Product,,${scientificBarcode},Leang,pcs,1,`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'unicode-barcode-products.csv', mimetype: 'text/csv' }, 'csv', 'unicode-barcode-products.csv')

    const review = await getImportJobReview(job.id, { filter: 'barcode', pageSize: 20 })
    assert.equal(review.counts.total, 2)
    assert.equal(review.counts.barcode_text, 1)
    assert.equal(review.counts.barcode_scientific_notation, 1)
    assert.equal(review.rows.some((entry) => entry.conflict.issueTypes.includes('barcode_text')), true)
    assert.equal(review.rows.some((entry) => entry.conflict.issueTypes.includes('barcode_scientific_notation')), true)

    updateImportJobDecisions(job.id, {
      2: { decision: 'keep_barcode', _action: 'new' },
      3: { decision: 'keep_barcode', _action: 'new' },
    })

    const result = await processImportJob(job.id, { mode: 'apply' })
    const saved = db.prepare('SELECT name, barcode FROM products WHERE name IN (?, ?) ORDER BY name ASC')
      .all('Scientific Barcode Product', 'Unicode Barcode Product')

    assert.equal(result.status, 'completed')
    assert.equal(Number(result.failed_rows || 0), 0)
    assert.equal(saved.length, 2)
    assert.equal(saved.find((row) => row.name === 'Unicode Barcode Product')?.barcode, unicodeBarcode)
    assert.equal(saved.find((row) => row.name === 'Scientific Barcode Product')?.barcode, scientificBarcode)
  })

  await runTest('product import create_variant automatically creates a parent group for same-file rows', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const productName = `Same File Variant ${Date.now()}`
    const csvPath = writeJobFile(job.id, 'same-file-variants.csv', [
      '\uFEFFname,sku,brand,unit,purchase_price_usd,selling_price_usd,stock_quantity',
      `${productName},,Brand A,pcs,5,10,2`,
      `${productName},,Brand B,pcs,7,14,3`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'same-file-variants.csv', mimetype: 'text/csv' }, 'csv', 'same-file-variants.csv')
    updateImportJobDecisions(job.id, {
      2: { _action: 'create_variant' },
      3: { _action: 'create_variant' },
    })

    const result = await processImportJob(job.id, { mode: 'apply' })
    const products = db.prepare('SELECT id, name, brand, parent_id, is_group, stock_quantity FROM products WHERE name = ? ORDER BY id ASC').all(productName)

    assert.equal(result.status, 'completed')
    assert.equal(products.length, 2)
    const parent = products.find((row) => Number(row.parent_id || 0) === 0)
    const child = products.find((row) => Number(row.parent_id || 0) > 0)
    assert.ok(parent, 'Expected one imported row to become the group parent')
    assert.ok(child, 'Expected the other imported row to become a variant')
    assert.equal(Number(parent.is_group), 1)
    assert.equal(Number(child.parent_id), Number(parent.id))
  })

  await runTest('product import review defaults same-file same-name rows to create_variant', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const productName = `Review Same File Variant ${Date.now()}`
    const csvPath = writeJobFile(job.id, 'review-same-file-variants.csv', [
      '\uFEFFname,sku,brand,unit,purchase_price_usd,selling_price_usd,stock_quantity',
      `${productName},,Brand A,pcs,5,10,2`,
      `${productName},,Brand B,pcs,7,14,3`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'review-same-file-variants.csv', mimetype: 'text/csv' }, 'csv', 'review-same-file-variants.csv')

    const review = await getImportJobReview(job.id, { filter: 'same_name', pageSize: 20 })

    assert.equal(review.counts.total, 2)
    assert.equal(review.counts.same_name, 2)
    assert.equal(review.counts.duplicate_name_groups, 1)
    assert.equal(review.rows.length, 2)
    assert.equal(review.rows.every((entry) => entry.conflict.type === 'same_name_import'), true)
    assert.equal(review.rows.every((entry) => entry.conflict.plannedAction === 'create_variant'), true)
    assert.equal(review.rows.every((entry) => entry.conflict.decisionDefaults._action === 'create_variant'), true)
  })

  await runTest('product import review groups same-name rows into detail subgroups', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const productName = `Grouped Import Variant ${Date.now()}`
    const csvPath = writeJobFile(job.id, 'review-same-name-subgroups.csv', [
      '\uFEFFname,sku,barcode,brand,unit,purchase_price_usd,selling_price_usd,stock_quantity',
      `${productName},,BAR-GROUP-1,Brand A,pcs,5,10,2`,
      `${productName},,BAR-GROUP-1,Brand A,pcs,5,10,3`,
      `${productName},,BAR-GROUP-2,Brand B,pcs,7,14,4`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'review-same-name-subgroups.csv', mimetype: 'text/csv' }, 'csv', 'review-same-name-subgroups.csv')

    const review = await getImportJobReview(job.id, { filter: 'same_name', pageSize: 20 })
    const group = (review.groups || []).find((entry) => entry.key === productName.toLowerCase())

    assert.ok(group, 'Expected grouped same-name review payload')
    assert.equal(group.issueTypes.includes('same_name'), true)
    assert.equal(group.rowNumbers.length, 3)
    assert.equal(group.subgroups.length, 2)
    assert.deepEqual(group.subgroups.map((entry) => entry.rowNumbers).sort((a, b) => b.length - a.length), [[2, 3], [4]])
    assert.equal(group.subgroups[0].suggestedAction, 'merge_stock')
    assert.equal(group.subgroups.some((entry) => entry.suggestedAction === 'create_variant'), true)
  })

  await runTest('product import grouping ignores price-only differences', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const productName = `Grouped Price Only ${Date.now()}`
    const csvPath = writeJobFile(job.id, 'review-price-only-subgroups.csv', [
      '\uFEFFname,sku,barcode,brand,unit,purchase_price_usd,selling_price_usd,discount_percent,stock_quantity',
      `${productName},SKU-PRICE-ONLY,BAR-PRICE-ONLY,Brand A,pcs,5,10,5,2`,
      `${productName},SKU-PRICE-ONLY,BAR-PRICE-ONLY,Brand A,pcs,8,15,12,3`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'review-price-only-subgroups.csv', mimetype: 'text/csv' }, 'csv', 'review-price-only-subgroups.csv')

    const review = await getImportJobReview(job.id, { filter: 'same_name', pageSize: 20 })
    const group = (review.groups || []).find((entry) => entry.key === productName.toLowerCase())

    assert.ok(group, 'Expected grouped same-name review payload')
    assert.equal(group.subgroups.length, 1)
    assert.equal(group.subgroups[0].suggestedAction, 'merge_stock')
  })

  await runTest('product import preflight honors variant and keep-barcode decisions before apply', async () => {
    db.prepare(`
      INSERT INTO products (name, sku, barcode, brand, unit, purchase_price_usd, selling_price_usd, stock_quantity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run('Decision Serum', 'DEC-BASE', 'SAME-BARCODE', 'Brand A', 'pcs', 5, 10, 2)
    const parentId = db.prepare('SELECT id FROM products WHERE sku = ?').get('DEC-BASE').id
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const csvPath = writeJobFile(job.id, 'decision-variant-keep-barcode.csv', [
      '\uFEFFname,sku,barcode,brand,unit,purchase_price_usd,selling_price_usd,stock_quantity',
      'Decision Serum,DEC-VARIANT,SAME-BARCODE,Brand B,pcs,7,14,3',
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'decision-variant-keep-barcode.csv', mimetype: 'text/csv' }, 'csv', 'decision-variant-keep-barcode.csv')
    updateImportJobDecisions(job.id, {
      2: {
        action: 'create_variant',
        identifier_decision: 'allow_duplicate',
        decision: 'create_variant',
        _parent_id: parentId,
      },
    })

    const preflight = await preflightImportJob(job.id)
    assert.equal(preflight.ok, true)
    assert.equal(preflight.failures.length, 0)

    const result = await processImportJob(job.id, { mode: 'apply' })
    const rows = db.prepare('SELECT id, name, sku, barcode, parent_id, is_group, stock_quantity FROM products WHERE name = ? ORDER BY id ASC').all('Decision Serum')

    assert.equal(result.status, 'completed')
    assert.equal(Number(result.failed_rows || 0), 0)
    assert.equal(rows.length, 2)
    assert.equal(Number(rows[0].is_group), 1)
    assert.equal(Number(rows[1].parent_id), Number(parentId))
    assert.equal(rows[1].barcode, 'SAME-BARCODE')
    assert.equal(Number(rows[1].stock_quantity), 3)
  })

  await runTest('product import applies same-name subgroup plan by merging identical details and creating variants', async () => {
    const job = createImportJob({ type: 'products', actor: { userName: 'test' } })
    const productName = `Apply Subgroup Variant ${Date.now()}`
    const csvPath = writeJobFile(job.id, 'apply-same-name-subgroups.csv', [
      '\uFEFFname,sku,barcode,brand,unit,purchase_price_usd,selling_price_usd,stock_quantity',
      `${productName},,BAR-SUB-1,Brand A,pcs,5,10,2`,
      `${productName},,BAR-SUB-1,Brand A,pcs,5,10,3`,
      `${productName},,BAR-SUB-2,Brand B,pcs,7,14,4`,
    ].join('\n'))
    addJobFile(job.id, { path: csvPath, originalname: 'apply-same-name-subgroups.csv', mimetype: 'text/csv' }, 'csv', 'apply-same-name-subgroups.csv')
    updateImportJobDecisions(job.id, {
      2: { action: 'create_variant', identifier_decision: 'allow_duplicate' },
      3: { action: 'merge_stock', identifier_decision: 'allow_duplicate' },
      4: { action: 'create_variant', identifier_decision: 'allow_duplicate' },
    })

    const result = await processImportJob(job.id, { mode: 'apply' })
    const products = db.prepare('SELECT id, name, brand, barcode, parent_id, is_group, stock_quantity FROM products WHERE name = ? ORDER BY id ASC').all(productName)

    assert.equal(result.status, 'completed')
    assert.equal(Number(result.failed_rows || 0), 0)
    assert.equal(products.length, 2)
    const parent = products.find((row) => Number(row.parent_id || 0) === 0)
    const variant = products.find((row) => Number(row.parent_id || 0) > 0)
    assert.ok(parent, 'Expected one parent/root row')
    assert.ok(variant, 'Expected one child variant row')
    assert.equal(Number(parent.stock_quantity), 5)
    assert.equal(Number(parent.is_group), 1)
    assert.equal(Number(variant.parent_id), Number(parent.id))
    assert.equal(Number(variant.stock_quantity), 4)
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
