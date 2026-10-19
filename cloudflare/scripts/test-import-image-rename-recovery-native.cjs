'use strict'
const assert = require('node:assert/strict')
const { world } = require('./test-al-stock-b-native.cjs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')

async function main() {
  const anchor = "const commit = async (statements: Parameters<D1Compat['batch']>[0], once: boolean) => {\n    try {"
  const faults = anchor + `
      if (statements.some(s => /UPDATE (import_job_files|file_assets) SET original_name/.test(s.sql))) {
        const count = ((globalThis as any).__renameFaultCount || 0) + 1
        ;(globalThis as any).__renameFaultCount = count
        if (count === 1) throw new Error('D1_ERROR: CPU time limit')
        if (count === 3) throw new Error('test image rename interruption')
      }`
  const patches = [{ name: 'rename-boundary-faults', file: 'src/lib/importEngine.ts', from: anchor, to: faults }]
  const wrong = process.env.BOS_IMPORT_RENAME_NEGATIVE_CONTROL || process.argv.find(arg => arg.startsWith('--wrong='))?.slice(8)
  const mutations = {
    'split-pairs': ['await runD1BatchGroupsInChunks(productWriteDb, renameGroups)', 'await runD1BatchInChunks(productWriteDb, renameGroups.flat())'],
    'skip-resume': ["if (cursor === 0 && job.type === 'products' && authority.allowProductImageWrites", "if (isFreshStart && job.type === 'products' && authority.allowProductImageWrites"],
  }
  if (wrong) {
    assert.ok(mutations[wrong], 'unknown negative implementation')
    patches.push({ name: wrong, file: 'src/lib/importEngine.ts', from: mutations[wrong][0], to: mutations[wrong][1] })
  }
  const h = await world({ patches })
  try {
    await h.addUser(920, 'image_executor', { import: true, products: true, 'products:import': true,
      'products:import_replace_all': true, 'products:image': true, destructive_delete: true,
      product_cost_edit: true, product_cost_view: true })
    await h.addSession('executor', 920)
    await executeRawStockTransaction(h.db, [h.db.prepare("INSERT INTO products(id,name,barcode,stock_quantity,cost_price_usd,is_active,updated_at) VALUES(9401,'J kept','J-KEPT',0,1,1,'2000-01-01')")])
    const call = (method, route, body) => h.api(method, route, body, { as: 'executor' })
    const created = await call('POST', '/api/import-jobs', { type: 'products', policy: {
      import_mode: 'replace_all', wire_images: true, imageOverrides: { 101: 2, 102: 2, 103: 2 },
    } })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = created.body.job.id
    for (const fileId of [101, 102, 103]) {
      await h.db.prepare('INSERT INTO file_assets(id,original_name,stored_name,public_path) VALUES(?,?,?,?)')
        .bind(fileId, 'raw-' + fileId + '.jpg', 'raw-' + fileId + '.jpg', '/uploads/raw-' + fileId + '.jpg').run()
      await h.db.prepare("INSERT INTO import_job_files(id,job_id,kind,original_name,stored_path,file_asset_id) VALUES(?,?,'image',?,?,?)")
        .bind(fileId, id, 'raw-' + fileId + '.jpg', 'raw-' + fileId + '.jpg', fileId).run()
    }
    const upload = await h.multipart('/api/import-jobs/' + id + '/csv', 'file', 'j-images.csv',
      'name,barcode,description\nJ kept,J-KEPT,Updated\n', { as: 'executor' })
    assert.equal(upload.status, 200, JSON.stringify(upload.body))
    const started = await call('POST', '/api/import-jobs/' + id + '/start')
    assert.equal(started.status, 200, JSON.stringify(started.body))
    const plan = await h.q('SELECT file_id,new_name FROM import_job_image_renames WHERE job_id=? ORDER BY file_id', id)
    assert.equal(plan.length, 3, 'three complete rename pairs must be reviewed')
    const approved = await call('POST', '/api/import-jobs/' + id + '/approve', {})
    const interrupted = await h.q1('SELECT status,chunk_cursor,last_error FROM import_jobs WHERE id=?', id)
    assert.equal(interrupted.status, 'failed', JSON.stringify({ approved, interrupted }))
    assert.match(interrupted.last_error, /test image rename interruption/)
    assert.equal(interrupted.chunk_cursor, 0, 'failure must precede the first product row')
    const names = () => h.q(`SELECT f.id,f.original_name AS file_name,a.original_name AS asset_name
      FROM import_job_files f JOIN file_assets a ON a.id=f.file_asset_id
      WHERE f.job_id=? AND f.kind='image' ORDER BY f.id`, id)
    const partial = await names()
    console.log(JSON.stringify({ phase: 'interrupted', status: approved.status, partial }))
    assert.equal(partial.length, 3)
    for (const pair of partial) assert.equal(pair.file_name, pair.asset_name, 'CPU splitting must never commit half an image rename pair')
    const plannedName = fileId => plan.find(row => Number(row.file_id) === fileId).new_name
    const completedPairs = partial.filter(pair => pair.file_name === plannedName(pair.id)).length
    assert.ok(completedPairs > 0 && completedPairs < 3, 'fixture must leave an authorized prefix and unfinished suffix')
    const productBefore = await h.q1('SELECT description FROM products WHERE id=9401')
    assert.notEqual(productBefore.description, 'Updated')
    const worker = await h.mf.getWorker()
    const delivery = await worker.queue('business-os-import', [{ id: 'rename-resume', timestamp: new Date(),
      body: { jobId: id, kind: 'apply' }, attempts: 2 }])
    const resumed = await h.q1('SELECT status,chunk_cursor,last_error FROM import_jobs WHERE id=?', id)
    const final = await names()
    console.log(JSON.stringify({ phase: 'resumed', delivery, resumed, final }))
    assert.equal(resumed.status, 'completed', resumed.last_error)
    assert.equal(delivery.outcome, 'ok')
    assert.deepEqual(delivery.explicitAcks, ['rename-resume'])
    assert.equal(delivery.retryBatch.retry, false)
    assert.deepEqual(delivery.retryMessages, [])
    for (const pair of final) {
      const expected = plannedName(pair.id)
      assert.equal(pair.file_name, expected, 'automatic redelivery must finish the pending file rename')
      assert.equal(pair.asset_name, expected, 'automatic redelivery must finish the pending library rename')
    }
    assert.equal((await h.q1('SELECT description FROM products WHERE id=9401')).description, 'Updated')
    assert.equal(resumed.last_error, null, 'successful recovery must clear the obsolete fatal error')
    console.log('PASS atomic image rename pairs and interrupted pre-row automatic recovery')
  } finally { await h.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
