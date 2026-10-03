const assert = require('node:assert/strict')
const { world, begin, step } = require('./test-branch-cutover-parent-native.cjs')
const hash = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function until(w, row, phase, size = 8) {
  for (let turns = 0; row.phase !== phase && turns < 150; turns++) row = (await step(w, row, size)).row
  assert.equal(row.phase, phase); return row
}
function stock(w) {
  w.raw.exec(`INSERT INTO products(id,name,stock_quantity,cost_price_usd,created_at,updated_at) VALUES(10,'Item',6.25,3,'2026-01-01','2026-01-01');
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,2,1.25),(10,1,5);
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,expiry_date,supplier_name,unit_cost_usd,received_branch_id,created_at,updated_at)
      VALUES(101,10,'lot101','2026-01-02 03:04:05','2027-01-02','Supplier',3,2,'2026-01-01','2026-01-01');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity,created_at,updated_at) VALUES(101,2,1.25,'2026-01-01','2026-01-01')`)
}
async function main() {
  let checks = 0
  async function check(name, fn) { if (process.env.PARENT_TEST_FILTER && !name.includes(process.env.PARENT_TEST_FILTER)) return; await fn(); console.log('PASS ' + name); checks++ }
  await check('canonical capture digest independent of page size with exact fractional lot metadata', async () => {
    const roots = []
    for (const size of [1, 8]) {
      const w = world(); stock(w); const row = await until(w, (await begin(w)).row, 'moving', size)
      const manifest = JSON.parse(row.manifest_json); assert.equal(manifest.sourceQuantityText, '1.25'); assert.equal(manifest.sourceLotQuantityText, '1.25'); assert.equal(manifest.movingProducts, 1)
      roots.push(row.capture_digest); assert.equal(row.snapshot_digest, row.capture_digest)
      assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=2').get().quantity, 1.25)
      assert.equal(w.raw.prepare('SELECT count(*) n FROM inventory_movements').get().n, 0); w.raw.close()
    }
    assert.equal(roots[0], roots[1])
  })
  await check('only missing historical labels materialize while stock date supplier and cost bytes stay unchanged', async () => {
    const w = world(); stock(w)
    w.raw.exec(`INSERT INTO sales(id,branch_id,branch_name) VALUES(20,2,NULL),(21,1,'Warehouse as sold');
      INSERT INTO returns(id,sale_id,branch_id,branch_name) VALUES(20,20,2,' ');
      INSERT INTO inventory_movements(id,branch_id,branch_name,quantity) VALUES(20,1,NULL,0);
      INSERT INTO stock_row_moves(id,source_product_id,destination_product_id,branch_id,quantity) VALUES(20,10,11,2,0);
      INSERT INTO stock_transfers(id,from_branch_id,to_branch_id,quantity) VALUES(20,2,1,0)`)
    const before = hash(['products', 'product_batches', 'branch_stock', 'branch_batch_stock'].map(t => w.raw.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()))
    const priorRevision = w.raw.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=20').get().revision
    const row = await until(w, (await begin(w)).row, 'moving')
    assert.equal(row.capture_digest, row.snapshot_digest)
    assert.equal(w.raw.prepare('SELECT branch_name FROM sales WHERE id=20').get().branch_name, 'Shop')
    assert.equal(w.raw.prepare('SELECT branch_name FROM sales WHERE id=21').get().branch_name, 'Warehouse as sold')
    assert.equal(w.raw.prepare('SELECT branch_name FROM returns WHERE id=20').get().branch_name, 'Shop')
    assert.equal(w.raw.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id=20').get().revision, priorRevision + 2)
    assert.equal(w.raw.prepare('SELECT branch_name FROM stock_row_moves WHERE id=20').get().branch_name, 'Shop')
    assert.equal(w.raw.prepare('SELECT branch_name FROM inventory_movements WHERE id=20').get().branch_name, 'Warehouse')
    assert.deepEqual({ ...w.raw.prepare('SELECT from_branch_name,to_branch_name FROM stock_transfers WHERE id=20').get() }, { from_branch_name: 'Shop', to_branch_name: 'Warehouse' })
    assert.equal(hash(['products', 'product_batches', 'branch_stock', 'branch_batch_stock'].map(t => w.raw.prepare('SELECT * FROM '+t+' ORDER BY rowid').all())), before); w.raw.close()
  })
  await check('changed page after read refuses checkpoint and leaves no label partial write', async () => {
    const w = world(); w.raw.exec("INSERT INTO sales(id,branch_id,branch_name) VALUES(20,2,NULL)")
    let row = await until(w, (await begin(w)).row, 'snapshots')
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = [...new Set([...w.capture.BRANCH_SCALAR_REFERENCES.map(v => v[0]), 'products', ...w.capture.UNCLASSIFIED_JSON_FAMILIES])].sort().filter(t => t !== 'branch_cutovers' && !w.capture.UNCLASSIFIED_JSON_FAMILIES.includes(t))
    const index = tables.indexOf('sales'); assert.ok(schema.columns.sales.includes('branch_name'))
    while (JSON.parse(row.snapshot_cursor_json === '{}' ? '{"index":0}' : row.snapshot_cursor_json).index !== index) row = (await step(w, row)).row
    w.stats.before = raw => raw.exec("UPDATE sales SET notes='competitor' WHERE id=20")
    await assert.rejects(step(w, row)); const saved = w.raw.prepare('SELECT * FROM branch_cutovers').get()
    assert.equal(saved.revision, row.revision); assert.equal(w.raw.prepare('SELECT branch_name FROM sales WHERE id=20').get().branch_name, null); w.raw.close()
  })
  await check('stale data between passes refuses final snapshot completion', async () => {
    const w = world(); stock(w); let row = await until(w, (await begin(w)).row, 'snapshots')
    w.raw.exec("UPDATE product_batches SET received_at='2026-01-03 01:00:00' WHERE id=101")
    await assert.rejects(until(w, row, 'moving')); assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'snapshots'); w.raw.close()
  })
  await check('unclassified historical payloads and last moment inserts cannot produce verified emptiness', async () => {
    for (const race of [false, true]) {
      const w = world(); let row = (await begin(w)).row
      if (!race) w.raw.exec("INSERT INTO action_history(label) VALUES('Legacy undo')")
      row = await until(w, row, 'snapshots')
      if (!race) {
        const batches = w.stats.batches
        await assert.rejects(step(w, row), e => e.code === 'branch_cutover_parent_capability')
        assert.equal(w.stats.batches, batches); assert.equal(w.raw.prepare('SELECT snapshot_records n FROM branch_cutovers').get().n, 0)
        w.raw.close(); continue
      }
      while (true) {
        const cursor = w.capture.parseCaptureCursor(row.snapshot_cursor_json)
        const schema = await w.capture.readCutoverCaptureSchema(w.db)
        const page = await w.capture.readCutoverCapturePage(w.db, schema, {sourceBranchId:2,targetBranchId:1}, cursor, row.snapshot_digest, 8, {1:'Warehouse',2:'Shop'}, false)
        if (page.done && page.records === 0) break
        row = (await step(w, row)).row
      }
      if (race) w.stats.before = raw => raw.exec("INSERT INTO action_history(label) VALUES('Concurrent undo')")
      await assert.rejects(step(w, row)); assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'snapshots'); w.raw.close()
    }
  })
  await check('lost page acknowledgement returns exact committed cursor; old request revision performs no second batch', async () => {
    const w = world(); let { row } = await begin(w); const prior = row
    w.stats.after = () => { throw Error('connection lost after page commit') }; const result = await step(w, row); row = result.row
    assert.equal(result.replayed, true); assert.equal(row.revision, prior.revision + 1); const batches = w.stats.batches
    const replay = await step(w, prior); assert.equal(replay.row.capture_cursor_json, row.capture_cursor_json); assert.equal(w.stats.batches, batches); w.raw.close()
  })
  await check('simultaneous identical checkpoint requests have one durable winner', async () => {
    const w = world(); const { row } = await begin(w); const results = await Promise.all([step(w, row), step(w, row)])
    assert.equal(results[0].row.capture_digest, results[1].row.capture_digest)
    assert.equal(w.raw.prepare('SELECT revision FROM branch_cutovers').get().revision, 1)
    assert.equal(results.filter(result => !result.replayed).length, 1); w.raw.close()
  })
  await check('source stock inserted after completed snapshot scan cannot enter empty verification', async () => {
    const w = world(); let row = await until(w, (await begin(w)).row, 'snapshots')
    while (true) {
      const cursor = w.capture.parseCaptureCursor(row.snapshot_cursor_json)
      const page = await w.capture.readCutoverCapturePage(w.db, await w.capture.readCutoverCaptureSchema(w.db), {sourceBranchId:2,targetBranchId:1}, cursor, row.snapshot_digest, 8, {1:'Warehouse',2:'Shop'}, false)
      if (page.done && page.records === 0) break
      row = (await step(w, row)).row
    }
    w.stats.before = raw => raw.exec("INSERT INTO products(id,name) VALUES(100,'Late stock'); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(100,2,1)")
    await assert.rejects(step(w, row)); assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'snapshots'); w.raw.close()
  })
  await check('bounded UTF8 rows and nonpositive row ids fail recoverably without checkpoint', async () => {
    for (const large of [true, false]) {
      const w = world(); const key = large ? w.raw.prepare('SELECT max(id)+1 AS id FROM fees').get().id : -1
      w.raw.prepare("INSERT INTO fees(id,branch_id,notes,fee_date) VALUES(?,?,?,'2026-10-03')").run(key, 2, large ? 'ខ'.repeat(24000) : 'legacy')
      let { row } = await begin(w); await assert.rejects(until(w, row, 'snapshots'), e => e.code === 'branch_cutover_parent_capability')
      assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'capturing'); w.raw.close()
    }
  })
  assert.ok(checks > 0, 'test filter must select a group')
  console.log(`${checks} branch cutover capture native groups passed`)
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
