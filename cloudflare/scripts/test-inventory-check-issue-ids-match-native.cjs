'use strict'
// Count tasks, issue by filter: the products an ISSUE BY FILTER resolves are the products the LIST shows.
// The list (GET /api/inventory-checks/list, every page, non-header rows) against the issue (POST /api/inventory-checks/tasks with filters, read back from inventory_check_items), over every filter below on one seeded catalogue
// (search text in English and Khmer, partial words, a barcode, a SKU, mixed case and spacing, brand, category, stock state, check state, a day, branch 2, retired and merged products, header families, 99 / 100 / 101 products,
// families that cross the 100 boundary), for an admin and for an issuer who may not see barcodes, with catalog_ranked_scope ON and OFF. Each request logs which branch of readProductSearchList ran: an issue always takes the page path.
//   tier 'big'  : Paid with maxProducts planted at 5000 in memory, so every filter's FULL id set is issued and compared, whatever its size.
//   tier 'paid' : the real Paid cap (300).   tier 'free': the real Free cap (100).
// Over a real cap the refusal must say total <= |list| and (atLeast or total === |list|), and total > cap.
// Then a mutant drops one filter (brand) from the issue's read and the comparison must catch it.
//
// Run (under the native-test lock): node scripts/test-inventory-check-issue-ids-match-native.cjs
const assert = require('node:assert/strict')
const { createInvApp, person } = require('./harness/inv-app.cjs')

const FIELDS = { inventory_checks: true, inventory_checks_check: true, inventory_check_show_stock: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
const USERS = {
  admin: person(71, 'admin', { all: true }),
  // An issuer who may not see barcodes: the list searches names only and looks a whole code up exactly.
  nobar: person(95, 'manager', { ...FIELDS, inventory_check_issue: true }),
}
const LOG = "    ;(globalThis.__icIds ||= []).push((options.idsOnly ? 'ids' : 'list') + ':ranked')\n"
const LOGP = "  ;(globalThis.__icIds ||= []).push((options.idsOnly ? 'ids' : 'list') + ':page')\n"
const EDITS = {
  'routes/products.ts': [
    ['    const limits = getPlanLimits(c.env)\n    const rankedPayload = await searchRestrictedProductsWithIndexFallback(', LOG + '    const limits = getPlanLimits(c.env)\n    const rankedPayload = await searchRestrictedProductsWithIndexFallback('],
    ['  const baseVersion = await productSearchCacheVersion(c.env, query)\n  const version = restricted ?', LOGP + '  const baseVersion = await productSearchCacheVersion(c.env, query)\n  const version = restricted ?'],
  ],
  'lib/inventoryCheckTaskLimits.ts': [['  return INVENTORY_CHECK_TASK_LIMITS_BY_TIER[resolvePlanTier(env)]', '  return (globalThis as any).__icIdsBig ? { ...INVENTORY_CHECK_TASK_LIMITS_BY_TIER.paid, maxProducts: 5000 } : INVENTORY_CHECK_TASK_LIMITS_BY_TIER[resolvePlanTier(env)]']],
}

// The catalogue. created_at varies so the list's order is not the id order.
const P = []
let nextId = 10000
function product(o) { const id = o.id ?? nextId++; P.push({ id, sku: `SKU-${id}`, barcode: `8850${id}`, brand: 'Misc', category: 'General', active: 1, group: 0, parent: null, q1: 50, q2: 5, ...o, id, ...(o.active === 0 ? { q1: 0, q2: 0 } : {}) }); return id }
const qOf = (i) => [0, 2, 50][i % 3]
for (let i = 0; i < 120; i++) product({ name: `Cream Alpha ${i}`, brand: 'Acme', category: 'Face', q1: qOf(i) })
for (let i = 0; i < 20; i++) product({ name: `Cream Alpha retired ${i}`, brand: 'Acme', category: 'Face', active: 0 })
for (let i = 0; i < 60; i++) product({ name: `ក្រែមលាបមុខ ស្បែកស ${i}`, brand: 'Khm', category: 'Skin', q1: qOf(i + 1) })
for (let i = 0; i < 101; i++) product({ name: `ទឹកអប់ ក្លិនផ្កា ${i}`, brand: 'Perf', category: 'Scent', q1: qOf(i + 2) })
for (const n of [99, 100, 101]) for (let i = 0; i < n; i++) product({ name: `Near ${n} item ${i}`, brand: `N${n}`, category: 'Near' })
// name families (child rows that share one name; only the barcode tells them apart)
for (let f = 0; f < 30; f++) for (let r = 0; r < 3; r++) product({ name: `Lotion Family ${f}`, brand: 'Fam', category: 'Body', q1: qOf(f + r) })
product({ name: 'Lotion Family 3', brand: 'Fam', category: 'Body', active: 0 }) // a retired (merged) twin of a live family
// 99 lone + one family of 3 = 100 families, 102 products (FS); 100 lone + one family of 3 = 101 families, 103 products (FT)
for (let i = 0; i < 99; i++) product({ name: `FS lone ${i}`, brand: 'FS', category: 'Edge' })
for (let r = 0; r < 3; r++) product({ name: 'FS family', brand: 'FS', category: 'Edge' })
for (let i = 0; i < 100; i++) product({ name: `FT lone ${i}`, brand: 'FT', category: 'Edge' })
for (let r = 0; r < 3; r++) product({ name: 'FT family', brand: 'FT', category: 'Edge' })
// 50 families of 2 = 100 products (F2x50) and 50 of 2 + 1 lone = 101 products in 51 families (F2x50p1)
for (let f = 0; f < 50; f++) for (let r = 0; r < 2; r++) product({ name: `Pair ${f}`, brand: 'F2x50', category: 'Pairs' })
for (let f = 0; f < 50; f++) for (let r = 0; r < 2; r++) product({ name: `Twin ${f}`, brand: 'F2x50p1', category: 'Pairs' })
product({ name: 'Twin lone', brand: 'F2x50p1', category: 'Pairs' })
// header families: header (is_group) + two children with parent_id; and childless headers
for (let k = 0; k < 10; k++) { const h = product({ name: `Summer set ${k}`, brand: 'HDR', category: 'Sets', group: 1 }); product({ name: `Red top ${k}`, brand: 'HDR', category: 'Sets', parent: h }); product({ name: `Blue skirt ${k}`, brand: 'Other', category: 'Tops', parent: h }) }
for (let k = 0; k < 5; k++) product({ name: `Winter set ${k}`, brand: 'HDR', category: 'Sets', group: 1 })
// branch 2 only stock
for (let i = 0; i < 40; i++) product({ name: `Store only ${i}`, brand: 'B2', category: 'Store', q1: 0, q2: 30 })

function seed(raw, seedStockFixture) {
  seedStockFixture(raw.db, () => {
    for (const [i, p] of P.entries()) {
      const created = new Date(Date.UTC(2026, 8, 1) + ((i * 7919) % 1000) * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,is_group,parent_id,created_at,updated_at)
        VALUES(?,?,?,?,?,9.5,38000,4,16000,?,?,?,?,?,?,?)`).run([p.id, p.name, p.sku, p.barcode, p.group ? 0 : p.q1 + p.q2, p.brand, p.category, p.active, p.group, p.parent, created, created])
      if (!p.group) { raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([p.id, p.q1]); raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,2,?)').run([p.id, p.q2]) }
    }
  })
}

const mergeEdits = (a, b) => { const out = { ...a }; for (const [file, edits] of Object.entries(b)) out[file] = [...(out[file] || []), ...edits]; return out }
async function run({ ranked, extraEdits = {} }) {
  const app = createInvApp({ mount: { '/api/inventory-checks': 'routes/inventoryChecks.ts' }, users: USERS, sourceEdits: mergeEdits(EDITS, extraEdits), seed })
  for (const s of ['ic_simple', 'ic_lot_counts', 'ic_wired', 'ic_fix_stock']) app.setSwitch(s, 'on')
  app.setSwitch('catalog_ranked_scope', ranked ? 'on' : 'off')
  const envOf = (tier) => ({ ...app.env, PLAN_TIER: tier === 'free' ? 'free' : 'paid' })
  let rid = 0
  const branches = () => { const b = globalThis.__icIds || []; globalThis.__icIds = []; return [...new Set(b)].join(',') }

  async function listIds(who, branchId, filters) {
    app.setUser(app.users[who]); app.clearCaches(); globalThis.__icIds = []
    const ids = new Set(), base = new URLSearchParams({ ...filters, branchId: String(branchId), pageSize: '100' })
    let total = 0
    for (let page = 1; page <= 80; page++) {
      base.set('page', String(page))
      const r = await app.get(`/api/inventory-checks/list?${base}`, envOf('paid'))
      assert.equal(r.status, 200, `list ${JSON.stringify(filters)}: ${r.text.slice(0, 300)}`)
      const items = r.json.items || []
      for (const row of items) if (!Number(row.is_group)) ids.add(Number(row.id))
      total = Number(r.json.total ?? 0)
      if (!items.length || page * 100 >= total) break
    }
    return { ids, families: total, branch: branches() }
  }
  async function issue(who, branchId, filters, tier) {
    app.setUser(app.users[who]); app.clearCaches(); globalThis.__icIds = []; globalThis.__icIdsBig = tier === 'big'
    const r = await app.send('POST', '/api/inventory-checks/tasks', { branchId, requestId: `ids-match-${++rid}-xxxxxxxx`, filters }, envOf(tier))
    globalThis.__icIdsBig = false
    const branch = branches()
    if (r.status === 201) {
      const id = r.json.item.id
      const ids = new Set(app.raw.prepare('SELECT product_id FROM inventory_check_items WHERE session_id=?').all([id]).map((x) => Number(x.product_id)))
      app.raw.prepare("UPDATE inventory_check_sessions SET status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?").run([id]) // keep the open-task cap out of the way
      return { status: 201, ids, branch }
    }
    return { status: r.status, code: r.json && r.json.code, total: r.json && r.json.total, atLeast: r.json && r.json.atLeast, limit: r.json && r.json.limit, branch }
  }

  const byId = new Map(P.map((p) => [p.id, p]))
  const fam = P.find((p) => p.name === 'Lotion Family 7')
  const someCream = P.find((p) => p.name === 'Cream Alpha 42')
  const FILTERS = [
    [1, {}], [2, {}],
    [1, { query: 'cream' }], [1, { query: 'CREAM' }], [1, { query: '  Cream   Alpha  ' }], [1, { query: 'Alph' }], [1, { query: 'cream alpha 4' }], [1, { query: 'retired' }],
    [1, { query: 'ក្រែម' }], [1, { query: 'ស្បែក' }], [1, { query: 'ទឹកអប់' }], [1, { query: 'ក្លិន' }],
    [1, { query: someCream.barcode }], [1, { query: someCream.barcode.slice(0, 7) }], [1, { query: someCream.sku }], [1, { query: someCream.sku.toLowerCase() }], [1, { query: fam.barcode }],
    [1, { query: 'summer' }], [1, { query: 'Red top' }], [1, { query: 'winter' }], [1, { query: 'lotion family' }], [1, { query: 'zzzz-nothing' }],
    [1, { brand: 'Acme' }], [1, { brand: 'Khm' }], [1, { brand: 'Fam' }], [1, { brand: 'HDR' }], [1, { brand: 'N99' }], [1, { brand: 'N100' }], [1, { brand: 'N101' }],
    [1, { brand: 'FS' }], [1, { brand: 'FT' }], [1, { brand: 'F2x50' }], [1, { brand: 'F2x50p1' }], [1, { category: 'Face' }], [1, { category: 'Sets' }], [1, { category: 'Tops' }],
    [1, { stockState: 'in_stock' }], [1, { stockState: 'low_stock' }], [1, { stockState: 'out_of_stock' }], [1, { brand: 'Acme', stockState: 'low_stock' }], [1, { brand: 'Fam', stockState: 'out_of_stock' }],
    [1, { query: 'cream', category: 'Face', stockState: 'in_stock' }], [2, { brand: 'B2' }], [2, { stockState: 'out_of_stock' }], [2, { query: 'store only' }],
    [1, { checkState: 'not_checked' }], [1, { checkState: 'ok' }], [1, { checkState: 'issue' }], [1, { checkState: 'not_checked', brand: 'N101' }], [1, { checkState: 'not_checked', query: 'cream' }], [1, { checkedOn: 'TODAY' }],
    ['nobar', 1, { query: someCream.barcode }], ['nobar', 1, { query: someCream.sku }], ['nobar', 1, { query: someCream.barcode.slice(0, 7) }], ['nobar', 1, { query: 'cream' }],
  ]

    const log = []
    const say = (line) => log.push(line)
    // Counts at branch 1 for the check-state filters: 30 Cream products OK, 10 differ.
    app.setUser(app.users.admin)
    const creams = P.filter((p) => p.brand === 'Acme' && p.active && p.q1 === 50).slice(0, 40)
    const lines = creams.map((p, i) => ({ productId: p.id, countedQuantity: i < 30 ? 50 : 45, seenQuantity: 50 }))
    const sub = await app.send('POST', '/api/inventory-checks/submissions', { branchId: 1, requestId: 'ids-match-seed-submission-1', lines }, envOf('paid'))
    assert.equal(sub.status, 201, sub.text.slice(0, 400))
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
    let differences = 0, checks = 0
    for (const entry of FILTERS) {
      const [who, branchId, rawFilters] = typeof entry[0] === 'string' ? entry : ['admin', entry[0], entry[1]]
      const filters = Object.fromEntries(Object.entries(rawFilters).map(([k, v]) => [k, v === 'TODAY' ? today : v]))
      const L = await listIds(who, branchId, filters)
      const big = await issue(who, branchId, filters, 'big'), paid = await issue(who, branchId, filters, 'paid'), free = await issue(who, branchId, filters, 'free')
      const label = `${who} b${branchId} ${JSON.stringify(filters)}`
      const notes = []
      // the full set
      if (L.ids.size === 0) { if (big.status !== 400 || big.code !== 'inventory_check_product_not_eligible') notes.push(`list empty but big issue ${big.status} ${big.code}`) }
      else if (big.status !== 201) notes.push(`big issue ${big.status} ${big.code} total ${big.total}`)
      else {
        const onlyL = [...L.ids].filter((id) => !big.ids.has(id)), onlyI = [...big.ids].filter((id) => !L.ids.has(id))
        if (onlyL.length || onlyI.length) notes.push(`SET DIFFERS: list-only ${onlyL.slice(0, 8)} (${onlyL.length}) issue-only ${onlyI.slice(0, 8)} (${onlyI.length})`)
      }
      // the real caps
      for (const [tier, r, cap] of [['paid', paid, 300], ['free', free, 100]]) {
        if (L.ids.size === 0) continue
        if (L.ids.size <= cap) {
          if (r.status !== 201) notes.push(`${tier}: ${L.ids.size} <= cap but ${r.status} ${r.code} total ${r.total}`)
          else if (r.ids.size !== L.ids.size || [...r.ids].some((id) => !L.ids.has(id))) notes.push(`${tier}: issued set differs from list`)
        } else {
          if (r.status !== 400 || r.code !== 'inventory_check_task_too_many') notes.push(`${tier}: ${L.ids.size} > cap but ${r.status} ${r.code}`)
          else {
            if (!(r.total > cap)) notes.push(`${tier}: total ${r.total} not over the cap`)
            if (r.total > L.ids.size) notes.push(`${tier}: total ${r.total} MORE than the ${L.ids.size} products that match`)
            if (!r.atLeast && r.total !== L.ids.size) notes.push(`${tier}: total ${r.total} not exact (${L.ids.size}) and no atLeast`)
          }
        }
      }
      const summary = (r) => r.status === 201 ? `201(${r.ids.size})` : `${r.status} ${r.code === 'inventory_check_task_too_many' ? 'too_many' : r.code} total=${r.total} atLeast=${r.atLeast === true}`
      checks++
      if (notes.length) differences++
      say(`${notes.length ? 'DIFF' : 'SAME'} ${label.padEnd(64)} list ${String(L.ids.size).padStart(4)} ids / ${String(L.families).padStart(4)} fam [${L.branch}] | big ${summary(big)} [${big.branch}] | paid ${summary(paid)} | free ${summary(free)} [${free.branch}]${notes.length ? '\n     ' + notes.join('\n     ') : ''}`)
    }
    return { checks, differences, log }
}

// The mutant: the issue's read leaves the brand filter out (the list keeps it).
const DROP_BRAND = { 'routes/inventoryChecks.ts': [["readListPage(c, { ...filters, branchId: String(branchId), summary", "readListPage(c, { ...Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'brand')), branchId: String(branchId), summary"]] }

async function main() {
  for (const ranked of [true, false]) {
    const result = await run({ ranked })
    console.log(result.log.join(String.fromCharCode(10)))
    console.log(`RESULT ranked ${ranked ? 'ON' : 'OFF'}: ${result.checks} filters, ${result.differences} with a difference`)
    assert.ok(result.checks >= 50, `${result.checks} filters compared`)
    assert.equal(result.differences, 0, `the issued ids differ from the listed ids (ranked ${ranked ? 'ON' : 'OFF'})`)
    assert.ok(result.log.every((line) => !line.includes('ids:ranked')), 'an issue never takes the ranked path')
  }
  const mutant = await run({ ranked: true, extraEdits: DROP_BRAND })
  console.log(`MUTANT (brand dropped from the issue's read): ${mutant.differences} of ${mutant.checks} filters differ`)
  assert.ok(mutant.differences > 0, 'the planted mutant was not caught')
  console.log('passed: issued ids match listed ids on every filter; the planted mutant is caught')
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
