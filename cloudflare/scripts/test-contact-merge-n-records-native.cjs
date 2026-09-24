// R11 (Resolve grid): the real POST {path}/merge route, the real merge
// planner and duplicate finder, the full migration chain in SQLite and the
// transactional d1compat.batch. All data is synthetic.
//
//   T24  owner ruling 24 Sep: only a CURRENT system-detected duplicate
//        cluster merges. A hand-picked set is 409 even with the old
//        `manual: true`, a cluster that changed or was kept as separate is
//        409, a detected cluster applies with 200, and contacts:resolve_conflicts
//        switched off is 403 (the Duplicates tab's own gate)
//   T25  the chosen membership number is kept and every other number goes to
//        the notes; a missing membership decision returns 400
//   T26  the chosen storefront account moves to the kept record and every
//        other account is unlinked (contact_id NULL); a missing decision is 400
//   T27  a record changed since the grid read it returns 409 naming it, and a
//        change racing the write fails the in-batch guard with nothing written
// plus: the old { keepId, mergeId } body keeps its exact behaviour, every table
// that references a contact is re-pointed for three records of each kind, and
// the Cloudflare free plan merges six records in steps inside its query budget
// while the paid plan merges them in one batch -- both ending in the same state.
//
// Run (from cloudflare/scripts): node test-contact-merge-n-records-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '../src')
function inert() { return new Proxy(function () {}, { get: () => inert(), apply: () => undefined }) }
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : original(request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('require', 'module', 'exports', '__filename', '__dirname', code)(require, mod, mod.exports, full, path.dirname(full)) } finally { Module._load = original }
  return mod.exports
}

const permissions = load('lib/permissions.ts')
const contactOptions = load('lib/contactOptions.ts')
const phone = load('lib/phone.ts')
const sqlBinding = load('lib/sqlBinding.ts')
const contactMerge = load('lib/contactMerge.ts', { './contactOptions': contactOptions, './phone': phone })
const planTier = load('lib/planTier.ts')

// One Worker app for the whole run; each fixture swaps in a fresh database.
const ADMIN = { id: 7, username: 'admin', name: 'Fixture Admin', permissions: '{}' }
const state = { db: null, batches: [], broadcasts: [], hook: null, lost: false, user: ADMIN }
const contacts = load('routes/contacts.ts', {
  '../lib/db': { getDb: () => state.db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
  '../lib/permissions': permissions,
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
  '../lib/acquisitionCostAccess': load('lib/acquisitionCostAccess.ts', { './permissions': permissions }),
  '../lib/contactDuplicates': load('lib/contactDuplicates.ts', { './contactOptions': contactOptions, './phone': phone, './sqlBinding': sqlBinding }),
  '../lib/contactOptions': contactOptions,
  '../lib/phone': phone,
  '../lib/sqlBinding': sqlBinding,
  '../lib/contactMerge': contactMerge,
  '../lib/planTier': planTier,
  '../lib/conflictControl': load('lib/conflictControl.ts'),
  '../lib/anonymousCustomer': load('lib/anonymousCustomer.ts'),
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async (_env, channel, message) => { state.broadcasts.push({ channel, message }) } },
}).default
const app = new Hono()
app.route('/api', contacts)

function fresh(seed) {
  const native = openDb(loadAll())
  native.db.exec(seed)
  Object.assign(state, { batches: [], broadcasts: [], hook: null, lost: false, user: ADMIN })
  state.db = {
    prepare: (sql) => native.prepare(sql),
    async batch(statements) {
      if (state.hook) { const run = state.hook; state.hook = null; run(native.db) }
      state.batches.push(statements.length)
      const result = await native.batch(statements)
      if (state.lost) { state.lost = false; throw new Error('Synthetic lost response after commit') }
      return result
    },
  }
  return native.db
}

async function post(url, body, tier = 'paid') {
  // The tier is cached per isolate; a test serving both plans resets it.
  planTier.__resetPlanTierCacheForTests()
  const env = tier === 'free' ? { PLAN_TIER: 'free' } : {}
  const res = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env, { waitUntil: () => {} })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { throw new Error(`POST ${url} ${res.status}: ${text}`) }
}

const rows = (raw, sql, ...params) => raw.prepare(sql).all(...params).map((row) => ({ ...row }))
const one = (raw, sql, ...params) => { const row = raw.prepare(sql).get(...params); return row ? { ...row } : row }
const expectedFor = (raw, table, ids) => ids.map((id) => ({ id, updated_at: one(raw, `SELECT updated_at FROM ${table} WHERE id = ?`, id).updated_at }))
const CUSTOMER_TABLES = ['customers', 'sales', 'returns', 'customer_share_submissions', 'loyalty_point_adjustments', 'portal_accounts', 'customer_receivables', 'audit_logs']
const dump = (raw, tables = CUSTOMER_TABLES) => JSON.stringify(tables.map((table) => rows(raw, `SELECT * FROM ${table} ORDER BY id`)))

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`  ${String(error && error.stack || error).split('\n').slice(0, 24).join('\n  ')}`)
  }
}

// Three customers the system detects as one person (a shared phone under
// three different names: a phone_conflict cluster), each
// holding links in every table that references a customer, plus a bystander.
const CUSTOMER_SEED = `
  INSERT INTO customers(id,name,phone,phone_normalized,email,address,notes,membership_number,gender,is_anonymous,updated_at) VALUES
    (1,'Dara','012 111 111','012111111',NULL,NULL,'Keeper notes','LC-00001',NULL,0,'2026-09-01 10:00:00'),
    (2,'Dara Sok','012 111 111','012111111','dara@example.invalid',NULL,NULL,'LC-00002','male',0,'2026-09-02 10:00:00'),
    (3,'Sok Dara','012 111 111','012111111',NULL,'Street 3',NULL,NULL,NULL,0,'2026-09-03 10:00:00'),
    (4,'Bystander','012 444 444','012444444',NULL,NULL,NULL,'LC-00004',NULL,0,'2026-09-04 10:00:00');
  INSERT INTO sales(id,receipt_number,customer_id,customer_name,customer_phone) VALUES
    (11,'R-11',2,'Dara Sok','012 222 222'),(12,'R-12',3,'Sok Dara','012 333 333'),(13,'R-13',1,'Dara','012 111 111'),(14,'R-14',4,'Bystander','012 444 444');
  INSERT INTO returns(id,customer_id,customer_name,return_scope) VALUES (21,2,'Dara Sok','customer'),(22,3,'Sok Dara','customer');
  INSERT INTO customer_share_submissions(id,customer_id,customer_name) VALUES (31,3,'Sok Dara');
  INSERT INTO loyalty_point_adjustments(id,customer_id,points) VALUES (41,2,5),(42,3,7);
  INSERT INTO portal_accounts(id,membership_id,name,phone,password_hash,contact_id) VALUES
    (51,'LC-00002','Dara Sok','012222222','hash',2),(52,'P-3','Sok Dara','012333333','hash',3);
  INSERT INTO customer_receivables(id,legacy_id,customer_id,customer_name,invoice_date,status,source_file,source_row) VALUES
    (61,1,2,'Dara Sok','2026-01-01','outstanding','ar.csv',1),(62,2,NULL,'Sok Dara','2026-01-02','outstanding','ar.csv',2);
`

function gridBody(raw, extra = {}) {
  return {
    keepId: 1,
    mergeIds: [2, 3],
    client_request_id: 'r11-grid',
    expected: extra.expected || expectedFor(raw, 'customers', [1, 2, 3]),
    choices: { email: { source_id: 2 }, address: { source_id: 3 }, notes: { custom: 'Prefers Telegram' } },
    membership_source_id: 2,
    portal_keep_contact_id: 3,
    ...extra,
  }
}

async function main() {
  await check('T24: a hand-picked set is refused 409 even with manual:true; a detected cluster applies with 200', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    // The bystander shares neither the phone nor a name: not a detected cluster.
    const handPicked = await post('/api/customers/merge', gridBody(raw, { mergeIds: [2, 4], manual: true, choices: {}, portal_keep_contact_id: 2, expected: expectedFor(raw, 'customers', [1, 2, 4]) }))
    assert.equal(handPicked.status, 409, JSON.stringify(handPicked.body))
    assert.equal(handPicked.body.code, 'contact_merge_not_duplicates')
    assert.equal(dump(raw), before, 'a refused merge writes nothing')
    // A forged stepped-merge id without the first step's receipt is no key.
    const forged = await post('/api/customers/merge', gridBody(raw, { mergeIds: [2, 4], client_request_id: 'r11-grid:r1', choices: {}, portal_keep_contact_id: 2, expected: expectedFor(raw, 'customers', [1, 2, 4]) }))
    assert.equal(forged.status, 409, JSON.stringify(forged.body))
    assert.equal(forged.body.code, 'contact_merge_not_duplicates')
    assert.equal(dump(raw), before)
    const ruled = await post('/api/customers/merge', gridBody(raw))
    assert.equal(ruled.status, 200, JSON.stringify(ruled.body))
    assert.deepEqual(ruled.body.merged_ids, [2, 3])
    assert.equal(ruled.body.keeper.id, 1)
    assert.equal(ruled.body.continuation, undefined, 'the paid plan merges every record in one request')
    assert.deepEqual(state.batches.length, 1, 'one atomic batch')
    assert.deepEqual(state.broadcasts, [{ channel: 'customers', message: { action: 'merge', id: 1, mergedIds: [2, 3] } }])
  })

  await check('T24b: a cluster that changed since the review (a record left it) is refused 409', async () => {
    const raw = fresh(CUSTOMER_SEED)
    // Record 3 changes its phone: it no longer shares anything with 1 and 2.
    raw.prepare("UPDATE customers SET phone = '012 333 333', phone_normalized = '012333333' WHERE id = 3").run()
    const before = dump(raw)
    const changed = await post('/api/customers/merge', gridBody(raw))
    assert.equal(changed.status, 409, JSON.stringify(changed.body))
    assert.equal(changed.body.code, 'contact_merge_not_duplicates')
    assert.equal(dump(raw), before)
    // The part that IS still detected merges.
    const body = gridBody(raw, { mergeIds: [2], expected: expectedFor(raw, 'customers', [1, 2]), choices: { email: { source_id: 2 } } })
    delete body.portal_keep_contact_id
    const rest = await post('/api/customers/merge', body)
    assert.equal(rest.status, 200, JSON.stringify(rest.body))
    assert.deepEqual(rest.body.merged_ids, [2])
    assert.deepEqual(JSON.parse(one(raw, "SELECT details FROM audit_logs WHERE action = 'merge'").details).clusterIds, [1, 2], 'the audit row names the verified cluster')
  })

  await check('T24c: a cluster kept as separate (dismissed) is not an open duplicate and is refused 409', async () => {
    const raw = fresh(CUSTOMER_SEED)
    raw.prepare("INSERT INTO contact_duplicate_dismissals (contact_table, cluster_type, cluster_value) VALUES ('customers', 'phone', '012111111')").run()
    const before = dump(raw)
    const kept = await post('/api/customers/merge', gridBody(raw))
    assert.equal(kept.status, 409, JSON.stringify(kept.body))
    assert.equal(kept.body.code, 'contact_merge_not_duplicates')
    assert.equal(dump(raw), before)
  })

  await check('T24d: contacts:resolve_conflicts switched off is 403 before anything is read; merge and bulk still gate', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    const staff = (blocked) => ({ id: 8, username: 'staff', name: 'Staff', role: 'staff', permissions: JSON.stringify({ contacts: true,...Object.fromEntries(blocked.map((action) => [`contacts:${action}`, false])) }) })
    for (const blocked of [['resolve_conflicts'], ['merge'], ['bulk']]) {
      state.user = staff(blocked)
      const refused = await post('/api/customers/merge', gridBody(raw))
      assert.equal(refused.status, 403, `${blocked}: ${JSON.stringify(refused.body)}`)
      assert.equal(dump(raw), before)
    }
    state.user = staff([])
    const allowed = await post('/api/customers/merge', gridBody(raw))
    assert.equal(allowed.status, 200, `a full-access role with every action on merges: ${JSON.stringify(allowed.body)}`)
  })

  await check('T25: the chosen membership number survives, every other number goes to the notes; no decision is a 400', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    const body = gridBody(raw)
    delete body.membership_source_id
    const missing = await post('/api/customers/merge', body)
    assert.equal(missing.status, 400, JSON.stringify(missing.body))
    assert.equal(missing.body.code, 'membership_choice_required')
    assert.equal(dump(raw), before)
    const merged = await post('/api/customers/merge', gridBody(raw))
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    const keeper = one(raw, 'SELECT * FROM customers WHERE id = 1')
    assert.equal(keeper.membership_number, 'LC-00002', 'the chosen record supplies the number')
    assert.equal(keeper.notes, 'Prefers Telegram\nMerged membership: LC-00001', 'the typed notes, then the number that did not survive')
    assert.deepEqual(merged.body.after.membership_to_notes, ['LC-00001'])
  })

  await check('T26: the chosen storefront account moves to the kept record, the other is unlinked; no decision is a 400', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    const body = gridBody(raw)
    delete body.portal_keep_contact_id
    const missing = await post('/api/customers/merge', body)
    assert.equal(missing.status, 400, JSON.stringify(missing.body))
    assert.equal(missing.body.code, 'portal_choice_required')
    assert.deepEqual(missing.body.accounts.map((account) => [account.id, account.contact_id]), [[51, 2], [52, 3]])
    assert.equal(dump(raw), before)
    const merged = await post('/api/customers/merge', gridBody(raw))
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(rows(raw, 'SELECT id, contact_id FROM portal_accounts ORDER BY id'), [{ id: 51, contact_id: null }, { id: 52, contact_id: 1 }])
    assert.deepEqual(merged.body.before.portal_accounts.map((account) => [account.id, account.contact_id, account.name]), [[51, 2, 'Dara Sok'], [52, 3, 'Sok Dara']])
    assert.deepEqual(merged.body.after.portal_accounts.map((account) => [account.id, account.contact_id, account.name]), [[51, null, 'Dara Sok'], [52, 1, 'Sok Dara']], 'the response names the unlinked account')
  })

  await check('T27: a record changed since the grid read it is a 409 naming it; a racing change fails the in-batch guard', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    const body = gridBody(raw)
    body.expected = body.expected.map((entry) => entry.id === 3 ? { ...entry, updated_at: '2026-08-01 09:00:00' } : entry)
    const stale = await post('/api/customers/merge', body)
    assert.equal(stale.status, 409, JSON.stringify(stale.body))
    assert.equal(stale.body.code, 'contact_merge_conflict')
    assert.deepEqual(stale.body.stale, [{ id: 3, reason: 'updated', expected_updated_at: '2026-08-01 09:00:00', actual_updated_at: '2026-09-03 10:00:00' }])
    assert.equal(dump(raw), before)

    state.hook = (db) => db.prepare("UPDATE customers SET phone = '012 999 999' WHERE id = 3").run()
    const raced = await post('/api/customers/merge', gridBody(raw))
    assert.equal(raced.status, 409, JSON.stringify(raced.body))
    assert.equal(raced.body.code, 'contact_merge_conflict')
    assert.equal(one(raw, 'SELECT COUNT(*) AS n FROM customers WHERE id IN (2, 3)').n, 2, 'nothing merged')
    assert.equal(one(raw, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'merge'").n, 0)
    assert.equal(one(raw, 'SELECT customer_id FROM sales WHERE id = 11').customer_id, 2)

    raw.prepare('DELETE FROM customers WHERE id = 3').run()
    const gone = await post('/api/customers/merge', gridBody(raw, { expected: [{ id: 1, updated_at: '2026-09-01 10:00:00' }, { id: 2, updated_at: '2026-09-02 10:00:00' }, { id: 3, updated_at: '2026-09-03 10:00:00' }] }))
    assert.equal(gone.status, 409)
    assert.deepEqual(gone.body.stale, [{ id: 3, reason: 'deleted' }])
  })

  await check('three customers: every table that references a customer is re-pointed, with one audit row to recover by hand', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const body = gridBody(raw)
    const merged = await post('/api/customers/merge', body)
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(rows(raw, 'SELECT id FROM customers ORDER BY id').map((row) => row.id), [1, 4])
    const keeper = one(raw, 'SELECT name, phone, phone_normalized, email, address, gender FROM customers WHERE id = 1')
    assert.deepEqual(keeper, { name: 'Dara', phone: '012 111 111', phone_normalized: '012111111', email: 'dara@example.invalid', address: 'Street 3', gender: 'male' })
    assert.deepEqual(rows(raw, 'SELECT id, customer_id, customer_name, customer_phone, customer_address FROM sales ORDER BY id'), [
      { id: 11, customer_id: 1, customer_name: 'Dara', customer_phone: '012 111 111', customer_address: 'Street 3' },
      { id: 12, customer_id: 1, customer_name: 'Dara', customer_phone: '012 111 111', customer_address: 'Street 3' },
      { id: 13, customer_id: 1, customer_name: 'Dara', customer_phone: '012 111 111', customer_address: 'Street 3' },
      { id: 14, customer_id: 4, customer_name: 'Bystander', customer_phone: '012 444 444', customer_address: null },
    ])
    assert.deepEqual(rows(raw, 'SELECT id, customer_id, customer_name FROM returns ORDER BY id'), [{ id: 21, customer_id: 1, customer_name: 'Dara' }, { id: 22, customer_id: 1, customer_name: 'Dara' }])
    assert.deepEqual(rows(raw, 'SELECT customer_id, customer_name FROM customer_share_submissions'), [{ customer_id: 1, customer_name: 'Dara' }])
    assert.deepEqual(rows(raw, 'SELECT customer_id FROM loyalty_point_adjustments ORDER BY id').map((row) => row.customer_id), [1, 1])
    assert.deepEqual(rows(raw, 'SELECT id, customer_id, customer_name FROM customer_receivables ORDER BY id'), [{ id: 61, customer_id: 1, customer_name: 'Dara' }, { id: 62, customer_id: null, customer_name: 'Dara' }])
    const audits = rows(raw, "SELECT entity, entity_id, details, old_value, new_value FROM audit_logs WHERE action = 'merge'")
    assert.equal(audits.length, 1)
    const oldValue = JSON.parse(audits[0].old_value)
    assert.deepEqual(oldValue.members.map((member) => [member.id, member.name, member.membership_number]), [[2, 'Dara Sok', 'LC-00002'], [3, 'Sok Dara', null]])
    assert.deepEqual(oldValue.moved.sales, [[11, 2], [12, 3]])
    assert.deepEqual(oldValue.moved.returns, [[21, 2], [22, 3]])
    assert.deepEqual(oldValue.moved.customer_receivables_by_name, [[62, 'Sok Dara']])
    assert.equal(JSON.parse(audits[0].details).clientRequestId, 'r11-grid')
    assert.equal(merged.body.before.moved, undefined, 'the response carries the before-state, the audit row also the moved ids')

    const retried = await post('/api/customers/merge', body)
    assert.equal(retried.status, 200, `a retry of a committed merge answers from its audit row: ${JSON.stringify(retried.body)}`)
    assert.equal(retried.body.replayed, true)
    assert.deepEqual(retried.body.merged_ids, [2, 3])
    assert.equal(one(raw, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'merge'").n, 1)
  })

  await check('a response lost after commit is reconciled from the audit row for every merged record', async () => {
    const raw = fresh(CUSTOMER_SEED)
    state.lost = true
    const merged = await post('/api/customers/merge', gridBody(raw))
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(merged.body.merged_ids, [2, 3])
    assert.deepEqual(rows(raw, 'SELECT id FROM customers ORDER BY id').map((row) => row.id), [1, 4])
  })

  await check('request validation: ids, expected versions and choices are checked before anything is read', async () => {
    const raw = fresh(CUSTOMER_SEED)
    const before = dump(raw)
    const cases = [
      [{ keepId: 1, mergeIds: [] }, 'contact_merge_invalid_ids'],
      [{ keepId: 1, mergeIds: [1, 2] }, 'contact_merge_invalid_ids'],
      [{ keepId: 1, mergeIds: [2, 2] }, 'contact_merge_invalid_ids'],
      [{ keepId: 1, mergeIds: [2, 3, 4, 5, 6, 7] }, 'contact_merge_invalid_ids'],
      [{ ...gridBody(raw), expected: [{ id: 1, updated_at: null }] }, 'contact_merge_expected_required'],
      [{ ...gridBody(raw), choices: { phone: { source_id: 4 } } }, 'contact_merge_invalid_choice'],
      [{ ...gridBody(raw), choices: { membership_number: { source_id: 2 } } }, 'contact_merge_invalid_choice'],
      [{ ...gridBody(raw), choices: { created_at: { custom: '2020-01-01' } } }, 'contact_merge_invalid_choice'],
      [{ ...gridBody(raw), choices: { is_anonymous: { custom: '1' } } }, 'contact_merge_invalid_choice'],
      [{ ...gridBody(raw), membership_source_id: 4 }, 'contact_merge_invalid_choice'],
      [{ ...gridBody(raw), choices: { name: { custom: '   ' } } }, 'contact_merge_name_required'],
    ]
    for (const [body, code] of cases) {
      const response = await post('/api/customers/merge', body)
      assert.equal(response.status, 400, `${code}: ${JSON.stringify(response.body)}`)
      assert.equal(response.body.code, code)
    }
    assert.equal(dump(raw), before)
  })

  await check('the original { keepId, mergeId } body keeps its responses: 200 { contact }, 404, and the 409 blocks', async () => {
    const raw = fresh(`
      INSERT INTO customers(id,name,phone,phone_normalized,membership_number,is_anonymous,updated_at) VALUES
        (5,'Vanna','012 555 555','012555555',NULL,0,'2026-09-05 10:00:00'),
        (6,'Vanna',NULL,NULL,'LC-00006',0,'2026-09-06 10:00:00'),
        (7,'Vanna',NULL,NULL,'LC-00007',0,'2026-09-07 10:00:00'),
        (8,'Mealea','012 888 888','012888888',NULL,0,'2026-09-08 10:00:00'),
        (9,'Mealea',NULL,NULL,NULL,0,'2026-09-09 10:00:00'),
        (10,'Someone Else','012 101 010','012101010',NULL,0,'2026-09-10 10:00:00');
      INSERT INTO sales(id,receipt_number,customer_id,customer_name) VALUES (15,'R-15',6,'Vanna');
      INSERT INTO portal_accounts(id,membership_id,name,phone,password_hash,contact_id) VALUES
        (53,'P-8','Mealea','012888888','hash',8),(54,'P-9','Mealea','012999999','hash',9);
    `)
    const merged = await post('/api/customers/merge', { keepId: 5, mergeId: 6 })
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(Object.keys(merged.body).sort(), ['contact', 'operationId'])
    assert.equal(merged.body.contact.membership_number, 'LC-00006', 'a blank keeper field is filled from the merged record')
    assert.equal(one(raw, 'SELECT customer_id FROM sales WHERE id = 15').customer_id, 5)
    const lineage = await post('/api/customers/merge', { keepId: 5, mergeId: 7 })
    assert.equal(lineage.status, 409)
    assert.equal(lineage.body.code, 'membership_lineage_required')
    const collision = await post('/api/customers/merge', { keepId: 8, mergeId: 9 })
    assert.equal(collision.status, 409)
    assert.equal(collision.body.code, 'portal_account_collision')
    assert.deepEqual(collision.body.accounts, [{ id: 53, contact_id: 8 }, { id: 54, contact_id: 9 }])
    const identity = await post('/api/customers/merge', { keepId: 5, mergeId: 10 })
    assert.equal(identity.status, 409)
    assert.equal(identity.body.code, 'contact_merge_not_duplicates', 'the original body is held to the same rule')
    assert.equal((await post('/api/customers/merge', { keepId: 5, mergeId: 6 })).status, 404)
    assert.equal((await post('/api/customers/merge', { keepId: 5, mergeId: 5 })).status, 400)
  })

  await check('three suppliers: products, batches, returns and invoices are re-pointed by id and by name', async () => {
    const raw = fresh(`
      INSERT INTO suppliers(id,name,phone,company,updated_at) VALUES
        (11,'Lotus Trading','012 666 666',NULL,'2026-09-01 10:00:00'),
        (12,'Lotus Trading Co','012 666 666','Lotus Co Ltd','2026-09-02 10:00:00'),
        (13,'LOTUS','012 666 666',NULL,'2026-09-03 10:00:00');
      INSERT INTO products(id,name,supplier) VALUES (101,'Rice','Lotus Trading'),(102,'Oil','lotus'),(103,'Salt','Other Supplier');
      INSERT INTO product_batches(id,variant_product_id,batch_key,supplier_id,supplier_name) VALUES
        (201,101,'b1',12,'Lotus Trading Co'),(202,102,'b2',13,'LOTUS'),(203,102,'b3',NULL,'Lotus Trading Co'),(204,101,'b4',11,'Lotus Trading');
      INSERT INTO returns(id,supplier_id,supplier_name,return_scope) VALUES (301,12,'Lotus Trading Co','supplier');
      INSERT INTO supplier_invoices(id,source_branch,legacy_id,supplier_id,supplier_name,invoice_date,status,source_file,source_row) VALUES
        (401,'Shop',1,13,'LOTUS','2026-01-01','outstanding','ap.csv',1),(402,'Shop',2,NULL,'lotus','2026-01-02','outstanding','ap.csv',2);
    `)
    const merged = await post('/api/suppliers/merge', {
      keepId: 11, mergeIds: [12, 13], client_request_id: 'r11-suppliers',
      expected: expectedFor(raw, 'suppliers', [11, 12, 13]),
      choices: { name: { source_id: 12 } },
    })
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(rows(raw, 'SELECT id, name, phone, company FROM suppliers ORDER BY id'), [{ id: 11, name: 'Lotus Trading Co', phone: '012 666 666', company: 'Lotus Co Ltd' }])
    assert.deepEqual(rows(raw, 'SELECT id, supplier FROM products ORDER BY id'), [{ id: 101, supplier: 'Lotus Trading Co' }, { id: 102, supplier: 'Lotus Trading Co' }, { id: 103, supplier: 'Other Supplier' }])
    assert.deepEqual(rows(raw, 'SELECT id, supplier_id, supplier_name FROM product_batches ORDER BY id'), [
      { id: 201, supplier_id: 11, supplier_name: 'Lotus Trading Co' },
      { id: 202, supplier_id: 11, supplier_name: 'Lotus Trading Co' },
      { id: 203, supplier_id: null, supplier_name: 'Lotus Trading Co' },
      { id: 204, supplier_id: 11, supplier_name: 'Lotus Trading Co' },
    ])
    assert.deepEqual(rows(raw, 'SELECT supplier_id, supplier_name FROM returns'), [{ supplier_id: 11, supplier_name: 'Lotus Trading Co' }])
    assert.deepEqual(rows(raw, 'SELECT id, supplier_id, supplier_name FROM supplier_invoices ORDER BY id'), [{ id: 401, supplier_id: 11, supplier_name: 'Lotus Trading Co' }, { id: 402, supplier_id: null, supplier_name: 'Lotus Trading Co' }])
    const oldValue = JSON.parse(one(raw, "SELECT old_value FROM audit_logs WHERE action = 'merge'").old_value)
    assert.deepEqual(oldValue.moved.product_batches, [[201, 12], [202, 13]])
    assert.deepEqual(oldValue.moved.products_by_name, [[101, 'Lotus Trading'], [102, 'lotus']])
  })

  await check('three delivery contacts: delivery sales and fees are re-pointed', async () => {
    const raw = fresh(`
      INSERT INTO delivery_contacts(id,name,phone,area,updated_at) VALUES
        (21,'Rith','012 777 777',NULL,'2026-09-01 10:00:00'),(22,'Rith Moto','012 777 777',NULL,'2026-09-02 10:00:00'),(23,'rith','012 777 777','Toul Kork','2026-09-03 10:00:00');
      INSERT INTO sales(id,receipt_number,delivery_contact_id,delivery_contact_name) VALUES (501,'D-501',22,'Rith Moto'),(502,'D-502',23,'rith'),(503,'D-503',21,'Rith');
      INSERT INTO fees(id,fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES (90601,'delivery',2,8200,'2026-09-07',22),(90602,'delivery',1,4100,'2026-09-07',23);
    `)
    const merged = await post('/api/delivery-contacts/merge', { keepId: 21, mergeIds: [22, 23], expected: expectedFor(raw, 'delivery_contacts', [21, 22, 23]) })
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(rows(raw, 'SELECT id, name, phone, area FROM delivery_contacts'), [{ id: 21, name: 'Rith', phone: '012 777 777', area: 'Toul Kork' }])
    assert.deepEqual(rows(raw, 'SELECT id, delivery_contact_id, delivery_contact_name FROM sales ORDER BY id'), [
      { id: 501, delivery_contact_id: 21, delivery_contact_name: 'Rith' },
      { id: 502, delivery_contact_id: 21, delivery_contact_name: 'Rith' },
      { id: 503, delivery_contact_id: 21, delivery_contact_name: 'Rith' },
    ])
    assert.deepEqual(rows(raw, 'SELECT id, delivery_contact_id FROM fees WHERE delivery_contact_id IS NOT NULL ORDER BY id'), [{ id: 90601, delivery_contact_id: 21 }, { id: 90602, delivery_contact_id: 21 }])
  })

  // Six customers, every one with links in every table; the kept record and
  // record 5 have storefront accounts; five records hold different numbers.
  const SIX_SEED = [
    `INSERT INTO customers(id,name,phone,phone_normalized,notes,membership_number,is_anonymous,created_at,updated_at) VALUES
      (1,'Chan',NULL,NULL,'First visit 2024','LC-00001',0,'2024-01-01 09:00:00','2026-09-01 10:00:00'),
      (2,'Chan','012 200 200','012200200',NULL,'LC-00002',0,'2024-02-01 09:00:00','2026-09-02 10:00:00'),
      (3,'Chan',NULL,NULL,NULL,'LC-00003',0,'2024-03-01 09:00:00','2026-09-03 10:00:00'),
      (4,'Chan',NULL,NULL,NULL,'LC-00004',0,'2024-04-01 09:00:00','2026-09-04 10:00:00'),
      (5,'Chan',NULL,NULL,NULL,NULL,0,'2024-05-01 09:00:00','2026-09-05 10:00:00'),
      (6,'Chan',NULL,NULL,NULL,'LC-00006',0,'2024-06-01 09:00:00','2026-09-06 10:00:00');`,
    `INSERT INTO portal_accounts(id,membership_id,name,phone,password_hash,contact_id) VALUES (71,'P-1','Chan','012100100','hash',1),(75,'P-5','Chan','012500500','hash',5);`,
    ...[1, 2, 3, 4, 5, 6].map((id) => `
      INSERT INTO sales(id,receipt_number,customer_id,customer_name) VALUES (${100 + id},'S-${id}',${id},'Chan');
      INSERT INTO returns(id,customer_id,customer_name,return_scope) VALUES (${200 + id},${id},'Chan','customer');
      INSERT INTO customer_share_submissions(id,customer_id,customer_name) VALUES (${300 + id},${id},'Chan');
      INSERT INTO loyalty_point_adjustments(id,customer_id,points) VALUES (${400 + id},${id},${id});
      INSERT INTO customer_receivables(id,legacy_id,customer_id,customer_name,invoice_date,status,source_file,source_row) VALUES (${500 + id},${id},${id},'Chan','2026-01-01','outstanding','ar.csv',${id}),(${600 + id},${10 + id},NULL,'Chan','2026-01-02','outstanding','ar.csv',${10 + id});`),
  ].join('\n')
  const sixBody = (raw) => ({
    keepId: 1, mergeIds: [2, 3, 4, 5, 6], client_request_id: 'r11-six',
    expected: expectedFor(raw, 'customers', [1, 2, 3, 4, 5, 6]),
    choices: { phone: { source_id: 2 } },
    membership_source_id: 4,
    portal_keep_contact_id: 5,
  })
  const settled = (raw) => ({
    keeper: (({ updated_at: _updatedAt, ...rest }) => rest)(one(raw, 'SELECT * FROM customers WHERE id = 1')),
    ids: rows(raw, 'SELECT id FROM customers ORDER BY id').map((row) => row.id),
    // Linked rows are compared on everything the merge can write; their own
    // insert-time timestamps (created_at, imported_at, ...) differ between
    // the two fixtures.
    linked: CUSTOMER_TABLES.slice(1, -1).map((table) => rows(raw, `SELECT * FROM ${table} ORDER BY id`)
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.endsWith('_at'))))),
  })

  let paidState = null
  let paidStatements = 0
  await check('paid plan: six records merge in one request and one batch inside the 80-statement cap', async () => {
    const raw = fresh(SIX_SEED)
    const merged = await post('/api/customers/merge', sixBody(raw), 'paid')
    assert.equal(merged.status, 200, JSON.stringify(merged.body))
    assert.deepEqual(merged.body.merged_ids, [2, 3, 4, 5, 6])
    assert.equal(merged.body.continuation, undefined)
    assert.equal(state.batches.length, 1)
    paidStatements = state.batches[0]
    assert.ok(paidStatements <= contactMerge.CONTACT_MERGE_MAX_STATEMENTS, `${paidStatements} statements`)
    paidState = settled(raw)
    assert.deepEqual(paidState.ids, [1])
    assert.equal(paidState.keeper.membership_number, 'LC-00004')
    assert.equal(paidState.keeper.notes, 'First visit 2024\nMerged membership: LC-00001\nMerged membership: LC-00002\nMerged membership: LC-00003\nMerged membership: LC-00006')
    assert.equal(paidState.keeper.phone, '012 200 200')
    assert.equal(paidState.keeper.phone_normalized, '012200200')
    assert.deepEqual(rows(raw, 'SELECT id, contact_id FROM portal_accounts ORDER BY id'), [{ id: 71, contact_id: null }, { id: 75, contact_id: 1 }])
  })

  await check('free plan: six records merge in steps inside the 50-query budget, never failing, ending as the paid merge does', async () => {
    const raw = fresh(SIX_SEED)
    const body = sixBody(raw)
    const first = await post('/api/customers/merge', body, 'free')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.deepEqual(first.body.merged_ids, [4, 5], 'the records holding the chosen number and account go first')
    assert.deepEqual(first.body.remaining_merge_ids, [2, 3, 6])
    assert.equal(first.body.continuation.client_request_id, 'r11-six:r3')

    // The same request retried after its first step committed answers from the
    // audit row with the same remaining work, instead of a false conflict.
    const retried = await post('/api/customers/merge', body, 'free')
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
    assert.equal(retried.body.replayed, true)
    assert.deepEqual(retried.body.remaining_merge_ids, [2, 3, 6])
    assert.deepEqual(retried.body.continuation, first.body.continuation)

    let next = first.body.continuation
    let requests = 1
    while (next) {
      const response = await post('/api/customers/merge', next, 'free')
      assert.equal(response.status, 200, JSON.stringify(response.body))
      requests += 1
      next = response.body.continuation
      assert.ok(requests < 6, 'every step makes progress')
    }
    assert.equal(requests, 3)
    // 50 D1 queries per request on the free plan, less what the route spends
    // outside its batch; the one-batch merge would not have fitted.
    const budget = contactMerge.contactMergeStatementBudget(50)
    assert.equal(budget + contactMerge.CONTACT_MERGE_ROUTE_OVERHEAD_QUERIES, 50)
    assert.ok(paidStatements > budget, `the ${paidStatements}-statement paid batch needs stepping under the free budget of ${budget}`)
    for (const statements of state.batches) {
      assert.ok(statements <= budget, `a ${statements}-statement batch exceeds the free-plan budget of ${budget}`)
    }
    // The stepped merge ends exactly as the one-batch merge.
    const freeState = settled(raw)
    assert.deepEqual(freeState.ids, paidState.ids)
    assert.deepEqual(freeState.keeper, paidState.keeper, 'the kept record')
    CUSTOMER_TABLES.slice(1, -1).forEach((table, index) => assert.deepEqual(freeState.linked[index], paidState.linked[index], table))
    assert.deepEqual(rows(raw, "SELECT details FROM audit_logs WHERE action = 'merge' ORDER BY id").map((row) => JSON.parse(row.details).clientRequestId), ['r11-six', 'r11-six:r3', 'r11-six:r1'])
  })

  await check('free plan: later steps are authorized by the first step\'s verified cluster, even once the kept record left it', async () => {
    const raw = fresh(SIX_SEED)
    const body = { ...sixBody(raw), client_request_id: 'r11-typed', choices: { phone: { source_id: 2 }, name: { custom: 'Chan Dara' } } }
    const first = await post('/api/customers/merge', body, 'free')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(one(raw, 'SELECT name FROM customers WHERE id = 1').name, 'Chan Dara', 'the kept record no longer shares the cluster name')
    let next = first.body.continuation
    assert.ok(next && !('manual' in next), 'a continuation carries no manual flag')
    // The continuation's id with an outsider slipped in is refused.
    raw.prepare("INSERT INTO customers(id,name,is_anonymous,updated_at) VALUES (9,'Outsider',0,'2026-09-09 10:00:00')").run()
    const smuggled = await post('/api/customers/merge', { ...next, mergeIds: [...next.mergeIds.slice(0, 1), 9], expected: expectedFor(raw, 'customers', [1, next.mergeIds[0], 9]) }, 'free')
    assert.equal(smuggled.status, 409, JSON.stringify(smuggled.body))
    assert.equal(smuggled.body.code, 'contact_merge_not_duplicates')
    let requests = 1
    while (next) {
      const response = await post('/api/customers/merge', next, 'free')
      assert.equal(response.status, 200, JSON.stringify(response.body))
      next = response.body.continuation
      requests += 1
      assert.ok(requests < 6)
    }
    assert.deepEqual(rows(raw, 'SELECT id FROM customers ORDER BY id').map((row) => row.id), [1, 9])
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
