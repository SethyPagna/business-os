// G38 S3d: the new shopper's join (lib/portalTelegramJoin.ts) on the real migration chain through 0324, in node:sqlite.
// Tests T-D1 to T-D13 of AMEND-g38-lean-writes-1.2 section 11.4. No network, nothing mounted.
// Rows written are counted by the one counting rule of section 1.2: table rows written (total_changes) plus one entry per index
// entry inserted or deleted. Rows read are not measured here (T-B7 measured them on workerd).
// S3D_LIB_ROOT points the loader at a scratch copy of src/lib: the mutant runs use it. Without it the real tree is loaded.
// Run: node scripts/test-portal-telegram-join-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb, D1Compat } = require('./harness/d1compat.cjs')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const realLibRoot = path.join(cloudflareRoot, 'src', 'lib')
const libRoot = process.env.S3D_LIB_ROOT || realLibRoot
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

// './portalAccounts' drags the password and cache modules in. Its one export this feature needs is the consent version, read
// from the REAL file so a bump there reaches the test; a check below pins that the join file imports it from there.
const consentMatch = /export const PORTAL_CONSENT_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(realLibRoot, 'portalAccounts.ts'), 'utf8'))
assert.ok(consentMatch, 'PORTAL_CONSENT_VERSION not found in lib/portalAccounts.ts')
const CONSENT_VERSION = consentMatch[1]

const compiled = new Map()
function loadLib(name) {
  if (name === 'portalAccounts') return { PORTAL_CONSENT_VERSION: CONSENT_VERSION }
  if (compiled.has(name)) return compiled.get(name).exports
  const file = path.join(libRoot, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  })
  const mod = { exports: {} }
  compiled.set(name, mod)
  const localRequire = (request) => (request.startsWith('./') ? loadLib(request.slice(2)) : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, localRequire, mod, file, libRoot)
  return mod.exports
}

const join = loadLib('portalTelegramJoin')
const { mintMemberCode } = loadLib('memberCode')
const { PLAN_LIMITS_BY_TIER } = loadLib('planTier')
const LIM = PLAN_LIMITS_BY_TIER.paid
const ENV = {}

const T0 = Date.UTC(2026, 10, 24, 10, 0, 0)
const MIN = 60 * 1000
const iso = (ms) => new Date(ms).toISOString()
const TG = 5550001
const EXPIRY_SECONDS = Math.floor(T0 / 1000) + LIM.portalTelegramTokenTtlSeconds
const ticketOf = (n) => `tg1:${String(n).padStart(64, '0')}`
const FLAGS_FULL_KM = 1 | (1 << 3) | (1 << 4) | (42 << 5)
const FLAGS_NO_TERMS = 1 | (1 << 4) | (42 << 5)
const FLAGS_NO_AGE = 1 | (1 << 3) | (42 << 5)

let passed = 0
let failed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// ---- Fixture ----------------------------------------------------------------------------------

const TABLES = ['portal_accounts', 'portal_sessions', 'portal_telegram_pending']

// The full chain takes seconds to apply, so it is applied once; each world replays only the DDL of the three portal tables (rows, indexes
// and triggers as the chain left them). T-D12 needs customers and uses the whole chain.
let schemaDdl = null
function openWorld(full) {
  if (full) return openDb(loadAll({ through: 324 }))
  if (!schemaDdl) {
    const raw = openDb(loadAll({ through: 324 })).db
    schemaDdl = raw.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN ('portal_accounts', 'portal_sessions', 'portal_telegram_pending') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid").all().map((row) => row.sql)
  }
  const raw = new DatabaseSync(':memory:')
  for (const sql of schemaDdl) raw.exec(sql)
  raw.limits.exprDepth = 100
  return new D1Compat(raw)
}

function makeWorld(full = false) {
  const d1 = openWorld(full)
  const raw = d1.db
  const calls = { prepare: 0, batch: 0 }
  const hooks = { beforeBatch: null }
  const db = {
    prepare(sql) {
      calls.prepare += 1
      const stmt = d1.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        run: async (p) => ({ changes: stmt.run(p).meta.changes }),
      }
    },
    async batch(items) {
      calls.batch += 1
      if (hooks.beforeBatch) hooks.beforeBatch(raw)
      return d1.batch(items)
    },
  }
  const indexes = raw.prepare("SELECT name, tbl_name AS t, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()
    .filter((row) => TABLES.includes(row.t))
  const totalChanges = () => raw.prepare('SELECT total_changes() AS n').get().n
  const entryCounts = () => {
    const out = {}
    for (const index of indexes) {
      const where = /\bWHERE\b([\s\S]*)$/i.exec(index.sql)
      out[index.name] = raw.prepare(`SELECT COUNT(*) AS n FROM ${index.t} INDEXED BY ${index.name}${where ? ` WHERE ${where[1]}` : ''}`).get().n
    }
    return out
  }
  // One written row = one B-tree entry (section 1.2).
  async function measure(fn) {
    const before = totalChanges()
    const entries = entryCounts()
    const value = await fn()
    const after = entryCounts()
    let written = totalChanges() - before
    for (const name of Object.keys(entries)) written += Math.abs(after[name] - entries[name])
    return { value, written }
  }
  const one = (sql, p = {}) => raw.prepare(sql).get(p)
  const all = (sql, p = {}) => raw.prepare(sql).all(p)
  const dump = () => JSON.stringify(TABLES.map((t) => raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()))
  return { d1, raw, db, calls, hooks, measure, one, all, dump }
}

let phoneSeq = 0
function seedMember(world, fields = {}) {
  phoneSeq += 1
  const row = {
    name: 'Seed', phone: `0990${String(phoneSeq).padStart(5, '0')}`, member_code: mintMemberCode(), status: 'active',
    created_at: '2026-10-01 08:00:00', last_seen_at: '2026-10-01 08:00:00', telegram_user_id: null, ...fields,
  }
  world.raw.prepare('INSERT INTO portal_accounts (name, phone, member_code, status, created_at, updated_at, last_seen_at, telegram_user_id) VALUES (@name, @phone, @member_code, @status, @created_at, @created_at, @last_seen_at, @telegram_user_id)').run(row)
  return row
}

async function start(world, { tg = TG, n = 1, flags = FLAGS_FULL_KM, at = T0 } = {}) {
  return join.recordPendingStart(world.db, ENV, { tg, ticket: ticketOf(n), flags, expirySeconds: EXPIRY_SECONDS }, at)
}

const contact = (over = {}) => ({ fromId: TG, contact: { userId: TG, phoneNumber: '+855 12 345 678', firstName: 'Sok', lastName: 'Dara', ...over } })
const pendingRow = (world, tg = TG) => world.one('SELECT * FROM portal_telegram_pending WHERE id = @tg', { tg })
const countOf = (world, table) => world.one(`SELECT COUNT(*) AS n FROM ${table}`).n
const mintFrom = (codes) => { let i = 0; return () => codes[Math.min(i++, codes.length - 1)] }

// ---- Source facts -----------------------------------------------------------------------------

const source = fs.readFileSync(path.join(libRoot, 'portalTelegramJoin.ts'), 'utf8').replace(/\r\n/g, '\n')

check('source: times are bound ISO values, comparisons go through datetime(), no limit literal, consent version from S1', () => {
  assert.ok(!/CURRENT_TIMESTAMP/i.test(source) && !/datetime\('now'\)/i.test(source) && !/strftime/i.test(source), 'no database clock')
  assert.match(source, /import \{ PORTAL_CONSENT_VERSION \} from '\.\/portalAccounts'/)
  for (const field of ['portalTelegramPendingWindowSeconds', 'portalTelegramPendingAttemptsMax', 'portalTelegramJoinsPerWindowMax', 'portalTelegramJoinsWindowSeconds']) {
    assert.ok(source.includes(`limits.${field}`), `reads ${field} from getPlanLimits`)
  }
})

// ---- T-D1 -------------------------------------------------------------------------------------

check('T-D1: the 6th /start in the window writes 0; the window resets after its length', async () => {
  const world = makeWorld()
  const max = LIM.portalTelegramPendingAttemptsMax
  const windowMs = LIM.portalTelegramPendingWindowSeconds * 1000
  for (let i = 1; i <= max; i += 1) {
    const { value, written } = await world.measure(() => start(world, { n: i, at: T0 + i * 1000 }))
    assert.equal(value.reply, 'R-SHARE')
    assert.equal(written, 1, `start ${i} writes 1`)
  }
  assert.equal(pendingRow(world).attempts, max)
  const before = world.dump()
  const refused = await world.measure(() => start(world, { n: 99, at: T0 + 10_000 }))
  assert.equal(refused.value.reply, 'R-TOO-MANY')
  assert.equal(refused.written, 0)
  assert.equal(world.dump(), before, 'a refused /start changes nothing, not even the ticket')
  // The window began at the first /start (T0 + 1s): one second short of its length is still inside it.
  const justInside = await start(world, { n: 100, at: T0 + 1000 + windowMs - 1000 })
  assert.equal(justInside.reply, 'R-TOO-MANY')
  const reset = await world.measure(() => start(world, { n: 101, at: T0 + 1000 + windowMs }))
  assert.equal(reset.value.reply, 'R-SHARE')
  assert.equal(reset.written, 1)
  const row = pendingRow(world)
  assert.equal(row.attempts, 1)
  assert.equal(row.window_started_at, iso(T0 + 1000 + windowMs))
  assert.equal(row.ticket_hash, ticketOf(101))
})

check('T-D1: the stored times are the 24-character ISO form', async () => {
  const world = makeWorld()
  await start(world)
  const row = pendingRow(world)
  for (const key of ['window_started_at', 'created_at', 'expires_at']) assert.equal(row[key].length, 24, key)
  assert.equal(row.expires_at, iso(EXPIRY_SECONDS * 1000))
  assert.equal(row.flags, FLAGS_FULL_KM)
})

// ---- T-D2 -------------------------------------------------------------------------------------

check('T-D2: two /start with two tokens, then a contact: the second ticket only', async () => {
  const world = makeWorld()
  await start(world, { n: 1 })
  await start(world, { n: 2, at: T0 + 1000 })
  assert.equal(countOf(world, 'portal_telegram_pending'), 1)
  const result = await join.joinFromContact(world.db, ENV, contact(), T0 + 2000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })
  assert.equal(result.reply, 'R-JOINED')
  const sessions = world.all('SELECT token_hash FROM portal_sessions')
  assert.deepEqual(sessions.map((row) => row.token_hash), [ticketOf(2)])
})

// ---- T-D3 -------------------------------------------------------------------------------------

check('T-D3: every refusal of section 5.6 writes 0 and makes no D1 call', async () => {
  const fixtures = [
    ['forwarded: another user id', contact({ userId: TG + 1 }), 'R-OWN-NUMBER'],
    ['typed: no user id', contact({ userId: undefined }), 'R-OWN-NUMBER'],
    ['user id as text', contact({ userId: String(TG) }), 'R-OWN-NUMBER'],
    ['unsafe user id', { fromId: 2 ** 60, contact: { userId: 2 ** 60, phoneNumber: '+855 12 345 678' } }, 'R-OWN-NUMBER'],
    ['+888', contact({ phoneNumber: '+888 0123 4567' }), 'R-ANON'],
    ['888 without a plus', contact({ phoneNumber: '88812345678' }), 'R-ANON'],
    ['00888', contact({ phoneNumber: '00888 0123 4567' }), 'R-ANON'],
    ['letters in the number', contact({ phoneNumber: '+855 12 345 67x' }), 'R-PHONE-BAD'],
    ['33 characters', contact({ phoneNumber: '0'.repeat(33) }), 'R-PHONE-BAD'],
    ['no digits', contact({ phoneNumber: '+ - ( )' }), 'R-PHONE-BAD'],
    ['not a string', contact({ phoneNumber: 12345678 }), 'R-PHONE-BAD'],
  ]
  for (const [label, update, reply] of fixtures) {
    const world = makeWorld()
    await start(world)
    const callsBefore = world.calls.prepare + world.calls.batch
    const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, update, T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
    assert.equal(value.reply, reply, label)
    assert.equal(world.calls.prepare + world.calls.batch, callsBefore, `${label}: no D1 call`)
    assert.equal(written, 0, label)
    assert.ok(pendingRow(world), `${label}: the pending row stays`)
  }
})

check('T-D3: a Cambodian 088 number inside 855 and a number with 888 inside are accepted', async () => {
  for (const [phoneNumber, stored] of [['+855 88 123 456', '088123456'], ['+855 12 888 345', '012888345'], ['+855 12 345 678', '012345678']]) {
    const world = makeWorld()
    await start(world)
    const result = await join.joinFromContact(world.db, ENV, contact({ phoneNumber }), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })
    assert.equal(result.reply, 'R-JOINED', phoneNumber)
    assert.equal(world.one('SELECT phone FROM portal_accounts').phone, stored)
  }
})

// ---- T-D4 -------------------------------------------------------------------------------------

check('T-D4: no pending row, or an expired one, refuses the contact with R-STALE and writes 0', async () => {
  const world = makeWorld()
  const none = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0, {}))
  assert.equal(none.value.reply, 'R-STALE')
  assert.equal(none.written, 0)
  await start(world)
  const justBefore = EXPIRY_SECONDS * 1000 - 1000
  const live = await join.joinFromContact(world.db, ENV, contact({ phoneNumber: '+855 12 000 001' }), justBefore, { mintCode: mintFrom(['W-7KQ4-M9XD']) })
  assert.equal(live.reply, 'R-JOINED', 'one second before the expiry still works')
  const second = makeWorld()
  await start(second)
  const dumpBefore = second.dump()
  const expired = await second.measure(() => join.joinFromContact(second.db, ENV, contact(), EXPIRY_SECONDS * 1000, {}))
  assert.equal(expired.value.reply, 'R-STALE', 'at the expiry second it is refused')
  assert.equal(expired.written, 0)
  assert.equal(second.dump(), dumpBefore)
})

// ---- T-D5 -------------------------------------------------------------------------------------

check('T-D5: the terms or the age bit at 0 -> R-TERMS, 0 writes, the pending row kept', async () => {
  for (const flags of [FLAGS_NO_TERMS, FLAGS_NO_AGE, 1 | (42 << 5)]) {
    const world = makeWorld()
    await start(world, { flags })
    const dumpBefore = world.dump()
    const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
    assert.equal(value.reply, 'R-TERMS', `flags ${flags}`)
    assert.equal(written, 0)
    assert.equal(world.dump(), dumpBefore)
  }
})

// ---- T-D6 -------------------------------------------------------------------------------------

check('T-D6: a held phone -> R-PHONE-HELD, the holder untouched, the pending row deleted (W 1)', async () => {
  const world = makeWorld()
  const holder = seedMember(world, { phone: '012345678', name: 'Holder', telegram_user_id: 777 })
  await start(world)
  const holderBefore = JSON.stringify(world.one('SELECT * FROM portal_accounts WHERE phone = @p', { p: '012345678' }))
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
  assert.equal(value.reply, 'R-PHONE-HELD')
  assert.equal(written, 1)
  assert.equal(pendingRow(world), undefined)
  assert.equal(JSON.stringify(world.one('SELECT * FROM portal_accounts WHERE phone = @p', { p: holder.phone })), holderBefore)
  assert.equal(countOf(world, 'portal_accounts'), 1)
  assert.equal(countOf(world, 'portal_sessions'), 0)
})

// ---- T-D7 -------------------------------------------------------------------------------------

check('T-D7: 30 accounts created in the last hour (default created_at format): the 31st join writes 0 -> R-BUSY', async () => {
  const world = makeWorld()
  const max = LIM.portalTelegramJoinsPerWindowMax
  for (let i = 0; i < max; i += 1) seedMember(world, { created_at: '2026-11-24 09:30:00', last_seen_at: '2026-11-24 09:30:00' })
  await start(world)
  const dumpBefore = world.dump()
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
  assert.equal(value.reply, 'R-BUSY')
  assert.equal(written, 0)
  assert.equal(world.dump(), dumpBefore, 'the pending row survives a refused join')
})

check('T-D7: 29 in the hour still lets one in; accounts older than the window do not count', async () => {
  const max = LIM.portalTelegramJoinsPerWindowMax
  const a = makeWorld()
  for (let i = 0; i < max - 1; i += 1) seedMember(a, { created_at: '2026-11-24 09:30:00' })
  await start(a)
  assert.equal((await join.joinFromContact(a.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-JOINED')
  const b = makeWorld()
  for (let i = 0; i < max; i += 1) seedMember(b, { created_at: '2026-11-24 08:59:00' })
  await start(b)
  assert.equal((await join.joinFromContact(b.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-JOINED')
})

check('T-D7: ISO created_at rows count the same as default-format rows', async () => {
  const world = makeWorld()
  for (let i = 0; i < LIM.portalTelegramJoinsPerWindowMax; i += 1) seedMember(world, { created_at: iso(T0 - 5 * MIN) })
  await start(world)
  assert.equal((await join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-BUSY')
})

check('T-D7: 30 members who only signed in during the hour do not block a join', async () => {
  const world = makeWorld()
  for (let i = 0; i < LIM.portalTelegramJoinsPerWindowMax; i += 1) seedMember(world, { created_at: '2026-10-01 08:00:00', last_seen_at: iso(T0 - 5 * MIN) })
  await start(world)
  assert.equal((await join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-JOINED')
})

// ---- T-D8 -------------------------------------------------------------------------------------

check('T-D8: a member already holds the Telegram id: no ticket for the older member, the pending row is kept', async () => {
  const world = makeWorld()
  seedMember(world, { phone: '012777777', telegram_user_id: TG, name: 'Older' })
  await start(world)
  const dumpBefore = world.dump()
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
  assert.equal(value.reply, 'R-BUSY')
  assert.equal(written, 0)
  assert.equal(countOf(world, 'portal_sessions'), 0, 'no ticket attached to the older member')
  assert.ok(pendingRow(world), 'the pending row of a refused join is not deleted')
  assert.equal(world.dump(), dumpBefore)
})

// ---- T-D9 -------------------------------------------------------------------------------------

check('T-D9: a member_code UNIQUE error is retried with a new code; the whole first batch rolled back', async () => {
  const world = makeWorld()
  seedMember(world, { member_code: 'W-7KQ4-M9XD' })
  await start(world)
  const second = mintMemberCode()
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD', second]) }))
  assert.equal(value.reply, 'R-JOINED')
  assert.equal(world.calls.batch, 2)
  assert.equal(written, 10, 'only the second batch wrote')
  assert.equal(world.one('SELECT member_code FROM portal_accounts WHERE telegram_user_id = @tg', { tg: TG }).member_code, second)
  assert.equal(countOf(world, 'portal_sessions'), 1)
})

check('T-D9: three member_code failures -> R-LATER, nothing written, the pending row kept', async () => {
  const world = makeWorld()
  seedMember(world, { member_code: 'W-7KQ4-M9XD' })
  await start(world)
  const dumpBefore = world.dump()
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }))
  assert.equal(value.reply, 'R-LATER')
  assert.equal(world.calls.batch, 3, 'at most three batches')
  assert.equal(written, 0)
  assert.equal(world.dump(), dumpBefore)
  // A fourth colliding code never gets a batch: two failures then a free code still joins on the third.
  const again = makeWorld()
  seedMember(again, { member_code: 'W-7KQ4-M9XD' })
  await start(again)
  const free = mintMemberCode()
  assert.equal((await join.joinFromContact(again.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD', 'W-7KQ4-M9XD', free, 'W-7KQ4-M9XD']) })).reply, 'R-JOINED')
  assert.equal(again.calls.batch, 3)
})

// ---- T-D10 ------------------------------------------------------------------------------------

check('T-D10: a phone or Telegram-id UNIQUE race -> R-DONE-ALREADY when a member now holds the id, else R-LATER', async () => {
  const racing = makeWorld()
  await start(racing)
  racing.hooks.beforeBatch = (raw) => {
    raw.prepare("INSERT INTO portal_accounts (name, phone, member_code, status, telegram_user_id) VALUES ('Raced', '012888888', @code, 'active', @tg)").run({ code: mintMemberCode(), tg: TG })
    throw new Error("D1_ERROR: UNIQUE constraint failed: index 'idx_portal_accounts_telegram': SQLITE_CONSTRAINT")
  }
  assert.equal((await join.joinFromContact(racing.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-DONE-ALREADY')
  assert.equal(racing.calls.batch, 1, 'a phone or id race is not retried')

  const other = makeWorld()
  await start(other)
  other.hooks.beforeBatch = () => { throw new Error("D1_ERROR: UNIQUE constraint failed: index 'idx_portal_accounts_phone': SQLITE_CONSTRAINT") }
  assert.equal((await join.joinFromContact(other.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })).reply, 'R-LATER')

  const broken = makeWorld()
  await start(broken)
  broken.hooks.beforeBatch = () => { throw new Error('D1_ERROR: network lost') }
  await assert.rejects(() => join.joinFromContact(broken.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) }), /network lost/)
})

// ---- T-D11 ------------------------------------------------------------------------------------

check('T-D11: the join batch is one D1 call and writes exactly 10; the whole event is 3 calls', async () => {
  const world = makeWorld()
  await start(world)
  const calls = { prepare: world.calls.prepare, batch: world.calls.batch }
  const code = 'W-7KQ4-M9XD'
  const { value, written } = await world.measure(() => join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom([code]) }))
  assert.equal(value.reply, 'R-JOINED')
  assert.equal(value.removeKeyboard, true)
  assert.equal(world.calls.batch - calls.batch, 1, 'one batch')
  assert.equal(world.calls.prepare - calls.prepare, 2, 'S-P2 and S-J1')
  assert.equal(written, 10, 'member 6 + ticket 3 + pending delete 1')
  const member = world.one('SELECT * FROM portal_accounts WHERE telegram_user_id = @tg', { tg: TG })
  assert.equal(member.name, 'Sok Dara')
  assert.equal(member.phone, '012345678')
  assert.equal(member.member_code, code)
  assert.equal(member.status, 'active')
  assert.equal(member.link_version, 0)
  assert.equal(member.password_hash, null)
  assert.equal(member.consent_version, CONSENT_VERSION)
  assert.equal(member.consent_locale, 'km')
  for (const key of ['created_at', 'updated_at', 'last_seen_at', 'consent_at', 'age_confirmed_at', 'telegram_verified_at']) assert.equal(member[key], iso(T0 + 1000), key)
  const ticket = world.one('SELECT * FROM portal_sessions')
  assert.equal(ticket.account_id, member.id)
  assert.equal(ticket.token_hash, ticketOf(1))
  assert.equal(ticket.expires_at, iso(EXPIRY_SECONDS * 1000))
  assert.equal(ticket.created_at, iso(T0 + 1000))
  assert.equal(pendingRow(world), undefined)
  console.log(`  rows written per event: /start 1 (over the limit 0); contact refusal 0; held phone 1; join ${written}`)
})

// ---- T-D12 ------------------------------------------------------------------------------------

check('T-D12: a proven phone equal to a customer phone -> contact_id NULL, no auto-link', async () => {
  const world = makeWorld(true)
  world.raw.prepare("INSERT INTO customers (id, name, phone, phone_normalized, membership_number, created_at) VALUES (10, 'Buyer', '012 345 678', '012345678', 'LC-00010', '2026-09-01 08:00:00')").run()
  await start(world)
  const result = await join.joinFromContact(world.db, ENV, contact(), T0 + 1000, { mintCode: mintFrom(['W-7KQ4-M9XD']) })
  assert.equal(result.reply, 'R-JOINED')
  const member = world.one('SELECT contact_id, created_contact_id, membership_id FROM portal_accounts')
  assert.equal(member.contact_id, null)
  assert.equal(member.created_contact_id, null)
  assert.equal(member.membership_id, null)
})

// ---- T-D13 ------------------------------------------------------------------------------------

check('T-D13: the name rules (control characters, 80 characters, empty -> member code)', async () => {
  const code = 'W-7KQ4-M9XD'
  assert.equal(join.joinMemberName('Sok', 'Dara', code), 'Sok Dara')
  assert.equal(join.joinMemberName('Sok', null, code), 'Sok')
  assert.equal(join.joinMemberName(null, 'Dara', code), 'Dara')
  assert.equal(join.joinMemberName('A\u0007B\u0000\u001f\u007f\u0085C', null, code), 'ABC')
  assert.equal(join.joinMemberName('x'.repeat(100), null, code), 'x'.repeat(80))
  assert.equal(join.joinMemberName('x'.repeat(79), ' y', code), 'x'.repeat(79), 'a cut that ends on a space is trimmed')
  assert.equal(join.joinMemberName('\u0001', '\u0002', code), code)
  assert.equal(join.joinMemberName(null, null, code), code)
  assert.equal(join.joinMemberName('   ', null, code), code)
  assert.equal(join.joinMemberName('\u{1F600}'.repeat(100), null, code), '\u{1F600}'.repeat(80), 'cut by characters, not UTF-16 halves')
  // A5: bidi, zero-width and format characters go too; a name of only those falls back to the member code.
  assert.equal(join.joinMemberName('ab\u202Ecd', null, code), 'abcd', 'a bidi override is removed')
  for (const hidden of ['\u200B', '\u200C', '\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2060', '\u2066', '\u2069', '\uFEFF']) {
    assert.equal(join.joinMemberName(`a${hidden}b`, null, code), 'ab', `U+${hidden.codePointAt(0).toString(16).toUpperCase()} is removed`)
    assert.equal(join.joinMemberName(hidden, hidden, code), code, `a name of only U+${hidden.codePointAt(0).toString(16).toUpperCase()} is empty`)
  }
  assert.equal(join.joinMemberName('\u200B\u200B', null, code), code, 'two zero-width spaces are no name')
  // R2-5 (review F7): more invisible characters go; U+200D stays inside an emoji sequence, and joiners alone are no name.
  for (const hidden of ['\u061C', '\u00AD', '\u180E', '\u3164', '\u{E0041}', '\u{E0000}', '\u{E007F}']) {
    assert.equal(join.joinMemberName(`a${hidden}b`, null, code), 'ab', `U+${hidden.codePointAt(0).toString(16).toUpperCase()} is removed`)
    assert.equal(join.joinMemberName(hidden + hidden, hidden, code), code, `a name of only U+${hidden.codePointAt(0).toString(16).toUpperCase()} is the member code`)
  }
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  assert.equal(join.joinMemberName(family, null, code), family, 'the zero width joiner keeps an emoji sequence whole')
  assert.equal(join.joinMemberName('\u200D', '\u200D', code), code, 'joiners alone are no name')
  assert.equal(join.joinMemberName('\u{E0020}\u{E0041}\u200D', null, code), code, 'tag characters and a joiner alone are no name')
  assert.equal(join.joinMemberName('x'.repeat(79) + '\u{1F600}\u{1F600}', null, code), 'x'.repeat(79) + '\u{1F600}', 'an emoji at the cut is kept whole or dropped whole')
  assert.equal(join.joinMemberName('x'.repeat(80) + '\u{1F600}', null, code), 'x'.repeat(80), 'an emoji just past the cut is dropped whole')
  assert.equal(join.joinMemberName('x'.repeat(78) + '\u202E' + '\u200B' + 'yz', null, code), 'x'.repeat(78) + 'yz', 'the hidden characters do not use up the 80')
  // R3-3: more invisible characters go (written as escapes, never as the characters themselves).
  const r33Hidden = ['\u115F', '\u1160', '\uFFA0', '\u2800', '\u034F', '\u206A', '\u206B', '\u206C', '\u206D', '\u206E', '\u206F', '\u{E0100}', '\u{E01A0}', '\u{E01EF}']
  for (const hidden of r33Hidden) {
    const label = `U+${hidden.codePointAt(0).toString(16).toUpperCase()}`
    assert.equal(join.joinMemberName(`a${hidden}b`, null, code), 'ab', `${label} is removed`)
    assert.equal(join.joinMemberName(hidden + hidden, hidden, code), code, `a name of only ${label} is the member code`)
  }
  // U+200D, U+FE0F and U+FE0E stay inside a visible name, and are invisible when nothing visible is left.
  assert.equal(join.joinMemberName('\u2764\uFE0F', null, code), '\u2764\uFE0F', 'a variation selector stays with its emoji')
  assert.equal(join.joinMemberName('\u2764\uFE0E', null, code), '\u2764\uFE0E')
  for (const lone of ['\uFE0F', '\uFE0E', '\u200D\uFE0F\u200D\uFE0E']) {
    assert.equal(join.joinMemberName(lone, lone, code), code, `U+${lone.codePointAt(0).toString(16).toUpperCase()} alone is no name`)
  }
  // The cut comes first, then the empty check: a name whose visible part is past the cut is no name.
  assert.equal(join.joinMemberName('\u200D'.repeat(80) + 'a', null, code), code, '80 joiners then a letter past the cut')
  assert.equal(join.joinMemberName('\uFE0F'.repeat(80) + 'a', null, code), code, '80 variation selectors then a letter past the cut')
  assert.equal(join.joinMemberName('\u200D'.repeat(64), '\u200D'.repeat(16) + 'a', code), code, 'a Telegram-sized name of joiners and one late letter')
  assert.equal(join.joinMemberName('\u200D'.repeat(79) + 'a', null, code), '\u200D'.repeat(79) + 'a', 'a letter inside the cut makes the name visible')
  const cleaner = loadLib('portalTelegramName')
  assert.equal(cleaner.cleanTelegramName('\u200D'.repeat(60) + 'a', 60), '', 'reply cut: joiners then a late letter')
  assert.equal(cleaner.cleanTelegramName('\u200D'.repeat(59) + 'a', 60), '\u200D'.repeat(59) + 'a')
  assert.equal(cleaner.cleanTelegramName('A\nB', 60), 'AB', 'a line feed is a control character and is removed')
  assert.equal(cleaner.cleanTelegramName(42, 60), '')

  const cases = [
    [{ firstName: 'Sok\n', lastName: 'Da\tra' }, 'Sok Dara'],
    [{ firstName: 'a'.repeat(64), lastName: 'b'.repeat(64) }, `${'a'.repeat(64)} ${'b'.repeat(15)}`],
    [{ firstName: '\u0001', lastName: null }, code],
    [{ firstName: null, lastName: null }, code],
  ]
  for (const [names, expected] of cases) {
    const world = makeWorld()
    await start(world)
    assert.equal((await join.joinFromContact(world.db, ENV, contact(names), T0 + 1000, { mintCode: mintFrom([code]) })).reply, 'R-JOINED')
    assert.equal(world.one('SELECT name FROM portal_accounts').name, expected)
  }
})

// ---- Run --------------------------------------------------------------------------------------

;(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
})()
