// The Inventory population token (migration 0317) and the status counts that key on it (lib/inventoryCheckList.ts).
//   token        one row, changed by triggers on products: INSERT, DELETE, and an UPDATE that really changes id, is_active or is_group; never in a restore (the 0124 guard)
//   iff          over random writes the token changes if and only if the rows' (id, is_active, is_group) changed, and whenever the population changed
//   summary      equals a brute-force oracle after EVERY random write, with no cache version bumped by any writer: only the token moves the key
//   restore      the triggers stand down in restore mode, so rotateDataEpoch (the step every restore and reset ends with) writes a fresh token and a fresh epoch
//   headers      a family header (is_group = 1) is in no figure and in no list: Not checked, Checked OK, Issues, grouped, and the day tap (also with a count on the header)
//   snapshot     ok + issue never exceeds total, also when a cache-version bump failed or a row enters between the token read and the batch; the token, the count and the seek are read in ONE batch
//   during a restore  no count is cached or reused while maintenance is in mode restore (the token is frozen then); after the release the counts are correct
//   no table     a database without the token table: rotateDataEpoch still completes, the counts are computed uncached
// Mutants planted and killed: no DELETE trigger, is_group missing from the UPDATE OF list, a WHEN that fires on every update, the epoch step not refreshing the token, the products version in the key, a cached total reused without the token re-check.
// Run: node scripts/test-inventory-population-token-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createInvApp } = require('./harness/inv-app.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let checks = 0
// KEEP_GOING=1 lists every failing check instead of stopping at the first (used to show which checks an older tip fails)
let failures = 0
function check(label, cond, detail) {
  if (!cond && process.env.KEEP_GOING) { failures++; console.log(`  FAIL ${label}`); return }
  if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail)
  assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`)
}

const MOUNT = { '/api/products': 'routes/products.ts', '/api/inventory-checks/products': 'routes/inventoryCheckProducts.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' }
const LIST = 'lib/inventoryCheckList.ts'
const T = (n) => `2026-11-${String(10 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.000Z`
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0317_inventory_population_token.sql'), 'utf8')

// ---- the migration file ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
check('the migration is LF only', !MIGRATION.includes(String.fromCharCode(13)))
check('it keeps rowid (never WITHOUT ROWID) and seeds the one token row', !/WITHOUT ROWID/i.test(MIGRATION) && MIGRATION.includes('INSERT INTO inventory_population_token (id, stamp) VALUES (1, lower(hex(randomblob(8))))'))
check('its three triggers carry the restore guard of 0124', (MIGRATION.match(/json_extract\(value, '\$\.mode'\) = 'restore'/g) || []).length === 3)
check('no statement of it is only a comment: every non-comment chunk between semicolons has SQL', MIGRATION.split(';').map((chunk) => chunk.split('\n').filter((line) => !line.trim().startsWith('--')).join('').trim()).slice(0, -1).every((chunk) => chunk.length > 0))
check('no migration of the repository reuses the number 0317', fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((name) => name.startsWith('0317_')).length === 1)

// ---- migrations with a planted fault ------------------------------------------------------------------------------------------------------------------------------------------------------------
function dropTrigger(sql, name) {
  const start = sql.indexOf(`CREATE TRIGGER ${name}`)
  if (start < 0) throw new Error(`no trigger ${name}`)
  const end = sql.indexOf('END;', start) + 'END;'.length
  return sql.slice(0, start) + sql.slice(end)
}
function replaceOnce(sql, from, to) { if (sql.split(from).length !== 2) throw new Error(`must match once: ${from}`); return sql.replace(from, () => to) }
const FAULTS = {
  'no DELETE trigger': (sql) => dropTrigger(sql, 'inventory_population_token_products_delete'),
  'is_group missing from the UPDATE OF list': (sql) => replaceOnce(sql, 'AFTER UPDATE OF id, is_active, is_group ON products', 'AFTER UPDATE OF id, is_active ON products'),
  'a WHEN that fires on every update': (sql) => replaceOnce(sql, 'WHEN (OLD.id IS NOT NEW.id OR OLD.is_active IS NOT NEW.is_active OR OLD.is_group IS NOT NEW.is_group)\n  AND NOT EXISTS', 'WHEN NOT EXISTS'),
  'no triggers at all (the cost baseline)': (sql) => ['insert', 'delete', 'update'].reduce((text, kind) => dropTrigger(text, `inventory_population_token_products_${kind}`), sql),
}
// each write is its own stock transaction, as the writers of the Worker are
function wrapRuns(raw) {
  const prepare = raw.prepare.bind(raw)
  raw.prepare = (sql) => { const statement = prepare(sql), run = statement.run.bind(statement); statement.run = (...args) => seedStockFixture(raw.db, () => run(...args)); return statement }
}
function database(fault) {
  const all = loadAll().map((sql) => (sql.includes('CREATE TABLE inventory_population_token') ? (fault ? FAULTS[fault](sql.split('\r\n').join('\n')) : sql) : sql))
  const raw = openDb(all)
  raw.exec('PRAGMA foreign_keys = OFF')
  wrapRuns(raw)
  return raw
}
const tokenOf = (raw) => raw.prepare('SELECT stamp AS token FROM inventory_population_token WHERE id = 1').get().token
const signature = (raw) => JSON.stringify(raw.prepare('SELECT id, is_active, is_group FROM products ORDER BY id').all().map((row) => [row.id, row.is_active, row.is_group]))
const members = (raw) => JSON.stringify(raw.prepare('SELECT id FROM products WHERE is_active = 1 AND COALESCE(is_group, 0) = 0 ORDER BY id').all().map((row) => row.id))
const setRestore = (raw, on) => { if (on) raw.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('maintenance', '{\"mode\":\"restore\"}')").run(); else raw.prepare("DELETE FROM system_flags WHERE key = 'maintenance'").run() }
const insertProduct = (raw, id, active, group) => raw.prepare('INSERT INTO products(id, name, sku, barcode, stock_quantity, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr, brand, category, is_active, is_group, created_at, updated_at) VALUES(?,?,?,?,0,1,4000,1,4000,\'B\',\'C\',?,?,\'2026-09-01 00:00:00\',\'2026-09-01 00:00:00\')')
  .run([id, `P${id}`, `S${id}`, `B${id}`, active, group])

// One random write. Every kind is a writer that exists in the codebase in some form: create, import, delete, retire, reactivate, header on/off, an edit of other columns, the same value assigned again, an id change, an upsert.
function randomWrite(raw, r, ctx) {
  const pick = (n) => Math.floor(r() * n)
  const ids = raw.prepare('SELECT id FROM products ORDER BY id').all().map((row) => row.id)
  const some = () => ids.length ? ids[pick(ids.length)] : null
  const kind = ['create', 'import', 'delete', 'retire', 'reactivate', 'headerOn', 'headerOff', 'other', 'sameValues', 'sameAssign', 'idChange', 'upsertOther', 'upsertActive', 'bulk'][pick(14)]
  const id = some()
  if (kind === 'create' || id === null) { insertProduct(raw, ctx.next++, pick(2), pick(4) === 0 ? 1 : 0); return 'create' }
  if (kind === 'import') { for (let i = 0, n = 1 + pick(5); i < n; i++) insertProduct(raw, ctx.next++, pick(2), 0); return kind }
  if (kind === 'delete') raw.prepare('DELETE FROM products WHERE id = ?').run([id])
  else if (kind === 'retire') raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run([id])
  else if (kind === 'reactivate') raw.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run([id])
  else if (kind === 'headerOn') raw.prepare('UPDATE products SET is_group = 1 WHERE id = ?').run([id])
  else if (kind === 'headerOff') raw.prepare('UPDATE products SET is_group = 0 WHERE id = ?').run([id])
  else if (kind === 'other') raw.prepare("UPDATE products SET name = name || 'x', selling_price_usd = 2, updated_at = '2026-10-01' WHERE id = ?").run([id])
  else if (kind === 'sameValues') raw.prepare('UPDATE products SET is_active = is_active, is_group = is_group, id = id WHERE id = ?').run([id])
  else if (kind === 'sameAssign') raw.prepare("UPDATE products SET is_active = ?, is_group = ?, name = 'same' WHERE id = ?").run([raw.prepare('SELECT is_active FROM products WHERE id = ?').get([id]).is_active, raw.prepare('SELECT is_group FROM products WHERE id = ?').get([id]).is_group, id])
  else if (kind === 'idChange') raw.prepare('UPDATE products SET id = ? WHERE id = ?').run([ctx.next++, id])
  else if (kind === 'upsertOther') raw.prepare("INSERT INTO products(id, name, sku, barcode, brand, category, is_active, is_group, selling_price_usd, created_at, updated_at) SELECT id, name || 'u', sku, barcode, brand, category, is_active, is_group, selling_price_usd, created_at, updated_at FROM products WHERE id = ? ON CONFLICT(id) DO UPDATE SET name = excluded.name").run([id])
  else if (kind === 'upsertActive') raw.prepare("INSERT INTO products(id, name, sku, barcode, brand, category, is_active, is_group, selling_price_usd, created_at, updated_at) SELECT id, name, sku, barcode, brand, category, 1 - is_active, is_group, selling_price_usd, created_at, updated_at FROM products WHERE id = ? ON CONFLICT(id) DO UPDATE SET is_active = excluded.is_active").run([id])
  else if (kind === 'bulk') raw.prepare('UPDATE products SET is_active = 1 - is_active WHERE id % 3 = ?').run([pick(3)])
  return kind
}

// Replays the same random writes: the token must change exactly when the (id, is_active, is_group) rows changed, and always when the membership changed; in restore mode never.
function propertyRun(fault, seeds) {
  let violations = null
  for (let seed = 1; seed <= seeds && !violations; seed++) {
    const raw = database(fault), r = prng(seed), ctx = { next: 1000 }
    raw.prepare('DELETE FROM products').run()
    for (let i = 0; i < 8; i++) insertProduct(raw, ctx.next++, i % 2, i === 3 ? 1 : 0)
    for (let step = 0; step < 60 && !violations; step++) {
      const restore = r() < 0.2
      setRestore(raw, restore)
      const beforeToken = tokenOf(raw), beforeSig = signature(raw), beforeMembers = members(raw)
      const kind = randomWrite(raw, r, ctx)
      const changed = tokenOf(raw) !== beforeToken, signatureMoved = signature(raw) !== beforeSig, membersMoved = members(raw) !== beforeMembers
      setRestore(raw, false)
      const expected = restore ? false : signatureMoved
      if (changed !== expected || (!restore && membersMoved && !changed)) violations = { seed, step, kind, restore, changed, signatureMoved, membersMoved }
    }
  }
  return violations
}
const clean = propertyRun(null, 40)
check('over 40 seeds x 60 random writes (create, import, delete, retire, reactivate, header on/off, other columns, the same value again, id change, upserts, bulk, restore mode) the token changes iff the rows changed', clean === null, () => JSON.stringify(clean))
for (const fault of ['no DELETE trigger', 'is_group missing from the UPDATE OF list', 'a WHEN that fires on every update']) {
  const hit = propertyRun(fault, 40)
  check(`mutant "${fault}" is killed by the property`, hit !== null, 'survived')
}
{
  const raw = database(null)
  raw.prepare('DELETE FROM products').run()
  const before = tokenOf(raw)
  setRestore(raw, true); insertProduct(raw, 1, 1, 0); raw.prepare('UPDATE products SET is_active = 0 WHERE id = 1').run(); raw.prepare('DELETE FROM products WHERE id = 1').run(); setRestore(raw, false)
  check('restore mode: a create, a retire and a delete leave the token alone (the triggers stand down)', tokenOf(raw) === before)
  insertProduct(raw, 2, 1, 0)
  check('and the next ordinary write moves it again', tokenOf(raw) !== before)
  check('a token is 16 lower-case hex digits', /^[0-9a-f]{16}$/.test(tokenOf(raw)))
}

// ---- write cost: rows written by the triggers -------------------------------------------------------------------------------------------------------------------------------------------------
{
  const withTriggers = database(null), without = database('no triggers at all (the cost baseline)')
  const changes = (raw, work) => { const before = raw.prepare('SELECT total_changes() AS n').get().n; work(raw); return raw.prepare('SELECT total_changes() AS n').get().n - before }
  for (const raw of [withTriggers, without]) raw.prepare('DELETE FROM products').run()
  const delta = (work) => changes(withTriggers, work) - changes(without, work)
  check('one product create writes 1 extra row (the token)', delta((raw) => insertProduct(raw, 1, 1, 0)) === 1)
  check('an import of 7 rows writes 7 extra rows', delta((raw) => { for (let id = 10; id < 17; id++) insertProduct(raw, id, 1, 0) }) === 7)
  check('an update that touches none of id, is_active, is_group writes 0 extra rows', delta((raw) => raw.prepare("UPDATE products SET name = 'z', selling_price_usd = 3 WHERE id >= 10").run()) === 0)
  check('assigning the same is_active and is_group again writes 0 extra rows', delta((raw) => raw.prepare('UPDATE products SET is_active = is_active, is_group = is_group WHERE id >= 10').run()) === 0)
  check('a delete of 7 rows writes 7 extra rows', delta((raw) => raw.prepare('DELETE FROM products WHERE id >= 10').run()) === 7)
  const plan = withTriggers.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND COALESCE(p.is_group, 0) = 0').all().map((row) => row.detail).join(' | ')
  check(`the population count is a covering count of the partial index (${plan})`, /COVERING INDEX idx_products_inventory_population/.test(plan))
}

// ---- the routes ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
function load(raw, seedStockFixture, world) {
  seedStockFixture(raw.db, () => {
    for (const table of ['inventory_check_approvals', 'inventory_check_items', 'inventory_check_sessions', 'branch_stock', 'products']) raw.prepare(`DELETE FROM ${table}`).run()
    for (const p of world.products) {
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,parent_id,created_at,updated_at)
        VALUES(?,?,?,?,0,9.5,38000,4,16000,'Brand','Cat',?,?,?,?,'2026-09-01 00:00:00')`).run([p.id, p.name, p.group ? null : `SKU${p.id}`, p.group ? null : `88500${p.id}`, p.active === false ? 0 : 1, p.group ? 1 : 0, p.parent ?? null, `2026-09-${String(1 + (p.id % 25)).padStart(2, '0')} 00:00:00`])
    }
    ;(world.counts || []).forEach((c, i) => addCount(raw, c, `s${i}`))
  })
}
function addCount(raw, c, sid) {
  raw.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,NULL,?,72,?,'closed','{}',?,?)").run([sid, c.branch || 1, `Count ${sid}`, c.at, c.at])
  raw.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,?,'{}',10,'{}',?,?,?,1,72,?)")
    .run([sid, c.product, c.branch || 1, c.state, c.state === 'issue' ? 8 : 10, c.state === 'issue' ? 'Short' : null, c.at])
}
const make = (world, sourceEdits = {}) => {
  const app = createInvApp({ mount: MOUNT, seed: (raw, seedStockFixture) => load(raw, seedStockFixture, world), sourceEdits })
  app.setSwitch('ic_wired', 'on'); app.setSwitch('ic_fix_stock', 'on'); app.setUser(app.users.checker)
  wrapRuns(app.raw)
  return app
}
const rowsOf = (n, name, start) => Array.from({ length: n }, (_, i) => ({ id: start + i, name, active: true }))
const ids = (r) => ((r.json && r.json.items) || []).map((x) => x.id).sort((a, b) => a - b)
const figures = (s) => ({ ok: s.ok, issue: s.issue, not_checked: s.not_checked, total: s.total })
const summaryOf = async (app, url = '/api/inventory-checks/list?branchId=1') => (await app.get(url)).json.summary
// The truth, from the rows themselves: members are active non-header rows, the latest done/issue count per product at the branch decides ok / issue.
function truth(app, branch) {
  const member = new Set(app.raw.prepare('SELECT id FROM products WHERE is_active = 1 AND COALESCE(is_group, 0) = 0').all().map((row) => row.id))
  const latest = new Map()
  for (const row of app.raw.prepare("SELECT i.product_id AS product, i.state AS state, i.updated_at AS at, i.session_id AS sid FROM inventory_check_items i WHERE i.branch_id = ? AND i.state IN ('done', 'issue')").all([branch])) {
    const had = latest.get(row.product)
    if (!had || row.at > had.at || (row.at === had.at && row.sid > had.sid)) latest.set(row.product, row)
  }
  const ok = [...latest.values()].filter((row) => member.has(row.product) && row.state === 'done').length, issue = [...latest.values()].filter((row) => member.has(row.product) && row.state === 'issue').length
  return { ok, issue, not_checked: member.size - ok - issue, total: member.size }
}

;(async () => {
  // ---- header rows are not part of the population, and the Not checked list leaves them out too ------------------------------------------------------------------------------------------------
  const HEADERS = { products: [{ id: 500, name: 'Serum Fam', group: true }, { id: 501, name: 'Serum Fam', parent: 500 }, { id: 502, name: 'Serum Fam', parent: 500 }, { id: 503, name: 'Solo' }, { id: 504, name: 'Toner Fam', group: true }, { id: 505, name: 'Toner Fam', parent: 504 }],
    counts: [{ product: 501, state: 'done', at: T(1) }, { product: 502, state: 'issue', at: T(2) }, { product: 503, state: 'done', at: T(3) }, { product: 500, state: 'done', at: T(4) }] }
  for (const ranked of [false, true]) {
    const app = make(HEADERS)
    if (ranked) app.setSwitch('catalog_ranked_scope', 'on')
    const s = await summaryOf(app)
    const tap = async (state, extra = '') => ids(await app.get(`/api/inventory-checks/list?branchId=1&checkState=${state}${extra}&pageSize=100`))
    check(`ranked scope ${ranked ? 'on' : 'off'}: headers 500 and 504 are not counted: ok 2, issue 1, Not checked 1, total 4`, JSON.stringify(figures(s)) === '{"ok":2,"issue":1,"not_checked":1,"total":4}', () => JSON.stringify(s))
    check(`ranked scope ${ranked ? 'on' : 'off'}: the plain Not checked tap lists [505], not a header`, JSON.stringify(await tap('not_checked')) === '[505]', async () => JSON.stringify(await tap('not_checked')))
    check(`ranked scope ${ranked ? 'on' : 'off'}: the grouped Not checked tap lists [505] too`, JSON.stringify(await tap('not_checked', '&groupBy=checked')) === '[505]', async () => JSON.stringify(await tap('not_checked', '&groupBy=checked')))
    check(`ranked scope ${ranked ? 'on' : 'off'}: the Checked OK and Issues taps match their chips (a count on the header 500 is in no figure and in no list)`, JSON.stringify(await tap('ok')) === '[501,503]' && JSON.stringify(await tap('issue')) === '[502]' && s.ok === 2 && s.issue === 1)
    check(`ranked scope ${ranked ? 'on' : 'off'}: the grouped Checked OK tap lists [501,503] too, not the header`, JSON.stringify(await tap('ok', '&groupBy=checked')) === '[501,503]', async () => JSON.stringify(await tap('ok', '&groupBy=checked')))
    const day = (s.days || [])[0]
    const dayTap = day ? ids(await app.get(`/api/inventory-checks/list?branchId=1&checkedOn=${day.day}&pageSize=100`)) : []
    check(`ranked scope ${ranked ? 'on' : 'off'}: the day tap lists as many rows as its chip says (${day && day.count}) and no header`, Boolean(day) && dayTap.length === day.count && !dayTap.includes(500), () => JSON.stringify({ day, dayTap }))
  }

  // ---- random writes, no version bumped by any writer: the summary follows the rows -----------------------------------------------------------------------------------------------------------------
  async function randomRoutes(fault, seeds, steps) {
    let miss = null
    for (let seed = 1; seed <= seeds && !miss; seed++) {
      const r = prng(1000 + seed), pick = (n) => Math.floor(r() * n)
      const products = Array.from({ length: 10 }, (_, i) => ({ id: 200 + i, name: `Name ${i % 4}`, active: r() > 0.3, group: i === 9 }))
      const counts = []
      for (let i = 0; i < 8; i++) counts.push({ product: 200 + pick(10), state: r() > 0.4 ? 'done' : 'issue', at: T(pick(60) + 1) })
      const seen = new Set(); const unique = counts.filter((c) => { const k = `${c.product}:${c.at}`; if (seen.has(k)) return false; seen.add(k); return true })
      const app = make({ products, counts: unique }, fault ? FAULT_EDITS[fault] : {})
      const next = { id: 300, count: 100 }
      for (let step = 0; step < steps && !miss; step++) {
        const roll = pick(9)
        const pool = app.raw.prepare('SELECT id FROM products ORDER BY id').all().map((row) => row.id)
        const id = pool[pick(pool.length)]
        if (roll === 0) app.raw.prepare("INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,created_at,updated_at) VALUES(?,?,?,?,0,1,4000,1,4000,'Brand','Cat',?,?,'2026-09-01 00:00:00','2026-09-01 00:00:00')").run([next.id, `New ${next.id}`, `S${next.id}`, `B${next.id}`, pick(2), pick(5) === 0 ? 1 : 0]), next.id++
        else if (roll === 1) { if (!app.raw.prepare('SELECT 1 FROM inventory_check_items WHERE product_id = ?').get([id])) app.raw.prepare('DELETE FROM products WHERE id = ?').run([id]) }
        else if (roll === 2) app.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run([id])
        else if (roll === 3) app.raw.prepare('UPDATE products SET is_active = 1 WHERE id = ?').run([id])
        else if (roll === 4) app.raw.prepare('UPDATE products SET is_group = 1 - COALESCE(is_group, 0) WHERE id = ?').run([id])
        else if (roll === 5) app.raw.prepare("UPDATE products SET name = name || 'x', selling_price_usd = 7 WHERE id = ?").run([id])
        else if (roll === 6) { addCount(app.raw, { product: id, state: r() > 0.5 ? 'done' : 'issue', at: T(61 + next.count) }, `n${next.count++}`); await app.load('lib/cache.ts').bumpVersion(app.env, 'inventory_checks') }
        else if (roll === 7) { /* nothing written: a repeat open, served warm */ }
        else {
          // restore mode: the population changes while the triggers stand down, then the restore's last step runs
          app.raw.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('maintenance', '{\"mode\":\"restore\"}')").run()
          app.raw.prepare('UPDATE products SET is_active = 1 - is_active WHERE id = ?').run([id])
          app.raw.prepare("DELETE FROM system_flags WHERE key = 'maintenance'").run()
          await app.load('lib/dataEpoch.ts').rotateDataEpoch(app.env)
        }
        for (const branch of [1]) {
          const s = await summaryOf(app, `/api/inventory-checks/list?branchId=${branch}`), want = truth(app, branch)
          if (!s || JSON.stringify(figures(s)) !== JSON.stringify(want)) miss = { seed, step, roll, got: s && figures(s), want }
          const o = await summaryOf(app, `/api/inventory-checks/overlay?branchId=${branch}&ids=${pool.slice(0, 3).join(',') || 0}`)
          if (!o || JSON.stringify(figures(o)) !== JSON.stringify(want)) miss = miss || { seed, step, roll, overlay: o && figures(o), want }
        }
      }
    }
    return miss
  }
  const FAULT_EDITS = {
    'the products version in the key': { [LIST]: [['readPopulationToken(env)])', "(async () => { const v = await getVersionWithFallback(env, 'products'); return v })()])"]] },
  }
  const good = await randomRoutes(null, 14, 40)
  check('14 seeds x 40 random writes (create, delete, retire, reactivate, header toggle, other columns, a saved count, a repeat open, a restore-mode write followed by the epoch step): /list and /overlay equal the brute-force truth every time, with no products version bumped', good === null, () => JSON.stringify(good))
  const keyed = await randomRoutes('the products version in the key', 14, 40).catch((error) => { if (process.env.KEEP_GOING) return 'not applicable to this tip'; throw error })
  check('mutant "the products version in the key" is killed (a write that moves no cache version leaves the old figure)', keyed !== null, 'survived')

  // ---- the restore step ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const app = make(HEADERS)
    const before = app.raw.prepare('SELECT stamp AS token FROM inventory_population_token').get().token, epochBefore = app.raw.prepare("SELECT value FROM system_flags WHERE key = 'data_epoch'").get().value
    await app.load('lib/dataEpoch.ts').rotateDataEpoch(app.env)
    const after = app.raw.prepare('SELECT stamp AS token FROM inventory_population_token').get().token, epochAfter = app.raw.prepare("SELECT value FROM system_flags WHERE key = 'data_epoch'").get().value
    check('rotateDataEpoch (the step every restore and every reset ends with) writes a fresh token as well as a fresh epoch', after !== before && /^[0-9a-f]{16}$/.test(after) && epochAfter !== epochBefore)
    let mutant
    try { mutant = make(HEADERS, { 'lib/dataEpoch.ts': [['await db.prepare(ROTATE_POPULATION_TOKEN_SQL).run()', "await db.prepare('SELECT 1').run()"]] }) } catch (error) { if (!process.env.KEEP_GOING) throw error }
    if (!mutant) mutant = make(HEADERS)
    const was = mutant.raw.prepare('SELECT stamp AS token FROM inventory_population_token').get().token
    await mutant.load('lib/dataEpoch.ts').rotateDataEpoch(mutant.env)
    check('mutant "the restore step does not refresh the token" is killed', mutant.raw.prepare('SELECT stamp AS token FROM inventory_population_token').get().token === was)
  }
  {
    // a database without the 0317 table (a fixture, an older restore point): the epoch step still completes, only that absence is tolerated, and the counts are computed uncached
    const app = make({ products: rowsOf(4, 'Bare', 800), counts: [{ product: 800, state: 'done', at: T(1) }] })
    for (const kind of ['insert', 'delete', 'update']) app.raw.exec(`DROP TRIGGER inventory_population_token_products_${kind}`)
    app.raw.exec('DROP TABLE inventory_population_token')
    const epochOf = () => app.raw.prepare("SELECT value FROM system_flags WHERE key = 'data_epoch'").get().value
    const epochBefore = epochOf()
    let thrown = null
    try { await app.load('lib/dataEpoch.ts').rotateDataEpoch(app.env) } catch (error) { thrown = error }
    check(`rotateDataEpoch completes without the token table (${thrown && thrown.message})`, thrown === null && epochOf() !== epochBefore)
    const COUNT = /COUNT\(\*\) AS n FROM products p/
    const counted = async () => { const mark = app.mark(); const summary = (await app.get('/api/inventory-checks/overlay?branchId=1&ids=800')).json.summary; return { summary, counts: app.since(mark).filter((sql) => COUNT.test(sql)).length } }
    const one = await counted(), two = await counted()
    check(`without the table every open counts again, nothing is cached on a token (${one.counts}, ${two.counts})`, one.counts === 1 && two.counts === 1)
    app.raw.prepare('UPDATE products SET is_active = 0 WHERE id = 803').run()
    const three = await counted()
    check(`and the figures follow the rows at once (${JSON.stringify(figures(three.summary))})`, JSON.stringify(figures(three.summary)) === JSON.stringify(truth(app, 1)) && three.summary.total === 3)
    // any other failure of the token step is still a failure
    const failing = { ...app.env, DB: { ...app.env.DB, prepare: (sql) => { if (/inventory_population_token/.test(sql)) throw new Error('disk I/O error'); return app.env.DB.prepare(sql) } } }
    let other = null
    try { await app.load('lib/dataEpoch.ts').rotateDataEpoch(failing) } catch (error) { other = error }
    check('an error other than the missing table is not swallowed', other !== null && /disk I\/O error/.test(other.message))
  }
  {
    // the epoch is in every cache key, so a cached count from before a restore is unreachable after it even before the token is read
    const app = make(HEADERS), keys = app.load('lib/cacheKey.ts'), identity = keys.cacheIdentity({ env: app.env })
    const keyFor = async () => (await keys.cacheKeyRequest('https://ic.invalid/__bos/ic-population?order=2', 'icn:0123456789abcdef', identity))?.url
    const before = await keyFor()
    await app.load('lib/dataEpoch.ts').rotateDataEpoch(app.env)
    const after = await keyFor()
    check('the data epoch is part of the population cache key: the same token under a new epoch is another key', typeof before === 'string' && typeof after === 'string' && before !== after)
  }
  for (const [file, minimum] of [['routes/backups.ts', 3], ['routes/system.ts', 4]]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')
    const calls = (source.match(/rotateDataEpoch\(|rotateEpochAfterReset\(/g) || []).length
    check(`${file} ends every restore / reset with the epoch step (${calls} call sites, at least ${minimum})`, calls >= minimum)
  }

  // ---- consistency: ok + issue never exceeds total, also when a bump failed ----------------------------------------------------------------------------------------------------------------------
  {
    const world = { products: [...rowsOf(3, 'Alpha', 100), { id: 103, name: 'Alpha', active: false }], counts: [100, 101, 102, 103].map((product, i) => ({ product, state: 'done', at: T(i + 1) })) }
    const app = make(world)
    const first = await summaryOf(app)
    check('before: 3 members all counted, the count on the retired 103 is in no figure', JSON.stringify(figures(first)) === '{"ok":3,"issue":0,"not_checked":0,"total":3}', () => JSON.stringify(first))
    const cache = app.load('lib/cache.ts')
    const broken = { ...app.env, CACHE: { get: async () => { throw new Error('kv down') }, put: async () => { throw new Error('kv down') }, delete: async () => { throw new Error('kv down') } },
      DB: { ...app.env.DB, prepare: () => { throw new Error('d1 down') }, batch: async () => { throw new Error('d1 down') } } }
    app.raw.prepare('UPDATE products SET is_active = 1 WHERE id = 103').run()
    let swallowed = true
    try { await cache.bumpVersions(broken, ['products']) } catch { swallowed = false }
    check('the products bump that follows the reactivation fails and is swallowed (bumpVersions never throws)', swallowed)
    addCount(app.raw, { product: 100, state: 'done', at: T(9) }, 'again'); await cache.bumpVersion(app.env, 'inventory_checks')
    const second = await summaryOf(app)
    check(`after the failed bump: total 4 from the rows themselves, ok 4, Not checked 0, and ok + issue never exceeds total (${JSON.stringify(figures(second))})`, JSON.stringify(figures(second)) === '{"ok":4,"issue":0,"not_checked":0,"total":4}' && second.ok + second.issue <= second.total)
  }

  // ---- a membership change between the token read and the population batch, with the count still cached under the old token ----------------------------------------------------------------------
  // The reuse of a cached total is accepted only when the batch's own token is the one it was cached under; otherwise the three are read again together.
  {
    const RACE = { products: [...rowsOf(4, 'Race', 1000), { id: 1004, name: 'Race', active: false }], counts: [0, 1, 2, 3, 4].map((i) => ({ product: 1000 + i, state: 'done', at: T(i + 1) })) }
    const NO_RECHECK = { [LIST]: [['    if (seen.token === token) return { total: cached, inList: seen.inList }', '    if (seen.token === token || true) return { total: cached, inList: seen.inList }']] }
    const raced = async (edits) => {
      const app = make(RACE, edits), cache = app.load('lib/cache.ts'), url = '/api/inventory-checks/list?branchId=1&page=1&pageSize=10'
      const first = (await app.get(url)).json.summary
      await cache.bumpVersion(app.env, 'inventory_checks')
      const realBatch = app.env.DB.batch
      let armed = true
      app.env.DB.batch = async (statements) => {
        if (armed && statements.some((s) => /inventory_population_token/.test(String(s.sql)))) { armed = false; app.raw.prepare('UPDATE products SET is_active = 1 WHERE id = 1004').run() }
        return realBatch(statements)
      }
      const summary = (await app.get(url)).json.summary
      app.env.DB.batch = realBatch
      return { first, summary, fired: !armed, want: truth(app, 1) }
    }
    const good = await raced({})
    check(`a row entering between the token read and the batch: the figures equal the rows (${JSON.stringify(figures(good.summary))}) and ok + issue never exceeds total`, good.fired && JSON.stringify(figures(good.summary)) === JSON.stringify(good.want) && good.summary.ok + good.summary.issue <= good.summary.total, () => JSON.stringify(good))
    const mutant = await raced(NO_RECHECK).catch((error) => { if (process.env.KEEP_GOING) return null; throw error })
    check(`mutant "a cached total reused without the token re-check" is killed (${mutant && JSON.stringify(figures(mutant.summary))})`, mutant === null || JSON.stringify(figures(mutant.summary)) !== JSON.stringify(mutant.want) || mutant.summary.ok + mutant.summary.issue > mutant.summary.total, 'survived')
  }

  // ---- reads during a restore: the triggers stand down, so nothing is cached or reused on the frozen token ------------------------------------------------------------------------------------------
  {
    const world = { products: [...rowsOf(3, 'Restore', 1100), { id: 1103, name: 'Restore', active: false }, { id: 1104, name: 'Restore', active: false }], counts: [0, 1, 2, 3, 4].map((i) => ({ product: 1100 + i, state: 'done', at: T(i + 1) })) }
    const app = make(world), cache = app.load('lib/cache.ts')
    const consistent = (s) => JSON.stringify(figures(s)) === JSON.stringify(truth(app, 1)) && s.ok + s.issue <= s.total && s.not_checked >= 0
    const before = await summaryOf(app)
    check(`before the restore: 3 members, all counted (${JSON.stringify(figures(before))})`, JSON.stringify(figures(before)) === '{"ok":3,"issue":0,"not_checked":0,"total":3}')
    const frozen = tokenOf(app.raw)
    setRestore(app.raw, true)
    app.raw.prepare('UPDATE products SET is_active = 1 WHERE id IN (1103, 1104)').run()
    const during = []
    during.push(await summaryOf(app))
    app.setUser(app.users.receivedOnly); app.clearCaches(); app.kv.clear()
    during.push(await summaryOf(app))
    during.push(await summaryOf(app))
    app.setUser(app.users.checker)
    during.push(await summaryOf(app))
    check(`every read during the restore equals the rows and is consistent (${during.map((s) => JSON.stringify(figures(s))).join(' ')})`, during.every(consistent), () => JSON.stringify(during.map(figures)))
    check('the token stayed frozen through the restore writes (the guard of 0124), which is why no count may be cached on it', tokenOf(app.raw) === frozen)
    setRestore(app.raw, false)
    await app.load('lib/dataEpoch.ts').rotateDataEpoch(app.env)
    await cache.bumpVersion(app.env, 'inventory_checks')
    const after = await summaryOf(app)
    check(`after the release the counts are correct (${JSON.stringify(figures(after))})`, consistent(after) && after.total === 5, () => JSON.stringify(after))
  }

  // ---- reads: what each open costs ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const app = make({ products: rowsOf(6, 'Reads', 700), counts: [{ product: 700, state: 'done', at: T(1) }] })
    const TOKEN = /FROM inventory_population_token/, COUNT = /COUNT\(\*\) AS n FROM products p/, SEEK = /SELECT p\.id AS id FROM products p/
    const run = async (url) => { const mark = app.mark(), batches = app.batches.length; await app.get(url); const used = app.since(mark); return { token: used.filter((s) => TOKEN.test(s)).length, count: used.filter((s) => COUNT.test(s)).length, seek: used.filter((s) => SEEK.test(s)).length, batched: app.batches.slice(batches).filter((b) => TOKEN.test(b.sql) || COUNT.test(b.sql) || SEEK.test(b.sql)).length } }
    const cold = await run('/api/inventory-checks/overlay?branchId=1&ids=700')
    check(`a cold open reads the token for the key, then the token, the count and the seek in ONE batch (${JSON.stringify(cold)})`, cold.token === 2 && cold.count === 1 && cold.seek === 1 && cold.batched === 3)
    const warm = await run('/api/inventory-checks/overlay?branchId=1&ids=700')
    check(`a warm open reads the token only: one statement (${JSON.stringify(warm)})`, warm.token === 1 && warm.count === 0 && warm.seek === 0 && warm.batched === 0)
    const row = app.raw.prepare('SELECT COUNT(*) AS n FROM inventory_population_token').get().n
    check('the token table holds exactly one row', row === 1)
    await app.load('lib/cache.ts').bumpVersion(app.env, 'inventory_checks')
    const saved = await run('/api/inventory-checks/overlay?branchId=1&ids=700')
    check(`after a saved count only the seek reruns, in a batch with the token, and the cached total is reused (${JSON.stringify(saved)})`, saved.count === 0 && saved.seek === 1 && saved.token === 2 && saved.batched === 2)
    app.raw.prepare('UPDATE products SET is_active = 0 WHERE id = 705').run()
    const moved = await run('/api/inventory-checks/overlay?branchId=1&ids=700')
    check(`a retire moves the token: the next open counts and seeks again in one batch (${JSON.stringify(moved)})`, moved.count === 1 && moved.seek === 1 && moved.batched === 3)
    app.raw.prepare("UPDATE products SET name = 'Renamed', selling_price_usd = 4 WHERE id = 701").run()
    const unrelated = await run('/api/inventory-checks/overlay?branchId=1&ids=700')
    check(`an update of other columns leaves the token, so the open is warm again (${JSON.stringify(unrelated)})`, unrelated.count === 0 && unrelated.seek === 0 && unrelated.token === 1)
    const noBranch = await run('/api/inventory-checks/overlay?branchId=1&ids=700&summary=0')
    check('summary=0 reads no token at all', noBranch.token === 0 && noBranch.count === 0)
    // the by-id refresh after a Fix stock Set: the page keeps its figures, so the list read asks for none
    app.clearCaches()
    const refreshed = await run('/api/inventory-checks/list?ids=701&branchId=1&summary=0')
    check(`the by-id refresh (list ids=..&branchId=..&summary=0) builds no summary: no token, no count, no seek, no sets (${JSON.stringify(refreshed)})`, refreshed.token === 0 && refreshed.count === 0 && refreshed.seek === 0)
    const asked = await run('/api/inventory-checks/list?ids=701&branchId=1')
    check(`the same read without summary=0 does build one (${JSON.stringify(asked)}), which is what the page was paying for and throwing away`, asked.token >= 1)
  }
  if (failures) { console.log(`${failures} checks failed`); process.exit(1) }
  console.log(`PASS test-inventory-population-token-native (${checks} checks)`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
