// Executes real routes, membership allocator and import classifier against local SQLite.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const raw = openDb(loadAll())
// The PUT route commits through db.batch; the hook lets the membership race
// check below plant a competing writer between a mint and its UPDATE.
let membershipBatchCalls = 0
let onMembershipBatch = null
const db = {
  prepare(sql) { const s = raw.prepare(sql); return { get: async p => s.get(p), all: async p => s.all(p), run: async p => s.run(p) } },
  batch: async items => { membershipBatchCalls += 1; if (onMembershipBatch) { const hook = onMembershipBatch; onMembershipBatch = null; hook(items) } return raw.batch(items) },
}
function load(file, dependencies = {}) {
  const filename = path.join(__dirname, '../src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText
  const m = { exports: {} }
  new Function('require', 'exports', 'module', output)(name => name in dependencies ? dependencies[name] : name.startsWith('.') ? {} : require(name), m.exports, m)
  return m.exports
}
const membership = load('lib/membershipNumber.ts')
const portal = load('routes/portal.ts', {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => next() },
})
const contactDependencies = {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => {
    const permissions = c.req.header('x-test-permissions')
    if (!permissions) return c.json({ error: 'Unauthorized' }, 401)
    c.set('user', { id: 1, permissions })
    return next()
  } },
  '../lib/permissions': load('lib/permissions.ts'),
  '../lib/sqlBinding': load('lib/sqlBinding.ts'),
  '../lib/membershipNumber': membership,
  './portal': { ...portal, loadSettingsMap: async () => ({ loyalty_points_enabled: 'false' }) },
}
const contacts = load('routes/contacts.ts', contactDependencies).default
// A second load of the SAME route file with the rest of its collaborators
// wired up: the read-only checks above only need the handful listed there,
// but the membership race check at the end drives a real PUT /customers/:id
// end to end, so conflictControl, contactDuplicates, phone and the
// fire-and-forget audit/broadcast/cache calls all have to resolve.
const contactsWrite = load('routes/contacts.ts', {
  ...contactDependencies,
  '../lib/conflictControl': load('lib/conflictControl.ts'),
  '../lib/contactDuplicates': load('lib/contactDuplicates.ts', { './contactOptions': load('lib/contactOptions.ts') }),
  '../lib/phone': load('lib/phone.ts'),
  '../lib/audit': { audit: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/actorSnapshot': { actorSnapshot: () => ({}) },
}).default
const imports = load('lib/importEngine.ts', {
  './membershipNumber': membership,
  './contactOptions': load('lib/contactOptions.ts'),
  './phone': load('lib/phone.ts'),
  './batchCode': load('lib/batchCode.ts'),
  './searchMatch': load('lib/searchMatch.ts'),
})
async function main() {
  raw.prepare('INSERT INTO customers (id,name,membership_number,phone,address,notes) VALUES (1,@name,@number,@phone,@address,@notes)').run({ name: 'Member', number: ' legacy-Id ', phone: '12345678', address: 'SECRET_ADDRESS', notes: 'SECRET_NOTES' })
  raw.prepare('INSERT INTO loyalty_point_adjustments (customer_id,points,note) VALUES (1,250,@note)').run({ note: 'SECRET_AWARD' })
  const request = (url, permissions, method = 'GET') => contacts.request(url, { method, headers: permissions ? { 'x-test-permissions': JSON.stringify(permissions) } : {} }, {})
  assert.equal((await request('/customers/membership/legacy-id')).status, 401)
  for (const perms of [{}, { customer_portal: true }]) assert.equal((await request('/customers/membership/legacy-id', perms)).status, 403)
  for (const perms of [{ pos: true }, { contacts: true }]) {
    const response = await request('/customers/membership/legacy-id', perms)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.deepEqual(await response.json(), { customer: { id: 1, name: 'Member', membership_number: ' legacy-Id ' }, points: { balance: 250, redeemableUnits: 0 } })
  }
  const mounted = new (require('hono').Hono)().route('/api', contacts)
  assert.equal((await mounted.request('/api/customers/membership/legacy-id', { headers: { 'x-test-permissions': '{"pos":true}' } }, {})).status, 200)
  for (const route of ['/customers', '/customers/1', '/suppliers', '/delivery-contacts', '/customers/membership/legacy-id/extra']) assert.equal((await request(route, { pos: true })).status, 403, route)
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.equal((await request('/customers/membership/legacy-id', { pos: true }, method)).status, 403, method)
  assert.equal((await request('/customers/membership/12345678', { pos: true })).status, 404, 'no phone fallback')
  assert.equal((await request('/customers/membership/legacy', { pos: true })).status, 404, 'exact only')
  raw.prepare("INSERT INTO customers (name,membership_number) VALUES ('Ambiguous','LEGACY-ID')").run()
  assert.equal((await request('/customers/membership/legacy-id', { pos: true })).status, 409)
  assert.equal((await portal.default.request('/membership/legacy-id', {}, {})).status, 403, 'public stays disabled')

  // --- membership number minting: LC- gap-fill (owner, 2026-09-06: the mint
  // had regressed to eight random characters, contradicting the LC- format
  // every existing customer carries (migration 0110) and what the Add
  // Customer form promises: "The next available LC- number is assigned when
  // you save."). Discriminating case: from taken [LC-00001, LC-00002,
  // LC-00004] the next mint is LC-00003 -- the old random code disagreed on
  // every assertion below. ------------------------------------------------
  raw.prepare("INSERT INTO customers (name, membership_number) VALUES ('Alpha','LC-00001'), ('Beta','LC-00002'), ('Gamma','LC-00004')").run()
  // A legacy random id and a legacy LCMN- id sit in the same column but
  // never parse as a sequence slot -- they must not shift the gap-fill.
  raw.prepare("INSERT INTO customers (name, membership_number) VALUES ('Legacy random','QWERTY12'), ('Legacy prefixed','LCMN-DEADBEEF')").run()
  assert.equal(await membership.mintMembershipNumber(db), 'LC-00003', 'the hole at 3 is filled before the sequence grows; legacy formats do not block')

  // A portal account can hold a number with no matching customer row yet
  // (e.g. a signup whose contact fold failed) -- mint must see it too, since
  // customers and portal_accounts share ONE sequence.
  raw.prepare("INSERT INTO portal_accounts (membership_id, name, phone, password_hash) VALUES ('LC-00003','Orphan Portal','099000111','x')").run()
  assert.equal(await membership.mintMembershipNumber(db), 'LC-00005', 'portal_accounts.membership_id reserves its slot even with no matching customer row')

  // extraTaken still folds in numbers held by neither table yet (e.g. other
  // rows already assigned earlier in the same in-flight import batch).
  assert.equal(await membership.mintMembershipNumber(db, ['LC-00005']), 'LC-00006', 'extraTaken is unioned with both tables')

  // Concurrent-collision retry still works: the DB unique index is the final
  // arbiter when two writers mint the same instant, and the loser re-mints.
  let raceAttempts = 0
  const raced = await membership.withMintedMembershipNumber(db, async number => {
    raceAttempts += 1
    if (raceAttempts === 1) raw.prepare('INSERT INTO customers (name, membership_number) VALUES (@name,@number)').run({ name: 'Interloper', number })
    raw.prepare('INSERT INTO customers (name, membership_number) VALUES (@name,@number)').run({ name: 'Racer', number })
    return number
  })
  assert.equal(raceAttempts, 2, 'the loser of the UNIQUE-index race re-mints and retries')
  assert.equal(raced, 'LC-00006', 'the retried mint is still a valid gap-fill result')
  let rejected = 0
  await assert.rejects(() => membership.withMintedMembershipNumber(db, async () => { rejected++; throw new Error('UNIQUE constraint failed: customers.membership_number') }, 3), /UNIQUE/)
  assert.equal(rejected, 3, 'a non-collision error is not swallowed, and a persistent collision still exhausts its retry budget')

  // Reset to a clean sequence before the import-engine assertions below,
  // which pin their own expected numbers against an empty sequence.
  raw.prepare("DELETE FROM customers WHERE name IN ('Alpha','Beta','Gamma','Legacy random','Legacy prefixed','Interloper','Racer')").run()
  raw.prepare("DELETE FROM portal_accounts WHERE membership_id = 'LC-00003'").run()

  const classified = await imports.classifyContacts(db, 'customers', [
    { name: 'Blank one' }, { name: 'Supplied', membership_number: 'LCMN-SUPPLIED1' }, { name: 'Blank two' },
  ])
  assert.deepEqual(classified.map(row => row.data.membership_number), ['LC-00001', 'LCMN-SUPPLIED1', 'LC-00002'], 'blank import rows gap-fill the house sequence; a supplied value is kept verbatim')
  const updated = await imports.classifyContacts(db, 'customers', [{ name: 'Member', membership_number: 'REPLACE1' }], JSON.stringify({ conflictMode: 'overwrite', fieldRules: { membership_number: 'use_imported' } }))
  assert.equal(updated[0].data.membership_number, ' legacy-Id ', 'a matched customer keeps its own identity even under an overwrite policy')
  const engineSource = fs.readFileSync(path.join(__dirname, '../src/lib/importEngine.ts'), 'utf8')
  const applyStart = engineSource.indexOf("} else if (job.type === 'customers' || job.type === 'suppliers' || job.type === 'delivery_contacts') {")
  assert.ok(applyStart > 0)
  const applyEnd = engineSource.indexOf("} else if (job.type === 'inventory')", applyStart)
  const applyBody = engineSource.slice(engineSource.indexOf('{', applyStart) + 1, applyEnd)
  const code = ts.transpileModule(applyBody, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const statements = []
  new Function('job', 'actionable', 'statements', 'nowIso', code)(
    { type: 'customers' }, [{ action: 'update', existingId: 1, data: { name: 'Member updated', phone: '12345678', address: null, notes: null, email: null, membership_number: 'REPLACE2', gender: null } }], statements, '2026-09-05 12:00:00',
  )
  for (const statement of statements) await db.prepare(statement.sql).run(statement.params)
  const applied = await db.prepare('SELECT name,membership_number FROM customers WHERE id=1').get()
  assert.equal(applied.name, 'Member updated')
  assert.equal(applied.membership_number, ' legacy-Id ', 'apply cannot rewrite identity from a stale review')

  // --- undo/redo of a hard delete must not dead-end on a gap-fill race
  // (verifier finding, 2026-09-06): bulkDeleteEngine.ts hard-deletes
  // customers, and CustomersTab.tsx's undo/redo replays the deleted
  // customer's OWN membership_number verbatim through POST /customers.
  // Gap-fill deliberately reuses a number freed by that delete
  // (membershipNumber.ts's header decision), so if a brand-new signup or
  // manual add grabbed that exact slot during the undo window, the restore
  // must mint a fresh number (isUndoRestore: true) instead of the flat 400
  // a normal manual add still gets for the identical collision (a real
  // typo/duplicate signal staff need to see).
  //
  // Wiring the FULL POST /customers route here would mean stubbing every
  // one of its other dependencies (audit, broadcast, cache versioning,
  // contactDuplicates+contactOptions, actorSnapshot...), none of which this
  // decision touches -- so, same technique as the import-engine apply-block
  // slice just above, the REAL source's own membership-collision block is
  // extracted verbatim by anchor text and executed directly. Any edit that
  // moves this block without keeping the same two anchors fails loudly here
  // (assert.ok on both indexOf calls) rather than silently testing nothing.
  const contactsSource = fs.readFileSync(path.join(__dirname, '../src/routes/contacts.ts'), 'utf8')
  const collisionAnchorStart = 'let mintMembership = false'
  const collisionAnchorEnd = 'const runContactInsert = async'
  const collisionStart = contactsSource.indexOf(collisionAnchorStart)
  assert.ok(collisionStart > 0, 'contacts.ts POST /customers: could not find the membership-collision decision block (start anchor moved)')
  const collisionEnd = contactsSource.indexOf(collisionAnchorEnd, collisionStart)
  assert.ok(collisionEnd > collisionStart, 'contacts.ts POST /customers: could not find the end of the membership-collision decision block (end anchor moved)')
  const collisionSlice = contactsSource.slice(collisionStart, collisionEnd)
  assert.match(collisionSlice, /isUndoRestore/, 'the extracted slice must be the isUndoRestore-aware block, not a stale match')
  const collisionCode = ts.transpileModule(collisionSlice, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const runCollisionDecision = new Function(`return (async function(db, payload, body, config, c, normalizeMembershipNumber) {
${collisionCode}
    return { mintMembership, payload }
  })`)()

  raw.prepare("INSERT INTO customers (name, membership_number) VALUES ('Reused Slot Owner', 'LC-00007')").run()
  const jsonC = { json: (jsonBody, status) => ({ __earlyReturn: true, status, jsonBody }) }

  const normalCollision = await runCollisionDecision(
    db, { membership_number: 'LC-00007' }, {}, { table: 'customers' }, jsonC, membership.normalizeMembershipNumber,
  )
  assert.strictEqual(normalCollision.status, 400, 'a normal manual add (no isUndoRestore) still gets the flat 400 on a real collision')
  assert.match(normalCollision.jsonBody.error, /already in use/)

  const restoreCollision = await runCollisionDecision(
    db, { membership_number: 'LC-00007' }, { isUndoRestore: true }, { table: 'customers' }, jsonC, membership.normalizeMembershipNumber,
  )
  assert.strictEqual(restoreCollision.__earlyReturn, undefined, 'an undo/redo restore must NOT early-return the 400 on the exact same collision')
  assert.strictEqual(restoreCollision.mintMembership, true, 'the collision must fall back to minting a fresh number, not reuse the taken one')

  const restoreNoCollision = await runCollisionDecision(
    db, { membership_number: 'LC-09999' }, { isUndoRestore: true }, { table: 'customers' }, jsonC, membership.normalizeMembershipNumber,
  )
  assert.strictEqual(restoreNoCollision.__earlyReturn, undefined)
  assert.strictEqual(restoreNoCollision.mintMembership, false, 'isUndoRestore only changes what happens ON a collision -- no collision means no forced mint')
  assert.strictEqual(restoreNoCollision.payload.membership_number, 'LC-09999', 'a non-colliding supplied number survives untouched')

  // --- PUT /customers/:id must mint through withMintedMembershipNumber too
  // (verifier finding, 2026-09-06). The POST route already deferred its mint
  // into the retry wrapper; the PUT route minted once, up front, and handed
  // the number straight to the UPDATE -- so a writer that took that number in
  // between turned a routine edit into a raw 500 with the field still blank.
  // ONE rule, ONE retry story, both call sites.
  raw.prepare("INSERT INTO customers (id,name) VALUES (900,'Race A'),(901,'Race B')").run()
  const putCustomer = (id, payload) => contactsWrite.request(`/customers/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-permissions': '{"contacts":true}' },
    body: JSON.stringify(payload),
  }, {}, { waitUntil: () => {}, passThroughOnException: () => {} })

  const firstPut = await putCustomer(900, { name: 'Race A', membership_number: '' })
  assert.equal(firstPut.status, 200, 'blanking the membership field on a customer that has never had one mints a house number')
  const firstNumber = (await db.prepare('SELECT membership_number FROM customers WHERE id=900').get()).membership_number
  assert.match(firstNumber, /^LC-\d{5}$/)

  // The second PUT loses the UNIQUE-index race: a competing writer grabs the
  // exact number it just minted, in the instant between the mint and the
  // UPDATE. Planted inside db.batch so the timing is deterministic rather
  // than a hopeful Promise.all interleave.
  membershipBatchCalls = 0
  onMembershipBatch = items => {
    const minted = items[0].params.membership_number
    raw.prepare("INSERT INTO customers (name,membership_number) VALUES ('Interloper',@n)").run({ n: minted })
  }
  const secondPut = await putCustomer(901, { name: 'Race B', membership_number: '' })
  assert.equal(secondPut.status, 200, 'losing the race re-mints and retries -- it must never surface as a 500')
  assert.equal(membershipBatchCalls, 2, 'exactly one retry: the first UPDATE lost the index, the second won')
  const secondNumber = (await db.prepare('SELECT membership_number FROM customers WHERE id=901').get()).membership_number
  assert.match(secondNumber, /^LC-\d{5}$/)
  assert.notEqual(secondNumber, firstNumber, 'the two edited customers end with DISTINCT house numbers')
  const interloperNumber = (await db.prepare("SELECT membership_number FROM customers WHERE name='Interloper'").get()).membership_number
  assert.notEqual(secondNumber, interloperNumber, 'the retry took the next free number, not the one it lost')

  console.log('PASS membership routes: auth, exact scope, redaction, public 403; LC- gap-fill minting over customers+portal_accounts, bounded retries, imports, preservation, undo/redo restore-vs-manual-add collision handling, and PUT-path mint retry')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
