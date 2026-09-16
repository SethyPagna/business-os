// ORPHAN RECORDS gate (owner instruction, Sep 14 2026).
//
// A child row whose parent is gone is the quietest class of corruption in this
// system: nothing throws, the list pages simply stop showing a number, and the
// damage is only visible months later in a report that does not foot. This test
// runs the REAL writers -- sale create, add items, the delivery-added and
// line-removed amendments, cancel, customer return create, return bulk cancel
// and restore, contact merge, product merge and an action-history undo/redo
// replay -- against a REAL D1 database (Miniflare workerd) carrying the COMPLETE
// migration chain, and after every single step it audits EVERY parent/child
// relation in the schema.
//
// The relation list is not hand-written. It is derived mechanically from the
// migrated schema: every declared foreign key (PRAGMA foreign_key_list) plus
// every INTEGER `*_id` column resolved to its owning table by name. A `*_id`
// column that cannot be resolved FAILS the test rather than being skipped, so a
// new table cannot join the schema without joining the audit. That derivation
// produced 200 relations over 170 tables on 2026-09-14, with exactly one
// column exempted by name and reason (see HISTORICAL_REFERENCE below).
//
// The audit carries its own POSITIVE CONTROLS at the end: a deliberately
// orphaned sale_item and a deliberately orphaned customer_receivable are
// inserted and the sweep must report exactly them. A sweep that answers "clean"
// for every input is indistinguishable from a sweep that cannot see, so the
// instrument proves itself on this tree, in this run, right after the runs it
// just certified.
//
// The same relation list is emitted to ops/scripts/audit/orphan-audit.sql, a
// read-only file the coordinator can run against production; this test asserts
// the committed file still matches what the schema derives, so it cannot rot.
// On a first run (or after the schema changes) it rewrites that file, fails the
// one check, and asks for a re-run -- that is the bootstrap, not a flake.
//
// Run (from cloudflare/scripts/): node test-record-orphans-native.cjs
// About two minutes: most of it is the migration chain through Miniflare's D1
// (test-customer-return-create-d1-native.cjs, which migrates the same chain for
// one router, takes about 3m20s on its own).
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const auditSqlPath = path.resolve(root, '..', 'ops', 'scripts', 'audit', 'orphan-audit.sql')

// ---------------------------------------------------------------------------
// 1. Relation derivation.
// ---------------------------------------------------------------------------

/** base name of a `<base>_id` column -> the table that owns the row. */
const OWNER_TABLE = {
  sale: 'sales', return: 'returns', product: 'products', branch: 'branches', user: 'users',
  customer: 'customers', supplier: 'suppliers', contact: 'customers', delivery_contact: 'delivery_contacts',
  category: 'categories', batch: 'product_batches', variant_product: 'products',
  keeper_product: 'products', merged_product: 'products', sale_item: 'sale_items', return_item: 'return_items',
  movement: 'inventory_movements', history: 'action_history', action_history: 'action_history',
  snapshot: 'undo_snapshots', undo_snapshot: 'undo_snapshots', role: 'roles',
  shift: 'shift_sessions', shift_session: 'shift_sessions', device: 'devices',
  promotion: 'promotions', file: 'file_assets', note: 'notes', pending_action: 'pending_actions',
  organization: 'organizations', fee: 'fees',
}
/** `<base>_id` columns that are NOT references, each for a stated reason. */
const NOT_A_REFERENCE = new Set([
  'operation', 'review', 'group', 'session', 'rule', 'image', 'job', 'run', 'receipt', 'member',
  'payment', 'report', 'alias', 'parent', 'request', 'client_request',
  // An id from the OLD system, carried for provenance; it names no row here.
  'legacy',
  // Polymorphic: the owning table is decided by a sibling `entity`/`reference_type`
  // column, so a single join cannot audit it. Covered by each writer's own test.
  'entity', 'reference',
])
/**
 * Columns that record an id a row ONCE had, deliberately outliving the row.
 * These are not dangling references and a sweep that reports them teaches
 * operators to ignore it, so each one is named here with the writer that makes
 * it dangle -- and each is pinned by a step below that performs exactly that
 * write, so the exemption cannot quietly become a cover for a real orphan.
 */
const HISTORICAL_REFERENCE = {
  // The amendment ledger is the ONLY record that a removed line was ever on the
  // sale (lib/saleAmendments.ts's header states this for 'line_removed'), so a
  // line_removed entry keeps the id of the sale_item it deleted. Nothing joins
  // this column back to sale_items; the ledger row carries its own product id,
  // name, quantities and money. Proven by the "amendment: line removed" step.
  'sale_amendments.sale_item_id': 'the removed line is gone by design; the ledger keeps its id as provenance',
  // Migrations 0165/0166 delete every merged loser row and keep its id (plus the
  // full row as loser_json) in the merge map so the merge can be reviewed or
  // undone. Pinned by scripts/test-migration-0165-0166-pure.cjs, which asserts
  // each loser row is gone while its map row survives.
  'product_merge_map_0165.loser_id': 'the merged product is deleted by 0165; the map keeps its id as provenance',
  'customer_merge_map_0166.loser_id': 'the merged customer is deleted by 0166; the map keeps its id as provenance',
  // Migration 0168 (transfer-aware merge) follows the exact same shape as
  // 0165: the loser row is deleted and its id survives only as provenance in
  // the map. product_merge_pairs_0168 is the seed table naming the one
  // pair 0165 was forced to exclude (transfer-evidenced); it is consumed by
  // the same migration and is never read after (its loser_id is likewise a
  // dead product id by design). Pinned by test-migration-0168-pure.cjs.
  'product_merge_map_0168.loser_id': 'the merged product is deleted by 0168; the map keeps its id as provenance',
  'product_merge_pairs_0168.loser_id': 'the seed pair names a product 0168 goes on to delete; kept for provenance/idempotence',
  // Migration 0174 (leading-zero twin merge) is the same shape again: the
  // loser is deleted, the map/pairs keep its id. Pinned by test-migration-0174-pure.cjs.
  'product_merge_map_0174.loser_id': 'the merged product is deleted by 0174; the map keeps its id as provenance',
  'product_merge_pairs_0174.loser_id': 'the seed pair names a product 0174 goes on to delete; kept for provenance/idempotence',
}
/** Leading qualifiers that describe a ROLE, not a different kind of parent. */
const QUALIFIER = new Set(['from', 'to', 'source', 'destination', 'expected', 'seen', 'last_seen', 'last',
  'received', 'replacement', 'link', 'keeper', 'merged', 'current', 'captured', 'new', 'old', 'target',
  'variant', 'damaged', 'undo', 'reverses'])
/** Columns whose owner cannot be read off the name alone. */
const CHILD_SCOPED = {
  'portal_sessions.account_id': 'portal_accounts',
  'portal_password_resets.account_id': 'portal_accounts',
  'rfid_tags.last_seen_session_id': 'rfid_scan_sessions',
  'rfid_session_items.session_id': 'rfid_scan_sessions',
  'rfid_events.session_id': 'rfid_scan_sessions',
  'sale_items.damaged_lot_id': 'damaged_stock_lots',
  'ai_response_logs.provider_config_id': 'ai_provider_configs',
  'sale_amendments.reverses_amendment_id': 'sale_amendments',
  'sale_amendments.undo_action_id': 'action_history',
  'sales.cancel_fee_id': 'fees',
  'product_merge_map_0165.keeper_id': 'products',
  'customer_merge_map_0166.keeper_id': 'customers',
  'product_merge_map_0168.keeper_id': 'products',
  'product_merge_pairs_0168.keeper_id': 'products',
  'product_merge_map_0174.keeper_id': 'products',
  'product_merge_pairs_0174.keeper_id': 'products',
  // 0173's repair work table: every id names a live row (allocation, its
  // receipt-time lot, the lot actually deducted). Pinned by test-migration-0173-pure.cjs.
  'sale_not_paid_repair_0173.allocation_id': 'sale_item_batch_allocations',
  'sale_not_paid_repair_0173.allocation_batch_id': 'product_batches',
  'sale_not_paid_repair_0173.deduct_batch_id': 'product_batches',
}

function resolveOwner(base, known) {
  // `created_by_id`, `closed_by_user_id`, `actor_id`, `cashier_id` ... are all
  // the acting USER, however the column was spelled.
  if (/(^|_)by(_user)?$/.test(base) || ['actor', 'actor_user', 'cashier', 'requester'].includes(base)) return 'users'
  if (OWNER_TABLE[base]) return OWNER_TABLE[base]
  const direct = [`${base}s`, `${base}es`, base].find(name => known.has(name))
  if (direct) return direct
  const parts = base.split('_')
  for (let cut = 1; cut < parts.length; cut++) {
    if (!QUALIFIER.has(parts.slice(0, cut).join('_'))) continue
    const rest = parts.slice(cut).join('_')
    const owner = OWNER_TABLE[rest] || [`${rest}s`, `${rest}es`, rest].find(name => known.has(name))
    if (owner) return owner
  }
  return null
}

/**
 * Derive the relation list from a local better-sqlite3 copy of the SAME
 * migration chain the Worker's D1 runs. The schemas are cross-checked against
 * each other below (table for table), so this stays a statement about the real
 * database rather than about a convenient local one -- and it keeps 170 PRAGMA
 * round trips out of the Miniflare boundary.
 */
function deriveSchema() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name)
  const known = new Set(tables)
  const hasId = new Set(tables.filter(table => db.pragma(`table_info(${JSON.stringify(table)})`).some(column => column.name === 'id')))
  const relations = []
  const unresolved = []
  const historical = []
  for (const table of tables) {
    const declared = db.pragma(`foreign_key_list(${JSON.stringify(table)})`)
    for (const fk of declared) {
      relations.push({ child: table, column: fk.from, parent: fk.table, parentKey: fk.to || 'id', source: 'declared' })
    }
    const declaredColumns = new Set(declared.map(fk => fk.from))
    for (const column of db.pragma(`table_info(${JSON.stringify(table)})`)) {
      const match = /^(.*)_id$/.exec(column.name)
      if (!match || declaredColumns.has(column.name) || !/INT/i.test(column.type || '')) continue
      const base = match[1]
      if (NOT_A_REFERENCE.has(base)) continue
      if (HISTORICAL_REFERENCE[`${table}.${column.name}`]) { historical.push(`${table}.${column.name}`); continue }
      const parent = CHILD_SCOPED[`${table}.${column.name}`] || resolveOwner(base, known)
      if (!parent || !hasId.has(parent)) { unresolved.push(`${table}.${column.name}`); continue }
      relations.push({ child: table, column: column.name, parent, parentKey: 'id', source: 'convention' })
    }
  }
  relations.sort((a, b) => `${a.child}.${a.column}`.localeCompare(`${b.child}.${b.column}`))
  db.close()
  return { tables, relations, unresolved, historical }
}

const orphanSql = (relation) =>
  `SELECT '${relation.child}.${relation.column}->${relation.parent}' AS relation, COUNT(*) AS orphan_count`
  + ` FROM ${relation.child} c LEFT JOIN ${relation.parent} p ON p.${relation.parentKey} = c.${relation.column}`
  + ` WHERE c.${relation.column} IS NOT NULL AND p.${relation.parentKey} IS NULL`

function auditFileText(relations) {
  return [
    '-- Orphan audit -- READ ONLY. One SELECT per parent/child relation in the',
    '-- Business OS schema, each returning (relation, orphan_count).',
    '--',
    '-- GENERATED by cloudflare/scripts/test-record-orphans-native.cjs from the',
    '-- migrated schema. Do not hand-edit: that test regenerates this text and',
    '-- fails if the committed file differs, which is what keeps it from rotting',
    '-- as tables are added.',
    '--',
    '-- HOW TO RUN (production is a user-authorized action):',
    '--   npx wrangler d1 execute <DB> --remote --command "$(cat ops/scripts/audit/orphan-audit.sql)"',
    '-- Use --command, NOT --file: wrangler d1 execute --file prints only a',
    '-- summary and never the result rows.',
    '--',
    '-- Deliberately NOT audited, because the id is provenance and the row it',
    '-- named is meant to be gone:',
    ...Object.entries(HISTORICAL_REFERENCE).map(([column, reason]) => `--   ${column} -- ${reason}`),
    '--',
    '-- Every statement is a SELECT. There are no writes and no PRAGMA here.',
    '-- A healthy database answers 0 for every relation. A nonzero count on a',
    '-- historical actor column (e.g. sales.cashier_id) can also mean a user row',
    '-- was hard-deleted; read the count, do not assume the cause.',
    '',
    ...relations.map(relation => `${orphanSql(relation)};`),
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 2. The Worker under test: the real routers, fixtures only for auth/audit/
//    cache/telegram/broadcast.
// ---------------------------------------------------------------------------
async function workerBundle() {
  return build({
    stdin: {
      contents: `import { Hono } from 'hono'
        import sales from './src/routes/sales'
        import returns from './src/routes/returns'
        import products from './src/routes/products'
        import contacts from './src/routes/contacts'
        import actionHistory from './src/routes/actionHistory'
        const app = new Hono()
        app.route('/api/sales', sales)
        app.route('/api/returns', returns)
        app.route('/api/products', products)
        app.route('/api', contacts)
        app.route('/api/action-history', actionHistory)
        export default app`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{
      name: 'orphan-native-fixtures',
      setup(builder) {
        const fixtures = {
          auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
            if(!raw)return c.json({error:'Unauthorized'},401);
            c.set('user',{id:7,username:'admin',name:'Fixture Admin',role_code:'admin',permissions:raw});return next()}`,
          audit: 'export const audit=async()=>{}',
          cache: `export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};export const getVersionWithFallback=async()=>0;
            export const cachedJsonResponse=async(_e,_k,_t,fn)=>fn()`,
          broadcastHub: 'export const broadcast=async()=>{}',
          telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendTelegramEvent=async()=>{};
            export const sendSaleTelegramEvent=async()=>{};export const formatSaleTelegramLines=()=>[];
            export const telegramMoney=()=>''`,
        }
        builder.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ },
          args => ({ path: args.path.split('/').pop(), namespace: 'orphan-fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'orphan-fixture' },
          args => ({ contents: fixtures[args.path], loader: 'ts' }))
      },
    }],
  })
}

async function pricingKernel() {
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/saleItemPricing'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
  })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      // Same single exception as test-customer-return-create-d1-native.cjs:
      // Miniflare's D1 has a lower compound-SELECT term cap than the deployed
      // migration runner, and 0098's alias seed is observably a no-op here
      // because the fixture has no users while migrations run.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The audit itself.
// ---------------------------------------------------------------------------
async function auditOrphans(db, relations) {
  const findings = []
  const chunkSize = 40
  for (let start = 0; start < relations.length; start += chunkSize) {
    const chunk = relations.slice(start, start + chunkSize)
    const results = await db.batch(chunk.map(relation => db.prepare(orphanSql(relation))))
    results.forEach((result, index) => {
      const row = (result.results || [])[0]
      const count = Number(row && row.orphan_count) || 0
      if (count > 0) findings.push(`${chunk[index].child}.${chunk[index].column} -> ${chunk[index].parent}: ${count}`)
    })
  }
  return findings
}

let failures = 0
function report(name, error) {
  if (error) {
    failures++
    console.log(`FAIL ${name}`)
    console.log(String(error && error.message || error).split('\n').slice(0, 8).map(line => `     ${line}`).join('\n'))
  } else {
    console.log(`PASS ${name}`)
  }
}

async function main() {
  const started = Date.now()
  const schema = deriveSchema()
  try {
    assert.deepEqual(schema.unresolved, [],
      `these *_id columns resolve to no owning table -- map them in OWNER_TABLE/CHILD_SCOPED or list them in NOT_A_REFERENCE with a reason:\n${schema.unresolved.join('\n')}`)
    assert.ok(schema.relations.length > 150, `only ${schema.relations.length} relations derived; the derivation is broken`)
    for (const required of [
      'sale_items.sale_id->sales', 'return_items.return_id->returns', 'return_items.sale_item_id->sale_items',
      'sale_amendments.sale_id->sales', 'sale_mutation_receipts.sale_id->sales', 'returns.sale_id->sales',
      'customer_receivables.customer_id->customers', 'sales.customer_id->customers',
      'product_batches.variant_product_id->products', 'branch_stock.product_id->products',
      'branch_stock.branch_id->branches', 'sale_item_batch_allocations.sale_item_id->sale_items',
      'return_create_receipts.return_id->returns', 'product_images.product_id->products',
    ]) {
      assert.ok(schema.relations.some(relation => `${relation.child}.${relation.column}->${relation.parent}` === required),
        `the audit lost a core relation: ${required}`)
    }
    assert.deepEqual(schema.historical.slice().sort(), Object.keys(HISTORICAL_REFERENCE).slice().sort(),
      'a HISTORICAL_REFERENCE entry names a column the schema no longer has, or one stopped matching')
    report('every *_id column in the schema is audited or explicitly classified')
  } catch (error) { report('every *_id column in the schema is audited or explicitly classified', error) }

  try {
    const expected = auditFileText(schema.relations)
    const onDisk = fs.existsSync(auditSqlPath) ? fs.readFileSync(auditSqlPath, 'utf8').split('\r\n').join('\n') : null
    if (onDisk !== expected) fs.writeFileSync(auditSqlPath, expected)
    assert.equal(onDisk, expected, 'ops/scripts/audit/orphan-audit.sql was stale; it has been regenerated, re-run to confirm')
    // Check the STATEMENTS, not the header comment -- the comment names the very
    // words it forbids ("no writes and no PRAGMA here").
    const statements = expected.split('\n').filter(line => line && !line.startsWith('--')).join('\n')
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|ATTACH|REPLACE)\b/i.test(statements),
      'the exported audit is not read-only')
    report('ops/scripts/audit/orphan-audit.sql matches the schema and is read-only')
  } catch (error) { report('ops/scripts/audit/orphan-audit.sql matches the schema and is read-only', error) }

  const [kernel, bundle] = await Promise.all([pricingKernel(), workerBundle()])
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR),
  })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)

    const liveTables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
      .results.map(row => row.name)
      // _cf_METADATA is Miniflare's own bookkeeping table, not part of the app schema.
      .filter(name => !name.startsWith('_cf_'))
    try {
      assert.deepEqual(liveTables, schema.tables, 'the D1 schema and the locally derived schema disagree')
      report('the audited schema is the schema the Worker actually runs on')
    } catch (error) { report('the audited schema is the schema the Worker actually runs on', error) }

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const call = async (url, body, method = 'POST') => {
      const response = await mf.dispatchFetch(`http://local${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 400) } }
      return { status: response.status, body: parsed }
    }
    const ok = (result, what) => {
      assert.ok(result.status >= 200 && result.status < 300, `${what} answered ${result.status}: ${JSON.stringify(result.body).slice(0, 400)}`)
      return result.body
    }
    const one = async (sql) => (await db.prepare(sql).first())

    // -- seed ---------------------------------------------------------------
    await db.batch([
      db.prepare("INSERT INTO roles(id,code,name,permissions) VALUES(1,'admin','Admin','{\"all\":true}')"),
      db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(7,'admin','Fixture Admin','x',1,'{\"all\":true}',1)"),
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)"),
      db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Warehouse',1,0)"),
      db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('exchange_rate','4100','seed')"),
      db.prepare("INSERT INTO products(id,name,barcode,selling_price_usd,cost_price_usd,stock_quantity,is_active) VALUES(1,'Orphan Serum','8850001',10,4,40,1)"),
      db.prepare("INSERT INTO products(id,name,barcode,selling_price_usd,cost_price_usd,stock_quantity,is_active) VALUES(2,'Orphan Toner','8850002',6,2,40,1)"),
      db.prepare("INSERT INTO products(id,name,barcode,selling_price_usd,cost_price_usd,stock_quantity,is_active) VALUES(3,'Orphan Toner','8850002',6,2,10,1)"),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,40)'),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,40)'),
      db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(3,1,10)'),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(501,2,'orphan-lot-toner','ORPHAN-LOT-2','2026-09-02',1,2)"),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(501,1,10)'),
      db.prepare("INSERT INTO customers(id,name,phone,phone_normalized) VALUES(1,'Orphan Keeper','012000111','012000111')"),
      db.prepare("INSERT INTO customers(id,name,phone,phone_normalized) VALUES(2,'Orphan Keeper','012000111','012000111')"),
      db.prepare("INSERT INTO suppliers(id,name) VALUES(1,'Orphan Supplier')"),
      db.prepare("INSERT INTO delivery_contacts(id,name,phone,area) VALUES(1,'Orphan Driver','012777888','Toul Kork')"),
      db.prepare("INSERT INTO customer_receivables(legacy_id,customer_id,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(770001,2,'Orphan Keeper','INV-ORPHAN-1','2026-09-01',12,0,12,'open','orphan-audit-fixture',1)"),
    ])

    // -- the sale the return is taken from ----------------------------------
    // Seeded BEFORE the writers, and deliberately at id 900, for two reasons.
    // It needs the real captured-pricing snapshot the POS writes (the return
    // kernel is v1-only, and nothing here should fake that), and it pushes the
    // autoincrement sale ids clear of the returns id space: an amendment that
    // puts units back on the shelf writes an inventory_movement with
    // movement_type='return' and reference_id=THE SALE ID (lib/saleAmendments.ts
    // saleMovementStatement), while POST /api/returns' postcondition counts
    // movements with movement_type='return' and reference_id=THE RETURN ID. With
    // sale 1 and return 1 both existing, the amendment's movement is counted as
    // the return's and the return is refused with write_conflict. That is a
    // property of the polymorphic reference_id column, not of this test; keeping
    // the id spaces apart here isolates the orphan audit from it.
    const pool = {
      version: 1, pool_key: 'orphan-return-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4100, rules: [],
      lines: [{
        line_key: 'orphan-return-line', source: 'selling', selling_price_input_usd: null, manual: { type: 'none', value: 0 },
        product: { id: 1, selling_price_usd: 10, selling_price_khr: 41000, wholesale_price_usd: null,
          discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0 },
      }],
    }
    const allocation = { version: 1, lines: [{ line_key: 'orphan-return-line', amount: 20 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
    const priced = kernel.materializeCapturedPricingRow({ id: 900, product_id: 1 }, pool, { 'orphan-return-line': 2 }, 'orphan-return-line', allocation)
    await db.batch([
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(500,1,'orphan-lot','ORPHAN-LOT','2026-09-01',1,1)"),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,1,2)'),
      db.prepare(`INSERT INTO sales(id,receipt_number,branch_id,branch_name,customer_id,customer_name,exchange_rate,subtotal_usd,discount_usd,
        membership_discount_usd,tax_usd,calculated_total_usd,rounding_adjustment_usd,total_usd,money_precision_version,sale_status,cashier_id)
        VALUES(900,'ORPHAN-SALE-900',1,'Shop',1,'Orphan Keeper',4100,20,0,0,0,20,0,20,1,'completed',7)`),
      db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,cost_price_usd,cost_price_khr,
        total_usd,total_khr,base_price_usd,base_price_khr,applied_price_usd,applied_price_khr,
        product_discount_usd,product_discount_khr,product_discount_type,product_discount_label,
        manual_discount_usd,manual_discount_khr,manual_discount_type,manual_discount_value,price_mode,pricing_snapshot_json)
        VALUES(900,900,1,'Orphan Serum',2,1,500,4,16400,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        priced.total_usd, priced.total_khr, priced.base_price_usd, priced.base_price_khr,
        priced.applied_price_usd, priced.applied_price_khr, priced.product_discount_usd, priced.product_discount_khr,
        priced.product_discount_type, priced.product_discount_label, priced.manual_discount_usd, priced.manual_discount_khr,
        priced.manual_discount_type, priced.manual_discount_value, priced.price_mode, priced.pricing_snapshot_json),
      db.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(900,500,1,2,0)'),
    ])

    const steps = []
    const step = (name, run) => steps.push({ name, run })

    // The v1 money contract refuses a basket the client has not priced: every
    // line carries a client_line_key, a pricing_source and the pricing_quote the
    // cashier saw, and the route answers 409 sale_pricing_quote_conflict with the
    // quotes it computed itself when they disagree. That payload IS the review
    // contract, so this helper plays the client's part -- price the basket, then
    // commit the reviewed quotes. The first call writes nothing (the comparison
    // runs before any statement), so the retry is a first write, not a second.
    const priceThenPost = async (url, body, what) => {
      let attempt = { ...body }
      for (let round = 0; round < 3; round += 1) {
        const response = await call(url, attempt)
        if (response.status !== 409 || !response.body) return ok(response, what)
        if (response.body.code === 'sale_pricing_quote_conflict') {
          assert.ok(Array.isArray(attempt.items), `${what} asked for a line quote review but the request has no lines`)
          const quotes = new Map((response.body.pricing_quotes || []).map(row => [row.client_line_key, row]))
          attempt = { ...attempt, items: attempt.items.map((item) => {
            const quote = quotes.get(item.client_line_key)
            assert.ok(quote, `${what} demanded a quote review but quoted no line ${item.client_line_key}`)
            return { ...item, pricing_quote: {
              gross_usd: quote.gross_usd, product_discount_usd: quote.product_discount_usd,
              manual_discount_usd: quote.manual_discount_usd, total_usd: quote.total_usd, total_khr: quote.total_khr } }
          }) }
          continue
        }
        // The second gate: an amendment also has to show the header total the
        // cashier approved. The refusal carries proven_uncommitted, so echoing
        // its own quote back is a first write, not a retry over a partial one.
        if (response.body.code === 'sale_header_quote_conflict') {
          assert.equal(response.body.proven_uncommitted, true, `${what} refused the header quote without proving it wrote nothing`)
          attempt = { ...attempt, expected_header_quote: response.body.header_quote }
          continue
        }
        return ok(response, what)
      }
      throw new Error(`${what} was still asking for a review after three rounds`)
    }
    const line = (key, productId, quantity) => ({
      product_id: productId, quantity, branch_id: 1, client_line_key: key, pricing_source: 'selling',
    })

    step('sale create', async (state) => {
      const created = await priceThenPost('/api/sales', {
        money_precision_version: 1,
        items: [line('orphan-a-1', 1, 2), line('orphan-a-2', 2, 1)],
        branch_id: 1, customer_id: 2, customer_name: 'Orphan Keeper', customer_phone: '012000111',
        payment_details: [{ method: 'Cash', amount_usd: 26, amount_khr: 0 }],
        payment_currency: 'USD', amount_paid_usd: 26, amount_paid_khr: 0, exchange_rate: 4100,
        client_request_id: 'orphan-sale-1',
      }, 'POST /api/sales')
      state.saleA = Number(created.id)
      assert.ok(state.saleA > 0, `no sale id came back: ${JSON.stringify(created).slice(0, 200)}`)
      assert.equal((await one(`SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=${state.saleA}`)).n, 2)
    })

    step('second sale create (to be cancelled)', async (state) => {
      const created = await priceThenPost('/api/sales', {
        money_precision_version: 1,
        items: [line('orphan-b-1', 1, 1)],
        branch_id: 1, customer_name: 'Walk-in',
        payment_details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }],
        payment_currency: 'USD', amount_paid_usd: 10, amount_paid_khr: 0, exchange_rate: 4100,
        client_request_id: 'orphan-sale-2',
      }, 'POST /api/sales (second)')
      state.saleB = Number(created.id)
      assert.ok(state.saleB > 0, `no second sale id came back: ${JSON.stringify(created).slice(0, 200)}`)
    })

    step('sale add items', async (state) => {
      const row = await one(`SELECT updated_at FROM sales WHERE id=${state.saleA}`)
      await priceThenPost(`/api/sales/${state.saleA}/items`, {
        money_precision_version: 1,
        items: [line('orphan-a-3', 2, 1)],
        client_request_id: 'orphan-add-items-1', expected_exchange_rate: 4100,
        expected_updated_at: row.updated_at ?? null,
      }, 'POST /api/sales/:id/items')
      assert.equal((await one(`SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=${state.saleA}`)).n, 3)
    })

    step('amendment: delivery added', async (state) => {
      // A counter sale becomes a delivery: a new delivery_contact link, a fee on
      // the header and an immutable sale_amendments ledger row, all in one write.
      const row = await one(`SELECT updated_at FROM sales WHERE id=${state.saleA}`)
      await priceThenPost(`/api/sales/${state.saleA}/amendments`, {
        kind: 'delivery_added', money_precision_version: 1,
        delivery_contact_id: 1, delivery_fee_usd: 1.5, delivery_actual_cost_usd: 1,
        client_request_id: 'orphan-delivery-1', expected_exchange_rate: 4100,
        expected_updated_at: row.updated_at ?? null,
      }, 'POST /api/sales/:id/amendments (delivery_added)')
      assert.equal((await one(`SELECT delivery_contact_id AS c FROM sales WHERE id=${state.saleA}`)).c, 1)
    })

    step('amendment: line removed', async (state) => {
      // The orphan-prone direction: a PARENT sale_item disappears while its
      // batch allocations, amendment ledger rows and write revisions remain.
      const victim = await one(`SELECT id, quantity FROM sale_items WHERE sale_id=${state.saleA} ORDER BY id DESC LIMIT 1`)
      const row = await one(`SELECT updated_at FROM sales WHERE id=${state.saleA}`)
      assert.ok((await one(`SELECT COUNT(*) AS n FROM sale_item_batch_allocations WHERE sale_item_id=${Number(victim.id)}`)).n > 0,
        'the line about to be removed owns no batch allocations, so this step would not exercise child cleanup at all')
      await priceThenPost(`/api/sales/${state.saleA}/amendments`, {
        kind: 'line_removed', money_precision_version: 1,
        sale_item_id: Number(victim.id), quantity: Number(victim.quantity),
        client_request_id: 'orphan-line-removed-1', expected_exchange_rate: 4100,
        expected_updated_at: row.updated_at ?? null,
      }, 'POST /api/sales/:id/amendments (line_removed)')
      assert.equal((await one(`SELECT COUNT(*) AS n FROM sale_items WHERE id=${Number(victim.id)}`)).n, 0,
        'the removed line is still on the sale')
      assert.ok((await one(`SELECT COUNT(*) AS n FROM sale_amendments WHERE sale_id=${state.saleA}`)).n > 0,
        'a line was removed without an amendment ledger row')
      // THE EXEMPTION, PROVEN HERE. This write is what makes
      // sale_amendments.sale_item_id dangle: the line is deleted and the ledger
      // keeps its id so the sale can still show what came off. That is the
      // documented design (lib/saleAmendments.ts, kind 'line_removed'), which is
      // why HISTORICAL_REFERENCE excludes the column -- and this assertion is
      // where that decision has to be revisited if the ledger ever starts
      // nulling the id or the line stops being deleted.
      const ledger = await one(`SELECT kind, sale_item_id AS item, product_id AS product, quantity_before AS before_qty
        FROM sale_amendments WHERE sale_id=${state.saleA} ORDER BY id DESC LIMIT 1`)
      assert.equal(ledger.kind, 'line_removed')
      assert.equal(Number(ledger.item), Number(victim.id), 'the ledger did not keep the removed line id')
      assert.ok(Number(ledger.product) > 0 && Number(ledger.before_qty) > 0,
        'the ledger row carries no product or quantity of its own, so the dangling id is the only trace')
    })

    step('sale cancel', async (state) => {
      const row = await one(`SELECT updated_at FROM sales WHERE id=${state.saleB}`)
      ok(await call(`/api/sales/${state.saleB}/status`, {
        sale_status: 'cancelled', cancel_reason: 'mistake', cancel_note: 'orphan audit',
        expected_updated_at: row.updated_at, client_request_id: 'orphan-cancel-1',
      }, 'PATCH'), 'PATCH /api/sales/:id/status')
      assert.equal((await one(`SELECT sale_status AS s FROM sales WHERE id=${state.saleB}`)).s, 'cancelled')
    })

    step('customer return: quote then create', async (state) => {
      // The return kernel is v1-only, so the sale under return carries the real
      // captured-pricing snapshot the POS writes (seeded above).
      // test-customer-return-create-d1-native.cjs builds the same shape.
      // The sale it returns is seeded above, before any writer runs.
      const quote = ok(await call('/api/returns/quote', { sale_id: 900, items: [{ sale_item_id: 900, quantity: 1 }] }), 'POST /api/returns/quote')
      const { customer_return_create_version: _c, customer_return_edit_version: _e, ...expectedQuote } = quote
      const created = ok(await call('/api/returns', {
        client_request_id: 'orphan-return-1', money_precision_version: 1, sale_id: 900,
        reason: 'Orphan audit return', expected_quote: expectedQuote,
        items: [{ sale_item_id: 900, product_id: 1, quantity: 1, stock_action: 'restock', branch_id: 1, cost_price_usd: 4, cost_price_khr: 16400 }],
      }), 'POST /api/returns')
      state.returnId = Number(created.id || created.return_id || (await one('SELECT MAX(id) AS id FROM returns')).id)
      assert.ok(state.returnId > 0, `no return id in ${JSON.stringify(created).slice(0, 200)}`)
      assert.equal((await one(`SELECT COUNT(*) AS n FROM return_items WHERE return_id=${state.returnId}`)).n, 1)
    })

    step('return bulk cancel', async (state) => {
      // The returns header spells its lifecycle column "status" ("sale_status"
      // belongs to sales), and the guard compares the row's METHOD as well --
      // return_type, defaulted to 'manual' -- so both have to be read, not guessed.
      const row = await one(`SELECT status, return_type, updated_at FROM returns WHERE id=${state.returnId}`)
      ok(await call('/api/returns/bulk', {
        client_request_id: 'orphan-bulk-cancel-1', field: 'status', source: row.status, target: 'cancelled',
        items: [{ id: state.returnId, expected_status: row.status, expected_method: row.return_type || 'manual',
          expected_updated_at: row.updated_at ?? null }],
      }), 'POST /api/returns/bulk (cancel)')
      assert.equal((await one(`SELECT status FROM returns WHERE id=${state.returnId}`)).status, 'cancelled')
    })

    step('return bulk restore', async (state) => {
      const row = await one(`SELECT status, return_type, updated_at FROM returns WHERE id=${state.returnId}`)
      // Guard the guard: if the cancel above had quietly become a no-op this
      // step would "pass" while changing nothing.
      assert.equal(row.status, 'cancelled', 'the return was never cancelled, so restoring it proves nothing')
      ok(await call('/api/returns/bulk', {
        client_request_id: 'orphan-bulk-restore-1', field: 'status', source: 'cancelled', target: 'completed',
        items: [{ id: state.returnId, expected_status: 'cancelled', expected_method: row.return_type || 'manual',
          expected_updated_at: row.updated_at ?? null }],
      }), 'POST /api/returns/bulk (restore)')
      assert.equal((await one(`SELECT status FROM returns WHERE id=${state.returnId}`)).status, 'completed')
    })

    step('contact merge moves the receivable with the sale', async () => {
      // Owner rule: a merge MOVES every linked record. Customer 2 owns both a
      // sale and a receivable; after the merge neither may still point at it.
      ok(await call('/api/customers/merge', { keepId: 1, mergeId: 2 }), 'POST /api/customers/merge')
      assert.equal((await one('SELECT COUNT(*) AS n FROM sales WHERE customer_id=2')).n, 0, 'a sale was left on the merged-away customer')
      assert.equal((await one('SELECT COUNT(*) AS n FROM customer_receivables WHERE customer_id=2')).n, 0,
        'the receivables ledger did not move with the sales')
      assert.equal((await one('SELECT COUNT(*) AS n FROM customer_receivables WHERE customer_id=1')).n, 1)
    })

    step('product merge', async () => {
      ok(await call('/api/products/possible-duplicates/merge', { keepId: 2, mergeId: 3, stock: 'merge' }),
        'POST /api/products/possible-duplicates/merge')
      assert.equal((await one('SELECT is_active AS a FROM products WHERE id=3')).a, 0, 'the discarded product is still active')
    })

    step('action-history undo then redo of the merge', async () => {
      const row = await one("SELECT id FROM action_history WHERE reversible=1 AND status='undoable' ORDER BY id DESC LIMIT 1")
      assert.ok(row && row.id, 'no reversible action-history row was recorded by the writers above')
      ok(await call(`/api/action-history/${row.id}/undo`, { require_applied: true }), 'POST /api/action-history/:id/undo')
      ok(await call(`/api/action-history/${row.id}/redo`, { require_applied: true }), 'POST /api/action-history/:id/redo')
    })

    const state = {}
    for (const entry of steps) {
      let stepError = null
      try { await entry.run(state) } catch (error) { stepError = error }
      report(`writer: ${entry.name}`, stepError)
      let auditError = null
      try {
        const findings = await auditOrphans(db, schema.relations)
        assert.deepEqual(findings, [], `orphan records after "${entry.name}":\n${findings.join('\n')}`)
      } catch (error) { auditError = error }
      report(`no orphan records after: ${entry.name}`, auditError)
    }

    // -- the instrument's positive controls -------------------------------
    // A sweep that answers "clean" for every input is indistinguishable from a
    // sweep that cannot see, so the instrument proves itself on this tree, in
    // this run, immediately after the runs it just certified.
    try {
      await db.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(99999,88888,1,'Deliberate orphan',1,1)").run()
      const findings = await auditOrphans(db, schema.relations)
      // TWO findings, not one. Migration 0120's trg_sale_items_ai fires on the
      // insert and stamps a sale_write_revisions row for sale 88888, so writing
      // one orphan child mints a second one in a different table. That is a real
      // property of this schema and the reason the audit is mechanical: a
      // hand-written list of "the tables that matter" would have missed it.
      assert.deepEqual(findings, ['sale_items.sale_id -> sales: 1', 'sale_write_revisions.sale_id -> sales: 1'],
        `the sweep did not report a deliberately orphaned sale_item; it cannot be trusted for the runs above. Saw:\n${findings.join('\n')}`)
      await db.batch([
        db.prepare('DELETE FROM sale_items WHERE id=99999'),
        db.prepare('DELETE FROM sale_write_revisions WHERE sale_id=88888'),
      ])
      assert.deepEqual(await auditOrphans(db, schema.relations), [], 'the tree is not clean again after removing the deliberate orphan')
      report('positive control: the sweep reports a deliberately orphaned sale_item')
    } catch (error) { report('positive control: the sweep reports a deliberately orphaned sale_item', error) }

    try {
      await db.prepare("INSERT INTO customer_receivables(legacy_id,customer_id,customer_name,invoice_no,invoice_date,total_amount_usd,amount_paid_usd,outstanding_balance_usd,status,source_file,source_row) VALUES(770002,4242,'Ghost','INV-GHOST','2026-09-01',5,0,5,'open','orphan-audit-fixture',2)").run()
      const findings = await auditOrphans(db, schema.relations)
      assert.deepEqual(findings, ['customer_receivables.customer_id -> customers: 1'],
        'the sweep does not see an orphaned receivable -- the exact split a repair that forgets the ledger creates')
      await db.prepare("DELETE FROM customer_receivables WHERE invoice_no='INV-GHOST'").run()
      assert.deepEqual(await auditOrphans(db, schema.relations), [], 'the tree is not clean again after removing the orphaned receivable')
      report('positive control: the sweep reports an orphaned receivable')
    } catch (error) { report('positive control: the sweep reports an orphaned receivable', error) }
  } finally {
    await mf.dispose()
  }
  console.log(`\n${failures ? `${failures} failing` : 'all checks passed'} (${Math.round((Date.now() - started) / 1000)}s, ${schema.relations.length} relations over ${schema.tables.length} tables)`)
  process.exitCode = failures ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
