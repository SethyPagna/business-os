// Actual workerd/D1 transactions and production import/bulk consumers.
// No remote database, deployment, or production state is touched.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')

async function main() {
  const bundle = await build({ stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'ts', contents: `
    import { beginMaintenance, endMaintenance } from './src/lib/maintenance.ts';
    import { getImportFencedDb, isImportMaintenanceFenceError } from './src/lib/importMaintenanceFence.ts';
    import { runImportAnalyze, runImportApply, runD1BatchInChunks } from './src/lib/importEngine.ts';
    import { ensureUnifiedStockProduct, applyUnifiedStockAdd } from './src/lib/stockActionCommit.ts';
    import { withCanonicalImportBranchWriteGuard } from './src/lib/importBranchAuthority.ts';
    import { createBulkDeleteJob, runBulkDeleteJob, reapStalledBulkDeleteJobs } from './src/lib/bulkDeleteEngine.ts';
    import { registerInlineImportRunner } from './src/lib/queueDispatch.ts';
    registerInlineImportRunner(async () => {});
    const product = { jobId: 'job-1', identityKey: 'serum', productName: 'Serum' };
    const stockAdd = { jobId: 'job-1', rowNumber: 2, productId: 1, productName: 'Serum',
      branchId: 1, branchName: 'Shop', quantity: 2, date: '08/27/2026', batchLabel: 'LOT A',
      sellingPriceUsd: 12.345, wholesalePriceUsd: 10, costPriceUsd: 5, supplierName: 'Bong Long' };
    async function outcome(operation) {
      try { return { ok: true, value: await operation() }; }
      catch (error) { return { ok: false, code: error?.code || null, message: String(error?.message || error) }; }
    }
    async function releaseBeforeCatch(env, operation, insertBeforeBatch = 0) {
      const raw = env.DB;
      let batches = 0;
      const intercepted = new Proxy(raw, { get(target, key) {
        if (key === 'batch') return async (statements) => {
          batches++;
          if (batches === insertBeforeBatch) {
            await target.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{}')").run();
          }
          try { return await target.batch(statements); }
          catch (error) {
            await target.prepare("DELETE FROM system_flags WHERE key='maintenance'").run();
            throw error;
          }
        };
        const member = target[key];
        return typeof member === 'function' ? member.bind(target) : member;
      }});
      return { ...await outcome(() => operation({ ...env, DB: intercepted })), batches };
    }
    export default { async fetch(request, env) {
      const { mode } = await request.json();
      if (mode === 'begin') return Response.json(await outcome(() => beginMaintenance(env, { backupKey: 'test', startedBy: 'admin' })));
      if (mode === 'end') return Response.json(await outcome(async () => {
        const row = await env.DB.prepare("SELECT value FROM system_flags WHERE key='maintenance'").first();
        return row ? endMaintenance(env, JSON.parse(row.value).token) : true;
      }));
      if (mode === 'analyze') return Response.json(await outcome(() => runImportAnalyze(env, 'job-1')));
      if (mode === 'analyze-release-race') return Response.json(await releaseBeforeCatch(env, (racedEnv) => runImportAnalyze(racedEnv, 'job-1')));
      if (mode === 'apply') return Response.json(await outcome(() => runImportApply(env, 'job-1')));
      if (mode === 'bulk-create') return Response.json(await outcome(() => createBulkDeleteJob(env, 'products', [1], 'test', { id: 1, name: 'admin' })));
      if (mode === 'bulk-run') return Response.json(await outcome(() => runBulkDeleteJob(env, 'bulk-1')));
      if (mode === 'bulk-release-race') return Response.json(await releaseBeforeCatch(env, (racedEnv) => runBulkDeleteJob(racedEnv, 'bulk-1')));
      if (mode === 'bulk-mid-race') return Response.json(await releaseBeforeCatch(env, (racedEnv) => runBulkDeleteJob(racedEnv, 'bulk-1'), 2));
      if (mode === 'bulk-reap') return Response.json(await outcome(() => reapStalledBulkDeleteJobs(env)));
      if (mode === 'product') return Response.json(await outcome(async () => ensureUnifiedStockProduct(await getImportFencedDb(env), product)));
      if (mode === 'stock-add') return Response.json(await outcome(async () => applyUnifiedStockAdd(await getImportFencedDb(env), stockAdd)));
      if (mode === 'chunk') return Response.json(await outcome(async () => {
        await runD1BatchInChunks(await getImportFencedDb(env), [{ sql: 'INSERT OR IGNORE INTO effects(id) VALUES(@id)', params: { id: 'same-request' } }]);
        return true;
      }));
      if (mode === 'once') return Response.json(await outcome(async () => {
        await (await getImportFencedDb(env)).batchOnce([{ sql: 'INSERT OR IGNORE INTO effects(id) VALUES(@id)', params: { id: 'once-request' } }]);
        return true;
      }));
      if (mode === 'branch-once') return Response.json(await outcome(async () => {
        await withCanonicalImportBranchWriteGuard(await getImportFencedDb(env), [1]).batchOnce([
          { sql: 'INSERT OR IGNORE INTO effects(id) VALUES(@id)', params: { id: 'branch-request' } },
        ]);
        return true;
      }));
      throw new Error('Unknown mode');
    }};
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', d1Databases: ['DB', 'IMPORT_DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const staging = await mf.getD1Database('IMPORT_DB')
    await db.prepare('CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)').run()
    await db.prepare(`CREATE TABLE import_jobs(id TEXT PRIMARY KEY,status TEXT,cancel_requested INTEGER DEFAULT 0,
      started_at TEXT,lease_token TEXT,lease_expires_at TEXT,updated_at TEXT)`).run()
    await db.prepare(`CREATE TABLE bulk_delete_jobs(id TEXT PRIMARY KEY,entity_type TEXT,status TEXT,reason TEXT,
      ids_json TEXT,total_count INTEGER,processed_count INTEGER DEFAULT 0,failed_count INTEGER DEFAULT 0,
      failed_ids_json TEXT DEFAULT '[]',cancel_requested INTEGER DEFAULT 0,last_error TEXT,
      created_by_id INTEGER,created_by_name TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,started_at TEXT,finished_at TEXT)`).run()
    await db.prepare('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,name_normalized TEXT,barcode TEXT,unit TEXT,selling_price_usd REAL,wholesale_price_usd REAL,cost_price_usd REAL,cost_price_khr REAL,purchase_price_usd REAL,purchase_price_khr REAL,stock_quantity REAL,is_active INTEGER,client_request_id TEXT UNIQUE,created_at TEXT,updated_at TEXT)').run()
    await db.prepare('CREATE TABLE branches(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER)').run()
    await db.prepare('CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL,UNIQUE(product_id,branch_id))').run()
    await db.prepare(`CREATE TABLE product_batches(id INTEGER PRIMARY KEY AUTOINCREMENT,variant_product_id INTEGER,
      batch_key TEXT,lot_code TEXT,received_at TEXT,is_active INTEGER,notes TEXT,batch_number INTEGER,
      supplier_id INTEGER,supplier_name TEXT,unit_cost_usd REAL,payment_status TEXT,credit_due_date TEXT,
      received_quantity REAL,received_branch_id INTEGER,received_cost_usd REAL,
      UNIQUE(variant_product_id,batch_key),UNIQUE(variant_product_id,batch_number))`).run()
    await db.prepare('CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,updated_at TEXT,UNIQUE(batch_id,branch_id))').run()
    await db.prepare(`CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER,
      product_name TEXT,branch_id INTEGER,branch_name TEXT,movement_type TEXT,quantity REAL,
      unit_cost_usd REAL DEFAULT 0,total_cost_usd REAL DEFAULT 0,reason TEXT,reference_id INTEGER,
      created_at TEXT,batch_id INTEGER)`).run()
    await db.prepare(`CREATE TABLE product_cost_entries(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,
      cost_usd REAL NOT NULL,cost_khr REAL,source TEXT NOT NULL,user_id INTEGER,user_name TEXT,
      baseline_batch_id INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
    await db.prepare(`CREATE TABLE import_stock_action_commits(job_id TEXT NOT NULL,action_key TEXT NOT NULL,
      row_number INTEGER,action_kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,applied_at TEXT,PRIMARY KEY(job_id,action_key))`).run()
    await db.prepare('CREATE TABLE effects(id TEXT PRIMARY KEY)').run()
    await staging.prepare('CREATE TABLE import_job_rows(id INTEGER PRIMARY KEY,job_id TEXT)').run()
    await db.prepare("INSERT INTO branches VALUES(1,'Shop',1)").run()
    await db.prepare("INSERT INTO import_jobs(id,status,updated_at) VALUES('job-1','failed',CURRENT_TIMESTAMP)").run()
    const call = async mode => {
      const response = await mf.dispatchFetch('http://local.test', { method: 'POST', body: JSON.stringify({ mode }) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const held = await call('begin')
    assert.equal(held.ok, true)
    for (const mode of ['analyze', 'apply', 'bulk-create', 'product', 'chunk', 'once', 'branch-once']) {
      const denied = await call(mode)
      assert.equal(denied.code, 'import_maintenance_active', mode)
    }
    const importReleaseRace = await call('analyze-release-race')
    assert.equal(importReleaseRace.code, 'import_maintenance_active', 'release before catch retains maintenance identity')
    assert.equal(importReleaseRace.batches, 1, 'deterministic maintenance guard must not retry D1 batch')
    assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind('job-1').first()).status, 'failed')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM system_flags WHERE key=?').bind('maintenance').first()).n, 0)
    await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify(held.value)).run()
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM effects').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM bulk_delete_jobs').first()).n, 0)
    assert.equal((await staging.prepare('SELECT COUNT(*) AS n FROM import_job_rows').first()).n, 0)
    assert.equal((await db.prepare('SELECT status FROM import_jobs WHERE id=?').bind('job-1').first()).status, 'failed')
    // IMPORT_DB cannot share main-D1's transaction. Even an externally
    // stranded staging row is not authority to resume business effects.
    await staging.prepare("INSERT INTO import_job_rows(job_id) VALUES('job-1')").run()
    assert.equal((await call('apply')).code, 'import_maintenance_active')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n, 0)
    await staging.prepare('DELETE FROM import_job_rows').run()
    assert.equal((await call('end')).value, true)
    const created = await call('product')
    const retry = await call('product')
    assert.equal(created.value.created, true)
    assert.equal(retry.value.created, false)
    assert.equal(created.value.productId, retry.value.productId)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM products').first()).n, 1)
    await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify(held.value)).run()
    assert.equal((await call('stock-add')).code, 'import_maintenance_active', 'actual stock add transaction fenced')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM import_stock_action_commits').first()).n, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').first()).n, 0)
    await db.prepare('DELETE FROM system_flags').run()
    const firstAdd = await call('stock-add')
    assert.equal(firstAdd.ok, true, JSON.stringify(firstAdd))
    assert.equal(firstAdd.value.alreadyApplied, false)
    assert.equal((await call('stock-add')).value.alreadyApplied, true)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM import_stock_action_commits').first()).n, 1)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').first()).n, 1)
    assert.equal((await call('chunk')).ok, true)
    assert.equal((await call('chunk')).ok, true)
    assert.equal((await call('once')).ok, true)
    assert.equal((await call('once')).ok, true)
    assert.equal((await call('branch-once')).ok, true)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM effects').first()).n, 3)
    await db.prepare("UPDATE branches SET name='Other' WHERE id=1").run()
    const branchDenied = await call('branch-once')
    assert.equal(branchDenied.ok, false, 'canonical branch batchOnce still enforces branch guard')
    assert.notEqual(branchDenied.code, 'import_maintenance_active', 'unrelated integer overflow remains a branch error')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM effects').first()).n, 3)
    // An unexpired lease blocks restore even when status is 'failed'.
    await db.prepare("UPDATE import_jobs SET lease_token='held',lease_expires_at='2099-01-01T00:00:00.000Z'").run()
    assert.equal((await call('begin')).ok, false)
    await db.prepare('UPDATE import_jobs SET lease_token=NULL').run()
    assert.equal((await call('begin')).ok, false, 'future expiry alone conservatively blocks restore')
    await db.prepare('UPDATE import_jobs SET lease_expires_at=NULL').run()
    await db.prepare("UPDATE import_jobs SET status='queued' WHERE id='job-1'").run()
    assert.equal((await call('begin')).ok, false, 'queued import admission must block restore')
    await db.prepare("UPDATE import_jobs SET status='failed' WHERE id='job-1'").run()
    await db.prepare("INSERT INTO bulk_delete_jobs(id,entity_type,status,reason,ids_json,total_count) VALUES('bulk-1','products','pending','test','[1]',1)").run()
    assert.equal((await call('begin')).ok, false, 'pending bulk queue work must block restore')
    // Forced/corrupt external maintenance cannot make a queued bulk runner
    // advance status or cursor, even though the bulk row already exists.
    await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify(held.value)).run()
    assert.equal((await call('bulk-run')).code, 'import_maintenance_active')
    const bulkReleaseRace = await call('bulk-release-race')
    assert.equal(bulkReleaseRace.code, 'import_maintenance_active', 'bulk failure must not be misclassified after release')
    assert.equal(bulkReleaseRace.batches, 1, 'bulk guard must not retry D1 batch')
    const bulkMidRace = await call('bulk-mid-race')
    assert.equal(bulkMidRace.code, 'import_maintenance_active', 'mid-chunk maintenance must remain retryable after release')
    assert.equal(bulkMidRace.batches, 2, 'bulk runner must not retry a fenced delete chunk')
    const afterMidRace = await db.prepare("SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id='bulk-1'").first()
    assert.deepEqual([afterMidRace.status, afterMidRace.processed_count, afterMidRace.failed_count], ['processing', 0, 0])
    await db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(JSON.stringify(held.value)).run()
    await db.prepare("UPDATE bulk_delete_jobs SET updated_at='2000-01-01 00:00:00' WHERE id='bulk-1'").run()
    assert.equal((await call('bulk-reap')).ok, true)
    const bulk = await db.prepare("SELECT status,processed_count,failed_count FROM bulk_delete_jobs WHERE id='bulk-1'").first()
    assert.deepEqual([bulk.status, bulk.processed_count, bulk.failed_count], ['processing', 0, 0])
    await db.prepare('DELETE FROM bulk_delete_jobs').run()
    await db.prepare('DELETE FROM system_flags').run()
    const raced = await Promise.all([call('begin'), call('bulk-create')])
    assert.equal(raced.filter(result => result.ok).length, 1, 'exactly one native D1 admission wins')
    if (raced[0].ok) assert.equal(raced[1].code, 'import_maintenance_active')
    else assert.equal(raced[0].ok, false, 'active bulk job refuses restore')
    console.log('PASS native D1 import lease, stock create/add, generic chunk, batchOnce+branch guard, bulk admission/run/reaper, same-id retry, split IMPORT_DB staging')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
