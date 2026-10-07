const assert = require('node:assert/strict')
const { world, begin, step, installLossyCaptureCost } = require('./test-branch-cutover-parent-native.cjs')
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
  await check('all registered capture streams and page guards execute at function arity100', async () => {
    const w = world(); w.raw.limits.functionArg = 100
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
    assert.equal(schema.columns.sales.length, 68); assert.equal(tables.length, 28)
    for (const [index, table] of tables.entries()) {
      const cursor = { ...w.capture.initialCaptureCursor(), index }, reads = w.stats.reads
      const page = await w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 1, { 1: 'Warehouse', 2: 'Shop' }, false)
      assert.equal(w.stats.reads - reads, 2, table)
      await w.db.batch(page.statements)
      assert.ok(w.stats.maxBinds <= 100, table)
    }
    assert.equal(w.raw.limits.functionArg, 100); assert.equal(w.raw.limits.exprDepth, 100); w.raw.close()
  })
  await check('wide populated JSON preserves ordered typed fields nulls escaped text hash and last-chunk CAS', async () => {
    const w = world()
    w.raw.exec("ALTER TABLE sales ADD COLUMN arity_text; ALTER TABLE sales ADD COLUMN arity_integer; ALTER TABLE sales ADD COLUMN arity_real; ALTER TABLE sales ADD COLUMN arity_null; INSERT INTO sales(id,branch_id,branch_name) VALUES(20,2,'Shop')")
    const text = 'ខ្មែរ "quoted" \\ path\nnext'
    w.raw.prepare('UPDATE sales SET arity_text=?,arity_integer=9223372036854775807,arity_real=?,arity_null=NULL WHERE id=20').run(text, 1.0000000000000002)
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
    const cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('sales') }
    const encoded = Object.fromEntries(schema.columns.sales.map(field => {
      const quoted = '"' + field.replaceAll('"', '""') + '"'
      const value = w.raw.prepare(`SELECT typeof(${quoted}) type,CASE typeof(${quoted}) WHEN 'integer' THEN CAST(${quoted} AS TEXT) WHEN 'real' THEN printf('%!.17g',${quoted}) WHEN 'text' THEN ${quoted} END value FROM sales WHERE id=20`).get()
      return [field, [value.type, value.value]]
    }))
    assert.deepEqual(encoded.arity_text, ['text', text]); assert.deepEqual(encoded.arity_integer, ['integer', '9223372036854775807'])
    assert.deepEqual(encoded.arity_real, ['real', '1.0000000000000002']); assert.deepEqual(encoded.arity_null, ['null', null])
    const reads = w.stats.reads
    const page = await w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 1, { 1: 'Warehouse', 2: 'Shop' }, false)
    assert.equal(w.stats.reads - reads, 2)
    assert.equal(page.statements[0].params.fingerprint, JSON.stringify([[20, JSON.stringify(encoded)]]))
    assert.equal(page.digest, hash(['0'.repeat(64), 'sales', 20, encoded]))
    await w.db.batch(page.statements)
    w.raw.prepare('UPDATE sales SET arity_real=? WHERE id=20').run(1.0000000000000004)
    await assert.rejects(w.db.batch(page.statements))
    assert.equal(w.raw.prepare('SELECT arity_real FROM sales WHERE id=20').get().arity_real, 1.0000000000000004)
    assert.equal(w.raw.limits.functionArg, 100); w.raw.close()
  })
  await check('raw REAL exactness refuses both signed native non-roundtrip costs before a page batch', async () => {
    for (const value of [3.5702545241480925e141, -3.5702545241480925e141]) {
      const w = world(); stock(w)
      w.raw.prepare('UPDATE product_batches SET unit_cost_usd=? WHERE id=101').run(value)
      const prepare = w.db.prepare, lossy = installLossyCaptureCost(w)
      try {
        const { native } = lossy
        assert.equal(native.raw, value); assert.notEqual(Number(native.encoded), native.raw)
        const schema = await w.capture.readCutoverCaptureSchema(w.db)
        const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
        const cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('product_batches') }, batches = w.stats.batches
        await assert.rejects(w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, '0'.repeat(64), 1, { 1: 'Warehouse', 2: 'Shop' }, false), e => e.code === 'branch_cutover_parent_capability')
        assert.equal(lossy.calls(), 1)
        assert.equal(w.stats.batches, batches)
        assert.equal(w.raw.prepare('SELECT unit_cost_usd FROM product_batches WHERE id=101').get().unit_cost_usd, value)
      } finally { lossy.restore(); assert.equal(w.db.prepare, prepare) }
      w.raw.close()
    }
  })
  await check('raw REAL sidecars bind cardinality order storage types and bounded native projections', async () => {
    const w = world(); stock(w)
    w.raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,received_branch_id,unit_cost_usd) VALUES(102,10,'lot102',2,4); ALTER TABLE product_batches ADD COLUMN precision_integer; UPDATE product_batches SET precision_integer=9223372036854775807")
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
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
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
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
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
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
    // below the twelfth place: refused at begin since E3 (it used to refuse only during capture), so no journal row exists
    await assert.rejects(begin(w), e => e.code === 'branch_cutover_parent_capability' && e.capability === 'unsupported_stock_state:inexact')
    assert.equal(w.raw.prepare('SELECT count(*) n FROM branch_cutovers').get().n, 0); w.raw.close()
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
    const before = hash(['products', 'product_batches', 'branch_stock', 'branch_batch_stock'].map(t => w.raw.prepare('SELECT * FROM '+t+' ORDER BY rowid').all().map(r => { const { received_branch_name, ...rest } = r; return rest })))
    assert.equal(w.raw.prepare('SELECT received_branch_name FROM product_batches WHERE id=101').get().received_branch_name, null)
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
    assert.equal(hash(['products', 'product_batches', 'branch_stock', 'branch_batch_stock'].map(t => w.raw.prepare('SELECT * FROM '+t+' ORDER BY rowid').all().map(r => { const { received_branch_name, ...rest } = r; return rest }))), before)
    // registry v3 snapshot map: the lot's receiving-branch label is filled with the event-time name, nothing else moves
    assert.equal(w.raw.prepare('SELECT received_branch_name FROM product_batches WHERE id=101').get().received_branch_name, 'Shop'); w.raw.close()
  })
  await check('changed page after read refuses checkpoint and leaves no label partial write', async () => {
    const w = world(); w.raw.exec("INSERT INTO sales(id,branch_id,branch_name) VALUES(20,2,NULL)")
    let row = await until(w, (await begin(w)).row, 'snapshots')
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
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
  await check('registry v3: plain history passes, an unknown applier refuses, and last moment family inserts cannot complete snapshots', async () => {
    {
      const w = world(); w.raw.exec("INSERT INTO action_history(label) VALUES('Legacy undo'); INSERT INTO undo_snapshots(kind,payload_json) VALUES('x','{}'); INSERT INTO pending_actions(section,action_type,entity_type,status) VALUES('s','a','e','rejected')")
      const row = await until(w, (await begin(w)).row, 'verifying')
      const manifest = JSON.parse(row.manifest_json)
      assert.deepEqual(manifest.history, { open: 0, leave: 0, close: 0, maxId: 0, byApplier: {}, digest: '' })
      assert.equal(manifest.families.undo_snapshots, '1:1'); assert.equal(manifest.families.pending_actions, '1:1'); assert.equal(manifest.families.actionHistoryMax, 1)
      w.raw.close()
    }
    {
      const w = world(); w.raw.exec(`INSERT INTO action_history(label,undo_payload,redo_payload) VALUES('Future applier','{"applier":"future.kind"}','{"applier":"future.kind"}')`)
      const plan = await w.parent.inspectBranchCutover(w.db, { id: 7, organization_id: 1, is_active: 1 }, 1, { sourceBranchId: 2, targetBranchId: 1 }, { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 })
      assert.ok(plan.capabilities.some(c => c.code === 'history_applier_unclassified' && c.detail === 'future.kind'))
      let row = (await begin(w)).row
      await assert.rejects(until(w, row, 'snapshots'), e => e.code === 'branch_cutover_parent_capability' && /history_applier_unclassified:future.kind/.test(e.message))
      assert.equal(w.raw.prepare('SELECT phase FROM branch_cutovers').get().phase, 'capturing'); w.raw.close()
    }
    for (const insert of ["INSERT INTO action_history(label) VALUES('Concurrent undo')", "INSERT INTO undo_snapshots(kind,payload_json) VALUES('x','{}')",
      "INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES('op',7,'req','add','{}')",
      "INSERT INTO pending_actions(section,action_type,entity_type,status) VALUES('s','a','e','open')"]) {
      const w = world(); let row = await until(w, (await begin(w)).row, 'snapshots')
      while (true) {
        const cursor = w.capture.parseCaptureCursor(row.snapshot_cursor_json)
        const schema = await w.capture.readCutoverCaptureSchema(w.db)
        const page = await w.capture.readCutoverCapturePage(w.db, schema, {sourceBranchId:2,targetBranchId:1}, cursor, row.snapshot_digest, 8, {1:'Warehouse',2:'Shop'}, false)
        if (page.done && page.records === 0) break
        row = (await step(w, row)).row
      }
      const revision = row.revision
      w.stats.before = raw => raw.exec(insert)
      await assert.rejects(step(w, row)); const saved = w.raw.prepare('SELECT phase,revision FROM branch_cutovers').get()
      assert.equal(saved.phase, 'snapshots', insert); assert.equal(saved.revision, revision); w.raw.close()
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
  await check('T5.2 every stream page and the next-product plan read in rowid/index order with no temp B-tree sort', async () => {
    const w = world(); stock(w)
    for (const table of w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')) {
      const plan = w.raw.prepare('EXPLAIN QUERY PLAN SELECT rowid ' + w.capture.capturePageFromSql(table)).all({ source: 2, target: 1, after: 0, limit: 256 }).map(r => r.detail)
      assert.ok(!plan.some(d => /TEMP B-TREE/.test(d)), table + ': ' + plan.join(' / '))
      assert.ok(plan.some(d => new RegExp('^SCAN (main\.)?"?' + table + '"?( |$)').test(d) || /USING INTEGER PRIMARY KEY/.test(d)), table + ': ' + plan.join(' / '))
    }
    const next = w.raw.prepare('EXPLAIN QUERY PLAN ' + w.parent.NEXT_SOURCE_PRODUCT_SQL).all({ source: 2, last: 0 }).map(r => r.detail).join(' / ')
    assert.match(next, /idx_branch_stock_product_branch_unique/); assert.doesNotMatch(next, /TEMP B-TREE/)
    w.raw.close()
  })
  await check('T5.3 a page over the byte cap halves its row limit, still reads every row once, and keeps the canonical digest', async () => {
    const roots = []
    for (const size of [256, 7]) {
      const w = world(); const base = w.raw.prepare('SELECT coalesce(max(id),0) id FROM fees').get().id
      for (let i = 1; i <= 300; i++) w.raw.prepare("INSERT INTO fees(id,branch_id,notes,fee_date,created_at,updated_at) VALUES(?,2,?,'2026-10-03','2026-10-03','2026-10-03')").run(base + i, 'x'.repeat(2000))
      const schema = await w.capture.readCutoverCaptureSchema(w.db)
      let cursor = { ...w.capture.initialCaptureCursor(), index: w.capture.CAPTURE_STREAMS.indexOf('fees') }, digest = '0'.repeat(64), rows = 0, pages = 0, largest = 0
      while (cursor.index === w.capture.CAPTURE_STREAMS.indexOf('fees')) {
        const page = await w.capture.readCutoverCapturePage(w.db, schema, { sourceBranchId: 2, targetBranchId: 1 }, cursor, digest, size, { 1: 'Warehouse', 2: 'Shop' }, false)
        largest = Math.max(largest, page.cursor.rows - cursor.rows); rows += page.cursor.rows - cursor.rows; cursor = page.cursor; digest = page.digest; pages++
        await w.db.batch(page.statements)
      }
      assert.equal(rows, 300); if (size === 256) assert.ok(largest < 256 && largest >= 64, String(largest))
      roots.push(digest); w.raw.close()
    }
    assert.equal(roots[0], roots[1])
    const w = world(); await assert.rejects(w.capture.readCutoverCapturePage(w.db, await w.capture.readCutoverCaptureSchema(w.db), { sourceBranchId: 2, targetBranchId: 1 }, w.capture.initialCaptureCursor(), '0'.repeat(64), 257, {}, false), e => e.code === 'branch_cutover_parent_capability')
    w.raw.close()
  })
  await check('REHEARSAL F1: rows with ~21.5 KB pricing_snapshot_json overflow the SQLite string limit; the page halves, the working size is remembered, and a single row over the limit is a coded refusal', async () => {
    const w = world()
    const insert = w.raw.prepare('INSERT INTO sale_items(id,sale_id,product_id,quantity,branch_id,pricing_snapshot_json) VALUES(?,?,?,?,?,?)')
    const big = JSON.stringify({ pad: 'x'.repeat(21500) })
    for (let id = 1; id <= 40; id++) insert.run(id, 1, 10, 1, 2, big)
    const schema = await w.capture.readCutoverCaptureSchema(w.db)
    const tables = w.capture.CAPTURE_STREAMS.filter(t => t !== 'history_open')
    const identity = { sourceBranchId: 2, targetBranchId: 1 }, names = { 1: 'Warehouse', 2: 'Shop' }
    const drain = async (limitBytes) => {
      w.raw.limits.length = limitBytes
      let cursor = { ...w.capture.initialCaptureCursor(), index: tables.indexOf('sale_items') }, digest = '0'.repeat(64), pages = [], keys = 0
      for (let turn = 0; turn < 80 && cursor.index === tables.indexOf('sale_items'); turn++) {
        const reads = w.stats.reads
        const page = await w.capture.readCutoverCapturePage(w.db, schema, identity, cursor, digest, 256, names, false)
        pages.push({ reads: w.stats.reads - reads, records: page.records, pageLimit: page.cursor.pageLimit })
        await w.db.batch(page.statements)
        cursor = page.cursor; digest = page.digest; keys += page.records
      }
      return { cursor, digest, pages, keys }
    }
    const unlimited = await drain(1_000_000_000)
    const limited = await drain(200_000)
    assert.equal(limited.digest, unlimited.digest, 'the same rows, the same digest, whatever the page size')
    assert.equal(limited.cursor.rows, 40)
    const halved = limited.pages[0]
    assert.ok(halved.reads > 1 && halved.pageLimit > 0 && halved.pageLimit < 40, 'the first page halved: ' + JSON.stringify(halved))
    for (const later of limited.pages.slice(1)) assert.equal(later.reads, 1, 'a later invocation reads once at the remembered size, no repeated halving: ' + JSON.stringify(later))
    assert.equal(limited.cursor.pageLimit, 0, 'the remembered size is per table: it resets when the table ends')
    // a row alone over the limit cannot be paged: a coded refusal, not an uncoded error
    w.raw.limits.length = 20_000
    await assert.rejects(w.capture.readCutoverCapturePage(w.db, schema, identity, { ...w.capture.initialCaptureCursor(), index: tables.indexOf('sale_items') }, '0'.repeat(64), 256, names, false),
      error => error.capability === 'capture_row_too_big')
    w.raw.limits.length = 1_000_000_000
    w.raw.close()
  })
  assert.ok(checks > 0, 'test filter must select a group')
  console.log(`${checks} branch cutover capture native groups passed`)
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1 })
