// Pins migration 0233 (products.search_doc + products_search_fts) on the REAL
// migration chain (better-sqlite3, synthetic rows, no production data).
//
//  1. Pre: nothing of 0233 exists, the three legacy FTS tables do. Post: the two
//     columns, products_search_fts, products_search_vocab, the partial index and
//     the four triggers exist, and nothing was backfilled (no row has a document).
//  2. FTS maintenance: a document written on INSERT or UPDATE is searchable
//     (term, prefix, '~' joined-term, quoted Khmer phrase); replacing it moves
//     the entry; deleting the row removes it; a row WITHOUT a document is never
//     indexed, and updating or deleting it does not corrupt the FTS5 statistics
//     (integrity-check after every step).
//  3. STALENESS: changing name or brand in a statement that leaves search_doc
//     alone nulls the document (and its FTS entry); a statement that writes the
//     document with the text keeps it; unrelated columns (stock) never touch it.
//     POSITIVE CONTROL: without the stale trigger the old document survives a
//     rename, which is the wrong answer this trigger exists to prevent.
//  4. The partial index lists exactly the ACTIVE rows with no document, so the
//     "how many are missing" probe reads only those (no table scan).
//  5. The vocabulary view serves one first-letter range (term >= a AND term < b).
//  6. Re-applying fails loudly (ADD COLUMN twice), and the documented recovery
//     removes the objects and leaves the legacy search tables answering.
//  7. The file is LF-only, carries the Pre/Post/Recovery header, and is the only
//     file claiming number 0233.
//
// Run: node scripts/test-migration-0233-products-search-doc-pure.cjs
'use strict'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0233_products_search_doc.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')
const OBJECTS = ['products_search_fts', 'products_search_vocab', 'idx_products_search_doc_missing',
  'products_search_fts_ai', 'products_search_fts_ad', 'products_search_fts_au', 'products_search_doc_stale']

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks += 1
  console.log(`  ok  ${label}`)
}

function open(through) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => through(f))) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return db
}
const exists = (db, name) => db.prepare('SELECT COUNT(*) n FROM sqlite_master WHERE name = ?').get(name).n === 1
const integrity = (db) => db.exec("INSERT INTO products_search_fts(products_search_fts, rank) VALUES('integrity-check', 1)")
const hits = (db, match) => db.prepare('SELECT rowid FROM products_search_fts WHERE products_search_fts MATCH ? ORDER BY rowid').all(match).map((row) => row.rowid)
const doc = (db, id) => db.prepare('SELECT search_doc, search_doc_version FROM products WHERE id = ?').get(id)
const insert = (db, id, name, brand, searchDoc, active = 1) => db.prepare(
  'INSERT INTO products(id, name, brand, search_doc, search_doc_version, is_active, cost_price_usd, selling_price_usd) VALUES (?, ?, ?, ?, ?, ?, 1, 2)',
).run(id, name, brand, searchDoc, searchDoc == null ? null : 1, active)

// ---- 1. pre / post
const before = open((f) => f < FILE)
const columnsBefore = before.prepare("SELECT name FROM pragma_table_info('products') WHERE name IN ('search_doc', 'search_doc_version')").all()
check('PRE: neither column exists before 0233', columnsBefore.length === 0)
check('PRE: the three legacy FTS tables exist', ['products_fts', 'products_fts_code', 'products_fts_name_trigram'].every((name) => exists(before, name)))
check('PRE: none of the 0233 objects exist', OBJECTS.every((name) => !exists(before, name)))
before.exec("INSERT INTO products(id, name, brand, is_active, cost_price_usd, selling_price_usd) VALUES (1, 'Existing One', 'Brand', 1, 1, 2), (2, 'Existing Two', NULL, 1, 1, 2)")
before.exec(migration)
check('POST: both columns exist', before.prepare("SELECT COUNT(*) n FROM pragma_table_info('products') WHERE name IN ('search_doc', 'search_doc_version')").get().n === 2)
check('POST: every 0233 object exists', OBJECTS.every((name) => exists(before, name)))
check('POST: nothing was backfilled (the normalizer is JS, the backfill is a held ops step)', before.prepare('SELECT COUNT(*) n FROM products WHERE search_doc IS NOT NULL OR search_doc_version IS NOT NULL').get().n === 0)
check('POST: the two pre-existing rows are untouched', before.prepare('SELECT COUNT(*) n FROM products').get().n === 2)
integrity(before)
check('POST: the FTS5 integrity check (rank=1, index vs content table) passes', true)
check('POST: every existing row is in the index as an empty document', before.prepare('SELECT COUNT(*) n FROM products_search_fts').get().n === 2 && before.prepare("SELECT COUNT(*) n FROM products_search_fts WHERE products_search_fts MATCH 'existing'").get().n === 0)
check('POST: both pre-existing rows are listed as missing documents', before.prepare("SELECT COUNT(*) n FROM products WHERE search_doc IS NULL AND is_active = 1").get().n === 2)

// ---- 2. FTS maintenance
const db = open((f) => f <= FILE)
insert(db, 10, 'SK-II Facial Treatment Essence', 'SK-II', 'essence facial skii ~skii ~sk2 sk ii 2 treatment')
insert(db, 11, 'Blush Palette Love', 'Hourglass', 'blush hourglass love palette')
insert(db, 12, 'Serum Khmer', null, 'khmer serum សេរ៉ូម')
insert(db, 13, 'No Doc Yet', null, null)
integrity(db)
check('INSERT with a document: term search finds it', hits(db, '"palette"').join() === '11')
check('INSERT with a document: prefix search finds it', hits(db, '"pal"*').join() === '11')
check('INSERT with a document: a joined term is reachable only behind its mark', hits(db, '"~skii"').join() === '10' && hits(db, '"skii"').join() === '10' && hits(db, '"~sk"*').join() === '10')
check("a plain term prefix does not reach a joined term ('~' is a token character)", hits(db, '"skiii"*').length === 0 && hits(db, '"kii"*').length === 0)
check('a Khmer phrase finds the row (unicode61 splits Khmer at its marks on both sides)', hits(db, '"សេរ៉ូម"').join() === '12' && hits(db, '"សេរ៉ូ"*').join() === '12')
check('a row WITHOUT a document is an empty document: in the index, matching nothing', hits(db, '"doc"').length === 0 && db.prepare('SELECT COUNT(*) n FROM products_search_fts').get().n === 4)

db.prepare('UPDATE products SET search_doc = ?, search_doc_version = 1 WHERE id = 11').run('blush hourglass palette wish')
integrity(db)
check('UPDATE of the document moves the entry', hits(db, '"love"').length === 0 && hits(db, '"wish"').join() === '11')
db.prepare('UPDATE products SET search_doc = ?, search_doc_version = 1 WHERE id = 13').run('doc nodoc yet')
integrity(db)
check('UPDATE of a NULL document into a value indexes it', hits(db, '"nodoc"').join() === '13')
db.prepare('UPDATE products SET stock_quantity = 5 WHERE id IN (10, 11, 12, 13)').run()
integrity(db)
check('an unrelated UPDATE (stock) leaves documents and index alone', hits(db, '"wish"').join() === '11' && doc(db, 11).search_doc === 'blush hourglass palette wish')
db.prepare('DELETE FROM products WHERE id = 12').run()
integrity(db)
check('DELETE removes the entry', hits(db, '"serum"').length === 0)
db.prepare('DELETE FROM products WHERE id = 13').run()
insert(db, 14, 'Never Indexed', null, null)
db.prepare('UPDATE products SET stock_quantity = 2 WHERE id = 14').run()
db.prepare('DELETE FROM products WHERE id = 14').run()
integrity(db)
check('updating and deleting a row that never had a document keeps the index consistent with the table', db.prepare('SELECT COUNT(*) n FROM products_search_fts').get().n === db.prepare('SELECT COUNT(*) n FROM products').get().n)

// ---- 3. staleness
insert(db, 20, 'Old Name', 'Brand', 'brand name old')
db.prepare("UPDATE products SET name = 'New Name' WHERE id = 20").run()
integrity(db)
check('STALE: a rename that leaves search_doc alone nulls the document and its version', doc(db, 20).search_doc === null && doc(db, 20).search_doc_version === null)
check('STALE: the FTS entry went with it', hits(db, '"old"').length === 0)
insert(db, 21, 'Old Name', 'Brand', 'brand name old')
db.prepare("UPDATE products SET brand = 'Other' WHERE id = 21").run()
check('STALE: a brand change nulls it too', doc(db, 21).search_doc === null)
insert(db, 22, 'Old Name', 'Brand', 'brand name old')
db.prepare("UPDATE products SET name = 'Fresh Name', search_doc = 'brand fresh name', search_doc_version = 1 WHERE id = 22").run()
integrity(db)
check('a writer that sets the document with the text keeps it', doc(db, 22).search_doc === 'brand fresh name' && hits(db, '"fresh"').join() === '22' && hits(db, '"old"').length === 0)
db.prepare("UPDATE products SET name = 'Fresh Name', brand = 'Brand' WHERE id = 22").run()
check('an UPDATE that rewrites the SAME text (no change) keeps the document', doc(db, 22).search_doc === 'brand fresh name')
db.prepare("UPDATE products SET updated_at = CURRENT_TIMESTAMP, description = 'x' WHERE id = 22").run()
check('other columns never null it', doc(db, 22).search_doc === 'brand fresh name')

const control = open((f) => f <= FILE)
control.exec('DROP TRIGGER products_search_doc_stale')
insert(control, 30, 'Old Name', 'Brand', 'brand name old')
control.prepare("UPDATE products SET name = 'New Name' WHERE id = 30").run()
check('POSITIVE CONTROL: without the stale trigger the old document survives a rename (the wrong answer)', doc(control, 30).search_doc === 'brand name old' && hits(control, '"old"').join() === '30')

// ---- 4. the partial index
insert(db, 40, 'Missing Active', null, null)
insert(db, 41, 'Missing Inactive', null, null, 0)
insert(db, 42, 'Has Doc', null, 'has doc')
const missingSql = 'SELECT id FROM products INDEXED BY idx_products_search_doc_missing WHERE search_doc IS NULL AND is_active = 1 ORDER BY id LIMIT 51'
const unforced = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM products WHERE search_doc IS NULL AND is_active = 1 ORDER BY id LIMIT 51').all().map((row) => row.detail).join(' | ')
check(`POSITIVE CONTROL: without INDEXED BY the planner (no ANALYZE) walks the broad is_active index instead (${unforced})`, !/idx_products_search_doc_missing/.test(unforced))
const plan = db.prepare(`EXPLAIN QUERY PLAN ${missingSql}`).all().map((row) => row.detail).join(' | ')
check(`the missing-document probe walks the partial index, never the table (${plan})`, /idx_products_search_doc_missing/.test(plan) && !/SCAN products(?! USING)/.test(plan))
const missing = db.prepare(missingSql).all().map((row) => row.id)
check('the probe lists the active rows without a document (the nulled ones, the new one), not the inactive or documented ones',
  missing.includes(40) && missing.includes(20) && !missing.includes(41) && !missing.includes(42))
db.prepare('UPDATE products SET search_doc = ?, search_doc_version = 1 WHERE id = 40').run('missing active')
check('writing the document removes the row from the probe', !db.prepare(missingSql).all().some((row) => row.id === 40))

// ---- 5. vocabulary
const range = db.prepare('SELECT term FROM products_search_vocab WHERE term >= ? AND term < ? ORDER BY term')
const bRange = range.all('b', 'c').map((row) => row.term)
check(`the vocabulary view serves one first-letter range (${bRange.join(',')})`, bRange.includes('blush') && bRange.includes('brand') && bRange.every((term) => term[0] === 'b'))
check('joined terms are in the range behind the mark', range.all('~', '').some((row) => row.term === '~skii') || db.prepare("SELECT term FROM products_search_vocab WHERE term >= '~s' AND term < '~t'").all().some((row) => row.term === '~skii'))

// ---- 6. re-apply and recovery
let reapplied = true
try { open((f) => f <= FILE).exec(migration) } catch { reapplied = false }
check('re-applying 0233 fails loudly instead of silently duplicating (ADD COLUMN twice)', !reapplied)
const recovered = open((f) => f <= FILE)
insert(recovered, 50, 'Recover Me', 'Brand', 'brand me recover')
recovered.exec(`DROP TRIGGER IF EXISTS products_search_fts_ai; DROP TRIGGER IF EXISTS products_search_fts_ad; DROP TRIGGER IF EXISTS products_search_fts_au;
  DROP TRIGGER IF EXISTS products_search_doc_stale; DROP TABLE IF EXISTS products_search_vocab; DROP TABLE IF EXISTS products_search_fts;
  DROP INDEX IF EXISTS idx_products_search_doc_missing;`)
check('RECOVERY: every 0233 object is gone and the inert columns remain', OBJECTS.every((name) => !exists(recovered, name)) && recovered.prepare("SELECT COUNT(*) n FROM pragma_table_info('products') WHERE name = 'search_doc'").get().n === 1)
recovered.prepare("UPDATE products SET name = 'Renamed' WHERE id = 50").run()
recovered.prepare('DELETE FROM products WHERE id = 50').run()
check('RECOVERY: products still write (no dangling trigger)', true)
check('RECOVERY: the legacy FTS tables still answer', recovered.prepare("SELECT COUNT(*) n FROM products_fts WHERE products_fts MATCH 'renamed'").get().n === 0 && exists(recovered, 'products_fts'))
const rebuilt = open((f) => f <= FILE)
insert(rebuilt, 60, 'Rebuild', null, 'rebuild doc')
rebuilt.exec("INSERT INTO products_search_fts(products_search_fts) VALUES('rebuild')")
integrity(rebuilt)
check("the documented 'rebuild' repairs the index from products", hits(rebuilt, '"rebuild"').join() === '60')

// ---- 7. file hygiene
check('the migration is LF-only (trigger SQL must not carry CR)', !migration.includes('\r'))
for (const heading of ['Pre-assert:', 'Post-assert:', 'Recovery:', 'Deploy order:']) check(`the header carries "${heading}"`, migration.includes(heading))
check('exactly one file claims number 0233', fs.readdirSync(migrationsDir).filter((f) => f.startsWith('0233_')).length === 1)

console.log(`\nPASS test-migration-0233-products-search-doc-pure (${checks} checks)`)
