// Receipt-number race on the historical sales import writer
// (lib/salesImportCommit.ts applyHistoricalSaleImport), against the complete
// migrated schema.
//
// sales.receipt_number carries no UNIQUE index. The import minted a receipt
// with a probe (`SELECT 1 FROM sales WHERE receipt_number = ?`) that runs
// BEFORE its write batch, and a business-format receipt supplied by the file
// was never probed at all -- so a POS sale (or a second import) committing
// the same number in between, or an export re-imported under a new job,
// produced two sales with one receipt number. The fix asserts uniqueness
// inside the batch, re-mints (bounded), and keeps a displaced supplied
// number as legacy_receipt_number.
//
// The race is reproduced deterministically: a `beforeBatch` hook commits a
// peer sale holding the exact receipt number the import is about to write --
// the moment after the probe and before the batch.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (request === './db') return {}
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const { applyHistoricalSaleImport } = load('lib/salesImportCommit.ts')
const SALE_INSERT_RE = /INSERT\s+INTO\s+sales\s*\(/i
const ACTOR = { id: 41, username: 'importer', name: 'Importer' }
const NOW = '2026-09-27T08:00:00.000Z'

function fixture(hooks = {}) {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  db.prepare("INSERT INTO products(id,name,sku,stock_quantity,cost_price_usd,is_active) VALUES(10,'Widget','SKU-1',5,3,1)").run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,5)').run()
  db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,is_active,batch_number) VALUES(20,10,'lot-a','LOT-A',1,1)").run()
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(20,1,5)').run()
  const route = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => statement.run(params),
      }
    },
    batch: async (statements) => {
      if (hooks.beforeBatch) await hooks.beforeBatch(db, statements)
      return db.batch(statements)
    },
  }
  return { raw: db, route }
}

function saleData(overrides = {}) {
  return {
    receipt_number: 'R-100', cashier_id: null, cashier_name: 'Admin', branch_id: 1, branch_name: 'Shop',
    customer_id: null, customer_name: 'Dara', customer_phone: '012345678', customer_address: null,
    payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, notes: null,
    subtotal_usd: 10, subtotal_khr: 41000, discount_usd: 0, discount_khr: 0, tax_usd: 0, tax_khr: 0,
    total_usd: 10, total_khr: 41000, amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0, change_khr: 0,
    membership_discount_usd: 0, membership_discount_khr: 0, membership_points_redeemed: 0,
    is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null, delivery_contact_phone: null,
    delivery_contact_address: null, delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: 'customer',
    sale_status: 'completed', created_at: '2026-08-28T07:30:00.000Z',
    items: [{
      product_id: 10, product_name: 'Widget', sku: 'SKU-1', quantity: 2,
      applied_price_usd: 5, applied_price_khr: 20500, total_usd: 10, total_khr: 41000,
      cost_price_usd: 3, cost_price_khr: 12300, base_price_usd: 5, base_price_khr: 20500,
      product_discount_type: null, product_discount_label: null, product_discount_usd: 0, product_discount_khr: 0,
      manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, manual_discount_khr: 0,
      branch_id: 1, batch_id: 20, batch_label: 'LOT-A', batch_expiry_date: null, returned_quantity: 0,
    }],
    ...overrides,
  }
}

function pendingReceipt(statements) {
  const insert = statements.find(({ sql }) => SALE_INSERT_RE.test(sql))
  return insert ? String(insert.params.receipt_number) : null
}

let peerSeq = 0
function commitPeerSale(db, receiptNumber) {
  peerSeq += 1
  db.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,branch_name,cashier_name,payment_method,total_usd,sale_status)
              VALUES(@receipt,@key,1,'Shop','Peer Till','Cash',1,'completed')`)
    .run({ receipt: receiptNumber, key: `peer-till-${peerSeq}` })
}

function duplicateReceiptGroups(db) {
  return db.prepare('SELECT receipt_number, COUNT(*) AS n FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1').all()
}

function own(db, rowNumber, jobId = 'job-1') {
  return db.prepare(`SELECT id, receipt_number, legacy_receipt_number, creation_snapshot_json FROM sales
                     WHERE client_request_id=@key`).get({ key: `sales-import:${jobId}:${rowNumber}` })
}

;(async () => {
  const failures = []
  async function scenario(id, run) {
    try { await run() } catch (error) {
      failures.push(id)
      console.log(`FAIL scenario ${id}: ${String(error && error.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
    }
  }

  // 1. A peer commits the minted number between probe and batch.
  await scenario(1, async () => {
    let injected = null
    const f = fixture({
      beforeBatch(db, statements) {
        if (injected) return
        injected = pendingReceipt(statements)
        if (injected) commitPeerSale(db, injected)
      },
    })
    const result = await applyHistoricalSaleImport(f.route, { jobId: 'job-1', rowNumber: 2, data: saleData(), nowIso: NOW, actor: ACTOR })
    assert.equal(injected, '20260828-143000', 'the peer takes the number minted from the sale moment')
    assert.equal(result.alreadyApplied, false)
    assert.deepEqual(duplicateReceiptGroups(f.raw), [], 'two sales must never share one receipt number')
    const row = own(f.raw, 2)
    assert.ok(row, 'the import still commits')
    assert.equal(row.receipt_number, '20260828-143000-2')
    assert.equal(row.legacy_receipt_number, 'R-100')
    assert.equal(JSON.parse(row.creation_snapshot_json).receipt_number, row.receipt_number, 'creation snapshot follows the retried number')
    assert.equal(Number(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=@id').get({ id: row.id }).n), 1)
    assert.equal(f.raw.prepare("SELECT status FROM import_sales_commits WHERE job_id='job-1' AND group_key='row:2'").get().status, 'applied')
    console.log('PASS an import racing a peer for the same minted receipt number commits under a distinct retried number')
  })

  // 2. A business-format receipt supplied by the file, already held by
  //    another sale, is re-minted -- the supplied label survives as legacy.
  await scenario(2, async () => {
    const f = fixture()
    commitPeerSale(f.raw, '20260828-143000')
    await applyHistoricalSaleImport(f.route, { jobId: 'job-1', rowNumber: 3, data: saleData({ receipt_number: '20260828-143000' }), nowIso: NOW, actor: ACTOR })
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    const row = own(f.raw, 3)
    assert.equal(row.receipt_number, '20260828-143000-2')
    assert.equal(row.legacy_receipt_number, '20260828-143000', 'the displaced supplied number is kept as the source key')
    console.log('PASS a supplied receipt number already held by another sale is re-minted and kept as legacy_receipt_number')
  })

  // 2b. A supplied number free at the probe but taken at the batch boundary
  //     is displaced the same way, with the supplied label kept as legacy.
  await scenario('2b', async () => {
    let injected = null
    const f = fixture({
      beforeBatch(db, statements) {
        if (injected) return
        injected = pendingReceipt(statements)
        if (injected) commitPeerSale(db, injected)
      },
    })
    await applyHistoricalSaleImport(f.route, { jobId: 'job-1', rowNumber: 7, data: saleData({ receipt_number: '20260828-150000' }), nowIso: NOW, actor: ACTOR })
    assert.equal(injected, '20260828-150000')
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    const row = own(f.raw, 7)
    assert.notEqual(row.receipt_number, '20260828-150000')
    assert.equal(row.legacy_receipt_number, '20260828-150000', 'the supplied number that lost the race is kept as the source key')
    console.log('PASS a supplied receipt number lost to a peer at the batch boundary is re-minted and kept as legacy')
  })

  // 3. Control: a free supplied business number is kept verbatim.
  await scenario(3, async () => {
    const f = fixture()
    await applyHistoricalSaleImport(f.route, { jobId: 'job-1', rowNumber: 4, data: saleData({ receipt_number: '20260828-143000' }), nowIso: NOW, actor: ACTOR })
    const row = own(f.raw, 4)
    assert.equal(row.receipt_number, '20260828-143000')
    assert.equal(row.legacy_receipt_number, null)
    console.log('PASS control: a free supplied business receipt number is stored as-is')
  })

  // 4. Bounded: a peer that wins every attempt ends in a clear receipt error
  //    with nothing written, and the row stays re-applicable.
  await scenario(4, async () => {
    let attempts = 0
    let losing = true
    const f = fixture({
      beforeBatch(db, statements) {
        if (!losing) return
        const receipt = pendingReceipt(statements)
        if (!receipt) return
        attempts += 1
        commitPeerSale(db, receipt)
      },
    })
    const input = { jobId: 'job-1', rowNumber: 5, data: saleData(), nowIso: NOW, actor: ACTOR }
    await assert.rejects(applyHistoricalSaleImport(f.route, input), /receipt number/i)
    assert.ok(attempts >= 2 && attempts <= 5, `retries are bounded (saw ${attempts} batch attempts)`)
    assert.equal(own(f.raw, 5), undefined)
    assert.equal(Number(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n), 0)
    assert.equal(f.raw.prepare("SELECT status FROM import_sales_commits WHERE job_id='job-1' AND group_key='row:5'").get(), undefined)
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    losing = false
    const again = await applyHistoricalSaleImport(f.route, input)
    assert.equal(again.alreadyApplied, false)
    assert.ok(own(f.raw, 5), 're-applying the row after the burst commits it')
    assert.deepEqual(duplicateReceiptGroups(f.raw), [])
    console.log(`PASS a receipt race lost on all ${attempts} attempts fails the row cleanly and leaves it re-applicable`)
  })

  // 5. Control: a genuine reference change is still reported as such, not
  //    retried as a receipt race.
  await scenario(5, async () => {
    let batches = 0
    const f = fixture({
      beforeBatch(db) {
        batches += 1
        db.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=20').run()
        db.prepare('UPDATE product_batches SET is_active=0 WHERE id=20').run()
      },
    })
    const error = await applyHistoricalSaleImport(f.route, { jobId: 'job-1', rowNumber: 6, data: saleData(), nowIso: NOW, actor: ACTOR })
      .then(() => null, (e) => e)
    assert.ok(error, 'a stale reference must fail the row')
    assert.match(String(error.message), /batch\/lot reference changed/)
    assert.equal(batches, 1, 'a non-receipt failure is not retried')
    console.log('PASS control: a stale batch/lot reference still fails as a reference change, without a receipt retry')
  })

  if (failures.length) {
    console.error(`RED: scenario(s) ${failures.join(', ')} failed`)
    process.exit(1)
  }
})().catch((error) => { console.error(error); process.exit(1) })
