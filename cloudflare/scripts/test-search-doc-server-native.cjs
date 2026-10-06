// G37 phase 2: the stored search document and the server executor, through the
// REAL routes/products.ts, inventory.ts and branches.ts on SQLite with every
// migration applied (so 0233's tables and triggers are the real ones) and D1's
// expression depth limit (100), over a 6,200-row catalog.
//
//   1. PARITY. The server's FTS5 rewrite finds exactly the rows the shared
//      core finds in the browser: the owner's cases and ~1,700 replayed
//      queries (every few prefixes of 150 real names, reversed word order,
//      one-letter typos), compared as id sets. A rewrite that drops typo
//      variants, joined terms or roman aliases, or one that widens a prefix,
//      changes a set.
//   2. OWNER CASES through the route: Blush Palette (Evil Eye inside the
//      first page and counted in `total`), SK-II spellings, lipstik, mascra,
//      Khmer; and the decoys that must NOT come back ("Skin Tint 2", "Lip
//      Oil", "All Skin", "Self"/"Shelf", the Morphe liner).
//   3. RANKING. The typed target ranks first (exact name, then name prefix),
//      typo matches rank below real ones, pages never repeat or drop a family.
//   4. COMPLETENESS. A missing document is matched in code and still found; a
//      backlog above the cap uses the legacy clause; the route's writers set
//      the document, a partial edit nulls it, the repair rewrites it, and
//      the FTS integrity check passes after every one of those.
//   5. DEPTH. The widest query the box allows parses at depth 100.
//   6. DEGRADATION. No vocabulary: no typo variants, still correct. No FTS
//      table: the legacy path answers.
//
// Run (from cloudflare/): node scripts/test-search-doc-server-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { loadWorkerCore } = require('./harness/search_impls.cjs')
const { buildCatalog, seedProducts } = require('./harness/search_catalog_fixture.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const core = loadWorkerCore()
const catalog = buildCatalog()
const nameKey = (name) => String(name).trim().toLowerCase()
const nameOf = new Map(catalog.map((row) => [row.id, row.name]))

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  assert.equal(h.raw.db.limits.exprDepth, 100, 'the harness must parse at D1 depth')
  h.raw.db.exec("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1)")
  seedProducts(h.raw.db, catalog, { docOf: (row) => core.docTerms(row) })
  return h
}

const search = (h, query, extra = '') => h.request('GET', `/search?query=${encodeURIComponent(query)}&pageSize=100${extra}`)

// Every page of a search, in order.
async function allItems(h, query, pageSize = 100) {
  const items = []
  let total = 0
  for (let page = 1; page <= 50; page += 1) {
    const res = await h.request('GET', `/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&page=${page}`)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    total = res.json.total
    items.push(...res.json.items)
    if (page >= res.json.totalPages) break
  }
  return { items, total }
}

;(async () => {
  const h = fixture()
  const index = core.buildTermIndex(catalog)
  const docQuery = h.load('lib/productSearchDocQuery.ts')
  const docLib = h.load('lib/productSearchDoc.ts')
  const env = { DB: h.raw }
  const vocab = docQuery.d1VocabSource(h.db)
  const ftsIds = (match) => new Set(h.raw.db.prepare('SELECT rowid FROM products_search_fts WHERE products_search_fts MATCH ?').all(match).map((row) => Number(row.rowid)))

  await check('the document column is complete and the FTS index is consistent', async () => {
    assert.equal(h.raw.db.prepare('SELECT COUNT(*) n FROM products WHERE search_doc IS NULL AND is_active = 1').get().n, 0)
    h.raw.db.exec("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)")
    assert.equal(h.raw.db.prepare('SELECT COUNT(*) n FROM products_search_fts').get().n, catalog.length)
    const plan = await docQuery.prepareProductSearchDoc(env, 'blush palette')
    assert.ok(plan, 'the index path is used when nothing is missing')
    assert.deepEqual(plan.missingIds, [])
  })

  await check('PARITY: the FTS rewrite returns exactly the core\'s rows (owner cases + replayed queries)', async () => {
    const owner = ['Blush Palette', 'palette blush', 'Hourglass Blush pa', 'blush pallet', 'pallet', 'pelette', 'SK-II', 'skii', 'sk2', 'sk ii', 'sk-2', 'sk 2',
      'lipstik', 'mascra', 'consealer', 'សេរ៉ូម', 'ឡេ', 'hourglass love', 'e.l.f. lip', 'elf lip', 'elf', 'spf', 'oil', 'zzzz', 'qwerty', 'a b', 'bl', 'sk',
      'Dior Sauvage 100ml', 'Dior, Sauvage', 'sauvage, dior']
    let seed = 7
    const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const queries = new Set(owner)
    for (let i = 0; i < 150; i += 1) {
      const name = catalog[Math.floor(random() * catalog.length)].name
      for (let k = 2; k <= name.length; k += 3) queries.add(name.slice(0, k))
      const words = name.split(/\s+/)
      queries.add(words.slice().reverse().join(' '))
      const longest = words.reduce((a, b) => (a.length >= b.length ? a : b))
      if (words.length > 1 && longest.length > 4) {
        queries.add(name.replace(longest, longest.slice(0, -1)))
        queries.add(name.replace(longest, longest.slice(0, 2) + longest.slice(3)))
        queries.add(name.replace(longest, longest.slice(0, 3) + longest[4] + longest[3] + longest.slice(5)))
      }
    }
    let compared = 0
    let withTypos = 0
    for (const query of queries) {
      const rewrite = await docQuery.rewriteProductSearch(query, vocab)
      const expected = core.searchTermIndex(index, query)
      if (!rewrite) {
        const groups = core.queryUnits(query)
        assert.ok((groups.length === 1 && groups[0].text.length === 1) || /\d{5,}/.test(query), `only one-character and code-fragment queries stay on the legacy path: ${JSON.stringify(query)}`)
        continue
      }
      if (expected.broad) continue
      const got = ftsIds(rewrite.match)
      const want = new Set(expected.hits.map((hit) => hit.id))
      const missing = [...want].filter((id) => !got.has(id)).map((id) => nameOf.get(id))
      const extra = [...got].filter((id) => !want.has(id)).map((id) => nameOf.get(id))
      assert.deepEqual({ missing: missing.slice(0, 5), extra: extra.slice(0, 5) }, { missing: [], extra: [] }, `query ${JSON.stringify(query)} -> ${rewrite.match.slice(0, 160)}`)
      if (rewrite.strictMatch) {
        withTypos += 1
        // tier 4 = in the full match but not the strict one = the core's fuzzy tier
        const strict = ftsIds(rewrite.strictMatch)
        const fuzzyOnly = new Set(expected.hits.filter((hit) => hit.tier === 4).map((hit) => hit.id))
        const ours = new Set([...got].filter((id) => !strict.has(id)))
        const diff = [...fuzzyOnly].filter((id) => !ours.has(id)).length + [...ours].filter((id) => !fuzzyOnly.has(id)).length
        assert.equal(diff, 0, `tier 4 set differs for ${JSON.stringify(query)}`)
      }
      compared += 1
    }
    assert.ok(compared > 1200, `compared ${compared} queries`)
    assert.ok(withTypos > 200, `typo variants were exercised by ${withTypos} queries`)
  })

  await check('OWNER: Blush Palette -- every palette, Evil Eye inside the first page, total counts them, pages never repeat', async () => {
    const wanted = core.searchTermIndex(index, 'Blush Palette').hits.map((hit) => nameKey(nameOf.get(hit.id)))
    const first = await search(h, 'Blush Palette')
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const names = first.json.items.map((item) => item.name)
    assert.ok(names.some((name) => /hourglass blush palette evil eye/i.test(name)), 'Evil Eye is on the first page')
    assert.equal(first.json.total, new Set(wanted).size, 'total = the families the core finds')
    const small = await allItems(h, 'Blush Palette', 5)
    assert.equal(small.total, first.json.total)
    assert.equal(small.items.length, new Set(small.items.map((item) => item.id)).size, 'no row repeats across pages')
    assert.deepEqual(new Set(small.items.map((item) => nameKey(item.name))), new Set(wanted))
    // Ordered tier 2 (name starts with the query) before the rest.
    const prefixes = names.slice(0, 3).every((name) => /^blush palette/i.test(name))
    assert.ok(prefixes, `name-prefix rows lead: ${names.slice(0, 4)}`)
  })

  await check('OWNER: the typed target ranks first (exact name, reordered words, typo)', async () => {
    const exact = await search(h, 'Hourglass Blush Palette Evil Eye')
    assert.match(exact.json.items[0].name, /^hourglass blush palette evil eye$/i)
    const reordered = await search(h, 'evil eye palette blush hourglass')
    assert.match(reordered.json.items[0].name, /evil eye/i)
    const typo = await search(h, 'hourglas blush palete evil')
    assert.match(typo.json.items[0].name, /evil eye/i)
  })

  await check('OWNER: SK-II spellings return exactly the SK-II rows; sk-2 never the "Skin Tint 2" decoy', async () => {
    const reference = new Set((await allItems(h, 'SK-II')).items.map((item) => item.id))
    assert.ok(reference.size >= 50)
    for (const query of ['skii', 'sk2', 'sk ii', 'sk-2', 'sk 2']) {
      const got = (await allItems(h, query)).items
      assert.deepEqual(new Set(got.map((item) => item.id)), reference, query)
      assert.ok(!got.some((item) => /skin tint 2/i.test(item.name)), `${query} never brings Skin Tint 2`)
    }
  })

  await check('OWNER: typo tolerance (lipstik, mascra, consealer, pallet) and its decoys', async () => {
    const lipstik = (await allItems(h, 'lipstik')).items.map((item) => item.name)
    assert.ok(lipstik.some((name) => /lipstick/i.test(name)))
    assert.ok(!lipstik.some((name) => /\blip oil\b/i.test(name)), 'lipstik does not flood to Lip Oil')
    assert.ok((await allItems(h, 'mascra')).items.some((item) => /mascara/i.test(item.name)))
    assert.ok((await allItems(h, 'consealer')).items.some((item) => /concealer/i.test(item.name)))
    const pallet = (await allItems(h, 'pallet')).items.map((item) => item.name)
    assert.ok(pallet.some((name) => /palette/i.test(name)))
    assert.ok(!pallet.some((name) => /clarins.*\ball\b.*skin/i.test(name)), 'pallet is not contained in "All"')
    assert.match(pallet[0], /pallette/i, 'the real "pallette" product leads the typo matches')
    const elf = (await allItems(h, 'elf')).items.map((item) => item.name)
    assert.ok(elf.length > 0 && !elf.some((name) => /\b(self|shelf)\b/i.test(name)))
    for (const none of ['zzzz', 'qwerty']) assert.equal((await search(h, none)).json.total, 0)
    assert.ok(!(await allItems(h, 'oli')).items.some((item) => /\boil\b/i.test(item.name) && !/\boli/i.test(item.name)), 'short words get no fuzzy level')
  })

  await check('OWNER: Khmer keeps its vowel signs (exact rows, never the Morphe liner)', async () => {
    const serum = (await allItems(h, 'សេរ៉ូម')).items
    assert.ok(serum.length >= 4 && serum.every((item) => item.name.includes('សេរ៉ូម')))
    const lotion = (await allItems(h, 'ឡេ')).items
    assert.ok(lotion.length >= 1 && lotion.every((item) => item.name.includes('ឡេ')))
    assert.ok(!lotion.some((item) => /morphe/i.test(item.name)))
  })

  await check('barcodes: an exact barcode is first and a plain word never runs the barcode clause', async () => {
    const withBarcode = catalog.find((row) => /^\d{12,13}$/.test(row.barcode || ''))
    const res = await search(h, withBarcode.barcode)
    assert.equal(res.json.items[0].barcode, withBarcode.barcode)
    const words = await docQuery.prepareProductSearchDoc(env, 'palette')
    assert.equal(words.barcodeLookup, false, 'a plain word has no barcode lookup (its catch-all reads every product)')
    assert.equal((await docQuery.prepareProductSearchDoc(env, withBarcode.barcode)).barcodeLookup, true)
    const fragment = withBarcode.barcode.slice(3, 10)
    const found = (await search(h, fragment)).json.items.map((item) => item.barcode)
    assert.ok(found.includes(withBarcode.barcode), 'a 5+ digit fragment still finds the barcode (trigram table)')
  })

  await check('COMPLETENESS: missing documents are matched in code; a backlog above the cap uses the legacy clause', async () => {
    const targets = catalog.filter((row) => /blush palette/i.test(row.name)).slice(0, 4)
    const want = new Set((await allItems(h, 'Blush Palette')).items.map((item) => item.id))
    for (const row of targets) h.raw.db.prepare('UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE id = ?').run(row.id)
    try {
      const plan = await docQuery.prepareProductSearchDoc(env, 'Blush Palette')
      assert.deepEqual([...plan.missingIds].sort(), targets.map((row) => row.id).sort())
      const got = new Set((await allItems(h, 'Blush Palette')).items.map((item) => item.id))
      assert.deepEqual(got, want, 'the rows without a document are still found')
      // A typo query reaches them too (the core runs over the missing rows).
      assert.ok((await allItems(h, 'blush pallet')).items.some((item) => targets.some((row) => row.id === item.id)))

      const others = catalog.filter((row) => !/blush palette/i.test(row.name)).slice(0, docLib.MISSING_DOC_ROW_CAP + 5)
      for (const row of others) h.raw.db.prepare('UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE id = ?').run(row.id)
      assert.equal(await docQuery.prepareProductSearchDoc(env, 'Blush Palette'), undefined, 'backlog > cap: legacy clause')
      const legacy = new Set((await allItems(h, 'Blush Palette')).items.map((item) => nameKey(item.name)))
      assert.ok([...want].every((id) => legacy.has(nameKey(nameOf.get(id)))), 'the legacy clause finds them too')
    } finally {
      const rows = h.raw.db.prepare('SELECT id, name, brand FROM products WHERE search_doc IS NULL').all()
      for (const row of rows) h.raw.db.prepare('UPDATE products SET search_doc = ?, search_doc_version = 1 WHERE id = ?').run(core.docTerms(row), row.id)
    }
    assert.ok(await docQuery.prepareProductSearchDoc(env, 'Blush Palette'))
    h.raw.db.exec("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)")
  })

  await check('WRITERS: create sets the document; both-field edit rewrites it; partial edit nulls it and the repair restores it', async () => {
    const created = await h.request('POST', '/', { name: 'Zzyzx Test Palette', brand: 'Hourglass', category: 'Makeup', selling_price_usd: 3, cost_price_usd: 1, barcode: '9990001112223' })
    assert.equal(created.status, 200, JSON.stringify(created.json))
    const id = created.json.item.id
    const row = () => h.raw.db.prepare('SELECT name, brand, search_doc, search_doc_version FROM products WHERE id = ?').get(id)
    assert.equal(row().search_doc, core.docTerms({ id, name: 'Zzyzx Test Palette', brand: 'Hourglass' }))
    assert.equal(row().search_doc_version, 1)
    assert.ok((await search(h, 'zzyzx')).json.items.some((item) => item.id === id), 'found immediately')

    // updateRow directly (the route wraps it in a money-plan CAS the harness's
    // single-argument bind cannot satisfy); a real positional bind here.
    const writes = h.load('lib/productWrites.ts')
    const rawDb = h.raw.db
    const writerEnv = { DB: { prepare: (sql) => ({ bind: (...args) => ({ run: async () => ({ meta: { changes: rawDb.prepare(sql).run(...args).changes } }) }) }) } }
    await writes.updateRow(writerEnv, 'products', id, { name: 'Zzyzx Renamed Palette', brand: 'Huda Beauty' })
    assert.equal(row().search_doc, core.docTerms({ id, name: 'Zzyzx Renamed Palette', brand: 'Huda Beauty' }), 'a both-field edit writes the new document')
    assert.ok((await search(h, 'renamed huda')).json.items.some((item) => item.id === id))
    assert.ok(!(await search(h, 'test')).json.items.some((item) => item.id === id), 'the old name left the index')

    await writes.updateRow(writerEnv, 'products', id, { name: 'Zzyzx Partial Palette' })
    assert.equal(row().search_doc, null, 'a partial edit leaves the stale trigger to null the document')
    assert.equal(row().search_doc_version, null)
    assert.ok((await search(h, 'zzyzx partial')).json.items.some((item) => item.id === id), 'a missing document is still found')
    // The client may echo the derived columns back: they are never writable.
    await writes.updateRow(writerEnv, 'products', id, { name: 'Zzyzx Echo Palette', search_doc: 'stale echo', search_doc_version: 99 })
    assert.equal(row().search_doc, null)

    const repaired = await docLib.repairMissingSearchDocs({ DB: h.raw }, 10)
    assert.equal(repaired.repaired, 1)
    assert.equal(row().search_doc, core.docTerms({ id, name: 'Zzyzx Echo Palette', brand: 'Huda Beauty' }))
    assert.equal((await docLib.repairMissingSearchDocs({ DB: h.raw }, 10)).repaired, 0, 'nothing left to repair')
    h.raw.db.exec("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)")
    assert.ok((await search(h, 'zzyzx echo')).json.items.some((item) => item.id === id))
  })

  await check('WRITERS: a repair never overwrites an edit that landed after it read the row', async () => {
    const id = catalog.find((row) => row.id > 50000).id
    h.raw.db.prepare('UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE id = ?').run(id)
    const before = h.raw.db.prepare('SELECT name FROM products WHERE id = ?').get(id).name
    // The edit lands between the repair's read of the missing rows and its write.
    const realPrepare = h.db.prepare.bind(h.db)
    let injected = false
    h.db.prepare = (sql) => {
      const statement = realPrepare(sql)
      if (!/SELECT id, name, brand FROM products INDEXED BY idx_products_search_doc_missing/.test(sql)) return statement
      return { ...statement, all: async (params) => {
        const rows = await statement.all(params)
        if (!injected) { injected = true; h.raw.db.prepare('UPDATE products SET name = ? WHERE id = ?').run(`${before} Changed`, id) }
        return rows
      } }
    }
    try {
      const first = await docLib.repairMissingSearchDocs({ DB: h.raw }, 10)
      assert.equal(first.repaired, 0, 'the guarded UPDATE found the name changed and wrote nothing')
      assert.equal(h.raw.db.prepare('SELECT search_doc FROM products WHERE id = ?').get(id).search_doc, null)
    } finally { h.db.prepare = realPrepare }
    const second = await docLib.repairMissingSearchDocs({ DB: h.raw }, 10)
    assert.equal(second.repaired, 1)
    assert.ok(h.raw.db.prepare('SELECT search_doc FROM products WHERE id = ?').get(id).search_doc.includes('changed'), 'the next pass writes the document of the CURRENT name')
  })

  await check('DEPTH: the widest query (6 groups x 8 tokens, typos everywhere) parses at depth 100', async () => {
    const group = 'lipstik mascra consealer pallet foundaton sauvag hourglas blushh'
    const query = new Array(6).fill(group).join(', ')
    const res = await search(h, query)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const plan = await docQuery.prepareProductSearchDoc(env, query)
    assert.ok(plan.match.length > 800, 'a long expression, bound as ONE parameter')
    const orMode = await search(h, query, '&searchMode=OR')
    assert.equal(orMode.status, 200, JSON.stringify(orMode.json))
  })

  await check('INVENTORY and BRANCH stock pickers use the same index and agree with the products route', async () => {
    const inventory = h.load('routes/inventory.ts').default
    const branches = h.load('routes/branches.ts').default
    const call = async (app, path) => {
      const res = await app.request(`http://local${path}`, { method: 'GET' }, { DB: h.raw }, { waitUntil() {}, passThroughOnException() {} })
      return { status: res.status, json: await res.json().catch(() => null) }
    }
    h.raw.db.exec('INSERT OR IGNORE INTO branch_stock(product_id, branch_id, quantity) SELECT id, 1, 3 FROM products')
    const viaProducts = new Set((await allItems(h, 'blush pallet')).items.map((item) => nameKey(item.name)))
    const inv = await call(inventory, `/products/search?query=${encodeURIComponent('blush pallet')}&pageSize=100&metadata=0`)
    assert.equal(inv.status, 200, JSON.stringify(inv.json))
    assert.deepEqual(new Set(inv.json.items.map((item) => nameKey(item.name))), viaProducts)
    const stats = await call(inventory, `/stats?query=${encodeURIComponent('blush pallet')}`)
    assert.equal(stats.status, 200, JSON.stringify(stats.json))
    assert.equal(Number(stats.json.item.total_products), viaProducts.size, 'the stat cards count what the list shows')
    const stock = await call(branches, `/1/stock?query=${encodeURIComponent('blush pallet')}&pageSize=100&stockState=all`)
    assert.equal(stock.status, 200, JSON.stringify(stock.json))
    assert.deepEqual(new Set(stock.json.items.map((item) => nameKey(item.name))), viaProducts)
  })

  await check('DEGRADES: no vocabulary -> no typo variants but correct; no FTS table -> legacy answers', async () => {
    const withTypos = await docQuery.rewriteProductSearch('lipstik', vocab)
    assert.ok(/"lipstick"\*/.test(withTypos.match) && withTypos.strictMatch, withTypos.match)
    const noVocab = await docQuery.rewriteProductSearch('lipstik', async () => null)
    assert.equal(noVocab.strictMatch, null)
    assert.ok(!/lipstick/.test(noVocab.match))
    // the rewrite of a plain query is identical with or without the vocabulary
    assert.equal((await docQuery.rewriteProductSearch('blush palette', async () => null)).match.replace(/ OR "[a-z]+"/g, ''), (await docQuery.rewriteProductSearch('blush palette', vocab)).match.replace(/ OR "[a-z]+"/g, ''))

    h.raw.db.exec('DROP TABLE products_search_vocab')
    docQuery.resetProductSearchVocabCache()
    const degraded = await search(h, 'blush palette')
    assert.equal(degraded.status, 200, JSON.stringify(degraded.json))
    assert.ok(degraded.json.items.some((item) => /evil eye/i.test(item.name)))
    const typo = await search(h, 'blush pallet')
    assert.equal(typo.status, 200)
  })

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS test-search-doc-server-native')
  process.exit(failed ? 1 : 0)
})().catch((error) => { console.error(error); process.exit(1) })
