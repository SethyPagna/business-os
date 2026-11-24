// G38 S3c: the known member's confirm (lib/portalTelegramSignIn.ts) and the reply texts (lib/portalTelegramText.ts).
// Tests T-C3 to T-C11 of AMEND-g38-lean-writes-1.2 section 11.3. The D1 is a real in-memory SQLite that runs the
// real statement text (a 0-row INSERT is a success there, as on D1) behind a wrapper that counts calls and rows.
// PORTAL_LIB_ROOT points the test at a scratch copy of src/lib (mutant runs).
// Run: node scripts/test-portal-telegram-signin-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const cloudflareRoot = path.join(__dirname, '..')
const libRoot = process.env.PORTAL_LIB_ROOT || path.join(cloudflareRoot, 'src', 'lib')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

const compiled = new Map()
function loadLib(name) {
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

const token = loadLib('portalTelegramToken')
const signIn = loadLib('portalTelegramSignIn')
const texts = loadLib('portalTelegramText')
const { getPlanLimits } = loadLib('planTier')

const SECRET = 'portal-test-secret-that-is-at-least-32-chars'
const ENV = { PORTAL_ABUSE_HMAC_SECRET: SECRET, PORTAL_TELEGRAM_BOT_TOKEN: '123456:TEST', PORTAL_TELEGRAM_WEBHOOK_SECRET: 'webhook-test-secret-with-at-least-32-chars-ok' }
const LIMITS = getPlanLimits(ENV)
const CAP_MAX = LIMITS.portalTelegramSessionsPerMemberMax
const T0 = Date.UTC(2026, 10, 24, 8, 0, 0)
const MEMBER_TG = 5550001
const OTHER_TG = 5550002

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// ---- the D1 stand-in ------------------------------------------------------------------------
function makeDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE portal_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, telegram_user_id INTEGER, status TEXT NOT NULL DEFAULT 'active', last_seen_at TEXT);
    CREATE INDEX idx_portal_accounts_telegram ON portal_accounts (telegram_user_id);
    CREATE INDEX idx_portal_accounts_status_seen ON portal_accounts (status, last_seen_at);
    CREATE TABLE portal_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, token_hash TEXT NOT NULL, user_agent TEXT, last_ip TEXT, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX idx_portal_sessions_token ON portal_sessions (token_hash);
    CREATE INDEX idx_portal_sessions_account ON portal_sessions (account_id);
  `)
  const indexedColumns = (table) => sqlite.prepare(`PRAGMA index_list(${table})`).all().map((index) => sqlite.prepare(`PRAGMA index_info(${index.name})`).all().map((c) => c.name))
  const db = { calls: 0, batches: 0, changes: 0, rowsWritten: 0, sqlite }

  function translate(sql, params) {
    const values = []
    const slots = new Map()
    const text = sql.replace(/@(\w+)/g, (_, name) => {
      if (!slots.has(name)) {
        assert.ok(Object.hasOwn(params || {}, name), `no value for @${name}`)
        values.push(params[name])
        slots.set(name, values.length)
      }
      return `?${slots.get(name)}`
    })
    return { sql: text, values }
  }

  // The design's counting rule (1.2): a table row plus one entry per index the write touches.
  function countWrite(sql, changes) {
    if (!changes) return
    db.changes += changes
    const insert = /^\s*INSERT INTO (\w+)/i.exec(sql)
    if (insert) {
      db.rowsWritten += changes * (1 + indexedColumns(insert[1]).length)
      return
    }
    const update = /^\s*UPDATE (\w+) SET (\w+)/i.exec(sql)
    if (update) db.rowsWritten += changes * (1 + indexedColumns(update[1]).filter((cols) => cols.includes(update[2])).length)
  }

  function runOne(sql, params) {
    const { sql: text, values } = translate(sql, params)
    const statement = sqlite.prepare(text)
    if (/^\s*SELECT/i.test(text)) return { results: statement.all(...values), meta: { changes: 0 } }
    const result = statement.run(...values)
    countWrite(text, Number(result.changes))
    return { results: [], meta: { changes: Number(result.changes) } }
  }

  db.prepare = (sql) => ({
    async get(params) { db.calls += 1; return runOne(sql, params).results[0] },
    async all(params) { db.calls += 1; return runOne(sql, params).results },
  })
  db.batch = async (statements) => {
    db.calls += 1
    db.batches += 1
    sqlite.exec('BEGIN')
    try {
      const out = statements.map((s) => runOne(s.sql, s.params))
      sqlite.exec('COMMIT')
      return out
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
  db.member = (tg, status = 'active', lastSeenAt = null) => Number(sqlite.prepare('INSERT INTO portal_accounts (name, telegram_user_id, status, last_seen_at) VALUES (?, ?, ?, ?)').run(`Member ${tg}`, tg, status, lastSeenAt).lastInsertRowid)
  db.session = (accountId, createdAt, hash = crypto.randomUUID()) => sqlite.prepare('INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(accountId, hash, '2027-01-01T00:00:00.000Z', createdAt)
  db.sessions = () => sqlite.prepare('SELECT * FROM portal_sessions ORDER BY id').all()
  db.account = (id) => sqlite.prepare('SELECT * FROM portal_accounts WHERE id = ?').get(id)
  db.resetCounters = () => { db.calls = 0; db.batches = 0; db.changes = 0; db.rowsWritten = 0 }
  return db
}

// ---- tokens ---------------------------------------------------------------------------------
let tokenCounter = 0
async function freshToken(overrides = {}, nowMs = T0, env = ENV) {
  tokenCounter += 1
  const binding = new Uint8Array(16).map((_, i) => (i * 7 + tokenCounter) & 255)
  return token.mintStartToken(env, { locale: 1, termsAccepted: true, ageConfirmed: true, code: 10 + ((tokenCounter * 13) % 90), binding, ...overrides }, nowMs)
}
async function choiceFor(text, nowMs = T0) {
  const verified = await token.verifyStartToken(ENV, text, nowMs)
  return { verified, right: matchIndex(verified), wrong: [0, 1, 2].find((i) => i !== matchIndex(verified)) }
}
function matchIndex(verified) { return token.matchOptions(verified.code, verified.firstMacByte).indexOf(verified.code) }
const tap = (db, text, choice, fromId = MEMBER_TG, nowMs = T0, lang = null) => signIn.confirmKnownMember(ENV, db, { token: text, choice, fromId, languageCode: lang }, nowMs)
function breakMac(text) {
  const bytes = token.b64urlDecode(text)
  bytes[30] ^= 0x01
  return token.b64url(bytes)
}

// ---------------------------------------------------------------- T-C3
check('T-C3 a bad MAC, an expired token, a token of another secret and a malformed token write 0 and make 0 D1 calls', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  const good = await freshToken()
  const { right } = await choiceFor(good)
  const other = await freshToken({}, T0, { ...ENV, PORTAL_ABUSE_HMAC_SECRET: 'another-secret-that-is-at-least-32-chars-long' })
  const expiredAt = T0 + (LIMITS.portalTelegramTokenTtlSeconds + 1) * 1000
  for (const [label, text, nowMs] of [['bad mac', breakMac(good), T0], ['expired', good, expiredAt], ['other secret', other, T0], ['short', 'abc', T0], ['not a string', null, T0]]) {
    db.resetCounters()
    const start = await signIn.startForKnownMember(ENV, db, { token: text, fromId: MEMBER_TG, languageCode: null }, nowMs)
    assert.equal(start.kind, 'reply', label)
    assert.equal(start.id, 'R-STALE', label)
    const confirm = await tap(db, text, right, MEMBER_TG, nowMs)
    assert.equal(confirm.id, 'R-STALE', label)
    assert.equal(db.calls, 0, `${label}: D1 calls`)
    assert.equal(db.changes, 0, `${label}: writes`)
  }
  assert.equal(db.sessions().length, 0)
})

// ---------------------------------------------------------------- start (section 3.3)
check('T-C3 start: a member gets R-CONFIRM with three buttons and the Cambodia start time, after one D1 call', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  const text = await freshToken()
  const { verified } = await choiceFor(text)
  const out = await signIn.startForKnownMember(ENV, db, { token: text, fromId: MEMBER_TG, languageCode: 'en' }, T0)
  assert.equal(out.kind, 'reply')
  assert.equal(out.id, 'R-CONFIRM')
  assert.equal(out.lang, 'km', 'the token locale wins over the Telegram language')
  assert.equal(out.startedHm, '15:00', '08:00 UTC is 15:00 in Cambodia')
  assert.equal(db.calls, 1)
  assert.equal(db.changes, 0)
  assert.equal(out.buttons.length, 3)
  const options = token.matchOptions(verified.code, verified.firstMacByte)
  out.buttons.forEach((button, index) => {
    assert.equal(button.text, String(options[index]))
    assert.equal(button.data.length, 53)
    assert.deepEqual(token.parseCallbackData(button.data), { token: text, choice: index })
  })
})

check('A1 start: R-CONFIRM carries the member name from the one S-K1 read, and the text says "as <name>"', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  db.sqlite.prepare('UPDATE portal_accounts SET name = ? WHERE telegram_user_id = ?').run('Sok Dara', MEMBER_TG)
  const text = await freshToken({ locale: 0 })
  db.resetCounters()
  const out = await signIn.startForKnownMember(ENV, db, { token: text, fromId: MEMBER_TG, languageCode: 'en' }, T0)
  assert.equal(out.id, 'R-CONFIRM')
  assert.equal(out.memberName, 'Sok Dara')
  assert.equal(db.calls, 1, 'the name comes with the same read: no extra D1 call')
  assert.match(texts.portalTelegramReplyText(out.id, out.lang, { startedHm: out.startedHm, shopName: 'Example Shop', memberName: out.memberName }), /^Sign in to the Example Shop website as Sok Dara\? /)
  db.sqlite.prepare('UPDATE portal_accounts SET name = NULL WHERE telegram_user_id = ?').run(MEMBER_TG)
  const unnamed = await signIn.startForKnownMember(ENV, db, { token: text, fromId: MEMBER_TG, languageCode: 'en' }, T0)
  assert.equal(unnamed.id, 'R-CONFIRM')
  assert.doesNotMatch(texts.portalTelegramReplyText(unnamed.id, unnamed.lang, { startedHm: unnamed.startedHm, memberName: unnamed.memberName }), / as /)
})

check('A1/N2 the R-CONFIRM template is filled in one pass: a name holding {hm}, {site} or {who} is printed as text', async () => {
  for (const lang of ['en', 'km']) {
    for (const hostile of ['{hm}', '{site}', '{who}', '{hm}{site}{who}']) {
      const out = texts.portalTelegramReplyText('R-CONFIRM', lang, { startedHm: '14:05', shopName: 'Shop', memberName: hostile })
      assert.ok(out.includes(hostile), `${lang} ${hostile}: the name is printed as it is`)
      const rest = out.split(hostile).join('')
      assert.ok(rest.includes('14:05'), `${lang} ${hostile}: the real time is filled`)
      assert.doesNotMatch(rest, /\{(hm|site|who)\}/, `${lang} ${hostile}: no placeholder left outside the name`)
    }
    const hostileShop = texts.portalTelegramReplyText('R-CONFIRM', lang, { startedHm: '14:05', shopName: '{who}', memberName: 'Sok' })
    assert.ok(hostileShop.includes('{who}') && hostileShop.includes('Sok'), `${lang}: a shop name holding {who} stays text`)
  }
})

check('A5 the reply text cleans names like the join: hidden characters out, a cut of 60 code points, an emoji at the cut', async () => {
  const text = (memberName, shopName) => texts.portalTelegramReplyText('R-CONFIRM', 'en', { startedHm: '14:05', shopName, memberName })
  assert.match(text('ab\u202Ecd'), /^Sign in to the website as abcd\? /, 'a bidi override is removed')
  for (const hidden of ['\u200B', '\u200F', '\u202A', '\u2060', '\u2069', '\uFEFF', '\u0085', '\u061C', '\u00AD', '\u180E', '\u3164', '\u{E0041}']) {
    assert.match(text(`a${hidden}b`), /^Sign in to the website as ab\? /, `U+${hidden.codePointAt(0).toString(16).toUpperCase()}`)
    assert.match(text(hidden), /^Sign in to the website\? /, `only U+${hidden.codePointAt(0).toString(16).toUpperCase()} is no name`)
  }
  assert.match(text('A\nB\u0000C'), /^Sign in to the website as ABC\? /)
  // R2-5: U+200D stays inside an emoji sequence; joiners alone are no name
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
  assert.ok(text(family).includes(`as ${family}? `), 'the zero width joiner keeps an emoji sequence whole')
  assert.match(text('‍‍'), /^Sign in to the website\? /, 'joiners alone are no name')
  assert.match(text('x'.repeat(80)), new RegExp(`as ${'x'.repeat(60)}\\? `), 'cut at 60')
  assert.match(text('x'.repeat(59) + '\u{1F600}\u{1F600}'), new RegExp(`as ${'x'.repeat(59)}\u{1F600}\\? `), 'an emoji at the cut is kept whole or dropped whole')
  assert.match(text('x'.repeat(60) + '\u{1F600}'), new RegExp(`as ${'x'.repeat(60)}\\? `))
  assert.match(text(null, 'Shop\u202E\u200BName'), /^Sign in to the ShopName website\? /, 'the shop name is cleaned the same way')
  assert.doesNotMatch(text('\u{1F600}'.repeat(70)), /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/, 'no lone surrogate')
})

check('A1 the statements S3c owns are exported by name (T-F2 reads them by owner)', async () => {
  for (const name of ['S_K2', 'S_C3', 'S_C4']) assert.equal(typeof signIn[name], 'string', name)
  const join = loadLib('portalTelegramJoin')
  for (const name of ['MEMBER_INSERT_SQL', 'TICKET_INSERT_SQL']) assert.equal(typeof join[name], 'string', name)
  assert.equal(join.MEMBER_INSERT_SQL, join.PORTAL_TELEGRAM_JOIN_SQL.memberInsert)
  assert.equal(join.TICKET_INSERT_SQL, join.PORTAL_TELEGRAM_JOIN_SQL.ticketInsert)
})

check('T-C3 start: a suspended or closed member gets R-PAUSED, an unknown Telegram user is handed on, 0 writes', async () => {
  const db = makeDb()
  db.member(MEMBER_TG, 'suspended')
  db.member(OTHER_TG, 'closed')
  const text = await freshToken({ locale: 0 })
  for (const tg of [MEMBER_TG, OTHER_TG]) {
    const out = await signIn.startForKnownMember(ENV, db, { token: text, fromId: tg, languageCode: null }, T0)
    assert.equal(out.id, 'R-PAUSED')
    assert.equal(out.lang, 'en')
  }
  const stranger = await signIn.startForKnownMember(ENV, db, { token: text, fromId: 999, languageCode: 'km' }, T0)
  assert.equal(stranger.kind, 'not-member')
  assert.equal(stranger.verified.code, (await choiceFor(text)).verified.code)
  assert.equal(stranger.lang, 'en')
  assert.equal(db.changes, 0)
})

// ---------------------------------------------------------------- T-C4
check('T-C4 a suspended member: R-PAUSED and no ticket; not a member: R-STALE and no ticket', async () => {
  const db = makeDb()
  db.member(MEMBER_TG, 'suspended')
  const text = await freshToken()
  const { right } = await choiceFor(text)
  const paused = await tap(db, text, right, MEMBER_TG)
  assert.equal(paused.id, 'R-PAUSED')
  const stale = await tap(db, text, right, 424242)
  assert.equal(stale.id, 'R-STALE')
  assert.equal(db.sessions().length, 0)
  assert.equal(db.changes, 0)
})

// ---------------------------------------------------------------- T-C5
check('T-C5 the same confirm twice: one ticket, the second answer R-USED', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  const text = await freshToken()
  const { right } = await choiceFor(text)
  const first = await tap(db, text, right)
  assert.equal(first.id, 'R-SIGNED-IN')
  assert.equal(first.startedHm, '15:00')
  const second = await tap(db, text, right)
  assert.equal(second.id, 'R-USED')
  assert.equal(db.sessions().length, 1)
  const row = db.sessions()[0]
  assert.equal(row.token_hash.length, 68)
  assert.ok(token.isTicketValue(row.token_hash))
  assert.equal(row.created_at, new Date(T0).toISOString())
  assert.equal(row.expires_at, new Date((Math.floor(T0 / 1000) + LIMITS.portalTelegramTokenTtlSeconds) * 1000).toISOString())
})

check('T-C5 a second tap on another button of the same token is also R-USED', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  const text = await freshToken()
  const { right } = await choiceFor(text)
  assert.equal((await tap(db, text, right)).id, 'R-SIGNED-IN')
  assert.equal((await tap(db, text, right, MEMBER_TG, T0 + 5000)).id, 'R-USED')
  assert.equal(db.sessions().length, 1)
})

// ---------------------------------------------------------------- T-C6
check('T-C6 the cap, with stored times in the default format on the day the window bound falls: the 11th is refused', async () => {
  const db = makeDb()
  const id = db.member(MEMBER_TG)
  for (let i = 0; i < CAP_MAX - 1; i += 1) db.session(id, `2026-11-23 2${i % 4}:00:00`)
  const tenth = await freshToken()
  assert.equal((await tap(db, tenth, (await choiceFor(tenth)).right)).id, 'R-SIGNED-IN')
  assert.equal(db.sessions().length, CAP_MAX)
  const eleventh = await freshToken()
  const out = await tap(db, eleventh, (await choiceFor(eleventh)).right, MEMBER_TG, T0 + 1000)
  assert.equal(out.id, 'R-CAP')
  assert.equal(db.sessions().length, CAP_MAX)
})

check('T-C6 sessions older than the window do not count against the cap', async () => {
  const db = makeDb()
  const id = db.member(MEMBER_TG)
  for (let i = 0; i < CAP_MAX + 3; i += 1) db.session(id, '2026-11-22 08:00:00')
  const text = await freshToken()
  assert.equal((await tap(db, text, (await choiceFor(text)).right)).id, 'R-SIGNED-IN')
})

check('T-C6 another member\'s sessions do not count against this member', async () => {
  const db = makeDb()
  const other = db.member(OTHER_TG)
  db.member(MEMBER_TG)
  for (let i = 0; i < CAP_MAX + 3; i += 1) db.session(other, '2026-11-24 07:00:00')
  const text = await freshToken()
  assert.equal((await tap(db, text, (await choiceFor(text)).right)).id, 'R-SIGNED-IN')
})

// ---------------------------------------------------------------- T-C7
check('T-C7 the daily stamp: not written when last_seen_at (default format) is from earlier the same day; written at 25 hours', async () => {
  const recent = makeDb()
  const recentId = recent.member(MEMBER_TG, 'active', '2026-11-23 20:00:00')
  const a = await freshToken()
  assert.equal((await tap(recent, a, (await choiceFor(a)).right)).id, 'R-SIGNED-IN')
  assert.equal(recent.account(recentId).last_seen_at, '2026-11-23 20:00:00', 'a 12 hour old stamp is left alone')

  const old = makeDb()
  const oldId = old.member(MEMBER_TG, 'active', '2026-11-23 07:00:00')
  const b = await freshToken()
  assert.equal((await tap(old, b, (await choiceFor(b)).right)).id, 'R-SIGNED-IN')
  assert.equal(old.account(oldId).last_seen_at, new Date(T0).toISOString(), '25 hours old is stamped')

  const never = makeDb()
  const neverId = never.member(MEMBER_TG, 'active', null)
  const c = await freshToken()
  await tap(never, c, (await choiceFor(c)).right)
  assert.equal(never.account(neverId).last_seen_at, new Date(T0).toISOString(), 'a NULL stamp is written')
})

check('T-C7 a refused confirm writes 0 rows and stamps nobody: R-USED, also for a member who never got the ticket (errata N7)', async () => {
  const db = makeDb()
  const id = db.member(MEMBER_TG, 'active', '2026-11-20 07:00:00')
  const text = await freshToken()
  const { right } = await choiceFor(text)
  await tap(db, text, right)
  db.sqlite.prepare('UPDATE portal_accounts SET last_seen_at = ? WHERE id = ?').run('2026-11-20 07:00:00', id)
  db.resetCounters()
  assert.equal((await tap(db, text, right, MEMBER_TG, T0 + 2000)).id, 'R-USED')
  assert.equal(db.changes, 0, 'the refused tap changed no row, the stamp included')
  assert.equal(db.account(id).last_seen_at, '2026-11-20 07:00:00')

  // The reviewer's case: member 2 (stale stamp) taps the forwarded button of a token member 1 already used.
  const other = db.member(OTHER_TG, 'active', '2026-11-20 08:00:00')
  db.resetCounters()
  assert.equal((await tap(db, text, right, OTHER_TG, T0 + 60_000)).id, 'R-USED')
  assert.equal(db.changes, 0, 'member 2 was refused and nothing was written')
  assert.equal(db.account(other).last_seen_at, '2026-11-20 08:00:00', 'member 2 is not marked as seen')
})

// R2-3 (review F3): the account half of S-C4's binding. Member 2 taps inside the same second as member 1's confirm, so the
// ticket's created_at matches @now; only s.account_id = portal_accounts.id keeps member 2 unstamped.
check('R2-3 S-C4 binds the ticket to its member: member 2 tapping a used token inside the same second is not stamped', async () => {
  for (const delta of [0, 400, 900]) {
    const db = makeDb()
    db.member(MEMBER_TG, 'active', '2026-11-20 07:00:00')
    const other = db.member(OTHER_TG, 'active', '2026-11-20 08:00:00')
    const text = await freshToken()
    const { right } = await choiceFor(text)
    assert.equal((await tap(db, text, right, MEMBER_TG, T0)).id, 'R-SIGNED-IN')
    db.resetCounters()
    assert.equal((await tap(db, text, right, OTHER_TG, T0 + delta)).id, 'R-USED', `delta ${delta}`)
    assert.equal(db.changes, 0, `member 2 changed no row at +${delta} ms`)
    assert.equal(db.account(other).last_seen_at, '2026-11-20 08:00:00', `member 2 is not marked as seen at +${delta} ms`)
  }
})

check('A2 the stamp goes in the batch that inserts the ticket of that same member, 2 rows with it', async () => {
  const db = makeDb()
  const id = db.member(MEMBER_TG, 'active', '2026-11-20 07:00:00')
  const text = await freshToken()
  db.resetCounters()
  assert.equal((await tap(db, text, (await choiceFor(text)).right)).id, 'R-SIGNED-IN')
  assert.equal(db.changes, 2, 'the ticket and the stamp')
  assert.equal(db.account(id).last_seen_at, new Date(T0).toISOString())
})

check('A4 a 0-row ticket insert after a clean read answers R-LATER (the batch is one transaction)', async () => {
  const db = makeDb()
  const text = await freshToken()
  const { right } = await choiceFor(text)
  const stub = {
    prepare: () => { throw new Error('no single reads on confirm') },
    batch: async () => [{ results: [{ account_id: 1, status: 'active', ticket_exists: 0, recent_sessions: 0 }], meta: { changes: 0 } }, { results: [], meta: { changes: 0 } }, { results: [], meta: { changes: 0 } }],
  }
  assert.equal((await tap(stub, text, right)).id, 'R-LATER')
  assert.equal(db.changes, 0)
})

// ---------------------------------------------------------------- T-C8
check('T-C8 a wrong number choice writes 0 and makes 0 D1 calls; the token still works afterwards', async () => {
  const db = makeDb()
  db.member(MEMBER_TG)
  const text = await freshToken()
  const { right, wrong } = await choiceFor(text)
  const refused = await tap(db, text, wrong)
  assert.equal(refused.id, 'R-WRONG-CODE')
  assert.equal(db.calls, 0)
  assert.equal(db.changes, 0)
  for (const bad of [3, -1, 1.5, NaN, undefined]) assert.equal((await tap(db, text, bad)).id, 'R-WRONG-CODE')
  assert.equal(db.calls, 0)
  assert.equal((await tap(db, text, right)).id, 'R-SIGNED-IN')
  assert.equal(db.sessions().length, 1)
})

// ---------------------------------------------------------------- T-C10
check('T-C10 the confirm batch is one D1 call and writes exactly 3 rows, or 5 with the daily stamp', async () => {
  const plain = makeDb()
  plain.member(MEMBER_TG, 'active', new Date(T0 - 3600_000).toISOString())
  const a = await freshToken()
  const rightA = (await choiceFor(a)).right
  plain.resetCounters()
  assert.equal((await tap(plain, a, rightA)).id, 'R-SIGNED-IN')
  assert.equal(plain.calls, 1)
  assert.equal(plain.batches, 1)
  assert.equal(plain.rowsWritten, 3)
  assert.equal(plain.changes, 1)

  const stamped = makeDb()
  stamped.member(MEMBER_TG, 'active', new Date(T0 - 30 * 3600_000).toISOString())
  const b = await freshToken()
  const rightB = (await choiceFor(b)).right
  stamped.resetCounters()
  assert.equal((await tap(stamped, b, rightB)).id, 'R-SIGNED-IN')
  assert.equal(stamped.calls, 1)
  assert.equal(stamped.rowsWritten, 5)
  assert.equal(stamped.changes, 2)
  console.log(`  rows per event: confirm calls=${plain.calls}, writes ${plain.rowsWritten} (${stamped.rowsWritten} with the stamp); start calls=1, writes 0`)
})

check('T-C10 refusals write nothing: used, cap, paused, stale are 0 rows, each with a stale daily stamp', async () => {
  const STALE_SEEN = '2026-11-20 07:00:00'
  const capped = makeDb()
  const cappedId = capped.member(MEMBER_TG, 'active', STALE_SEEN)
  for (let i = 0; i < CAP_MAX; i += 1) capped.session(cappedId, '2026-11-24 06:00:00')
  const text = await freshToken()
  capped.resetCounters()
  assert.equal((await tap(capped, text, (await choiceFor(text)).right)).id, 'R-CAP')
  assert.equal(capped.rowsWritten, 0)
  assert.equal(capped.calls, 1)
  assert.equal(capped.account(cappedId).last_seen_at, STALE_SEEN)

  const used = makeDb()
  const usedId = used.member(MEMBER_TG, 'active', STALE_SEEN)
  const usedText = await freshToken()
  const usedRight = (await choiceFor(usedText)).right
  assert.equal((await tap(used, usedText, usedRight)).id, 'R-SIGNED-IN')
  used.sqlite.prepare('UPDATE portal_accounts SET last_seen_at = ? WHERE id = ?').run(STALE_SEEN, usedId)
  used.resetCounters()
  assert.equal((await tap(used, usedText, usedRight, MEMBER_TG, T0 + 3000)).id, 'R-USED')
  assert.equal(used.rowsWritten, 0)
  assert.equal(used.account(usedId).last_seen_at, STALE_SEEN)

  const paused = makeDb()
  const pausedId = paused.member(MEMBER_TG, 'suspended', STALE_SEEN)
  const pausedText = await freshToken()
  paused.resetCounters()
  assert.equal((await tap(paused, pausedText, (await choiceFor(pausedText)).right)).id, 'R-PAUSED')
  assert.equal(paused.rowsWritten, 0)
  assert.equal(paused.account(pausedId).last_seen_at, STALE_SEEN)

  const stale = makeDb()
  const staleId = stale.member(MEMBER_TG, 'active', STALE_SEEN)
  const staleText = await freshToken()
  stale.resetCounters()
  assert.equal((await tap(stale, staleText, (await choiceFor(staleText)).right, 424242)).id, 'R-STALE')
  assert.equal(stale.rowsWritten, 0)
  assert.equal(stale.account(staleId).last_seen_at, STALE_SEEN)
})

// ---------------------------------------------------------------- T-C11
check('T-C11 a forwarded button tapped by another user: not a member -> 0 writes; a member -> a ticket for his own account only', async () => {
  const db = makeDb()
  const ownerId = db.member(MEMBER_TG)
  const otherId = db.member(OTHER_TG)
  const text = await freshToken()
  const { right } = await choiceFor(text)
  assert.equal((await tap(db, text, right, 777)).id, 'R-STALE')
  assert.equal(db.sessions().length, 0)
  assert.equal((await tap(db, text, right, OTHER_TG)).id, 'R-SIGNED-IN')
  const rows = db.sessions()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].account_id, otherId)
  assert.notEqual(rows[0].account_id, ownerId)
})

// ---------------------------------------------------------------- T-C9
const EXPECTED_IDS = ['R-CONFIRM', 'R-SHARE', 'R-JOINED', 'R-SIGNED-IN', 'R-USED', 'R-CAP', 'R-BUSY', 'R-LATER', 'R-STALE', 'R-PAUSED', 'R-OFF', 'R-TOO-MANY', 'R-TERMS', 'R-OWN-NUMBER', 'R-PHONE-BAD', 'R-ANON', 'R-PHONE-HELD', 'R-DONE-ALREADY', 'R-WRONG-CODE', 'R-HELP']
const KHMER = /[ក-៿]/

check('T-C9 every reply id of the design has an English and a Khmer text', async () => {
  assert.deepEqual([...texts.PORTAL_TELEGRAM_REPLY_IDS].sort(), [...EXPECTED_IDS].sort())
  for (const id of EXPECTED_IDS) {
    const params = { startedHm: '15:00', shopName: 'Test Shop', memberName: 'Test Member' }
    const en = texts.portalTelegramReplyText(id, 'en', params)
    const km = texts.portalTelegramReplyText(id, 'km', params)
    assert.ok(en.trim().length > 0, `${id} en`)
    assert.ok(km.trim().length > 0, `${id} km`)
    assert.match(km, KHMER, `${id} km holds Khmer`)
    assert.doesNotMatch(en, KHMER, `${id} en holds no Khmer`)
    assert.notEqual(en, km, id)
    assert.doesNotMatch(en + km, /[{}]/, `${id} leaves a placeholder`)
  }
})

check('T-C9 callback texts are at most 200 characters; so is every text except R-CONFIRM', async () => {
  for (const id of EXPECTED_IDS) {
    if (id === 'R-CONFIRM') continue
    for (const lang of ['en', 'km']) {
      const text = texts.portalTelegramReplyText(id, lang, { startedHm: '15:00' })
      assert.ok([...text].length <= 200, `${id} ${lang} is ${[...text].length}`)
    }
  }
  const longNames = { startedHm: '15:00', shopName: 'S'.repeat(500), memberName: 'M'.repeat(500) }
  for (const lang of ['en', 'km']) assert.ok(texts.portalTelegramReplyText('R-CONFIRM', lang, longNames).length < 600)
})

check('T-C9 no text holds a shop literal, a phone, a token or an id', async () => {
  for (const [id, row] of Object.entries(texts.PORTAL_TELEGRAM_TEXTS)) {
    for (const lang of ['en', 'km']) {
      const body = row[lang] + (row.button ? row.button[lang] : '')
      assert.doesNotMatch(body, /\d/, `${id} ${lang} holds a digit`)
      assert.doesNotMatch(body, /@|https?:|t\.me|leang/i, `${id} ${lang}`)
    }
  }
})

check('T-C9 R-CONFIRM names the shop and the member only from the parameters, and copes without them', async () => {
  const withBoth = texts.portalTelegramReplyText('R-CONFIRM', 'en', { startedHm: '14:05', shopName: 'Example Shop', memberName: 'Sok' })
  assert.match(withBoth, /^Sign in to the Example Shop website as Sok\? You pressed Continue with Telegram at 14:05\./)
  assert.match(withBoth, /do not tap/)
  const without = texts.portalTelegramReplyText('R-CONFIRM', 'en', { startedHm: '14:05' })
  assert.match(without, /^Sign in to the website\? /)
  const km = texts.portalTelegramReplyText('R-CONFIRM', 'km', { startedHm: '14:05', shopName: 'Example Shop', memberName: 'Sok' })
  assert.match(km, /Example Shop/)
  assert.match(km, /Sok/)
  assert.match(km, /14:05/)
  const clean = texts.portalTelegramReplyText('R-CONFIRM', 'en', { startedHm: '14:05', memberName: 'A\nB\u0000C' })
  assert.doesNotMatch(clean, /[\u0000-\u001f]/)
  assert.ok(texts.portalTelegramButtonText('R-SHARE', 'en') && texts.portalTelegramButtonText('R-SHARE', 'km'))
  assert.equal(texts.portalTelegramButtonText('R-HELP', 'en'), null)
})

check('T-C9 the reply language: the token locale when known, otherwise Telegram\'s language code', async () => {
  assert.equal(texts.replyLanguage('km', 'en'), 'km')
  assert.equal(texts.replyLanguage('en', 'km'), 'en')
  assert.equal(texts.replyLanguage('zh-CN', 'km'), 'en')
  assert.equal(texts.replyLanguage(null, 'km'), 'km')
  assert.equal(texts.replyLanguage(null, 'fr'), 'en')
  assert.equal(texts.replyLanguage(undefined, null), 'en')
})

check('T-C9 the Cambodia time helper', async () => {
  assert.equal(signIn.phnomPenhHm(Date.UTC(2026, 10, 24, 8, 0, 0) / 1000), '15:00')
  assert.equal(signIn.phnomPenhHm(Date.UTC(2026, 10, 24, 17, 5, 0) / 1000), '00:05')
  assert.equal(signIn.phnomPenhHm(Date.UTC(2026, 10, 24, 6, 59, 59) / 1000), '13:59')
})

;(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn()
      passed += 1
    } catch (error) {
      console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
      process.exitCode = 1
    }
  }
  console.log(`${passed}/${tests.length} portal telegram sign-in checks passed`)
})()
