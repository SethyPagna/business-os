// READS-CUT (9): the startup data check (ensureCoreDataInvariantsOnce) was
// mounted on app.use('*'), so a cold isolate paid for it even when its first
// request was a JS chunk, an image, /health or a storefront document. It is
// now mounted on /api/* only. Everything else about it is unchanged on purpose:
// its one heavy predicate -- "is any active product missing branch_stock?" --
// was measured against a NOT EXISTS rewrite and gains nothing, because SQLite
// already answers the NOT IN through the (product_id, branch_id) unique index
// without materialising branch_stock. The plan shape is pinned below so a
// future edit that loses that index probe is caught.
//
// node:sqlite has no rows_read meta, so the row totals are a MODEL taken from
// the EXPLAIN QUERY PLAN (plan shape asserted, totals are fixture arithmetic).
//
// Run: node scripts/test-startup-check-cost-pure.cjs
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')

function load(rel, overrides = {}) {
  const filename = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// The missingBranchStock predicate exactly as tryFastPath ships it.
function shippedPredicate() {
  const text = src('lib/coreDataInvariants.ts')
  const start = text.indexOf('EXISTS(SELECT 1 FROM products p', text.indexOf('async function tryFastPath'))
  const end = text.indexOf('AS missingBranchStock', start)
  assert.ok(start > 0 && end > start, 'tryFastPath must still project missingBranchStock')
  return text.slice(start, end).trim()
}

function seededDb(products, branches) {
  const raw = new DatabaseSync(':memory:')
  for (const sql of loadAll()) raw.exec(sql)
  raw.exec('BEGIN')
  const insertProduct = raw.prepare('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(?,?,1,1)')
  const insertStock = raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,1)')
  for (let id = 1; id <= products; id++) {
    insertProduct.run(id, `P${id}`)
    for (const branch of branches) insertStock.run(id, branch)
  }
  raw.exec('COMMIT')
  return raw
}
const plan = (raw, predicate) => raw.prepare(`EXPLAIN QUERY PLAN SELECT ${predicate} AS m`).all().map((row) => String(row.detail))

async function main() {
  await check('the healthy-start predicate probes the unique index and never scans branch_stock', async () => {
    const raw = seededDb(2000, [1, 2])
    const shipped = plan(raw, shippedPredicate())
    assert.ok(!shipped.some((line) => /SCAN branch_stock/.test(line)), `must not scan branch_stock -- ${shipped.join(' | ')}`)
    assert.ok(shipped.some((line) => /USING (COVERING )?INDEX idx_branch_stock_product_branch_unique/.test(line)), `probes the unique index -- ${shipped.join(' | ')}`)
    const products = 2000
    console.log(`  healthy-start predicate, ${products} active products (production 8,560): ~${products} index entries + ${products} probes = ${2 * products} modelled rows per cold /api isolate`)
    raw.close()
  })

  await check('the check is mounted on /api/* only, once, before the maintenance gate', async () => {
    const index = src('index.ts')
    const uses = [...index.matchAll(/app\.use\('([^']+)',[^\n]*\n(?:(?!\napp\.use)[\s\S])*?ensureCoreDataInvariantsOnce\(c\.env\)/g)]
    assert.strictEqual(uses.length, 1, 'exactly one middleware calls the check')
    assert.strictEqual(uses[0][1], '/api/*', 'and it is scoped to the API')
    assert.strictEqual((index.match(/ensureCoreDataInvariantsOnce\(/g) || []).length, 1)
    assert.ok(index.indexOf('ensureCoreDataInvariantsOnce(c.env)') < index.indexOf('isMaintenanceGatedRequest(c.req.method, c.req.path)'), 'seeding still precedes the maintenance gate')
  })

  await check('non-API routes never read the seeded organization, so skipping the check there is safe', async () => {
    const index = src('index.ts')
    const routes = ['/health', '/uploads/*', '/assets/*', '/robots.txt', '/sitemap.xml', '/ws']
    for (const route of routes) assert.ok(index.includes(`'${route}'`), `${route} route exists`)
    const uploads = index.slice(index.indexOf("app.get('/uploads/*'"), index.indexOf("app.route('/api/settings'"))
    assert.ok(!/organization/i.test(uploads), 'the uploads handler does not read organizations')
  })

  await check('the once wrapper still answers a warm isolate with zero statements', async () => {
    const stats = { reads: 0 }
    const core = load('lib/coreDataInvariants.ts', {
      './db': { getDb: () => ({ prepare: () => ({ get: async () => { stats.reads++; return { organizationId: 1, organizationGroupId: 1, branchId: 1, adminRoleId: 1, adminPermissions: '{"all":true}', managerRoleId: 1, employeeRoleId: 1, adminUserId: 1, missingBranchStock: 0 } } }) }) },
      './sqlBinding': { buildInClause: () => ({ sql: '', params: {} }) },
      './customTableName': { assertCustomTableName: (name) => name },
      bcryptjs: { hashSync: () => 'x' },
    })
    const env = { BUSINESS_OS_ORGANIZATION_NAME: 'X' }
    await core.ensureCoreDataInvariantsOnce(env)
    const afterFirst = stats.reads
    await core.ensureCoreDataInvariantsOnce(env)
    await core.ensureCoreDataInvariantsOnce(env)
    assert.strictEqual(afterFirst, 1, 'one projection on the cold isolate')
    assert.strictEqual(stats.reads, 1, 'no further statements on the warm isolate')
  })

  console.log(`test-startup-check-cost-pure: ${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
