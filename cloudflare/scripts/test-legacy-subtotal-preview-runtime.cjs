// Native Miniflare/workerd coverage for the fixed Sep 2-3 subtotal repair.
//
// This deliberately does not emulate D1 with better-sqlite3. It bundles the
// repository's helper and D1Compat adapter, executes them in workerd, and uses
// a real local D1 binding. The route-level pure suite owns permission and
// backup-failure branches; this suite is the native SQL/batch semantics gate.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const repoRoot = path.resolve(__dirname, '../..')
const cloudflareRoot = path.join(repoRoot, 'cloudflare')
const sourceHelper = path.join(cloudflareRoot, 'src/lib/legacySubtotalRepair.ts')

function findInstalledCloudflareRoot() {
  const configured = process.env.BUSINESS_OS_CLOUDFLARE_MODULE_ROOT
  const candidates = [
    configured && path.resolve(configured),
    cloudflareRoot,
    path.resolve(repoRoot, '../business-os-v1-integration/cloudflare'),
    path.resolve(repoRoot, '../business-os-v1/cloudflare'),
  ].filter(Boolean)
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'node_modules/miniflare/package.json')))
  if (!found) {
    throw new Error('Miniflare is not installed. Install the existing cloudflare dependencies or set BUSINESS_OS_CLOUDFLARE_MODULE_ROOT.')
  }
  return found
}

if (!fs.existsSync(sourceHelper) || !fs.readFileSync(sourceHelper, 'utf8').includes('previewLegacySubtotalRepair')) {
  throw new Error(`The checked-out helper does not contain previewLegacySubtotalRepair: ${sourceHelper}`)
}

const installedRoot = findInstalledCloudflareRoot()
const installedRequire = createRequire(path.join(installedRoot, 'package.json'))
const { Miniflare, Log, LogLevel } = installedRequire('miniflare')
const { build } = installedRequire('esbuild')

const ACTOR = Object.freeze({ id: 71, name: 'Native subtotal operator' })
const EXPECTED_IDS = Object.freeze(Array.from({ length: 22 }, (_, index) => 16842 + index))
const PROTECTED_TABLES = Object.freeze([
  'sale_items',
  'products',
  'branches',
  'product_batches',
  'branch_stock',
  'branch_batch_stock',
])

const SCHEMA_SQL = `
CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  receipt_number TEXT,
  cashier_id INTEGER,
  cashier_name TEXT,
  branch_id INTEGER,
  branch_name TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  payment_method TEXT DEFAULT 'Cash',
  payment_currency TEXT DEFAULT 'USD',
  exchange_rate REAL DEFAULT 4100,
  subtotal_usd REAL DEFAULT 0,
  subtotal_khr REAL DEFAULT 0,
  discount_usd REAL DEFAULT 0,
  discount_khr REAL DEFAULT 0,
  tax_usd REAL DEFAULT 0,
  tax_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  amount_paid_usd REAL DEFAULT 0,
  amount_paid_khr REAL DEFAULT 0,
  change_usd REAL DEFAULT 0,
  change_khr REAL DEFAULT 0,
  is_delivery INTEGER DEFAULT 0,
  delivery_contact_id INTEGER,
  delivery_contact_name TEXT,
  delivery_contact_phone TEXT,
  delivery_contact_address TEXT,
  delivery_fee_usd REAL DEFAULT 0,
  delivery_fee_khr REAL DEFAULT 0,
  delivery_fee_paid_by TEXT DEFAULT 'customer',
  delivery_actual_cost_usd REAL DEFAULT 0,
  delivery_actual_cost_khr REAL DEFAULT 0,
  sale_status TEXT DEFAULT 'completed',
  notes TEXT,
  items TEXT DEFAULT '[]',
  device_name TEXT,
  device_tz TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  customer_id INTEGER,
  membership_discount_usd REAL DEFAULT 0,
  membership_discount_khr REAL DEFAULT 0,
  membership_points_redeemed REAL DEFAULT 0,
  updated_at TEXT,
  client_request_id TEXT,
  payment_details TEXT,
  stock_skipped INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  sku TEXT,
  quantity REAL DEFAULT 1,
  unit TEXT,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  cost_price_usd REAL DEFAULT 0,
  cost_price_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  branch_id INTEGER,
  price_mode TEXT DEFAULT 'selling',
  product_discount_type TEXT,
  product_discount_label TEXT,
  product_discount_usd REAL DEFAULT 0,
  product_discount_khr REAL DEFAULT 0,
  manual_discount_type TEXT,
  manual_discount_value REAL DEFAULT 0,
  manual_discount_usd REAL DEFAULT 0,
  manual_discount_khr REAL DEFAULT 0
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  barcode TEXT,
  cost_price_usd REAL DEFAULT 0,
  cost_price_khr REAL DEFAULT 0,
  selling_price_usd REAL DEFAULT 0,
  stock_quantity REAL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT
);
CREATE TABLE product_batches (
  id INTEGER PRIMARY KEY,
  variant_product_id INTEGER NOT NULL,
  batch_key TEXT NOT NULL,
  lot_code TEXT,
  supplier_id INTEGER,
  supplier_name TEXT,
  unit_cost_usd REAL,
  received_quantity REAL,
  received_cost_usd REAL,
  notes TEXT,
  updated_at TEXT
);
CREATE TABLE branch_stock (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
  rfid_confirmed_qty REAL DEFAULT 0
);
CREATE TABLE branch_batch_stock (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sale_write_revisions (sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sale_bulk_guards (id INTEGER PRIMARY KEY, guard_value INTEGER NOT NULL CHECK(guard_value = 1));
CREATE TABLE action_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT DEFAULT 'global',
  entity TEXT,
  entity_id TEXT,
  label TEXT NOT NULL,
  reversible INTEGER DEFAULT 1,
  status TEXT DEFAULT 'undoable',
  undo_payload TEXT DEFAULT '{}',
  redo_payload TEXT DEFAULT '{}',
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  table_name TEXT,
  record_id TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER sale_revision_sales_update AFTER UPDATE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision)
  SELECT sale_id, 1 FROM (SELECT OLD.id AS sale_id UNION SELECT NEW.id) WHERE sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
`

function amountFor(id) {
  if (id === 16842) return '1454.0000'
  if (id <= 16858) return '1.0000'
  if (id === 16859) return '1988.0000'
  return '1.0000'
}

function discountFor(id) {
  if (id === 16842) return '61.0000'
  if (id === 16859) return '5.0000'
  return '0.0000'
}

function fresh22Fixture() {
  return EXPECTED_IDS.map((id) => {
    const sep3 = id <= 16858
    return {
      id,
      receiptNumber: `202609-${id}`,
      createdAt: sep3 ? '2026-09-02 18:00:00' : '2026-09-01 18:00:00',
      businessDate: sep3 ? '2026-09-03' : '2026-09-02',
      totalUsd: amountFor(id),
      itemDiscountUsd: discountFor(id),
    }
  })
}

async function bundleRuntime(tempDir) {
  const output = path.join(tempDir, 'subtotal-native-worker.mjs')
  const entry = `
    import { getDb } from './src/lib/db.ts'
    import {
      LegacySubtotalRepairConflictError,
      applyLegacySubtotalRepair,
      prepareLegacySubtotalRepair,
      previewLegacySubtotalRepair,
    } from './src/lib/legacySubtotalRepair.ts'

    const actor = ${JSON.stringify(ACTOR)}

    export default {
      async fetch(request, env) {
        const db = getDb(env)
        let batchChanges = null
        try {
          const pathname = new URL(request.url).pathname
          if (pathname === '/preview') {
            return Response.json(await previewLegacySubtotalRepair(db, actor))
          }
          if (pathname === '/apply' && request.method === 'POST') {
            const plan = await prepareLegacySubtotalRepair(await request.json(), actor)
            const nativeBatch = db.batch.bind(db)
            db.batch = async (statements) => {
              const results = await nativeBatch(statements)
              batchChanges = results.map((result) => result?.meta?.changes ?? result?.changes ?? null)
              return results
            }
            return Response.json(await applyLegacySubtotalRepair(db, plan))
          }
          return new Response('Not found', { status: 404 })
        } catch (error) {
          const status = error instanceof LegacySubtotalRepairConflictError ? 409 : 400
          return Response.json({ name: error?.name, error: error?.message || String(error), batchChanges }, { status })
        }
      },
    }
  `
  await build({
    stdin: {
      contents: entry,
      loader: 'ts',
      resolveDir: cloudflareRoot,
      sourcefile: 'test-legacy-subtotal-preview-runtime-entry.ts',
    },
    absWorkingDir: cloudflareRoot,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    outfile: output,
    platform: 'browser',
    target: 'es2022',
  })
  return output
}

async function createHarness(bundlePath) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: bundlePath,
    compatibilityDate: '2026-07-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    // D1 exec is line-oriented. Submit each controlled fixture DDL statement
    // whole; the repair helper's SQL is not split or interpreted here and is
    // executed later by the real D1 batch implementation.
    const schemaStatements = SCHEMA_SQL.trim().split(/;\s*\n(?=CREATE (?:TABLE|TRIGGER)\b)/)
    for (const statement of schemaStatements) await db.prepare(statement).run()
    await seedFixture(db)
    return { mf, db }
  } catch (error) {
    await mf.dispose()
    throw error
  }
}

async function seedFixture(db) {
  const statements = [
    db.prepare("INSERT INTO branches(id,name,location,is_default,is_active,updated_at) VALUES(1,'Shop','Phnom Penh',1,1,'2026-09-05 00:00:00')"),
    db.prepare("INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,selling_price_usd,stock_quantity,updated_at) VALUES(9001,'Protected serum','009001',3.125,0,9.5,17,'2026-09-05 00:00:00')"),
    db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,supplier_id,supplier_name,unit_cost_usd,received_quantity,received_cost_usd,notes,updated_at) VALUES(9001,9001,'protected-lot','LOT-9001',44,'Protected supplier',3.125,17,53.125,'untouched batch','2026-09-05 00:00:00')"),
    db.prepare('INSERT INTO branch_stock(id,product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(9001,9001,1,17,4)'),
    db.prepare("INSERT INTO branch_batch_stock(id,batch_id,branch_id,quantity,created_at,updated_at) VALUES(9001,9001,1,9,'2026-09-05 00:00:00','2026-09-05 00:00:00')"),
    db.prepare(`INSERT INTO sales(
      id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,customer_name,customer_phone,customer_address,
      payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
      total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,is_delivery,delivery_contact_id,
      delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_fee_usd,delivery_fee_khr,
      delivery_fee_paid_by,delivery_actual_cost_usd,delivery_actual_cost_khr,sale_status,notes,items,device_name,device_tz,
      created_at,customer_id,membership_discount_usd,membership_discount_khr,membership_points_redeemed,updated_at,
      client_request_id,payment_details,stock_skipped
    ) VALUES(
      16827,'outside-cohort',9,'Outside cashier',1,'Shop','Outside customer','012345678','Outside address',
      'Cash','USD',4100,777,0,0,0,0,0,777,0,777,0,0,0,0,NULL,NULL,NULL,NULL,0,0,'customer',0,0,
      'completed','outside cohort','[]','outside-device','Asia/Phnom_Penh','2026-09-01 17:00:00',NULL,0,0,0,NULL,
      'outside-request',NULL,0
    )`),
  ]

  const insertSale = `INSERT INTO sales(
    id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,customer_name,customer_phone,customer_address,
    payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,discount_usd,discount_khr,tax_usd,tax_khr,
    total_usd,total_khr,amount_paid_usd,amount_paid_khr,change_usd,change_khr,is_delivery,delivery_contact_id,
    delivery_contact_name,delivery_contact_phone,delivery_contact_address,delivery_fee_usd,delivery_fee_khr,
    delivery_fee_paid_by,delivery_actual_cost_usd,delivery_actual_cost_khr,sale_status,notes,items,device_name,device_tz,
    created_at,customer_id,membership_discount_usd,membership_discount_khr,membership_points_redeemed,updated_at,
    client_request_id,payment_details,stock_skipped
  ) VALUES(
    ?,?,4,'Legacy cashier',1,'Shop','Protected customer','099999999','Protected address',
    'Cash','USD',4100,0,0,0,0,0,0,?,0,?,0,0,0,0,NULL,NULL,NULL,NULL,0,0,'customer',0,0,
    'completed',?,'[]','legacy-import','Asia/Phnom_Penh',?,NULL,0,0,0,NULL,?,NULL,0
  )`
  const insertItem = `INSERT INTO sale_items(
    id,sale_id,product_id,product_name,sku,quantity,unit,applied_price_usd,applied_price_khr,cost_price_usd,cost_price_khr,
    total_usd,total_khr,branch_id,price_mode,product_discount_type,product_discount_label,product_discount_usd,
    product_discount_khr,manual_discount_type,manual_discount_value,manual_discount_usd,manual_discount_khr
  ) VALUES(?,?,9001,'Protected serum','SKU-9001',1,'pcs',?,0,3.125,0,?,0,1,'selling','amount','legacy discount',?,0,NULL,0,0,0)`

  for (const sale of fresh22Fixture()) {
    statements.push(db.prepare(insertSale).bind(
      sale.id,
      sale.receiptNumber,
      sale.totalUsd,
      sale.totalUsd,
      `legacy import ${sale.id}`,
      sale.createdAt,
      `legacy-${sale.id}`,
    ))
    statements.push(db.prepare(insertItem).bind(
      sale.id,
      sale.id,
      String(Number(sale.totalUsd) + Number(sale.itemDiscountUsd)),
      sale.totalUsd,
      sale.itemDiscountUsd,
    ))
  }
  await db.batch(statements)
  assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sale_write_revisions'), 0, 'fresh fixture must model all 22 production rows with null revisions')
}

async function scalar(db, sql, ...params) {
  const result = await db.prepare(sql).bind(...params).first()
  return result == null ? null : Object.values(result)[0]
}

async function rows(db, sql, ...params) {
  const result = await db.prepare(sql).bind(...params).all()
  return result.results || []
}

async function tableSnapshot(db, table) {
  return rows(db, `SELECT * FROM ${table} ORDER BY rowid`)
}

async function fullSnapshot(db) {
  const tables = [
    'sales', ...PROTECTED_TABLES, 'sale_write_revisions', 'action_history',
    'audit_logs', 'sale_bulk_guards', 'system_flags',
  ]
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await tableSnapshot(db, table)])))
}

async function protectedSnapshot(db) {
  const sales = (await tableSnapshot(db, 'sales')).map(({ subtotal_usd, ...protectedFields }) => protectedFields)
  const tables = Object.fromEntries(await Promise.all(PROTECTED_TABLES.map(async (table) => [table, await tableSnapshot(db, table)])))
  return { sales, ...tables }
}

async function requestJson(mf, pathname, init) {
  const response = await mf.dispatchFetch(`http://subtotal.test${pathname}`, init)
  const json = await response.json()
  return { status: response.status, json }
}

let passed = 0
async function check(name, run) {
  await run()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  // workerd on Windows requires the script to stay below its starting
  // directory; a sibling %TEMP% bundle can be rejected before startup.
  const tempDir = fs.mkdtempSync(path.join(cloudflareRoot, '.subtotal-native-'))
  let bundlePath
  try {
    bundlePath = await bundleRuntime(tempDir)

    await check('native preview reads the exact fresh 22-sale null-revision fixture without writing D1', async () => {
      const { mf, db } = await createHarness(bundlePath)
      try {
        const before = await fullSnapshot(db)
        const preview = await requestJson(mf, '/preview')
        assert.equal(preview.status, 200, JSON.stringify(preview.json))
        assert.equal(preview.json.state, 'ready')
        assert.deepEqual(preview.json.summary, {
          sale_count: 22,
          subtotal_usd: '3462.0000',
          item_discount_usd: '66.0000',
        })
        assert.deepEqual(preview.json.request.manifest.sales.map((sale) => sale.id), EXPECTED_IDS)
        assert.ok(preview.json.request.manifest.sales.every((sale) => sale.expected_revision === null))
        assert.deepEqual(preview.json.request.manifest.sales.map((sale) => ({
          id: sale.id,
          receipt_number: sale.receipt_number,
          business_date: sale.business_date,
          expected_subtotal_usd: sale.expected_subtotal_usd,
          target_subtotal_usd: sale.target_subtotal_usd,
          total_usd: sale.total_usd,
          amount_paid_usd: sale.amount_paid_usd,
          item_total_usd: sale.item_total_usd,
          item_discount_usd: sale.item_discount_usd,
          discount_usd: sale.discount_usd,
          tax_usd: sale.tax_usd,
          delivery_fee_usd: sale.delivery_fee_usd,
          exchange_rate: sale.exchange_rate,
          expected_revision: sale.expected_revision,
        })), fresh22Fixture().map((sale) => ({
          id: sale.id,
          receipt_number: sale.receiptNumber,
          business_date: sale.businessDate,
          expected_subtotal_usd: '0.0000',
          target_subtotal_usd: sale.totalUsd,
          total_usd: sale.totalUsd,
          amount_paid_usd: sale.totalUsd,
          item_total_usd: sale.totalUsd,
          item_discount_usd: sale.itemDiscountUsd,
          discount_usd: '0.0000',
          tax_usd: '0.0000',
          delivery_fee_usd: '0.0000',
          exchange_rate: '4100.0000',
          expected_revision: null,
        })))
        assert.equal(preview.json.request.manifest.sales.reduce((sum, sale) => sum + Number(sale.total_usd), 0), 3462)
        assert.equal(preview.json.request.manifest.sales.reduce((sum, sale) => sum + Number(sale.item_discount_usd), 0), 66)
        assert.deepEqual(await fullSnapshot(db), before)
      } finally {
        await mf.dispose()
      }
    })

    await check('native exact-22 apply changes subtotal only and records one revision, audit and history', async () => {
      const { mf, db } = await createHarness(bundlePath)
      try {
        const preview = await requestJson(mf, '/preview')
        assert.equal(preview.status, 200, JSON.stringify(preview.json))
        const beforeProtected = await protectedSnapshot(db)
        const applied = await requestJson(mf, '/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preview.json.request),
        })
        const applyDiagnostic = applied.status === 200 ? applied.json : {
          response: applied.json,
          repaired_subtotal_count: await scalar(db, 'SELECT COUNT(*) FROM sales WHERE id BETWEEN 16842 AND 16863 AND subtotal_usd<>0'),
          revision_one_count: await scalar(db, 'SELECT COUNT(*) FROM sale_write_revisions WHERE revision=1'),
          repair_history_count: await scalar(db, "SELECT COUNT(*) FROM action_history WHERE entity='sep23_subtotal_repair'"),
          repair_audit_count: await scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='repair_subtotal_usd'"),
        }
        assert.equal(applied.status, 200, JSON.stringify(applyDiagnostic))
        assert.deepEqual(applied.json, { outcome: 'applied', changedSales: 22 })

        const repaired = await rows(db, `
          SELECT id, printf('%.4f',subtotal_usd) AS subtotal_usd
          FROM sales WHERE id BETWEEN 16842 AND 16863 ORDER BY id
        `)
        assert.deepEqual(repaired, fresh22Fixture().map((sale) => ({ id: sale.id, subtotal_usd: sale.totalUsd })))
        assert.equal(await scalar(db, "SELECT printf('%.4f',SUM(subtotal_usd)) FROM sales WHERE id BETWEEN 16842 AND 16863"), '3462.0000')
        assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sale_write_revisions WHERE revision=1'), 22)
        assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sale_write_revisions WHERE revision<>1'), 0)
        assert.equal(await scalar(db, "SELECT COUNT(*) FROM action_history WHERE entity='sep23_subtotal_repair' AND reversible=0 AND status='recorded'"), 1)
        assert.equal(await scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='repair_subtotal_usd' AND entity='sale'"), 1)
        assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sale_bulk_guards'), 0)
        assert.equal(await scalar(db, 'SELECT subtotal_usd FROM sales WHERE id=16827'), 777)
        assert.deepEqual(await protectedSnapshot(db), beforeProtected)

        const beforeReplay = await fullSnapshot(db)
        const replay = await requestJson(mf, '/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preview.json.request),
        })
        assert.equal(replay.status, 200, JSON.stringify(replay.json))
        assert.deepEqual(replay.json, { outcome: 'already_applied', changedSales: 0 })
        assert.deepEqual(await fullSnapshot(db), beforeReplay)
      } finally {
        await mf.dispose()
      }
    })

    await check('native stale snapshot rejects the whole batch without partial subtotal, revision, audit or history writes', async () => {
      const { mf, db } = await createHarness(bundlePath)
      try {
        const preview = await requestJson(mf, '/preview')
        assert.equal(preview.status, 200, JSON.stringify(preview.json))
        await db.prepare("UPDATE sales SET notes='concurrent protected edit' WHERE id=16842").run()
        const before = await fullSnapshot(db)
        const stale = await requestJson(mf, '/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preview.json.request),
        })
        assert.equal(stale.status, 409, JSON.stringify(stale.json))
        assert.equal(stale.json.name, 'LegacySubtotalRepairConflictError')
        assert.deepEqual(await fullSnapshot(db), before)
        assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sales WHERE id BETWEEN 16842 AND 16863 AND subtotal_usd<>0'), 0)
        assert.equal(await scalar(db, "SELECT COUNT(*) FROM action_history WHERE entity='sep23_subtotal_repair'"), 0)
        assert.equal(await scalar(db, "SELECT COUNT(*) FROM audit_logs WHERE action='repair_subtotal_usd'"), 0)
        assert.equal(await scalar(db, 'SELECT COUNT(*) FROM sale_bulk_guards'), 0)
      } finally {
        await mf.dispose()
      }
    })

    console.log(`\n${passed} native Miniflare/workerd D1 checks passed.`)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
