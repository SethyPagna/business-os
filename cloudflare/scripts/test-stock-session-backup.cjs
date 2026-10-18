const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')
const { payload, state, createRequest } = require('./test-stock-session-undo.cjs')
const backup = loadStockSession('lib/backup.ts')

function document(f, tables = backup.BACKUP_TABLES) {
  return JSON.stringify({ format: 'business-os-cloudflare-backup', formatVersion: 1, tables: Object.fromEntries(tables
    .filter(t => f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))
    .map(t => [t, { columns: f.sql.pragma(`table_info(${t})`).map(c => c.name), rows: f.sql.prepare(`SELECT * FROM ${t}`).all() }])),
    r2: { assets: [], copiedKeys: [] }, summary: { schemaMigration: '0125_return_bulk_actions.sql' } })
}
function restoreEnv(f, text) {
  const etag = require('node:crypto').createHash('sha256').update(text).digest('hex')
  return { ...f.env, ASSETS: { async get(key, options) {
    if (!key.endsWith('fixture.json')) return null
    const metadata = { key, etag, version: 'fixture-upload', size: Buffer.byteLength(text) }
    if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== etag) return metadata
    return { ...metadata, body: new Blob([text]).stream(), customMetadata: { format: 'business-os-cloudflare-backup' } }
  } } }
}
const maintenance = loadStockSession('lib/maintenance.ts')
const { executeRawStockTransaction } = loadStockSession('lib/stockTransaction.ts')

function restoreState(f) {
  return JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => [name, f.sql.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]))
}

async function restoreOwned(f, text) {
  const env = restoreEnv(f, text)
  const ownership = await maintenance.beginMaintenance(env, { backupKey: 'fixture.json', startedBy: 'session restore fixture' })
  const before = restoreState(f)
  let progressed = 0
  for (const token of [undefined, 'different-restore-owner']) {
    await assert.rejects(backup.restoreCloudflareBackup(env, 'fixture.json', async () => { progressed++ }, token),
      error => error.name === 'MaintenanceAdmissionConflictError')
    assert.equal(restoreState(f), before)
    assert.equal(progressed, 0)
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='maintenance'").get().n, 1)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  await backup.restoreCloudflareBackup(env, 'fixture.json', undefined, ownership.token)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  assert.equal(await maintenance.endMaintenance(env, ownership.token), true)
}

async function main() {
  const api = loadStockSession()
  for (const undoFirst of [false, true]) {
    const f = fixture()
    // Retained tombstone with no live row must not be garbage-collected.
    f.sql.exec("INSERT INTO stock_session_revisions VALUES('product','987654',42)")
    const r = await api.commitStockSession(f.env, user, createRequest())
    if (undoFirst) await api.replayStockSession(f.env, user, 'undo', r.actionHistoryId, 0, payload(f, r))
    const saved = state(f)
    const doc = document(f)
    await api.commitStockSession(f.env, user, receiveRequest('later-receipt-1', 8))
    await restoreOwned(f, doc)
    assert.deepEqual(state(f), saved, 'full restore preserves exact receipts/snapshots/revisions')
    assert.equal(f.sql.pragma('foreign_key_check').length, 0)
    await api.replayStockSession(f.env, user, undoFirst ? 'redo' : 'undo', r.actionHistoryId, undoFirst ? 1 : 0, payload(f, r))
    assert.equal(f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='987654'").get().revision, 42)
    console.log(`PASS FK-on full backup restores ${undoFirst ? 'redoable' : 'undoable'} session and retained revisions; replay remains valid`)
  }
  {
    const f = fixture()
    await api.commitStockSession(f.env, user, createRequest())
    const saved = state(f)
    await restoreOwned(f, document(f, ['settings']))
    assert.deepEqual(state(f), saved)
    const omissions = ['stock_session_revisions', 'stock_session_members', 'stock_session_operations', 'undo_snapshots', 'return_write_revisions', 'sale_bulk_members', 'file_assets', 'suppliers']
    for (const omitted of omissions) {
      let progressed = false
      await assert.rejects(backup.restoreCloudflareBackup(restoreEnv(f, document(f, backup.BACKUP_TABLES.filter(t => t !== omitted))), 'fixture.json', async () => { progressed = true }), /missing dependency/)
      assert.equal(progressed, false)
      assert.deepEqual(state(f), saved)
    }
    await assert.rejects(backup.restoreCloudflareBackup(restoreEnv(f, document(f, [...backup.BACKUP_TABLES].reverse())), 'fixture.json'), /dependency order/)
    assert.deepEqual(state(f), saved)
    await assert.rejects(backup.restoreCloudflareBackup(restoreEnv(f, document(f)), 'fixture.json'), error => error.name === 'MaintenanceAdmissionConflictError')
    assert.deepEqual(state(f), saved)
    console.log('PASS settings-scoped restore leaves stock intact; dependency gaps/order/maintenance refuse before mutation')
  }
  {
    const f = fixture()
    await api.commitStockSession(f.env, user, createRequest())
    const { PRODUCTS_RESET_TABLES } = loadStockSession('lib/coreDataInvariants.ts')
    const revision = f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='1'").get().revision
    const resetStatements = PRODUCTS_RESET_TABLES.flatMap(table => [
      ...(table === 'products' ? [f.env.DB.prepare('UPDATE products SET stock_quantity=0')] : []),
      f.env.DB.prepare(`DELETE FROM ${table}`),
    ])
    await executeRawStockTransaction(f.env.DB, resetStatements)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n, 0)
    assert(f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='1'").get().revision > revision)
    assert.equal(f.sql.pragma('foreign_key_check').length, 0)
    console.log('PASS product reset deletes stock receipt children first and retains revision tombstones')
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
