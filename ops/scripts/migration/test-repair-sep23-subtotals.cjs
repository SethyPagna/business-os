#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { openDb } = require('../../../cloudflare/scripts/harness/d1compat.cjs')
const planner = require('./repair-sep23-subtotals.cjs')

const SCHEMA = `
CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE sale_bulk_guards(id INTEGER PRIMARY KEY,guard_value INTEGER NOT NULL CHECK(guard_value=1));
CREATE TABLE sales(
 id INTEGER PRIMARY KEY,receipt_number TEXT,created_at TEXT,updated_at TEXT,notes TEXT,sale_status TEXT,
 subtotal_usd REAL DEFAULT 0,subtotal_khr REAL DEFAULT 0,total_usd REAL,total_khr REAL,
 amount_paid_usd REAL,amount_paid_khr REAL,discount_usd REAL,discount_khr REAL,
 tax_usd REAL,tax_khr REAL,delivery_fee_usd REAL,delivery_fee_khr REAL,
 exchange_rate REAL,stock_skipped INTEGER,payment_method TEXT,payment_details TEXT
);
CREATE TABLE sale_items(
 id INTEGER PRIMARY KEY,sale_id INTEGER,quantity REAL,applied_price_usd REAL,total_usd REAL,total_khr REAL,
 product_discount_usd REAL,product_discount_khr REAL,manual_discount_usd REAL,manual_discount_khr REAL
);
CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER sale_revision_sales_update AFTER UPDATE ON sales
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) VALUES(NEW.id,1)
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;
CREATE TABLE action_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT,entity TEXT,entity_id TEXT,label TEXT NOT NULL,
 reversible INTEGER DEFAULT 1,status TEXT DEFAULT 'undoable',undo_payload TEXT DEFAULT '{}',
 redo_payload TEXT DEFAULT '{}',created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,
 table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sale_bulk_members(operation_id TEXT,sale_id INTEGER,revision INTEGER,movement_fingerprint TEXT);
CREATE TABLE branch_stock(id INTEGER PRIMARY KEY,product_id INTEGER,branch_id INTEGER,quantity REAL);
CREATE TABLE branch_batch_stock(id INTEGER PRIMARY KEY,batch_id INTEGER,branch_id INTEGER,quantity REAL);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,reference_id INTEGER,movement_type TEXT,quantity REAL);
`

function amountPlan() {
  const amounts = new Map()
  for (let id = 16842; id <= 16858; id += 1) amounts.set(id, id === 16858 ? '190.0000' : '80.0000')
  for (let id = 16859; id <= 16863; id += 1) amounts.set(id, id === 16863 ? '392.0000' : '400.0000')
  return amounts
}

function discountPlan() {
  const discounts = new Map()
  for (let id = 16842; id <= 16858; id += 1) discounts.set(id, id === 16858 ? '13.0000' : '3.0000')
  for (let id = 16859; id <= 16863; id += 1) discounts.set(id, '1.0000')
  return discounts
}

function fixtureManifest(overrides = {}) {
  const amounts = amountPlan()
  const discounts = discountPlan()
  const sales = planner.EXPECTED_IDS.map((id) => {
    const businessDate = id <= 16858 ? '2026-09-03' : '2026-09-02'
    const target = amounts.get(id)
    return {
      id,
      receipt_number: `2026090${businessDate.endsWith('3') ? '3' : '2'}-${String(id).slice(-6)}`,
      created_at: `${businessDate} 03:00:00`,
      updated_at: '2026-09-04 00:00:00',
      business_date: businessDate,
      notes: `Legacy source row for ${id}`,
      sale_status: 'completed',
      expected_subtotal_usd: '0.0000',
      expected_subtotal_khr: '0.0000',
      target_subtotal_usd: target,
      total_usd: target,
      total_khr: '0.0000',
      amount_paid_usd: target,
      amount_paid_khr: '0.0000',
      discount_usd: '0.0000',
      discount_khr: '0.0000',
      tax_usd: '0.0000',
      tax_khr: '0.0000',
      delivery_fee_usd: '0.0000',
      delivery_fee_khr: '0.0000',
      exchange_rate: '4100.0000',
      stock_skipped: 0,
      payment_method: 'Cash',
      payment_details: null,
      expected_revision: null,
      item_count: 1,
      item_total_usd: target,
      item_total_khr: '0.0000',
      item_discount_usd: discounts.get(id),
      item_discount_khr: '0.0000',
    }
  })
  return {
    schema_version: 1,
    plan_id: 'sep23-subtotal-fixture-20260905',
    generated_at_utc: '2026-09-05T08:30:00Z',
    operator_name: 'Local fixture operator',
    source_note: 'Fresh preflight fixture; no remote execution.',
    sales,
    ...overrides,
  }
}

function seed(manifest = fixtureManifest()) {
  const db = openDb([SCHEMA])
  const saleInsert = db.prepare(`INSERT INTO sales(
    id,receipt_number,created_at,updated_at,notes,sale_status,subtotal_usd,subtotal_khr,total_usd,total_khr,
    amount_paid_usd,amount_paid_khr,discount_usd,discount_khr,tax_usd,tax_khr,
    delivery_fee_usd,delivery_fee_khr,exchange_rate,stock_skipped,payment_method,payment_details
  ) VALUES(@id,@receipt,@created,@updated,@notes,@status,0,@subtotal_khr,@total_usd,@total_khr,
    @paid_usd,@paid_khr,@discount_usd,@discount_khr,@tax_usd,@tax_khr,
    @delivery_usd,@delivery_khr,@rate,@skipped,@method,@details)`)
  const itemInsert = db.prepare(`INSERT INTO sale_items(
    id,sale_id,quantity,applied_price_usd,total_usd,total_khr,product_discount_usd,
    product_discount_khr,manual_discount_usd,manual_discount_khr
  ) VALUES(@item_id,@sale_id,1,@gross,@total_usd,@total_khr,@discount_usd,@discount_khr,0,0)`)
  for (const row of manifest.sales) {
    saleInsert.run({
      id: row.id, receipt: row.receipt_number, created: row.created_at, updated: row.updated_at, notes: row.notes, status: row.sale_status,
      subtotal_khr: row.expected_subtotal_khr, total_usd: row.total_usd, total_khr: row.total_khr,
      paid_usd: row.amount_paid_usd, paid_khr: row.amount_paid_khr,
      discount_usd: row.discount_usd, discount_khr: row.discount_khr,
      tax_usd: row.tax_usd, tax_khr: row.tax_khr,
      delivery_usd: row.delivery_fee_usd, delivery_khr: row.delivery_fee_khr,
      rate: row.exchange_rate, skipped: row.stock_skipped, method: row.payment_method, details: row.payment_details,
    })
    itemInsert.run({
      item_id: row.id * 10, sale_id: row.id,
      gross: Number(row.target_subtotal_usd) + Number(row.item_discount_usd),
      total_usd: row.item_total_usd, total_khr: row.item_total_khr,
      discount_usd: row.item_discount_usd, discount_khr: row.item_discount_khr,
    })
    if (row.expected_revision !== null) {
      db.prepare('INSERT INTO sale_write_revisions(sale_id,revision) VALUES(?,?)').run([row.id, row.expected_revision])
    }
  }
  db.prepare("INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_name) VALUES('global','sale','prior-operation','Existing undo',1,'undoable','{}','{}','Fixture')").run()
  db.prepare("INSERT INTO sale_bulk_members(operation_id,sale_id,revision,movement_fingerprint) VALUES('prior-operation',16842,0,'[]')").run()
  db.prepare('INSERT INTO branch_stock VALUES(1,10,2,55)').run()
  db.prepare('INSERT INTO branch_batch_stock VALUES(1,20,2,44)').run()
  db.prepare("INSERT INTO inventory_movements VALUES(1,16842,'sale',1)").run()
  return db
}

async function rows(db, sql, params = {}) {
  return db.prepare(sql).all(params).map((row) => ({ ...row }))
}

async function protectedSnapshot(db) {
  return {
    sales: await rows(db, `SELECT id,total_usd,total_khr,amount_paid_usd,amount_paid_khr,discount_usd,discount_khr,
      tax_usd,tax_khr,delivery_fee_usd,delivery_fee_khr,exchange_rate,stock_skipped,payment_method,payment_details,
      receipt_number,created_at,updated_at,notes,sale_status FROM sales ORDER BY id`),
    items: await rows(db, 'SELECT * FROM sale_items ORDER BY id'),
    branch: await rows(db, 'SELECT * FROM branch_stock ORDER BY id'),
    branchBatch: await rows(db, 'SELECT * FROM branch_batch_stock ORDER BY id'),
    movements: await rows(db, 'SELECT * FROM inventory_movements ORDER BY id'),
  }
}

async function scalar(db, sql, params = {}) {
  return db.prepare(sql).get(params)
}

async function assertHealthyApplyAndLostAck() {
  const manifest = fixtureManifest()
  const payload = planner.buildPayload(manifest)
  const db = seed(manifest)
  const protectedBefore = await protectedSnapshot(db)
  const before = await scalar(db, payload.inspect.sql, payload.inspect.params)
  assert.equal(before.exact_before_rows, 22)
  assert.equal(before.exact_after_rows, 0)

  await db.batch(payload.apply.statements)
  const after = await scalar(db, payload.inspect.sql, payload.inspect.params)
  assert.equal(after.exact_after_rows, 22)
  assert.equal(after.current_subtotal_usd, '3462.0000')
  assert.equal(after.current_total_usd, '3462.0000')
  assert.equal(after.current_paid_usd, '3462.0000')
  assert.equal(after.current_item_discount_usd, '66.0000')
  assert.equal(after.apply_history_rows, 1)
  assert.equal(after.apply_audit_rows, 1)
  assert.deepEqual(await rows(db, `SELECT date(datetime(s.created_at,'+7 hours')) AS business_date,
      printf('%.4f',SUM(COALESCE(si.product_discount_usd,0)+COALESCE(si.manual_discount_usd,0))) AS discount_usd
    FROM sales s JOIN sale_items si ON si.sale_id=s.id GROUP BY business_date ORDER BY business_date`), [
    { business_date: '2026-09-02', discount_usd: '5.0000' },
    { business_date: '2026-09-03', discount_usd: '61.0000' },
  ])
  assert.deepEqual(await protectedSnapshot(db), protectedBefore, 'only sales.subtotal_usd and automatic revisions/audit may change')
  assert.deepEqual(await rows(db, 'SELECT sale_id,revision FROM sale_write_revisions ORDER BY sale_id'),
    planner.EXPECTED_IDS.map((sale_id) => ({ sale_id, revision: 1 })))
  const staleUndo = await scalar(db, `SELECT COUNT(*) AS n FROM sale_bulk_members m
    WHERE m.operation_id='prior-operation' AND m.revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=m.sale_id),0)`)
  assert.equal(staleUndo.n, 0, 'revision trigger automatically invalidates an older undo member')

  // Lost acknowledgement: the exact same complete batch is safe to resubmit.
  await db.batch(payload.apply.statements)
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM action_history WHERE entity=?', ['sep23_subtotal_repair'])).n, 1)
  assert.equal((await scalar(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action='repair_subtotal_usd'")).n, 1)
  assert.deepEqual(await rows(db, 'SELECT sale_id,revision FROM sale_write_revisions ORDER BY sale_id'),
    planner.EXPECTED_IDS.map((sale_id) => ({ sale_id, revision: 1 })), 'no-op retry must not bump revisions')
}

async function assertStaleRowRejectsAll() {
  const manifest = fixtureManifest()
  const payload = planner.buildPayload(manifest)
  const db = seed(manifest)
  db.prepare("UPDATE sales SET notes='Changed after manifest' WHERE id=16852").run()
  // Reset the fixture-only revision side effect so the note itself is the
  // independently visible stale field that causes the manifest refusal.
  db.prepare('DELETE FROM sale_write_revisions').run()
  const protectedBefore = await protectedSnapshot(db)
  await assert.rejects(db.batch(payload.apply.statements), /constraint/i)
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM sales WHERE subtotal_usd<>0')).n, 0)
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM audit_logs')).n, 0)
  assert.deepEqual(await protectedSnapshot(db), protectedBefore)
}

async function assertLateFailureRollsBackAll() {
  const manifest = fixtureManifest()
  const payload = planner.buildPayload(manifest)
  const db = seed(manifest)
  db.exec(`CREATE TRIGGER fixture_late_failure BEFORE UPDATE OF subtotal_usd ON sales
    WHEN NEW.id=16852 BEGIN SELECT RAISE(ABORT,'fixture late failure'); END;`)
  await assert.rejects(db.batch(payload.apply.statements), /fixture late failure/)
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM sales WHERE subtotal_usd<>0')).n, 0, 'earlier updates roll back')
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM sale_write_revisions')).n, 0, 'trigger revisions roll back too')
  assert.equal((await scalar(db, 'SELECT COUNT(*) AS n FROM action_history WHERE entity=?', ['sep23_subtotal_repair'])).n, 0)
}

async function assertRecoveryIsGuardedAndIdempotent() {
  const manifest = fixtureManifest()
  const payload = planner.buildPayload(manifest)
  const db = seed(manifest)
  const protectedBefore = await protectedSnapshot(db)
  await db.batch(payload.apply.statements)
  await db.batch(payload.recovery.statements)
  const recovered = await scalar(db, payload.inspect.sql, payload.inspect.params)
  assert.equal(recovered.exact_recovered_rows, 22)
  assert.equal(recovered.current_subtotal_usd, '0.0000')
  assert.equal(recovered.recovery_history_rows, 1)
  assert.equal(recovered.recovery_audit_rows, 1)
  assert.deepEqual(await protectedSnapshot(db), protectedBefore)
  assert.deepEqual(await rows(db, 'SELECT sale_id,revision FROM sale_write_revisions ORDER BY sale_id'),
    planner.EXPECTED_IDS.map((sale_id) => ({ sale_id, revision: 2 })))
  await db.batch(payload.recovery.statements)
  assert.equal((await scalar(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action='recover_subtotal_usd'")).n, 1)
  assert.equal((await scalar(db, 'SELECT MAX(revision) AS n FROM sale_write_revisions')).n, 2)
}

async function assertExistingRevisionsAreExactGuards() {
  const manifest = fixtureManifest()
  for (const [index, row] of manifest.sales.entries()) row.expected_revision = 7 + index
  const payload = planner.buildPayload(manifest)
  const db = seed(manifest)
  await db.batch(payload.apply.statements)
  assert.deepEqual(await rows(db, 'SELECT sale_id,revision FROM sale_write_revisions ORDER BY sale_id'),
    manifest.sales.map((row) => ({ sale_id: row.id, revision: row.expected_revision + 1 })))

  const staleManifest = fixtureManifest({ plan_id: 'sep23-subtotal-stale-revision-20260905' })
  for (const [index, row] of staleManifest.sales.entries()) row.expected_revision = 20 + index
  const stalePayload = planner.buildPayload(staleManifest)
  const staleDb = seed(staleManifest)
  staleDb.prepare('UPDATE sale_write_revisions SET revision=revision+1 WHERE sale_id=16852').run()
  await assert.rejects(staleDb.batch(stalePayload.apply.statements), /constraint/i)
  assert.equal((await scalar(staleDb, 'SELECT COUNT(*) AS n FROM sales WHERE subtotal_usd<>0')).n, 0)
}

function assertManifestAndPayloadGuards() {
  const plannerSource = fs.readFileSync(path.join(__dirname, 'repair-sep23-subtotals.cjs'), 'utf8')
  assert.doesNotMatch(plannerSource, /require\(['"]node:child_process['"]\)|with-wrangler-auth|d1\s+execute|fetch\s*\(/i,
    'the planner must not acquire a database/network execution path')
  const valid = fixtureManifest()
  const payload = planner.buildPayload(valid)
  assert.equal(payload.expected.sale_count, 22)
  assert.deepEqual(payload.expected.sale_ids, planner.EXPECTED_IDS)
  assert.equal(payload.execution_contract.mechanism, 'D1Compat.batch')
  const emittedSql = [payload.inspect.sql, ...payload.apply.statements.map((statement) => statement.sql), ...payload.recovery.statements.map((statement) => statement.sql)].join('\n')
  assert.doesNotMatch(emittedSql, /\bBEGIN\b|\bCOMMIT\b|wrangler|--remote|https?:\/\//i)
  for (const forbidden of ['sale_items', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'products']) {
    const write = new RegExp(`(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+${forbidden}\\b`, 'i')
    assert.ok(!payload.apply.statements.some((statement) => write.test(statement.sql)), `payload writes ${forbidden}`)
  }
  assert.ok(payload.apply.statements.filter((statement) => /^UPDATE sales SET subtotal_usd=/i.test(statement.sql)).length === 22)

  const outside = structuredClone(valid)
  outside.sales[0].id = 16827
  assert.throws(() => planner.buildPayload(outside), /outside the exact 16842-16863 cohort/)
  const missing = structuredClone(valid)
  missing.sales.pop()
  assert.throws(() => planner.buildPayload(missing), /exactly 22 rows/)
  const duplicate = structuredClone(valid)
  duplicate.sales[1].id = duplicate.sales[0].id
  assert.throws(() => planner.buildPayload(duplicate), /business_date must be|exactly once/)
  const floatInput = structuredClone(valid)
  floatInput.sales[0].total_usd = 80
  assert.throws(() => planner.buildPayload(floatInput), /decimal string/)
  const overPrecision = structuredClone(valid)
  overPrecision.sales[0].total_usd = '80.00001'
  assert.throws(() => planner.buildPayload(overPrecision), /at most four fractional digits/)
  const wrongDayDiscount = structuredClone(valid)
  wrongDayDiscount.sales[0].item_discount_usd = '4.0000'
  assert.throws(() => planner.buildPayload(wrongDayDiscount), /item discount sum/)
}

function assertCliOnlyGeneratesNewLocalArtifact() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sep23-subtotal-plan-'))
  try {
    const manifestPath = path.join(temp, 'manifest.json')
    const outputPath = path.join(temp, 'payload.json')
    fs.writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest(), null, 2)}\n`, 'utf8')
    const script = path.join(__dirname, 'repair-sep23-subtotals.cjs')
    const generated = spawnSync(process.execPath, [script, '--manifest', manifestPath, '--out', outputPath], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).execution_contract.mechanism, 'D1Compat.batch')
    const overwrite = spawnSync(process.execPath, [script, '--manifest', manifestPath, '--out', outputPath], { encoding: 'utf8' })
    assert.notEqual(overwrite.status, 0, 'exclusive create must refuse an existing payload path')
    const validate = spawnSync(process.execPath, [script, '--manifest', manifestPath, '--validate-only'], { encoding: 'utf8' })
    assert.equal(validate.status, 0, validate.stderr)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

;(async () => {
  assertManifestAndPayloadGuards()
  assertCliOnlyGeneratesNewLocalArtifact()
  await assertHealthyApplyAndLostAck()
  await assertStaleRowRejectsAll()
  await assertLateFailureRollsBackAll()
  await assertRecoveryIsGuardedAndIdempotent()
  await assertExistingRevisionsAreExactGuards()
  console.log('PASS Sep 2-3 subtotal repair planner: exact cohort, atomic stale refusal, idempotent retry, recovery, revision invalidation, and no protected writes')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
