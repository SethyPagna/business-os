// Real SQLite + real D1 named-binding adapter. The frozen serial oracle is
// deliberately independent of the projection, including its early returns.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

async function legacyFastPath(db, orgName, orgSlug, publicId) {
  const org = await db.prepare(`SELECT id FROM organizations
    WHERE (public_id = @publicId OR slug = @slug) AND name = @name AND is_active = 1 AND setup_enabled = 0
    ORDER BY CASE WHEN public_id = @publicId THEN 0 ELSE 1 END, id ASC LIMIT 1`)
    .get({ publicId, slug: orgSlug, name: orgName })
  if (!org?.id) return null
  const group = await db.prepare(`SELECT id FROM organization_groups WHERE organization_id = @orgId
    AND slug = 'main' AND is_default = 1 AND is_active = 1 LIMIT 1`).get({ orgId: org.id })
  if (!group?.id) return null
  const branch = await db.prepare('SELECT id FROM branches WHERE is_active = 1 AND is_default = 1 ORDER BY id ASC LIMIT 1').get()
  if (!branch?.id) return null
  const role = await db.prepare("SELECT id, permissions FROM roles WHERE code = 'admin' AND name = 'Admin' AND is_system = 1 LIMIT 1").get()
  if (!role?.id || role.permissions !== '{"all":true}') return null
  const manager = await db.prepare("SELECT id FROM roles WHERE code = 'manager' LIMIT 1").get()
  if (!manager?.id) return null
  const employee = await db.prepare("SELECT id FROM roles WHERE code = 'employee' LIMIT 1").get()
  if (!employee?.id) return null
  const admin = await db.prepare("SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1").get()
  if (!admin?.id) return null
  const missing = await db.prepare(`SELECT EXISTS(SELECT 1 FROM products p
    WHERE p.is_active = 1 AND p.id NOT IN (SELECT product_id FROM branch_stock)) AS missing`).get()
  if (Number(missing?.missing || 0)) return null
  return { organizationId: org.id, organizationGroupId: group.id, branchId: branch.id,
    adminRoleId: role.id, adminUserId: admin.id, adminUserCreated: false, adminPassword: null }
}

const sourcePath = path.join(__dirname, '../src/lib/coreDataInvariants.ts')
const source = fs.readFileSync(process.env.CORE_INVARIANTS_SOURCE || sourcePath, 'utf8')
function load(rel, overrides = {}, text) {
  const filename = path.join(__dirname, '../src', rel)
  const output = ts.transpileModule(text ?? fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const dbModule = load('lib/db.ts', { './importMaintenanceFence': {} })
function loadCore(legacy = false) {
  const text = legacy ? source.replace(/async function tryFastPath\([\s\S]*?(?=export async function ensureCoreDataInvariants)/,
    legacyFastPath.toString().replace('legacyFastPath', 'tryFastPath') + '\n\n') : source
  return load('lib/coreDataInvariants.ts', {
    './db': dbModule,
    './sqlBinding': load('lib/sqlBinding.ts'),
    './customTableName': load('lib/customTableName.ts'),
    bcryptjs: { hashSync: () => 'focused-test-hash' },
  }, text + '\nexport { tryFastPath }\n')
}
const core = loadCore()
const legacy = loadCore(true)
const identity = { BUSINESS_OS_ORGANIZATION_NAME: ' Test OS ', BUSINESS_OS_ORGANIZATION_SLUG: ' TEST-OS ', BUSINESS_OS_ADMIN_PASSWORD: 'test-password' }
const migrations = loadAll()
function fixture() {
  const raw = new DatabaseSync(':memory:')
  for (const sql of migrations) raw.exec(sql)
  const stats = { reads: 0, writes: 0, delayMs: 0, fail: false, gate: null }
  const DB = { prepare(sql) {
    return { bind(...values) {
      const read = async () => {
        stats.reads++
        if (stats.gate) await stats.gate
        if (stats.fail) { stats.fail = false; throw new Error('injected read failure') }
        if (stats.delayMs) await new Promise((resolve) => setTimeout(resolve, stats.delayMs))
      }
      return {
        async first() { await read(); return raw.prepare(sql).get(...values) ?? null },
        async all() { await read(); return { results: raw.prepare(sql).all(...values) } },
        async run() { stats.writes++; const result = raw.prepare(sql).run(...values)
          return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
      }
    } }
  } }
  return { raw, stats, env: { DB, ...identity }, db: dbModule.getDb({ DB }) }
}
async function healthy() {
  const fx = fixture()
  await core.ensureCoreDataInvariants(fx.env)
  fx.raw.exec(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES(100,'Active',1,7),(101,'Inactive',0,9);
    INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 100,id,7 FROM branches WHERE is_default=1;
    UPDATE roles SET permissions='{"products":"view"}' WHERE code='manager';
    UPDATE roles SET permissions='{"pos":false}' WHERE code='employee';`)
  fx.stats.reads = fx.stats.writes = 0
  return fx
}
const args = ['Test OS', 'test-os', 'org_test_os']
function snapshot(raw) {
  return Object.fromEntries(['organizations','organization_groups','branches','roles','users','products','branch_stock']
    .map((table) => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !/_at$/.test(key))))]))
}
let passed = 0
async function check(name, fn) { await fn(); console.log('PASS', name); passed++ }
const cases = [
  ['healthy customized roles', '', true],
  ['organization missing', 'DELETE FROM organizations'],
  ['organization identity mismatch', "UPDATE organizations SET public_id='other',slug='other'"],
  ['organization name', "UPDATE organizations SET name='Other'"],
  ['organization inactive', 'UPDATE organizations SET is_active=0'],
  ['organization setup enabled', 'UPDATE organizations SET setup_enabled=1'],
  ['legacy identity adoption', "UPDATE organizations SET public_id='org_business_os',slug='business-os'"],
  ['group missing', 'DELETE FROM organization_groups'],
  ['group wrong organization', 'UPDATE organization_groups SET organization_id=999'],
  ['group wrong slug', "UPDATE organization_groups SET slug='other'"],
  ['group inactive', 'UPDATE organization_groups SET is_active=0'],
  ['group not default', 'UPDATE organization_groups SET is_default=0'],
  ['branch missing', 'DELETE FROM branch_stock; DELETE FROM branches'],
  ['branch inactive', 'UPDATE branches SET is_active=0'],
  ['branch not default', 'UPDATE branches SET is_default=0'],
  ['admin role missing', "DELETE FROM roles WHERE code='admin'"],
  ['admin role wrong name', "UPDATE roles SET name='Other' WHERE code='admin'"],
  ['admin role not system', "UPDATE roles SET is_system=0 WHERE code='admin'"],
  ['admin permission false', `UPDATE roles SET permissions='{"all":false}' WHERE code='admin'`],
  ['admin permission null', "UPDATE roles SET permissions=NULL WHERE code='admin'"],
  ['admin permission whitespace exactness', `UPDATE roles SET permissions='{ "all": true }' WHERE code='admin'`],
  ['admin permission extra key', `UPDATE roles SET permissions='{"all":true,"pos":true}' WHERE code='admin'`],
  ['manager missing', "DELETE FROM roles WHERE code='manager'"],
  ['employee missing', "DELETE FROM roles WHERE code='employee'"],
  ['admin missing', 'DELETE FROM users'],
  ['admin deleted', "UPDATE users SET deleted_at='2026-01-01'"],
  ['admin wrong username', "UPDATE users SET username='other'"],
  ['admin normalization and inactive allowed', "UPDATE users SET username='  AdMiN  ',is_active=0", true],
  ['missing active product stock', 'DELETE FROM branch_stock'],
  ['stock on nondefault branch is sufficient', 'UPDATE branch_stock SET branch_id=(SELECT id FROM branches WHERE is_default=0)', true],
  ['inactive products need no stock', 'UPDATE products SET is_active=0; DELETE FROM branch_stock', true],
  ['public identity outranks lower id slug match', `UPDATE organizations SET slug='renamed';
    INSERT INTO organizations(id,name,slug,public_id,is_active,setup_enabled) VALUES(-1,'Test OS','test-os','other',1,0);
    INSERT INTO organization_groups(organization_id,name,slug,is_default,is_active) VALUES(-1,'Main','main',1,1)`, true],
  ['slug match accepted without public identity', "UPDATE organizations SET public_id='other'", true],
  ['lowest active default branch selected', "INSERT INTO branches(id,name,is_default,is_active) VALUES(-1,'Earlier',1,1)", true],
]

async function main() {
  for (const [name, mutation, isHealthy = false] of cases) await check(name, async () => {
    const before = await healthy(), after = await healthy()
    try {
      if (mutation) { before.raw.exec(mutation); after.raw.exec(mutation) }
      const oldFast = await legacy.tryFastPath(before.db, ...args)
      const newFast = await core.tryFastPath(after.db, ...args)
      assert.equal(Boolean(oldFast), isHealthy, 'fixture must discriminate its invariant')
      assert.deepEqual(newFast, oldFast, 'projection selection must match serial SQL')
      const oldResult = await legacy.ensureCoreDataInvariants(before.env)
      const newResult = await core.ensureCoreDataInvariants(after.env)
      assert.deepEqual(newResult, oldResult, 'repair result parity')
      assert.deepEqual(snapshot(after.raw), snapshot(before.raw), 'repair database parity')
      assert.equal(after.stats.writes, before.stats.writes, 'same repair writes')
      if (isHealthy) assert.equal(after.stats.writes, 0, 'healthy path is read-only')
      else assert.ok(after.stats.writes > 0, 'unhealthy state must take repair fallback')
    } finally { before.raw.close(); after.raw.close() }
  })
  await check('cold 8-to-1 calls and synthetic per-read RTT (not production latency)', async () => {
    const fx = await healthy()
    try {
      fx.stats.delayMs = 10
      const startOld = performance.now()
      const oldResult = await legacy.ensureCoreDataInvariants(fx.env)
      const oldMs = performance.now() - startOld
      assert.equal(fx.stats.reads, 8, 'frozen serial baseline uses eight D1 calls')
      fx.stats.reads = 0
      const startNew = performance.now()
      const newResult = await core.ensureCoreDataInvariants(fx.env)
      const newMs = performance.now() - startNew
      assert.deepEqual(newResult, oldResult)
      console.log(JSON.stringify({ measurement: 'SQLite with synthetic 10ms RTT per D1 read', oldCalls: 8,
        newCalls: fx.stats.reads, oldMs: +oldMs.toFixed(2), newMs: +newMs.toFixed(2), writes: fx.stats.writes }))
      assert.equal(fx.stats.reads, 1, 'healthy cold path must use one D1 call (old code negative control)')
      assert.equal(fx.stats.writes, 0)
    } finally { fx.raw.close() }
  })
  await check('once wrapper shares concurrent work and warm calls add zero reads', async () => {
    const fx = await healthy(), once = loadCore()
    try {
      let release
      fx.stats.gate = new Promise((resolve) => { release = resolve })
      const first = once.ensureCoreDataInvariantsOnce(fx.env)
      const others = Array.from({ length: 8 }, () => once.ensureCoreDataInvariantsOnce(fx.env))
      others.forEach((promise) => assert.equal(promise, first))
      release()
      await Promise.all([first, ...others])
      assert.equal(fx.stats.reads, 1)
      assert.equal(once.ensureCoreDataInvariantsOnce(fx.env), first)
      await once.ensureCoreDataInvariantsOnce(fx.env)
      assert.equal(fx.stats.reads, 1)
      assert.equal(fx.stats.writes, 0)
    } finally { fx.raw.close() }
  })
  await check('once wrapper clears a rejected attempt and shares the successful retry', async () => {
    const fx = await healthy(), once = loadCore()
    try {
      fx.stats.fail = true
      const first = once.ensureCoreDataInvariantsOnce(fx.env)
      assert.equal(once.ensureCoreDataInvariantsOnce(fx.env), first)
      await assert.rejects(first, /injected read failure/)
      const retry = once.ensureCoreDataInvariantsOnce(fx.env)
      assert.notEqual(retry, first)
      assert.equal(once.ensureCoreDataInvariantsOnce(fx.env), retry)
      await retry
      assert.equal(fx.stats.reads, 2)
      assert.equal(fx.stats.writes, 0)
    } finally { fx.raw.close() }
  })
  await check('missing required schema still rejects instead of certifying healthy state', async () => {
    for (const table of ['organizations','organization_groups','branches','roles','users','products','branch_stock']) {
      const fx = await healthy()
      try {
        fx.raw.exec(`DROP TABLE ${table}`)
        await assert.rejects(legacy.ensureCoreDataInvariants(fx.env), /no such table/)
        await assert.rejects(core.ensureCoreDataInvariants(fx.env), /no such table/)
        assert.equal(fx.stats.writes, 0, `${table}: schema failure must not become a healthy result or write`)
      } finally { fx.raw.close() }
    }
  })
  console.log(`\n${passed} core invariants fast-path checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
