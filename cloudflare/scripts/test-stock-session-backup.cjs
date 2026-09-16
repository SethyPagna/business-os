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
  return { ...f.env, ASSETS: { async get(key) {
    if (!key.endsWith('fixture.json')) return null
    return { body: new Blob([text]).stream(), customMetadata: { format: 'business-os-cloudflare-backup' } }
  } } }
}
const maintenance = f => f.sql.exec(`INSERT OR REPLACE INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
const open = f => f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")

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
    maintenance(f)
    await backup.restoreCloudflareBackup(restoreEnv(f, doc), 'fixture.json')
    open(f)
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
    await backup.restoreCloudflareBackup(restoreEnv(f, document(f, ['settings'])), 'fixture.json')
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
    await assert.rejects(backup.restoreCloudflareBackup(restoreEnv(f, document(f)), 'fixture.json'), /maintenance mode/)
    assert.deepEqual(state(f), saved)
    console.log('PASS settings-scoped restore leaves stock intact; dependency gaps/order/maintenance refuse before mutation')
  }
  {
    const f = fixture()
    await api.commitStockSession(f.env, user, createRequest())
    const { PRODUCTS_RESET_TABLES } = loadStockSession('lib/coreDataInvariants.ts')
    const revision = f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='1'").get().revision
    for (const table of PRODUCTS_RESET_TABLES) f.sql.exec(`DELETE FROM ${table}`)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_session_operations').get().n, 0)
    assert(f.sql.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='1'").get().revision > revision)
    assert.equal(f.sql.pragma('foreign_key_check').length, 0)
    console.log('PASS product reset deletes stock receipt children first and retains revision tombstones')
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
