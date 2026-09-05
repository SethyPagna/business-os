// Executes real routes, membership allocator and import classifier against local SQLite.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const raw = openDb(loadAll())
const db = { prepare(sql) { const s = raw.prepare(sql); return { get: async p => s.get(p), all: async p => s.all(p), run: async p => s.run(p) } } }
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
const contacts = load('routes/contacts.ts', {
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

  const originalRandom = crypto.getRandomValues.bind(crypto)
  let sequence = []
  crypto.getRandomValues = bytes => { bytes.fill(sequence.length ? sequence.shift() : 0); return bytes }
  try {
    sequence = [255, 0]
    assert.equal(membership.randomMembershipNumber(), 'AAAAAAAA', 'out-of-range bytes rejected')
    sequence = Array(32).fill(255)
    assert.throws(() => membership.randomMembershipNumber(), /generate a membership/)
    const allocate = membership.createMembershipNumberAllocator([' aaaaaaaa ', 'bbbbbbbb'])
    sequence = [0, 1, 2, 2, 3]
    assert.equal(allocate(), 'CCCCCCCC')
    assert.equal(allocate(), 'DDDDDDDD')
    assert.throws(() => membership.createMembershipNumberAllocator(['AAAAAAAA'])(), /unique membership/)
    raw.prepare("INSERT INTO customers (name,membership_number) VALUES ('Collision','aaaaaaaa')").run()
    sequence = [0, 4]
    assert.equal(await membership.mintMembershipNumber(db), 'EEEEEEEE')
    sequence = [4, 5]
    assert.equal(await membership.mintMembershipNumber(db, [' eeeeeeee ']), 'FFFFFFFF', 'portal reservation is case insensitive')
    await assert.rejects(() => membership.mintMembershipNumber(db), /unique membership/)
    sequence = [5, 6]
    let writes = 0
    const raced = await membership.withMintedMembershipNumber(db, async number => {
      writes++
      if (writes === 1) raw.prepare('INSERT INTO customers(name,membership_number) VALUES (@name,@number)').run({ name: 'Race winner', number })
      raw.prepare('INSERT INTO customers(name,membership_number) VALUES (@name,@number)').run({ name: 'Race retry', number })
      return number
    })
    assert.equal(writes, 2)
    assert.equal(raced, 'GGGGGGGG')
    let rejected = 0
    sequence = [7, 8, 9]
    await assert.rejects(() => membership.withMintedMembershipNumber(db, async () => { rejected++; throw new Error('UNIQUE constraint failed: customers.membership_number') }, 3), /UNIQUE/)
    assert.equal(rejected, 3)
    sequence = [0, 10, 11, 12]
    const classified = await imports.classifyContacts(db, 'customers', [
      { name: 'Blank one' }, { name: 'Supplied', membership_number: 'KKKKKKKK' }, { name: 'Blank two' },
    ])
    assert.deepEqual(classified.map(row => row.data.membership_number), ['LLLLLLLL', 'KKKKKKKK', 'MMMMMMMM'])
    const updated = await imports.classifyContacts(db, 'customers', [{ name: 'Member', membership_number: 'REPLACE1' }], JSON.stringify({ conflictMode: 'overwrite', fieldRules: { membership_number: 'use_imported' } }))
    assert.equal(updated[0].data.membership_number, ' legacy-Id ')
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
  } finally { crypto.getRandomValues = originalRandom }
  for (let i = 0; i < 100; i++) assert.match(membership.randomMembershipNumber(), /^[A-Z0-9]{8}$/)
  console.log('PASS membership routes: auth, exact scope, redaction, public 403; random collisions, bounded retries, imports and preservation')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
