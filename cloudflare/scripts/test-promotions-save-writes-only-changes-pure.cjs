// Promotion saves write only what changed (owner, 5 Oct 2026: Save "updates
// everything"; Cloudflare Free budget).
//
//   - Reordering the website promotion cards used to rewrite sort_order and
//     updated_at on EVERY card; moving one card to the top of five wrote five.
//     Now only the cards whose place changes are written.
//   - Re-saving a promotion rule or a website card with no edits used to run the
//     UPDATE, add an audit row with an empty diff, broadcast, and (rules)
//     bump the products cache version -- which discards every cached product
//     search because the promoted-first ordering lives inside them.
//
// Drives the REAL routes/promotions.ts and the real audit changedFields()
// against the migrated schema. Fails on a284ac64d.
//
// Run: node scripts/test-promotions-save-writes-only-changes-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error && error.message).split(/\r?\n/)[0]}`)
  }
}

const base = openDb(loadAll())
const log = { writes: [], batches: [], audits: 0, bumps: 0, broadcasts: 0 }
const reset = () => { log.writes = []; log.batches = []; log.audits = 0; log.bumps = 0; log.broadcasts = 0 }
const routeDb = {
  prepare(sql) {
    const stmt = base.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params),
      run: async (params) => {
        log.writes.push(sql)
        const info = stmt.run(params)
        return { changes: info.meta.changes, lastInsertRowid: Number(info.meta.last_row_id) }
      },
    }
  },
  async batch(items) {
    log.batches.push(items.map((item) => ({ sql: item.sql, params: item.params })))
    return base.batch(items)
  },
}
const cache = new Map()
const overrides = {
  '../lib/db': { getDb: () => routeDb },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 7, username: 'staff' }); return next() } },
  '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full' },
  '../lib/audit': {
    get changedFields() { return load('lib/audit.ts').changedFields },
    audit: async () => { log.audits += 1 },
  },
  '../lib/cache': { bumpVersion: async () => { log.bumps += 1 } },
  '../durable-objects/broadcastHub': { broadcast: async () => { log.broadcasts += 1 } },
  '../index': {},
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/promotions.ts').default
const ctx = { waitUntil() {}, passThroughOnException() {} }
async function send(method, url, body) {
  reset()
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: routeDb }, ctx)
  return { status: res.status, body: await res.json() }
}
const orderOf = () => base.prepare('SELECT id FROM promotions ORDER BY sort_order ASC, id ASC').all().map((row) => row.id)

async function main() {
  base.exec('DELETE FROM promotions; DELETE FROM promotion_rules')
  const ids = []
  for (let i = 0; i < 5; i += 1) {
    const res = await send('POST', '/', { title: `Card ${i}`, link_type: 'none' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    ids.push(res.body.id)
  }

  await check('moving the last card to the top shifts, and so writes, all five', async () => {
    assert.deepEqual(orderOf(), ids)
    base.exec("UPDATE promotions SET updated_at = '2020-01-01 00:00:00'")
    const res = await send('PUT', '/reorder/all', { order: [ids[4], ids[0], ids[1], ids[2], ids[3]] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(orderOf(), [ids[4], ids[0], ids[1], ids[2], ids[3]])
    // Every card's place changes when one jumps from last to first, so five rows
    // move; the discriminating case is the swap below.
    assert.equal(log.batches[0].length, 5)
  })

  await check('swapping two neighbours writes exactly two rows and leaves the other three alone', async () => {
    const current = orderOf()
    base.exec("UPDATE promotions SET updated_at = '2020-01-01 00:00:00'")
    const next = [current[0], current[2], current[1], current[3], current[4]]
    const res = await send('PUT', '/reorder/all', { order: next })
    assert.equal(res.status, 200)
    assert.deepEqual(orderOf(), next)
    assert.equal(log.batches[0].length, 2, 'two UPDATEs (the old route sent five)')
    const untouched = base.prepare("SELECT COUNT(*) AS n FROM promotions WHERE updated_at = '2020-01-01 00:00:00'").get().n
    assert.equal(untouched, 3)
    assert.equal(log.audits, 1)
    assert.equal(log.broadcasts, 1)
  })

  await check('reordering to the order already stored writes, audits and broadcasts nothing, and still answers the list', async () => {
    const current = orderOf()
    const res = await send('PUT', '/reorder/all', { order: current })
    assert.equal(res.status, 200)
    assert.equal(log.batches.length, 0)
    assert.equal(log.audits, 0)
    assert.equal(log.broadcasts, 0)
    assert.deepEqual(res.body.map((row) => row.id), current)
  })

  await check('a website card saved with no edits writes nothing', async () => {
    const card = base.prepare('SELECT * FROM promotions WHERE id = @id').get({ id: ids[2] })
    const res = await send('PUT', `/${ids[2]}`, { title: card.title, link_type: 'none', is_active: 1, sort_order: card.sort_order })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(log.writes.length, 0)
    assert.equal(log.audits, 0)
    assert.equal(log.broadcasts, 0)
    assert.equal(res.body.id, ids[2])
  })

  await check('control: a website card with a real edit is still written and audited', async () => {
    const card = base.prepare('SELECT * FROM promotions WHERE id = @id').get({ id: ids[2] })
    const res = await send('PUT', `/${ids[2]}`, { title: 'Renamed card', link_type: 'none', is_active: 1, sort_order: card.sort_order })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.title, 'Renamed card')
    assert.equal(log.writes.length, 1)
    assert.equal(log.audits, 1)
  })

  const RULE = { title: 'Buy 3 save $1', show_title: 1, rule_type: 'quantity_save', min_quantity: 3, save_usd: 1, save_khr: 0, scope_type: 'category', category: 'Drinks', badge_color: '#e11d48', is_active: 1 }
  let ruleId = null
  await check('a promotion rule saved with no edits writes nothing and does NOT bump the products cache version', async () => {
    const created = await send('POST', '/rules', RULE)
    assert.equal(created.status, 200, JSON.stringify(created.body))
    ruleId = created.body.id
    const res = await send('PUT', `/rules/${ruleId}`, RULE)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(log.writes.length, 0, 'no UPDATE')
    assert.equal(log.audits, 0, 'no audit row')
    assert.equal(log.bumps, 0, 'no products-version bump (it discards every cached product search)')
    assert.equal(log.broadcasts, 0)
    assert.equal(res.body.id, ruleId)
  })

  await check('control: a rule with a real edit still updates, audits, bumps and broadcasts once', async () => {
    const res = await send('PUT', `/rules/${ruleId}`, { ...RULE, save_usd: 2 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.save_usd, 2)
    assert.equal(log.writes.length, 1)
    assert.equal(log.audits, 1)
    assert.equal(log.bumps, 1)
    assert.equal(log.broadcasts, 1)
  })

  console.log(`\ntest-promotions-save-writes-only-changes-pure.cjs: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(`FAILED: ${failures.join(' | ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
