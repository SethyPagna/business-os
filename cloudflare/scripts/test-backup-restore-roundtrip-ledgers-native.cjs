// Native (workerd D1) backup -> restore round trip on the full migration chain
// for the ledgers that decide stock math and idempotency: stock_mutation_receipts
// (0192), imported_sale_stock_skip_0235 and its guard, and
// sale_status_normalization_ledger (0263). Rows must survive byte-identically,
// and password_reset_requests (transient reset requests) must never reach a backup.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')

const COVERED = ['stock_mutation_receipts', 'imported_sale_stock_skip_0235', 'imported_sale_stock_skip_guard_0235', 'sale_status_normalization_ledger']
const SEED = [
  `INSERT INTO stock_mutation_receipts(id,actor_id,request_id,kind,request_json,written,response_status,response_json,created_at,completed_at)
     VALUES(41,7,'req-ខ្មែរ-1','adjust','{"lines":[{"p":1,"d":2.5}]}',1,200,'{"ok":true}','2026-10-01 01:02:03','2026-10-01 01:02:04'),
           (57,7,'req-2','receive','{"lines":[]}',0,NULL,NULL,'2026-10-02 00:00:00',NULL)`,
  `INSERT INTO imported_sale_stock_skip_0235(sale_id,client_request_id,receipt_number,sale_status,updated_at_before,stock_skipped_before,stock_skipped_at_before,stock_skipped_by_name_before,applied,applied_at)
     VALUES(901,'sales-import:job1:3','R-901','Completed','2026-09-01 00:00:00',0,NULL,NULL,1,'2026-10-03 00:00:00'),
           (902,'sales-import:job1:4',NULL,NULL,NULL,0,NULL,NULL,0,NULL)`,
  `INSERT INTO imported_sale_stock_skip_guard_0235(check_name,ok) VALUES('probe_check_a',1),('probe_check_b',1)`,
  `INSERT INTO sale_status_normalization_ledger(sale_id,sale_status_before,status_before_return_before,status_before_cancel_before,sale_status_after,status_before_cancel_after,return_state_after,loyalty_accrual_before,migrated_at)
     VALUES(801,'Returned','Completed',NULL,'Completed',NULL,'full',1,'2026-10-20 00:00:00'),(802,NULL,NULL,'Not Paid','Cancelled','Not Paid',NULL,NULL,'2026-10-20 00:00:01')`,
  `INSERT INTO password_reset_requests(user_id,request_ip,device_name) VALUES(1,'203.0.113.9','secret-device-must-not-leave')`,
]

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { createCloudflareBackup, restoreCloudflareBackup } from './src/lib/backup.ts';
    export default { async fetch(request, bindings) {
      const input = await request.json();
      const env = { ...bindings, BACKUP_QUEUE: undefined };
      if (input.mode === 'backup') {
        const result = await createCloudflareBackup(env, 'manual');
        return Response.json({ key: result.key, text: await (await bindings.ASSETS.get(result.key)).text() });
      }
      let error = null;
      try { await restoreCloudflareBackup(env, input.key, undefined, input.token) } catch (e) { error = e.message }
      return Response.json({ error });
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'] })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const dir = path.join(root, 'migrations')
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(name + ': ' + error.message) }
      }
    }
    for (const t of [...COVERED, 'password_reset_requests']) await db.prepare(`DELETE FROM ${t}`).run()
    for (const sql of SEED) await db.prepare(sql).run()
    const dump = async () => JSON.stringify(await Promise.all(COVERED.map(async (t) =>
      [t, (await db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()).results])))
    const call = async (input) => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }

    const before = await dump()
    const { key, text } = await call({ mode: 'backup' })
    const doc = JSON.parse(text)
    for (const t of COVERED) assert.ok(doc.tables[t], `${t} is in the backup`)
    assert.equal(doc.tables.stock_mutation_receipts.rows.length, 2)
    assert.ok(!('password_reset_requests' in doc.tables), 'password_reset_requests is not a backup table')
    assert.ok(!text.includes('secret-device-must-not-leave'), 'reset-request data never reaches the backup bytes')
    console.log('PASS backup carries the four ledgers and none of password_reset_requests')

    for (const t of COVERED) await db.prepare(`DELETE FROM ${t}`).run()
    await db.prepare("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(9,'live-only','adjust','{}')").run()
    await db.prepare("INSERT INTO sale_status_normalization_ledger(sale_id,sale_status_after) VALUES(1,'Completed')").run()
    assert.notEqual(await dump(), before)
    const token = 'roundtrip-token'
    const state = JSON.stringify({
      mode: 'restore', token, backupKey: key, phase: 'deleting', startedAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', startedBy: 'fixture',
    })
    await db.batch([
      db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
      db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").bind(state),
      db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
    ])
    const restored = await call({ mode: 'restore', key, token })
    assert.equal(restored.error, null, restored.error)
    assert.equal(await dump(), before, 'restored rows are byte-identical, ids included')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM password_reset_requests').first()).n, 1, 'restore leaves live reset requests alone')
    console.log('PASS restore returns every covered row byte-identically on the full migration chain')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
