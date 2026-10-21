// Lane 6.0.927: the raw barcode LIKE searches that 6.0.921 did not reach. A
// scanner gun on the Windows Khmer layout types ០-៩, so the Stock Change
// ledger, the Stock-in sessions list and the import-review search matched no
// barcode. Each builder now binds a second, folded parameter for the barcode
// side only; the literal search and every name column stay exactly as typed.
//
// Loads the REAL lib modules (transpiled, relative imports resolved from
// src/lib) and runs the generated SQL against the real migration chain. Every
// check runs and the failures are listed together, so the red on the base
// commit names each broken behaviour instead of stopping at the first.
//
// Run: node scripts/test-barcode-khmer-digits-sql-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const loaded = new Map()
function loadLib(name) {
  if (loaded.has(name)) return loaded.get(name).exports
  const file = path.join(LIB, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const mod = { exports: {} }
  loaded.set(name, mod)
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, (request) => (request.startsWith('./') ? loadLib(request.slice(2)) : require(request)))
  return mod.exports
}

const search = loadLib('searchMatch')
const ledger = loadLib('stockLedgerQuery')
const sessions = loadLib('stockInSessionsQuery')
const importReview = loadLib('importReviewQuery')

const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const ASCII_CODE = '3348901729222'
const KHMER_PARTIAL = '១៧២៩២២២'
const KHMER_STORED = '៥៥៥៥១២៣៤៩'
const NAME_KHMER_DIGITS = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'
const NAME_ASCII_DIGITS = 'ទឹកអប់ផ្កាម្លិះ 100មល'

const failures = []
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`RED  ${name}\n     ${String(error.message).split('\n')[0]}`)
  }
}

const db = openDb(loadAll())
const PRODUCTS = [
  [1, 'Dior Backstage Highlighter', ASCII_CODE],
  [2, 'Other product', '3348901729223'],
  [3, NAME_KHMER_DIGITS, '4006381333931'],
  [4, NAME_ASCII_DIGITS, '4006381333932'],
  [5, 'Stored in Khmer digits', KHMER_STORED],
  [6, 'Lip serum', 'AB-12345'],
]
seedStockFixture(db, () => {
  db.exec(`
    INSERT INTO users (id,username,name,password) VALUES (7,'james','Ung Sethy Pagna','x');
    INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1);
    INSERT INTO suppliers (id,name) VALUES (1,'Bong Long');`)
  for (const [id, name, barcode] of PRODUCTS) {
    db.prepare('INSERT INTO products (id,name,barcode,unit,is_active) VALUES (@id,@name,@barcode,@unit,1)').bind({ id, name, barcode, unit: 'pcs' }).run()
    db.prepare(`INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,supplier_id,supplier_name,payment_status,unit_cost_usd,received_cost_usd,updated_at)
      VALUES (@id,@id,'260901','260901','2026-09-01',1,1,'Bong Long','paid',5,25,'2026-09-01 10:00:00')`).bind({ id }).run()
    db.prepare(`INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id)
      VALUES (@id,@id,@name,1,'Shop','add',5,5,25,@reference,7,'Za','2026-09-01 03:00:00',@id)`).bind({ id, name, reference: 100 + id }).run()
  }
})

const ledgerProductIds = (searchText) => {
  const query = ledger.buildStockLedgerQuery({ search: searchText })
  return db.prepare(query.rowsSql).bind({ ...query.params, limit: 50, offset: 0 }).all().map((row) => Number(row.product_id)).sort((a, b) => a - b)
}
const sessionProductIds = (searchText) => {
  const { groupedSql, params } = sessions.buildStockInSessionListQuery(searchText)
  return db.prepare(`SELECT session_key FROM (${groupedSql}) grouped ORDER BY session_key`).bind(params).all()
    .map((row) => Number(String(row.session_key).replace('session:', '')) - 100)
}

check('the ledger finds the ASCII barcode for a Khmer scan, full and partial', () => {
  assert.deepEqual(ledgerProductIds(ASCII_CODE), [1], 'positive control: the ASCII scan')
  assert.deepEqual(ledgerProductIds(KHMER_CODE), [1])
  assert.deepEqual(ledgerProductIds(KHMER_PARTIAL), [1], 'a partial scan is a LIKE substring as before')
  assert.deepEqual(ledgerProductIds('៣៣៤៨៩០១៧២៩២២៣'), [2], 'a different Khmer code finds only its own row')
  assert.deepEqual(ledgerProductIds('ab-១២៣៤៥'), [6], 'a Khmer-digit tail on a letter sku folds too')
})

check('the stock-in sessions list finds the ASCII barcode for a Khmer scan, full and partial', () => {
  assert.deepEqual(sessionProductIds(ASCII_CODE), [1], 'positive control: the ASCII scan')
  assert.deepEqual(sessionProductIds(KHMER_CODE), [1])
  assert.deepEqual(sessionProductIds(KHMER_PARTIAL), [1])
  assert.deepEqual(sessionProductIds('៣៣៤៨៩០១៧២៩២២៣'), [2])
  assert.deepEqual(sessionProductIds('AB-១២៣៤៥'), [6], 'the search is lower-cased before the fold, as before')
})

check('the ledger and the sessions list keep a barcode stored in Khmer digits reachable by its literal text', () => {
  assert.deepEqual(ledgerProductIds(KHMER_STORED), [5])
  assert.deepEqual(sessionProductIds(KHMER_STORED), [5])
})

check('guard: a Khmer name search is unchanged in the ledger and the sessions list', () => {
  assert.deepEqual(ledgerProductIds('ទឹកអប់ផ្កាម្លិះ'), [3, 4], 'Khmer words reach both names')
  assert.deepEqual(ledgerProductIds('១០០មល'), [3], 'Khmer digits in a name never reach the ASCII-numbered name')
  assert.deepEqual(ledgerProductIds('100មល'), [4])
  assert.deepEqual(sessionProductIds('ទឹកអប់ផ្កាម្លិះ'), [3, 4])
  assert.deepEqual(sessionProductIds('១០០មល'), [3])
  assert.deepEqual(sessionProductIds('100មល'), [4])
  assert.deepEqual(ledgerProductIds('dior'), [1], 'a plain ASCII name search is untouched')
  assert.deepEqual(sessionProductIds('dior'), [1])
})

check('guard: the extra barcode parameter exists only for a lone code-shaped Khmer-digit search', () => {
  for (const text of [ASCII_CODE, 'dior', '100មល', '១០០មល', 'ទឹកអប់ផ្កាម្លិះ', `dior ${KHMER_CODE}`, `${KHMER_CODE} ${ASCII_CODE}`, '50%_off', '']) {
    const ledgerQuery = ledger.buildStockLedgerQuery({ search: text })
    assert.equal('codeSearch' in ledgerQuery.params, false, `ledger params for ${JSON.stringify(text)}`)
    assert.doesNotMatch(ledgerQuery.rowsSql, /@codeSearch/)
    const { groupedSql, params } = sessions.buildStockInSessionListQuery(text)
    assert.equal('codeSearch' in params, false, `sessions params for ${JSON.stringify(text)}`)
    assert.doesNotMatch(groupedSql, /@codeSearch/)
    const review = importReview.buildImportReviewWhere({ jobId: 'job', query: text })
    assert.equal('codeQuery' in review.params, false, `review params for ${JSON.stringify(text)}`)
    assert.doesNotMatch(review.sql, /@codeQuery/)
  }
  const khmer = ledger.buildStockLedgerQuery({ search: KHMER_CODE })
  assert.equal(khmer.params.codeSearch, `%${ASCII_CODE}%`)
  assert.equal(khmer.params.search, `%${KHMER_CODE}%`, 'the literal search is still bound as typed')
  assert.equal(sessions.buildStockInSessionListQuery(KHMER_CODE).params.codeSearch, `%${ASCII_CODE}%`)
  assert.equal(importReview.buildImportReviewWhere({ jobId: 'job', query: KHMER_CODE }).params.codeQuery, `%${ASCII_CODE}%`)
  assert.equal(ledger.buildStockLedgerQuery({ search: '១២_៣៤' }).params.codeSearch, '%12\\_34%', 'LIKE wildcards stay literal in the folded parameter')
})

check('the fold applies to a lone code-shaped search only, and agrees with searchMatch.foldNativeDigits', () => {
  assert.equal(typeof sessions.asciiCodeSearch, 'function', 'asciiCodeSearch is exported for the ledger')
  const cases = [
    ['០១២៣៤៥៦៧៨៩', '0123456789'],
    [KHMER_CODE, ASCII_CODE],
    ['33៤8៩០1៧2៩222', ASCII_CODE],
    ['ab-១២៣៤៥', 'ab-12345'],
    ['១២_៣៤', '12_34'],
    ['100', ''],
    ['dior', ''],
    [NAME_KHMER_DIGITS, ''],
    ['១០០មល', ''],
    ['ក្រែម១២៣', ''],
    ['១២ ៣៤', ''],
    ['', ''],
  ]
  for (const [probe, expected] of cases) {
    assert.equal(sessions.asciiCodeSearch(probe), expected, `asciiCodeSearch(${JSON.stringify(probe)})`)
    if (expected) assert.equal(expected, search.foldNativeDigits(probe), `same fold as searchMatch for ${JSON.stringify(probe)}`)
    const review = importReview.buildImportReviewWhere({ jobId: 'job', query: probe })
    assert.equal(review.params.codeQuery, expected ? `%${expected.replace(/_/g, '\\_')}%` : undefined, `import review copy of the fold for ${JSON.stringify(probe)}`)
  }
})

const reviewDb = openDb([`CREATE TABLE import_job_rows (
  job_id TEXT, phase TEXT, row_number INTEGER, action TEXT, identifier TEXT, result_json TEXT,
  PRIMARY KEY(job_id, phase, row_number)
)`])
const insertRow = (rowNumber, identifier, data) => reviewDb
  .prepare(`INSERT INTO import_job_rows VALUES ('job', 'analyze', @rowNumber, 'update', @identifier, @json)`)
  .bind({ rowNumber, identifier, json: JSON.stringify({ data }) }).run()
insertRow(2, ASCII_CODE, { name: 'Dior Backstage Highlighter', barcode: ASCII_CODE })
insertRow(3, 'AB-12345', { name: 'Lip serum', sku: 'AB-12345', barcode: '9990000000001' })
insertRow(4, NAME_KHMER_DIGITS, { name: NAME_KHMER_DIGITS })
insertRow(5, NAME_ASCII_DIGITS, { name: NAME_ASCII_DIGITS })
insertRow(6, 'AB-9', { name: 'Barcode only', barcode: '3348901729223' })
insertRow(7, KHMER_STORED, { name: 'Stored in Khmer digits', barcode: KHMER_STORED })
const reviewRows = (query) => {
  const where = importReview.buildImportReviewWhere({ jobId: 'job', query })
  return reviewDb.prepare(`SELECT row_number FROM import_job_rows WHERE ${where.sql} ORDER BY row_number`).bind(where.params).all().map((row) => Number(row.row_number))
}

check('import review finds the ASCII barcode and sku for a Khmer scan', () => {
  assert.deepEqual(reviewRows(ASCII_CODE), [2], 'positive control: the ASCII scan')
  assert.deepEqual(reviewRows(KHMER_CODE), [2])
  assert.deepEqual(reviewRows(KHMER_PARTIAL), [2])
  assert.deepEqual(reviewRows('៣៣៤៨៩០១៧២៩២២៣'), [6], 'a barcode only in the row data is reached')
  assert.deepEqual(reviewRows('ab-១២៣៤៥'), [3], 'the identifier (sku) is reached')
  assert.deepEqual(reviewRows('AB-១២៣៤៥'), [3], 'the query is lower-cased before the fold, as before')
})

check('import review keeps the literal Khmer-digit barcode and the name search unchanged', () => {
  assert.deepEqual(reviewRows(KHMER_STORED), [7])
  assert.deepEqual(reviewRows('១០០មល'), [4], 'Khmer digits in a name never reach the ASCII-numbered name')
  assert.deepEqual(reviewRows('100មល'), [5])
  assert.deepEqual(reviewRows('ទឹកអប់ផ្កាម្លិះ'), [4, 5])
  assert.deepEqual(reviewRows('dior'), [2])
})

if (failures.length) {
  console.log(`\n${failures.length} red: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('test-barcode-khmer-digits-sql-pure: all checks passed')
