// A realistic, deterministic product catalog for the search tests: thousands of
// rows shaped like the shop's (6,226 active products, ~212 brands, ~12% brand-
// less, Khmer names, same-name siblings with different barcodes).
//
// The owner-case rows are REAL: the 920-row sample in
// fixtures/search-core-catalog-sample.json (Hourglass/NARS/Huda/Milani/YSL
// blush palettes, the 54 SK-II rows, e.l.f., the Dior "Pallette", the Khmer
// rows and the decoys "Skin Tint 2", "Clarins ... All Skin", "Brush", "Self"/
// "Shelf", "Morphe ... ក្រឡ"). Around them a seeded generator adds noise rows
// built from the sample's own brands, categories and name words -- never from
// the words the owner cases and negative controls search for -- so every
// assertion about those queries is about the same rows the real catalog has,
// and the surrounding catalog is large enough that a scan shows up in the
// rows-read count.
'use strict'
const path = require('node:path')

const SAMPLE = require(path.join(__dirname, '..', 'fixtures', 'search-core-catalog-sample.json')).rows

// Words no generated row may carry: the owner queries and the decoys' words.
const RESERVED = new Set(['blush', 'palette', 'pallette', 'pallet', 'sk', 'ii', 'lip', 'lipstick', 'lipsticks', 'mascara', 'concealer',
  'skin', 'tint', 'all', 'brush', 'self', 'shelf', 'serum', 'lotion', 'love', 'wish', 'hope', 'elf', 'spf', 'oil'])

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function vocabulary(rows) {
  const brands = new Map()
  const categories = new Set()
  const words = new Set()
  for (const row of rows) {
    if (row.brand && /^[\x20-\x7e]+$/.test(row.brand)) brands.set(row.brand, (brands.get(row.brand) || 0) + 1)
    if (row.category) categories.add(row.category)
    for (const word of String(row.name).toLowerCase().split(/[^a-z]+/)) {
      if (word.length >= 3 && word.length <= 10 && !RESERVED.has(word)) words.add(word)
    }
  }
  // SK-II stays exactly the sample's 54 rows (the owner cases count them).
  brands.delete('SK-II')
  return { brands: [...brands.keys()].sort(), categories: [...categories].sort(), words: [...words].sort() }
}

function buildCatalog({ total = 6200, seed = 20261006, firstGeneratedId = 50001 } = {}) {
  const rows = SAMPLE.map((row) => ({ ...row }))
  const { brands, categories, words } = vocabulary(SAMPLE)
  const random = mulberry32(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const title = (word) => word[0].toUpperCase() + word.slice(1)
  const sizes = ['', '', '', ' 30ml', ' 50ml', ' 100ml', ' 250ml', ' 01', ' 02', ' 03', ' 120', ' 4g', ' SPF30']
  const usedBarcodes = new Set(SAMPLE.map((row) => row.barcode).filter(Boolean))
  let id = firstGeneratedId
  const generated = []
  while (rows.length + generated.length < total) {
    const brand = random() < 0.12 ? null : pick(brands)
    const wordCount = 2 + Math.floor(random() * 3)
    const parts = []
    for (let i = 0; i < wordCount; i += 1) parts.push(title(pick(words)))
    const name = `${brand ? `${brand} ` : ''}${parts.join(' ')}${pick(sizes)}`
    let barcode = null
    if (random() > 0.01) {
      do { barcode = String(Math.floor(random() * 9e12) + 1e12) } while (usedBarcodes.has(barcode))
      usedBarcodes.add(barcode)
    }
    generated.push({ id: id++, name, brand, category: pick(categories), barcode, sku: null })
    // A same-name sibling with its own barcode (the child-row model).
    if (random() < 0.04 && rows.length + generated.length < total) {
      let sibling
      do { sibling = String(Math.floor(random() * 9e12) + 1e12) } while (usedBarcodes.has(sibling))
      usedBarcodes.add(sibling)
      generated.push({ id: id++, name, brand, category: pick(categories), barcode: sibling, sku: null })
    }
  }
  return rows.concat(generated)
}

// Bulk insert for a node:sqlite database that already has every migration.
// trg_products_ai_name_key re-counts the name group on every insert (about
// 12 ms per row at 6,000 rows: over a minute), so it is dropped for the load
// and the two columns it maintains are written directly, then it is restored.
// `docOf(row)` returns the row's search_doc (or null for a missing document);
// the FTS tables are filled by their own insert triggers.
function seedProducts(db, rows, { docOf = null, version = 1 } = {}) {
  const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_products_ai_name_key'").get()
  if (trigger) db.exec('DROP TRIGGER trg_products_ai_name_key')
  const keyOf = (row) => String(row.name).trim().toLowerCase()
  const sizes = new Map()
  for (const row of rows) sizes.set(keyOf(row), (sizes.get(keyOf(row)) || 0) + 1)
  const insert = db.prepare(`INSERT INTO products(id, name, brand, category, barcode, sku, name_key, is_grouped_cached, search_doc, search_doc_version,
    cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 5, 0, 1)`)
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const doc = docOf ? docOf(row) : null
      insert.run(row.id, row.name, row.brand ?? null, row.category ?? null, row.barcode ?? null, row.sku ?? null,
        keyOf(row), sizes.get(keyOf(row)) > 1 ? 1 : 0, doc, doc == null ? null : version)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    if (trigger) db.exec(trigger.sql)
  }
}

module.exports = { buildCatalog, seedProducts, SAMPLE_ROWS: SAMPLE }
