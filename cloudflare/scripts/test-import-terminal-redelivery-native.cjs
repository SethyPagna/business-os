'use strict'
const assert = require('node:assert/strict')
const { world } = require('./test-al-stock-b-native.cjs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')

async function main() {
  const h = await world()
  try {
    const worker = await h.mf.getWorker()
    for (const [index, kind] of ['apply', 'analyze'].entries()) {
      const productId = 9471 + index
      const name = 'Terminal ' + kind
      const barcode = 'TERMINAL-' + kind
      await executeRawStockTransaction(h.db, [h.db.prepare('INSERT INTO products(id,name,barcode,description,stock_quantity,cost_price_usd,is_active,updated_at) VALUES(?,?,?,\'Original\',0,1,1,\'2000-01-01\')')
        .bind(productId, name, barcode)])
      const created = await h.api('POST', '/api/import-jobs', { type: 'products',
        policy: { import_mode: 'replace_columns', replace_columns: ['description'] } })
      assert.equal(created.status, 200, JSON.stringify(created.body))
      const id = created.body.job.id
      const upload = await h.multipart('/api/import-jobs/' + id + '/csv', 'file', kind + '.csv',
        'name,barcode,description\n' + name + ',' + barcode + ',CSV description\n')
      assert.equal(upload.status, 200, JSON.stringify(upload.body))
      const start = await h.api('POST', '/api/import-jobs/' + id + '/start')
      assert.equal(start.status, 200, JSON.stringify(start.body))
      const approved = await h.api('POST', '/api/import-jobs/' + id + '/approve', {})
      assert.equal(approved.status, 200, JSON.stringify(approved.body))
      const imported = await h.q1('SELECT description,updated_at FROM products WHERE id=?', productId)
      assert.equal(imported.description, 'CSV description', 'positive control must apply the reviewed CSV')
      const manual = await h.api('PUT', '/api/products/' + productId, {
        description: 'Later manual edit', expected_updated_at: imported.updated_at,
      })
      assert.equal(manual.status, 200, JSON.stringify(manual.body))
      const snapshot = async () => ({
        product: await h.q1('SELECT * FROM products WHERE id=?', productId),
        job: await h.q1('SELECT * FROM import_jobs WHERE id=?', id),
        rows: await h.q('SELECT * FROM import_job_rows WHERE job_id=? ORDER BY phase,row_number', id),
        source: await h.q('SELECT * FROM import_job_source_rows WHERE job_id=? ORDER BY sequence,row_number', id),
        audit: await h.q('SELECT * FROM audit_logs ORDER BY id'),
        stock: await h.q('SELECT * FROM branch_stock WHERE product_id=? ORDER BY branch_id', productId),
        cacheVersion: await h.cacheVersion(),
      })
      const before = await snapshot()
      assert.equal(before.product.description, 'Later manual edit')
      assert.equal(before.job.status, 'completed')
      for (const attempts of [2, 3]) {
        const messageId = 'terminal-' + kind + '-' + attempts
        const result = await worker.queue('business-os-import', [{ id: messageId, timestamp: new Date(),
          body: { jobId: id, kind }, attempts }])
        const after = await snapshot()
        console.log(JSON.stringify({ kind, attempts, result, description: after.product.description,
          status: after.job.status, statements: await h.controlGet('queue-statements') }))
        assert.equal(result.outcome, 'ok')
        assert.deepEqual(result.explicitAcks, [messageId])
        assert.equal(result.retryBatch.retry, false)
        assert.deepEqual(result.retryMessages, [])
        assert.deepEqual(after, before, 'delayed ' + kind + ' must preserve terminal job and later manual edits')
      }
    }
    console.log('PASS delayed analyze/apply preserve completed imports, manual edits, audit and cache')
  } finally { await h.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
