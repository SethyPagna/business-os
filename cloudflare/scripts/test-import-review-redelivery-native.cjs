'use strict'
const assert = require('node:assert/strict')
const { world } = require('./test-al-stock-b-native.cjs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')

async function main() {
  const h = await world()
  const failures = []
  const check = (label, actual, expected) => {
    try { assert.deepEqual(actual, expected); console.log('PASS', label) }
    catch (error) { failures.push(label); console.error('FAIL', label, error.message) }
  }
  try {
    const worker = await h.mf.getWorker()
    for (const [index, mode] of ['apply', 'analyze', 'fresh-approval'].entries()) {
      const productId = 9760 + index
      const name = 'Review replay ' + index
      const barcode = 'REVIEW-REPLAY-' + index
      await executeRawStockTransaction(h.db, [h.db.prepare(`INSERT INTO products
        (id,name,barcode,description,stock_quantity,cost_price_usd,is_active,updated_at)
        VALUES(?,?,?,'Original',0,1,1,'2000-01-01')`).bind(productId, name, barcode)])
      const created = await h.api('POST', '/api/import-jobs', {
        type: 'products', policy: { import_mode: 'replace_columns', replace_columns: ['description'] },
      })
      assert.equal(created.status, 200)
      const jobId = created.body.job.id
      const route = '/api/import-jobs/' + jobId
      const csv = `name,barcode,description\n${name},${barcode},From CSV\n`
      assert.equal((await h.multipart(route + '/csv', 'file', 'review.csv', csv)).status, 200)
      assert.equal((await h.api('POST', route + '/start')).status, 200)
      assert.equal((await h.api('POST', route + '/approve', {})).status, 200)
      const completed = await h.q1('SELECT * FROM products WHERE id=?', productId)
      assert.equal(completed.description, 'From CSV')
      assert.equal((await h.api('PUT', '/api/products/' + productId, {
        description: 'Manual after import', expected_updated_at: completed.updated_at,
      })).status, 200)
      assert.equal((await h.api('POST', route + '/retry', {})).status, 200)
      const review = await h.api('GET', route + '/review?pageSize=200')
      assert.equal(review.status, 200)
      assert.deepEqual(review.body.rows.find(row => row.rowNumber === 2).changes.description,
        { from: 'Manual after import', to: 'From CSV' })
      const snapshot = async () => ({
        product: await h.q1('SELECT * FROM products WHERE id=?', productId),
        job: await h.q1('SELECT * FROM import_jobs WHERE id=?', jobId),
        rows: await h.q('SELECT * FROM import_job_rows WHERE job_id=? ORDER BY phase,row_number', jobId),
        sourceRows: await h.q('SELECT * FROM import_job_source_rows WHERE job_id=? ORDER BY sequence,row_number', jobId),
        audit: await h.q('SELECT * FROM audit_logs ORDER BY id'),
        stock: await h.q('SELECT * FROM branch_stock WHERE product_id=? ORDER BY branch_id', productId),
        cacheVersion: await h.cacheVersion(),
      })
      const before = await snapshot()
      assert.equal(before.job.status, 'awaiting_review')
      assert.equal(before.product.description, 'Manual after import')
      if (mode === 'fresh-approval') {
        const approved = await h.api('POST', route + '/approve', {})
        const after = await snapshot()
        check('fresh approval succeeds', approved.status, 200)
        check('fresh approval applies the reviewed change', after.product.description, 'From CSV')
        check('fresh approval completes', after.job.status, 'completed')
        check('fresh approval preserves source rows', after.sourceRows, before.sourceRows)
        continue
      }
      for (const attempts of [2, 3]) {
        const id = `${mode}-before-fresh-approval-${attempts}`
        const delivered = await worker.queue('business-os-import', [{
          id, timestamp: new Date(), body: { jobId, kind: mode }, attempts,
        }])
        check(id + ' returns normally', delivered.outcome, 'ok')
        check(id + ' acknowledges without retry', {
          acks: delivered.explicitAcks, batch: delivered.retryBatch.retry, messages: delivered.retryMessages,
        }, { acks: [id], batch: false, messages: [] })
        check(id + ' preserves the entire unapproved review', await snapshot(), before)
      }
    }
    assert.deepEqual(failures, [], 'stale messages must not cross a fresh review')
  } finally { await h.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
