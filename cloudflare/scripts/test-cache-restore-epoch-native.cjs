'use strict'
// CACHE-LIFECYCLE T-CL4 (a), lane 6.0.1048: an in-app restore (and a forced maintenance clear) moves the data epoch BEFORE it releases the
// maintenance hold, and refuses to release when it cannot. The epoch is part of every server cache key, so everything stored before the
// restore becomes unreachable even when the version tokens come back equal (a failed or lost bump, KV lag).
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1, through POST /api/backups and
// POST /api/backups/maintenance/clear. One probe trigger on the D1 records, at every rotation of the epoch, the new value, whether the
// maintenance hold is set at that moment, and how many products exist (S1 has two, the restored S0 has one):
//   rotation 1   hold set, 2 products   the epoch moves before anything is deleted (entry)
//   rotation 2   hold set, 1 product    the epoch moves again after the data is restored and BEFORE the hold is released
//   nothing after: the last rotation is the final epoch, so nothing rotated it once reads were admitted again.
// (No trigger sits on the maintenance flag itself: the admission and release code count the rows its statement changed.)
//
// Positive control, same run: with the epoch put back to its pre-restore value and the version tokens put back too, the pre-restore
// cached body IS served again. If that does not reproduce, the assertions above it prove nothing and the test fails.
//
// Run (from cloudflare/): node scripts/test-cache-restore-epoch-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const epochOf = async (world) => (await world.first("SELECT value FROM system_flags WHERE key = 'data_epoch'"))?.value
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MEMO_MS = 15500

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  const cacheState = (response) => (/cache;desc="(\w+)"/.exec(response.headers.get('server-timing') || '') || [])[1]
  const heldNow = async () => !!(await world.first("SELECT value FROM system_flags WHERE key = 'maintenance'"))
  const filters = () => world.api('GET', '/api/products/filters')
  const names = async () => (await world.query("SELECT name FROM products WHERE name LIKE 'EpochProbe %' ORDER BY name")).map((row) => row.name)
  const kv = await world.mf.getKVNamespace('CACHE')
  const snapshotVersions = async () => ({
    kv: await Promise.all((await kv.list()).keys.map(async ({ name }) => [name, await kv.get(name)])),
    d1: await world.query('SELECT namespace, version, updated_at FROM cache_versions'),
  })
  const putVersionsBack = async (snapshot) => {
    for (const { name } of (await kv.list()).keys) await kv.delete(name)
    for (const [name, value] of snapshot.kv) if (value != null) await kv.put(name, value)
    await world.run('DELETE FROM cache_versions')
    for (const row of snapshot.d1) await world.run('INSERT INTO cache_versions (namespace, version, updated_at) VALUES (?, ?, ?)', row.namespace, row.version, row.updated_at)
  }
  const rotations = async () => world.query('SELECT epoch, held, products FROM epoch_probe ORDER BY id')

  try {
    await world.run('CREATE TABLE epoch_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, epoch TEXT NOT NULL, held INTEGER NOT NULL, products INTEGER NOT NULL)')
    await world.run(`CREATE TRIGGER epoch_probe_rotation AFTER UPDATE ON system_flags WHEN NEW.key = 'data_epoch'
      BEGIN INSERT INTO epoch_probe (epoch, held, products)
        SELECT NEW.value, EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance'), (SELECT COUNT(*) FROM products); END`)

    const before = await world.api('POST', '/api/products', { name: 'EpochProbe Before', barcode: '8800000000011', category: 'EpochCategoryBefore' })
    const exported = await world.api('POST', '/api/backups', { type: 'export-cloudflare' })
    const backupName = exported.json && exported.json.item && exported.json.item.result && exported.json.item.result.packageId
    const after = await world.api('POST', '/api/products', { name: 'EpochProbe After', barcode: '8800000000028', category: 'EpochCategoryAfter' })
    const epochBeforeRestore = await epochOf(world)

    await check('fixture: a backup was taken between two products, the epoch exists and the shape is cached', async (t) => {
      t.ok('first product created', before.status === 200 || before.status === 201, before.text)
      t.ok('second product created', after.status === 200 || after.status === 201, after.text)
      t.ok('backup name', typeof backupName === 'string' && backupName.length > 0, backupName)
      t.eq('both products exist', await names(), ['EpochProbe After', 'EpochProbe Before'])
      t.ok('the database has a 32-hex epoch (migration 0288)', /^[0-9a-f]{32}$/.test(epochBeforeRestore || ''), epochBeforeRestore)
    })

    // S1 warmed under the pre-restore epoch and pre-restore version tokens.
    const warm = await filters()
    const warmAgain = await filters()
    const staleBody = JSON.stringify(warm.json)
    await check('the filters vocabulary is cached at S1 and shows the later product', async (t) => {
      t.eq('status', warm.status, 200)
      t.ok('it names the S1-only category', staleBody.includes('EpochCategoryAfter'), staleBody.slice(0, 200))
      t.eq('the second read is a hit', cacheState(warmAgain), 'hit')
    })
    const versionsAtS1 = await snapshotVersions()

    await check('the restore rotates the epoch before it deletes anything and again before it releases the hold, and nothing rotates it after', async (t) => {
      const response = await world.api('POST', '/api/backups', { type: 'import-folder', sourceDir: backupName, currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('the later product is gone', await names(), ['EpochProbe Before'])
      t.eq('maintenance released', await heldNow(), false)
      const seen = await rotations()
      const final = await epochOf(world)
      t.eq('exactly two rotations', seen.length, 2)
      t.eq('rotation 1: under the hold, before anything was deleted (S1 still has both products)', [seen[0]?.held, seen[0]?.products], [1, 2])
      t.eq('rotation 2: under the hold, after the data was restored (one product), before the release', [seen[1]?.held, seen[1]?.products], [1, 1])
      t.ok('the two rotations and the old epoch are three different values', new Set([epochBeforeRestore, seen[0]?.epoch, seen[1]?.epoch]).size === 3, [epochBeforeRestore, seen[0]?.epoch, seen[1]?.epoch])
      t.eq('the last rotation is the final epoch (nothing rotated it after the release)', seen[1]?.epoch, final)
    })

    await check('with the version tokens put back (a lost bump), the pre-restore entry is still unreachable and the answer is the restored one', async (t) => {
      await putVersionsBack(versionsAtS1)
      const response = await filters()
      t.eq('status', response.status, 200)
      t.eq('a miss, not the entry stored before the restore', cacheState(response), 'miss')
      t.ok('the restored vocabulary has no S1-only category', !JSON.stringify(response.json).includes('EpochCategoryAfter'), JSON.stringify(response.json).slice(0, 200))
      t.ok('it has the S0 category', JSON.stringify(response.json).includes('EpochCategoryBefore'), JSON.stringify(response.json).slice(0, 200))
    })

    await check('POSITIVE CONTROL: with the epoch AND the version tokens back at their pre-restore values the pre-restore body IS served again', async (t) => {
      const rotated = await epochOf(world)
      await world.run("UPDATE system_flags SET value = ? WHERE key = 'data_epoch'", epochBeforeRestore)
      await putVersionsBack(versionsAtS1)
      await sleep(MEMO_MS)
      const control = await filters()
      t.eq('control status', control.status, 200)
      t.eq('control: the old entry is a hit again', cacheState(control), 'hit')
      t.ok('control: it carries the S1-only category (the defect the epoch prevents)', JSON.stringify(control.json).includes('EpochCategoryAfter'), JSON.stringify(control.json).slice(0, 200))
      await world.run("UPDATE system_flags SET value = ? WHERE key = 'data_epoch'", rotated)
      await sleep(MEMO_MS)
      const restored = await filters()
      t.ok('with the rotated epoch back, the answer is the restored one again (a hit on the entry stored after the restore, never the S1 one)', !JSON.stringify(restored.json).includes('EpochCategoryAfter') && JSON.stringify(restored.json).includes('EpochCategoryBefore'), JSON.stringify(restored.json).slice(0, 160))
    })

    // A rotation that cannot be written must not release the hold. The lock lets the entry rotation through (writes 0 -> 1) and refuses the next.
    await check('a restore whose release-time rotation fails keeps the hold on, says so, and a forced clear that cannot rotate keeps it too', async (t) => {
      await world.run('CREATE TABLE epoch_lock (writes INTEGER NOT NULL)')
      await world.run('INSERT INTO epoch_lock VALUES (0)')
      await world.run(`CREATE TRIGGER epoch_lock_count AFTER UPDATE ON system_flags WHEN NEW.key = 'data_epoch' BEGIN UPDATE epoch_lock SET writes = writes + 1; END`)
      await world.run(`CREATE TRIGGER epoch_lock_refuse BEFORE UPDATE ON system_flags WHEN NEW.key = 'data_epoch' AND (SELECT writes FROM epoch_lock) >= 1
        BEGIN SELECT RAISE(ABORT, 'epoch locked'); END`)
      const response = await world.api('POST', '/api/backups', { type: 'import-folder', sourceDir: backupName, currentPassword: adminPassword })
      t.eq('status', response.status, 503)
      t.eq('code', response.json && response.json.code, 'data_epoch_not_rotated')
      t.eq('the data was restored (said so)', response.json && response.json.data_restored, true)
      t.eq('maintenance stays on', await heldNow(), true)
      const clear = await world.api('POST', '/api/backups/maintenance/clear', { force: true, currentPassword: adminPassword })
      t.eq('forced clear status', clear.status, 503)
      t.eq('forced clear code', clear.json && clear.json.code, 'data_epoch_not_rotated')
      t.eq('maintenance still on after the refused clear', await heldNow(), true)
      await world.run('DROP TRIGGER epoch_lock_refuse')
      const before = await epochOf(world)
      const cleared = await world.api('POST', '/api/backups/maintenance/clear', { force: true, currentPassword: adminPassword })
      t.eq('once the epoch can move, the clear works: status', cleared.status, 200)
      t.eq('maintenance off', await heldNow(), false)
      t.ok('and the epoch moved', (await epochOf(world)) !== before)
    })

    await check('a restore whose ENTRY rotation fails is refused before anything is deleted and does not leave the app write-blocked', async (t) => {
      await world.run('UPDATE epoch_lock SET writes = 1')
      await world.run(`CREATE TRIGGER epoch_lock_refuse BEFORE UPDATE ON system_flags WHEN NEW.key = 'data_epoch' AND (SELECT writes FROM epoch_lock) >= 1
        BEGIN SELECT RAISE(ABORT, 'epoch locked'); END`)
      await world.api('POST', '/api/products', { name: 'EpochProbe Later', barcode: '8800000000035', category: 'EpochCategoryLater' })
      const response = await world.api('POST', '/api/backups', { type: 'import-folder', sourceDir: backupName, currentPassword: adminPassword })
      t.eq('status', response.status, 503)
      t.eq('code', response.json && response.json.code, 'data_epoch_not_rotated')
      t.ok('nothing was deleted: the product made after the backup survives', (await names()).includes('EpochProbe Later'), await names())
      t.eq('maintenance was released', await heldNow(), false)
      await world.run('DROP TRIGGER epoch_lock_refuse')
    })
  } finally {
    finish('cache restore epoch')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
