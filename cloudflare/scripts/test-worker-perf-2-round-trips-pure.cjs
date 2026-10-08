// Perf-2 (Program 4, worker perf wave 2): pins the sequential-D1-round-trip
// reductions made to routes/inventory.ts, routes/contacts.ts, routes/returns.ts
// and routes/batches.ts. Source-pin style, like
// test-product-bootstrap-performance-pure.cjs and test-batch-receive-movement-
// fold-pure.cjs -- this asserts the SHAPE of the fix in the committed source
// (Promise.all fan-out / waitUntil deferral / IN-chunked batch lookup instead
// of a per-item query), not runtime timing, which is not measurable from a
// pure Node process against no live D1.
//
// Run (from cloudflare/): node scripts/test-worker-perf-2-round-trips-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const inventorySource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'inventory.ts'), 'utf8')
const contactsSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'contacts.ts'), 'utf8')
const returnsSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'returns.ts'), 'utf8')
const batchesSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'batches.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label}: start marker not found`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label}: end marker not found after start`)
  return source.slice(start, end)
}

// --- inventory.ts POST /adjust ---------------------------------------------
// Before: product SELECT, then (when branchId absent) defaultBranchId SELECT,
// then branch SELECT = up to 3 sequential awaited round trips before any
// write. After: product + branchId resolve in one Promise.all (1 RTT), then
// branch (1 RTT) = 2 RTTs worst case.
check('inventory.ts /adjust: product + branchId resolve in one Promise.all', () => {
  const adjustBlock = sliceBetween(inventorySource, "app.post('/adjust'", "app.post('/dated-stock-count/resolve'", 'inventory.ts /adjust')
  assert.match(
    adjustBlock,
    // CUTOVER-LR: the resolved id is the ADDRESSED branch now (a disabled one lands at the confirmed active branch
    // in the one directory read that replaced the branch SELECT) -- still one fan-out, still 2 RTTs worst case.
    /const \[product, addressedBranchId\] = await Promise\.all\(\[/,
    'product SELECT and branchId resolution must be fanned out together, not two sequential awaits',
  )
  assert.match(
    adjustBlock,
    /requestedBranchId \? Promise\.resolve\(requestedBranchId\) : defaultBranchId\(c\.env\)/,
    'branchId must skip its own await when the request already named a branch',
  )
})

// Before: `await audit(...)` gated the response on a 4th round trip.
// After: audit joins the broadcast/bumpVersion calls already deferred into
// waitUntil, so the response only waits on the write batch above it.
check('inventory.ts /adjust: trailing audit() is deferred into waitUntil with broadcast/bumpVersion', () => {
  const adjustBlock = sliceBetween(inventorySource, "app.post('/adjust'", "app.post('/dated-stock-count/resolve'", 'inventory.ts /adjust')
  assert.match(
    adjustBlock,
    /c\.executionCtx\.waitUntil\(Promise\.all\(\[\s*audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), originalType === 'set'/,
    'the stock_add/stock_remove/stock_set audit must be inside the waitUntil fan-out, not a bare awaited call',
  )
  assert.doesNotMatch(
    adjustBlock,
    /^\s*await audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), originalType === 'set'/m,
    'the stock adjustment audit must not be a gating await any more',
  )
})

// NOTE: the duplicate check and the membership-number reuse check were
// deliberately NOT folded into one Promise.all here. The reuse check's own
// block is extracted verbatim by anchor text in
// scripts/test-membership-defaults-20260905.cjs and run standalone against
// only (db, payload, body, config, c, normalizeMembershipNumber) -- it must
// stay self-contained (its own normalize + its own DB read), so it is left
// as the one sequential await it was.

check('contacts.ts create: audit()/bumpVersion() deferred into waitUntil ahead of the response SELECT', () => {
  const createBlock = sliceBetween(contactsSource, 'app.post(config.path, async (c) => {', "app.post(`${config.path}/:id/portal-reset`", 'contacts.ts create')
  assert.match(
    createBlock,
    /c\.executionCtx\.waitUntil\(Promise\.all\(\[\s*(?:createAuditInBatch \? Promise\.resolve\(\) : )?audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'create', config\.entity, id/,
    'the create audit must be inside the waitUntil fan-out (a POS or sale add writes it in the insert batch instead)',
  )
  assert.doesNotMatch(
    createBlock,
    /^\s*await audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'create', config\.entity, id/m,
    'the create audit must not gate the response any more',
  )
  assert.doesNotMatch(
    createBlock,
    /^\s*await bumpVersion\(c\.env, config\.table\)/m,
    'bumpVersion must not gate the response any more',
  )
})

// --- returns.ts POST / --------------------------------------------------------
check('returns.ts POST /: explicit replacement batch lookup is one IN-chunked query, not one per line', () => {
  assert.match(
    returnsSource,
    /const explicitBatchIds = \[\.\.\.new Set\(replacementLines/,
    'explicit batch ids must be collected once before any query',
  )
  assert.match(
    returnsSource,
    /const rows = await selectInChunks\(explicitBatchIds, 0, \(chunk\) => db\.prepare\(\s*`SELECT id,lot_code,expiry_date,variant_product_id FROM product_batches WHERE id IN/,
    'the explicit-batch lookup must read every id in one IN(...) query via selectInChunks',
  )
  assert.doesNotMatch(
    returnsSource,
    /for \(const \[index, line\] of replacementLines\.entries\(\)\) \{\s*if \(line\.batchId == null\) continue\s*const lot = await db\.prepare/,
    'the old per-line awaited SELECT inside the replacementLines loop must be gone',
  )
})

check('returns.ts POST /: one set-based snapshot preserves branch/batch identities and zero controls', () => {
  const block = sliceBetween(returnsSource, 'const snapshotPairs =', 'const branchRows =', 'return snapshots')
  const sql = block.match(/db\.prepare\(`([\s\S]*?)`\)/)?.[1]
  assert.ok(sql, 'one snapshot statement')
  assert.equal((block.match(/db\.prepare\(/g) || []).length, 1)
  const db = new (require('better-sqlite3'))(':memory:')
  try {
    db.exec(`CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL);
      CREATE TABLE product_batches(id INTEGER,variant_product_id INTEGER,is_active INTEGER,lot_code TEXT,expiry_date TEXT);
      CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL);
      INSERT INTO branch_stock VALUES(10,1,7),(10,2,99);
      INSERT INTO product_batches VALUES(50,10,1,'A','2027-01-01'),(51,20,0,'B',NULL);
      INSERT INTO branch_batch_stock VALUES(50,1,3),(50,2,80);`)
    const rows = db.prepare(sql).all({ pairs: JSON.stringify({ branches: [{product_id:10,branch_id:1},{product_id:20,branch_id:1}], batches:[{batch_id:51,branch_id:1},{batch_id:50,branch_id:1}] }) })
    assert.deepEqual(rows.map(row => [row.kind,row.ordinal,row.quantity,row.product_id,row.is_active]),
      [['branch',0,7,null,null],['branch',1,0,null,null],['batch',0,0,20,0],['batch',1,3,10,1]])
  } finally { db.close() }
})

// --- batches.ts: the three remaining awaited audits deferred into waitUntil --
const batchAuditActions = [
  ['batch_update', /c\.executionCtx\.waitUntil\(Promise\.all\(\[\s*audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'batch_update'/],
  ['batch_quantity_correction', /c\.executionCtx\.waitUntil\(Promise\.all\(\[\s*audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'batch_quantity_correction'/],
  ['batch_deactivate', /c\.executionCtx\.waitUntil\(Promise\.all\(\[\s*audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'batch_deactivate'/],
]
for (const [action, pattern] of batchAuditActions) {
  check(`batches.ts: ${action} audit() is deferred into waitUntil`, () => {
    assert.match(batchesSource, pattern, `${action}'s audit() call must be inside a waitUntil fan-out`)
  })
}
check('batches.ts: no bare awaited audit() calls remain for these three actions', () => {
  assert.doesNotMatch(
    batchesSource,
    /^\s*await audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), '(batch_update|batch_quantity_correction|batch_deactivate)'/m,
    'these three audits must not gate their responses any more',
  )
})

// --- products.ts FTS/LIKE fallback: confirm it is already lazy (no fix needed)
check('products.ts: the FTS-unavailable fallback only re-runs on a caught error, not on zero rows', () => {
  assert.match(
    productsSourceForFallback(),
    /async function searchProductsWithIndexFallback\(env: Env, query: Record<string, string>\) \{\s*try \{\s*return await searchProductsPayload\(env, query\)\s*\} catch \(error\) \{\s*if \(!isProductSearchIndexUnavailable\(error\)\) throw error\s*return searchProductsPayload\(env, query, \{ useSearchIndex: false \}\)/,
    'the LIKE-scan fallback must stay behind a caught "index unavailable" error, not run unconditionally after an empty FTS result',
  )
})
function productsSourceForFallback() {
  return fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
}

console.log(`\n${passed} checks passed`)
