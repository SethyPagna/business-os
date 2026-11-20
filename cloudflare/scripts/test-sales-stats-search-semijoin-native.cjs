#!/usr/bin/env node
// Q1 (lane/money-quick-wins): GET /api/sales/stats resolves a typed search through uncorrelated semi-joins
//   sis.product_id IN (SELECT id FROM products WHERE <word test on barcode, brand, name_normalized, brand_compact>)
//   s.customer_id  IN (SELECT id FROM customers WHERE <word test on membership_number>)
// instead of one products probe per sale line and one customers probe per sale (buildSalesSearchWhere's `semiJoin`, /stats only).
// ORACLE: the same Worker with the flag patched back to false (the correlated form every search used before). For a corpus of searches, at both phone-access levels
// (the grant held, and the restricted account: phoneSearchAccessOf patched to { fullPhone: false } in all four worlds), the sale ids the search resolved
// (the id list the report statements carry) and the whole /stats body must be identical to the oracle's; the rows read are printed old and new.
// Run: node scripts/test-sales-stats-search-semijoin-native.cjs        MUTANT=<name> applies one defect to the NEW world (must go red)
'use strict'
process.env.READ_BUDGET_DEADLINE_MS ||= '240000'
const { bootWorld, lastStatements } = require('./read-budget/world.cjs')
const { applyFixture, day } = require('./sales-stats-reads-harness.cjs')

const SALES = 'src/routes/sales.ts'
const NEW_CALL = 'const searchClause = buildSalesSearchWhere(query, params, phoneSearchAccessOf(user), statsSearchUsesSemiJoin(query, phoneSearchAccessOf(user)))'
const OLD_CALL = 'const searchClause = buildSalesSearchWhere(query, params, phoneSearchAccessOf(user), false)'
const GRANT_ONLY = 'if (!access.fullPhone) return false'
const CHOSEN = 'const chosen = (semiJoin && access.fullPhone ? pass(true) : null) ?? pass(false)!'
const RESTRICT = { name: 'restricted-access', file: 'src/lib/phoneAccess.ts', from: 'return { fullPhone: canSeeFullPhones(user) }', to: 'return { fullPhone: false }' }
const PRODUCT_HAYSTACK = `const productHaystack = concatBalanced(["COALESCE(barcode, '')", "COALESCE(brand, '')", "COALESCE(name_normalized, '')", "COALESCE(brand_compact, '')"])`
const MUTANTS = {
  // the products subquery forgets the brand column
  dropsBrand: [{ name: 'm-brand', file: SALES, from: PRODUCT_HAYSTACK, to: `const productHaystack = concatBalanced(["COALESCE(barcode, '')", "COALESCE(name_normalized, '')", "COALESCE(brand_compact, '')"])` }],
  // ... or brand_compact
  dropsBrandCompact: [{ name: 'm-compact', file: SALES, from: PRODUCT_HAYSTACK, to: `const productHaystack = concatBalanced(["COALESCE(barcode, '')", "COALESCE(brand, '')", "COALESCE(name_normalized, '')"])` }],
  // the semi-join is also used for an account without the full-phone grant (its digit words would then read the phone through the unmasked haystack)
  restrictedUsesSemi: [{ name: 'm-grant-a', file: SALES, from: GRANT_ONLY, to: '' }, { name: 'm-grant-b', file: SALES, from: CHOSEN, to: 'const chosen = (semiJoin ? pass(true) : null) ?? pass(false)!' }],
  // the short-window rule removed: a 30-day search pays the whole-table scans of the semi-joins (more rows than the correlated form)
  windowRuleOff: [{ name: 'm-window', file: SALES, from: 'export const SEMI_JOIN_MIN_WINDOW_DAYS = 270', to: 'export const SEMI_JOIN_MIN_WINDOW_DAYS = 0' }],
  // the membership test is left out of the flat clause altogether
  dropsMembership: [{ name: 'm-member', file: SALES, from: " OR s.customer_id IN (SELECT id FROM customers WHERE ${atom(\"COALESCE(membership_number, '')\")}))`,", to: ')`,' }],
}
const mutant = process.env.MUTANT ? MUTANTS[process.env.MUTANT] : null
if (process.env.MUTANT && !mutant) { console.error('unknown MUTANT ' + process.env.MUTANT); process.exit(2) }

// Rows the seed lacks: membership numbers, a Khmer product name, a brand that only `brand` carries, a brand that only `brand_compact` carries, a name that only
// `name_normalized` carries (the line keeps the name it was sold under), a brand over the 50-byte LIKE pattern limit, and a barcode.
async function prepare(world) {
  await applyFixture(world)
  const run = (sql, ...v) => world.db.prepare(sql).bind(...v).run()
  // products and customers that really appear on sales (the seed sells a spread of them)
  const sold = (await world.all("SELECT product_id AS id FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sale_status <> 'cancelled') GROUP BY product_id HAVING COUNT(*) >= 2 ORDER BY product_id LIMIT 12")).map((r) => r.id)
  const buyers = (await world.all('SELECT DISTINCT customer_id AS id FROM sales WHERE customer_id IS NOT NULL ORDER BY customer_id LIMIT 40')).map((r) => r.id)
  world.fx = { khmer: sold[0], zeph: sold[1], elf: sold[2], qwerty: sold[3], longBrand: sold[4], barcode: sold[5], vip: buyers[0], no1: buyers[1] }
  await run("UPDATE customers SET membership_number = 'MBR' || printf('%05d', id) WHERE id IN (" + buyers.slice(2).join(',') + ')')
  await run("UPDATE customers SET membership_number = 'LC-VIP-0042' WHERE id = ?", world.fx.vip)
  await run("UPDATE customers SET membership_number = 'No1-777' WHERE id = ?", world.fx.no1)
  await run("UPDATE products SET name = 'ក្រែមសាកល្បង', name_normalized = 'ក្រែមសាកល្បង' WHERE id = ?", world.fx.khmer)
  await run("UPDATE products SET brand = 'Zephyrine', brand_compact = '' WHERE id = ?", world.fx.zeph)
  await run("UPDATE products SET brand = 'e.l.f.', brand_compact = 'elf' WHERE id = ?", world.fx.elf)
  await run("UPDATE products SET name_normalized = 'qwertyname glossy' WHERE id = ?", world.fx.qwerty)
  await run("UPDATE products SET brand = ?, brand_compact = ? WHERE id = ?", 'Supercalifragilisticexpialidocious Brandname Long', 'supercalifragilisticexpialidociousbrandnamelong', world.fx.longBrand)
}

function corpus(ctx, fx) {
  const w = `startDate=${day(ctx, 29)}&endDate=${day(ctx, 0)}`
  const q = (search, extra = '') => `/api/sales/stats?search=${encodeURIComponent(search)}${extra ? '&' + extra : ''}`
  return {
    'product name word (Serum)': q('Serum'),
    'two words, both in names (AND)': q('serum cream'),
    'groups OR (searchMode=OR)': q('serum, zephyrine', 'searchMode=OR'),
    'brand only (Zephyrine, brand_compact empty)': q('Zephyrine'),
    'brand_compact only (elf)': q('elf'),
    'name_normalized only (qwertyname)': q('qwertyname'),
    'word in the line, word in the product (AND)': q('serum glossy'),
    'barcode (a 13-digit word)': q('885' + String(fx.barcode).padStart(10, '0')),
    'barcode fragment': q(String(fx.barcode).padStart(7, '0')),
    'sku fragment': q('sku ' + fx.zeph),
    'membership number (letters+digits)': q('MBR00007'),
    'membership word (letters)': q('vip'),
    'membership digits': q('0042'),
    'membership mixed words': q('vip 0042'),
    'membership with a letter o beside a digit (No1)': q('no1 777'),
    'phone, 10 digits (whole number)': q('0000001234'),
    'phone fragment': q('0123'),
    'sale number': q('R0115000'),
    'sale number fragment': q('1158'),
    'customer name': q('Customer 12'),
    'customer name, 30 days (correlated: a short window)': q('Customer 12', w),
    'customer name, 120 days (correlated: still short)': q('Customer 12', `startDate=${day(ctx, 119)}&endDate=${day(ctx, 0)}`),
    'customer name, 300 days (semi-join)': q('Customer 12', `startDate=${day(ctx, 299)}&endDate=${day(ctx, 0)}`),
    'customer name, 7 days start only (correlated)': q('Customer 12', `startDate=${day(ctx, 6)}`),
    'customer name, end only (semi-join)': q('Customer 12', `endDate=${day(ctx, 3)}`),
    'customer, status filter': q('Customer 12', 'status=completed'),
    'Khmer product name': q('ក្រែម'),
    'Khmer customer name': q('សុខា'),
    'Latin customer name from the fixture': q('Zed Quux'),
    'mixed Khmer and Latin': q('សុខា serum'),
    'a word that hits nothing': q('zzzznothing'),
    'a word over the 50-byte pattern (no hit)': q('a'.repeat(60)),
    'a word over the 50-byte pattern (a brand)': q('supercalifragilisticexpialidocious'),
    'a word that hits thousands (brand)': q('brand'),
    'a word that hits every sale line (product)': q('product'),
    'one letter': q('a'),
    'two digits': q('12'),
  }
}

// The id list the report statements carried (the resolved search), as the bound JSON text; null when the search was not resolved to a list.
function idsOf(stmts) {
  for (const s of stmts) for (const v of s.values || []) if (typeof v === 'string' && /^\[\d/.test(v)) return v
  return null
}
const resolveRows = (stmts) => stmts.filter((s) => /FROM sales matched_sale/.test(s.sql) && /LIMIT/.test(s.sql) && !/json_each/.test(s.sql)).reduce((n, s) => n + s.rr, 0)

async function runWorld(label, patches, tier = 'free') {
  const world = await bootWorld({ tier, patches })
  const out = {}
  try {
    await prepare(world)
    for (const [name, url] of Object.entries(corpus(world.ctx, world.fx))) {
      const r = await world.send('GET', url, undefined, { miss: true })
      const stmts = await lastStatements(world)
      out[name] = { status: r.status, text: r.text, rr: r.rr, calls: r.calls, ids: idsOf(stmts), resolveRr: resolveRows(stmts) }
    }
  } finally { await world.dispose() }
  console.log('world done: ' + label)
  return out
}

async function main() {
  const problems = []
  let totalOld = 0, totalNew = 0
  for (const [level, extra] of [['grant', []], ['restricted', [RESTRICT]]]) {
    // ORACLE_CACHE=<file>: the oracle's answers are kept there and reused (a mutant run then boots one world per level instead of two)
    const cacheFile = process.env.ORACLE_CACHE && `${process.env.ORACLE_CACHE}.${level}.json`
    let oldRun = cacheFile && require('node:fs').existsSync(cacheFile) ? JSON.parse(require('node:fs').readFileSync(cacheFile, 'utf8')) : null
    if (!oldRun) {
      oldRun = await runWorld(`old/${level}`, [{ name: 'old-call', file: SALES, from: NEW_CALL, to: OLD_CALL }, ...extra])
      if (cacheFile) require('node:fs').writeFileSync(cacheFile, JSON.stringify(oldRun))
    }
    const newRun = await runWorld(`new/${level}`, [...(mutant || []), ...extra])
    console.log(`\n=== ${level}: rows read, old -> new (resolver statement alone in brackets) ===`)
    for (const name of Object.keys(oldRun)) {
      const o = oldRun[name], n = newRun[name]
      const same = o.status === n.status && o.text === n.text && o.ids === n.ids
      totalOld += o.rr; totalNew += n.rr
      if (n.rr > o.rr + 1000) problems.push(`${level} ${name}: reads more rows than the correlated form (${o.rr} -> ${n.rr})`)
      const ids = o.ids === null ? 'no id list' : `${JSON.parse(o.ids).length} ids`
      console.log(`${same ? 'same' : 'DIFF'}  ${String(o.rr).padStart(8)} -> ${String(n.rr).padStart(8)}  [${String(o.resolveRr).padStart(7)} -> ${String(n.resolveRr).padStart(7)}]  ${ids.padEnd(12)} ${name}`)
      if (o.status !== 200) problems.push(`${level} ${name}: the oracle answered ${o.status}`)
      if (o.status !== n.status) problems.push(`${level} ${name}: status ${o.status} vs ${n.status}`)
      else if (o.ids !== n.ids) problems.push(`${level} ${name}: resolved ids differ (old ${o.ids === null ? 'none' : JSON.parse(o.ids).length}, new ${n.ids === null ? 'none' : JSON.parse(n.ids).length})`)
      else if (o.text !== n.text) problems.push(`${level} ${name}: /stats body differs`)
    }
    if (mutant && problems.length) break // a mutant is caught at the first level that shows it
    // The corpus must discriminate: the targeted searches match something, and the nothing-word matches nothing.
    const hits = (name) => (oldRun[name].ids === null ? -1 : JSON.parse(oldRun[name].ids).length)
    for (const name of ['brand only (Zephyrine, brand_compact empty)', 'brand_compact only (elf)', 'name_normalized only (qwertyname)', 'Khmer product name', 'membership word (letters)', 'a word over the 50-byte pattern (a brand)']) {
      if (hits(name) < 1) problems.push(`${level} corpus: "${name}" found no sale on the oracle (the case does not discriminate)`)
    }
    if (hits('a word that hits nothing') !== 0 && oldRun['a word that hits nothing'].ids !== null) problems.push(`${level} corpus: the nothing-word matched`)
    if (level === 'grant') for (const name of ['membership number (letters+digits)', 'barcode (a 13-digit word)']) if (hits(name) < 1) problems.push(`${level} corpus: "${name}" found no sale`)
    if (level === 'grant') {
      const lab = newRun['customer name']
      const base = oldRun['customer name']
      console.log(`\nlab seed, the sales-stats-search shape (search=Customer 12), Free, Cache API missing: ${base.rr} -> ${lab.rr} rows read, ${base.calls} -> ${lab.calls} calls`)
      if (!(lab.rr < base.rr)) problems.push('the semi-join read no fewer rows than the correlated form on the lab seed')
    }
  }
  console.log(`\ncorpus total rows read over both levels: ${totalOld} -> ${totalNew}`)
  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log('\nall green')
}
main().catch((e) => { console.error('crashed: ' + (e && e.stack)); process.exit(1) })
