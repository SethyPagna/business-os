const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { Miniflare } = require('miniflare')

const root = path.join(__dirname, '..', 'src')
function loadTs(rel, stubs = {}) {
  const file = path.join(root, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_target, property) => property === 'default' ? permissive() : permissive(), apply: () => undefined, construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, main) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, main)
  }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod) }
  finally { Module._load = original }
  return mod.exports
}

class FakeHono {
  constructor() { this.posts = new Map(); this.gets = new Map(); FakeHono.instance = this }
  post(path, handler) { this.posts.set(path, handler); return this } get(path, handler) { this.gets.set(path, handler); return this }
  put() { return this } patch() { return this } delete() { return this } use() { return this }
  on() { return this } all() { return this } route() { return this } onError() { return this } notFound() { return this }
}

function loadRoute(nativeDb) {
  const dbLib = loadTs('lib/db.ts')
  const rawCompat = new dbLib.D1Compat(nativeDb)
  const controls = { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0, fullLotDetailReads: 0 }
  const observe = (sql, params = {}) => {
    controls.statements += 1
    controls.maxBindings = Math.max(controls.maxBindings, Object.keys(params || {}).length)
    controls.maxCompoundTerms = Math.max(controls.maxCompoundTerms, 1 + (sql.match(/\bUNION(?:\s+ALL)?\b/gi) || []).length)
    if (/SELECT\s+pb\.variant_product_id\s+AS\s+product_id,pb\.id\s+AS\s+batch_id/i.test(sql)) controls.fullLotDetailReads += 1
  }
  const db = {
    prepare(sql) {
      const statement = rawCompat.prepare(sql)
      return {
        get: (params) => { observe(sql, params); return statement.get(params) },
        all: (params) => { observe(sql, params); return statement.all(params) },
        run: (params) => { observe(sql, params); return statement.run(params) },
      }
    },
    batch(statements) {
      statements.forEach(({ sql, params }) => observe(sql, params))
      controls.maxBatchStatements = Math.max(controls.maxBatchStatements, statements.length)
      return rawCompat.batch(statements)
    },
  }
  const detail = loadTs('lib/productDetailRule.ts')
  const binding = loadTs('lib/sqlBinding.ts')
  const identity = loadTs('lib/productIdentity.ts', { './db': {}, './sqlBinding': binding, './productDetailRule': detail })
  const merge = loadTs('lib/productMerge.ts')
  const selected = loadTs('lib/productConflictMergeBatch.ts', { './productIdentity': identity, './productDetailRule': detail, './productMerge': merge })
  const actionGroups = loadTs('lib/productConflictActionGroups.ts', {
    './productIdentity': identity, './productDetailRule': detail, './productMerge': merge, './productConflictMergeBatch': selected,
  })
  const permissions = { getActionTier: () => 'full', getPermissionTier: () => 'full', hasPermission: () => true, getMergedPermissions: () => ({}), isAdminControlUser: () => true }
  loadTs('routes/products.ts', {
    hono: { Hono: FakeHono }, '../index': {}, '../lib/db': { getDb: () => db }, '../lib/auth': { requireAuth: async () => {} },
    '../lib/productDetailRule': detail, '../lib/sqlBinding': binding, '../lib/productIdentity': identity, '../lib/productMerge': merge,
    '../lib/productConflictMergeBatch': selected, '../lib/productConflictActionGroups': actionGroups, '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => {} }, '../lib/cache': { bumpVersion: async () => {}, cachedJsonResponse: async () => null, getVersionWithFallback: async () => '1' },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  })
  return { app: FakeHono.instance, controls, db: rawCompat }
}

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
  try {
    const native = await mf.getD1Database('DB')
    const execSql = async (sql) => {
      const source = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n')
      for (const statement of source.split(';').map((item) => item.trim()).filter(Boolean)) await native.prepare(statement).run()
    }
    await execSql(`
      CREATE TABLE action_history(id INTEGER PRIMARY KEY);
      CREATE TABLE branches(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);
      CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,barcode TEXT,category TEXT,brand TEXT,unit TEXT,image_path TEXT,is_active INTEGER,is_group INTEGER,updated_at TEXT,
        cost_price_usd REAL,cost_price_khr REAL,selling_price_usd REAL,selling_price_khr REAL,wholesale_price_usd REAL,wholesale_price_khr REAL);
      CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL,PRIMARY KEY(product_id,branch_id));
      CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER,batch_key TEXT,lot_code TEXT,expiry_date TEXT,received_at TEXT,is_active INTEGER,notes TEXT,
        unit_cost_usd REAL,received_quantity REAL,received_branch_id INTEGER,received_cost_usd REAL,supplier_id INTEGER,supplier_name TEXT,payment_status TEXT,credit_due_date TEXT);
      CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,PRIMARY KEY(batch_id,branch_id));
    `)
    await execSql(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0138_product_conflict_action_groups.sql'), 'utf8'))
    const seed = [native.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1)")]
    const mergeGroups = []
    for (let group = 0; group < 12; group += 1) {
      const memberIds = []
      for (let member = 0; member < 3; member += 1) {
        const id = 2000 + group * 3 + member
        const barcode = String(880000 + group)
        memberIds.push(id)
        seed.push(native.prepare(`INSERT INTO products(id,name,barcode,category,brand,unit,is_active,is_group,updated_at,cost_price_usd,cost_price_khr,
          selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, `Native ${group}-${member}`, member === 0 ? `0${barcode}` : barcode,
          member % 2 ? 'B' : 'A', `Brand ${member}`, member ? 'pcs' : 'box', 1, 0, '2026-09-08 01:00:00', member === 0 ? 0 : member * 2, 0, 10 + member, 0, 8 + member, 0))
        seed.push(native.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, 1, member + 1))
      }
      mergeGroups.push({ group_key: `barcode:${880000 + group}`, member_ids: memberIds })
    }
    await native.batch(seed)
    const { app, controls, db } = loadRoute(native)
    const body = { manifest_version: 1, resolution_version: 2, client_request_id: 'native_group_review_001', merge_groups: mergeGroups, remove_rows: [] }
    const response = await app.posts.get('/possible-duplicates/merge-batch/preview')({
      env: {}, req: { json: async () => body }, get: () => ({ id: 77, username: 'native' }),
      json: (payload, status = 200) => ({ status, body: payload }), executionCtx: { waitUntil: () => {} },
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.counts.actionable_groups, 12)
    assert.equal(response.body.counts.total_members, 36)
    assert.equal(response.body.page.groups[0].members.length, 3)
    assert.equal(response.body.page.groups[0].economics.merged.cost_price_usd, 3)
    assert.equal(response.body.page.groups[0].stock.projected_by_branch[0].quantity, 6)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM product_conflict_action_reviews').get()).n, 1)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM product_conflict_action_group_members').get()).n, 36)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM products WHERE is_active=1').get()).n, 36, 'native preview does not mutate products')
    await native.batch([
      native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,notes) VALUES(?,?,?,?,?)`)
        .bind(90001, 2000, 'huge-a', 1, 'N'.repeat(300000)),
      native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,notes) VALUES(?,?,?,?,?)`)
        .bind(90002, 2001, 'huge-b', 1, 'N'.repeat(300000)),
    ])
    const fullLotReadsBefore = controls.fullLotDetailReads
    const oversizedBody = { manifest_version: 1, resolution_version: 2, client_request_id: 'native_oversized_lots', merge_groups: [mergeGroups[0]], remove_rows: [] }
    const oversized = await app.posts.get('/possible-duplicates/merge-batch/preview')({
      env: {}, req: { json: async () => oversizedBody }, get: () => ({ id: 77, username: 'native' }),
      json: (payload, status = 200) => ({ status, body: payload }), executionCtx: { waitUntil: () => {} },
    })
    assert.equal(oversized.status, 200)
    assert.equal(oversized.body.page.groups[0].blocked.code, 'review_detail_limit')
    assert.equal(oversized.body.page.groups[0].lots.detail_status, 'refused')
    assert.equal(controls.fullLotDetailReads, fullLotReadsBefore, 'native oversized lot text is refused before the full detail SELECT')
    const storedBytes = await db.prepare(`SELECT length(CAST(g.detail_json AS BLOB)) AS bytes
      FROM product_conflict_action_groups g JOIN product_conflict_action_reviews r ON r.id=g.review_id
      WHERE r.request_id=@requestId`).get({ requestId: 'native_oversized_lots' })
    assert.ok(Number(storedBytes?.bytes) <= 512 * 1024)
    assert.ok(controls.maxBindings <= 80)
    assert.ok(controls.maxCompoundTerms <= 5)
    assert.ok(controls.statements <= 700)
    console.log(`product conflict action groups native D1: 12 groups/36 members plus oversized-lot refusal passed; ${controls.statements} statements, ${controls.maxBindings} bindings, ${controls.maxCompoundTerms} compound terms`)
  } finally { await mf.dispose() }
}

main().catch((error) => { console.error(error); process.exit(1) })
