// RET-B F2 sibling writer (5 Oct 2026): a product EDIT never writes stock.
//
// ProductForm sends the stock figure it loaded (read-only in edit mode) with
// every Save, and PUT /products/:id wrote it straight into the
// products.stock_quantity rollup. Open the form while 10 are on hand, sell 3,
// Save a price change: the rollup read 10 again while branch_stock held 7.
// The same body reached the edit-fold writer and the review-queue apply
// (lib/reviewApply.ts), both through updateRow. Stock moves only through
// ledgered stock actions; the rollup is derived from branch_stock.
//
// The harness below is the one test-barcode-fold-create-edit-native.cjs
// established: the REAL routes/products.ts against the full migration chain.
//
// Run (from cloudflare/): node scripts/test-product-edit-never-writes-stock-native.cjs


const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC_DIR = path.join(__dirname, '..', 'src')
const migrations = loadAll()
const rawDb = openDb(migrations)

let beforeNextWriteBatch = null
const db = {
  // d1compat.cjs's Stmt.bind(params) takes exactly ONE argument (an object
  // or an array), matching this codebase's own @name-bound call sites. Real
  // D1's bind() is variadic positional (`.bind(a, b, c)`), which is how
  // productWrites.ts's insertRow/updateRow call it -- Stmt.bind(...args)
  // would silently capture only the FIRST arg as `params`, so every later
  // positional value read back as undefined -> bound as NULL (the "NOT NULL
  // constraint failed: products.name" this comment is here to stop someone
  // re-introducing). Collect the whole spread into one array here so it
  // reaches Stmt's own Array.isArray(p) positional-binding branch intact.
  prepare(sql) {
    const st = rawDb.prepare(sql)
    let bound
    const api = {
      sql, get params() { return bound },
      bind: (...args) => { bound = args; return api },
      get: (p) => st.get(p !== undefined ? p : bound),
      all: (p) => st.all(p !== undefined ? p : bound) ?? [],
      run: (p) => st.run(p !== undefined ? p : bound),
    }
    return api
  },
  async batch(items) {
    if (beforeNextWriteBatch && items.some(item=>/UPDATE|INSERT|DELETE/.test(item.sql))) { const hook=beforeNextWriteBatch;beforeNextWriteBatch=null;hook() }
    return rawDb.batch(items)
  },
  async batchOnce(items) { return this.batch(items) },
  async transaction(fn) { return fn(db) },
}
const fakeEnv = { DB: db }

const realModuleCache = new Map()
function resolveSiblingSource(request) {
  const base = request.replace(/^.*\//, '')
  for (const dir of ['lib', 'routes', 'durable-objects', '']) {
    const candidate = path.join(SRC_DIR, dir, `${base}.ts`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function transpileFile(sourcePath) {
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(SRC_DIR, relPath)
  const outputText = transpileFile(sourcePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(requireOverrides, request)) return requireOverrides[request]
    if (request.startsWith('.')) {
      const sibling = resolveSiblingSource(request)
      if (sibling) {
        if (!realModuleCache.has(sibling)) {
          const nested = { exports: {} }
          realModuleCache.set(sibling, nested)
          const nestedOut = transpileFile(sibling)
          new Function('exports', 'require', 'module', '__filename', '__dirname', nestedOut)(
            nested.exports, require, nested, sibling, path.dirname(sibling),
          )
        }
        return realModuleCache.get(sibling).exports
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const actorSnapshotKernel = loadReal('lib/actorSnapshot.ts')
const inertSearch = {
  buildFtsMatchExpression: () => "''",
  buildHybridMatchClause: () => '1=1',
  buildIssueStateClauses: () => [],
  buildPartialWordMatchClause: () => '1=1',
  buildShortWordFallbackClause: () => '1=1',
  buildTrigramMatchExpression: () => "''",
  expandAliasCandidates: (value) => [value],
  normalizedHaystackSql: () => "''",
  PRODUCT_SEARCH_COLUMNS: 'id, name',
  PRODUCTS_FTS_BM25_SQL: '0',
  runFuzzyFallbackMatch: async () => [],
  tokenizeSearchTermGroups: () => [],
  tokenizeSearchWords: () => [],
}

const FAKE_USER = { id: 1, username: 'tester', name: 'Test User', permissions: JSON.stringify({ products: true, product_cost_edit: true, product_cost_view: true }) }

const productsRoute = loadReal('routes/products.ts', {
  '../lib/actorSnapshot': actorSnapshotKernel,
  '../lib/db': { getDb: () => db },
  // Nested modules (productWrites.ts, productIdentity.ts, ...) import this
  // relative to lib/ as './db', a DIFFERENT literal specifier than
  // routes/products.ts's own '../lib/db' -- both must point at the same
  // simplified fake so every writer sees the same in-memory database
  // instead of the real D1CompatStatement expecting a genuine D1Database.
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', FAKE_USER); return next() } },
  '../lib/audit': { ...loadReal('lib/audit.ts', { './db': { getDb: () => db } }), audit: async () => {} },
  '../lib/cache': { cachedJsonResponse: async () => null, getVersionWithFallback: async () => 1, bumpVersion: async () => {}, bumpVersions: async () => {} },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/familyPagination': { paginateProductFamilies: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  '../lib/importImageMatch': { matchLibraryImagesStrict: async () => [], ADMIN_MAX_IMAGES_PER_PRODUCT: 20, MAX_IMAGES_PER_PRODUCT: 10 },
  '../lib/permissions': {
    hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full',
    getMergedPermissions: () => ({}), isAdminControlUser: () => true,
  },
  '../lib/searchMatch': inertSearch,
  '../lib/productSearchQuery': { buildProductSearchQuery: () => ({ hasSearchTerm: false, titleOnly: false }), buildFamilyRelevanceOrderSql: (tail) => tail },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/reviewGate': { maybeQueueForReview: async () => null },
  '../lib/salesAnalytics': { getProductSalesBreakdown: async () => ({}) },
  '../lib/bulkDeleteEngine': { createBulkDeleteJob: async () => ({}), getBulkDeleteJob: async () => null, reapStalledBulkDeleteJobs: async () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/uploadSecurity': { validateUploadedBuffer: async () => ({ ok: true }) },
})

const app = productsRoute.default
assert.ok(app && typeof app.request === 'function', 'routes/products.ts must export the Hono app as default')

function seedBranch() {
  rawDb.exec(`UPDATE branch_stock SET quantity=0; UPDATE branch_batch_stock SET quantity=0;
    UPDATE damaged_stock_lots SET quantity_remaining=0; UPDATE products SET stock_quantity=0;
    DELETE FROM damaged_stock_lots;DELETE FROM undo_snapshots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
    DELETE FROM branch_stock; DELETE FROM inventory_movements; DELETE FROM product_images;
    DELETE FROM products; DELETE FROM branches;`)
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1)").run()
}

const fakeExecutionCtx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function post(pathname, body) {
  const res = await app.request(pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function put(pathname, body) {
  const res = await app.request(pathname, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, fakeEnv, fakeExecutionCtx)
  return { status: res.status, json: await res.json().catch(() => null) }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const rollup = (id) => rawDb.prepare('SELECT stock_quantity AS q FROM products WHERE id = @id').get({ id }).q
const onHand = (id) => rawDb.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM branch_stock WHERE product_id = @id').get({ id }).q

async function request(method, body, id = 1) {
  const res = await app.request('/' + id, {method, headers:{'content-type':'application/json'},body:JSON.stringify(body)}, fakeEnv, fakeExecutionCtx)
  return {status:res.status,json:await res.json().catch(()=>null)}
}
function seed(kind) {
  seedBranch()
  rawDb.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(1,'Guard fixture',1,0)").run()
  if(kind==='cache') rawDb.prepare('UPDATE products SET stock_quantity=3 WHERE id=1').run()
  if(kind==='branch') rawDb.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,3)').run()
  if(kind==='batch') {
    rawDb.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active) VALUES(10,1,'guard','GUARD','2026-10-08',1)").run()
    rawDb.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,3)').run()
  }
  if(kind==='damaged') rawDb.prepare("INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity,quantity_remaining,reason,condition_tag,source) VALUES(1,'Guard fixture',1,3,3,'test','damaged','return')").run()
}
const graph = () => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','inventory_movements','audit_logs','product_remove_operations','pending_actions'].map(table=>rawDb.prepare('SELECT * FROM '+table).all()))
async function main() {
  for(const ledger of ['cache','branch','batch','damaged']) {
    await check('real PUT refuses '+ledger+' alone without effects',async()=>{
      seed(ledger); const before=graph()
      const res=await request('PUT',{is_active:0,description:'must not land'})
      assert.equal(res.status,409,JSON.stringify(res)); assert.equal(res.json.code,'product_has_stock')
      assert.equal(graph(),before)
    })
    await check('real DELETE refuses '+ledger+' alone without effects',async()=>{
      seed(ledger); const before=graph()
      const res=await request('DELETE',{reason:'guard test',client_request_id:'guard-delete-'+ledger})
      assert.equal(res.status,409,JSON.stringify(res)); assert.equal(res.json.code,'product_has_stock')
      assert.equal(graph(),before)
    })
  }
  await check('all-zero PUT control deactivates',async()=>{
    seed('zero'); const res=await request('PUT',{is_active:0}); assert.equal(res.status,200,JSON.stringify(res)); assert.equal(rawDb.prepare('SELECT is_active FROM products WHERE id=1').get().is_active,0)
  })
  await check('inactive stocked POST refuses without creation',async()=>{
    seed('zero'); const before=graph(); const res=await post('/',{name:'New inactive',is_active:0,stock_quantity:2,branch_id:1})
    assert.equal(res.status,409,JSON.stringify(res)); assert.equal(res.json.code,'product_has_stock'); assert.equal(graph(),before)
  })
  const review = loadReal('lib/reviewApply.ts', {
    './db': {getDb:()=>db}, './audit': {audit:async()=>{}}, './cache': {bumpVersion:async()=>{}},
    '../durable-objects/broadcastHub': {broadcast:async()=>{}},
  })
  for(const action of ['update','delete']) for(const ledger of ['cache','branch','batch','damaged']) {
    await check('review '+action+' refuses '+ledger+' without effects',async()=>{
      seed(ledger); const before=graph()
      await assert.rejects(()=>review.applyApprovedPendingAction(fakeEnv,{section:'products',action_type:action,entity_type:'product',entity_id:1,payload_json:JSON.stringify({is_active:0,reason:'review guard'})},{id:1,name:'Reviewer'}),err=>err.code==='product_has_stock')
      assert.equal(graph(),before)
    })
  }
  const deletion=loadReal('lib/productDelete.ts')
  const stockMapper=loadReal('lib/productStockGuard.ts').productStockGuardError
  await check('saved positive removal plan refuses before receipt/audit writes',async()=>{
    seed('zero');const plan=await deletion.prepareProductRemovePlan(db,1,'saved plan')
    rawDb.prepare('UPDATE products SET stock_quantity=2 WHERE id=1').run();const before=graph()
    await assert.rejects(()=>db.batch(deletion.productRemoveApplyStatements({plan,operationId:'saved-remove',source:'direct',requestId:'saved-remove',user:FAKE_USER,transitionStamp:'2026-10-08T00:00:00Z',planDigest:'saved-digest'})),err=>stockMapper(err)?.code==='product_has_stock')
    assert.equal(graph(),before)
    await assert.rejects(()=>db.batch(deletion.productRemoveReplayStatements({snapshot:{plan,transition_stamp:'2026-10-08T00:00:00Z'},operation:{operation_id:'legacy-removal'},direction:'redo',historyId:1,expectedGeneration:1,user:FAKE_USER,transitionStamp:'2026-10-08T00:00:01Z',transitionRequestId:'redo'})),err=>stockMapper(err)?.code==='product_has_stock')
    assert.equal(graph(),before)
  })
  await check('negative row and cancelling branch rows still refuse',async()=>{
    seed('zero');rawDb.exec('PRAGMA ignore_check_constraints=ON');rawDb.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,-3)').run();rawDb.exec('PRAGMA ignore_check_constraints=OFF')
    const first=await request('PUT',{is_active:0});assert.equal(first.json.code,'product_has_stock')
    rawDb.prepare("INSERT INTO branches(id,name,is_active) VALUES(2,'Offset',1)").run();rawDb.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,3)').run()
    const before=graph();const second=await request('DELETE',{reason:'offset',client_request_id:'offset-rows'});assert.equal(second.status,409);assert.equal(second.json.code,'product_has_stock');assert.equal(graph(),before)
  })
  for(const method of ['PUT','DELETE']) await check(method+' rejects stock racing after admission before effects',async()=>{
    seed('zero')
    beforeNextWriteBatch=()=>rawDb.prepare('UPDATE products SET stock_quantity=3 WHERE id=1').run()
    const res=await request(method,method==='PUT'?{is_active:0,description:'race must not land'}:{reason:'Race',client_request_id:'race-'+method})
    assert.equal(res.status,409,JSON.stringify(res));assert.equal(res.json.code,'product_has_stock')
    assert.equal(rawDb.prepare('SELECT is_active FROM products WHERE id=1').get().is_active,1)
    assert.equal(rawDb.prepare('SELECT description FROM products WHERE id=1').get().description,null)
    assert.equal(rawDb.prepare('SELECT COUNT(*) n FROM product_remove_operations').get().n,0)
    assert.equal(rawDb.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,0)
  })
  await check('zero cleanup skips batch-only and damaged-only selected products',async()=>{
    seed('batch'); const before=graph();const res=await post('/zero-quantity-delete',{ids:[1]})
    assert.equal(res.status,200,JSON.stringify(res));assert.equal(res.json.deletedCount,0);assert.equal(res.json.skipped[0].reason,'product_has_stock');assert.equal(graph(),before)
    seed('damaged');const damageBefore=graph();const damaged=await post('/zero-quantity-delete',{ids:[1]});assert.equal(damaged.json.deletedCount,0);assert.equal(graph(),damageBefore)
  })
  await check('zero DELETE succeeds and same request replays without effects',async()=>{
    seed('zero'); const body={reason:'zero control',client_request_id:'zero-delete-control'}
    const res=await request('DELETE',body); assert.equal(res.status,200,JSON.stringify(res)); assert.equal(res.json.changes,1)
    const before=graph(); const replay=await request('DELETE',body); assert.equal(replay.status,200);assert.equal(replay.json.replayed,true);assert.equal(graph(),before)
  })
  console.log(passed+' checks passed')
}
main().catch(err=>{console.error(err);process.exitCode=1})

