// products_typed_order_js (default OFF), end to end in two Miniflare worlds on the same seed and fixtures: switch OFF (the seek-page statement) and switch ON (the family order in the Worker).
// Every GET /api/products/search body must be identical: items, order, total, totalPages, promotion rules. Fixtures (the refuter's A-J plus the analyst's): a promoted header with only its child listed (A),
// a standalone renamed into a header's name (B), a blank-named parent with a product literally named 'id:<parent id>' (C), a child of an inactive parent (D), a dangling parent_id (E), same-name siblings
// where only the unlisted one is discounted (F), fractional and zero branch stock on family members (G), a header listed alone (H), the names 'Twin Cream ', 'twin cream', 'twin  cream' (I) and 'Éclat Crème' / 'éclat crème' (I2: two families because SQLite lower() folds ASCII only), a brand
// promotion rule plus a discounted parent whose child is listed first (J), percent and fixed discounts (live, future, expired, zero), a category rule and a product-list rule, Khmer names.
// Lists: 40, 299, 300 and 1,500 ids (both sides of SEEK_PAGE_MIN_RANKED_IDS = 300, which the typed-order path respects), children before parents, a repeated id with two tiers, garbage tokens,
// an inactive id, a missing id, invalid tiers. Shapes: POS branch 1 and 2, the Products surface; name_asc and created_desc; 100 per page (pages 1 and 2) and one per page (pages 1, 3, 16); filters.
//
// Required reds (the same shapes, a mutated Worker, each must differ from OFF on at least one shape): the promoted-first-forgotten order, the member filter without the child-of-listed term,
// and a key map that lower-cases keys.
//
// Run: node scripts/test-typed-order-js-native.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { bootWorld, runShape, lastStatements } = require('./read-budget/world.cjs')

const sha = (value) => crypto.createHash('sha1').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 12)
let seed = 424242
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const SWITCH = 'products_typed_order_js'
const DRIVEN = /__rank_j/

async function permit(world, sql, values = []) {
  const flag = "INSERT OR REPLACE INTO system_flags (key, value) VALUES ('stock_transaction_permit', 'legacy-separate-pool-v1')"
  const r = await world.db.batch([world.db.prepare(flag), world.db.prepare(sql).bind(...values), world.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
  return r[1].meta.changes
}

// The same writes in every world; returns the ids the lists must carry.
async function applyFixtures(world) {
  const act = (await world.all('SELECT id, category, brand FROM products WHERE is_active = 1 ORDER BY id LIMIT 600')).map((r) => r)
  const id = (i) => act[i].id
  const inactive = (await world.all('SELECT id FROM products WHERE is_active = 0 ORDER BY id LIMIT 5')).map((r) => r.id)
  const log = []
  const writes = [
    // A: promoted header H (id 0) with children 1 and 2; only a child will be listed
    ['UPDATE products SET is_group = 1, discount_enabled = 1, discount_type = \'percent\', discount_percent = 10 WHERE id = ?', [id(0)]],
    ['UPDATE products SET parent_id = ? WHERE id IN (?, ?)', [id(0), id(1), id(2)]],
    // a second family whose header is plain
    ['UPDATE products SET is_group = 1 WHERE id = ?', [id(10)]],
    ['UPDATE products SET parent_id = ? WHERE id IN (?, ?)', [id(10), id(11), id(12)]],
    // B: a standalone renamed into the header's name joins the family by name_key
    ['UPDATE products SET name = (SELECT name FROM products WHERE id = ?) WHERE id = ?', [id(10), id(5)]],
    // C: a blank-named parent (family key id:N) with a child, and a product literally named id:<parent id>
    ["UPDATE products SET name = '', is_group = 1 WHERE id = ?", [id(20)]],
    ['UPDATE products SET parent_id = ? WHERE id = ?', [id(20), id(22)]],
    ['UPDATE products SET name = ? WHERE id = ?', ['id:' + id(20), id(23)]],
    // D: a child of an inactive parent, E: a dangling parent_id
    ['UPDATE products SET parent_id = ? WHERE id = ?', [inactive[0], id(30)]],
    ['UPDATE products SET parent_id = 99999990 WHERE id = ?', [id(31)]],
    // F: same-name siblings, only the unlisted one discounted
    ['UPDATE products SET name = (SELECT name FROM products WHERE id = ?) WHERE id = ?', [id(41), id(40)]],
    ["UPDATE products SET discount_enabled = 1, discount_type = 'percent', discount_percent = 10 WHERE id = ?", [id(41)]],
    // G: fractional and zero branch stock on family members
    ['UPDATE branch_stock SET quantity = 2.5 WHERE product_id = ? AND branch_id = 1', [id(1)]],
    ['UPDATE branch_stock SET quantity = 0 WHERE product_id = ? AND branch_id = 1', [id(2)]],
    // I: names that differ only in case and spacing
    ["UPDATE products SET name = 'Twin Cream ' WHERE id = ?", [id(50)]],
    ["UPDATE products SET name = 'twin cream' WHERE id = ?", [id(51)]],
    ["UPDATE products SET name = 'twin  cream' WHERE id = ?", [id(52)]],
    // I2: names whose name_keys differ only by a NON-ASCII capital (SQLite lower() folds ASCII only, so these are two families; a JS toLowerCase on the keys would merge them)
    ["UPDATE products SET name = 'Éclat Crème' WHERE id = ?", [id(53)]],
    ["UPDATE products SET name = 'éclat crème' WHERE id = ?", [id(54)]],
    // J: a brand rule, plus a discounted parent whose child is listed first
    ['INSERT INTO promotion_rules (title, rule_type, percent_off, scope_type, brand, is_active) VALUES (\'fx-brand\', \'percent_off\', 5, \'brand\', ?, 1)', [act[70].brand]],
    ["UPDATE products SET is_group = 1, discount_enabled = 1, discount_type = 'fixed', discount_amount_usd = 1 WHERE id = ?", [id(60)]],
    ['UPDATE products SET parent_id = ? WHERE id = ?', [id(60), id(61)]],
    // the analyst's: Khmer names, live / future / expired / zero discounts, a category rule and a product-list rule
    ["UPDATE products SET name = 'ក្រែមលាបមុខ fixture' WHERE id IN (?, ?)", [id(80), id(81)]],
    ["UPDATE products SET discount_enabled = 1, discount_type = 'percent', discount_percent = 10 WHERE id IN (?, ?, ?)", [id(82), id(83), id(84)]],
    ["UPDATE products SET discount_enabled = 1, discount_type = 'percent', discount_percent = 10, discount_starts_at = '2099-01-01' WHERE id = ?", [id(85)]],
    ["UPDATE products SET discount_enabled = 1, discount_type = 'percent', discount_percent = 10, discount_ends_at = '2000-01-01' WHERE id = ?", [id(86)]],
    ["UPDATE products SET discount_enabled = 1, discount_type = 'fixed', discount_amount_usd = 0, discount_amount_khr = 0 WHERE id = ?", [id(87)]],
    ["INSERT INTO promotion_rules (title, rule_type, percent_off, scope_type, category, is_active) VALUES ('fx-cat', 'percent_off', 5, 'category', ?, 1)", [act[90].category]],
    ["INSERT INTO promotion_rules (title, rule_type, percent_off, scope_type, product_ids, is_active) VALUES ('fx-ids', 'percent_off', 5, 'products', ?, 1)", [JSON.stringify([id(100), id(101)])]],
  ]
  for (const [sql, values] of writes) {
    try { log.push(await permit(world, sql, values)) } catch (error) { log.push('ERR ' + String(error.message).slice(0, 100)) }
  }
  const special = [0, 1, 2, 5, 10, 11, 12, 20, 22, 23, 30, 31, 40, 41, 50, 51, 52, 53, 54, 60, 61, 80, 81, 82, 83, 85, 86, 87, 100, 101].map(id)
  return { all: act.map((r) => r.id), special, inactive, log, category: act[90].category, brand: act[70].brand }
}

function buildLists(fx, everyId) {
  const lists = []
  for (const n of [40, 299, 300, 1500]) {
    let ids = []
    const pool = everyId
    for (let i = 0; i < n; i += 1) ids.push(pool[Math.floor(rnd() * pool.length)])
    ids = [...new Set(ids)]
    // every special id, children before parents for half of them, in the first 60 positions (so the fixtures land on the early pages) and a few later
    const special = fx.special.filter((_, index) => (n === 299 ? index % 2 === 0 : true))
    const placed = n >= 300 && n % 2 === 0 ? [...special].reverse() : special
    for (const value of placed) {
      const at = Math.floor(rnd() * Math.min(60, ids.length))
      ids = ids.filter((x) => x !== value)
      ids.splice(at, 0, value)
    }
    // headers left out of some lists, so a family is listed by its child alone (the child-of-listed member term has to bring the header in)
    const unlisted = n === 300 ? [fx.special[0], fx.special[7]] : n === 1500 ? [fx.special[4], fx.special[19]] : []
    ids = ids.filter((x) => !unlisted.includes(x))
    // exactly n distinct listed ids (the inactive and the missing one included), plus one repeat, so n = 299 stays under the 300 threshold and n = 300 meets it
    const keep = new Set(fx.special.filter((x) => !unlisted.includes(x)))
    for (let i = ids.length - 1; ids.length > n - 2 && i >= 0; i -= 1) if (!keep.has(ids[i])) ids.splice(i, 1)
    ids.splice(7, 0, fx.inactive[0], 999999, ids[3])
    ids = [...ids.slice(0, 11), ids[3], ...ids.slice(11)].filter((x, i, all) => all.indexOf(x) === i || i === 11)
    const tokens = ids.map(String)
    if (n >= 40) tokens.splice(9, 0, 'abc', '-1', '0', '')
    const tiers = tokens.map(() => (rnd() < 0.06 ? 'x' : String(Math.floor(rnd() * 5)))).join('')
    lists.push({ n, ids: tokens.join(','), tiers })
  }
  return lists
}

function buildShapes(lists, fx) {
  const shapes = []
  const surfaces = {
    'pos b1': '&searchMode=smart&branchId=1&include=branch_stock,images,family&metadata=0&surface=pos&money_precision_version=1',
    'pos b2': '&searchMode=smart&branchId=2&include=branch_stock,images,family&metadata=0&surface=pos&money_precision_version=1',
    products: '&searchMode=smart&include=branch_stock,images,batches,tagged_lots',
  }
  for (const L of lists) {
    for (const [label, tail] of Object.entries(surfaces)) {
      for (const sort of ['name_asc', 'created_desc']) {
        for (const [page, pageSize] of [[1, 100], [2, 100], [1, 1], [3, 1], [16, 1]]) {
          shapes.push({ id: `n${L.n} ${label} ${sort} p${page}x${pageSize}`, n: L.n, url: `/api/products/search?page=${page}&pageSize=${pageSize}&sort=${sort}&rankIds=${L.ids}&rankTiers=${L.tiers}${tail}` })
        }
      }
    }
    for (const extra of ['&stockState=out', '&stockState=low', '&promo=promoted', '&promo=rules', '&issueState=no_image', `&category=${encodeURIComponent(fx.category || '')}`]) {
      shapes.push({ id: `n${L.n} pos b1 filter ${extra.slice(1, 28)}`, n: L.n, url: `/api/products/search?page=1&pageSize=60&sort=name_asc&rankIds=${L.ids}&rankTiers=${L.tiers}${surfaces['pos b1']}${extra}` })
    }
  }
  return shapes
}

async function readAll(world, shapes, { stopAgainst } = {}) {
  const out = []
  for (let i = 0; i < shapes.length; i += 1) {
    const r = await runShape(world, { method: 'GET', url: shapes[i].url }, { cold: false, cacheMiss: true })
    const stmts = (await lastStatements(world)).filter((s) => !/system_flags|telegram_scheduled_sends/.test(s.sql))
    const entry = { status: r.status, hash: sha([r.status, r.json]), items: r.json?.items?.length ?? 0, total: r.json?.total, rows: r.rowsRead, calls: stmts.length, driven: stmts.some((s) => DRIVEN.test(s.sql)), ids: (r.json?.items || []).map((x) => x.id) }
    out.push(entry)
    if (stopAgainst && stopAgainst[i].hash !== entry.hash) return { out, diffAt: i }
  }
  return { out, diffAt: -1 }
}

const MUTANTS = {
  'promoted-first-forgotten': [{ name: 'm-promoted', file: 'src/lib/familyPagination.ts', from: '(a.t - b.t) || (b.pr - a.pr) || (a.r - b.r)', to: '(a.t - b.t) || (a.r - b.r)' }],
  'no-child-member': [{ name: 'm-child', file: 'src/lib/productSearchQuery.ts',
    from: " OR EXISTS (SELECT 1 FROM products listed WHERE listed.parent_id = p.id AND instr(${csv}, ',' || listed.id || ',') > 0))`", to: ')`' }],
  'keys-lower-cased': [{ name: 'm-lower', file: 'src/lib/familyPagination.ts', from: 'const k = String(row.k), r = Number(row.r)', to: 'const k = String(row.k).toLowerCase(), r = Number(row.r)' }],
}

async function main() {
  const off = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' } })
  const on = await bootWorld({ tier: 'free', switches: { ic_simple: 'on', [SWITCH]: 'on' } })
  try {
    const fxOff = await applyFixtures(off)
    const fxOn = await applyFixtures(on)
    assert.deepEqual(fxOff.log, fxOn.log, 'both worlds took the same fixture writes')
    const failed = fxOff.log.filter((x) => typeof x === 'string')
    assert.equal(failed.length, 0, `every fixture write is accepted: ${failed.join(' | ')}`)
    const everyId = (await off.all('SELECT id FROM products WHERE is_active = 1 ORDER BY id')).map((r) => r.id)
    const lists = buildLists(fxOff, everyId)
    const shapes = buildShapes(lists, fxOff)
    const ref = await readAll(off, shapes)
    const neu = await readAll(on, shapes)
    let nonOk = 0, differ = 0, driven = 0, withItems = 0
    const sums = {}
    shapes.forEach((shape, i) => {
      if (ref.out[i].status !== 200 || neu.out[i].status !== 200) nonOk += 1
      if (ref.out[i].hash !== neu.out[i].hash) { differ += 1; console.log('DIFF', shape.id) }
      if (ref.out[i].driven) driven += 1000 // the OFF world never runs the driven statement
      if (neu.out[i].driven) driven += 1
      if (ref.out[i].items) withItems += 1
      const s = (sums[shape.n] ??= { shapes: 0, offRows: 0, onRows: 0, offCalls: 0, onCalls: 0 })
      s.shapes += 1; s.offRows += ref.out[i].rows; s.onRows += neu.out[i].rows; s.offCalls += ref.out[i].calls; s.onCalls += neu.out[i].calls
    })
    assert.equal(nonOk, 0, 'every shape answers 200 in both worlds')
    assert.equal(differ, 0, `${differ} shape(s) differ between switch OFF and ON`)
    assert.ok(withItems > shapes.length * 0.6, `the shapes return items (${withItems}/${shapes.length}), so the comparison sees orders`)
    const expectedDriven = shapes.filter((s) => s.n >= 300).length
    assert.equal(driven, expectedDriven, `ON drives the read for exactly the 300+ id lists (${driven} vs ${expectedDriven}); OFF never does`)
    // control: the fixtures put families with promoted rows, children and blank-named roots on pages
    const pos = shapes.findIndex((s) => s.id === 'n1500 pos b1 name_asc p1x100')
    const body = ref.out[pos]
    assert.ok(body.items > 20, 'the control page carries families')
    console.log('PASS identical bodies for', shapes.length, 'shapes; driven path taken on', expectedDriven)
    for (const [n, s] of Object.entries(sums)) console.log(`  list ${n}: ${s.shapes} shapes, rows OFF ${s.offRows} -> ON ${s.onRows} (${((s.onRows / s.offRows - 1) * 100).toFixed(1)}%), calls OFF ${s.offCalls} -> ON ${s.onCalls}`)
    const one = shapes.findIndex((s) => s.id === 'n1500 pos b1 name_asc p1x100')
    console.log(`  1500 ids POS page 1 x100: rows ${ref.out[one].rows} -> ${neu.out[one].rows}, calls ${ref.out[one].calls} -> ${neu.out[one].calls}`)
    const small = shapes.findIndex((s) => s.id === 'n300 pos b1 name_asc p1x100')
    console.log(`  300 ids POS page 1 x100: rows ${ref.out[small].rows} -> ${neu.out[small].rows}, calls ${ref.out[small].calls} -> ${neu.out[small].calls}`)

    // the restricted Inventory Check list never takes the driven path (rankIds do not reach it; its own reads stay on their statements)
    await on.addSwitches(['ic_wired', 'catalog_ranked_scope']); await on.restart()
    const ic = await runShape(on, { method: 'GET', url: '/api/inventory-checks/list?branchId=1&checkState=not_checked&page=1&pageSize=50' }, { cold: false, cacheMiss: true })
    assert.equal(ic.status, 200)
    assert.ok(!(await lastStatements(on)).some((s) => DRIVEN.test(s.sql)), 'the restricted Inventory Check read never runs the driven statement')
    // catalog_ranked_scope ON keeps typed searches on the page path, which is where the typed order applies
    const typed = await runShape(on, { method: 'GET', url: shapes[0].url.replace(/rankIds=[^&]*/, `rankIds=${lists[3].ids}`).replace(/rankTiers=[^&]*/, `rankTiers=${lists[3].tiers}`) }, { cold: false, cacheMiss: true })
    assert.equal(typed.status, 200)
    assert.ok((await lastStatements(on)).some((s) => DRIVEN.test(s.sql)), 'with catalog_ranked_scope ON a typed 1,500-id read still takes the typed-order path')
    console.log('PASS restricted read untouched; typed read keeps the path with catalog_ranked_scope ON')

    // required reds
    for (const [name, patches] of Object.entries(MUTANTS)) {
      const mutant = await bootWorld({ tier: 'free', switches: { ic_simple: 'on', [SWITCH]: 'on' }, patches })
      try {
        await applyFixtures(mutant)
        const result = await readAll(mutant, shapes, { stopAgainst: ref.out })
        assert.ok(result.diffAt >= 0, `mutant ${name} must differ from OFF on at least one shape`)
        console.log(`PASS mutant ${name} differs from OFF on shape ${shapes[result.diffAt].id}`)
      } finally { await mutant.dispose() }
    }
  } finally {
    await off.dispose()
    await on.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
