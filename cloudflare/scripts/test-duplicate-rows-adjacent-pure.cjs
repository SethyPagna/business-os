'use strict'
// Owner, 16 Nov 2026: "for such duplicate rows show them next to each other, so it is easier to notice."
//
// Two UNMERGED duplicates are two product records with the same name and the same barcode. The server pages by family (the
// name group), so the pair always shares a page; inside the family the page's rows are ordered by INTRA_FAMILY_NAME_BARCODE_SQL
// (name, barcode, then the sort's own tail, then id) so the pair is consecutive under every sort the list offers.
// Runs the real helper on node:sqlite. The fixture puts the pair's family on the page boundary and an unrelated variant
// BETWEEN the pair in id order AND in created order, so an id-only or created-only intra order splits the pair.
// Mutants edit the real source text and must turn the run red. Fixtures are synthetic.
//
// Run: node scripts/test-duplicate-rows-adjacent-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')

const lib = path.join(__dirname, '../src/lib/familyPagination.ts')
const routes = path.join(__dirname, '../src/routes')
function bundle(source) {
  const code = buildSync({ stdin: { contents: source, resolveDir: path.dirname(lib), loader: 'ts', sourcefile: lib }, bundle: true, platform: 'node', format: 'cjs', write: false, target: 'es2022', external: ['cloudflare:*'] }).outputFiles[0].text
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports)
  return loaded.exports
}
const libSource = fs.readFileSync(lib, 'utf8')

function world() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, barcode TEXT, parent_id INTEGER, created_at TEXT, is_active INTEGER DEFAULT 1, is_group INTEGER DEFAULT 0)')
  db.exec('CREATE INDEX idx_products_parent_pg ON products(parent_id); CREATE INDEX idx_products_name_key ON products(name_key)')
  const add = db.prepare('INSERT INTO products(id,name,name_key,barcode,created_at) VALUES(?,?,?,?,?)')
  const put = (id, name, barcode, created) => add.run(id, name, name.toLowerCase(), barcode, created)
  put(1, 'Aloe Gel', '900', '2026-01-01')
  put(2, 'Body Oil', '901', '2026-01-01')
  // The pair: ids 5 and 7, barcode 111. Id 6 is an unrelated variant between them by id; created order is 5 (oldest), 6, 7 (newest)
  // for ascending and the reverse for descending, so id order and created order both put 6 inside the pair.
  put(5, 'Glow Serum', '111', '2026-01-01')
  put(6, 'Glow Serum', '222', '2026-01-02')
  put(7, 'Glow Serum', '111', '2026-01-03')
  put(9, 'Zeta Cream', '999', '2026-01-01')
  return db
}
const adapter = db => ({
  prepare: sql => ({ all: async params => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return p.all(params || {}) },
    get: async params => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return p.get(params || {}) } }),
  batch: async statements => statements.map(({ sql, params }) => { const p = db.prepare(sql); p.setAllowUnknownNamedParameters(true); return { success: true, results: p.all(params || {}) } }),
})

// The intra-family ORDER BY exactly as routes/products.ts composes it, for each sort the list offers.
const tails = { name_asc: 'id ASC', name_desc: 'id ASC', created_desc: 'created_at DESC, id DESC', created_asc: 'created_at ASC, id ASC' }
const familyOrder = { name_asc: 'family_name ASC', name_desc: 'family_name DESC', created_desc: 'latest_created_at DESC, family_name ASC', created_asc: 'latest_created_at ASC, family_name ASC' }

async function pages(api, intra, sort, extra = {}) {
  const db = adapter(world())
  const out = []
  for (let page = 1; page <= 5; page++) {
    const result = await api.paginateProductFamilies({
      db, selectColumns: 'p.id, p.name, p.barcode, p.created_at', joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {}, page, pageSize: 3,
      familyOrderSql: familyOrder[sort], intraFamilyOrderSql: intra(sort), ...extra,
    })
    out.push({ ids: result.items.map(row => row.id), total: result.total, totalPages: result.totalPages })
    if (page >= result.totalPages) break
  }
  return out
}

async function run(source, label) {
  const api = bundle(source)
  const intra = sort => `${api.INTRA_FAMILY_NAME_BARCODE_SQL}, ${tails[sort]}`
  const failures = []
  const check = async (name, fn) => { try { await fn() } catch (error) { failures.push(`${label} ${name}: ${String(error.message).split('\n')[0]}`) } }
  for (const [mode, extra] of [['default', {}], ['seek', { seekPage: true, familyMemberBaseWhereSql: 'p.is_active = 1', parentSeek: true }]]) {
    for (const sort of Object.keys(tails)) {
      await check(`${mode} ${sort}: the pair is consecutive, on one page, nothing missing or doubled`, async () => {
        const result = await pages(api, intra, sort, extra)
        const all = result.flatMap(page => page.ids)
        assert.deepEqual([...all].sort((a, b) => a - b), [1, 2, 5, 6, 7, 9], 'every record exactly once')
        assert.ok(result.every(page => page.total === 4), 'the pager counts the 4 families')
        const holder = result.findIndex(page => page.ids.includes(5))
        assert.ok(result[holder].ids.includes(7), 'the pair shares a page')
        const ids = result[holder].ids
        assert.equal(Math.abs(ids.indexOf(5) - ids.indexOf(7)), 1, `pair split on the page: ${ids}`)
        assert.ok(ids.includes(6), 'the whole family is on that page')
      })
    }
    await check(`${mode}: the pair family sits at the page boundary (page 1 holds 3 families' rows)`, async () => {
      const result = await pages(api, intra, 'name_asc', extra)
      assert.deepEqual(result[0].ids, [1, 2, 5, 7, 6], 'Aloe, Body, then the Glow Serum family with its pair first')
      assert.deepEqual(result[1].ids, [9])
    })
    await check(`${mode}: a barcode search returns both rows, adjacent`, async () => {
      const result = await pages(api, intra, 'created_desc', { ...extra, whereSql: 'WHERE p.is_active = 1 AND p.barcode = @bc', params: { bc: '111' } })
      // The keyed (seek) read returns the matching family's sibling variants too, so the pair is first and the variant after it.
      assert.deepEqual(result[0].ids, mode === 'seek' ? [7, 5, 6] : [7, 5], 'both duplicates, adjacent, newest first inside the same barcode')
    })
  }
  return failures
}

;(async () => {
  const base = await run(libSource, 'real')
  assert.deepEqual(base, [], `real source is red:\n${base.join('\n')}`)
  const mutants = [
    { name: 'intra order is name, id only (no barcode)', from: `"lower(name) ASC, (COALESCE(trim(barcode), '') = '') ASC, lower(trim(barcode)) ASC"`, to: `"lower(name) ASC"` },
    { name: 'barcode sorted after the sort tail', from: `"lower(name) ASC, (COALESCE(trim(barcode), '') = '') ASC, lower(trim(barcode)) ASC"`, to: `"lower(name) ASC, 'zzz' ASC"` },
  ]
  let killed = 0
  for (const mutant of mutants) {
    assert.ok(libSource.includes(mutant.from), `mutant "${mutant.name}" no longer matches familyPagination.ts (stale mutant)`)
    const failed = await run(libSource.replace(mutant.from, mutant.to), mutant.name)
    assert.ok(failed.length > 0, `mutant survived: ${mutant.name}`)
    killed++
  }
  // Every list route that orders rows inside a family uses the shared barcode-aware order.
  for (const [file, pattern] of [['products.ts', /INTRA_FAMILY_NAME_BARCODE_SQL,\s*\n\s*sort ===/], ['inventory.ts', /\$\{INTRA_FAMILY_NAME_BARCODE_SQL\}, id ASC/], ['branches.ts', /\$\{INTRA_FAMILY_NAME_BARCODE_SQL\}, id ASC/]]) {
    const source = fs.readFileSync(path.join(routes, file), 'utf8')
    assert.ok(pattern.test(source), `${file} no longer orders rows inside a family by name, barcode first`)
    assert.ok(!/intraFamilyOrderSql:\s*'lower\(name\) ASC, id ASC'/.test(source), `${file} still has the id-only intra order`)
  }
  console.log(`PASS duplicate rows adjacent: ${Object.keys(tails).length} sorts x default/seek paging, pair at the page boundary, barcode search, ${killed} mutants killed`)
})().catch(error => { console.error(error); process.exit(1) })
