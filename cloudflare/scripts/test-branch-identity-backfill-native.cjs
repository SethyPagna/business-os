// Companion for cloudflare/migrations/0229_branch_identity_backfill.sql
// (cutover lane LA, design G12-HISTORY-UNDO-DESIGN.md section 2).
//
// Real chain, real SQLite (node:sqlite at D1's limits: expression depth 100,
// 100 bound variables). The file is applied the way D1 applies a migration: in
// one transaction, rolled back whole on any error. Production shape: Warehouse
// is id 1 and Shop is id 2, every live migration through 0226 already applied,
// then 0229. Checks:
//   1. fresh database: the full chain changes nothing and leaves no helper table;
//   2. live-shaped data: exactly role + canonical_key move on ids 1 and 2, every
//      other column of every row of every table is byte-identical except the
//      0124 branch revision bumps, and the schema is unchanged;
//   3. re-apply: a second run changes nothing at all (revisions included);
//   4. behaviour parity: branchRole, the selling SQL guard and the canonical
//      identity resolve every row the same before and after;
//   5. parent admission (inspectBranchCutover) refuses before 0229, passes after;
//   6. canonical_key is immutable afterwards;
//   7. refusals abort the whole file with nothing applied;
//   8. Worker whitespace parity, inactive same-name rows, and a terminal
//      cutover with renamed branches (re-apply stays a no-op);
//   9. wrong implementations a reviewer could plausibly write each fail here:
//      name-keyed (no active / identity filter), SQLite's default trim, and
//      the design draft's "no cutover row at all" guard.
//
// Run (from cloudflare/): node scripts/test-branch-identity-backfill-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const MIGRATION = '0229_branch_identity_backfill.sql'
const migrationsDir = path.join(root, 'migrations')
const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const chainText = (file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8')
const backfillSql = chainText(MIGRATION)

function modules() {
  const cache = new Map()
  function load(name) {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    const source = fs.readFileSync(path.join(root, 'src', name), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)((request) => {
      if (request === './importMaintenanceFence') return new Proxy({}, { get() { throw Error('Unexpected maintenance dependency execution') } })
      assert.ok(request.startsWith('.'), request)
      return load(path.posix.join(path.posix.dirname(name), request))
    }, module, module.exports)
    return module.exports
  }
  return load
}
const load = modules()
const { branchRole, branchRoleFromName } = load('lib/branchRoles')
const { sellingBranchConditionSql } = load('lib/branchRoleGuards')
const { canonicalBranchIdentityOf } = load('lib/canonicalBranchIdentity')

function open() {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.limits.variableNumber = 100
  return raw
}
// D1 runs each migration file inside one transaction.
function applyAtomic(raw, sql) {
  raw.exec('BEGIN')
  try { raw.exec(sql); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
}
const before = (raw) => { for (const file of chain.filter((f) => f < MIGRATION)) raw.exec(chainText(file)) }
const after = (raw) => { for (const file of chain.filter((f) => f > MIGRATION)) applyAtomic(raw, chainText(file)) }

const LIVE_BRANCHES = [
  [1, 'Warehouse', 'Toul Kork, Phnom Penh', '012 345 678', 'Dara', 'ឃ្លាំងស្តុកទំនិញ', 0, 1, '2025-11-02 09:15:00', '2026-09-30 18:02:11'],
  [2, 'Shop', 'Street 271, Phnom Penh', '098 765 432', 'Sreyneang', 'ហាងលក់រាយ', 1, 1, '2025-11-02 09:15:00', null],
]
function seedBranches(raw, rows = LIVE_BRANCHES) {
  const insert = raw.prepare(`INSERT INTO branches(id,name,location,phone,manager,notes,is_default,is_active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  for (const row of rows) insert.run(...row)
}
// Rows in every table that references a branch and could be disturbed.
function seedHistory(raw) {
  raw.exec(`
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true,"backup_restore":true}',1);
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(11,'Rose Serum 30ml','8850000000011',4.25,9,1),(12,'Lip Tint ១២','8850000000012',1.5,3,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,4),(11,2,5),(12,2,3);
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,received_quantity,received_branch_id) VALUES(101,11,'09202026','2026-09-20',4.25,9,2),(102,12,'09212026','2026-09-21',1.5,3,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,1,4),(101,2,5),(102,2,3);
    INSERT INTO sales(id,receipt_number,branch_id,branch_name,total_usd,subtotal_usd,sale_status,created_at) VALUES(501,'R-20261005-0001',2,'Shop',12,12,'completed','2026-10-05 10:00:00');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,cost_price_usd,total_usd,branch_id,batch_id) VALUES(601,501,11,'Rose Serum 30ml',1,12,4.25,12,2,101);
    INSERT INTO inventory_movements(id,product_id,branch_id,branch_name,movement_type,quantity,reference_id,batch_id,created_at) VALUES(701,11,2,'Shop','sale',-1,501,101,'2026-10-05 10:00:00'),(702,12,1,'','stock_in',3,NULL,102,'2026-09-21 08:00:00');
    INSERT INTO stock_transfers(id,product_id,product_name,from_branch_id,to_branch_id,from_branch_name,to_branch_name,quantity,created_at) VALUES(801,11,'Rose Serum 30ml',1,2,'Warehouse','Shop',2,'2026-09-25 09:00:00');
    INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,total_refund_usd,created_at) VALUES(901,'RT-0001',501,2,'Shop',0,'2026-10-05 11:00:00');
    INSERT INTO fees(fee_type,amount_usd,fee_date,sale_id,branch_id) VALUES('delivery',1.5,'2026-10-05',501,2);
  `)
}

function completeState(raw) {
  const quote = (name) => `"${name.replaceAll('"', '""')}"`
  const schema = raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
  const tables = {}
  for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const columns = raw.prepare(`PRAGMA table_info(${quote(name)})`).all().map((c) => c.name)
    if (!columns.length) continue
    const fields = columns.map((c) => `quote(${quote(c)}) AS ${quote(c)}`)
    tables[name] = raw.prepare(`SELECT ${fields.join(',')} FROM ${quote(name)}`).all()
      .map((row) => JSON.stringify(Object.entries(row))).sort()
  }
  return { schema: JSON.stringify(schema), tables }
}
// Every difference between two complete states, as table -> {removed, added}.
function diff(a, b) {
  assert.equal(b.schema, a.schema, 'schema unchanged')
  const out = {}
  for (const table of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) {
    const left = new Set(a.tables[table] || []), right = new Set(b.tables[table] || [])
    const removed = [...left].filter((r) => !right.has(r)), added = [...right].filter((r) => !left.has(r))
    if (removed.length || added.length) out[table] = { removed: removed.map((r) => Object.fromEntries(JSON.parse(r))), added: added.map((r) => Object.fromEntries(JSON.parse(r))) }
  }
  return out
}
const branchRows = (raw) => raw.prepare('SELECT * FROM branches ORDER BY id').all().map((r) => ({ ...r }))
const identity = (raw) => raw.prepare('SELECT id, role, canonical_key, successor_branch_id FROM branches ORDER BY id').all().map((r) => ({ ...r }))
const helperObjects = (raw) => raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'branch_identity_%'").all().length

function liveWorld({ branches = LIVE_BRANCHES, history = true } = {}) {
  const raw = open()
  before(raw)
  seedBranches(raw, branches)
  if (history) seedHistory(raw)
  return raw
}
// A valid journal row (0224 initial-state rules), optionally moved to aborted.
function insertCutover(raw, { aborted = false } = {}) {
  const hex = 'a'.repeat(64), op = '00000000-0000-4000-8000-0000000000c1'
  raw.prepare(`INSERT INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,control_incarnation,maintenance_token,
    source_branch_id,target_branch_id,intent_json,intent_digest,source_preimage_json,target_preimage_json,maintenance_flag_json,
    capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
    VALUES(?,?,7,'1',?,?,2,1,'{}',?,'{"id":2}','{"id":1}','{}',?,?,?,'2026-10-06 21:00:00','2026-10-06 21:00:00')`)
    .run(op, 'cutover_request_01', '00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-0000000000aa', hex, hex, hex, hex)
  if (aborted) raw.prepare(`UPDATE branch_cutovers SET phase='aborted', revision=1, terminal_json=json_object('version',1,'operationId',operation_id,'kind','aborted')`).run()
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.log(`FAIL ${name} - ${error.stack}`) }
}

async function main() {
  await check('text: LF only, no transaction control, sorts after 0223-0226 and before 0236', () => {
    assert.ok(!backfillSql.includes('\r'), 'LF only')
    assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK)\b[^\n]*;/im.test(backfillSql.replace(/--[^\n]*/g, '')), 'no transaction statements')
    const index = chain.indexOf(MIGRATION)
    assert.ok(index > chain.indexOf('0226_branch_history_labels.sql') && index > chain.indexOf('0224_branch_cutover_journal.sql'), 'needs 0223 columns and the 0224 journal')
    assert.ok(!/CREATE\s+(TRIGGER|INDEX|VIEW)/i.test(backfillSql.replace(/--[^\n]*/g, '')), 'no trigger, index or view')
    assert.ok(!/\bbranch_id\b/.test(backfillSql.replace(/--[^\n]*/g, '')), 'helper columns never named branch_id (cutover schema probe)')
  })

  await check('fresh database: the whole chain applies, no branch row, no helper table left', () => {
    const raw = open()
    for (const file of chain) applyAtomic(raw, chainText(file))
    assert.equal(raw.prepare('SELECT COUNT(*) n FROM branches').get().n, 0)
    assert.equal(helperObjects(raw), 0)
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    const state = completeState(raw)
    applyAtomic(raw, backfillSql)
    assert.deepEqual(diff(state, completeState(raw)), {}, 'second apply on a fresh database changes nothing')
    raw.close()
  })

  await check('live shape: only role + canonical_key on ids 1/2 and the 0124 branch revisions move; re-apply changes nothing', () => {
    const raw = liveWorld()
    const preBranches = branchRows(raw)
    assert.deepEqual(identity(raw), [{ id: 1, role: null, canonical_key: null, successor_branch_id: null }, { id: 2, role: null, canonical_key: null, successor_branch_id: null }])
    const s0 = completeState(raw)
    applyAtomic(raw, backfillSql)
    assert.deepEqual(identity(raw), [
      { id: 1, role: 'warehouse', canonical_key: 'warehouse', successor_branch_id: null },
      { id: 2, role: 'shop', canonical_key: 'shop', successor_branch_id: null },
    ])
    const postBranches = branchRows(raw)
    for (const [i, row] of preBranches.entries()) {
      for (const key of Object.keys(row)) {
        if (key === 'role' || key === 'canonical_key') continue
        assert.ok(Object.is(postBranches[i][key], row[key]), `branch ${row.id}.${key} byte-identical`)
      }
    }
    const s1 = completeState(raw)
    const changed = diff(s0, s1)
    assert.deepEqual(Object.keys(changed).sort(), ['branches', 'stock_session_revisions'], 'no other table changes')
    const revisions = Object.fromEntries(raw.prepare("SELECT entity_type||':'||entity_key k, revision FROM stock_session_revisions WHERE entity_type IN ('branch','branch_catalog')").all().map((r) => [r.k, r.revision]))
    const priorRevisions = Object.fromEntries(changed.stock_session_revisions.removed.map((r) => [`${r.entity_type.slice(1, -1)}:${r.entity_key.slice(1, -1)}`, Number(r.revision)]))
    assert.equal(revisions['branch:1'], priorRevisions['branch:1'] + 1, 'branch 1 revision bumped once')
    assert.equal(revisions['branch:2'], priorRevisions['branch:2'] + 1, 'branch 2 revision bumped once')
    assert.equal(revisions['branch_catalog:all'], priorRevisions['branch_catalog:all'] + 2, 'catalog revision bumped once per changed row')
    assert.equal(helperObjects(raw), 0, 'helper tables dropped')
    applyAtomic(raw, backfillSql)
    assert.deepEqual(diff(s1, completeState(raw)), {}, 're-apply: nothing changes, revisions included')
    after(raw)
    assert.deepEqual(identity(raw).map((r) => r.canonical_key), ['warehouse', 'shop'], 'later files keep the identity')
    raw.close()
  })

  await check('behaviour parity: branchRole, the selling SQL guard and the canonical identity agree before and after', () => {
    const extra = [[3, 'shop', 'Old kiosk', null, null, null, 0, 0, '2025-01-01 00:00:00', null], [4, 'Pop-up Stall', null, null, null, null, 0, 1, '2025-02-01 00:00:00', null]]
    const raw = liveWorld({ branches: [...LIVE_BRANCHES, ...extra], history: false })
    const view = () => raw.prepare(`SELECT b.*, CASE WHEN ${sellingBranchConditionSql('b')} THEN 1 ELSE 0 END AS can_sell FROM branches b ORDER BY id`).all()
      .map((row) => ({ id: row.id, role: branchRole(row), canSell: row.can_sell, identity: canonicalBranchIdentityOf(row) }))
    const pre = view()
    applyAtomic(raw, backfillSql)
    assert.deepEqual(view(), pre)
    assert.deepEqual(pre.map((r) => r.canSell), [0, 1, 0, 0], 'only the active Shop sells')
    assert.deepEqual(identity(raw).map((r) => r.canonical_key), ['warehouse', 'shop', null, null], 'inactive same-name and other rows are not keyed')
    raw.close()
  })

  await check('parent admission: inspectBranchCutover refuses before 0229 and passes after (T2.4)', async () => {
    const parent = load('lib/branchCutoverParent')
    const { D1Compat } = load('lib/db')
    const raw = liveWorld()
    raw.exec("INSERT INTO system_flags(key,value) VALUES('branch_cutover_control_incarnation','00000000-0000-4000-8000-000000000099')")
    raw.limits.functionArg = 100
    const prepared = (sql, values = []) => {
      const execute = () => {
        const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values
        const statement = raw.prepare(sql)
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
        const r = statement.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
      }
      return { bind: (...v) => prepared(sql, v), execute, all: async () => execute() }
    }
    const db = new D1Compat({ prepare: prepared, batch: async () => { throw Error('inspect must not write') } })
    const actor = { id: 7, organization_id: 1, is_active: 1 }
    const budget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, retryQueries: 0, completionQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
    const ids = { sourceBranchId: 2, targetBranchId: 1 }
    await assert.rejects(parent.inspectBranchCutover(db, actor, 1, ids, budget), 'before 0229 the identity check refuses')
    applyAtomic(raw, backfillSql)
    after(raw)
    const plan = await parent.inspectBranchCutover(db, actor, 1, ids, budget)
    assert.equal(JSON.parse(plan.sourcePreimageJson).canonical_key, 'shop')
    assert.equal(JSON.parse(plan.targetPreimageJson).canonical_key, 'warehouse')
    raw.close()
  })

  await check('canonical_key is immutable after the backfill (T2.5)', () => {
    const raw = liveWorld({ history: false })
    applyAtomic(raw, backfillSql)
    assert.throws(() => raw.prepare("UPDATE branches SET canonical_key='warehouse' WHERE id=2").run(), /branch_canonical_key_immutable/)
    assert.throws(() => raw.prepare('UPDATE branches SET canonical_key=NULL WHERE id=1').run(), /branch_canonical_key_immutable/)
    raw.close()
  })

  await check("the header's recovery statements restore the pre-0229 branches and the 0223 trigger byte-identically", () => {
    const header = backfillSql.slice(0, backfillSql.indexOf('\nCREATE TABLE')).split('\n')
      .map((line) => line.replace(/^--\s?/, '')).join(' ').replace(/\s+/g, ' ')
    const recovery = [
      'UPDATE branches SET role = NULL WHERE id IN (1, 2) AND role IS canonical_key;',
      'DROP TRIGGER branches_canonical_key_immutable;',
      'UPDATE branches SET canonical_key = NULL, role = NULL WHERE id IN (1, 2);',
    ]
    for (const statement of recovery) assert.ok(header.includes(statement), `header states: ${statement}`)
    const trigger = /CREATE TRIGGER branches_canonical_key_immutable[\s\S]*?END;/.exec(chainText('0223_branch_lifecycle_identity.sql'))[0]
    const raw = liveWorld()
    const preBranches = branchRows(raw)
    const triggerSql = () => raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='branches_canonical_key_immutable'").get().sql
    const preTrigger = triggerSql()
    applyAtomic(raw, backfillSql)
    applyAtomic(raw, recovery[0])
    assert.deepEqual(identity(raw).map((r) => [r.role, r.canonical_key]), [[null, 'warehouse'], [null, 'shop']], 'role alone recovers')
    applyAtomic(raw, [recovery[1], recovery[2], trigger].join('\n'))
    assert.deepEqual(branchRows(raw), preBranches, 'every branches column back to the pre-0229 values')
    assert.equal(triggerSql(), preTrigger, 'immutability trigger recreated byte-identically')
    applyAtomic(raw, backfillSql)
    assert.deepEqual(identity(raw).map((r) => r.canonical_key), ['warehouse', 'shop'], 'and the backfill can run again after recovery')
    raw.close()
  })

  await check('refusals abort the whole file and leave every row unchanged', () => {
    const cases = [
      ['two active branches named Shop', { branches: [...LIVE_BRANCHES, [3, ' SHOP ', null, null, null, null, 0, 1, '2025-03-01 00:00:00', null]] }, null],
      ['a half-set identity (role without canonical_key)', {}, (raw) => raw.exec("UPDATE branches SET role='shop' WHERE id=2")],
      ['a half-set identity on a row the backfill never keys', { branches: [...LIVE_BRANCHES, [3, 'Kiosk', null, null, null, null, 0, 0, '2025-03-01 00:00:00', null]] },
        (raw) => raw.exec("UPDATE branches SET role='warehouse' WHERE id=3")],
      ['an identity that is not this backfill, before any cutover', { branches: [...LIVE_BRANCHES, [3, 'Legacy store', null, null, null, null, 0, 0, '2025-03-01 00:00:00', null]] },
        (raw) => raw.exec("UPDATE branches SET role='warehouse', canonical_key='warehouse' WHERE id=3")],
      ['a successor before any cutover', { branches: [...LIVE_BRANCHES, [3, 'Kiosk', null, null, null, null, 0, 0, '2025-03-01 00:00:00', null]] },
        (raw) => raw.exec('UPDATE branches SET successor_branch_id=2 WHERE id=3')],
      ['an unknown is_active on a Shop-named row', {}, (raw) => raw.exec('UPDATE branches SET is_active=NULL WHERE id=2')],
      ['an unfinished cutover journal', {}, (raw) => insertCutover(raw)],
    ]
    for (const [name, options, mutate] of cases) {
      const raw = liveWorld(options)
      if (mutate) mutate(raw)
      const state = completeState(raw)
      assert.throws(() => applyAtomic(raw, backfillSql), /CHECK constraint failed/, name)
      assert.deepEqual(diff(state, completeState(raw)), {}, `${name}: nothing applied`)
      assert.equal(helperObjects(raw), 0, `${name}: no helper table left`)
      raw.close()
    }
  })

  await check("names are matched with the Worker's whitespace set and case rule; stored names never change", () => {
    const names = [[1, ' WAREHOUSE\t', 1], [2, 'Shop　', 1]]
    const raw = liveWorld({ branches: names.map(([id, name, active]) => [id, name, null, null, null, null, id === 2 ? 1 : 0, active, '2025-11-02 09:15:00', null]), history: false })
    for (const [, name] of names) assert.notEqual(branchRoleFromName(name), 'other', 'fixture: the Worker resolves these names')
    applyAtomic(raw, backfillSql)
    assert.deepEqual(identity(raw).map((r) => r.canonical_key), ['warehouse', 'shop'])
    assert.deepEqual(branchRows(raw).map((r) => r.name), names.map(([, name]) => name), 'names byte-identical')
    raw.close()
  })

  await check('terminal cutover with renamed branches: re-apply is a no-op, identity keyed on canonical_key not the new names', () => {
    const raw = liveWorld()
    applyAtomic(raw, backfillSql)
    insertCutover(raw, { aborted: true })
    // The finalize shape (readiness P9): Old Shop retired with a successor, LC Store the selling default.
    raw.exec(`UPDATE branches SET is_default=0 WHERE id=2;
      UPDATE branches SET name='Old Shop', is_active=0, successor_branch_id=1 WHERE id=2;
      UPDATE branches SET name='LC Store', role='shop', is_default=1 WHERE id=1;
      INSERT INTO branches(id,name,is_active,is_default,created_at) VALUES(3,'Shop',1,0,'2026-11-01 09:00:00');`)
    const state = completeState(raw)
    applyAtomic(raw, backfillSql)
    assert.deepEqual(diff(state, completeState(raw)), {}, 'nothing changes')
    assert.deepEqual(identity(raw), [
      { id: 1, role: 'shop', canonical_key: 'warehouse', successor_branch_id: null },
      { id: 2, role: 'shop', canonical_key: 'shop', successor_branch_id: 1 },
      { id: 3, role: null, canonical_key: null, successor_branch_id: null },
    ])
    raw.close()
  })

  await check('discriminating controls: plausible wrong implementations fail where 0229 passes', () => {
    const replace = (from, to) => { const out = backfillSql.split(from).join(to); assert.notEqual(out, backfillSql, `control rewrite applies: ${from.slice(0, 40)}`); return out }
    const updates = backfillSql.slice(backfillSql.indexOf("UPDATE branches SET role = 'shop'"), backfillSql.indexOf("INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'post_rows"))
    const nameKeyed = replace(updates, "UPDATE branches SET role = lower(trim(name)), canonical_key = lower(trim(name)) WHERE lower(trim(name)) IN ('shop', 'warehouse');\n\n")
    const defaultTrim = replace(/lower\(trim\(name, char\([^)]*\)\)\)/.exec(backfillSql)[0], 'lower(trim(name))')
    const draftGuard = replace("NOT EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed', 'aborted'))", 'NOT EXISTS (SELECT 1 FROM branch_cutovers)')

    // (a) A deactivated legacy row also named Shop: name keying claims it too.
    const legacy = () => liveWorld({ branches: [...LIVE_BRANCHES, [3, 'Shop', null, null, null, null, 0, 0, '2024-01-01 00:00:00', null]], history: false })
    let raw = legacy(); applyAtomic(raw, backfillSql)
    assert.deepEqual(identity(raw).map((r) => r.canonical_key), ['warehouse', 'shop', null], '0229 keys only the active Shop'); raw.close()
    raw = legacy(); assert.throws(() => applyAtomic(raw, nameKeyed), /UNIQUE constraint failed|CHECK constraint failed/, 'name-keyed backfill refuses (or would mis-key) the live shape'); raw.close()

    // (b) A name the Worker resolves only with its wider whitespace set.
    const spaced = () => liveWorld({ branches: [LIVE_BRANCHES[0], [2, 'Shop ', null, null, null, null, 1, 1, '2025-11-02 09:15:00', null]], history: false })
    raw = spaced(); applyAtomic(raw, defaultTrim)
    const wrong = identity(raw).find((r) => r.id === 2)
    assert.notEqual(wrong.canonical_key, branchRoleFromName('Shop '), "SQLite's default trim leaves the Worker's Shop without its identity"); raw.close()
    raw = spaced(); applyAtomic(raw, backfillSql)
    assert.equal(identity(raw).find((r) => r.id === 2).canonical_key, 'shop'); raw.close()

    // (c) Re-apply after a terminal cutover: the draft's "no cutover row at all" guard is not idempotent.
    const terminal = () => { const w = liveWorld({ history: false }); applyAtomic(w, backfillSql); insertCutover(w, { aborted: true }); return w }
    raw = terminal(); assert.throws(() => applyAtomic(raw, draftGuard), /CHECK constraint failed/, 'draft guard refuses a database that already has the data'); raw.close()
    raw = terminal(); applyAtomic(raw, backfillSql); raw.close()
  })

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED: ${failures.join('; ')}` : ''}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
