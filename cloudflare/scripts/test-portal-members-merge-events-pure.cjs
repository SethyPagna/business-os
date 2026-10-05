// G38 Phase 1 acceptance: a customer merge records what it does to website
// members (lib/contactMerge.ts, design §4.5 sibling surface).
//
//   "Merging customer X (linked to member M) into Y: M's contact_id = Y and a
//    merge_repoint event exists in the same batch; merging two linked
//    customers leaves one link and one merge_unlink event (no silent orphan)."
//
// Runs the REAL buildContactMergePlan statements as one batch on migrated
// SQLite. Also: the member's link_version moves (an earlier staff link can no
// longer be reverted over the merge), an unlinked member loses its sessions,
// the event keeps the deleted customer's id (orphan audit classifies it as
// history), and a refused merge writes no event.
//
// SECURITY_TEST_BASE=<sha> plans with that commit's contactMerge.ts:
// 4ab47676e must FAIL (it moves and unlinks members with no record).
//
// Run: node scripts/test-portal-members-merge-events-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '..')
function loadTs(rel, stubs = {}, sourceText = null) {
  const file = path.join(root, 'src', rel)
  const source = sourceText ?? fs.readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, (r) => (r in stubs ? stubs[r] : require(r)), mod)
  return mod.exports
}
const base = process.env.SECURITY_TEST_BASE
const mergeSource = base ? execFileSync('git', ['show', `${base}:cloudflare/src/lib/contactMerge.ts`], { cwd: root, encoding: 'utf8' }) : null
const merge = loadTs('lib/contactMerge.ts', { './contactOptions': loadTs('lib/contactOptions.ts'), './phone': loadTs('lib/phone.ts') }, mergeSource)

const COLUMNS = ['name', 'phone', 'email', 'address', 'notes', 'membership_number', 'gender', 'created_at']

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.message}`) }
}

function fixture() {
  const db = openDb(loadAll())
  const run = (sql, params = {}) => db.prepare(sql).run(params)
  const all = (sql, params = {}) => db.prepare(sql).all(params)
  const one = (sql, params = {}) => db.prepare(sql).get(params)
  const member = (id, name, contactId) => {
    run("INSERT INTO portal_accounts (id, name, phone, member_code, contact_id, link_version) VALUES (@id, @name, @phone, NULL, @c, 1)", { id, name, phone: `01200${id}`, c: contactId })
    run("INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (@id, @t, '2999-01-01')", { id, t: `tok-${id}` })
    // The staff link that put it there (link_version 1).
    run(`INSERT INTO portal_member_link_events (account_id, action, to_customer_id, evidence, link_version_after, actor_name)
      VALUES (@id, 'link', @c, 'in_person', 1, 'linker')`, { id, c: contactId })
  }
  const plan = (keepId, mergeIds, extra = {}) => {
    const ids = [keepId, ...mergeIds]
    return merge.buildContactMergePlan({
      table: 'customers',
      entity: 'customer',
      editableColumns: COLUMNS,
      keeper: one('SELECT * FROM customers WHERE id = @id', { id: keepId }),
      members: mergeIds.map((id) => one('SELECT * FROM customers WHERE id = @id', { id })),
      portalAccounts: all(`SELECT id, contact_id, membership_id, name FROM portal_accounts WHERE contact_id IN (${ids.join(',')}) ORDER BY id`),
      hasCustomerReceivables: true,
      hasSupplierInvoices: false,
      audit: { operationId: 'op-merge-1', userId: 7, userName: 'operator', deviceName: null, deviceTz: null },
      ...extra,
    })
  }
  return { db, run, all, one, member, plan }
}

const eventsOf = (f, id) => f.all('SELECT * FROM portal_member_link_events WHERE account_id = @id ORDER BY id', { id })
const live = (f, id) => Number(f.one('SELECT COUNT(*) AS n FROM portal_sessions WHERE account_id = @id AND revoked_at IS NULL', { id }).n)

async function main() {
  await check('X (linked to M) into Y: M follows to Y, a merge_repoint event in the same batch, version moves', async () => {
    const f = fixture()
    f.run("INSERT INTO customers (id, name, phone) VALUES (1, 'Same Person', '012 100 100'), (2, 'Same Person', '012 100 100')")
    f.member(50, 'Web M', 2)
    await f.db.batch(f.plan(1, [2]).statements)
    const account = f.one('SELECT contact_id, link_version FROM portal_accounts WHERE id = 50')
    assert.equal(account.contact_id, 1)
    assert.equal(account.link_version, 2, 'the merge moved link_version')
    const last = eventsOf(f, 50).at(-1)
    assert.equal(last.action, 'merge_repoint')
    assert.equal(last.from_customer_id, 2, 'the event keeps the deleted customer id')
    assert.equal(last.to_customer_id, 1)
    assert.equal(last.evidence, 'system')
    assert.equal(last.group_id, 'op-merge-1', 'tied to the merge audit row')
    assert.equal(last.link_version_after, 2)
    assert.equal(last.actor_user_id, 7)
    assert.equal(f.one('SELECT COUNT(*) AS n FROM customers WHERE id = 2').n, 0, 'the merged customer is gone')
    assert.equal(live(f, 50), 1, 'following the customer keeps the member signed in')
  })

  await check('two linked customers merged: one link stays, one merge_unlink event, the unlinked member is signed out', async () => {
    const f = fixture()
    f.run("INSERT INTO customers (id, name, phone) VALUES (11, 'Twin', '012 200 200'), (12, 'Twin', '012 200 200')")
    f.member(61, 'Keeper Member', 11)
    f.member(62, 'Merged Member', 12)
    await f.db.batch(f.plan(11, [12], { portalKeepContactId: 12 }).statements)
    const linked = f.all('SELECT id, contact_id FROM portal_accounts WHERE contact_id IS NOT NULL ORDER BY id')
    assert.deepEqual(linked.map((r) => [r.id, r.contact_id]), [[62, 11]], 'the chosen member follows to the keeper; one link')
    const dropped = eventsOf(f, 61).at(-1)
    assert.equal(dropped.action, 'merge_unlink')
    assert.equal(dropped.from_customer_id, 11)
    assert.equal(dropped.to_customer_id, null)
    assert.equal(dropped.link_version_after, f.one('SELECT link_version FROM portal_accounts WHERE id = 61').link_version)
    const followed = eventsOf(f, 62).at(-1)
    assert.equal(followed.action, 'merge_repoint')
    assert.equal(followed.from_customer_id, 12)
    assert.equal(followed.to_customer_id, 11)
    assert.equal(dropped.group_id, followed.group_id)
    assert.equal(live(f, 61), 0, 'the unlinked member loses its sessions')
    assert.equal(live(f, 62), 1)
    const orphans = f.one(`SELECT COUNT(*) AS n FROM portal_accounts a
      WHERE a.contact_id IS NULL AND NOT EXISTS (SELECT 1 FROM portal_member_link_events e WHERE e.account_id = a.id AND e.to_customer_id IS NULL AND e.link_version_after = a.link_version)`).n
    assert.equal(orphans, 0, 'no member was unlinked without a record')
  })

  await check('a merge that is refused in its batch writes no event and moves no member', async () => {
    const f = fixture()
    f.run("INSERT INTO customers (id, name, phone) VALUES (21, 'Race', '012 300 300'), (22, 'Race', '012 300 300')")
    f.member(70, 'Race Member', 22)
    const planned = f.plan(21, [22])
    f.run("UPDATE customers SET name = 'Race Renamed' WHERE id = 22")
    await assert.rejects(() => f.db.batch(planned.statements))
    assert.equal(f.one('SELECT contact_id FROM portal_accounts WHERE id = 70').contact_id, 22)
    assert.equal(eventsOf(f, 70).length, 1, 'only the original link event')
  })

  await check('the repoint/unlink statements stay inside the merge batch budget', () => {
    const f = fixture()
    const ids = [31, 32, 33, 34, 35, 36]
    for (const id of ids) f.run("INSERT INTO customers (id, name, phone) VALUES (@id, 'Six', '012 400 400')", { id })
    ids.forEach((id, index) => f.member(80 + index, `Six ${index}`, id))
    const planned = f.plan(31, ids.slice(1), { portalKeepContactId: 33 })
    assert.ok(planned.statements.length <= merge.CONTACT_MERGE_MAX_STATEMENTS, `${planned.statements.length} statements`)
    return f.db.batch(planned.statements).then(() => {
      assert.equal(f.one("SELECT COUNT(*) AS n FROM portal_member_link_events WHERE action IN ('merge_repoint', 'merge_unlink')").n, 6)
      assert.equal(f.one('SELECT COUNT(*) AS n FROM portal_accounts WHERE contact_id IS NOT NULL').n, 1)
    })
  })

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
