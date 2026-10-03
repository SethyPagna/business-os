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
  await check('raw REAL exactness refuses both signed native non-roundtrip costs before a page batch', async () => {
    for (const value of [3.5702545241480925e141, -3.5702545241480925e141]) {
      const w = world(); stock(w)
      w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(value)
      const native = w.raw.prepare("SELECT unit_cost_usd raw,printf('%!.17g',unit_cost_usd) encoded FROM product_batches WHERE id=101").get()
      assert.equal(native.raw, value); assert.notEqual(Number(native.encoded), native.raw)
      const schema = await w.capture.readCutoverCaptureSchema(w.db)
      const tables = [...new Set([...w.capture.BRANCH_SCALAR_REFERENCES.map(v => v[0]), 'products', ...w.capture.UNCLASSIFIED_JSON_FAMILIES])].sort().filter(t => t !== 'branch_cutovers' && !w.capture.UNCLASSIFIED_JSON_FAMILIES.includes(t))
      const cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('product_batches') }, batches = w.stats.batches
      await assert.rejects(w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 1, { 1: 'Warehouse', 2: 'Shop' }, false), e => e.code === 'branch_cutover_parent_capability')
      assert.equal(w.stats.batches, batches)
      assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, value)
      w.raw.close()
    }
  })
  await check('raw REAL sidecars bind cardinality order storage types and bounded native projections', async () => {
    const w = world(); stock(w)
    w.raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,received_branch_id,unit_cost_usd) VALUES(102,10,'lot102',2,4); ALTER TABLE product_batches ADD COLUMN precision_integer; UPDATE product_batches SET precision_integer=9223372036854775807")
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = [...new Set([...w.capture.BRANCH_SCALAR_REFERENCES.map(v => v[0]), 'products', ...w.capture.UNCLASSIFIED_JSON_FAMILIES])].sort().filter(t => t !== 'branch_cutovers' && !w.capture.UNCLASSIFIED_JSON_FAMILIES.includes(t))
    const cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('product_batches') }
    const realKey = 'r' + schema.columns.product_batches.indexOf('unit_cost_usd'), integerKey = 'r' + schema.columns.product_batches.indexOf('precision_integer')
    const originalPrepare = w.db.prepare.bind(w.db)
    let transform = rows => rows, captures = 0, returnedBytes = 0, sqlBytes = 0
    w.db.prepare = sql => {
      const statement = originalPrepare(sql)
      if (sql.startsWith('WITH capture_rows AS MATERIALIZED')) {
        const all = statement.all.bind(statement)
        statement.all = async params => {
          const rows = await all(params); captures++; returnedBytes = Buffer.byteLength(JSON.stringify(rows)); sqlBytes = Buffer.byteLength(sql)
          assert.equal(rows.length, 3); assert.equal(rows[1][realKey], 3); assert.equal(rows[2][realKey], 4)
          assert.equal(rows[1][integerKey], null); assert.equal(rows[2][integerKey], null)
          return transform(rows)
        }
      }
      return statement
    }
    const page = () => w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 2, { 1: 'Warehouse', 2: 'Shop' }, false)
    const reads = w.stats.reads, valid = await page()
    assert.equal(captures, 1); assert.equal(w.stats.reads - reads, 2); assert.ok(returnedBytes < 262144); assert.ok(sqlBytes < 100000); assert.ok(w.stats.maxBinds <= 100)
    await w.db.batch(valid.statements)
    const cases = [
      rows => rows.slice(0, 2),
      rows => [...rows, rows[1]],
      rows => [rows[0], rows[2], rows[1]],
      rows => { rows[1][realKey] = null; return rows },
      rows => { rows[1][realKey] = '3'; return rows },
      rows => { rows[1][realKey] = 4; return rows },
      rows => { delete rows[1][realKey]; return rows },
      rows => { rows[1][integerKey] = 1; return rows },
      rows => { rows[1].k = 999; return rows },
      rows => { rows[1].row_kind = 0; return rows },
      rows => { rows[1].value = '[]'; return rows },
      rows => { rows[0][realKey] = 3; return rows },
      rows => { rows[0].value = JSON.stringify(JSON.parse(rows[0].value).map(([key, text]) => { const record = JSON.parse(text); delete record.unit_cost_usd; return [key, JSON.stringify(record)] })); return rows },
    ]
    for (const alter of cases) {
      transform = alter; const batches = w.stats.batches
      await assert.rejects(page(), e => e.code === 'branch_cutover_parent_capability')
      assert.equal(w.stats.batches, batches)
    }
    console.log('REAL SIDECAR METRICS ' + JSON.stringify({ returnedBytes, sqlBytes, maximumBinds: w.stats.maxBinds, captures, malformedCases: cases.length }))
    w.raw.close()
  })
  await check('precision quantity retains the original admitted twelve-place REAL in both manifest totals', async () => {
    const w = world(); stock(w); const quantity = 1000.123456789012
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=2').run(quantity)
    w.raw.prepare('UPDATE branch_batch_stock SET quantity=? WHERE branch_id=2').run(quantity)
    w.raw.prepare('UPDATE products SET stock_quantity=? WHERE id=10').run(quantity + 5)
    const row = await until(w, (await begin(w)).row, 'moving')
    const manifest = JSON.parse(row.manifest_json)
    assert.equal(manifest.sourceQuantityText, '1000.123456789012')
    assert.equal(manifest.sourceLotQuantityText, '1000.123456789012')
    assert.equal(row.capture_digest, row.snapshot_digest)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=2').get().quantity, quantity)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE branch_id=2').get().quantity, quantity)
    w.raw.close()
  })
  await check('precision adjacent REAL cost between passes refuses completion', async () => {
    const w = world(); stock(w)
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(1.0000000000000002)
    const row = await until(w, (await begin(w)).row, 'snapshots')
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(1.0000000000000004)
    await assert.rejects(until(w, row, 'moving'))
    assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'snapshots')
    assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, 1.0000000000000004)
    w.raw.close()
  })
  await check('precision adjacent REAL read-to-batch mutation rolls back its entire checkpoint', async () => {
    const w = world(); stock(w)
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(1.0000000000000002)
    const tables = [...new Set([...w.capture.BRANCH_SCALAR_REFERENCES.map(v => v[0]), 'products', ...w.capture.UNCLASSIFIED_JSON_FAMILIES])].sort().filter(t => t !== 'branch_cutovers' && !w.capture.UNCLASSIFIED_JSON_FAMILIES.includes(t))
    let { row } = await begin(w)
    while (w.capture.parseCaptureCursor(row.capture_cursor_json).index !== tables.indexOf('product_batches')) row = (await step(w, row)).row
    const prior = w.raw.prepare('SELECT * FROM branch_cutovers').get()
    w.stats.before = raw => raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(1.0000000000000004)
    await assert.rejects(step(w, row))
    assert.deepEqual(w.raw.prepare('SELECT * FROM branch_cutovers').get(), prior)
    assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, 1.0000000000000004)
    assert.equal(w.raw.prepare('SELECT count(*) n FROM inventory_movements').get().n, 0)
    w.raw.close()
  })
  await check('typed scalar roots distinguish null integer REAL text and adjacent full-width integers', async () => {
    const w = world(); stock(w); w.raw.exec('ALTER TABLE products ADD COLUMN precision_scalar')
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = [...new Set([...w.capture.BRANCH_SCALAR_REFERENCES.map(v => v[0]), 'products', ...w.capture.UNCLASSIFIED_JSON_FAMILIES])].sort().filter(t => t !== 'branch_cutovers' && !w.capture.UNCLASSIFIED_JSON_FAMILIES.includes(t))
    const cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('products') }
    const page = () => w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 1, { 1: 'Warehouse', 2: 'Shop' }, false)
    const roots = []
    for (const literal of ['NULL', '1', '1.0', "'1'", "''", '9223372036854775807', '9223372036854775806', '1.0000000000000002', '1.0000000000000004']) {
      w.raw.exec('UPDATE products SET precision_scalar=' + literal + ' WHERE id=10')
      const readCount = w.stats.reads; const captured = await page()
      assert.equal(w.stats.reads - readCount, 2)
      await w.db.batch(captured.statements)
      roots.push(captured.digest)
    }
    assert.equal(new Set(roots).size, roots.length)
    w.raw.exec('UPDATE products SET precision_scalar=1 WHERE id=10')
    const integerPage = await page()
    w.raw.exec('UPDATE products SET precision_scalar=1.0 WHERE id=10')
    assert.equal(w.raw.prepare('SELECT typeof(precision_scalar) t FROM products WHERE id=10').get().t, 'real')
    await assert.rejects(w.db.batch(integerPage.statements))
    for (const literal of ['1e999', '-1e999', "X'01'"]) {
      w.raw.exec('UPDATE products SET precision_scalar=' + literal + ' WHERE id=10')
      const batches = w.stats.batches
      await assert.rejects(page(), e => e.code === 'branch_cutover_parent_capability')
      assert.equal(w.stats.batches, batches)
    }
    for (const value of [Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, 0]) {
      w.raw.prepare('UPDATE products SET precision_scalar=? WHERE id=10').run(value)
      const captured = await page(); await w.db.batch(captured.statements)
      assert.equal(w.raw.prepare('SELECT precision_scalar FROM products WHERE id=10').get().precision_scalar, value)
    }
    w.raw.close()
  })
  await check('typed capture static page sizes preserve one root and original exact decimal totals', async () => {
    const w = world(); stock(w); const quantity = 1000.123456789012
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=2').run(quantity)
    w.raw.prepare('UPDATE branch_batch_stock SET quantity=? WHERE branch_id=2').run(quantity)
    const feeBase = w.raw.prepare('SELECT coalesce(max(id),0) id FROM fees').get().id
    for (let i = 1; i <= 35; i++) w.raw.prepare("INSERT INTO fees(id,branch_id,notes,fee_date) VALUES(?,2,?,'2026-10-03')").run(feeBase + i * 3, 'note' + i)
    const schema = await w.capture.readCutoverCaptureSchema(w.db); const roots = [], counts = []
    for (const size of [1, 3, 32]) {
      let cursor = w.capture.initialCaptureCursor(), digest = '0'.repeat(64), records = 0, pages = 0
      while (true) {
        const page = await w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, digest, size, { 1: 'Warehouse', 2: 'Shop' }, false)
        cursor = page.cursor; digest = page.digest; records += page.records
        assert.ok(++pages < 150)
        if (page.done) break
      }
      assert.equal(cursor.sourceQuantityText, '1000.123456789012'); assert.equal(cursor.sourceLotQuantityText, '1000.123456789012')
      roots.push(digest); counts.push([cursor.rows, records])
    }
    assert.equal(new Set(roots).size, 1); assert.deepEqual(counts[0], counts[1]); assert.deepEqual(counts[1], counts[2]); w.raw.close()
  })
  await check('typed capture keeps free and unknown costs distinct and accepts its smallest decimal quantity', async () => {
    const roots = []
    for (const cost of [0, null]) {
      const w = world(); stock(w)
      w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(cost)
      w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=2').run(1e-12)
      w.raw.prepare('UPDATE branch_batch_stock SET quantity=? WHERE branch_id=2').run(1e-12)
      const row = await until(w, (await begin(w)).row, 'moving', 3)
      assert.equal(JSON.parse(row.manifest_json).sourceQuantityText, '0.000000000001')
      assert.equal(JSON.parse(row.manifest_json).sourceLotQuantityText, '0.000000000001')
      assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, cost)
      assert.equal(row.capture_digest, row.snapshot_digest); roots.push(row.capture_digest); w.raw.close()
    }
    assert.notEqual(roots[0], roots[1])
    const w = world(); stock(w)
    w.raw.prepare('UPDATE branch_stock SET quantity=? WHERE branch_id=2').run(1e-13)
    w.raw.prepare('UPDATE branch_batch_stock SET quantity=? WHERE branch_id=2').run(1e-13)
    const row = (await begin(w)).row
    await assert.rejects(until(w, row, 'snapshots'), e => e.code === 'branch_cutover_parent_capability')
    assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'capturing'); w.raw.close()
  })
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
