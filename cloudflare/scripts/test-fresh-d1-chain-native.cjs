// A brand-new database must build from the migration chains alone and hold no client's data.
//
// Every file of cloudflare/migrations and cloudflare/migrations-import is replayed onto empty databases
// on workerd's SQLite, which, like D1, refuses a compound SELECT of more than 5 terms. better-sqlite3
// allows 500, which is how 0098's 7-term seed stayed unnoticed until a new client's database stopped
// there (22 Oct 2026). Then the real Worker boots on the result and seeds itself, as on its first request.
//
// Production never re-runs these files (d1_migrations keys on the name). This is the path of a
// disaster-recovery rebuild and of a new client's database.
//
// Run: node scripts/test-fresh-d1-chain-native.cjs             (replays in this process: 2 to 3 minutes)
//      node scripts/test-fresh-d1-chain-native.cjs --wrangler  (the real `wrangler d1 migrations apply
//      --local` a rebuild runs: 5 to 10 minutes, over the native suite's 240 s timeout)
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { bundleWorker } = require('./harness/real_worker_world.cjs')

const root = path.join(__dirname, '..')
const CHAINS = [
  { binding: 'DB', name: 'fresh-chain-main', id: '00000000-0000-0000-0000-0000000fd101', dir: path.join(root, 'migrations') },
  { binding: 'IMPORT_DB', name: 'fresh-chain-import', id: '00000000-0000-0000-0000-0000000fd102', dir: path.join(root, 'migrations-import') },
]
const NEUTRAL_SEED = { name: 'Business OS', slug: 'business-os', public_id: 'org_business_os' }
const OLD_0030_SEED = { name: 'Leang Cosmetics', slug: 'leang-cosmetics', public_id: 'leang-cosmetics' }
const NEW_CLIENT = { name: 'Example Shop', slug: 'example-shop' }
const LEANG = { name: 'LeangBeauty', slug: 'leangbeauty' }

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// Same splitter and engine as `wrangler d1 migrations apply --local`: one batch per file, recorded in
// d1_migrations the way wrangler records it.
async function replayChains(persist) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const mf = miniflare(persist)
  try {
    for (const chain of CHAINS) {
      const db = await mf.getD1Database(chain.binding)
      await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run()
      for (const name of sqlFiles(chain.dir)) {
        const statements = split(fs.readFileSync(path.join(chain.dir, name), 'utf8')).map((sql) => db.prepare(sql))
        try { await db.batch([...statements, db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name)]) } catch (error) { throw new Error(`${name} could not be applied to an empty database: ${error.message}`) }
      }
    }
  } finally { await mf.dispose() }
}

// Only `--local`, a made-up database id and no Cloudflare credentials in the child's environment:
// nothing here can reach a real database.
function applyChainsWithWrangler(work) {
  const config = path.join(work, 'wrangler.json')
  fs.writeFileSync(config, JSON.stringify({
    name: 'fresh-chain-test', compatibility_date: '2026-09-01',
    d1_databases: CHAINS.map((c) => ({ binding: c.binding, database_name: c.name, database_id: c.id, migrations_dir: c.dir })),
  }))
  const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
  for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(key)) delete env[key]
  for (const chain of CHAINS) {
    const started = Date.now()
    const result = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', chain.name, '--local', '--config', config, '--persist-to', path.join(work, 'persist')],
      { cwd: work, env, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
    if (result.error) throw result.error
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, 0, `wrangler could not apply ${path.basename(chain.dir)} to an empty database:\n${output.split('\n').filter((l) => /ERROR|error/.test(l)).join('\n')}`)
    console.log(`applied ${path.basename(chain.dir)} in ${Math.round((Date.now() - started) / 1000)} s`)
  }
}

function sqlFiles(dir) { return fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort() }

function miniflare(persist, { script = '', identity } = {}) {
  return new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: Object.fromEntries(CHAINS.map((c) => [c.binding, c.id])), d1Persist: path.join(persist, 'v3', 'd1'),
    kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    ...(script ? { durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' } } : {}),
    bindings: identity ? { PLAN_TIER: 'paid', BUSINESS_OS_ORGANIZATION_SLUG: identity.slug, BUSINESS_OS_ORGANIZATION_NAME: identity.name } : {},
    log: new Log(LogLevel.ERROR),
  })
}

async function withDb(persist, options, fn) {
  const mf = miniflare(persist, options)
  try { return await fn(await mf.getD1Database('DB'), mf) } finally { await mf.dispose() }
}

const all = async (db, sql) => (await db.prepare(sql).all()).results
const count = async (db, sql) => (await db.prepare(sql).first()).n
const organizations = (db) => all(db, 'SELECT name, slug, public_id FROM organizations ORDER BY id')

// Every text cell of every table that mentions the first client. d1_migrations holds file names only.
async function leangCells(db) {
  const hits = []
  const tables = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'")
  for (const { name } of tables) {
    for (const row of await all(db, `SELECT * FROM "${name}"`)) {
      for (const [column, value] of Object.entries(row)) if (typeof value === 'string' && /leang/i.test(value)) hits.push(`${name}.${column}=${value.slice(0, 60)}`)
    }
  }
  return hits
}

// The Worker seeds its organization, group, branches and roles on the first request it handles.
async function bootWorker(persist, script, identity) {
  await withDb(persist, { script, identity }, async (_db, mf) => { await (await mf.dispatchFetch('http://localhost/api/settings')).text() })
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-fresh-chain-'))
  try {
    const started = Date.now()
    if (process.argv.includes('--wrangler')) applyChainsWithWrangler(work)
    else await replayChains(path.join(work, 'persist'))
    console.log(`both chains applied in ${Math.round((Date.now() - started) / 1000)} s`)
    const base = path.join(work, 'persist')
    const copy = (label) => { const to = path.join(work, label); fs.cpSync(base, to, { recursive: true }); return to }
    const scenarios = { newClient: copy('new-client'), leangRebuild: copy('leang-rebuild'), oldSeed: copy('old-seed'), production: copy('production') }

    await withDb(base, {}, async (db, mf) => {
      await check('the engine under test enforces D1\'s compound SELECT limit (positive control)', async () => {
        await assert.rejects(db.prepare(`SELECT count(*) FROM (${Array.from({ length: 6 }, (_, i) => `SELECT ${i}`).join(' UNION ALL ')})`).first(), /too many terms in compound SELECT/)
      })
      await check('every migration of both chains is recorded, in file order', async () => {
        assert.deepEqual((await all(db, 'SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name), sqlFiles(CHAINS[0].dir))
        const importDb = await mf.getD1Database('IMPORT_DB')
        assert.deepEqual((await all(importDb, 'SELECT name FROM d1_migrations ORDER BY id')).map((r) => r.name), sqlFiles(CHAINS[1].dir))
      })
      await check('the chain alone leaves a neutral organization and none of the first client\'s rows', async () => {
        assert.deepEqual(await organizations(db), [NEUTRAL_SEED])
        assert.equal(await count(db, 'SELECT COUNT(*) n FROM fees'), 0, '0064 must not import any expense')
        assert.equal(await count(db, 'SELECT COUNT(*) n FROM user_aliases'), 0, '0098 must not seed any alias')
        assert.deepEqual(await leangCells(db), [])
      })
    })

    const script = await bundleWorker()

    await check('a new client\'s first request renames the seed to its own organization, and no first-client text remains', async () => {
      await bootWorker(scenarios.newClient, script, NEW_CLIENT)
      await withDb(scenarios.newClient, {}, async (db) => {
        assert.deepEqual(await organizations(db), [{ name: 'Example Shop', slug: 'example-shop', public_id: 'org_example_shop' }])
        assert.equal(await count(db, 'SELECT COUNT(*) n FROM organization_groups WHERE organization_id = (SELECT id FROM organizations)'), 1)
        assert.equal(await count(db, 'SELECT COUNT(*) n FROM fees'), 0)
        assert.deepEqual(await leangCells(db), [])
      })
    })

    await check('a Leang rebuild ends with exactly one organization, the configured one', async () => {
      await bootWorker(scenarios.leangRebuild, script, LEANG)
      await withDb(scenarios.leangRebuild, {}, async (db) => {
        assert.deepEqual(await organizations(db), [{ name: 'LeangBeauty', slug: 'leangbeauty', public_id: 'org_leangbeauty' }])
      })
    })

    await check('a database seeded by the old 0030 text is renamed in place, not duplicated', async () => {
      await withDb(scenarios.oldSeed, {}, async (db) => {
        await db.prepare('UPDATE organizations SET name = ?, slug = ?, public_id = ?').bind(OLD_0030_SEED.name, OLD_0030_SEED.slug, OLD_0030_SEED.public_id).run()
        assert.deepEqual((await leangCells(db)).map((hit) => hit.split('=')[0]), ['organizations.name', 'organizations.slug', 'organizations.public_id'], 'the scan sees the old seed row (positive control)')
      })
      await bootWorker(scenarios.oldSeed, script, NEW_CLIENT)
      await withDb(scenarios.oldSeed, {}, async (db) => {
        assert.deepEqual(await organizations(db), [{ name: 'Example Shop', slug: 'example-shop', public_id: 'org_example_shop' }])
        assert.deepEqual(await leangCells(db), [])
      })
    })

    await check('production: the configured leangbeauty row is kept and a stray old-seed row is left alone', async () => {
      const rows = [OLD_0030_SEED, { name: 'LeangBeauty', slug: 'leangbeauty', public_id: 'org_leangbeauty' }]
      await withDb(scenarios.production, {}, async (db) => {
        await db.batch([
          db.prepare('DELETE FROM organization_groups'), db.prepare('DELETE FROM organizations'),
          ...rows.map((r) => db.prepare('INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled) VALUES (?, ?, ?, 1, 0)').bind(r.name, r.slug, r.public_id)),
        ])
      })
      await bootWorker(scenarios.production, script, LEANG)
      await withDb(scenarios.production, {}, async (db) => {
        assert.deepEqual(await organizations(db), rows)
        assert.equal(await count(db, "SELECT COUNT(*) n FROM organization_groups WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'leangbeauty')"), 1)
      })
    })
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  console.log(`\n${passed} fresh-chain checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
