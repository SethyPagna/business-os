// Regression test for the production failure
//   GET /api/products -> D1_ERROR: too many SQL variables at offset 415
// observed live on Aug 26 2026.
//
// The limit is REAL and was measured, not assumed: a live probe against
// the production `business-os` D1 with 101 `?` placeholders returns
//   too many SQL variables at offset 227: SQLITE_ERROR
// and 227 is exactly the character offset of the 101st placeholder in that
// probe's SQL. Applying the same arithmetic to the reported offset 415
// lands on the 101st placeholder of routes/products.ts's attachBranchStock
// query -- the one that built a single IN(...) over every product row on
// the page.
//
// better-sqlite3 (what every other test here runs on) allows 32,766 bound
// parameters, which is exactly why this class of bug reached production:
// the local harness cannot reproduce it by accident. So this file installs
// D1's limit explicitly, in a db shim that refuses any statement with more
// than 100 bound parameters, and drives the REAL exported helpers through
// it.
//
// Run: node scripts/test-d1-bound-params-repro.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const D1_MAX_BOUND_PARAMS = 100

function loadTs(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

const { chunkForBinding, buildInClause, selectInChunks, inlineIntegerIds } = loadTs('src/lib/sqlBinding.ts')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

// The whole point of this file: a db shim that enforces D1's limit, which
// better-sqlite3 on its own does not.
let statementsRun = 0
function countBoundParams(sql, params) {
  if (Array.isArray(params)) return params.length
  // Mirrors lib/db.ts's translate(): every @name OCCURRENCE becomes its
  // own positional placeholder, so a name used twice costs two slots.
  return (sql.match(/@\w+/g) || []).length
}
const d1Shim = {
  prepare(sql) {
    const guard = (params) => {
      const bound = countBoundParams(sql, params)
      if (bound > D1_MAX_BOUND_PARAMS) {
        const err = new Error('D1_ERROR: too many SQL variables: SQLITE_ERROR (statement bound ' + bound + ')')
        err.tooManyVariables = true
        throw err
      }
      statementsRun++
      return db.prepare(sql)
    }
    return {
      async get(params) { return guard(params).get(params || {}) },
      async all(params) { return guard(params).all(params || {}) },
      async run(params) {
        const result = guard(params).run(params || {})
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
      },
    }
  },
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
    passed++
  } catch (err) {
    console.log('FAIL', name, '--', err.message)
    failed++
  }
}

async function main() {
  await check('the shim really does reject 101 bound parameters (otherwise every other check here is vacuous)', async () => {
    const { sql, params } = buildInClause('id', Array.from({ length: 101 }, (_, i) => i + 1))
    let thrown = null
    try {
      await d1Shim.prepare('SELECT id FROM products WHERE id IN (' + sql + ')').all(params)
    } catch (err) {
      thrown = err
    }
    assert.ok(thrown && thrown.tooManyVariables, 'expected the shim to refuse 101 bound parameters')
  })

  await check('chunkForBinding never emits a chunk that would exceed the limit, and loses nothing', async () => {
    for (const [count, reserved] of [[1, 0], [100, 0], [101, 0], [8727, 0], [500, 1], [250, 40], [99, 99]]) {
      const items = Array.from({ length: count }, (_, i) => i)
      const chunks = chunkForBinding(items, reserved)
      for (const chunk of chunks) {
        assert.ok(chunk.length + reserved <= D1_MAX_BOUND_PARAMS, 'chunk of ' + chunk.length + ' + ' + reserved + ' reserved exceeds ' + D1_MAX_BOUND_PARAMS)
        assert.ok(chunk.length > 0, 'an empty chunk would run a query with an empty IN () list')
      }
      assert.deepStrictEqual(chunks.flat(), items, 'every item must survive chunking (count=' + count + ', reserved=' + reserved + ')')
    }
  })

  await check('an empty list runs zero queries rather than one with an empty IN ()', async () => {
    assert.deepStrictEqual(chunkForBinding([]), [])
    const before = statementsRun
    const rows = await selectInChunks([], 0, () => { throw new Error('must not run a query for an empty list') })
    assert.deepStrictEqual(rows, [])
    assert.strictEqual(statementsRun, before)
  })

  await check('a statement whose other parameters leave no room fails loudly instead of silently looping', async () => {
    assert.throws(() => chunkForBinding([1, 2, 3], D1_MAX_BOUND_PARAMS), /no room for its IN list/)
  })

  // ---- The real production shape: many products, one page --------------
  // 1,200 rows is well past what a 20-family page holds once same-name
  // families expand, and 12x the limit.
  const insert = db.prepare('INSERT INTO products (name, sku, barcode, is_active, stock_quantity) VALUES (@name, @sku, @barcode, 1, 0)')
  const productIds = []
  for (let i = 1; i <= 1200; i++) {
    const info = insert.run({ name: 'Product ' + i, sku: 'SKU-' + i, barcode: '600' + String(i).padStart(7, '0') })
    productIds.push(Number(info.lastInsertRowid))
  }
  db.prepare("INSERT INTO branches (name, is_active, is_default) VALUES ('Shop', 1, 1)").run()

  await check('reading branch stock for 1,200 products succeeds (the exact query that returned "too many SQL variables at offset 415")', async () => {
    const rows = await selectInChunks(productIds, 0, (chunk) => {
      const { sql, params } = buildInClause('id', chunk)
      return d1Shim.prepare(
        'SELECT product_id, branch_id, COALESCE(quantity, 0) AS quantity FROM branch_stock WHERE product_id IN (' + sql + ')',
      ).all(params)
    })
    assert.ok(Array.isArray(rows), 'must return rows, not throw')
  })

  await check('selectInChunks returns exactly the rows a single unbounded query would have', async () => {
    const chunked = await selectInChunks(productIds, 0, (chunk) => {
      const { sql, params } = buildInClause('id', chunk)
      return d1Shim.prepare('SELECT id FROM products WHERE id IN (' + sql + ') ORDER BY id ASC').all(params)
    })
    // Ground truth straight from better-sqlite3, with no limit in the way.
    const whole = db.prepare('SELECT id FROM products WHERE id IN (' + productIds.join(',') + ') ORDER BY id ASC').all()
    assert.deepStrictEqual(chunked.map((r) => r.id), whole.map((r) => r.id), 'chunking must not drop, duplicate or reorder rows')
  })

  await check('inlineIntegerIds refuses anything that is not a safe integer, so no user text can reach the SQL', async () => {
    assert.strictEqual(inlineIntegerIds([1, 2, 3]), '1, 2, 3')
    assert.throws(() => inlineIntegerIds(['1); DROP TABLE products; --']), /refusing to inline/)
    assert.throws(() => inlineIntegerIds([1.5]), /refusing to inline/)
    assert.throws(() => inlineIntegerIds([Number.NaN]), /refusing to inline/)
  })

  // ---- Every shipped IN(...) site, checked by source inspection --------
  // The checks above prove the helper is correct; this one proves the
  // helper is actually USED, which is the failure this file exists for.
  await check('no route or lib builds a placeholder list by hand without chunking it', async () => {
    const roots = [path.join(__dirname, '..', 'src', 'routes'), path.join(__dirname, '..', 'src', 'lib')]
    const offenders = []
    for (const root of roots) {
      for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.ts'))) {
        const text = fs.readFileSync(path.join(root, file), 'utf8')
        // The two hand-rolled shapes this codebase used, each of which
        // builds one placeholder per element of an unbounded array.
        const handRolled = (text.match(/\.map\(\([^)]*\) => (?:`@\w*\$\{i(?:ndex)?\}`|'\?')\)/g) || []).length
        const chunked = (text.match(/selectInChunks|chunkForBinding|inlineIntegerIds/g) || []).length
        // A site whose parameter count is fixed by a table's schema or a
        // hard-coded enum (an INSERT's column list, say) cannot reach the
        // limit and does not need chunking. Those opt out explicitly, with
        // the reason written at the site, rather than being silently
        // exempted by a rule in this file that nobody reads.
        const exempt = (text.match(/sql-bound-params: bounded by construction/g) || []).length
        if (handRolled && !chunked && !exempt) offenders.push(path.basename(root) + '/' + file + ' (' + handRolled + ' hand-built placeholder list(s), no chunking anywhere in the file)')
      }
    }
    assert.deepStrictEqual(offenders, [], 'these files still build placeholder lists with no chunk helper:\n  ' + offenders.join('\n  '))
  })

  console.log(failed ? '\n' + failed + ' check(s) FAILED, ' + passed + ' passed.' : '\nAll ' + passed + ' D1 bound-parameter checks passed.')
  process.exit(failed ? 1 : 0)
}

main()
