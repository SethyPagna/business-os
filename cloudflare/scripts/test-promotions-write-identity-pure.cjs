// N13: every promotions write carries a request identity + stored receipt, and every
// edit/delete of one row states the version it read.
//
// Drives the REAL routes/promotions.ts with the real audit, conflict-control and
// receipt libraries against the full migrated schema (in-memory SQLite), for BOTH
// features that share the mount: the website announcement strip (`/`, `/:id`,
// `/reorder/all`) and the pricing-rule engine (`/rules*`).
//
// Each case is one that fails on the old code (no id, no version, no receipt):
//   - a double POST created the card/rule twice;
//   - a stale PUT/DELETE silently overwrote or removed a newer edit;
//   - a retried reorder re-applied an old order over a newer one.
// and each is paired with the allowed path, which must still work.
//
// Run (from cloudflare/): node scripts/test-promotions-write-identity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const base = openDb(loadAll())
// lib/db.ts flattens run() into { changes, lastInsertRowid }; batch() keeps D1's meta.
const routeDb = {
  prepare(sql) {
    const stmt = base.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params) ?? [],
      run: async (params) => {
        const info = stmt.run(params)
        return { changes: info.meta.changes, lastInsertRowid: Number(info.meta.last_row_id) }
      },
    }
  },
  async batch(items) { return base.batch(items) },
}
const events = { bumps: 0, broadcasts: [] }
const overrides = {
  '../lib/db': { getDb: () => routeDb },
  './db': { getDb: () => routeDb },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 7, username: 'staff', name: 'Staff' }); return next() } },
  '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full' },
  '../lib/cache': { bumpVersion: async () => { events.bumps += 1 } },
  '../durable-objects/broadcastHub': { broadcast: async (_env, _channel, payload) => { events.broadcasts.push(payload) } },
  '../index': {},
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
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
let seq = 0
const rid = (label = 'req') => `${label}_${String(++seq).padStart(6, '0')}_abcdefgh`
async function send(method, url, body) {
  const res = await app.request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, {}, ctx)
  return { status: res.status, body: await res.json().catch(() => null) }
}
const count = (table) => base.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
const receipts = (action, entity) => base.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ? AND entity = ?').get([action, entity]).n
const row = (table, id) => base.prepare(`SELECT * FROM ${table} WHERE id = ?`).get([id])

const CARD = { title: 'Card', link_type: 'none', is_active: 1 }
const RULE = { title: 'Buy 3 save $1', show_title: 1, rule_type: 'quantity_save', min_quantity: 3, save_usd: 1, save_khr: 0, scope_type: 'category', category: 'Drinks', badge_color: '#e11d48', is_active: 1 }

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}
function reset() {
  base.exec('DELETE FROM promotions; DELETE FROM promotion_rules; DELETE FROM audit_logs;')
  events.bumps = 0
  events.broadcasts = []
}

// The two single-row features, driven by the same assertions.
const kinds = [
  { name: 'strip card', table: 'promotions', entity: 'promotion', root: '/', item: (id) => `/${id}`, make: (extra = {}) => ({ ...CARD, ...extra }), edit: { title: 'Renamed' } },
  { name: 'pricing rule', table: 'promotion_rules', entity: 'promotion_rule', root: '/rules', item: (id) => `/rules/${id}`, make: (extra = {}) => ({ ...RULE, ...extra }), edit: { title: 'Buy 3 save $2', save_usd: 2 } },
]

async function main() {
  for (const kind of kinds) {
    const create = (extra, id = rid('create')) => send('POST', kind.root, { ...kind.make(extra), client_request_id: id })

    await check(`${kind.name}: a create with no request id, or a malformed one, is refused and stores nothing`, async () => {
      reset()
      let res = await send('POST', kind.root, kind.make())
      assert.equal(res.status, 400, JSON.stringify(res.body))
      assert.equal(res.body.code, 'client_request_id_required')
      res = await send('POST', kind.root, { ...kind.make(), client_request_id: 'short' })
      assert.equal(res.status, 400)
      assert.equal(res.body.code, 'invalid_client_request_id')
      assert.equal(count(kind.table), 0)
    })

    await check(`${kind.name}: a double POST with one request id creates exactly one row and answers both calls with it`, async () => {
      reset()
      const id = rid('dbl')
      const first = await create({}, id)
      const second = await create({}, id)
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.equal(second.status, 200, JSON.stringify(second.body))
      assert.equal(second.body.id, first.body.id, 'the retry returns the first commit')
      assert.equal(count(kind.table), 1, 'old code inserted twice')
      assert.equal(receipts('create', kind.entity), 1)
    })

    await check(`${kind.name}: two simultaneous POSTs with one request id still create one row`, async () => {
      reset()
      const id = rid('race')
      const [a, b] = await Promise.all([create({}, id), create({}, id)])
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(b.status, 200, JSON.stringify(b.body))
      assert.equal(a.body.id, b.body.id)
      assert.equal(count(kind.table), 1)
      assert.equal(receipts('create', kind.entity), 1)
    })

    await check(`${kind.name}: the same request id with different values is a 409, not a second row`, async () => {
      reset()
      const id = rid('diff')
      assert.equal((await create({}, id)).status, 200)
      const clash = await create({ title: 'Something else' }, id)
      assert.equal(clash.status, 409, JSON.stringify(clash.body))
      assert.equal(clash.body.code, 'idempotency_conflict')
      assert.equal(count(kind.table), 1)
    })

    await check(`${kind.name}: two different request ids are two different, both-allowed creates`, async () => {
      reset()
      assert.equal((await create({})).status, 200)
      assert.equal((await create({})).status, 200)
      assert.equal(count(kind.table), 2)
    })

    await check(`${kind.name}: an edit with no request id or no version is refused before anything is read or written`, async () => {
      reset()
      const created = (await create({})).body
      const before = row(kind.table, created.id)
      let res = await send('PUT', kind.item(created.id), { ...kind.make(kind.edit), expected_updated_at: created.updated_at })
      assert.equal(res.status, 400); assert.equal(res.body.code, 'client_request_id_required')
      res = await send('PUT', kind.item(created.id), { ...kind.make(kind.edit), client_request_id: rid('nov') })
      assert.equal(res.status, 400); assert.equal(res.body.code, 'expected_updated_at_required')
      assert.deepEqual(row(kind.table, created.id), before)
      assert.equal(receipts('update', kind.entity), 0)
    })

    await check(`${kind.name}: a stale edit cannot overwrite a newer one (409 write_conflict, row untouched)`, async () => {
      reset()
      const created = (await create({})).body
      base.prepare(`UPDATE ${kind.table} SET title = 'edited by someone else', updated_at = '2030-01-01 00:00:00' WHERE id = ?`).run([created.id])
      const stale = await send('PUT', kind.item(created.id), { ...kind.make(kind.edit), client_request_id: rid('stale'), expected_updated_at: created.updated_at })
      assert.equal(stale.status, 409, JSON.stringify(stale.body))
      assert.equal(stale.body.code, 'write_conflict')
      assert.equal(row(kind.table, created.id).title, 'edited by someone else', 'old code overwrote it')
      assert.equal(receipts('update', kind.entity), 0)
      assert.equal(events.broadcasts.filter((e) => /update/.test(e.action)).length, 0)
    })

    await check(`${kind.name}: an edit with the current version applies, is audited once, and the retry replays instead of re-running`, async () => {
      reset()
      const created = (await create({})).body
      const id = rid('edit')
      const body = { ...kind.make(kind.edit), client_request_id: id, expected_updated_at: created.updated_at }
      const first = await send('PUT', kind.item(created.id), body)
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.equal(first.body.title, kind.edit.title)
      // Age the stored version so a re-run would be visible as a new updated_at.
      base.prepare(`UPDATE ${kind.table} SET updated_at = '2031-01-01 00:00:00' WHERE id = ?`).run([created.id])
      const retry = await send('PUT', kind.item(created.id), body) // carries the OLD version
      assert.equal(retry.status, 200, JSON.stringify(retry.body))
      assert.equal(row(kind.table, created.id).updated_at, '2031-01-01 00:00:00', 'the retry wrote nothing')
      assert.equal(receipts('update', kind.entity), 1)
      const diff = base.prepare("SELECT old_value, new_value FROM audit_logs WHERE action = 'update' AND entity = ?").get([kind.entity])
      assert.ok(diff.old_value && diff.new_value, 'the receipt row still carries the before/after')
    })

    await check(`${kind.name}: the same request id on a different edit is a 409`, async () => {
      reset()
      const created = (await create({})).body
      const id = rid('reuse')
      assert.equal((await send('PUT', kind.item(created.id), { ...kind.make(kind.edit), client_request_id: id, expected_updated_at: created.updated_at })).status, 200)
      const clash = await send('PUT', kind.item(created.id), { ...kind.make({ title: 'Another' }), client_request_id: id, expected_updated_at: created.updated_at })
      assert.equal(clash.status, 409, JSON.stringify(clash.body))
      assert.equal(clash.body.code, 'idempotency_conflict')
    })

    await check(`${kind.name}: two simultaneous identical edits apply once`, async () => {
      reset()
      const created = (await create({})).body
      const body = { ...kind.make(kind.edit), client_request_id: rid('twin'), expected_updated_at: created.updated_at }
      const [a, b] = await Promise.all([send('PUT', kind.item(created.id), body), send('PUT', kind.item(created.id), body)])
      assert.equal(a.status, 200, JSON.stringify(a.body))
      assert.equal(b.status, 200, JSON.stringify(b.body))
      assert.equal(receipts('update', kind.entity), 1)
    })

    await check(`${kind.name}: a save that changes nothing still writes nothing`, async () => {
      reset()
      const created = (await create({})).body
      const res = await send('PUT', kind.item(created.id), { ...kind.make(), client_request_id: rid('same'), expected_updated_at: created.updated_at })
      assert.equal(res.status, 200)
      assert.equal(receipts('update', kind.entity), 0)
      assert.equal(row(kind.table, created.id).updated_at, created.updated_at)
    })

    await check(`${kind.name}: a delete needs an id and a version; a stale delete removes nothing`, async () => {
      reset()
      const created = (await create({})).body
      let res = await send('DELETE', kind.item(created.id))
      assert.equal(res.status, 400); assert.equal(res.body.code, 'client_request_id_required')
      res = await send('DELETE', kind.item(created.id), { client_request_id: rid('nover') })
      assert.equal(res.status, 400); assert.equal(res.body.code, 'expected_updated_at_required')
      base.prepare(`UPDATE ${kind.table} SET updated_at = '2030-01-01 00:00:00' WHERE id = ?`).run([created.id])
      res = await send('DELETE', kind.item(created.id), { client_request_id: rid('stale'), expected_updated_at: created.updated_at })
      assert.equal(res.status, 409, JSON.stringify(res.body))
      assert.equal(res.body.code, 'write_conflict')
      assert.equal(count(kind.table), 1, 'old code deleted the newer edit')
    })

    await check(`${kind.name}: a delete with the current version removes it once, keeps the before image, and the retry answers deleted instead of 404`, async () => {
      reset()
      const created = (await create({})).body
      const body = { client_request_id: rid('del'), expected_updated_at: created.updated_at }
      const first = await send('DELETE', kind.item(created.id), body)
      assert.equal(first.status, 200, JSON.stringify(first.body))
      assert.deepEqual(first.body, { deleted: true })
      assert.equal(count(kind.table), 0)
      const retry = await send('DELETE', kind.item(created.id), body)
      assert.equal(retry.status, 200, JSON.stringify(retry.body))
      assert.deepEqual(retry.body, { deleted: true })
      assert.equal(receipts('delete', kind.entity), 1)
      const audit = base.prepare("SELECT old_value, new_value FROM audit_logs WHERE action = 'delete' AND entity = ?").get([kind.entity])
      assert.ok(audit.old_value && audit.new_value === null, 'the removed record is the before image')
      // A different request on the now-missing row is an honest 404.
      const other = await send('DELETE', kind.item(created.id), { client_request_id: rid('other'), expected_updated_at: created.updated_at })
      assert.equal(other.status, 404)
    })
  }

  // ---- reorder (strip only): receipt, no row version ----
  await check('reorder: a request id is required', async () => {
    reset()
    const res = await send('PUT', '/reorder/all', { order: [1, 2] })
    assert.equal(res.status, 400); assert.equal(res.body.code, 'client_request_id_required')
  })

  await check('reorder: a retried request replays instead of re-applying an old order over a newer one', async () => {
    reset()
    const ids = []
    for (let i = 0; i < 3; i += 1) ids.push((await send('POST', '/', { ...CARD, title: `C${i}`, client_request_id: rid('c') })).body.id)
    const orderOf = () => base.prepare('SELECT id FROM promotions ORDER BY sort_order ASC, id ASC').all().map((r) => r.id)
    const a = { order: [ids[2], ids[0], ids[1]], client_request_id: rid('ordA') }
    const b = { order: [ids[1], ids[2], ids[0]], client_request_id: rid('ordB') }
    assert.equal((await send('PUT', '/reorder/all', a)).status, 200)
    assert.deepEqual(orderOf(), a.order)
    assert.equal((await send('PUT', '/reorder/all', b)).status, 200)
    assert.deepEqual(orderOf(), b.order)
    const replay = await send('PUT', '/reorder/all', a) // a delayed duplicate of the FIRST request
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.deepEqual(orderOf(), b.order, 'old code put order A back on top of B')
    assert.deepEqual(replay.body.map((r) => r.id), b.order, 'the replay answers with the current list')
    assert.equal(receipts('reorder', 'promotion'), 2)
  })

  await check('reorder: the same id with a different order is a 409', async () => {
    reset()
    const ids = []
    for (let i = 0; i < 3; i += 1) ids.push((await send('POST', '/', { ...CARD, title: `C${i}`, client_request_id: rid('c') })).body.id)
    const id = rid('ordX')
    assert.equal((await send('PUT', '/reorder/all', { order: [ids[2], ids[1], ids[0]], client_request_id: id })).status, 200)
    const clash = await send('PUT', '/reorder/all', { order: [ids[0], ids[1], ids[2]], client_request_id: id })
    assert.equal(clash.status, 409); assert.equal(clash.body.code, 'idempotency_conflict')
  })

  await check('reorder: two simultaneous identical requests move each card once', async () => {
    reset()
    const ids = []
    for (let i = 0; i < 4; i += 1) ids.push((await send('POST', '/', { ...CARD, title: `C${i}`, client_request_id: rid('c') })).body.id)
    const body = { order: [ids[3], ids[2], ids[1], ids[0]], client_request_id: rid('ordR') }
    const [x, y] = await Promise.all([send('PUT', '/reorder/all', body), send('PUT', '/reorder/all', body)])
    assert.equal(x.status, 200); assert.equal(y.status, 200)
    assert.deepEqual(base.prepare('SELECT id FROM promotions ORDER BY sort_order ASC').all().map((r) => r.id), body.order)
    assert.equal(receipts('reorder', 'promotion'), 1)
  })

  // ---- source + frontend parity ----
  await check('every write route in promotions.ts reads a request id (no write path was left unguarded)', async () => {
    const source = fs.readFileSync(path.join(SRC, 'routes', 'promotions.ts'), 'utf8')
    const writes = source.match(/^app\.(post|put|delete)\(/gm) || []
    assert.equal(writes.length, 7, 'three rule writes + four strip writes')
    assert.equal((source.match(/readWriteRequestId\(body\)/g) || []).length, 7)
    assert.equal((source.match(/hasExpectedUpdatedAtField\(body\)/g) || []).length, 4, 'PUT/DELETE of a single row: 2 rule + 2 strip')
  })

  await check('frontend parity: the promotions transport always sends a request id, and edits/deletes the version they read', async () => {
    const transport = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'promotionsTransport.ts'), 'utf8')
    for (const name of ['createPromotion', 'updatePromotion', 'deletePromotion', 'reorderPromotions', 'createPromotionRule', 'updatePromotionRule', 'deletePromotionRule']) {
      const start = transport.indexOf(`export function ${name}(`)
      assert.ok(start >= 0, name)
      const end = transport.indexOf('\n}', start)
      assert.match(transport.slice(start, end), /ensureClientRequestId\(/, `${name} mints/keeps a client_request_id`)
    }
    for (const name of ['updatePromotion', 'deletePromotion', 'updatePromotionRule', 'deletePromotionRule']) {
      const start = transport.indexOf(`export function ${name}(`)
      const signature = transport.slice(start, transport.indexOf('{', transport.indexOf(')', start)))
      assert.match(signature, /expectedUpdatedAt: string \| null/, `${name} requires the version in its type`)
    }
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
