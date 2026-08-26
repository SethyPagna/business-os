// SQL-windowed sales grouping must reproduce partitionSalesGroups EXACTLY.
//
// A sales import's chunk cursor counts ORDER GROUPS, not rows, because a
// receipt's line items have to be classified together -- split one across
// two chunks and the order is written twice, or half of it is lost. That
// made re-partitioning the whole file on every chunk the safe-but-expensive
// option: ~58 full reads and ~58 full re-partitions per phase for an
// 8,700-row file, each JSON.parsing every row, inside a 10ms budget.
//
// Reading only the current window in SQL removes that, but ONLY if the SQL
// key and the JS key agree on every input. If they ever diverge, a sales
// import silently splits one receipt across two chunks or merges two
// receipts into one order -- and it is the money path, so it would be
// discovered from the books rather than from an error.
//
// So this compares the two implementations directly, over the awkward cases:
// padded keys, missing keys, the order_reference fallback, receipts whose
// lines are NOT adjacent in the file, and every window boundary.
//
// Run: node scripts/test-sales-group-window-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')

let passed = 0
const tests = []
const check = (name, fn) => tests.push({ name, fn })

// Lift the SQL expression out of the real source rather than restating it --
// restating is exactly how the two rules would drift apart.
const SALES_GROUP_KEY_SQL = (() => {
  const marker = 'const SALES_GROUP_KEY_SQL = `'
  const start = engine.indexOf(marker)
  assert.ok(start > 0, 'SALES_GROUP_KEY_SQL not found -- update this test')
  const from = start + marker.length
  return engine.slice(from, engine.indexOf('`', from))
})()

// The JS rule, mirroring partitionSalesGroups.
const str = (v) => String(v ?? '').trim()
function partitionSalesGroupsJs(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = str(row.receipt_number || row.order_reference) || `__row_${row._rowNumber}`
    const list = groups.get(key) || []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

async function seed(rows) {
  const db = openDb([`
    CREATE TABLE import_job_source_rows (
      job_id TEXT NOT NULL, sequence INTEGER NOT NULL, row_number INTEGER NOT NULL,
      data_json TEXT NOT NULL, PRIMARY KEY (job_id, sequence)
    );
  `])
  for (let i = 0; i < rows.length; i += 1) {
    await db.prepare(`INSERT INTO import_job_source_rows VALUES ('j', @seq, @rn, @data)`)
      .run({ seq: i, rn: rows[i]._rowNumber, data: JSON.stringify(rows[i]) })
  }
  return db
}

async function sqlGroupKeys(db) {
  const rows = await db.prepare(`
    SELECT ${SALES_GROUP_KEY_SQL} AS group_key, MIN(sequence) AS first_seq
    FROM import_job_source_rows WHERE job_id = 'j'
    GROUP BY group_key ORDER BY first_seq ASC
  `).all({})
  return rows.map((r) => String(r.group_key))
}

// Deliberately awkward: padded whitespace, a numeric receipt, the
// order_reference fallback, a row with neither, and -- the case a naive
// "consecutive rows" implementation gets wrong -- a receipt whose lines are
// separated by other receipts.
const ROWS = [
  { _rowNumber: 1, receipt_number: ' R-100 ', item: 'a' },
  { _rowNumber: 2, order_reference: 'O-55', item: 'b' },
  { _rowNumber: 3, item: 'c' },
  { _rowNumber: 4, receipt_number: 'R-100', item: 'd' },
  { _rowNumber: 5, receipt_number: 2001, item: 'e' },
  { _rowNumber: 6, receipt_number: '', order_reference: ' O-55 ', item: 'f' },
  { _rowNumber: 7, item: 'g' },
  { _rowNumber: 8, receipt_number: 'R-100', item: 'h' },
  { _rowNumber: 9, receipt_number: 2001, item: 'i' },
]

check('the SQL key and the JS key produce the same groups, in the same order', async () => {
  const db = await seed(ROWS)
  const jsKeys = [...partitionSalesGroupsJs(ROWS).keys()]
  const keys = await sqlGroupKeys(db)
  assert.deepEqual(keys, jsKeys, 'group identity or first-appearance order diverged')
})

check('a receipt whose lines are NOT adjacent still forms ONE group', async () => {
  const db = await seed(ROWS)
  const rows = await db.prepare(`
    SELECT ${SALES_GROUP_KEY_SQL} AS group_key, row_number
    FROM import_job_source_rows WHERE job_id = 'j' ORDER BY sequence ASC
  `).all({})
  const r100 = rows.filter((r) => String(r.group_key) === 'R-100').map((r) => Number(r.row_number))
  assert.deepEqual(r100, [1, 4, 8], 'rows 1, 4 and 8 are the same receipt despite other receipts between them')
})

check('padding and numeric receipt numbers group the same on both sides', async () => {
  const db = await seed(ROWS)
  const keys = await sqlGroupKeys(db)
  assert.ok(keys.includes('R-100'), 'a padded " R-100 " must normalise to R-100')
  assert.ok(keys.includes('2001'), 'a numeric receipt number must group as its text form')
  assert.ok(keys.includes('O-55'), 'order_reference is the fallback key')
})

check('a row with neither identifier gets its own group, keyed by its CSV line', async () => {
  const db = await seed(ROWS)
  const keys = await sqlGroupKeys(db)
  assert.ok(keys.includes('__row_3'), 'row 3 has no identifier')
  assert.ok(keys.includes('__row_7'), 'row 7 has no identifier')
  assert.notEqual(keys.indexOf('__row_3'), keys.indexOf('__row_7'), 'they must not collapse together')
})

check('windowing by LIMIT/OFFSET covers every group exactly once, at every window size', async () => {
  const db = await seed(ROWS)
  const allKeys = await sqlGroupKeys(db)
  for (let limit = 1; limit <= allKeys.length + 2; limit += 1) {
    const seen = []
    for (let cursor = 0; ; cursor += limit) {
      const page = await db.prepare(`
        SELECT ${SALES_GROUP_KEY_SQL} AS group_key, MIN(sequence) AS first_seq
        FROM import_job_source_rows WHERE job_id = 'j'
        GROUP BY group_key ORDER BY first_seq ASC LIMIT @limit OFFSET @cursor
      `).all({ limit, cursor })
      if (!page.length) break
      seen.push(...page.map((r) => String(r.group_key)))
    }
    assert.deepEqual(seen, allKeys, `window size ${limit} lost, duplicated or reordered groups`)
  }
})

check('the apply path does not window an already-windowed result twice', async () => {
  // readSalesGroupWindow applies LIMIT/OFFSET itself; a leftover
  // .slice(cursor, ...) on top of that would skip whole receipts.
  assert.ok(
    !/groupEntries\.slice\(cursor/.test(engine),
    'groupEntries is already the window -- slicing it by cursor again would skip receipts',
  )
  assert.match(engine, /const windowEntries = groupEntries\b/)
})

check('both phases read only their own window, never the whole file', async () => {
  assert.ok(
    !/partitionSalesGroups\(await readAllMaterializedRows/.test(engine),
    'neither analyze nor apply may re-partition the entire file per chunk',
  )
  const windowCalls = engine.match(/await readSalesGroupWindow\(db, jobId, decisions, cursor, ROWS_PER_IMPORT_CHUNK\)/g) || []
  assert.equal(windowCalls.length, 2, 'analyze and apply should both use the windowed reader')
})

check('partitionSalesGroups is still the reference for the bounded preflight path', async () => {
  // Kept deliberately: it is the rule the SQL mirrors, and the synchronous
  // preflight path is bounded so it has no reason to change.
  assert.match(engine, /function partitionSalesGroups\(/)
  assert.match(engine, /const groups = partitionSalesGroups\(rows\)/)
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
