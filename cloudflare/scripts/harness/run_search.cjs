const Database = require('better-sqlite3')
const fs = require('fs')
const {
  buildFtsMatchExpression,
  buildTrigramMatchExpression,
  buildHybridMatchClause,
  buildShortWordFallbackClause,
  tokenizeSearchTermGroups,
  PRODUCT_SEARCH_COLUMNS,
} = require('./load_search_match.cjs')

const products = JSON.parse(fs.readFileSync('./products.json', 'utf8'))

const db = new Database(':memory:')
db.exec(`
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT, sku TEXT, barcode TEXT, brand TEXT, category TEXT, supplier TEXT, description TEXT, unit TEXT
);
CREATE VIRTUAL TABLE products_fts USING fts5(
  name, sku, barcode, brand, category, supplier, description, unit,
  content='products', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE products_fts_code USING fts5(
  barcode, sku, content='products', content_rowid='id', tokenize='trigram'
);
CREATE VIRTUAL TABLE products_fts_name_trigram USING fts5(
  name, content='products', content_rowid='id', tokenize='trigram'
);
`)

const insert = db.prepare(`INSERT INTO products (id,name,sku,barcode,brand,category,supplier,description,unit)
  VALUES (@id,@name,@sku,@barcode,@brand,@category,@supplier,@description,@unit)`)
const insertFts = db.prepare(`INSERT INTO products_fts (rowid,name,sku,barcode,brand,category,supplier,description,unit)
  VALUES (@id,@name,@sku,@barcode,@brand,@category,@supplier,@description,@unit)`)
const insertCode = db.prepare(`INSERT INTO products_fts_code (rowid,barcode,sku) VALUES (@id,@barcode,@sku)`)
const insertNameTrigram = db.prepare(`INSERT INTO products_fts_name_trigram (rowid,name) VALUES (@id,@name)`)

const tx = db.transaction((rows) => {
  rows.forEach((p, i) => {
    const row = { id: i + 1, name: p.name || '', sku: p.sku || '', barcode: p.barcode || '', brand: p.brand || '', category: p.category || '', supplier: p.supplier || '', description: p.description || '', unit: p.unit || '' }
    insert.run(row)
    insertFts.run(row)
    insertCode.run(row)
    insertNameTrigram.run(row)
  })
})
tx(products)
console.log(`Loaded ${products.length} products`)

// Replicates routes/products.ts buildSearchFilters' search-clause assembly exactly.
function searchProductIds(rawQuery, searchMode = 'AND') {
  const groups = tokenizeSearchTermGroups(rawQuery, 6, 8)
  if (!groups.length) return null
  const ftsMatch = buildFtsMatchExpression(groups, searchMode, PRODUCT_SEARCH_COLUMNS)
  const trigramMatch = buildTrigramMatchExpression(groups, searchMode)
  const hybridMatch = buildHybridMatchClause(groups, searchMode, 'hyb', PRODUCT_SEARCH_COLUMNS)
  const clauses = []
  const params = {}
  if (ftsMatch) { params.ftsQuery = ftsMatch; clauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)') }
  if (trigramMatch) { params.codeQuery = trigramMatch; clauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)') }
  if (trigramMatch) { params.nameCodeQuery = trigramMatch; clauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @nameCodeQuery)') }
  if (hybridMatch) { Object.assign(params, hybridMatch.params); clauses.push(hybridMatch.sql) }
  const shortWordMatch = buildShortWordFallbackClause(groups, searchMode, ['p.name', 'p.unit'], params, 'shortw')
  if (shortWordMatch) clauses.push(shortWordMatch)
  if (!clauses.length) return new Set()
  const where = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
  const sql = `SELECT p.id FROM products p WHERE ${where}`
  const rows = db.prepare(sql).all(params)
  return new Set(rows.map(r => r.id))
}

// --- Build a battery of realistic test queries per product -----------------
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

const failures = []
let totalCases = 0
let failCases = 0
const failureKinds = {}

function recordCase(kind, id, name, query) {
  totalCases++
  const ids = searchProductIds(query)
  const pass = ids && ids.has(id)
  if (!pass) {
    failCases++
    failureKinds[kind] = (failureKinds[kind] || 0) + 1
    failures.push({ kind, id, name, query })
  }
}

products.forEach((p, i) => {
  const id = i + 1
  const name = p.name || ''
  const barcode = p.barcode || ''
  const words = name.split(/\s+/).filter(Boolean)

  // 1) Full exact name
  recordCase('full_name', id, name, name)

  // 2) Last word of the name, as typed
  if (words.length > 1) {
    const last = words[words.length - 1]
    recordCase('last_word', id, name, last)
  }

  // 3) First word
  recordCase('first_word', id, name, words[0])

  // 4) Two words out of order (last then first) -- AND mode, order shouldn't matter
  if (words.length >= 2) {
    recordCase('reordered_two_words', id, name, `${words[words.length - 1]} ${words[0]}`)
  }

  // 5) A middle word, if any
  if (words.length >= 3) {
    recordCase('middle_word', id, name, words[Math.floor(words.length / 2)])
  }

  // 6) Trailing digits found at the END of a token (not its own separate
  //    word) e.g. "Abercrombie Authantic 10ml" -> token "10ml", searching
  //    just the numeric part "10" is a *prefix* of that token (should
  //    work), but searching the unit suffix "ml" is NOT a prefix (may fail
  //    -- this is the documented prefix-only gap).
  const numSuffixTokenMatch = name.match(/(\d+)([a-zA-Z]+)\b/)
  if (numSuffixTokenMatch) {
    const numPart = numSuffixTokenMatch[1]
    const letterPart = numSuffixTokenMatch[2]
    recordCase('numeric_prefix_of_token', id, name, numPart)
    recordCase('letter_suffix_of_token', id, name, letterPart)
  }

  // 7) A trailing digit sequence at the very end of the whole name (could
  //    be its own token, e.g. "... 617" or fused like "...12345")
  const trailingDigits = name.match(/(\d+)\s*$/)
  if (trailingDigits) {
    const digits = trailingDigits[1]
    // last 3 digits of that trailing number (a MIDDLE/END fragment of the
    // token, not its prefix)
    if (digits.length >= 4) {
      recordCase('end_of_trailing_number', id, name, digits.slice(-3))
    }
  }

  // 8) Barcode: full, first-6, middle fragment, last fragment
  if (barcode && barcode.length >= 6) {
    recordCase('barcode_full', id, name, barcode)
    recordCase('barcode_prefix6', id, name, barcode.slice(0, 6))
    recordCase('barcode_last4', id, name, barcode.slice(-4))
    const midStart = Math.floor(barcode.length / 2) - 2
    recordCase('barcode_middle4', id, name, barcode.slice(midStart, midStart + 4))
  }

  // 9) name+barcode-fragment mixed single group (space-joined, one comma
  //    group with both a name word and a barcode fragment)
  if (barcode && barcode.length >= 6 && words.length >= 1) {
    recordCase('mixed_name_and_barcode_fragment', id, name, `${words[0]} ${barcode.slice(-4)}`)
  }

  // 10) lowercase / uppercase variants
  recordCase('lowercase_full_name', id, name, name.toLowerCase())
  recordCase('uppercase_first_word', id, name, words[0].toUpperCase())

  // 11) joiner variance: replace spaces with hyphens in a 2-word slice
  if (words.length >= 2) {
    recordCase('joiner_hyphenated', id, name, `${words[0]}-${words[1]}`)
  }

  // 12) brand + partial name combination
  if (p.brand && words.length) {
    recordCase('brand_plus_word', id, name, `${p.brand} ${words[words.length - 1]}`)
  }

  // 13) Khmer-script word inside the name (many names here are bilingual
  //     Khmer/English), searched verbatim as typed
  const khmerWords = words.filter(w => /[\u1780-\u17FF]/.test(w))
  if (khmerWords.length) {
    recordCase('khmer_word', id, name, khmerWords[0])
  }
})

console.log(`\nTotal cases: ${totalCases}, failed: ${failCases} (${(100*failCases/totalCases).toFixed(2)}%)`)
console.log('\nFailures by kind:')
Object.entries(failureKinds).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`))

fs.writeFileSync('./failures.json', JSON.stringify(failures, null, 2))
console.log(`\nWrote ${failures.length} sample failures to failures.json`)
console.log('\nSample failures:')
failures.slice(0, 25).forEach(f => console.log(`  [${f.kind}] "${f.query}" -> "${f.name}"`))
