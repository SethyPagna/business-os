// P2-4 Part 1b -- the alias half of `exact_barcode_hit_id`.
//
// Root cause this pins: `computeExactBarcodeHitId` (lib/searchMatch.ts)
// compares `products.barcode` ONLY, so scanning a code recorded in
// `barcode_aliases` narrowed the search result list (the search tail already
// ORs in buildAliasExactClause) but never resolved to an exact hit -- the
// Products page then had to guess ("if a scan left exactly one row, highlight
// it"), a symptom patch that has since been deleted.
// routes/products.ts's `resolveAliasExactBarcodeHitId` is the real fix and is
// what this file exercises.
//
// Method: `resolveAliasExactBarcodeHitId` lives inside routes/products.ts,
// which cannot be transpiled and required whole (it constructs a Hono router
// and pulls in ~40 Worker-only modules at module scope). So the REAL exported
// function's source text is sliced out of the real file by a balanced-brace
// scan from its own `export async function` declaration, transpiled, and
// evaluated with its three free names (normalizeBarcode, isRealBarcode,
// inlineIntegerIds) bound to the REAL implementations from their own modules.
// Nothing here re-implements the function: if products.ts's copy changes, this
// test runs the changed copy; if it stops existing or stops being exported,
// this test fails loudly rather than silently testing a stale duplicate.
//
// It then runs against real SQLite with every real migration applied (same
// approach as test-group-search-siblings-repro.cjs), through a D1Compat-shaped
// shim, so the SQL itself -- table name, column names, the inlined id list --
// is executed for real, not asserted about as a string.
//
// Run: node scripts/test-alias-exact-hit-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// --- load the real helpers the sliced function closes over -----------------
function loadTs(relPath) {
  const p = path.join(__dirname, '..', relPath)
  const src = fs.readFileSync(p, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', outputText)(mod.exports, require)
  return mod.exports
}

const { normalizeBarcode, isRealBarcode, MIN_REAL_BARCODE_LENGTH } = loadTs('src/lib/barcodeAliases.ts')
const { inlineIntegerIds } = loadTs('src/lib/sqlBinding.ts')
const { computeExactBarcodeHitId } = loadTs('src/lib/searchMatch.ts')

// --- slice the REAL function out of routes/products.ts ---------------------
const routeSourcePath = path.join(__dirname, '..', 'src', 'routes', 'products.ts')
const routeSource = fs.readFileSync(routeSourcePath, 'utf8')

const DECL = 'export async function resolveAliasExactBarcodeHitId('
const declStart = routeSource.indexOf(DECL)
assert.notStrictEqual(
  declStart,
  -1,
  'routes/products.ts must still export `resolveAliasExactBarcodeHitId` -- the alias half of exact_barcode_hit_id. If it was renamed or inlined, update this test to slice the new name rather than deleting the coverage.',
)

// Balanced-brace scan from the function body's opening `{` (string/template/
// comment aware enough for this file's shape: the body contains one template
// literal holding the SQL, and `//` comments).
function sliceFunction(source, start) {
  // Skip the parameter list first: its type annotations contain their own
  // braces (`db: { prepare: ... }`), so the body's `{` is NOT simply the first
  // `{` after the declaration.
  let paren = source.indexOf('(', start)
  assert.notStrictEqual(paren, -1, 'function declaration must have a parameter list')
  let parenDepth = 0
  let afterParams = -1
  for (let j = paren; j < source.length; j += 1) {
    if (source[j] === '(') parenDepth += 1
    else if (source[j] === ')') {
      parenDepth -= 1
      if (parenDepth === 0) { afterParams = j + 1; break }
    }
  }
  assert.notStrictEqual(afterParams, -1, 'unbalanced parentheses in the parameter list')
  let i = source.indexOf('{', afterParams)
  assert.notStrictEqual(i, -1, 'function declaration must have a body')
  let depth = 0
  let inLine = false
  let inTemplate = false
  for (; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLine) { if (ch === '\n') inLine = false; continue }
    if (inTemplate) {
      if (ch === '\\') { i += 1; continue }
      if (ch === '`') inTemplate = false
      continue
    }
    if (ch === '/' && next === '/') { inLine = true; i += 1; continue }
    if (ch === '`') { inTemplate = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error('unbalanced braces while slicing the function body')
}

const fnSource = sliceFunction(routeSource, declStart).replace(/^export\s+/, '')
const { outputText: fnJs } = ts.transpileModule(fnSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'resolveAliasExactBarcodeHitId.ts',
})
// The three module-scope names the function closes over are injected as real
// implementations, so this runs the shipped logic against the shipped helpers.
const resolveAliasExactBarcodeHitId = new Function(
  'normalizeBarcode',
  'isRealBarcode',
  'inlineIntegerIds',
  `${fnJs}\nreturn resolveAliasExactBarcodeHitId;`,
)(normalizeBarcode, isRealBarcode, inlineIntegerIds)

check('routes/products.ts calls the alias resolver only as a FALLBACK to the primary barcode comparison', () => {
  // Decision 9 parity: an alias hit must never out-rank / pre-empt a real
  // products.barcode hit, and must never be computed when the primary one
  // already resolved (that would be a second, looser opinion about the same
  // scan).
  assert.ok(
    /const exactBarcodeHitId = primaryExactHitId !== null\s*\?\s*primaryExactHitId\s*:\s*await resolveAliasExactBarcodeHitId\(/.test(routeSource),
    'the search response must compute exact_barcode_hit_id as "primary barcode hit, else alias hit" -- never alias-first, never both',
  )
  assert.ok(
    /exact_barcode_hit_id: exactBarcodeHitId,/.test(routeSource),
    'the resolved value must still be what the response returns as exact_barcode_hit_id',
  )
})

// --- real SQLite, real migrations -----------------------------------------
const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const f of migrationFiles) {
  try {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  } catch (err) {
    console.log(`MIGRATION FAILED: ${f}: ${err.message}`)
    process.exit(1)
  }
}
console.log(`Applied ${migrationFiles.length} migrations cleanly.`)

// D1Compat-shaped shim: the function only calls db.prepare(sql).all(params)
// with @name params, which better-sqlite3 binds natively, and expects the
// ROW ARRAY back (D1Compat.all unwraps `.results` itself -- see lib/db.ts).
const compat = {
  prepare(sql) {
    return { async all(params) { return db.prepare(sql).all(params || {}) } }
  },
}

function seedProduct(id, name, barcode) {
  db.prepare('INSERT INTO products (id, name, barcode, is_active) VALUES (?, ?, ?, 1)').run(id, name, barcode)
}
function seedAlias(productId, barcode) {
  db.prepare(
    'INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source, added_at) VALUES (?, ?, ?, ?, ?)',
  ).run(productId, barcode, normalizeBarcode(barcode), 'test', '2026-09-03 00:00:00')
}

seedProduct(1, 'Alias product', '6901000009999')
seedAlias(1, '8011003845132')
seedProduct(2, 'Plain product', '4001000001111')
seedProduct(3, 'Shares an alias A', '5001000002222')
seedProduct(4, 'Shares an alias B', '5001000003333')
seedAlias(3, '7777777777777')
seedAlias(4, '7777777777777')
seedProduct(5, 'Placeholder barcode', '0')
seedAlias(5, '0')
seedProduct(6, 'Off-page alias owner', '4009000004444')
seedAlias(6, '9999000099999')

const page = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]

async function run() {
  await checkAsync('the reported bug: an alias-barcode scan resolves to the aliased product', async () => {
    // This is the exact seed the P2-4 Part 1b brief cites: product with
    // primary barcode 6901000009999 and alias 8011003845132.
    assert.strictEqual(
      computeExactBarcodeHitId([{ id: 1, barcode: '6901000009999' }], '8011003845132'),
      null,
      'precondition: the primary-barcode comparison alone must still see nothing here (that is the gap)',
    )
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '8011003845132'), 1)
  })

  await checkAsync('a primary-barcode scan is left entirely to computeExactBarcodeHitId', async () => {
    // The alias resolver is only ever the fallback; asked about a code that
    // is a PRIMARY barcode and not an alias, it correctly finds nothing.
    assert.strictEqual(computeExactBarcodeHitId([{ id: 2, barcode: '4001000001111' }], '4001000001111'), 2)
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '4001000001111'), null)
  })

  await checkAsync('two rows on the page sharing one alias is AMBIGUOUS, never a confident pick', async () => {
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '7777777777777'), null)
  })

  await checkAsync('an alias owned by a product that is NOT on this page never highlights', async () => {
    // Highlighting a row that is not on screen would be meaningless; the
    // resolver is scoped to the page ids it was handed.
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '9999000099999'), null)
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, [{ id: 6 }], '9999000099999'), 6)
  })

  await checkAsync('the three decision-9 gates hold exactly as they do for a primary barcode', async () => {
    // (a) the shared "0" placeholder never identifies anything, even when a
    //     real alias row literally holds it (seeded above on product 5).
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '0'), null)
    assert.strictEqual(computeExactBarcodeHitId([{ id: 5, barcode: '0' }], '0'), null)
    // (b) shorter than MIN_REAL_BARCODE_LENGTH is a fragment being typed.
    assert.strictEqual(MIN_REAL_BARCODE_LENGTH, 4)
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '801'), null)
    // (c) non-digits are a name search, not a scan.
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, 'alias'), null)
    // and a blank/absent query is not a scan either.
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, ''), null)
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, null), null)
  })

  await checkAsync('surrounding whitespace on a scanned value is tolerated (wedge scanners append it)', async () => {
    assert.strictEqual(await resolveAliasExactBarcodeHitId(compat, page, '  8011003845132  '), 1)
  })

  await checkAsync('an empty page of results resolves to null without touching the DB', async () => {
    const exploding = { prepare() { throw new Error('resolveAliasExactBarcodeHitId must not query for an empty page') } }
    assert.strictEqual(await resolveAliasExactBarcodeHitId(exploding, [], '8011003845132'), null)
    assert.strictEqual(await resolveAliasExactBarcodeHitId(exploding, [{ id: 'nope' }], '8011003845132'), null)
  })

  await checkAsync('page ids are inlined as integers only -- no string can reach the SQL text', async () => {
    // inlineIntegerIds throws on anything non-integer; the resolver filters to
    // safe positive integers before it ever gets there, so a hostile id value
    // is dropped rather than inlined.
    assert.throws(() => inlineIntegerIds(['1); DROP TABLE products; --']))
    assert.strictEqual(
      await resolveAliasExactBarcodeHitId(compat, [{ id: '1); DROP TABLE products; --' }, { id: 1 }], '8011003845132'),
      1,
    )
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM products').get().c, 6, 'products table must still be intact')
  })

  console.log(`\n${passed} checks passed.`)
}

async function checkAsync(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

run().catch((err) => { console.error(err); process.exit(1) })
