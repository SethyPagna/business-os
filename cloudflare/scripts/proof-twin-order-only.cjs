'use strict'
// PROOF, not a test (not named test-*.cjs, so the sweep does not run it): lane/no-folded-duplicates round 3.
// The lane changed the order of the rows INSIDE one name family (unmerged twins next to each other: familyPagination.ts intraFamilyNameBarcodeSql and its callers).
// That changes the SQL text of the Inventory Check page statements and the order of rows in some recorded responses, so test-products-search-read-cost-native.cjs (response
// hashes), test-read-switch-off-is-exact-native.cjs and test-inventory-check-off-exact-native.cjs (statement fingerprints) were red. Before those recordings are replaced this
// script shows, for every shape it runs:
//   0. CONTROL: the same code with the order clauses put back to their text at the base (an in-memory source patch, as a mutant) reproduces the RECORDED response hash / SQL
//      fingerprints exactly. So the patch is the base, and the recording is the base.
//   1. the current code returns exactly the same SET of rows, each row with identical contents, and identical fields outside the row list (totals, page, stats);
//   2. the family at every position of the list is the same, so only the order INSIDE a family moved;
//   3. inside a family the rows are in the documented new order: name key, rows without a barcode last, barcode identity key, then the sort's tail, then id;
//   4. D1 statements and rows read are equal.
// A shape whose response has no row list must be byte-identical.
// Run (from cloudflare/):  node scripts/proof-twin-order-only.cjs products   |   node scripts/proof-twin-order-only.cjs budget
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const FP = path.join(__dirname, 'read-budget', 'fingerprints')
// The recordings this proof compares the base-order code with are the ones that stood BEFORE 0d25bde59 re-recorded them for the lane's order, so the proof reads them from
// git at the last commit that carried them (36676922a), not from the working tree, where they are now the lane's own. That is what lets it be re-run at any later commit
// (at HEAD it used to fail with CONTROL FAILED because it read the re-recorded hashes).
const RECORDED_AT = '36676922a'
const recordedFile = (file) => execFileSync('git', ['show', `${RECORDED_AT}:cloudflare/scripts/${file}`], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } })
// The order clauses as they were at the base (acbb7e455), as in-memory source patches.
const PATCHES = [
  { name: 'shared', file: 'src/lib/familyPagination.ts',
    from: 'export const INTRA_FAMILY_NAME_BARCODE_SQL = intraFamilyNameBarcodeSql()', to: "export const INTRA_FAMILY_NAME_BARCODE_SQL = 'lower(name) ASC'" },
  { name: 'products', file: 'src/routes/products.ts',
    from: `  const intraFamilyOrderSql = [
    INTRA_FAMILY_NAME_BARCODE_SQL,
    sort === 'created_desc' ? 'created_at DESC, id DESC' : sort === 'created_asc' ? 'created_at ASC, id ASC' : 'id ASC',
  ].join(', ')`,
    to: `  const intraFamilyOrderSql =
    sort === 'created_desc' ? 'created_at DESC, id DESC'
    : sort === 'created_asc' ? 'created_at ASC, id ASC'
    : sort === 'name_desc' ? 'lower(name) DESC, id ASC'
    : 'lower(name) ASC, id ASC'` },
  { name: 'ic-flat', file: 'src/lib/inventoryCheckProducts.ts',
    from: "const IC_INTRA_FAMILY_ORDER_SQL = `${intraFamilyNameBarcodeSql('name', '__code_barcode')}, id ASC`", to: "const IC_INTRA_FAMILY_ORDER_SQL = 'id ASC'" },
  { name: 'ic-page', file: 'src/lib/inventoryCheckProducts.ts',
    from: "const IC_PAGE_INTRA_ORDER_SQL = `${intraFamilyNameBarcodeSql('__page.name', '__page.__code_barcode')}, __page.id ASC`", to: "const IC_PAGE_INTRA_ORDER_SQL = '__page.id ASC'" },
]

const lower = (v) => String(v ?? '').trim().toLowerCase()
// identityBarcodeKey as the server clause computes it: digits only, leading zeros folded when 3 or more digits remain.
const codeKey = (barcode) => { const c = lower(barcode); const stripped = c.replace(/^0+/, ''); return /^[0-9]+$/.test(c) && stripped.length >= 3 ? stripped : c }
const itemsOf = (json) => (Array.isArray(json) ? json : json && Array.isArray(json.items) ? json.items : null)
const sha = (text) => createHash('sha256').update(text).digest('hex')
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// The sort tail that follows name and barcode inside a family.
const tailFor = (sort) => (x, y) => {
  if (sort === 'created_desc') return cmp(String(y.created_at), String(x.created_at)) || Number(y.id) - Number(x.id)
  if (sort === 'created_asc') return cmp(String(x.created_at), String(y.created_at)) || Number(x.id) - Number(y.id)
  return Number(x.id) - Number(y.id)
}

// Families of a list: rows are linked when they share a name, or one is the other's parent, or they share a parent (the links the server's family key and the explicit parent_id
// structure give). componentOf(row) is the same for every row of one family, whichever other rows of it happen to sit in a moved stretch.
function familiesOf(rows) {
  const parent = rows.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const link = new Map()
  const add = (key, i) => { if (link.has(key)) parent[find(link.get(key))] = find(i); else link.set(key, i) }
  rows.forEach((r, i) => { add('n:' + lower(r.name), i); add('r:' + r.id, i); add('r:' + (r.parent_id || r.id), i) })
  const component = new Map(rows.map((r, i) => [r.id, find(i)]))
  return (row) => component.get(row.id)
}

function compareBodies(label, laneJson, baseJson, tail) {
  const lane = itemsOf(laneJson), base = itemsOf(baseJson)
  assert.ok(lane && base, `${label}: the response has a row list`)
  assert.equal(lane.length, base.length, `${label}: same number of rows (${lane.length} vs ${base.length})`)
  const rest = (json) => JSON.stringify(Array.isArray(json) ? null : Object.fromEntries(Object.entries(json).filter(([k]) => k !== 'items')))
  assert.equal(rest(laneJson), rest(baseJson), `${label}: every field outside the row list is identical`)
  const byId = (rows) => new Map(rows.map((r) => [Number(r.id), JSON.stringify(r)]))
  const l = byId(lane), b = byId(base)
  assert.equal(l.size, lane.length, `${label}: no row twice`)
  assert.deepEqual([...l.keys()].sort((x, y) => x - y), [...b.keys()].sort((x, y) => x - y), `${label}: the same set of rows`)
  for (const [id, text] of b) assert.equal(l.get(id), text, `${label}: row ${id} has identical contents`)
  // Segments: the shortest stretches whose first k rows are the same SET in both lists. Rows only ever move inside their own segment.
  const open = new Map()
  const segments = []
  let start = 0
  for (let i = 0; i < lane.length; i += 1) {
    open.set(lane[i].id, (open.get(lane[i].id) || 0) + 1)
    open.set(base[i].id, (open.get(base[i].id) || 0) - 1)
    if (open.get(lane[i].id) === 0) open.delete(lane[i].id)
    if (open.get(base[i].id) === 0) open.delete(base[i].id)
    if (open.size === 0) { segments.push([start, i + 1]); start = i + 1 }
  }
  assert.equal(start, lane.length, `${label}: the lists end together`)
  const familyOf = familiesOf(lane)
  let reordered = 0, explicit = 0, plain = 0, pairs = 0
  for (const [from, to] of segments) {
    const rows = lane.slice(from, to), was = base.slice(from, to)
    if (JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(was.map((r) => r.id))) continue
    reordered += 1
    assert.equal(new Set(rows.map(familyOf)).size, 1, `${label}: rows ${from}..${to - 1} moved but are not one family`)
    if (rows.some((r) => r.parent_id || Number(r.is_group) === 1)) { explicit += 1; continue }
    plain += 1
    const expected = [...rows].sort((x, y) => {
      const byName = cmp(lower(x.name), lower(y.name))
      if (byName) return byName
      const ex = lower(x.barcode) === '', ey = lower(y.barcode) === ''
      if (ex !== ey) return ex ? 1 : -1
      return cmp(codeKey(x.barcode), codeKey(y.barcode)) || tail(x, y)
    })
    assert.deepEqual(rows.map((r) => r.id), expected.map((r) => r.id), `${label}: rows ${from}..${to - 1} are in name, barcode, tail, id order`)
  }
  for (let i = 1; i < lane.length; i += 1) if (lower(lane[i].barcode) && lower(lane[i].name) === lower(lane[i - 1].name) && codeKey(lane[i].barcode) === codeKey(lane[i - 1].barcode)) pairs += 1
  return { rows: lane.length, segments: segments.length, reordered, plain, explicit, pairs }
}

const AMBIENT_SQL = /telegram_scheduled_sends|FROM system_flags WHERE key IN|UPDATE user_sessions SET last_seen_at/
const same = (label, laneText, baseText) => { assert.equal(laneText, baseText, `${label}: a response with no row list is byte-identical`) }

async function products() {
  const { openWorld } = require('./harness/read-cost-world.cjs')
  const { catalogFixture } = require('./harness/read-cost-fixture.cjs')
  const src = fs.readFileSync(path.join(__dirname, 'test-products-search-read-cost-native.cjs'), 'utf8')
  const segment = src.slice(src.indexOf('const SEARCH = '), src.indexOf('const GOLDEN = '))
  const { ALL_ROUTES, UPC_ROWS, UPC_BATTERY } = new Function('require', `${segment}; return { ALL_ROUTES, UPC_ROWS, UPC_BATTERY }`)(require)
  // The recorded response hashes, as they were before the re-record (the route list above is the same in both).
  const golden = {}
  for (const m of recordedFile('test-products-search-read-cost-native.cjs').matchAll(/^\s+(\w+): \['([0-9a-f]{64})', (\d+), (\d+)\]/gm)) golden[m[1]] = m[2]
  const run = async (patches) => {
    const world = await openWorld(catalogFixture(2000, 3000), patches)
    try {
      const out = {}
      for (const [label, route] of Object.entries(ALL_ROUTES)) {
        if (process.env.PROOF_ONLY && !new RegExp(process.env.PROOF_ONLY).test(label)) continue
        if (label === Object.keys(UPC_BATTERY)[0]) for (const [id, barcode] of Object.entries(UPC_ROWS)) await world.db.prepare('UPDATE products SET barcode = ? WHERE id = ?').bind(barcode, Number(id)).run()
        out[label] = await world.call(route)
      }
      return out
    } finally { await world.dispose() }
  }
  const base = await run(PATCHES.filter((p) => p.name === 'shared' || p.name === 'products'))
  const lane = await run([])
  let identical = 0, reorderedShapes = 0
  const rows = []
  for (const label of Object.keys(ALL_ROUTES).filter((l) => base[l])) {
    assert.equal(base[label].status, 200, `${label}: base-order status`)
    assert.equal(lane[label].status, 200, `${label}: lane status`)
    assert.equal(sha(base[label].text), golden[label], `${label}: CONTROL FAILED, the base-order patch does not reproduce the recorded hash`)
    // Ambient statements (the scheduled-send drain, a throttled session touch, a flags refresh) land on whichever request is next; they are not part of a shape.
    const own = (r) => r.log.filter((e) => !AMBIENT_SQL.test(e.sql))
    // The same statements in the same order; a statement may differ from its base text only in an ORDER BY clause (the patches replace exactly those constants).
    assert.equal(own(lane[label]).length, own(base[label]).length, `${label}: the same number of statements`)
    own(lane[label]).forEach((e, i) => { const was = own(base[label])[i].sql; if (e.sql !== was) assert.ok(/ORDER BY/.test(e.sql) && /ORDER BY/.test(was) && e.sql.replace(/\s+/g, ' ').slice(0, 60) === was.replace(/\s+/g, ' ').slice(0, 60), `${label}: statement ${i} differs outside an ORDER BY statement`) })
    const textDiffers = own(lane[label]).filter((e, i) => e.sql !== own(base[label])[i].sql).length
    assert.equal(own(lane[label]).reduce((n, e) => n + e.rows, 0), own(base[label]).reduce((n, e) => n + e.rows, 0), `${label}: same rows read`)
    if (process.env.PROOF_SQL) for (const w of [['lane', lane], ['base', base]]) for (const e of w[1][label].log) { const i = e.sql.lastIndexOf('ORDER BY'); if (/family_root_id/.test(e.sql.slice(i))) console.error(w[0], e.sql.slice(i, i + 700)) }
    if (lane[label].text === base[label].text) { identical += 1; continue }
    const sort = /sort=(\w+)/.exec(ALL_ROUTES[label]) ? /sort=(\w+)/.exec(ALL_ROUTES[label])[1] : 'name_asc'
    let f
    try { f = compareBodies(label, JSON.parse(lane[label].text), JSON.parse(base[label].text), tailFor(sort)) } catch (error) {
      const show = (text) => itemsOf(JSON.parse(text)).map((r, i) => [i, r.id, r.name, r.parent_id || '', r.is_group || '', r.created_at, r.barcode || ''].join(':')).slice(Number(process.env.PROOF_FROM || 0), Number(process.env.PROOF_TO || 40)).join(String.fromCharCode(10))
      console.error(['--- ' + label + ' lane', show(lane[label].text), '--- base', show(base[label].text)].join(String.fromCharCode(10)))
      throw error
    }
    reorderedShapes += 1
    rows.push(`${label} | recorded hash reproduced by base-order control | ${f.rows} rows, same set and contents | ${f.reordered} of ${f.segments} families reordered inside (${f.plain} plain name families in exact name/barcode/tail order, ${f.explicit} parent/child families) | ${f.pairs} adjacent same-barcode pairs | statements ${own(lane[label]).length}=${own(base[label]).length} (${textDiffers} with new ORDER BY text)`)
  }
  console.log(rows.join('\n'))
  console.log(`PROOF products-search: ${Object.keys(ALL_ROUTES).length} shapes; the base-order control reproduces all ${Object.keys(ALL_ROUTES).length} recorded hashes; ${identical} are byte-identical now; ${reorderedShapes} differ and each differs only by the order of rows inside a family`)
}

async function budget() {
  const { bootWorld, runShape } = require('./read-budget/world.cjs')
  const { getShapes } = require('./read-budget/shapes.cjs')
  const { loadBudgets } = require('./read-budget/budgets.cjs')
  const { prepareWorld, resolveUrl } = require('./read-budget/runner.cjs')
  const routeOf = new Map(loadBudgets().shapes.map((s) => [s.id, s.route]))
  const SWITCH_OFF = ['products-search-pos-page-name-asc-family-metadata-0', 'products-search-pos-text', 'products-bootstrap-pos-first-load', 'inventory-checks-products-all-time-name-page-check-default']
  const recordedOf = (id) => {
    const file = path.join(FP, String(routeOf.get(id)).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.json')
    return JSON.parse(fs.readFileSync(file, 'utf8'))[id]
  }
  const fingerprintsOf = (m) => (m.fingerprints || []).map((f) => [f.h, f.head])
  // A request may carry the scheduled-send drain and a flags refresh (test-read-switch-off-is-exact-native.cjs explains); they are not part of a shape.
  const AMBIENT = /telegram_scheduled_sends|FROM system_flags WHERE key IN|^UPDATE user_sessions SET last_seen_at/
  const clean = (m) => ({ ...m, fingerprints: (m.fingerprints || []).filter((f) => !AMBIENT.test(String(f.head))) })
  const ids = (() => {
    const world = null
    void world
    const seed = getShapes(require('./read-budget/seed.cjs').seedContext())
    return [...new Set([...SWITCH_OFF, ...seed.filter((s) => s.url.startsWith('/api/inventory-checks/products') && !s.switches).map((s) => s.id)])]
  })()
  const sample = async (patches) => {
    const world = await bootWorld({ tier: 'free', patches })
    try {
      await prepareWorld(world)
      await world.restart()
      await world.login()
      const shapes = getShapes(world.ctx).filter((s) => ids.includes(s.id))
      assert.equal(shapes.length, ids.length, 'every named shape exists')
      const out = new Map()
      for (const shape of shapes) {
        const url = await resolveUrl(world, shape.url)
        out.set(shape.id, { url, m: clean(await runShape(world, { method: 'GET', url, anon: shape.anon }, { cold: false, cacheMiss: true, fingerprints: true })) })
      }
      return out
    } finally { await world.dispose() }
  }
  const base = await sample(PATCHES)
  const lane = await sample([])
  const rows = []
  let changedSql = 0
  for (const id of ids) {
    const b = base.get(id).m, l = lane.get(id).m
    const rec = recordedOf(id).filter(([, head]) => !AMBIENT.test(String(head)))
    if (JSON.stringify(fingerprintsOf(l)) !== JSON.stringify(rec)) changedSql += 1
    // A request may carry an ambient statement (flags refresh, session touch, a few rows): the ORDER BY changes no read, so the totals agree to within that.
    assert.ok(Math.abs(l.rowsRead - b.rowsRead) <= 8, `${id}: rows read ${l.rowsRead} vs ${b.rowsRead}`)
    assert.equal(l.fingerprints.length, b.fingerprints.length, `${id}: same number of statements`)
    let facts = ''
    if (itemsOf(l.json)) {
      const url = base.get(id).url
      const sort = /sortBy=(\w+)/.exec(url) ? /sortBy=(\w+)/.exec(url)[1] : 'name'
      void sort
      const f = compareBodies(id, l.json, b.json, tailFor('name_asc'))
      facts = `${f.rows} rows, same set and contents | ${f.reordered} of ${f.segments} families reordered inside (${f.plain} plain name families in exact name/barcode/tail order, ${f.explicit} parent/child families) | ${f.pairs} adjacent same-barcode pairs`
    } else { same(id, JSON.stringify(l.json), JSON.stringify(b.json)); facts = 'no row list: byte-identical' }
    rows.push(`${id} | SQL text differs from the recording now: ${JSON.stringify(fingerprintsOf(l)) !== JSON.stringify(rec)} | ${facts} | statements ${l.fingerprints.length}, rows read lane ${l.rowsRead} vs base-order ${b.rowsRead}`)
  }
  console.log(rows.join('\n'))
  console.log(`PROOF budget world: ${ids.length} shapes; ${changedSql} shapes' SQL text differs now, each with the same rows, contents, statements and rows read`)
}

// Re-records the statement fingerprints the two recording tests compare, for the shapes whose SQL text changed only in an ORDER BY clause. Each recorded entry is kept as it is, except
// that the hash of a statement is replaced by the current one when its text head is the same (so no statement may be added, dropped or moved): the recording is patched, not rebuilt.
// The Inventory Check shapes are measured exactly as test-inventory-check-off-exact-native.cjs measures them (a fresh isolate, the priming read, then the shape); the three Products
// shapes as test-read-switch-off-is-exact-native.cjs does (the first request after a restart).
async function rerecord() {
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10)
  const { bootWorld, runShape } = require('./read-budget/world.cjs')
  const { getShapes } = require('./read-budget/shapes.cjs')
  const { loadBudgets } = require('./read-budget/budgets.cjs')
  const { prepareWorld, resolveUrl } = require('./read-budget/runner.cjs')
  const routeOf = new Map(loadBudgets().shapes.map((s) => [s.id, s.route]))
  const AMBIENT = [/^UPDATE user_sessions SET last_seen_at/, /^SELECT send_key FROM telegram_scheduled_sends/]
  const ambient = ([, head]) => AMBIENT.some((pattern) => pattern.test(head))
  const PRIME = '/api/inventory-checks/sessions?branchId=1&page=1&pageSize=1'
  const products = ['products-search-pos-page-name-asc-family-metadata-0', 'products-search-pos-text', 'products-bootstrap-pos-first-load']
  const seed = getShapes(require('./read-budget/seed.cjs').seedContext())
  const icIds = seed.filter((x) => x.url.startsWith('/api/inventory-checks/products') && !x.switches).map((x) => x.id)
  const fileOf = (id) => path.join(FP, String(routeOf.get(id)).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.json')
  const world = await bootWorld({ tier: 'free' })
  const now = new Map()
  try {
    await prepareWorld(world)
    for (const id of icIds) {
      const shape = getShapes(world.ctx).find((x) => x.id === id)
      const url = shape.url.includes('{{') ? shape.url.replaceAll('{{checkId}}', world.state.checkId) : shape.url
      const probe = { method: 'GET', url, prepare: async () => {}, run: async (w, send) => { await send('GET', PRIME); return await send('GET', url) } }
      const run = await runShape(world, probe, { cold: true, fingerprints: true })
      now.set(id, run.fingerprints.map((p) => [p.h, p.head]))
    }
    await world.restart()
    await world.login()
    for (const id of products) {
      const shape = getShapes(world.ctx).find((x) => x.id === id)
      const url = await resolveUrl(world, shape.url)
      const run = await runShape(world, { method: 'GET', url, anon: shape.anon }, { cold: false, cacheMiss: true, fingerprints: true })
      // The recorded lists are those of a request that finds the flags memo warm (the switch-off test measures auth-bootstrap first, which pays the one flags statement).
      now.set(id, run.fingerprints.filter((p) => !String(p.head).includes('telegram_scheduled_sends') && !String(p.head).includes('FROM system_flags WHERE key IN (?1, ?2)')).map((p) => [p.h, p.head]))
    }
  } finally { await world.dispose() }
  const files = new Map()
  const lines = []
  for (const [id, fresh] of now) {
    const file = fileOf(id)
    if (!files.has(file)) { const raw = fs.readFileSync(file, 'utf8'); files.set(file, { crlf: raw.includes(CR + LF), data: JSON.parse(raw) }) }
    const entry = files.get(file).data
    const recorded = entry[id]
    assert.ok(Array.isArray(recorded), id + ': a recorded list exists')
    const freshOwn = fresh.filter((p) => !ambient(p))
    let at = 0, changed = 0
    const patched = recorded.map((p) => {
      if (ambient(p)) return p
      const q = freshOwn[at++]
      assert.ok(q && q[1] === p[1], id + ': statement ' + (at - 1) + ' has the same head (' + (q && q[1].slice(0, 60)) + ' vs ' + p[1].slice(0, 60) + ')')
      if (q[0] === p[0]) return p
      changed += 1
      assert.ok(/ORDER BY|WITH |SELECT /.test(p[1]), id + ': a changed statement is a read')
      return [q[0], p[1]]
    })
    assert.equal(at, freshOwn.length, id + ': no statement added or dropped (' + at + ' of ' + freshOwn.length + ')')
    entry[id] = patched
    lines.push(id + ': ' + recorded.filter((p) => !ambient(p)).length + ' recorded statements, ' + changed + ' hash(es) updated')
  }
  for (const [file, { crlf, data }] of files) {
    let text = JSON.stringify(data, null, 1) + LF
    if (crlf) text = text.split(LF).join(CR + LF)
    fs.writeFileSync(file, text)
  }
  console.log(lines.join(LF))
  console.log('RE-RECORDED ' + now.size + ' shapes in ' + files.size + ' file(s)')
}

module.exports = { PATCHES }

if (require.main === module) (async () => {
  const mode = process.argv[2] || 'products'
  if (mode === 'products') await products()
  else if (mode === 'rerecord') await rerecord()
  else await budget()
})().catch((e) => { console.error('proof failed: ' + ((e && e.stack) || e)); process.exit(1) })
